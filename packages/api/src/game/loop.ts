import { votes } from "@oracle/db/schema/game";
import {
	allActed,
	applyPact,
	applyVotes,
	favoredPlayer,
	finalChoice,
	type GameState,
	type MessageInput,
	offerPact,
	type Phase,
	pactCandidates,
	playCards,
	QUARANTINE_VOTES,
	recordMessage,
	resolveRound,
	startAction,
	startDay,
	startNight,
	validateMessage,
} from "@oracle/engine";
import {
	oracleMercy,
	oracleNight,
	oracleWhisper,
	scriptedMercy,
	scriptedNightMessages,
	scriptedWhisper,
} from "@oracle/oracle";

import { logOracleCall } from "../llm/profiles";

import { everyoneReady } from "./actions";
import { botAnswersPact, botPlay, botVote } from "./bots";
import { oracleFor } from "./oracle";
import { type GameDeps, publishGame } from "./publish";
import {
	enginePlayerId,
	loadGame,
	type MutateCtx,
	mutateGame,
	readyKey,
	type SeatRow,
	setReady,
} from "./store";
import { currentVotes, names, voteKind } from "./views";

/**
 * Step bodies for the Inngest game loop. Every function is idempotent: it checks
 * the stored round/phase before changing anything, so a step that re-runs after
 * a crash (committed but not yet memoized) is a no-op instead of a double move.
 */

export type PhaseDurations = {
	night: number;
	day: number;
	action: number;
	vote: number;
	final: number;
};

export type PhaseStatus = {
	round: number;
	phase: Phase;
	/** ISO deadline of the current phase. */
	deadline: string | null;
	/** Everyone already acted: no need to wait. */
	complete: boolean;
};

const inSeconds = (s: number) => new Date(Date.now() + s * 1000);
const bots = (seats: SeatRow[]) => seats.filter((s) => s.isBot);

export async function phaseStatus(
	deps: GameDeps,
	gameId: string,
): Promise<PhaseStatus> {
	const { game, seats } = await loadGame(deps.db, gameId);
	const state = game.state;
	let complete = false;
	if (state.phase === "night" || state.phase === "day")
		complete = everyoneReady(state, seats);
	else if (state.phase === "action") complete = allActed(state);
	else if (state.phase === "vote" || state.phase === "final") {
		const voted = await currentVotes(deps.db, game, seats);
		complete = seats.every((s) => enginePlayerId(s.seat) in voted);
	}
	return {
		round: state.round,
		phase: state.phase,
		deadline: game.phaseDeadline?.toISOString() ?? null,
		complete,
	};
}

async function finishStep(
	deps: GameDeps,
	gameId: string,
): Promise<PhaseStatus> {
	await publishGame(deps, gameId);
	return phaseStatus(deps, gameId);
}

async function markBotsReady(ctx: MutateCtx, state: GameState) {
	await setReady(
		ctx.tx,
		ctx.game.id,
		bots(ctx.seats).map((s) => s.id),
		readyKey(state),
	);
}

/**
 * Night, engine part: refill hands, activate Static, secretly draw the threat.
 * The Oracle speaks in the next step (`oracleSpeaksAtNight`), outside any lock;
 * the night timer starts once it has spoken.
 */
export async function openNight(deps: GameDeps, gameId: string, round: number) {
	await mutateGame(deps.db, gameId, async (state, ctx) => {
		if (state.round >= round || state.phase === "ended") return null;
		const s = startNight(state);
		await markBotsReady(ctx, s);
		return { state: s, result: null, deadline: null };
	});
	return finishStep(deps, gameId);
}

/**
 * Night, Oracle part: Pact decision + one private message per player (LLM or
 * scripted). Idempotent: once this round's night messages exist it does nothing,
 * so a re-run never calls the model again.
 */
export async function oracleSpeaksAtNight(
	deps: GameDeps,
	gameId: string,
	round: number,
	d: PhaseDurations,
) {
	const { game, seats } = await loadGame(deps.db, gameId);
	const spoken = (s: GameState) =>
		s.messages.some((m) => m.kind === "night" && m.round === round);
	if (
		game.state.round !== round ||
		game.state.phase !== "night" ||
		spoken(game.state)
	)
		return finishStep(deps, gameId);

	const oracle = await oracleFor(deps, game, seats);
	const plan = await oracleNight(oracle.ctx, game.state);
	await logOracleCall(deps.db, {
		gameId,
		round,
		profileId: oracle.profileId,
		report: plan.report,
	});

	await mutateGame(deps.db, gameId, async (state, ctx) => {
		if (state.round !== round || state.phase !== "night" || spoken(state))
			return null;
		let s = state;
		const offer =
			plan.pactOffer && pactCandidates(s).includes(plan.pactOffer)
				? plan.pactOffer
				: null;
		if (offer) s = offerPact(s, offer);
		const fallback = scriptedNightMessages(
			s,
			names(ctx.seats),
			ctx.game.language,
		);
		for (const msg of plan.messages) {
			// Re-checked under the lock; anything invalid now is replaced by the scripted line.
			const ok = !validateMessage(s, msg);
			s = recordMessage(
				s,
				ok ? msg : (fallback.find((f) => f.to === msg.to) as MessageInput),
			).state;
		}
		for (const bot of bots(ctx.seats)) {
			const id = enginePlayerId(bot.seat);
			if (offer === id) s = applyPact(s, id, botAnswersPact(s, id));
		}
		await markBotsReady(ctx, s);
		return { state: s, result: null, deadline: inSeconds(d.night) };
	});
	return finishStep(deps, gameId);
}

export async function openDay(
	deps: GameDeps,
	gameId: string,
	round: number,
	d: PhaseDurations,
) {
	await mutateGame(deps.db, gameId, async (state, ctx) => {
		if (state.round !== round || state.phase !== "night") return null;
		const s = startDay(state); // unanswered Pact = refused
		await markBotsReady(ctx, s);
		return { state: s, result: null, deadline: inSeconds(d.day) };
	});
	return finishStep(deps, gameId);
}

export async function openAction(
	deps: GameDeps,
	gameId: string,
	round: number,
	d: PhaseDurations,
) {
	await mutateGame(deps.db, gameId, (state, ctx) => {
		if (state.round !== round || state.phase !== "day") return null;
		let s = startAction(state);
		for (const bot of bots(ctx.seats)) {
			const id = enginePlayerId(bot.seat);
			if (s.players.find((p) => p.id === id)?.quarantined) continue;
			s = playCards(s, id, botPlay(s, id));
		}
		return { state: s, result: null, deadline: inSeconds(d.action) };
	});
	return finishStep(deps, gameId);
}

async function castBotVotes(ctx: MutateCtx, state: GameState) {
	const rows = bots(ctx.seats).map((b) => {
		const target = botVote(state, enginePlayerId(b.seat));
		return {
			gameId: ctx.game.id,
			round: state.round,
			kind: voteKind(state),
			voterId: b.id,
			targetId: target
				? (ctx.seats.find((s) => enginePlayerId(s.seat) === target)?.id ?? null)
				: null,
		};
	});
	if (rows.length > 0)
		await ctx.tx.insert(votes).values(rows).onConflictDoNothing();
}

/** Reveal the pile, resolve the lock and the threat (idle players auto-play), then open the vote or final choice. */
export async function resolve(
	deps: GameDeps,
	gameId: string,
	round: number,
	d: PhaseDurations,
) {
	await mutateGame(deps.db, gameId, async (state, ctx) => {
		if (state.round !== round || state.phase !== "action") return null;
		// Whisper/Mercy statements are spoken in the next step (oracleSpeaksInPublic).
		const s = resolveRound(state);
		if (s.phase === "ended") return { state: s, result: null, deadline: null };
		await castBotVotes(ctx, s);
		return {
			state: s,
			result: null,
			deadline: inSeconds(s.phase === "final" ? d.final : d.vote),
		};
	});
	return finishStep(deps, gameId);
}

/** Applies quarantine votes (missing votes = abstain). */
export async function closeVotes(
	deps: GameDeps,
	gameId: string,
	round: number,
) {
	await mutateGame(deps.db, gameId, async (state, ctx) => {
		if (state.round !== round || state.phase !== "vote") return null;
		if (state.feed.some((f) => f.kind === "quarantine" && f.round === round))
			return null;
		const voted = await currentVotes(ctx.tx, ctx.game, ctx.seats);
		return { state: applyVotes(state, voted), result: null, deadline: null };
	});
	return finishStep(deps, gameId);
}

/** Who to leave behind: a player needs 3 of 4 votes, otherwise nobody is left. */
export function tallyFinal(
	voted: Record<string, string | null>,
): string | null {
	const counts = new Map<string, number>();
	for (const t of Object.values(voted))
		if (t) counts.set(t, (counts.get(t) ?? 0) + 1);
	for (const [t, n] of counts) if (n >= QUARANTINE_VOTES) return t;
	return null;
}

export async function finish(deps: GameDeps, gameId: string, round: number) {
	await mutateGame(deps.db, gameId, async (state, ctx) => {
		if (state.round !== round || state.phase !== "final") return null;
		const voted = await currentVotes(ctx.tx, ctx.game, ctx.seats);
		return {
			state: finalChoice(state, tallyFinal(voted)),
			result: null,
			deadline: null,
		};
	});
	return finishStep(deps, gameId);
}

/**
 * After the reveal: the Oracle's public statements for Whisper and Mercy.
 * Idempotent: Whisper clears `whisperPending`; Mercy is skipped once spoken.
 */
export async function oracleSpeaksInPublic(
	deps: GameDeps,
	gameId: string,
	round: number,
) {
	const { game, seats } = await loadGame(deps.db, gameId);
	const state = game.state;
	const mercySpoken = (s: GameState) =>
		s.messages.some((m) => m.kind === "mercy" && m.round === round);
	const favored = favoredPlayer(state);
	const needWhisper = state.round === round && state.whisperPending;
	const needMercy =
		state.round === round && favored !== null && !mercySpoken(state);
	if (!needWhisper && !needMercy) return finishStep(deps, gameId);

	const oracle = await oracleFor(deps, game, seats);
	const said: MessageInput[] = [];
	if (needWhisper) {
		const w = await oracleWhisper(oracle.ctx, state);
		await logOracleCall(deps.db, {
			gameId,
			round,
			profileId: oracle.profileId,
			report: w.report,
		});
		said.push(w.message);
	}
	if (needMercy && favored) {
		const m = await oracleMercy(oracle.ctx, state, favored);
		await logOracleCall(deps.db, {
			gameId,
			round,
			profileId: oracle.profileId,
			report: m.report,
		});
		said.push(m.message);
	}

	await mutateGame(deps.db, gameId, (s, ctx) => {
		if (s.round !== round) return null;
		let next = s;
		for (const msg of said) {
			if (msg.kind === "whisper" && !next.whisperPending) continue;
			if (msg.kind === "mercy" && mercySpoken(next)) continue;
			const ok = !validateMessage(next, msg);
			const fallback =
				msg.kind === "whisper"
					? scriptedWhisper(next, names(ctx.seats), ctx.game.language)
					: scriptedMercy(
							favored as string,
							names(ctx.seats),
							ctx.game.language,
						);
			next = recordMessage(next, ok ? msg : fallback).state;
		}
		return next === s ? null : { state: next, result: null };
	});
	return finishStep(deps, gameId);
}
