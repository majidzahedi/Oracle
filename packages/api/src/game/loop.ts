import { votes } from "@oracle/db/schema/game";
import {
	allActed,
	applyPact,
	applyVotes,
	favoredPlayer,
	finalChoice,
	type GameState,
	offerPact,
	type Phase,
	playCards,
	QUARANTINE_VOTES,
	recordMessage,
	resolveRound,
	startAction,
	startDay,
	startNight,
} from "@oracle/engine";
import {
	scriptedMercy,
	scriptedNightMessages,
	scriptedPactOffer,
	scriptedWhisper,
} from "@oracle/oracle";

import { everyoneReady } from "./actions";
import { botAnswersPact, botPlay, botVote } from "./bots";
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

/** Night: refill hands, draw the threat, maybe offer the Pact, send every private message. */
export async function openNight(
	deps: GameDeps,
	gameId: string,
	round: number,
	d: PhaseDurations,
) {
	await mutateGame(deps.db, gameId, async (state, ctx) => {
		if (state.round >= round || state.phase === "ended") return null;
		let s = startNight(state);
		const offer = scriptedPactOffer(s);
		if (offer) s = offerPact(s, offer);
		for (const msg of scriptedNightMessages(
			s,
			names(ctx.seats),
			ctx.game.language,
		)) {
			s = recordMessage(s, msg).state;
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
		let s = resolveRound(state);
		const nm = names(ctx.seats);
		if (s.whisperPending)
			s = recordMessage(s, scriptedWhisper(s, nm, ctx.game.language)).state;
		const favored = favoredPlayer(s);
		if (favored)
			s = recordMessage(s, scriptedMercy(favored, nm, ctx.game.language)).state;
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
