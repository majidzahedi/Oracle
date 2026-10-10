import { describe, expect, it } from "vitest";

import {
	activePlayers,
	allActed,
	applyThreat,
	applyVotes,
	autoPlayIdle,
	EngineError,
	type GameState,
	lockTargets,
	playCards,
	recordMessage,
	resolveRound,
	startDay,
	startNight,
	type ThreatKind,
	validateMessage,
} from "../src";
import {
	action,
	actionWithHands,
	cardIds,
	newGame,
	night,
	P,
	setHand,
	setThreat,
	toAction,
	tool,
} from "./helpers";

/** Everyone with a hand plays all of it (max 2). */
function playHands(s: GameState): GameState {
	let out = s;
	for (const p of P) {
		const ids = cardIds(out, p);
		if (ids.length > 0 && !out.players.find((x) => x.id === p)?.quarantined) {
			out = playCards(out, p, ids);
		}
	}
	return out;
}

describe("action phase", () => {
	it("each player plays 1 or 2 tool cards", () => {
		const s = actionWithHands({
			p1: [tool("power", 1), tool("power", 2), tool("code", 3)],
		});
		const [a, b, c] = cardIds(s, "p1") as [string, string, string];
		expect(() => playCards(s, "p1", [])).toThrow(/BAD_CARD_COUNT/);
		expect(() => playCards(s, "p1", [a, b, c])).toThrow(/BAD_CARD_COUNT/);
		expect(playCards(s, "p1", [a]).plays).toHaveLength(1);
		expect(playCards(s, "p1", [a, b]).plays).toHaveLength(2);
	});

	it("cannot play action cards, cards not in hand, duplicates, or twice", () => {
		const s = actionWithHands({ p1: [action("shield"), tool("power", 1)] });
		const [shield, power] = cardIds(s, "p1") as [string, string];
		expect(() => playCards(s, "p1", [shield])).toThrow(/NOT_A_TOOL_CARD/);
		expect(() => playCards(s, "p1", ["nope"])).toThrow(/CARD_NOT_IN_HAND/);
		expect(() => playCards(s, "p1", [power, power])).toThrow(/DUPLICATE_CARD/);
		const after = playCards(s, "p1", [power]);
		expect(() => playCards(after, "p1", [])).toThrow(/ALREADY_PLAYED/);
	});

	it("a player with no tool cards plays nothing", () => {
		const s = actionWithHands({ p1: [action("shield")] });
		expect(playCards(s, "p1", []).actedThisRound).toContain("p1");
	});

	it("can only play during the action phase", () => {
		const s = setHand(startDay(night()), "p1", [tool("power", 1)]);
		expect(() => playCards(s, "p1", cardIds(s, "p1"))).toThrow(/WRONG_PHASE/);
	});

	it("flags off-type cards against the current lock", () => {
		let s = actionWithHands({ p1: [tool("force", 3), tool("power", 2)] });
		s = playCards(s, "p1", cardIds(s, "p1"));
		expect(s.plays.map((p) => [p.card.type, p.offType])).toEqual([
			["force", true],
			["power", false],
		]);
	});

	it("tracks who still has to act", () => {
		let s = actionWithHands({ p1: [tool("power", 1)], p2: [tool("power", 1)] });
		expect(allActed(s)).toBe(false);
		for (const p of P) s = playCards(s, p, cardIds(s, p));
		expect(allActed(s)).toBe(true);
	});

	it("on timeout, idle players auto-play their best matching card or nothing", () => {
		let s = actionWithHands({
			p1: [tool("power", 2), tool("power", 5), tool("force", 5)],
			p2: [tool("force", 5)],
			p3: [tool("code", 1)],
		});
		s = autoPlayIdle(s);
		expect(allActed(s)).toBe(true);
		expect(
			s.plays.map((p) => [p.owner, p.card.type, p.card.value, p.auto]),
		).toEqual([
			["p1", "power", 5, true],
			["p3", "code", 1, true],
		]);
	});
});

describe("resolution", () => {
	it("matching cards add to progress; progress carries across rounds", () => {
		let s = actionWithHands({ p1: [tool("power", 5)], p2: [tool("code", 2)] });
		s = resolveRound(playHands(s));
		expect(s.progress).toEqual({ power: 5, code: 2, force: 0 });
		expect(s.sector).toBe(0);
		s = actionWithHands({ p1: [tool("power", 1)] }, "jam", applyVotes(s, {}));
		s = resolveRound(playHands(s));
		expect(s.progress.power).toBe(6);
	});

	it("off-type cards subtract their value from the first-listed type, minimum 0", () => {
		// Generator: Power first. Force is off-type.
		let s = actionWithHands({
			p1: [tool("power", 5)],
			p2: [tool("force", 3)],
			p3: [tool("code", 2)],
		});
		s = resolveRound(playHands(s));
		expect(s.progress).toEqual({ power: 2, code: 2, force: 0 });

		s = actionWithHands({ p1: [tool("force", 5)] }, "jam", applyVotes(s, {}));
		s = resolveRound(playHands(s));
		expect(s.progress.power).toBe(0);
		expect(s.progress.code).toBe(2);
	});

	it("subtracts from Code on the Security Terminal (Code listed first)", () => {
		let s = {
			...actionWithHands({ p1: [tool("code", 4)], p2: [tool("power", 3)] }),
			sector: 1,
		};
		s = resolveRound(playHands(s));
		expect(s.progress).toEqual({ power: 0, code: 1, force: 0 });
	});

	it("opening a lock moves to the next sector and resets progress, without a Lockdown penalty", () => {
		let s = actionWithHands({
			p1: [tool("power", 5), tool("power", 3)],
			p2: [tool("code", 4)],
		});
		s = resolveRound(playHands(s));
		expect(s.sector).toBe(1);
		expect(s.progress).toEqual({ power: 0, code: 0, force: 0 });
		expect(s.lockdown).toBe(0);
		expect(s.feed).toContainEqual(
			expect.objectContaining({
				kind: "lockResolved",
				opened: true,
				sector: 0,
			}),
		);
	});

	it("needs every type of the lock to reach its target", () => {
		let s = actionWithHands({
			p1: [tool("power", 5), tool("power", 5)],
			p2: [tool("code", 3)],
		});
		s = resolveRound(playHands(s));
		expect(s.sector).toBe(0);
		expect(s.lockdown).toBe(2);
	});

	it("a failed lock raises Lockdown by 2", () => {
		const s = resolveRound(actionWithHands({}, "jam"));
		expect(s.lockdown).toBe(2);
	});

	it("shuffles the pile before reveal and never reveals owners publicly", () => {
		let s = actionWithHands({
			p1: [tool("power", 1), tool("power", 2)],
			p2: [tool("code", 1), tool("code", 2)],
			p3: [tool("force", 1)],
			p4: [tool("power", 3)],
		});
		s = resolveRound(playHands(s));
		const reveal = s.feed.find((f) => f.kind === "pileRevealed");
		if (reveal?.kind !== "pileRevealed") throw new Error();
		expect(reveal.pile).toHaveLength(6);
		expect(JSON.stringify(reveal)).not.toMatch(/p[1-4]/);
		const idx = s.plays.map((p) => p.pileIndex).sort();
		expect(idx).toEqual([0, 1, 2, 3, 4, 5]);
		// Pile order is a seeded permutation, not play order.
		const orders = new Set(
			["a", "b", "c", "d", "e", "f"].map((seed) => {
				let g = actionWithHands(
					{
						p1: [tool("power", 1), tool("power", 2)],
						p2: [tool("code", 1), tool("code", 2)],
					},
					"jam",
					newGame(seed),
				);
				g = resolveRound(playHands(g));
				return g.plays.map((p) => p.pileIndex).join();
			}),
		);
		expect(orders.size).toBeGreaterThan(1);
	});

	it("auto-plays idle players when resolving before everyone acted", () => {
		const s = resolveRound(actionWithHands({ p1: [tool("power", 4)] }));
		expect(s.plays).toHaveLength(1);
		expect(s.plays[0]?.auto).toBe(true);
	});

	it("opening the exit moves to the final choice", () => {
		let s = {
			...actionWithHands({
				p1: [tool("power", 5)],
				p2: [tool("code", 5)],
				p3: [tool("force", 5)],
			}),
			sector: 3,
		};
		s = resolveRound(playHands(s));
		expect(s.phase).toBe("final");
		expect(s.sector).toBe(4);
	});

	it("Lockdown 12 seals the vault: the Oracle wins", () => {
		const s = resolveRound({ ...actionWithHands({}, "jam"), lockdown: 10 });
		expect(s.phase).toBe("ended");
		expect(s.outcome).toEqual({ kind: "sealed", winners: ["oracle"] });
	});

	it("Lockdown 12 also wins for the traitor, if one exists", () => {
		const s = resolveRound({
			...actionWithHands({}, "jam"),
			lockdown: 10,
			traitorId: "p2",
		});
		expect(s.outcome).toEqual({
			kind: "sealed",
			winners: ["oracle", "traitor"],
		});
	});
});

function resolveWithThreat(
	threat: ThreatKind,
	patch: Partial<GameState> = {},
): GameState {
	return resolveRound({ ...actionWithHands({}, threat), ...patch });
}

describe("threats", () => {
	it("Power Surge: Lockdown +2", () => {
		expect(resolveWithThreat("powerSurge").lockdown).toBe(4);
	});

	it("Whisper: the Oracle owes one public statement about one player", () => {
		const s = resolveWithThreat("whisper");
		expect(s.whisperPending).toBe(true);
		expect(
			validateMessage(s, {
				to: "p1",
				kind: "whisper",
				text: "",
				claim: { type: "isTraitor", player: "p1" },
			}),
		).toBe("WHISPER_IS_PUBLIC");
		expect(
			validateMessage(s, {
				to: null,
				kind: "whisper",
				text: "",
				claim: { type: "noTraitorYet" },
			}),
		).toBe("WHISPER_NEEDS_ONE_PLAYER");
		const { state, message } = recordMessage(s, {
			to: null,
			kind: "whisper",
			text: "p3 has dirty hands.",
			claim: { type: "playedOffType", player: "p3", round: 1 },
		});
		expect(message.truth).toBe(false);
		expect(state.whisperPending).toBe(false);
		expect(
			validateMessage(state, {
				to: null,
				kind: "whisper",
				text: "",
				claim: { type: "isTraitor", player: "p1" },
			}),
		).toBe("NO_WHISPER_PENDING");
	});

	it("Jam: the current lock's first type needs +3 until the lock opens", () => {
		let s = resolveWithThreat("jam");
		expect(s.jam).toBe(3);
		expect(lockTargets(s)).toEqual({ power: 11, code: 4 });
		// 8 Power + 4 Code no longer opens it.
		s = actionWithHands(
			{ p1: [tool("power", 5), tool("power", 3)], p2: [tool("code", 4)] },
			"powerSurge",
			applyVotes(s, {}),
		);
		s = resolveRound(playHands(s));
		expect(s.sector).toBe(0);
		expect(s.jam).toBe(3);
		// 3 more Power opens it; jam resets for the next lock.
		s = actionWithHands(
			{ p1: [tool("power", 3)] },
			"powerSurge",
			applyVotes(s, {}),
		);
		s = resolveRound(playHands(s));
		expect(s.sector).toBe(1);
		expect(s.jam).toBe(0);
	});

	it("Mercy: Lockdown -1 and the Oracle names a random player", () => {
		const s = resolveWithThreat("mercy");
		expect(s.lockdown).toBe(1);
		const rec = s.threats[0];
		expect(rec?.threat).toBe("mercy");
		expect(P).toContain(rec?.favoredPlayer);
		const players = new Set(
			["a", "b", "c", "d", "e", "f", "g", "h"].map(
				(seed) =>
					resolveRound(actionWithHands({}, "mercy", newGame(seed))).threats[0]
						?.favoredPlayer,
			),
		);
		expect(players.size).toBeGreaterThan(1);
	});

	it("Mercy never pushes Lockdown below 0", () => {
		let s = actionWithHands(
			{ p1: [tool("power", 5), tool("power", 3)], p2: [tool("code", 4)] },
			"mercy",
		);
		s = resolveRound(playHands(s));
		expect(s.lockdown).toBe(0);
	});

	it("Static: announced as no threat, and every night message next round must be a lie", () => {
		let s = resolveWithThreat("static");
		expect(s.lockdown).toBe(2);
		expect(s.feed).toContainEqual({
			round: 1,
			kind: "threat",
			announced: "none",
		});
		expect(JSON.stringify(s.feed)).not.toContain('"static"');
		s = setThreat(startNight(applyVotes(s, {})), "jam");
		expect(s.staticActive).toBe(true);
		const truthful = {
			to: "p1",
			kind: "night" as const,
			text: "",
			claim: { type: "noTraitorYet" as const },
		};
		expect(validateMessage(s, truthful)).toBe("STATIC_REQUIRES_LIE");
		const lie = recordMessage(s, {
			...truthful,
			claim: { type: "traitorExists" },
		});
		expect(lie.message.truth).toBe(false);
		// Static lasts one night only.
		s = setThreat(
			startNight(applyVotes(resolveRound(toAction(lie.state)), {})),
			"jam",
		);
		expect(s.staticActive).toBe(false);
		expect(validateMessage(s, truthful)).toBeNull();
	});

	it("applies after the lock result, and exactly once", () => {
		const s = resolveWithThreat("powerSurge");
		const kinds = s.feed
			.filter((f) => f.kind === "lockdown")
			.map((f) => (f.kind === "lockdown" ? f.delta : 0));
		expect(kinds).toEqual([2, 2]);
		expect(s.currentThreat).toBeNull();
		expect(applyThreat(s)).toEqual(s);
	});

	it("Lockdown is clamped to 0..12", () => {
		const s = resolveWithThreat("powerSurge", { lockdown: 11 });
		expect(s.lockdown).toBe(12);
	});
});

describe("votes and quarantine", () => {
	function voted(votes: Record<string, string | null>): GameState {
		return applyVotes(resolveRound(actionWithHands({}, "jam")), votes);
	}

	it("3 of 4 votes quarantines a player for the next Action phase only", () => {
		let s = voted({ p1: "p4", p2: "p4", p3: "p4", p4: "p1" });
		expect(s.players.find((p) => p.id === "p4")?.quarantined).toBe(true);
		expect(s.feed.at(-1)).toEqual({
			round: 1,
			kind: "quarantine",
			player: "p4",
		});
		s = actionWithHands({ p4: [tool("power", 5)] }, "jam", s);
		expect(activePlayers(s)).toEqual(["p1", "p2", "p3"]);
		expect(() => playCards(s, "p4", cardIds(s, "p4"))).toThrow(/QUARANTINED/);
		s = resolveRound(s);
		expect(s.plays).toHaveLength(0);
		expect(s.players.every((p) => !p.quarantined)).toBe(true);
	});

	it("2 votes are not enough", () => {
		const s = voted({ p1: "p4", p2: "p4", p3: null, p4: "p1" });
		expect(s.players.some((p) => p.quarantined)).toBe(false);
		expect(s.feed.at(-1)).toEqual({
			round: 1,
			kind: "quarantine",
			player: null,
		});
	});

	it("nobody may vote for themselves", () => {
		expect(() => voted({ p1: "p1" })).toThrow(/SELF_VOTE/);
	});

	it("a quarantined player can still vote and use day cards", () => {
		let s = voted({ p1: "p4", p2: "p4", p3: "p4" });
		s = startNight(s);
		s = setHand(startDay(s), "p4", [action("override")]);
		expect(() =>
			applyVotes({ ...s, phase: "vote" }, { p4: "p1", p2: "p1", p3: "p1" }),
		).not.toThrow();
	});

	it("voting is optional", () => {
		expect(voted({}).players.some((p) => p.quarantined)).toBe(false);
	});

	it("rejects unknown voters or targets", () => {
		expect(() => voted({ zz: "p1" })).toThrow(EngineError);
		expect(() => voted({ p1: "zz" })).toThrow(EngineError);
	});
});
