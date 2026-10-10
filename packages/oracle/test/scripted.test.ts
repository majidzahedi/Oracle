import {
	applyPact,
	applyVotes,
	type Claim,
	deal,
	evaluateClaim,
	type GameState,
	offerPact,
	pactCandidates,
	playCards,
	recordMessage,
	resolveRound,
	startAction,
	startDay,
	startNight,
	type ToolCard,
	validateMessage,
} from "@oracle/engine";
import { describe, expect, it } from "vitest";

import {
	type Names,
	renderClaim,
	scriptedLieDetector,
	scriptedNightMessages,
	scriptedPactOffer,
	scriptedWhisper,
} from "../src";

const names: Names = { p1: "Ana", p2: "Bita", p3: "Cyrus", p4: "Dara" };

/** Plays rounds where everyone throws their first tool card (some off-type) until `round` nights have started. */
function stateAtNight(
	seed: string,
	round: number,
	opts: { traitor?: string } = {},
): GameState {
	let s = startNight(deal({ seed, playerIds: ["p1", "p2", "p3", "p4"] }));
	while (s.round < round) {
		if (
			opts.traitor &&
			s.round >= 2 &&
			pactCandidates(s).includes(opts.traitor)
		) {
			s = applyPact(offerPact(s, opts.traitor), opts.traitor, true);
		}
		s = startAction(startDay(s));
		for (const p of s.players) {
			const tool = p.hand.find((c): c is ToolCard => c.kind === "tool");
			if (tool) s = playCards(s, p.id, [tool.id]);
		}
		s = resolveRound(s);
		if (s.phase !== "vote") break;
		s = startNight(applyVotes(s, {}));
	}
	return s;
}

describe("scripted night messages", () => {
	it("are valid engine messages: one per player, about someone else", () => {
		for (let i = 0; i < 100; i++) {
			const s = stateAtNight(`seed-${i}`, 1 + (i % 4), {
				traitor: i % 2 ? "p3" : undefined,
			});
			if (s.phase !== "night") continue;
			const msgs = scriptedNightMessages(s, names, i % 3 ? "fa" : "en");
			expect(msgs.map((m) => m.to)).toEqual(["p1", "p2", "p3", "p4"]);
			let state = s;
			for (const m of msgs) {
				expect(validateMessage(state, m)).toBeNull();
				state = recordMessage(state, m).state;
			}
		}
	});

	it("under Static, every message is false", () => {
		for (let i = 0; i < 50; i++) {
			const s = {
				...stateAtNight(`static-${i}`, 2, { traitor: "p2" }),
				staticActive: true,
			};
			if (s.phase !== "night") continue;
			for (const m of scriptedNightMessages(s, names, "en")) {
				expect(evaluateClaim(s, m.claim as Claim)).toBe(false);
				expect(validateMessage(s, m)).toBeNull();
			}
		}
	});

	it("tells both truths and lies across games", () => {
		const truths = new Set<boolean>();
		for (let i = 0; i < 30; i++) {
			const s = stateAtNight(`mix-${i}`, 2);
			for (const m of scriptedNightMessages(s, names, "en"))
				truths.add(evaluateClaim(s, m.claim as Claim));
		}
		expect(truths).toEqual(new Set([true, false]));
	});

	it("is deterministic for the same state (safe to re-run in a retried step)", () => {
		const s = stateAtNight("det", 3);
		expect(scriptedNightMessages(s, names, "fa")).toEqual(
			scriptedNightMessages(s, names, "fa"),
		);
	});

	it("names the subject in the text", () => {
		const s = stateAtNight("names", 1);
		for (const m of scriptedNightMessages(s, names, "en")) {
			const c = m.claim?.type === "not" ? m.claim.claim : m.claim;
			if (c && "player" in c) expect(m.text).toContain(names[c.player]);
		}
	});
});

describe("pact offers", () => {
	it("never before night 2, only to eligible players", () => {
		expect(scriptedPactOffer(stateAtNight("p", 1))).toBeNull();
		const offered = new Set<string | null>();
		for (let i = 0; i < 40; i++) {
			const s = stateAtNight(`pact-${i}`, 2);
			const o = scriptedPactOffer(s);
			offered.add(o);
			if (o) expect(pactCandidates(s)).toContain(o);
		}
		expect(offered.has(null)).toBe(true);
		expect(offered.size).toBeGreaterThan(2);
	});
});

describe("whisper and lie detector", () => {
	it("whispers are public, about exactly one player, and valid", () => {
		for (let i = 0; i < 40; i++) {
			const s = {
				...stateAtNight(`w-${i}`, 2),
				phase: "vote" as const,
				whisperPending: true,
			};
			const m = scriptedWhisper(s, names, "en");
			expect(m.to).toBeNull();
			expect(validateMessage(s, m)).toBeNull();
		}
	});

	it("lie detector text states the true answer", () => {
		const s = stateAtNight("ld", 2, { traitor: "p2" });
		const truthful: Claim = {
			type: "not",
			claim: { type: "isTraitor", player: "p4" },
		};
		const m = scriptedLieDetector(s, "p1", truthful, names, "en");
		expect(validateMessage(s, m)).toBeNull();
		expect(m.text).toContain("Dara has never served me");
	});
});

describe("renderClaim", () => {
	it("phrases a claim and its negation differently, in both languages", () => {
		const c: Claim = { type: "isTraitor", player: "p2" };
		for (const lang of ["en", "fa"] as const) {
			expect(renderClaim(c, names, lang)).not.toBe(
				renderClaim({ type: "not", claim: c }, names, lang),
			);
			expect(
				renderClaim(
					{ type: "not", claim: { type: "not", claim: c } },
					names,
					lang,
				),
			).toBe(renderClaim(c, names, lang));
		}
	});

	it("noTraitorYet reads as the negation of traitorExists", () => {
		expect(renderClaim({ type: "noTraitorYet" }, names, "en")).toBe(
			renderClaim(
				{ type: "not", claim: { type: "traitorExists" } },
				names,
				"en",
			),
		);
	});

	it("uses Persian digits for rounds in Persian", () => {
		const t = renderClaim(
			{ type: "playedOffType", player: "p1", round: 3 },
			names,
			"fa",
		);
		expect(t).toContain("۳");
		expect(t).toContain("Ana");
	});
});
