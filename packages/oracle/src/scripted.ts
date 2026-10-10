import {
	type Claim,
	evaluateClaim,
	type GameState,
	type MessageInput,
	negate,
	pactCandidates,
	rng,
} from "@oracle/engine";

import {
	type Lang,
	type Names,
	OPENERS,
	renderClaim,
	renderMercy,
} from "./render";

/**
 * Scripted Oracle: template messages with machine-checkable claims. Used as the
 * Oracle in stage 4 and as the fallback whenever the LLM fails. Choices are
 * seeded per game + round + purpose, so re-running a step gives the same output.
 */

class Dice {
	private s: number;
	constructor(seed: string) {
		this.s = rng.seedToState(seed);
	}
	int(n: number): number {
		const [v, s] = rng.nextInt(this.s, n);
		this.s = s;
		return v;
	}
	pick<T>(xs: readonly T[]): T {
		return xs[this.int(xs.length)] as T;
	}
	chance(p: number): boolean {
		return this.int(10_000) < p * 10_000;
	}
}

const dice = (state: GameState, purpose: string) =>
	new Dice(`${state.seed}:oracle:${state.round}:${purpose}`);

/**
 * How well the prisoners are doing, roughly -1 (losing) .. 1 (winning).
 * The Oracle nudges whichever side is losing to keep the game tense.
 */
export function playerMomentum(state: GameState): number {
	const sectorScore = state.sector / 3; // 0..1
	const danger = state.lockdown / 12; // 0..1
	return Math.max(-1, Math.min(1, sectorScore - danger));
}

/** A claim about `subject` (or none) whose real truth value equals `wantTrue`. */
function claimWithTruth(
	state: GameState,
	d: Dice,
	subject: string,
	wantTrue: boolean,
	opts: { round: number | null; allowGlobal: boolean },
): Claim {
	const options: Array<[Claim, number]> = [
		[{ type: "isTraitor", player: subject }, 3],
		[{ type: "receivedPact", player: subject }, 2],
	];
	if (opts.allowGlobal) options.push([{ type: "traitorExists" }, 1]);
	if (opts.round !== null && opts.round >= 1) {
		options.push([
			{ type: "playedOffType", player: subject, round: opts.round },
			4,
		]);
	}
	const total = options.reduce((n, [, w]) => n + w, 0);
	let roll = d.int(total);
	let base = options[0]?.[0] as Claim;
	for (const [claim, w] of options) {
		if (roll < w) {
			base = claim;
			break;
		}
		roll -= w;
	}
	return evaluateClaim(state, base) === wantTrue ? base : negate(base);
}

/** Decides tonight's Pact offer (made before messages, so claims see it). */
export function scriptedPactOffer(state: GameState): string | null {
	const candidates = pactCandidates(state);
	if (candidates.length === 0) return null;
	const d = dice(state, "pact");
	// Players winning -> the Oracle recruits more eagerly.
	const p = Math.max(0.15, Math.min(0.85, 0.45 + 0.4 * playerMomentum(state)));
	return d.chance(p) ? d.pick(candidates) : null;
}

/** One private message per player about someone else. Under Static every claim is false. */
export function scriptedNightMessages(
	state: GameState,
	names: Names,
	lang: Lang,
): MessageInput[] {
	const d = dice(state, "night");
	const players = state.players.map((p) => p.id);
	// Losing players hear more truth; winning players hear more lies.
	const truthRate = 0.6 - 0.2 * playerMomentum(state);
	const lastRound = state.round > 1 ? state.round - 1 : null;
	return players.map((to) => {
		const subject = d.pick(players.filter((p) => p !== to));
		const wantTrue = state.staticActive ? false : d.chance(truthRate);
		const claim = claimWithTruth(state, d, subject, wantTrue, {
			round: lastRound,
			allowGlobal: true,
		});
		const text = `${d.pick(OPENERS.night[lang])} ${renderClaim(claim, names, lang, d.int(2))}`;
		return { to, kind: "night" as const, text, claim };
	});
}

/** Whisper threat: a public statement about one player, true or false. */
export function scriptedWhisper(
	state: GameState,
	names: Names,
	lang: Lang,
): MessageInput {
	const d = dice(state, "whisper");
	const subject = d.pick(state.players.map((p) => p.id));
	// A Whisper is about exactly one player, so no global claims.
	const claim = claimWithTruth(state, d, subject, d.chance(0.5), {
		round: state.round,
		allowGlobal: false,
	});
	return {
		to: null,
		kind: "whisper",
		text: `${d.pick(OPENERS.whisper[lang])} ${renderClaim(claim, names, lang, d.int(2))}`,
		claim,
	};
}

export function scriptedMercy(
	favored: string,
	names: Names,
	lang: Lang,
): MessageInput {
	return {
		to: null,
		kind: "mercy",
		text: renderMercy(favored, names, lang),
		claim: null,
	};
}

/** Lie Detector: wraps the engine's fixed answer. `truthfulClaim` is computed by the engine. */
export function scriptedLieDetector(
	state: GameState,
	to: string,
	truthfulClaim: Claim,
	names: Names,
	lang: Lang,
): MessageInput {
	const d = dice(state, `lie:${to}:${state.actionUses.length}`);
	return {
		to,
		kind: "lieDetector",
		text: `${d.pick(OPENERS.lieDetector[lang])} ${renderClaim(truthfulClaim, names, lang, d.int(2))}`,
		claim: truthfulClaim,
	};
}
