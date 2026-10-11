import { chatMessages, players, votes } from "@oracle/db/schema/game";
import {
	type ActionInput,
	type ActionResult,
	allActed,
	applyPact,
	EngineError,
	type GameState,
	playCards,
	recordMessage,
	useAction,
	validateMessage,
} from "@oracle/engine";
import { oracleLieDetector, scriptedLieDetector } from "@oracle/oracle";
import { gameChannel } from "@oracle/realtime";
import { and, eq } from "drizzle-orm";

import {
	actionsDone,
	dayEnded,
	nightEnded,
	pactAnswered,
	votesDone,
} from "../events";
import { logOracleCall } from "../llm/profiles";
import { oracleFor } from "./oracle";
import { type GameDeps, publishGame } from "./publish";
import {
	enginePlayerId,
	gameError,
	gameIdByCode,
	loadGame,
	type MutateCtx,
	mutateGame,
	readyKey,
	type SeatRow,
	setReady,
	type Tx,
} from "./store";
import {
	AWAY_AFTER_MS,
	buildGameView,
	chatQuote,
	currentVotes,
	names,
	voteKind,
} from "./views";

/**
 * Player actions. Humans reach them through the (userId, code) exports used by
 * the router; bots through the `bot*` exports with their seat id. Both run the
 * same core, so bots obey exactly the same rules and emit the same events.
 */

/** Who is acting: a signed-in user, or a bot's seat. */
type Actor = (s: SeatRow) => boolean;
const byUser =
	(userId: string): Actor =>
	(s) =>
		s.userId === userId;
const bySeat =
	(seatId: string): Actor =>
	(s) =>
		s.id === seatId;

/** Runs engine code, turning rule violations into 400s with the engine's code as the message key. */
function rules<T>(fn: () => T): T {
	try {
		return fn();
	} catch (e) {
		if (e instanceof EngineError) throw gameError("BAD_REQUEST", e.code);
		throw e;
	}
}

function mySeat(ctx: MutateCtx, actor: Actor): SeatRow & { pid: string } {
	const seat = ctx.seats.find(actor);
	if (!seat) throw gameError("FORBIDDEN", "notSeated");
	if (ctx.game.status !== "active")
		throw gameError("BAD_REQUEST", "gameNotActive");
	return { ...seat, pid: enginePlayerId(seat.seat) };
}

/** Everyone ready for this night/day? */
export function everyoneReady(state: GameState, seats: SeatRow[]): boolean {
	const key = readyKey(state);
	return seats.every((s) => s.readyKey === key);
}

async function afterWrite(
	deps: GameDeps,
	gameId: string,
	event?: Parameters<GameDeps["inngest"]["send"]>[0],
) {
	await publishGame(deps, gameId);
	if (event) await deps.inngest.send(event);
}

export async function getView(deps: GameDeps, userId: string, code: string) {
	const gameId = await gameIdByCode(deps.db, code);
	const { game, seats } = await loadGame(deps.db, gameId);
	return buildGameView(deps.db, game, seats, userId);
}

/** Last time this user's tab checked in (presence for reconnect handling). */
export async function heartbeat(deps: GameDeps, userId: string, code: string) {
	const gameId = await gameIdByCode(deps.db, code);
	const [before] = await deps.db
		.select({ lastSeenAt: players.lastSeenAt })
		.from(players)
		.where(and(eq(players.gameId, gameId), eq(players.userId, userId)));
	if (!before) return { ok: true }; // spectators have no presence
	await deps.db
		.update(players)
		.set({ lastSeenAt: new Date() })
		.where(and(eq(players.gameId, gameId), eq(players.userId, userId)));
	// Coming back from "away": tell the table right away.
	if (
		!before.lastSeenAt ||
		Date.now() - before.lastSeenAt.getTime() > AWAY_AFTER_MS
	)
		await publishGame(deps, gameId);
	return { ok: true };
}

// ---------------------------------------------------------------------------
// Ready / Pact

async function readyCore(deps: GameDeps, gameId: string, actor: Actor) {
	const { result } = await mutateGame(deps.db, gameId, async (state, ctx) => {
		const me = mySeat(ctx, actor);
		if (state.phase !== "night" && state.phase !== "day")
			throw gameError("BAD_REQUEST", "WRONG_PHASE");
		if (
			state.pactOffers.some(
				(o) =>
					o.round === state.round && o.player === me.pid && o.accepted === null,
			)
		) {
			throw gameError("BAD_REQUEST", "answerPactFirst");
		}
		if (
			state.phase === "night" &&
			!state.messages.some(
				(m) => m.kind === "night" && m.round === state.round && m.to === me.pid,
			)
		) {
			// Ready before the Oracle has spoken would end the night before it began.
			throw gameError("BAD_REQUEST", "oracleThinking");
		}
		const key = readyKey(state);
		await setReady(ctx.tx, gameId, [me.id], key);
		const seats = ctx.seats.map((s) =>
			s.id === me.id ? { ...s, readyKey: key } : s,
		);
		return {
			state,
			result: {
				round: state.round,
				phase: state.phase,
				done: everyoneReady(state, seats),
			},
		};
	});
	const r = result as { round: number; phase: string; done: boolean };
	const event = r.done
		? (r.phase === "night" ? nightEnded : dayEnded).create({
				gameId,
				round: r.round,
			})
		: undefined;
	await afterWrite(deps, gameId, event);
	return { ok: true };
}

/** Answering the Pact also counts as being ready for the night. */
async function answerPactCore(
	deps: GameDeps,
	gameId: string,
	actor: Actor,
	accept: boolean,
) {
	const { result } = await mutateGame(deps.db, gameId, async (state, ctx) => {
		const me = mySeat(ctx, actor);
		const next = rules(() => applyPact(state, me.pid, accept));
		const key = readyKey(next);
		await setReady(ctx.tx, gameId, [me.id], key);
		const seats = ctx.seats.map((s) =>
			s.id === me.id ? { ...s, readyKey: key } : s,
		);
		return {
			state: next,
			result: { round: next.round, done: everyoneReady(next, seats) },
		};
	});
	const r = result as { round: number; done: boolean };
	await deps.inngest.send(pactAnswered.create({ gameId, round: r.round }));
	await afterWrite(
		deps,
		gameId,
		r.done ? nightEnded.create({ gameId, round: r.round }) : undefined,
	);
	return { ok: true };
}

// ---------------------------------------------------------------------------
// Cards

async function playCore(
	deps: GameDeps,
	gameId: string,
	actor: Actor,
	cardIds: string[],
) {
	const { result } = await mutateGame(deps.db, gameId, (state, ctx) => {
		const me = mySeat(ctx, actor);
		const next = rules(() => playCards(state, me.pid, cardIds));
		return { state: next, result: { round: next.round, done: allActed(next) } };
	});
	const r = result as { round: number; done: boolean };
	await afterWrite(
		deps,
		gameId,
		r.done ? actionsDone.create({ gameId, round: r.round }) : undefined,
	);
	return { ok: true };
}

async function actCore(
	deps: GameDeps,
	gameId: string,
	actor: Actor,
	input: ActionInput,
): Promise<ActionResult> {
	const { result } = await mutateGame(deps.db, gameId, (state, ctx) => {
		const me = mySeat(ctx, actor);
		const used = rules(() => useAction(state, me.pid, input));
		return { state: used.state, result: { ...used.result, pid: me.pid } };
	});
	const r = result as ActionResult & { pid: string };
	await afterWrite(deps, gameId);
	if (r.action === "lieDetector") {
		// The engine already fixed the answer (shown to the player now). The Oracle
		// only phrases it, outside the lock, and its words must state the truth.
		const { game, seats } = await loadGame(deps.db, gameId);
		const oracle = await oracleFor(deps, game, seats);
		const said = await oracleLieDetector(
			oracle.ctx,
			game.state,
			r.pid,
			r.truthfulClaim,
		);
		await logOracleCall(deps.db, {
			gameId,
			round: game.state.round,
			profileId: oracle.profileId,
			report: said.report,
		});
		await mutateGame(deps.db, gameId, (state, ctx) => {
			const ok = !validateMessage(state, said.message);
			const msg = ok
				? said.message
				: scriptedLieDetector(
						state,
						r.pid,
						r.truthfulClaim,
						names(ctx.seats),
						ctx.game.language,
					);
			return {
				state: rules(() => recordMessage(state, msg)).state,
				result: null,
			};
		});
		await afterWrite(deps, gameId);
	}
	const { pid: _, ...out } = r;
	return out as ActionResult;
}

// ---------------------------------------------------------------------------
// Votes

async function upsertVote(
	tx: Tx,
	gameId: string,
	state: GameState,
	voterRowId: string,
	targetRowId: string | null,
) {
	await tx
		.insert(votes)
		.values({
			gameId,
			round: state.round,
			kind: voteKind(state),
			voterId: voterRowId,
			targetId: targetRowId,
		})
		.onConflictDoUpdate({
			target: [votes.gameId, votes.round, votes.kind, votes.voterId],
			set: { targetId: targetRowId },
		});
}

/** Quarantine vote (vote phase) or who to leave behind (final phase). target null = abstain / nobody. */
async function voteCore(
	deps: GameDeps,
	gameId: string,
	actor: Actor,
	target: string | null,
) {
	const { result } = await mutateGame(deps.db, gameId, async (state, ctx) => {
		const me = mySeat(ctx, actor);
		if (state.phase !== "vote" && state.phase !== "final")
			throw gameError("BAD_REQUEST", "WRONG_PHASE");
		let targetRow: SeatRow | undefined;
		if (target !== null) {
			targetRow = ctx.seats.find((s) => enginePlayerId(s.seat) === target);
			if (!targetRow) throw gameError("BAD_REQUEST", "UNKNOWN_PLAYER");
			if (state.phase === "vote" && target === me.pid)
				throw gameError("BAD_REQUEST", "SELF_VOTE");
		}
		await upsertVote(ctx.tx, gameId, state, me.id, targetRow?.id ?? null);
		const voted = await currentVotes(ctx.tx, ctx.game, ctx.seats);
		const done = ctx.seats.every((s) => enginePlayerId(s.seat) in voted);
		return {
			state,
			result: { round: state.round, kind: voteKind(state), done },
		};
	});
	const r = result as {
		round: number;
		kind: "quarantine" | "final";
		done: boolean;
	};
	await afterWrite(
		deps,
		gameId,
		r.done
			? votesDone.create({ gameId, round: r.round, kind: r.kind })
			: undefined,
	);
	return { ok: true };
}

// ---------------------------------------------------------------------------
// Chat

/** `id` lets bots post idempotently (a replayed plan does not duplicate its lines). */
async function chatCore(
	deps: GameDeps,
	gameId: string,
	actor: Actor,
	text: string,
	id?: string,
	replyTo?: string | null,
) {
	const { game, seats } = await loadGame(deps.db, gameId);
	const seat = seats.find(actor);
	if (!seat) throw gameError("FORBIDDEN", "notSeated");
	const clean = text.trim().slice(0, 300);
	if (!clean) throw gameError("BAD_REQUEST", "emptyMessage");
	// A reply must point at a line in this game; anything else is dropped, not an error.
	const [parent] = replyTo
		? await deps.db
				.select({
					id: chatMessages.id,
					playerId: chatMessages.playerId,
					text: chatMessages.text,
				})
				.from(chatMessages)
				.where(
					and(eq(chatMessages.gameId, gameId), eq(chatMessages.id, replyTo)),
				)
		: [];
	const row = {
		id: id ?? crypto.randomUUID(),
		gameId,
		round: game.state.round,
		playerId: seat.id,
		text: clean,
		replyTo: parent?.id ?? null,
	};
	const [saved] = await deps.db
		.insert(chatMessages)
		.values(row)
		.onConflictDoNothing()
		.returning({ at: chatMessages.createdAt });
	if (!saved) return { ok: true }; // already posted
	try {
		await deps.inngest.realtime.publish(gameChannel({ gameId }).chat, {
			id: row.id,
			round: row.round,
			playerId: enginePlayerId(seat.seat),
			name: seat.name,
			text: clean,
			at: saved.at.toISOString(),
			replyTo: parent ? chatQuote(parent, seats) : null,
		});
	} catch (e) {
		console.error("chat publish failed", e);
	}
	return { ok: true };
}

// ---------------------------------------------------------------------------
// Entry points

const idOf = (deps: GameDeps, code: string) => gameIdByCode(deps.db, code);

export const ready = async (deps: GameDeps, userId: string, code: string) =>
	readyCore(deps, await idOf(deps, code), byUser(userId));
export const answerPact = async (
	deps: GameDeps,
	userId: string,
	code: string,
	accept: boolean,
) => answerPactCore(deps, await idOf(deps, code), byUser(userId), accept);
export const play = async (
	deps: GameDeps,
	userId: string,
	code: string,
	cardIds: string[],
) => playCore(deps, await idOf(deps, code), byUser(userId), cardIds);
export const act = async (
	deps: GameDeps,
	userId: string,
	code: string,
	input: ActionInput,
) => actCore(deps, await idOf(deps, code), byUser(userId), input);
export const vote = async (
	deps: GameDeps,
	userId: string,
	code: string,
	target: string | null,
) => voteCore(deps, await idOf(deps, code), byUser(userId), target);
export const chat = async (
	deps: GameDeps,
	userId: string,
	code: string,
	text: string,
	replyTo?: string | null,
) =>
	chatCore(
		deps,
		await idOf(deps, code),
		byUser(userId),
		text,
		undefined,
		replyTo,
	);

export const botReady = (deps: GameDeps, gameId: string, seatId: string) =>
	readyCore(deps, gameId, bySeat(seatId));
export const botAnswerPact = (
	deps: GameDeps,
	gameId: string,
	seatId: string,
	accept: boolean,
) => answerPactCore(deps, gameId, bySeat(seatId), accept);
export const botPlay = (
	deps: GameDeps,
	gameId: string,
	seatId: string,
	cardIds: string[],
) => playCore(deps, gameId, bySeat(seatId), cardIds);
export const botAct = (
	deps: GameDeps,
	gameId: string,
	seatId: string,
	input: ActionInput,
) => actCore(deps, gameId, bySeat(seatId), input);
export const botVote = (
	deps: GameDeps,
	gameId: string,
	seatId: string,
	target: string | null,
) => voteCore(deps, gameId, bySeat(seatId), target);
export const botChat = (
	deps: GameDeps,
	gameId: string,
	seatId: string,
	text: string,
	id: string,
	replyTo?: string | null,
) => chatCore(deps, gameId, bySeat(seatId), text, id, replyTo);
