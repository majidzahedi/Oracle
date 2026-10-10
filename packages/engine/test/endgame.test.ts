import { describe, expect, it } from "vitest";
import {
	applyPact,
	finalChoice,
	type GameState,
	offerPact,
	playCards,
	playerView,
	publicView,
	recordMessage,
	resolveRound,
	revealLog,
	startDay,
	startNight,
} from "../src";
import { actionWithHands, cardIds, newGame, night, P, tool } from "./helpers";

function finalState(traitor: string | null): GameState {
	return { ...night(), phase: "final", traitorId: traitor };
}

describe("final choice", () => {
	it("perfect escape: the traitor is left behind", () => {
		const s = finalChoice(finalState("p2"), "p2");
		expect(s.phase).toBe("ended");
		expect(s.outcome).toEqual({
			kind: "escaped",
			escape: "perfect",
			leftBehind: "p2",
			traitorEscaped: false,
			winners: ["players"],
		});
	});

	it("clean escape: no traitor existed and nobody is left", () => {
		expect(finalChoice(finalState(null), null).outcome).toMatchObject({
			escape: "clean",
			winners: ["players"],
		});
	});

	it("bitter escape: an innocent is left behind", () => {
		expect(finalChoice(finalState(null), "p1").outcome).toMatchObject({
			escape: "bitter",
			leftBehind: "p1",
			winners: ["players"],
		});
	});

	it("traitor wins by escaping unidentified (innocent left behind)", () => {
		expect(finalChoice(finalState("p2"), "p1").outcome).toMatchObject({
			escape: "bitter",
			traitorEscaped: true,
			winners: ["traitor"],
		});
	});

	it("traitor wins by escaping unidentified (nobody left behind)", () => {
		expect(finalChoice(finalState("p2"), null).outcome).toMatchObject({
			escape: "betrayed",
			traitorEscaped: true,
			winners: ["traitor"],
		});
	});

	it("only happens once the exit is open", () => {
		expect(() => finalChoice(night(), null)).toThrow(/WRONG_PHASE/);
	});
});

describe("hidden information", () => {
	function midGame(): GameState {
		let s = night();
		s = recordMessage(s, {
			to: "p1",
			kind: "night",
			text: "SECRET-FOR-P1",
			claim: { type: "isTraitor", player: "p2" },
		}).state;
		s = { ...s, round: 2 };
		s = applyPact(offerPact(s, "p2"), "p2", true);
		return s;
	}

	it("the public view has no roles, hands, private messages or truth values", () => {
		const s = midGame();
		const json = JSON.stringify(publicView(s));
		expect(json).not.toContain("traitor");
		expect(json).not.toContain("SECRET-FOR-P1");
		expect(json).not.toContain("truth");
		expect(json).not.toContain("role");
		for (const p of s.players)
			for (const c of p.hand) expect(json).not.toContain(c.id);
	});

	it("a player's view has only their own hand, role and messages", () => {
		const s = midGame();
		const v3 = playerView(s, "p3");
		const json = JSON.stringify(v3);
		expect(v3.me.role).toBe("innocent");
		expect(json).not.toContain("traitor");
		expect(json).not.toContain("SECRET-FOR-P1");
		expect(json).not.toContain("truth");
		for (const p of s.players.filter((x) => x.id !== "p3"))
			for (const c of p.hand) expect(json).not.toContain(c.id);
		expect(playerView(s, "p1").me.messages.map((m) => m.text)).toEqual([
			"SECRET-FOR-P1",
		]);
		expect(playerView(s, "p2").me.role).toBe("traitor");
	});

	it("the pact offer shows only to its recipient", () => {
		let s = { ...night(), round: 2 };
		s = offerPact(s, "p4");
		expect(playerView(s, "p4").me.pactOffer).toEqual({
			round: 2,
			answered: false,
		});
		expect(playerView(s, "p1").me.pactOffer).toBeNull();
	});

	it("the revealed pile in views has no owners", () => {
		let s = actionWithHands({ p1: [tool("force", 2)], p2: [tool("power", 1)] });
		s = playCards(s, "p1", cardIds(s, "p1"));
		s = playCards(s, "p2", cardIds(s, "p2"));
		s = resolveRound(s);
		const v = publicView(s);
		expect(v.pile).toHaveLength(2);
		expect(JSON.stringify(v.pile)).not.toMatch(/owner|p1|p2/);
	});
});

describe("post-game log", () => {
	it("is not available before the end", () => {
		expect(() => revealLog(night())).toThrow(/GAME_NOT_OVER/);
	});

	it("contains every message with its truth, pact offers, threats and off-type owners", () => {
		let s = night(newGame(), "powerSurge");
		s = recordMessage(s, {
			to: "p1",
			kind: "night",
			text: "lie",
			claim: { type: "traitorExists" },
		}).state;
		s = startDay(s);
		s = { ...s, phase: "action" };
		for (const p of P)
			s = {
				...s,
				players: s.players.map((x) => (x.id === p ? { ...x, hand: [] } : x)),
			};
		s = {
			...s,
			players: s.players.map((x) =>
				x.id === "p3" ? { ...x, hand: [tool("force", 4)] } : x,
			),
		};
		s = playCards(s, "p3", cardIds(s, "p3"));
		s = resolveRound(s);
		s = startNight({ ...s, phase: "vote" });
		s = applyPact(offerPact(s, "p1"), "p1", false);
		s = finalChoice({ ...s, phase: "final" }, null);

		const log = revealLog(s);
		expect(log.messages).toEqual([
			expect.objectContaining({ to: "p1", text: "lie", truth: false }),
		]);
		expect(log.pactOffers).toEqual([
			{ round: 2, player: "p1", accepted: false },
		]);
		expect(log.threats).toEqual([
			{ round: 1, threat: "powerSurge", shielded: false },
		]);
		expect(log.offTypePlays).toEqual([
			expect.objectContaining({ owner: "p3", round: 1, offType: true }),
		]);
		expect(log.roles).toEqual({
			p1: "innocent",
			p2: "innocent",
			p3: "innocent",
			p4: "innocent",
		});
		expect(log.outcome).toMatchObject({ escape: "clean" });
	});
});
