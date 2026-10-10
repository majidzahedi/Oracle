import { createDb } from "@oracle/db";
import { user } from "@oracle/db/schema/auth";
import { games, messages } from "@oracle/db/schema/game";
import type { Card, ToolCard } from "@oracle/engine";
import type { GameView } from "@oracle/realtime";
import { eq, inArray } from "drizzle-orm";
import type { Inngest } from "inngest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as game from "../src/game/actions";
import * as loop from "../src/game/loop";
import { loadGame } from "../src/game/store";
import * as lobby from "../src/lobby/service";

const url =
	process.env.DATABASE_URL ??
	"postgresql://postgres:password@localhost:5432/oracle";
const db = createDb({ DATABASE_URL: url });
const dbUp = await db
	.execute("select 1")
	.then(() => true)
	.catch(() => false);

const sent: Array<{ name: string; data: Record<string, unknown> }> = [];
const published: Array<{ channel: string; topic: string; data: unknown }> = [];
const inngest = {
	send: async (e: { name: string; data: Record<string, unknown> }) => {
		sent.push(e);
		return { ids: ["x"] };
	},
	realtime: {
		publish: async (t: { channel: string; topic: string }, data: unknown) => {
			published.push({ channel: t.channel, topic: t.topic, data });
		},
	},
} as unknown as Inngest.Any;
const deps = { db, inngest };
const D: loop.PhaseDurations = {
	night: 30,
	day: 30,
	action: 30,
	vote: 30,
	final: 30,
};

const run = Date.now().toString(36);
const users = ["a", "b", "c", "d"].map((n) => ({
	id: `gtest-${run}-${n}`,
	name: `Player ${n.toUpperCase()}`,
	email: `g-${run}-${n}@test.local`,
}));

/** Plays like a sensible human: best matching cards. */
function pickCards(view: GameView): string[] {
	const targets = view.public.targets;
	const tools = (view.me?.hand ?? []).filter(
		(c): c is ToolCard => c.kind === "tool",
	);
	const matching = tools
		.filter((c) => c.type in targets)
		.sort((a, b) => b.value - a.value);
	const chosen = (matching.length > 0 ? matching : tools).slice(0, 2);
	return chosen.map((c) => c.id);
}

async function playFullGame(
	humans: typeof users,
	code: string,
	opts: { acceptPact: boolean },
) {
	const gameId = (await lobby.getLobby(deps, humans[0] as lobby.Me, code)).id;
	const views: GameView[] = [];
	for (let round = 1; round <= 40; round++) {
		const night = await loop.openNight(deps, gameId, round, D);
		if (night.phase === "ended") break;
		// Re-running a step must not change anything.
		const before = (await loadGame(db, gameId)).game.version;
		await loop.openNight(deps, gameId, round, D);
		expect((await loadGame(db, gameId)).game.version).toBe(before);

		for (const u of humans) {
			const v = await game.getView(deps, u.id, code);
			views.push(v);
			if (v.me?.pactOffer)
				await game.answerPact(deps, u.id, code, opts.acceptPact);
			else await game.ready(deps, u.id, code);
		}
		expect((await loop.phaseStatus(deps, gameId)).complete).toBe(true);

		await loop.openDay(deps, gameId, round, D);
		for (const u of humans) await game.ready(deps, u.id, code);
		expect((await loop.phaseStatus(deps, gameId)).complete).toBe(true);

		await loop.openAction(deps, gameId, round, D);
		for (const u of humans) {
			const v = await game.getView(deps, u.id, code);
			views.push(v);
			const quarantined = v.public.seats.find(
				(s) => s.playerId === v.me?.playerId,
			)?.quarantined;
			if (!quarantined) await game.play(deps, u.id, code, pickCards(v));
		}
		expect((await loop.phaseStatus(deps, gameId)).complete).toBe(true);

		const resolved = await loop.resolve(deps, gameId, round, D);
		await loop.resolve(deps, gameId, round, D); // idempotent
		if (resolved.phase === "ended") break;
		if (resolved.phase === "final") {
			for (const u of humans) await game.vote(deps, u.id, code, null);
			await loop.finish(deps, gameId, round);
			break;
		}
		for (const u of humans) await game.vote(deps, u.id, code, null);
		expect((await loop.phaseStatus(deps, gameId)).complete).toBe(true);
		await loop.closeVotes(deps, gameId, round);
		await loop.closeVotes(deps, gameId, round); // idempotent
	}
	return { gameId, views };
}

describe.skipIf(!dbUp)("game loop + API (Postgres)", () => {
	beforeAll(async () => {
		await db.insert(user).values(users);
	});
	afterAll(async () => {
		await db.delete(games).where(
			inArray(
				games.hostUserId,
				users.map((u) => u.id),
			),
		);
		await db.delete(user).where(
			inArray(
				user.id,
				users.map((u) => u.id),
			),
		);
	});

	it("4 humans play a full game to the end", async () => {
		const [A, B, C, D4] = users as unknown as [
			lobby.Me,
			lobby.Me,
			lobby.Me,
			lobby.Me,
		];
		const { code } = await lobby.createGame(deps, A, "en");
		await lobby.takeSeat(deps, B, code, 1);
		await lobby.takeSeat(deps, C, code, 2);
		await lobby.takeSeat(deps, D4, code, 3);
		await lobby.startGame(deps, A, code);
		sent.length = 0;

		const { gameId, views } = await playFullGame(users, code, {
			acceptPact: true,
		});
		const end = await game.getView(deps, A.id, code);
		expect(end.public.status).toBe("finished");
		expect(end.public.outcome).not.toBeNull();
		expect(end.public.log?.messages.length).toBeGreaterThan(0);
		expect(end.public.log?.names.p1).toBe("Player A");

		// Phase-done events were emitted by the API.
		const names = new Set(sent.map((e) => e.name));
		expect(names).toContain("game/night.ended");
		expect(names).toContain("game/day.ended");
		expect(names).toContain("game/actions.done");

		// Nothing secret reached a client before the end.
		for (const v of views) {
			const pub = JSON.stringify(v.public);
			expect(pub).not.toMatch(/"role"|"truth"|"owner"/);
			expect(v.public.log).toBeNull();
			const others = v.public.seats
				.filter((s) => s.playerId !== v.me?.playerId)
				.map((s) => s.playerId);
			const json = JSON.stringify(v);
			expect(json).not.toContain('"truth"');
			// Only my own private messages.
			for (const m of v.me?.messages ?? [])
				expect(m.kind === "night" || m.kind === "lieDetector").toBe(true);
			expect(others.length).toBe(3);
		}
		// Public channel never carried private data; private channels only to their owners.
		for (const p of published.filter((x) => x.topic === "state")) {
			const st = (p.data as GameView["public"]).status;
			if (st !== "finished")
				expect(JSON.stringify(p.data)).not.toMatch(/"role"|"truth"|"hand"/);
		}
		// Messages were stored with real truth values.
		const rows = await db
			.select()
			.from(messages)
			.where(eq(messages.gameId, gameId));
		expect(rows.length).toBeGreaterThan(0);
		expect(
			rows
				.filter((r) => r.kind === "night")
				.every((r) => typeof r.truth === "boolean"),
		).toBe(true);
	}, 60_000);

	it("1 human + 3 bots plays to the end", async () => {
		const A = users[0] as lobby.Me;
		const { code } = await lobby.createGame(deps, A, "fa");
		await lobby.fillBots(deps, A, code);
		await lobby.startGame(deps, A, code);
		await playFullGame([users[0] as (typeof users)[number]], code, {
			acceptPact: false,
		});
		const end = await game.getView(deps, A.id, code);
		expect(end.public.status).toBe("finished");
	}, 60_000);

	it("rejects actions out of phase, from non-seated users, and illegal plays", async () => {
		const [A, B] = users as unknown as [lobby.Me, lobby.Me];
		const { code } = await lobby.createGame(deps, A, "en");
		await lobby.fillBots(deps, A, code);
		const { id: gameId } = await lobby.startGame(deps, A, code);
		await loop.openNight(deps, gameId, 1, D);
		await expect(game.play(deps, A.id, code, [])).rejects.toMatchObject({
			message: "WRONG_PHASE",
		});
		await expect(game.ready(deps, B.id, code)).rejects.toMatchObject({
			message: "notSeated",
		});
		await game.ready(deps, A.id, code);
		await loop.openDay(deps, gameId, 1, D);
		await loop.openAction(deps, gameId, 1, D);
		const v = await game.getView(deps, A.id, code);
		const action = v.me?.hand.find((c: Card) => c.kind === "action");
		if (action) {
			await expect(
				game.play(deps, A.id, code, [action.id]),
			).rejects.toMatchObject({
				message: "NOT_A_TOOL_CARD",
			});
		}
		// Spectators get the public view only.
		const spect = await game.getView(deps, B.id, code);
		expect(spect.me).toBeNull();
	}, 30_000);

	it("lie detector answers truthfully through the API", async () => {
		const A = users[0] as lobby.Me;
		const { code } = await lobby.createGame(deps, A, "en");
		await lobby.fillBots(deps, A, code);
		const { id: gameId } = await lobby.startGame(deps, A, code);
		await loop.openNight(deps, gameId, 1, D);
		// Give the human a Lie Detector card.
		const g = (await loadGame(db, gameId)).game;
		const st = g.state;
		const p1 = st.players[0];
		if (!p1) throw new Error();
		p1.hand[0] = { id: "ld-test", kind: "action", action: "lieDetector" };
		await db.update(games).set({ state: st }).where(eq(games.id, gameId));
		await game.ready(deps, A.id, code);
		await loop.openDay(deps, gameId, 1, D);
		const r = await game.act(deps, A.id, code, {
			action: "lieDetector",
			claim: { type: "traitorExists" },
		});
		expect(r).toMatchObject({ action: "lieDetector", answer: false });
		const v = await game.getView(deps, A.id, code);
		expect(v.me?.results).toEqual([
			expect.objectContaining({ action: "lieDetector", answer: false }),
		]);
		expect(v.me?.messages.some((m) => m.kind === "lieDetector")).toBe(true);
	}, 30_000);

	it("opening the exit leads to the final vote; 3 votes leave the traitor behind", async () => {
		const [A, B, C, D4] = users as unknown as [
			lobby.Me,
			lobby.Me,
			lobby.Me,
			lobby.Me,
		];
		const { code } = await lobby.createGame(deps, A, "en");
		await lobby.takeSeat(deps, B, code, 1);
		await lobby.takeSeat(deps, C, code, 2);
		await lobby.takeSeat(deps, D4, code, 3);
		const { id: gameId } = await lobby.startGame(deps, A, code);
		await loop.openNight(deps, gameId, 1, D);
		// Test setup: the exit is one push from open and p2 is the traitor.
		const st = (await loadGame(db, gameId)).game.state;
		st.sector = 3;
		st.progress = { power: 5, code: 5, force: 5 };
		st.traitorId = "p2";
		const p2 = st.players.find((p) => p.id === "p2");
		if (p2) p2.role = "traitor";
		await db.update(games).set({ state: st }).where(eq(games.id, gameId));

		for (const u of users) await game.ready(deps, u.id, code);
		await loop.openDay(deps, gameId, 1, D);
		for (const u of users) await game.ready(deps, u.id, code);
		await loop.openAction(deps, gameId, 1, D);
		for (const u of users)
			await game.play(
				deps,
				u.id,
				code,
				pickCards(await game.getView(deps, u.id, code)),
			);
		const resolved = await loop.resolve(deps, gameId, 1, D);
		expect(resolved.phase).toBe("final");

		// The traitor's role is still secret during the final vote.
		const mid = await game.getView(deps, A.id, code);
		expect(JSON.stringify(mid.public)).not.toContain("traitor");

		await game.vote(deps, A.id, code, "p2");
		await game.vote(deps, C.id, code, "p2");
		await game.vote(deps, D4.id, code, "p2");
		await game.vote(deps, B.id, code, "p1");
		expect((await loop.phaseStatus(deps, gameId)).complete).toBe(true);
		await loop.finish(deps, gameId, 1);
		const end = await game.getView(deps, A.id, code);
		expect(end.public.outcome).toMatchObject({
			kind: "escaped",
			escape: "perfect",
			leftBehind: "p2",
		});
		expect(end.public.log?.traitor).toBe("p2");
	}, 30_000);

	it("final vote without 3 agreeing leaves nobody behind", () => {
		expect(
			loop.tallyFinal({ p1: "p2", p2: "p1", p3: "p2", p4: null }),
		).toBeNull();
		expect(loop.tallyFinal({ p1: "p4", p2: "p4", p3: "p4", p4: "p1" })).toBe(
			"p4",
		);
	});
});
