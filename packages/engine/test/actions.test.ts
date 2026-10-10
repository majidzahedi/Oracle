import { describe, expect, it } from "vitest";

import {
	applyPact,
	applyVotes,
	type Claim,
	EngineError,
	evaluateClaim,
	type GameState,
	offerPact,
	playCards,
	recordMessage,
	resolveRound,
	startAction,
	startDay,
	startNight,
	useAction,
	validateMessage,
} from "../src";
import {
	action,
	cardIds,
	newGame,
	night,
	P,
	setHand,
	toAction,
	tool,
} from "./helpers";

function dayWith(
	cards: ReturnType<typeof action>[],
	base?: GameState,
	player = "p1",
): GameState {
	return setHand(startDay(base ?? night()), player, cards);
}

describe("action cards: general", () => {
	it("must be in the player's hand", () => {
		expect(() => useAction(dayWith([]), "p1", { action: "shield" })).toThrow(
			/CARD_NOT_IN_HAND/,
		);
	});

	it("is discarded after use and announced without its target", () => {
		const s = dayWith([action("decoder")]);
		const { state } = useAction(s, "p1", { action: "decoder", target: "p2" });
		expect(cardIds(state, "p1")).toHaveLength(0);
		expect(state.discard.at(-1)?.kind).toBe("action");
		expect(state.feed.at(-1)).toEqual({
			round: 1,
			kind: "actionUsed",
			player: "p1",
			action: "decoder",
		});
	});

	it("day cards cannot be used at night or during the action phase", () => {
		const n = setHand(night(), "p1", [action("override")]);
		expect(() => useAction(n, "p1", { action: "override" })).toThrow(
			/WRONG_PHASE/,
		);
		const a = toAction(n);
		expect(() => useAction(a, "p1", { action: "override" })).toThrow(
			/WRONG_PHASE/,
		);
	});
});

describe("Decoder", () => {
	it("secretly reads another player's night message", () => {
		const { state } = recordMessage(night(), {
			to: "p2",
			kind: "night",
			text: "Do not trust p3.",
			claim: { type: "isTraitor", player: "p3" },
		});
		const { result } = useAction(dayWith([action("decoder")], state), "p1", {
			action: "decoder",
			target: "p2",
		});
		expect(result).toEqual({
			action: "decoder",
			target: "p2",
			message: "Do not trust p3.",
		});
	});

	it("returns null when the target got no message, and cannot target yourself", () => {
		const s = dayWith([action("decoder")]);
		expect(
			useAction(s, "p1", { action: "decoder", target: "p3" }).result,
		).toMatchObject({
			message: null,
		});
		expect(() =>
			useAction(s, "p1", { action: "decoder", target: "p1" }),
		).toThrow(/DECODER_SELF/);
	});
});

describe("Lie Detector", () => {
	function withTraitor(): GameState {
		let s = night();
		s = startNight(applyVotes(resolveRound(toAction(s)), {}));
		return applyPact(offerPact(s, "p3"), "p3", true);
	}

	it("answers every template truthfully", () => {
		const base = withTraitor();
		const questions: Claim[] = [
			...P.map((p) => ({ type: "isTraitor" as const, player: p })),
			...P.map((p) => ({ type: "receivedPact" as const, player: p })),
			...P.map((p) => ({
				type: "playedOffType" as const,
				player: p,
				round: 1,
			})),
			{ type: "traitorExists" },
			{ type: "noTraitorYet" },
		];
		for (const q of questions) {
			const s = dayWith([action("lieDetector")], base, "p1");
			const { result } = useAction(s, "p1", {
				action: "lieDetector",
				claim: q,
			});
			if (result.action !== "lieDetector") throw new Error();
			expect(result.answer).toBe(evaluateClaim(base, q));
		}
		const s = dayWith([action("lieDetector")], base);
		expect(
			useAction(s, "p1", {
				action: "lieDetector",
				claim: { type: "isTraitor", player: "p3" },
			}).result,
		).toMatchObject({ answer: true });
	});

	it("the Oracle's wording must state the true answer", () => {
		const s = dayWith([action("lieDetector")], withTraitor());
		const { state, result } = useAction(s, "p1", {
			action: "lieDetector",
			claim: { type: "isTraitor", player: "p2" },
		});
		if (result.action !== "lieDetector") throw new Error();
		expect(result.answer).toBe(false);
		expect(
			validateMessage(state, {
				to: "p1",
				kind: "lieDetector",
				text: "Yes.",
				claim: result.claim,
			}),
		).toBe("LIE_DETECTOR_MUST_BE_TRUE");
		const rec = recordMessage(state, {
			to: "p1",
			kind: "lieDetector",
			text: "No, little one.",
			claim: result.truthfulClaim,
		});
		expect(rec.message.truth).toBe(true);
	});
});

describe("Shield", () => {
	it("cancels this round's threat", () => {
		let s = dayWith([action("shield")], night(newGame(), "powerSurge"));
		s = useAction(s, "p1", { action: "shield" }).state;
		s = resolveRound(toActionFromDay(s));
		// Lock failed (+2) but the Power Surge (+2) was cancelled.
		expect(s.lockdown).toBe(2);
		expect(s.threats).toEqual([
			{ round: 1, threat: "powerSurge", shielded: true },
		]);
		expect(s.feed).toContainEqual({
			round: 1,
			kind: "threat",
			announced: "shielded",
		});
	});
});

describe("Override", () => {
	it("lowers Lockdown by 2, never below 0", () => {
		let s = {
			...dayWith([action("override"), action("override")]),
			lockdown: 3,
		};
		s = useAction(s, "p1", { action: "override" }).state;
		expect(s.lockdown).toBe(1);
		s = useAction(s, "p1", { action: "override" }).state;
		expect(s.lockdown).toBe(0);
	});
});

describe("Scanner", () => {
	it("after the reveal, learns who played one specific card", () => {
		let s = night();
		s = setHand(s, "p1", [tool("power", 5)]);
		s = setHand(s, "p2", [tool("force", 4), action("scanner")]);
		s = setHand(s, "p3", []);
		s = setHand(s, "p4", []);
		s = toAction(s);
		expect(() =>
			useAction(s, "p2", { action: "scanner", pileIndex: 0 }),
		).toThrow(/WRONG_PHASE/);
		s = playAll(s, {
			p1: cardIds(s, "p1"),
			p2: [cardIds(s, "p2")[0] as string],
		});
		s = resolveRound(s);
		expect(s.phase).toBe("vote");
		const force = s.plays.find((p) => p.card.type === "force");
		const { result } = useAction(s, "p2", {
			action: "scanner",
			pileIndex: force?.pileIndex ?? -1,
		});
		expect(result).toMatchObject({
			action: "scanner",
			owner: "p2",
			card: { type: "force", value: 4 },
		});
	});

	it("rejects a pile index that does not exist", () => {
		let s = night();
		for (const p of P) s = setHand(s, p, []);
		s = setHand(s, "p1", [action("scanner")]);
		s = resolveRound(toAction(s));
		expect(() =>
			useAction(s, "p1", { action: "scanner", pileIndex: 0 }),
		).toThrow(EngineError);
	});
});

// --- local helpers

function toActionFromDay(s: GameState): GameState {
	return startAction(s);
}

function playAll(s: GameState, plays: Record<string, string[]>): GameState {
	let out = s;
	for (const [p, ids] of Object.entries(plays)) out = playCards(out, p, ids);
	return out;
}
