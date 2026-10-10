import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { createDb } from "@oracle/db";
import { user } from "@oracle/db/schema/auth";
import { botTurns, games, messages } from "@oracle/db/schema/game";
import { llmProfiles, oracleCalls } from "@oracle/db/schema/llm";
import { and, eq, inArray } from "drizzle-orm";
import type { Inngest } from "inngest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import * as game from "../src/game/actions";
import * as loop from "../src/game/loop";
import { loadGame } from "../src/game/store";
import * as profiles from "../src/llm/profiles";
import * as lobby from "../src/lobby/service";

const url =
	process.env.DATABASE_URL ??
	"postgresql://postgres:password@localhost:5432/oracle";
const db = createDb({ DATABASE_URL: url });
const dbUp = await db
	.execute("select 1")
	.then(() => true)
	.catch(() => false);

const inngest = {
	send: async () => ({ ids: ["x"] }),
	realtime: { publish: async () => {} },
} as unknown as Inngest.Any;
const secret = "test-secret-0123456789-0123456789";
const deps = { db, inngest, secret };
const D: loop.PhaseDurations = {
	night: 30,
	day: 30,
	action: 30,
	vote: 30,
	final: 30,
};

// --- A stand-in for Ollama's OpenAI-compatible API that answers like a well-behaved model.
let server: Server;
let baseUrl = "";
let chatRequests = 0;
const lastPrompts: string[] = [];

function answer(prompt: string): unknown {
	if (prompt.includes("Greet four trapped prisoners"))
		return { greeting: "Welcome to my vault, little ones." };
	if (prompt.includes("You check a game master")) {
		const n = (prompt.match(/#\d+/g) ?? []).length;
		return {
			verdicts: Array.from({ length: n }, (_, index) => ({
				index,
				asserts: "claim",
			})),
		};
	}
	const hasTraitor = !prompt.includes("Traitor: none yet");
	if (prompt.includes("It is night")) {
		const ids = [...prompt.matchAll(/- (p[1-4]) = /g)].map(
			(m) => m[1] as string,
		);
		const staticNight = prompt.includes("STATIC is active");
		const negated = staticNight ? hasTraitor : false;
		return {
			pactOffer: null,
			messages: [...new Set(ids)].map((to) => ({
				to,
				claim: { type: "traitorExists", player: null, round: null, negated },
				intendedTruth: negated ? !hasTraitor : hasTraitor,
				text: negated
					? "None of you has accepted my offer. Yet."
					: "One of you already belongs to me.",
			})),
		};
	}
	if (prompt.includes("Threat card WHISPER")) {
		const [, id, name] = prompt.match(/- (p[1-4]) = \\?"([^"\\]+)\\?"/) ?? [];
		const isTraitor = prompt.includes(`(${id}) accepted your Pact`);
		return {
			claim: { type: "isTraitor", player: id, round: null, negated: false },
			intendedTruth: isTraitor,
			text: `${name} serves me.`,
		};
	}
	if (prompt.includes("Threat card MERCY")) {
		const name = prompt.match(/Announce publicly that (.+?) \\?"earned/)?.[1];
		return { text: `${name} has earned my favor.` };
	}
	if (prompt.includes("used a Lie Detector")) {
		const fact = prompt.match(/must state plainly, is: \\?"(.+?)\\?"/)?.[1];
		return { text: fact };
	}
	// --- Bots
	if (prompt.includes("secretly offers you the Pact"))
		return { acceptPact: false, reason: "no" };
	if (prompt.includes("It is DAY")) {
		return {
			chat: ["The Oracle whispered riddles to me. Let us push the Generator."],
			action: { kind: "none", target: null, question: null, round: null },
		};
	}
	if (prompt.includes("ACTION phase")) {
		const hand = prompt.match(/Your hand: (.*?)\./)?.[1] ?? "";
		const tool = hand.match(/\[((?:power|code|force)-\d-\d)\]/)?.[1];
		return { cardIds: tool ? [tool] : [], reason: "best card" };
	}
	if (prompt.includes("VOTE:"))
		return { target: null, chat: [], scanPileIndex: null };
	if (prompt.includes("The EXIT is open"))
		return { target: null, reason: "mercy" };
	return { text: "?" };
}

beforeAll(async () => {
	server = createServer((req, res) => {
		let body = "";
		req.on("data", (c) => {
			body += c;
		});
		req.on("end", () => {
			res.setHeader("content-type", "application/json");
			if (req.url === "/v1/models") {
				res.end(JSON.stringify({ data: [{ id: "llama3.2" }] }));
				return;
			}
			chatRequests++;
			const prompt = JSON.stringify(JSON.parse(body).messages);
			lastPrompts.push(prompt);
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
							message: {
								role: "assistant",
								content: JSON.stringify(answer(prompt)),
							},
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

const run = Date.now().toString(36);
const host = { id: `llm-${run}`, name: "Ana", email: `llm-${run}@test.local` };
const createdProfiles: string[] = [];

const profileInput = (
	over: Partial<profiles.ProfileInput> = {},
): profiles.ProfileInput => ({
	name: `Local ${run}`,
	provider: "ollama",
	model: "llama3.2",
	baseUrl,
	temperature: 0.7,
	timeoutMs: 5000,
	verifyClaims: true,
	enabled: true,
	...over,
});

async function newProfile(over: Partial<profiles.ProfileInput> = {}) {
	const p = await profiles.createProfile(db, secret, profileInput(over));
	createdProfiles.push(p.id);
	return p;
}

/** 1 human + 3 bots, Oracle pinned to `choice`, started and at night 1 with the Oracle having spoken. */
async function startedGame(choice: string) {
	const { code } = await lobby.createGame(deps, host, "en");
	await lobby.fillBots(deps, host, code);
	await lobby.setOracle(deps, host, code, choice);
	const { id: gameId } = await lobby.startGame(deps, host, code);
	await loop.openNight(deps, gameId, 1);
	return { code, gameId };
}

describe.skipIf(!dbUp)(
	"LLM Oracle with profiles (Postgres + mock Ollama)",
	() => {
		beforeAll(async () => {
			await db.insert(user).values(host);
		});
		beforeEach(() => {
			lastPrompts.length = 0;
		});
		afterAll(async () => {
			await db.delete(games).where(eq(games.hostUserId, host.id));
			await db.delete(user).where(eq(user.id, host.id));
			if (createdProfiles.length)
				await db
					.delete(llmProfiles)
					.where(inArray(llmProfiles.id, createdProfiles));
		});

		it("stores API keys encrypted and never returns them", async () => {
			const p = await newProfile({
				provider: "anthropic",
				baseUrl: null,
				apiKey: "sk-ant-secret-9876",
			});
			expect(p).toMatchObject({ hasApiKey: true, apiKeyHint: "9876" });
			expect(JSON.stringify(p)).not.toContain("secret");
			const [row] = await db
				.select()
				.from(llmProfiles)
				.where(eq(llmProfiles.id, p.id));
			expect(row?.apiKeyEnc).toBeTruthy();
			expect(row?.apiKeyEnc).not.toContain("sk-ant");
			expect((await profiles.loadProfile(db, secret, p.id))?.apiKey).toBe(
				"sk-ant-secret-9876",
			);
			// Omitting the key keeps it; an empty string removes it.
			await profiles.updateProfile(
				db,
				secret,
				p.id,
				profileInput({ provider: "anthropic", baseUrl: null, name: "renamed" }),
			);
			expect((await profiles.loadProfile(db, secret, p.id))?.apiKey).toBe(
				"sk-ant-secret-9876",
			);
			const cleared = await profiles.updateProfile(
				db,
				secret,
				p.id,
				profileInput({ provider: "anthropic", baseUrl: null, apiKey: "" }),
			);
			expect(cleared.hasApiKey).toBe(false);
		});

		it("tests a profile and discovers models", async () => {
			const p = await newProfile();
			expect(await profiles.testProfile(db, secret, p.id)).toMatchObject({
				ok: true,
				sample: "Welcome to my vault, little ones.",
			});
			expect(
				await profiles.discoverModels(db, secret, {
					provider: "ollama",
					baseUrl,
				}),
			).toEqual({ models: ["llama3.2"], error: null });
			const down = await newProfile({ baseUrl: "http://127.0.0.1:9/v1" });
			expect(await profiles.testProfile(db, secret, down.id)).toMatchObject({
				ok: false,
			});
		});

		it("only one default; a game started on 'default' is pinned to it", async () => {
			const a = await newProfile();
			const b = await newProfile();
			await profiles.setDefault(db, a.id);
			await profiles.setDefault(db, b.id);
			const defaults = await db
				.select()
				.from(llmProfiles)
				.where(eq(llmProfiles.isDefault, true));
			expect(defaults.map((d) => d.id)).toEqual([b.id]);
			const { gameId } = await startedGame("default");
			expect((await loadGame(db, gameId)).game.oracleProfile).toBe(b.id);
			await profiles.setDefault(db, null);
			const { gameId: g2 } = await startedGame("default");
			expect((await loadGame(db, g2)).game.oracleProfile).toBe("scripted");
		});

		it("night messages come from the model, are truth-checked, logged, and never regenerated on re-run", async () => {
			const p = await newProfile();
			const { gameId, code } = await startedGame(p.id);
			// Ready is refused until the Oracle has spoken.
			await expect(game.ready(deps, host.id, code)).rejects.toMatchObject({
				message: "oracleThinking",
			});

			const before = chatRequests;
			await loop.oracleSpeaksAtNight(deps, gameId, 1, D);
			const used = chatRequests - before;
			expect(used).toBeGreaterThanOrEqual(1);
			await loop.oracleSpeaksAtNight(deps, gameId, 1, D); // re-run (e.g. after a crash)
			expect(chatRequests - before).toBe(used);

			const rows = await db
				.select()
				.from(messages)
				.where(and(eq(messages.gameId, gameId), eq(messages.kind, "night")));
			expect(rows).toHaveLength(4);
			for (const r of rows) {
				expect(r.text).toBe("One of you already belongs to me.");
				expect(r.truth).toBe(false); // no traitor on night 1: the engine recorded it as a lie
			}
			// The prompt carried the hidden state the Oracle needs.
			expect(
				lastPrompts.some(
					(pr) =>
						pr.includes("Traitor: none yet") && pr.includes("Lockdown 0/12"),
				),
			).toBe(true);
			const calls = await db
				.select()
				.from(oracleCalls)
				.where(eq(oracleCalls.gameId, gameId));
			expect(calls).toEqual([
				expect.objectContaining({
					purpose: "night",
					source: "llm",
					profileId: p.id,
					fallbacks: 0,
				}),
			]);
			await game.ready(deps, host.id, code);
		});

		it("falls back to the scripted Oracle when the model is unreachable", async () => {
			const down = await newProfile({
				baseUrl: "http://127.0.0.1:9/v1",
				timeoutMs: 2000,
			});
			const { gameId } = await startedGame(down.id);
			await loop.oracleSpeaksAtNight(deps, gameId, 1, D);
			const rows = await db
				.select()
				.from(messages)
				.where(and(eq(messages.gameId, gameId), eq(messages.kind, "night")));
			expect(rows).toHaveLength(4);
			const [call] = await db
				.select()
				.from(oracleCalls)
				.where(eq(oracleCalls.gameId, gameId));
			expect(call).toMatchObject({ source: "scripted", fallbacks: 4 });
			expect(call?.errors.length).toBeGreaterThan(0);
		});

		it("a deleted or disabled profile degrades to scripted instead of stalling", async () => {
			const p = await newProfile();
			const { gameId } = await startedGame(p.id);
			await profiles.updateProfile(
				db,
				secret,
				p.id,
				profileInput({ enabled: false }),
			);
			await loop.oracleSpeaksAtNight(deps, gameId, 1, D);
			const [call] = await db
				.select()
				.from(oracleCalls)
				.where(eq(oracleCalls.gameId, gameId));
			expect(call).toMatchObject({ source: "scripted", attempts: 0 });
		});

		it("Lie Detector: the engine answers, the model only phrases the truth", async () => {
			const p = await newProfile();
			const { gameId, code } = await startedGame(p.id);
			await loop.oracleSpeaksAtNight(deps, gameId, 1, D);
			const st = (await loadGame(db, gameId)).game.state;
			const me = st.players[0];
			if (!me) throw new Error();
			me.hand[0] = { id: "ld-llm", kind: "action", action: "lieDetector" };
			await db.update(games).set({ state: st }).where(eq(games.id, gameId));
			await game.ready(deps, host.id, code);
			await loop.openDay(deps, gameId, 1, D);
			const r = await game.act(deps, host.id, code, {
				action: "lieDetector",
				claim: { type: "isTraitor", player: "p3" },
			});
			expect(r).toMatchObject({ action: "lieDetector", answer: false });
			const ld = await db
				.select()
				.from(messages)
				.where(
					and(eq(messages.gameId, gameId), eq(messages.kind, "lieDetector")),
				);
			expect(ld).toEqual([
				expect.objectContaining({
					text: "Bot 3 has never served me. Not yet.",
					truth: true,
				}),
			]);
		});

		it("bots decide with the model from their own view, and a re-run replays the stored plan", async () => {
			const p = await newProfile({ verifyClaims: false });
			const { gameId, code } = await startedGame(p.id);
			await loop.oracleSpeaksAtNight(deps, gameId, 1, D);
			await loop.botsTurn(deps, gameId, 1, "night");
			await game.ready(deps, host.id, code);
			await loop.openDay(deps, gameId, 1, D);

			const before = chatRequests;
			await loop.botsTurn(deps, gameId, 1, "day");
			expect(chatRequests - before).toBe(3); // one model call per bot
			// Bots read only their own seat's view.
			const botPrompts = lastPrompts.filter((pr) => pr.includes("It is DAY"));
			expect(botPrompts).toHaveLength(3);
			const st = (await loadGame(db, gameId)).game.state;
			for (const [i, bp] of botPrompts.entries()) {
				const self = bp.match(/You are .+? \((p[1-4])\)/)?.[1];
				for (const other of st.players.filter((x) => x.id !== self)) {
					for (const c of other.hand)
						expect(bp, `prompt ${i}`).not.toContain(`[${c.id}]`);
				}
			}
			await loop.botsTurn(deps, gameId, 1, "day"); // replay
			expect(chatRequests - before).toBe(3);

			const view = await game.getView(deps, host.id, code);
			const botLines = view.chat.filter((c) =>
				c.text.startsWith("The Oracle whispered riddles"),
			);
			expect(botLines).toHaveLength(3); // no duplicates after the replay
			const turns = await db
				.select()
				.from(botTurns)
				.where(and(eq(botTurns.gameId, gameId), eq(botTurns.phase, "day")));
			expect(turns.map((t) => t.source)).toEqual(["llm", "llm", "llm"]);

			await game.ready(deps, host.id, code);
			await loop.openAction(deps, gameId, 1, D);
			await loop.botsTurn(deps, gameId, 1, "action");
			const acted = (await loadGame(db, gameId)).game.state.actedThisRound;
			expect(acted.filter((x) => x !== "p1")).toHaveLength(3);
		});

		it("only the host may choose the Oracle, and only from enabled profiles", async () => {
			const { code } = await lobby.createGame(deps, host, "en");
			await expect(
				lobby.setOracle(deps, host, code, "nope"),
			).rejects.toMatchObject({ message: "profileNotFound" });
			const other = { id: `x-${run}`, name: "X" };
			await expect(
				lobby.setOracle(deps, other, code, "scripted"),
			).rejects.toMatchObject({ message: "hostOnly" });
			const v = await lobby.setOracle(deps, host, code, "scripted");
			expect(v.oracle).toEqual({ choice: "scripted", name: null });
		});
	},
);
