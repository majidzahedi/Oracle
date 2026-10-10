import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import {
	applyVotes,
	type Claim,
	deal,
	evaluateClaim,
	playCards,
	resolveRound,
	startAction,
	startDay,
	startNight,
} from "@oracle/engine";
import { MockLanguageModelV4 } from "ai/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
	createJevDecider,
	type Decider,
	decideAccused,
	fromEngineClaim,
	type Names,
	oracleNight,
} from "../src";

const names: Names = { p1: "Ana", p2: "Bita", p3: "Cyrus", p4: "Dara" };

// --- A stand-in for laya-serve / Jev: POST /v1/systemone
const requests: Array<{ auth?: string; body: Record<string, unknown> }> = [];
let server: Server;
let baseUrl = "";
beforeAll(async () => {
	server = createServer((req, res) => {
		let body = "";
		req.on("data", (c) => {
			body += c;
		});
		req.on("end", () => {
			const parsed = JSON.parse(body);
			requests.push({ auth: req.headers.authorization, body: parsed });
			const criteria = parsed.questions.q.criteria as Record<string, string>;
			const text = Object.values(parsed.state as Record<string, string>).join(
				" ",
			);
			const accused = Object.keys(criteria).find(
				(k) =>
					k !== "nobody" &&
					criteria[k] &&
					text.includes(criteria[k].split(" ").pop() as string),
			);
			const choice = "claim" in criteria ? "claim" : (accused ?? "nobody");
			res.setHeader("content-type", "application/json");
			res.end(
				JSON.stringify({
					model: "multilingual",
					answers: {
						q: {
							type: "choice",
							choice,
							probabilities: { [choice]: 0.9 },
							confidence: 0.8,
						},
					},
					usage: { input_tokens: 10, output_tokens: 1 },
				}),
			);
		});
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

describe("Jev protocol client", () => {
	it("sends state, a choice question, model and bearer key; reads choice and probability", async () => {
		const d = createJevDecider({
			baseUrl,
			apiKey: "secret-key",
			model: "multilingual",
			timeoutMs: 3000,
		});
		const a = await d.choice({ message: "hi" }, "Which?", {
			claim: "x",
			negation: "y",
		});
		expect(a).toEqual({ choice: "claim", probability: 0.9 });
		const req = requests.at(-1);
		expect(req?.auth).toBe("Bearer secret-key");
		expect(req?.body).toMatchObject({
			model: "multilingual",
			state: { message: "hi" },
			questions: { q: { type: "choice", instructions: "Which?" } },
		});
	});

	it("reads accusations from chat lines", async () => {
		const d = createJevDecider({
			baseUrl,
			apiKey: null,
			model: null,
			timeoutMs: 3000,
		});
		expect(await decideAccused(d, "I saw Cyrus cheat.", names)).toBe("p3");
		expect(
			await decideAccused(d, "Let's play matching cards.", names),
		).toBeNull();
	});

	it("rejects on HTTP errors", async () => {
		const d = createJevDecider({
			baseUrl: "http://127.0.0.1:9",
			apiKey: null,
			model: null,
			timeoutMs: 1000,
		});
		await expect(d.choice({ m: "x" }, "?", { a: "a" })).rejects.toThrow();
	});
});

// --- The Oracle's verifier prefers the decision engine.

function model(answers: unknown[]) {
	let i = 0;
	const calls = { n: 0 };
	const m = new MockLanguageModelV4({
		doGenerate: async () => {
			calls.n++;
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(answers[Math.min(i++, answers.length - 1)]),
					},
				],
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
	return { m, calls };
}

function round2() {
	let s = startAction(
		startDay(
			startNight(deal({ seed: "dec", playerIds: ["p1", "p2", "p3", "p4"] })),
		),
	);
	for (const p of s.players) {
		const c = p.hand.find((x) => x.kind === "tool");
		s = playCards(s, p.id, c ? [c.id] : []);
	}
	return startNight(applyVotes(resolveRound(s), {}));
}

function plan(s: ReturnType<typeof round2>) {
	const msg = (to: string, claim: Claim, text: string) => ({
		to,
		claim: fromEngineClaim(claim),
		intendedTruth: evaluateClaim(s, claim),
		text,
	});
	return {
		pactOffer: null,
		messages: [
			msg("p1", { type: "isTraitor", player: "p2" }, "Bita serves me."),
			msg("p2", { type: "isTraitor", player: "p3" }, "Cyrus serves me."),
			msg("p3", { type: "isTraitor", player: "p4" }, "Dara serves me."),
			msg("p4", { type: "isTraitor", player: "p1" }, "Ana serves me."),
		],
	};
}

describe("claim checks with a decision engine", () => {
	it("uses the engine instead of a second LLM call", async () => {
		const s = round2();
		const { m, calls } = model([plan(s)]);
		const seen: string[] = [];
		const decider: Decider = {
			async choice(state) {
				seen.push(state.statement as string);
				return { choice: "claim", probability: 0.95 };
			},
		};
		const r = await oracleNight(
			{
				model: m,
				profile: { temperature: 0.5, timeoutMs: 3000, verifyClaims: true },
				lang: "en",
				names,
				decider,
			},
			s,
		);
		expect(r.report.source).toBe("llm");
		expect(calls.n).toBe(1); // only the night plan, no LLM verifier
		expect(seen).toHaveLength(4);
	});

	it("an unsure or opposite verdict rejects the message", async () => {
		const s = round2();
		const { m } = model([plan(s)]);
		const decider: Decider = {
			choice: async () => ({ choice: "negation", probability: 0.8 }),
		};
		const r = await oracleNight(
			{
				model: m,
				profile: { temperature: 0.5, timeoutMs: 3000, verifyClaims: false },
				lang: "en",
				names,
				decider,
			},
			s,
		);
		expect(r.report.fallbacks).toBe(4); // every message rejected, scripted lines used
	});

	it("a failing engine falls back to the LLM verifier", async () => {
		const s = round2();
		const verdictsOk = {
			verdicts: [0, 1, 2, 3].map((index) => ({ index, asserts: "claim" })),
		};
		const { m, calls } = model([plan(s), verdictsOk]);
		const decider: Decider = {
			choice: async () => {
				throw new Error("down");
			},
		};
		const r = await oracleNight(
			{
				model: m,
				profile: { temperature: 0.5, timeoutMs: 3000, verifyClaims: true },
				lang: "en",
				names,
				decider,
			},
			s,
		);
		expect(r.report.source).toBe("llm");
		expect(calls.n).toBe(2);
		expect(r.report.errors.join()).toContain("decision engine failed");
	});
});
