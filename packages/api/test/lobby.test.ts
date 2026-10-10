import { createDb } from "@oracle/db";
import { user } from "@oracle/db/schema/auth";
import { games, hands, players } from "@oracle/db/schema/game";
import { eq, inArray } from "drizzle-orm";
import type { Inngest } from "inngest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as lobby from "../src/lobby/service";

// Integration tests against the local Postgres (bun run db:start + db:migrate).
const url =
	process.env.DATABASE_URL ??
	"postgresql://postgres:password@localhost:5432/oracle";
const db = createDb({ DATABASE_URL: url });
const dbUp = await db
	.execute("select 1")
	.then(() => true)
	.catch(() => false);

const sent: unknown[] = [];
const published: unknown[] = [];
const inngest = {
	send: async (e: unknown) => {
		sent.push(e);
		return { ids: ["x"] };
	},
	realtime: {
		publish: async (
			topic: { channel: string; topic: string },
			data: unknown,
		) => {
			published.push({ channel: topic.channel, topic: topic.topic, data });
		},
	},
} as unknown as Inngest.Any;
const deps = { db, inngest };

const run = Date.now().toString(36);
const users = ["a", "b", "c", "d", "e"].map((n) => ({
	id: `test-${run}-${n}`,
	name: `User ${n.toUpperCase()}`,
	email: `${run}-${n}@test.local`,
}));
const [A, B, C, D, E] = users as unknown as [
	lobby.Me,
	lobby.Me,
	lobby.Me,
	lobby.Me,
	lobby.Me,
];

describe.skipIf(!dbUp)("lobby (Postgres)", () => {
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

	it("creates a game with a 5-char code and seats the host", async () => {
		const { code } = await lobby.createGame(deps, A);
		expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}$/);
		const view = await lobby.getLobby(deps, A, code.toLowerCase());
		expect(view).toMatchObject({ status: "lobby", isHost: true, mySeat: 0 });
		expect(view.seats[0]).toMatchObject({
			occupied: true,
			name: "User A",
			isHost: true,
			isMe: true,
		});
		expect(view.seats.slice(1).every((s) => !s.occupied)).toBe(true);
	});

	it("lets players take, move and leave seats; seats are exclusive", async () => {
		const { code } = await lobby.createGame(deps, A);
		await lobby.takeSeat(deps, B, code, 2);
		await expect(lobby.takeSeat(deps, C, code, 2)).rejects.toMatchObject({
			message: "seatTaken",
		});
		let v = await lobby.takeSeat(deps, B, code, 3);
		expect(v.mySeat).toBe(3);
		expect(v.seats[2]?.occupied).toBe(false);
		v = await lobby.leaveSeat(deps, B, code);
		expect(v.mySeat).toBeNull();
		expect(v.seats.filter((s) => s.occupied)).toHaveLength(1);
	});

	it("only the host manages bots and starts the game", async () => {
		const { code } = await lobby.createGame(deps, A);
		await expect(lobby.addBot(deps, B, code, 1)).rejects.toMatchObject({
			message: "hostOnly",
		});
		await expect(lobby.fillBots(deps, B, code)).rejects.toMatchObject({
			message: "hostOnly",
		});
		await expect(lobby.startGame(deps, B, code)).rejects.toMatchObject({
			message: "hostOnly",
		});
		const v = await lobby.addBot(deps, A, code, 1);
		expect(v.seats[1]).toMatchObject({ occupied: true, isBot: true });
		const cleared = await lobby.clearSeat(deps, A, code, 1);
		expect(cleared.seats[1]?.occupied).toBe(false);
	});

	it("cannot start until all 4 seats are filled", async () => {
		const { code } = await lobby.createGame(deps, A);
		await expect(lobby.startGame(deps, A, code)).rejects.toMatchObject({
			message: "seatsNotFull",
		});
	});

	it("1 human + 3 bots: fills, deals, stores state and sends game/created", async () => {
		const { code } = await lobby.createGame(deps, A);
		const filled = await lobby.fillBots(deps, A, code);
		expect(filled.seats.every((s) => s.occupied)).toBe(true);
		expect(filled.seats.filter((s) => s.isBot)).toHaveLength(3);

		sent.length = 0;
		const v = await lobby.startGame(deps, A, code);
		expect(v.status).toBe("active");
		expect(sent).toEqual([
			expect.objectContaining({ name: "game/created", data: { gameId: v.id } }),
		]);

		const [g] = await db.select().from(games).where(eq(games.id, v.id));
		expect(g?.seed).not.toBe("");
		expect(
			(g?.state as { players: unknown[] } | undefined)?.players,
		).toHaveLength(4);
		const handRows = await db
			.select()
			.from(hands)
			.where(eq(hands.gameId, v.id));
		expect(handRows).toHaveLength(20);
		const ps = await db.select().from(players).where(eq(players.gameId, v.id));
		expect(ps.every((p) => p.role === "innocent")).toBe(true);

		await expect(lobby.startGame(deps, A, code)).rejects.toMatchObject({
			message: "gameAlreadyStarted",
		});
		await expect(lobby.takeSeat(deps, E, code, 1)).rejects.toMatchObject({
			message: "gameAlreadyStarted",
		});
	});

	it("4 humans can fill the table", async () => {
		const { code } = await lobby.createGame(deps, A);
		await lobby.takeSeat(deps, B, code, 1);
		await lobby.takeSeat(deps, C, code, 2);
		await lobby.takeSeat(deps, D, code, 3);
		const v = await lobby.startGame(deps, A, code);
		expect(v.seats.every((s) => s.occupied && !s.isBot)).toBe(true);
		const mine = await lobby.myGames(deps, D);
		expect(
			mine.some(
				(g) => g.code === code && g.status === "active" && g.seat === 3,
			),
		).toBe(true);
	});

	it("never exposes roles in the lobby view", async () => {
		const { code } = await lobby.createGame(deps, A);
		await lobby.fillBots(deps, A, code);
		await lobby.startGame(deps, A, code);
		const json = JSON.stringify(await lobby.getLobby(deps, B, code));
		expect(json).not.toMatch(/role|innocent|traitor/);
	});

	it("publishes a lobby update on the public game channel after each change", async () => {
		published.length = 0;
		const { code } = await lobby.createGame(deps, A);
		const v = await lobby.takeSeat(deps, B, code, 1);
		expect(published).toEqual([
			{ channel: `game:${v.id}`, topic: "lobby", data: { version: v.version } },
		]);
	});

	it("unknown codes are a 404", async () => {
		await expect(lobby.getLobby(deps, A, "ZZZZZ")).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});

	it("start is safe against double clicks", async () => {
		const { code } = await lobby.createGame(deps, A);
		await lobby.fillBots(deps, A, code);
		sent.length = 0;
		const results = await Promise.allSettled([
			lobby.startGame(deps, A, code),
			lobby.startGame(deps, A, code),
		]);
		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
		expect(sent).toHaveLength(1);
	});
});
