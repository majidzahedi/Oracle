import {
	applyVotes,
	type Claim,
	deal,
	evaluateClaim,
	type GameState,
	offerPact,
	playCards,
	resolveRound,
	startAction,
	startDay,
	startNight,
	type ToolCard,
	validateMessage,
} from "@oracle/engine";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";

import {
	fromEngineClaim,
	type Names,
	type OracleCtx,
	oracleLieDetector,
	oracleMercy,
	oracleNight,
	oracleWhisper,
} from "../src";

const names: Names = { p1: "Ana", p2: "Bita", p3: "Cyrus", p4: "Dara" };

/** A model that answers each call with the next queued object (or throws for Error entries). */
function mockModel(answers: Array<unknown | Error>) {
	const prompts: string[] = [];
	let i = 0;
	const model = new MockLanguageModelV4({
		doGenerate: async (opts) => {
			prompts.push(JSON.stringify(opts.prompt));
			const a = answers[Math.min(i++, answers.length - 1)];
			if (a instanceof Error) throw a;
			return {
				content: [{ type: "text", text: JSON.stringify(a) }],
				finishReason: { unified: "stop", raw: undefined },
				usage: {
					inputTokens: {
						total: 1,
						noCache: 1,
						cacheRead: undefined,
						cacheWrite: undefined,
					},
					outputTokens: { total: 1, text: 1, reasoning: undefined },
				},
				warnings: [],
			};
		},
	});
	return { model, prompts, calls: () => i };
}

const ctxFor = (
	model: MockLanguageModelV4,
	verifyClaims = false,
): OracleCtx => ({
	model,
	profile: { temperature: 0.8, timeoutMs: 5000, verifyClaims },
	lang: "en",
	names,
});

/** Round 2 night; p3 played an off-type card in round 1. */
function round2(): GameState {
	let s = startAction(
		startDay(
			startNight(deal({ seed: "llm", playerIds: ["p1", "p2", "p3", "p4"] })),
		),
	);
	for (const p of s.players) {
		const want = p.id === "p3" ? "force" : "power";
		const card =
			p.hand.find((c): c is ToolCard => c.kind === "tool" && c.type === want) ??
			p.hand.find((c) => c.kind === "tool");
		s = playCards(s, p.id, card ? [card.id] : []);
	}
	s = resolveRound(s);
	return startNight(applyVotes(s, {}));
}

const msg = (
	to: string,
	claim: Claim,
	text: string,
	state: GameState,
	lieAboutIt = false,
) => {
	const truth = evaluateClaim(state, claim);
	return {
		to,
		claim: fromEngineClaim(claim),
		intendedTruth: lieAboutIt ? !truth : truth,
		text,
	};
};

function goodPlan(s: GameState, pactOffer: string | null = null) {
	const after = pactOffer ? offerPact(s, pactOffer) : s;
	return {
		pactOffer,
		messages: [
			msg(
				"p1",
				{ type: "isTraitor", player: "p2" },
				"Bita serves me now, little one.",
				after,
			),
			msg(
				"p2",
				{ type: "not", claim: { type: "isTraitor", player: "p3" } },
				"Cyrus has never served me.",
				after,
			),
			msg(
				"p3",
				{ type: "receivedPact", player: "p4" },
				"I made Dara an offer in the dark.",
				after,
			),
			msg(
				"p4",
				{ type: "traitorExists" },
				"One of you already belongs to me.",
				after,
			),
		],
	};
}

describe("LLM night", () => {
	it("accepts a valid plan: all messages from the model, Pact offered, truth checked", async () => {
		const s = round2();
		const { model } = mockModel([goodPlan(s, "p2")]);
		const r = await oracleNight(ctxFor(model), s);
		expect(r.report.source).toBe("llm");
		expect(r.pactOffer).toBe("p2");
		expect(r.messages.map((m) => m.text)).toEqual(
			goodPlan(s, "p2").messages.map((m) => m.text),
		);
		const after = offerPact(s, "p2");
		for (const m of r.messages) expect(validateMessage(after, m)).toBeNull();
	});

	it("rejects a message whose intended truth is wrong and retries with feedback", async () => {
		const s = round2();
		const bad = goodPlan(s);
		bad.messages[0] = msg(
			"p1",
			{ type: "isTraitor", player: "p2" },
			"Bita serves me now.",
			s,
			true,
		);
		const { model, prompts } = mockModel([bad, goodPlan(s)]);
		const r = await oracleNight(ctxFor(model), s);
		expect(r.report).toMatchObject({
			source: "llm",
			attempts: 2,
			fallbacks: 0,
		});
		expect(prompts[1]).toContain("but it is actually");
	});

	it("rejects texts that name the wrong player", async () => {
		const s = round2();
		const bad = goodPlan(s);
		bad.messages[2] = msg(
			"p3",
			{ type: "receivedPact", player: "p4" },
			"I made Bita an offer in the dark.",
			s,
		);
		const { model, prompts } = mockModel([bad, goodPlan(s)]);
		const r = await oracleNight(ctxFor(model), s);
		expect(prompts[1]).toContain("must name Dara");
		expect(r.messages[2]?.text).toBe("I made Dara an offer in the dark.");
	});

	it("under Static, a true message is rejected; repeated failure falls back to scripted lies", async () => {
		const s = { ...round2(), staticActive: true };
		const truthful = goodPlan(s); // contains true statements
		const { model, calls } = mockModel([truthful]);
		const r = await oracleNight(ctxFor(model), s);
		expect(calls()).toBe(3);
		expect(r.report.fallbacks).toBeGreaterThan(0);
		for (const m of r.messages)
			expect(evaluateClaim(s, m.claim as Claim)).toBe(false);
	});

	it("a model error falls back to the scripted Oracle entirely", async () => {
		const s = round2();
		const { model } = mockModel([new Error("connection refused")]);
		const r = await oracleNight(ctxFor(model), s);
		expect(r.report.source).toBe("scripted");
		expect(r.report.errors[0]).toContain("connection refused");
		expect(r.messages).toHaveLength(4);
	});

	it("ignores a Pact offer the rules do not allow", async () => {
		const s = startNight(
			deal({ seed: "r1", playerIds: ["p1", "p2", "p3", "p4"] }),
		); // round 1
		const plan = {
			pactOffer: "p2",
			messages: [
				msg("p1", { type: "isTraitor", player: "p2" }, "Bita serves me.", s),
				msg("p2", { type: "isTraitor", player: "p3" }, "Cyrus serves me.", s),
				msg("p3", { type: "isTraitor", player: "p4" }, "Dara serves me.", s),
				msg("p4", { type: "isTraitor", player: "p1" }, "Ana serves me.", s),
			],
		};
		const r = await oracleNight(ctxFor(mockModel([plan]).model), s);
		expect(r.pactOffer).toBeNull();
		expect(r.report.errors.join()).toContain("ignored invalid pact offer");
	});

	it("the verifier rejects a text that states the opposite of its claim", async () => {
		const s = round2();
		const plan = goodPlan(s);
		const verdictsBad = {
			verdicts: [0, 1, 2, 3].map((index) => ({
				index,
				asserts: index === 1 ? "negation" : "claim",
			})),
		};
		const verdictsOk = { verdicts: [{ index: 0, asserts: "claim" }] };
		const { model, prompts } = mockModel([plan, verdictsBad, plan, verdictsOk]);
		const r = await oracleNight(ctxFor(model, true), s);
		expect(r.report).toMatchObject({ source: "llm", attempts: 2 });
		expect(prompts[2]).toContain("does not clearly state its claim");
	});
});

describe("LLM lie detector, whisper, mercy", () => {
	it("lie detector text must state the engine's answer", async () => {
		const s = round2();
		const truthful: Claim = {
			type: "not",
			claim: { type: "isTraitor", player: "p3" },
		};
		const good = await oracleLieDetector(
			ctxFor(mockModel([{ text: "Cyrus has never served me." }]).model),
			s,
			"p1",
			truthful,
		);
		expect(good.report.source).toBe("llm");
		expect(validateMessage(s, good.message)).toBeNull();

		const bad = await oracleLieDetector(
			ctxFor(mockModel([{ text: "Who knows?" }]).model),
			s,
			"p1",
			truthful,
		);
		expect(bad.report.source).toBe("scripted");
		expect(bad.message.claim).toEqual(truthful);
		expect(validateMessage(s, bad.message)).toBeNull();
	});

	it("whisper must be about exactly one player and match the truth", async () => {
		const s = { ...round2(), phase: "vote" as const, whisperPending: true };
		const ok = await oracleWhisper(
			ctxFor(
				mockModel([
					msg(
						"x",
						{ type: "playedOffType", player: "p3", round: 1 },
						"In round 1, Cyrus sabotaged the lock.",
						s,
					),
				]).model,
			),
			s,
		);
		expect(ok.report.source).toBe("llm");
		expect(ok.message.to).toBeNull();
		const global = await oracleWhisper(
			ctxFor(
				mockModel([
					msg("x", { type: "traitorExists" }, "One of you is mine.", s),
				]).model,
			),
			s,
		);
		expect(global.report.source).toBe("scripted");
	});

	it("mercy must name only the favored player", async () => {
		const s = round2();
		const ok = await oracleMercy(
			ctxFor(mockModel([{ text: "Dara has earned my favor." }]).model),
			s,
			"p4",
		);
		expect(ok.message.text).toBe("Dara has earned my favor.");
		const bad = await oracleMercy(
			ctxFor(mockModel([{ text: "Bita and Dara amuse me." }]).model),
			s,
			"p4",
		);
		expect(bad.report.source).toBe("scripted");
		expect(bad.message.text).toContain("Dara");
	});

	it("without a model, everything is scripted", async () => {
		const s = round2();
		const r = await oracleNight(
			{ model: null, profile: null, lang: "fa", names },
			s,
		);
		expect(r.report.source).toBe("scripted");
		expect(r.report.attempts).toBe(0);
	});
});
