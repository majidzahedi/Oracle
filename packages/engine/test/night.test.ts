import { describe, expect, it } from "vitest";

import {
	applyPact,
	applyVotes,
	EngineError,
	evaluateClaim,
	type GameState,
	offerPact,
	pactCandidates,
	pendingPact,
	recordMessage,
	resolveRound,
	startDay,
	startNight,
	validateMessage,
} from "../src";
import { newGame, night, toAction } from "./helpers";

/** Plays a whole round with nobody acting, ending in the vote phase. */
function skipRound(s: GameState): GameState {
	const r = resolveRound(toAction(s));
	return startNight(applyVotes(r, {}));
}

function round2(): GameState {
	return skipRound(night(newGame(), "jam"));
}

describe("night", () => {
	it("starts a round and secretly draws a threat", () => {
		const s = startNight(newGame());
		expect(s.round).toBe(1);
		expect(s.phase).toBe("night");
		expect(s.currentThreat).not.toBeNull();
		expect(s.threatDeck).toHaveLength(9);
	});

	it("cannot start a night mid-round", () => {
		expect(() => startNight(startNight(newGame()))).toThrow(EngineError);
	});
});

describe("pact", () => {
	it("cannot be offered on night 1", () => {
		const s = night();
		expect(pactCandidates(s)).toEqual([]);
		expect(() => offerPact(s, "p1")).toThrow(/PACT_TOO_EARLY/);
	});

	it("can be offered from night 2, at most once per night", () => {
		let s = round2();
		expect(s.round).toBe(2);
		expect(pactCandidates(s)).toHaveLength(4);
		s = offerPact(s, "p2");
		expect(pendingPact(s)).toBe("p2");
		expect(pactCandidates(s)).toEqual([]);
		expect(() => offerPact(s, "p3")).toThrow(/PACT_ALREADY_OFFERED/);
	});

	it("accepting makes that player the traitor", () => {
		let s = offerPact(round2(), "p2");
		s = applyPact(s, "p2", true);
		expect(s.traitorId).toBe("p2");
		expect(s.players.find((p) => p.id === "p2")?.role).toBe("traitor");
		expect(s.pactOffers).toEqual([{ round: 2, player: "p2", accepted: true }]);
	});

	it("allows at most one traitor per game", () => {
		let s = applyPact(offerPact(round2(), "p2"), "p2", true);
		s = skipRound(s);
		expect(pactCandidates(s)).toEqual([]);
		expect(() => offerPact(s, "p3")).toThrow(/TRAITOR_EXISTS/);
	});

	it("a refused offer can go to another player on a later night, not to the refuser", () => {
		let s = applyPact(offerPact(round2(), "p2"), "p2", false);
		expect(s.traitorId).toBeNull();
		s = skipRound(s);
		expect(pactCandidates(s)).toEqual(["p1", "p3", "p4"]);
		expect(() => offerPact(s, "p2")).toThrow(/PACT_ALREADY_REFUSED/);
		s = applyPact(offerPact(s, "p3"), "p3", true);
		expect(s.traitorId).toBe("p3");
	});

	it("an unanswered offer is refused when day starts", () => {
		const s = startDay(offerPact(round2(), "p1"));
		expect(s.pactOffers[0]?.accepted).toBe(false);
		expect(s.traitorId).toBeNull();
	});

	it("cannot answer an offer that was not made", () => {
		expect(() => applyPact(round2(), "p1", true)).toThrow(/NO_PENDING_PACT/);
	});
});

describe("night messages", () => {
	it("records the real truth value of the claim", () => {
		let s = applyPact(offerPact(round2(), "p2"), "p2", true);
		const t = recordMessage(s, {
			to: "p1",
			kind: "night",
			text: "p2 serves me.",
			claim: { type: "isTraitor", player: "p2" },
		});
		expect(t.message.truth).toBe(true);
		s = t.state;
		const f = recordMessage(s, {
			to: "p3",
			kind: "night",
			text: "p4 serves me.",
			claim: { type: "isTraitor", player: "p4" },
		});
		expect(f.message.truth).toBe(false);
	});

	it("must be about other players", () => {
		const s = night();
		expect(
			validateMessage(s, {
				to: "p1",
				kind: "night",
				text: "",
				claim: { type: "isTraitor", player: "p1" },
			}),
		).toBe("NIGHT_MESSAGE_ABOUT_SELF");
	});

	it("is one per player per night", () => {
		const msg = {
			to: "p1",
			kind: "night" as const,
			text: "",
			claim: { type: "noTraitorYet" as const },
		};
		const { state } = recordMessage(night(), msg);
		expect(() => recordMessage(state, msg)).toThrow(
			/NIGHT_MESSAGE_ALREADY_SENT/,
		);
	});

	it("requires a machine-checkable claim", () => {
		expect(
			validateMessage(night(), {
				to: "p1",
				kind: "night",
				text: "hi",
				claim: null,
			}),
		).toBe("CLAIM_REQUIRED");
	});

	it("rejects claims about unknown players", () => {
		expect(
			validateMessage(night(), {
				to: "p1",
				kind: "night",
				text: "",
				claim: { type: "isTraitor", player: "zz" },
			}),
		).toBe("UNKNOWN_PLAYER");
	});
});

describe("claims", () => {
	it("evaluates every claim type against real state", () => {
		let s = applyPact(offerPact(round2(), "p2"), "p2", true);
		expect(evaluateClaim(s, { type: "isTraitor", player: "p2" })).toBe(true);
		expect(evaluateClaim(s, { type: "isTraitor", player: "p1" })).toBe(false);
		expect(evaluateClaim(s, { type: "receivedPact", player: "p2" })).toBe(true);
		expect(evaluateClaim(s, { type: "receivedPact", player: "p3" })).toBe(
			false,
		);
		expect(evaluateClaim(s, { type: "traitorExists" })).toBe(true);
		expect(evaluateClaim(s, { type: "noTraitorYet" })).toBe(false);
		expect(
			evaluateClaim(s, {
				type: "not",
				claim: { type: "isTraitor", player: "p1" },
			}),
		).toBe(true);
		s = {
			...s,
			plays: [
				{
					round: 1,
					owner: "p3",
					card: { id: "x", kind: "tool", type: "force", value: 2 },
					offType: true,
					pileIndex: 0,
					auto: false,
				},
			],
		};
		expect(
			evaluateClaim(s, { type: "playedOffType", player: "p3", round: 1 }),
		).toBe(true);
		expect(() =>
			evaluateClaim(s, { type: "playedOffType", player: "p3", round: 2 }),
		).toThrow(/CLAIM_ABOUT_UNPLAYED_ROUND/);
		expect(
			evaluateClaim(s, { type: "playedOffType", player: "p4", round: 1 }),
		).toBe(false);
	});
});

describe("claims about rounds", () => {
	it("cannot claim anything about a round whose pile is not revealed yet", () => {
		const s = night();
		expect(
			validateMessage(s, {
				to: "p1",
				kind: "night",
				text: "",
				claim: { type: "playedOffType", player: "p2", round: 1 },
			}),
		).toBe("CLAIM_ABOUT_UNPLAYED_ROUND");
		const r2 = round2();
		expect(
			validateMessage(r2, {
				to: "p1",
				kind: "night",
				text: "",
				claim: { type: "playedOffType", player: "p2", round: 1 },
			}),
		).toBeNull();
	});
});
