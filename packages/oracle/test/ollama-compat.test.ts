import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { deal, startNight } from "@oracle/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createModel, listModels, type Names, oracleNight } from "../src";

/**
 * A stand-in for Ollama's OpenAI-compatible API (/v1/chat/completions,
 * /v1/models): exercises the real provider code path without a model.
 */
const requests: Array<Record<string, unknown>> = [];
let server: Server;
let baseUrl = "";

const plan = {
	pactOffer: null,
	messages: [
		{
			to: "p1",
			claim: { type: "isTraitor", player: "p2", round: null, negated: true },
			intendedTruth: true,
			text: "Bita has never served me.",
		},
		{
			to: "p2",
			claim: { type: "isTraitor", player: "p3", round: null, negated: true },
			intendedTruth: true,
			text: "Cyrus is clean.",
		},
		{
			to: "p3",
			claim: {
				type: "receivedPact",
				player: "p4",
				round: null,
				negated: false,
			},
			intendedTruth: false,
			text: "I whispered an offer to Dara.",
		},
		{
			to: "p4",
			claim: {
				type: "traitorExists",
				player: null,
				round: null,
				negated: false,
			},
			intendedTruth: false,
			text: "One of you is already mine.",
		},
	],
};

beforeAll(async () => {
	server = createServer((req, res) => {
		let body = "";
		req.on("data", (c) => {
			body += c;
		});
		req.on("end", () => {
			res.setHeader("content-type", "application/json");
			if (req.url === "/v1/models") {
				res.end(
					JSON.stringify({
						object: "list",
						data: [{ id: "llama3.2" }, { id: "qwen2.5:7b" }],
					}),
				);
				return;
			}
			requests.push(JSON.parse(body));
			res.end(
				JSON.stringify({
					id: "x",
					object: "chat.completion",
					created: 0,
					model: "llama3.2",
					choices: [
						{
							index: 0,
							finish_reason: "stop",
							message: { role: "assistant", content: JSON.stringify(plan) },
						},
					],
					usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
				}),
			);
		});
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});
afterAll(() => server.close());

describe("Ollama through the OpenAI-compatible provider", () => {
	const profile = {
		id: "x",
		name: "local",
		provider: "ollama" as const,
		model: "llama3.2",
		baseUrl: "",
		apiKey: null,
		temperature: 0.7,
		timeoutMs: 5000,
		verifyClaims: false,
	};

	it("lists models", async () => {
		expect(await listModels({ ...profile, baseUrl })).toEqual([
			"llama3.2",
			"qwen2.5:7b",
		]);
	});

	it("generates a night plan with a JSON-schema response format", async () => {
		const names: Names = { p1: "Ana", p2: "Bita", p3: "Cyrus", p4: "Dara" };
		const state = startNight(
			deal({ seed: "ollama", playerIds: ["p1", "p2", "p3", "p4"] }),
		);
		const r = await oracleNight(
			{
				model: createModel({ ...profile, baseUrl }),
				profile,
				lang: "en",
				names,
			},
			state,
		);
		expect(r.report.source).toBe("llm");
		expect(r.messages[0]?.text).toBe("Bita has never served me.");
		const req = requests[0] as {
			model: string;
			response_format?: { type: string };
		};
		expect(req.model).toBe("llama3.2");
		expect(req.response_format?.type).toBe("json_schema");
	});
});
