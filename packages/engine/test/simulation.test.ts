import { describe, expect, it } from "vitest";

import {
	applyPact,
	applyVotes,
	type Claim,
	deal,
	evaluateClaim,
	favoredPlayer,
	finalChoice,
	type GameState,
	MAX_LOCKDOWN,
	offerPact,
	pactCandidates,
	playCards,
	recordMessage,
	resolveRound,
	revealLog,
	rng,
	startAction,
	startDay,
	startNight,
	type ToolCard,
	useAction,
} from "../src";
import { P, totalCards } from "./helpers";

/** Random-but-seeded decision maker standing in for players and the Oracle. */
class Chooser {
	constructor(private s: number) {}
	int(n: number): number {
		const [v, s] = rng.nextInt(this.s, n);
		this.s = s;
		return v;
	}
	pick<T>(xs: readonly T[]): T {
		return xs[this.int(xs.length)] as T;
	}
	chance(p: number): boolean {
		return this.int(1000) < p * 1000;
	}
}

function randomClaim(c: Chooser, about: string[], round: number): Claim {
	const player = c.pick(about);
	const claims: Claim[] = [
		{ type: "isTraitor", player },
		{ type: "receivedPact", player },
		{ type: "traitorExists" },
		{ type: "noTraitorYet" },
	];
	if (round > 1)
		claims.push({ type: "playedOffType", player, round: round - 1 });
	const claim = c.pick(claims);
	return c.chance(0.3) ? { type: "not", claim } : claim;
}

function check(s: GameState): void {
	expect(totalCards(s)).toBe(60);
	expect(s.lockdown).toBeGreaterThanOrEqual(0);
	expect(s.lockdown).toBeLessThanOrEqual(MAX_LOCKDOWN);
	expect(
		s.players.filter((p) => p.role === "traitor").length,
	).toBeLessThanOrEqual(1);
	for (const p of s.players) expect(p.hand.length).toBeLessThanOrEqual(5);
}

function playGame(seed: string): {
	state: GameState;
	lieDetectorChecks: number;
} {
	const c = new Chooser(rng.seedToState(`driver-${seed}`));
	let s = deal({ seed, playerIds: [...P] });
	let lieDetectorChecks = 0;
	check(s);

	while (s.phase !== "ended") {
		if (s.round > 60) throw new Error("game did not end");
		// --- night
		s = startNight(s);
		check(s);
		const candidates = pactCandidates(s);
		if (candidates.length > 0 && c.chance(0.5)) {
			const target = c.pick(candidates);
			s = offerPact(s, target);
			expect(pactCandidates(s)).toEqual([]);
			if (c.chance(0.6)) s = applyPact(s, target, c.chance(0.5));
		}
		for (const to of P) {
			const others = P.filter((p) => p !== to);
			for (let attempt = 0; attempt < 20; attempt++) {
				const claim = randomClaim(c, others, s.round);
				if (s.staticActive && evaluateClaim(s, claim)) continue;
				const rec = recordMessage(s, { to, kind: "night", text: "...", claim });
				if (s.staticActive) expect(rec.message.truth).toBe(false);
				s = rec.state;
				break;
			}
		}
		// --- day
		s = startDay(s);
		for (const p of P) {
			const card = s.players
				.find((x) => x.id === p)
				?.hand.find((h) => h.kind === "action");
			if (
				card?.kind !== "action" ||
				card.action === "scanner" ||
				!c.chance(0.5)
			)
				continue;
			if (card.action === "lieDetector") {
				const claim = randomClaim(c, [...P], s.round);
				const { state, result } = useAction(s, p, {
					action: "lieDetector",
					claim,
				});
				if (result.action !== "lieDetector") throw new Error();
				expect(result.answer).toBe(evaluateClaim(s, claim));
				lieDetectorChecks++;
				s = recordMessage(state, {
					to: p,
					kind: "lieDetector",
					text: "...",
					claim: result.truthfulClaim,
				}).state;
			} else if (card.action === "decoder") {
				s = useAction(s, p, {
					action: "decoder",
					target: c.pick(P.filter((x) => x !== p)),
				}).state;
			} else {
				s = useAction(s, p, { action: card.action }).state;
			}
		}
		// --- action
		s = startAction(s);
		for (const p of P) {
			const me = s.players.find((x) => x.id === p);
			if (!me || me.quarantined || c.chance(0.15)) continue; // some players idle -> auto-play
			const tools = me.hand.filter((h): h is ToolCard => h.kind === "tool");
			const n = Math.min(tools.length, 1 + c.int(2));
			const chosen: string[] = [];
			while (chosen.length < n) {
				const t = c.pick(tools);
				if (!chosen.includes(t.id)) chosen.push(t.id);
			}
			s = playCards(s, p, chosen);
		}
		check(s);
		// --- resolution
		s = resolveRound(s);
		check(s);
		if (s.phase === "ended") break;
		if (s.whisperPending) {
			s = recordMessage(s, {
				to: null,
				kind: "whisper",
				text: "...",
				claim: { type: "isTraitor", player: c.pick(P) },
			}).state;
		}
		const favored = favoredPlayer(s);
		if (favored)
			s = recordMessage(s, {
				to: null,
				kind: "mercy",
				text: `${favored} earned my favor`,
				claim: null,
			}).state;
		if (s.phase === "final") {
			s = finalChoice(s, c.chance(0.5) ? null : c.pick(P));
			break;
		}
		// --- vote
		const votes: Record<string, string | null> = {};
		for (const p of P)
			votes[p] = c.chance(0.4) ? c.pick(P.filter((x) => x !== p)) : null;
		s = applyVotes(s, votes);
	}
	return { state: s, lieDetectorChecks };
}

describe("full-game simulation", { timeout: 60_000 }, () => {
	const seeds = Array.from({ length: 200 }, (_, i) => `sim-${i}`);

	it("every game ends with invariants intact", () => {
		let lieChecks = 0;
		const kinds = new Set<string>();
		for (const seed of seeds) {
			const { state, lieDetectorChecks } = playGame(seed);
			lieChecks += lieDetectorChecks;
			expect(state.phase).toBe("ended");
			expect(state.outcome).not.toBeNull();
			const o = state.outcome;
			kinds.add(o?.kind === "escaped" ? o.escape : "sealed");
			const log = revealLog(state);
			for (const m of log.messages) {
				// Off-type plays are fixed once made, so the logged truth must still hold at the end.
				const inner = m.claim?.type === "not" ? m.claim.claim : m.claim;
				if (m.claim && inner?.type === "playedOffType") {
					expect(m.truth).toBe(evaluateClaim(state, m.claim));
				}
				if (m.kind === "lieDetector") expect(m.truth).toBe(true);
			}
			// At most one pact offer per night.
			const perRound = new Map<number, number>();
			for (const o of log.pactOffers)
				perRound.set(o.round, (perRound.get(o.round) ?? 0) + 1);
			for (const n of perRound.values()) expect(n).toBe(1);
		}
		expect(lieChecks).toBeGreaterThan(50);
		expect(kinds.has("sealed")).toBe(true);
		expect(kinds.size).toBeGreaterThan(1);
	});

	it("is reproducible: same seed and same inputs give the same game", () => {
		for (const seed of seeds.slice(0, 20)) {
			expect(playGame(seed).state).toEqual(playGame(seed).state);
		}
	});
});
