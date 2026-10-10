import type { Database } from "@oracle/db";
import { games, hands, players } from "@oracle/db/schema/game";
import { llmProfiles } from "@oracle/db/schema/llm";
import { deal, PLAYER_COUNT } from "@oracle/engine";
import { gameChannel } from "@oracle/realtime";
import { ORPCError } from "@orpc/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Inngest } from "inngest";

import { gameCreated } from "../events";
import { publishGame } from "../game/publish";
import { enginePlayerId } from "../game/store";
import { defaultProfileId } from "../llm/profiles";
import { generateCode, normalizeCode } from "./code";

export type LobbyDeps = { db: Database; inngest: Inngest.Any };
export type Me = { id: string; name: string };

export type SeatView = {
	seat: number;
	occupied: boolean;
	name: string | null;
	isBot: boolean;
	isHost: boolean;
	isMe: boolean;
};

export type LobbyView = {
	id: string;
	code: string;
	status: "lobby" | "active" | "finished";
	version: number;
	isHost: boolean;
	mySeat: number | null;
	seats: SeatView[];
	oracle: { choice: string; name: string | null };
};

const fail = (
	code: "NOT_FOUND" | "FORBIDDEN" | "CONFLICT" | "BAD_REQUEST",
	key: string,
) => new ORPCError(code, { message: key });

function isUniqueViolation(e: unknown): boolean {
	const err = e as { code?: string; cause?: { code?: string } };
	return err?.code === "23505" || err?.cause?.code === "23505";
}

async function findGame(db: Database, code: string) {
	const [game] = await db
		.select({
			id: games.id,
			code: games.code,
			status: games.status,
			version: games.version,
			hostUserId: games.hostUserId,
			oracleProfile: games.oracleProfile,
		})
		.from(games)
		.where(eq(games.code, normalizeCode(code)));
	if (!game) throw fail("NOT_FOUND", "gameNotFound");
	return game;
}

async function bump(deps: LobbyDeps, gameId: string): Promise<void> {
	const [row] = await deps.db
		.update(games)
		.set({ version: sql`${games.version} + 1` })
		.where(eq(games.id, gameId))
		.returning({ version: games.version });
	try {
		await deps.inngest.realtime.publish(gameChannel({ gameId }).lobby, {
			version: row?.version ?? 0,
		});
	} catch (e) {
		// Clients also refetch on focus/interval; a missed push is not fatal.
		console.error("realtime publish failed", e);
	}
}

export async function getLobby(
	deps: LobbyDeps,
	me: Me,
	code: string,
): Promise<LobbyView> {
	const game = await findGame(deps.db, code);
	// Never select role here: this goes to clients.
	const rows = await deps.db
		.select({
			seat: players.seat,
			name: players.name,
			isBot: players.isBot,
			userId: players.userId,
		})
		.from(players)
		.where(eq(players.gameId, game.id));
	const seats: SeatView[] = Array.from({ length: PLAYER_COUNT }, (_, seat) => {
		const p = rows.find((r) => r.seat === seat);
		return {
			seat,
			occupied: Boolean(p),
			name: p?.name ?? null,
			isBot: p?.isBot ?? false,
			isHost: Boolean(p?.userId && p.userId === game.hostUserId),
			isMe: Boolean(p?.userId && p.userId === me.id),
		};
	});
	return {
		id: game.id,
		code: game.code,
		status: game.status,
		version: game.version,
		isHost: game.hostUserId === me.id,
		mySeat: seats.find((s) => s.isMe)?.seat ?? null,
		seats,
		oracle: await oracleChoiceView(deps.db, game.oracleProfile),
	};
}

/** Who speaks as the Oracle: "default" | "scripted" | a profile id (name shown, never keys). */
async function oracleChoiceView(
	db: Database,
	choice: string,
): Promise<LobbyView["oracle"]> {
	if (choice === "default" || choice === "scripted")
		return { choice, name: null };
	const [row] = await db
		.select({ name: llmProfiles.name, model: llmProfiles.model })
		.from(llmProfiles)
		.where(eq(llmProfiles.id, choice));
	return { choice, name: row ? `${row.name} · ${row.model}` : null };
}

/** Enabled profiles the host can pick from, and the current default. */
export async function oracleOptions(db: Database) {
	const rows = await db
		.select({
			id: llmProfiles.id,
			name: llmProfiles.name,
			provider: llmProfiles.provider,
			model: llmProfiles.model,
			isDefault: llmProfiles.isDefault,
		})
		.from(llmProfiles)
		.where(eq(llmProfiles.enabled, true))
		.orderBy(llmProfiles.name);
	return rows;
}

export async function setOracle(
	deps: LobbyDeps,
	me: Me,
	code: string,
	choice: string,
) {
	const game = await hostGame(deps, me, code);
	if (choice !== "default" && choice !== "scripted") {
		const options = await oracleOptions(deps.db);
		if (!options.some((o) => o.id === choice))
			throw fail("BAD_REQUEST", "profileNotFound");
	}
	await deps.db
		.update(games)
		.set({ oracleProfile: choice })
		.where(eq(games.id, game.id));
	await bump(deps, game.id);
	return getLobby(deps, me, code);
}

export async function createGame(
	deps: LobbyDeps,
	me: Me,
	/** Language the Oracle speaks in this game. */
	language: "fa" | "en" = "fa",
): Promise<{ code: string }> {
	for (let attempt = 0; attempt < 5; attempt++) {
		const id = crypto.randomUUID();
		const code = generateCode();
		try {
			await deps.db.transaction(async (tx) => {
				await tx
					.insert(games)
					.values({ id, code, hostUserId: me.id, seed: "", language });
				await tx.insert(players).values({
					id: crypto.randomUUID(),
					gameId: id,
					userId: me.id,
					seat: 0,
					name: me.name,
				});
			});
			return { code };
		} catch (e) {
			if (!isUniqueViolation(e)) throw e;
		}
	}
	throw fail("CONFLICT", "codeCollision");
}

function assertLobby(game: { status: string }) {
	if (game.status !== "lobby") throw fail("BAD_REQUEST", "gameAlreadyStarted");
}

function assertSeat(seat: number) {
	if (!Number.isInteger(seat) || seat < 0 || seat >= PLAYER_COUNT) {
		throw fail("BAD_REQUEST", "badSeat");
	}
}

/** Sit down, or move to another free seat if already seated. */
export async function takeSeat(
	deps: LobbyDeps,
	me: Me,
	code: string,
	seat: number,
) {
	assertSeat(seat);
	const game = await findGame(deps.db, code);
	assertLobby(game);
	try {
		await deps.db.transaction(async (tx) => {
			const [existing] = await tx
				.select({ id: players.id })
				.from(players)
				.where(and(eq(players.gameId, game.id), eq(players.userId, me.id)));
			if (existing) {
				await tx
					.update(players)
					.set({ seat, name: me.name })
					.where(eq(players.id, existing.id));
			} else {
				await tx.insert(players).values({
					id: crypto.randomUUID(),
					gameId: game.id,
					userId: me.id,
					seat,
					name: me.name,
				});
			}
		});
	} catch (e) {
		if (isUniqueViolation(e)) throw fail("CONFLICT", "seatTaken");
		throw e;
	}
	await bump(deps, game.id);
	return getLobby(deps, me, code);
}

export async function leaveSeat(deps: LobbyDeps, me: Me, code: string) {
	const game = await findGame(deps.db, code);
	assertLobby(game);
	await deps.db
		.delete(players)
		.where(and(eq(players.gameId, game.id), eq(players.userId, me.id)));
	await bump(deps, game.id);
	return getLobby(deps, me, code);
}

async function hostGame(deps: LobbyDeps, me: Me, code: string) {
	const game = await findGame(deps.db, code);
	if (game.hostUserId !== me.id) throw fail("FORBIDDEN", "hostOnly");
	assertLobby(game);
	return game;
}

export async function addBot(
	deps: LobbyDeps,
	me: Me,
	code: string,
	seat: number,
) {
	assertSeat(seat);
	const game = await hostGame(deps, me, code);
	try {
		await deps.db.insert(players).values({
			id: crypto.randomUUID(),
			gameId: game.id,
			userId: null,
			seat,
			name: `Bot ${seat + 1}`,
			isBot: true,
		});
	} catch (e) {
		if (isUniqueViolation(e)) throw fail("CONFLICT", "seatTaken");
		throw e;
	}
	await bump(deps, game.id);
	return getLobby(deps, me, code);
}

/** Host removes whoever sits in a seat (bot or human). */
export async function clearSeat(
	deps: LobbyDeps,
	me: Me,
	code: string,
	seat: number,
) {
	assertSeat(seat);
	const game = await hostGame(deps, me, code);
	await deps.db
		.delete(players)
		.where(and(eq(players.gameId, game.id), eq(players.seat, seat)));
	await bump(deps, game.id);
	return getLobby(deps, me, code);
}

export async function fillBots(deps: LobbyDeps, me: Me, code: string) {
	const game = await hostGame(deps, me, code);
	const taken = await deps.db
		.select({ seat: players.seat })
		.from(players)
		.where(eq(players.gameId, game.id));
	const free = Array.from({ length: PLAYER_COUNT }, (_, s) => s).filter(
		(s) => !taken.some((t) => t.seat === s),
	);
	if (free.length > 0) {
		await deps.db
			.insert(players)
			.values(
				free.map((seat) => ({
					id: crypto.randomUUID(),
					gameId: game.id,
					userId: null,
					seat,
					name: `Bot ${seat + 1}`,
					isBot: true,
				})),
			)
			.onConflictDoNothing();
	}
	await bump(deps, game.id);
	return getLobby(deps, me, code);
}

/** Deals the game, stores the engine state and its projections, then kicks off the game loop. */
export async function startGame(deps: LobbyDeps, me: Me, code: string) {
	const game = await hostGame(deps, me, code);
	const seed = crypto.randomUUID();
	// Pin the Oracle for the whole game: later changes to the default don't affect it.
	const oracleProfile =
		game.oracleProfile === "default"
			? ((await defaultProfileId(deps.db)) ?? "scripted")
			: game.oracleProfile;
	await deps.db.transaction(async (tx) => {
		// Lock the row so two "start" clicks cannot both deal.
		const [locked] = await tx
			.select({ status: games.status })
			.from(games)
			.where(eq(games.id, game.id))
			.for("update");
		if (locked?.status !== "lobby")
			throw fail("BAD_REQUEST", "gameAlreadyStarted");

		const seated = await tx
			.select({ id: players.id, seat: players.seat })
			.from(players)
			.where(eq(players.gameId, game.id));
		if (seated.length !== PLAYER_COUNT)
			throw fail("BAD_REQUEST", "seatsNotFull");

		const state = deal({
			seed,
			playerIds: Array.from({ length: PLAYER_COUNT }, (_, s) =>
				enginePlayerId(s),
			),
		});
		const rowIdBySeat = new Map(seated.map((p) => [p.seat, p.id]));

		await tx
			.update(games)
			.set({
				status: "active",
				seed,
				oracleProfile,
				state,
				round: state.round,
				phase: state.phase,
				lockdown: state.lockdown,
				sector: state.sector,
				progress: state.progress,
				jam: state.jam,
				threatDeck: state.threatDeck,
			})
			.where(eq(games.id, game.id));
		await tx
			.update(players)
			.set({ role: "innocent" })
			.where(
				and(
					eq(players.gameId, game.id),
					inArray(
						players.id,
						seated.map((p) => p.id),
					),
				),
			);
		await tx.insert(hands).values(
			state.players.flatMap((p) =>
				p.hand.map((card) => ({
					gameId: game.id,
					playerId: rowIdBySeat.get(p.seat) as string,
					cardId: card.id,
					card,
				})),
			),
		);
	});
	await deps.inngest.send(gameCreated.create({ gameId: game.id }));
	await bump(deps, game.id);
	await publishGame(deps, game.id);
	return getLobby(deps, me, code);
}

export type MyGame = {
	code: string;
	status: string;
	seat: number;
	updatedAt: Date;
};

export async function myGames(deps: LobbyDeps, me: Me): Promise<MyGame[]> {
	return deps.db
		.select({
			code: games.code,
			status: games.status,
			seat: players.seat,
			updatedAt: games.updatedAt,
		})
		.from(players)
		.innerJoin(games, eq(games.id, players.gameId))
		.where(
			and(
				eq(players.userId, me.id),
				inArray(games.status, ["lobby", "active"]),
			),
		)
		.orderBy(sql`${games.updatedAt} desc`)
		.limit(10);
}

export async function gameIdForCode(
	db: Database,
	code: string,
): Promise<string> {
	return (await findGame(db, code)).id;
}
