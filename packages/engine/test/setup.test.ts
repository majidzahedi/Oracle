import { describe, expect, it } from "vitest";

import {
	buildDeck,
	buildThreatDeck,
	deal,
	EngineError,
	HAND_SIZE,
	rng,
	startNight,
	THREAT_KINDS,
	TOOL_TYPES,
} from "../src";
import { newGame, P, setHand, totalCards } from "./helpers";

describe("deck", () => {
	it("has 45 tool cards: 3 types x values 1-5 x 3 copies", () => {
		const tools = buildDeck().filter((c) => c.kind === "tool");
		expect(tools).toHaveLength(45);
		for (const type of TOOL_TYPES) {
			for (let v = 1; v <= 5; v++) {
				expect(
					tools.filter((c) => c.type === type && c.value === v),
				).toHaveLength(3);
			}
		}
	});

	it("has 15 action cards: 3 of each", () => {
		const actions = buildDeck().filter((c) => c.kind === "action");
		expect(actions).toHaveLength(15);
		for (const a of [
			"decoder",
			"lieDetector",
			"shield",
			"override",
			"scanner",
		]) {
			expect(actions.filter((c) => c.action === a)).toHaveLength(3);
		}
	});

	it("has unique card ids", () => {
		const ids = buildDeck().map((c) => c.id);
		expect(new Set(ids).size).toBe(60);
	});

	it("threat deck defaults to 2 of each threat and is configurable", () => {
		const d = buildThreatDeck();
		expect(d).toHaveLength(10);
		for (const t of THREAT_KINDS)
			expect(d.filter((x) => x === t)).toHaveLength(2);
		expect(
			buildThreatDeck({ static: 0, jam: 4 }).filter((x) => x === "jam"),
		).toHaveLength(4);
	});
});

describe("deal", () => {
	it("deals 5 cards to each of 4 players", () => {
		const s = newGame();
		expect(s.players).toHaveLength(4);
		for (const p of s.players) expect(p.hand).toHaveLength(HAND_SIZE);
		expect(s.deck).toHaveLength(40);
		expect(totalCards(s)).toBe(60);
	});

	it("starts at lockdown 0, sector A, no progress, no traitor", () => {
		const s = newGame();
		expect(s).toMatchObject({
			round: 0,
			phase: "setup",
			lockdown: 0,
			sector: 0,
			jam: 0,
			traitorId: null,
			progress: { power: 0, code: 0, force: 0 },
		});
		expect(s.players.every((p) => p.role === "innocent")).toBe(true);
	});

	it("is reproducible from the seed", () => {
		expect(newGame("abc")).toEqual(newGame("abc"));
		expect(newGame("abc").deck).not.toEqual(newGame("abd").deck);
	});

	it("requires exactly 4 unique players", () => {
		expect(() => deal({ seed: "x", playerIds: ["a", "b", "c"] })).toThrow(
			EngineError,
		);
		expect(() => deal({ seed: "x", playerIds: ["a", "a", "b", "c"] })).toThrow(
			EngineError,
		);
	});
});

describe("rng", () => {
	it("is deterministic and in range", () => {
		let s = rng.seedToState("x");
		const a: number[] = [];
		for (let i = 0; i < 100; i++) {
			let v: number;
			[v, s] = rng.nextInt(s, 6);
			a.push(v);
		}
		expect(a.every((v) => v >= 0 && v < 6)).toBe(true);
		expect(new Set(a).size).toBe(6);
		expect(rng.nextInt(rng.seedToState("x"), 6)[0]).toBe(a[0]);
	});

	it("shuffle is a permutation", () => {
		const [out] = rng.shuffle(1, [1, 2, 3, 4, 5]);
		expect([...out].sort()).toEqual([1, 2, 3, 4, 5]);
	});
});

describe("hands and reshuffle", () => {
	it("refills every hand to 5 at the start of each night", () => {
		let s = setHand(newGame(), "p1", []);
		s = startNight(s);
		expect(s.players.find((p) => p.id === "p1")?.hand).toHaveLength(5);
	});

	it("action cards count toward the hand of 5 and a player may hold several", () => {
		let s = newGame();
		const actions = s.deck.filter((c) => c.kind === "action").slice(0, 3);
		s = setHand(s, "p1", actions);
		s = startNight(s);
		const hand = s.players[0]?.hand ?? [];
		expect(hand).toHaveLength(5);
		expect(
			hand.filter((c) => c.kind === "action").length,
		).toBeGreaterThanOrEqual(3);
	});

	it("reshuffles the discard pile into the deck when the deck runs out", () => {
		let s = newGame();
		s = { ...s, discard: s.deck.slice(0, 20), deck: [] };
		for (const id of P) s = setHand(s, id, []);
		s = startNight(s);
		expect(s.players.every((p) => p.hand.length === 5)).toBe(true);
		expect(s.discard).toHaveLength(0);
		expect(s.deck).toHaveLength(0);
	});

	it("reshuffles the threat discard when the threat deck is empty", () => {
		let s = newGame();
		s = { ...s, threatDeck: [], threatDiscard: ["mercy"] };
		s = startNight(s);
		expect(s.currentThreat).toBe("mercy");
		expect(s.threatDiscard).toHaveLength(0);
	});
});
