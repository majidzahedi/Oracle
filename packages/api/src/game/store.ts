import type { Database } from "@oracle/db";
import {
	games,
	hands,
	messages,
	pactOffers,
	players,
	plays,
} from "@oracle/db/schema/game";
import type { GameState } from "@oracle/engine";
import { ORPCError } from "@orpc/server";
import { and, eq, sql } from "drizzle-orm";

export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type SeatRow = {
	id: string;
	seat: number;
	userId: string | null;
	name: string;
	isBot: boolean;
	readyKey: string | null;
	lastSeenAt: Date | null;
};

export type GameRow = {
	id: string;
	code: string;
	status: "lobby" | "active" | "finished";
	language: "fa" | "en";
	/** Pinned at start: "scripted" or an LLM profile id. */
	oracleProfile: string;
	/** Decision engine pinned at start: a profile id, or "none". */
	decisionProfile: string;
	version: number;
	phaseDeadline: Date | null;
	state: GameState;
};

/** Engine player ids are seat-based ("p1".."p4") so claims and prompts stay readable. */
export const enginePlayerId = (seat: number) => `p${seat + 1}`;
export const seatOf = (playerId: string) => Number(playerId.slice(1)) - 1;
export const readyKey = (state: Pick<GameState, "round" | "phase">) =>
	`${state.round}:${state.phase}`;

export const gameError = (
	code: "NOT_FOUND" | "FORBIDDEN" | "CONFLICT" | "BAD_REQUEST",
	key: string,
) => new ORPCError(code, { message: key });

const gameColumns = {
	id: games.id,
	code: games.code,
	status: games.status,
	language: games.language,
	oracleProfile: games.oracleProfile,
	decisionProfile: games.decisionProfile,
	version: games.version,
	phaseDeadline: games.phaseDeadline,
	state: games.state,
};

const seatColumns = {
	id: players.id,
	seat: players.seat,
	userId: players.userId,
	name: players.name,
	isBot: players.isBot,
	readyKey: players.readyKey,
	lastSeenAt: players.lastSeenAt,
};

export async function loadGame(db: Database | Tx, gameId: string) {
	const [game] = await db
		.select(gameColumns)
		.from(games)
		.where(eq(games.id, gameId));
	if (!game?.state) throw gameError("NOT_FOUND", "gameNotFound");
	const seats = await db
		.select(seatColumns)
		.from(players)
		.where(eq(players.gameId, gameId))
		.orderBy(players.seat);
	return { game: game as GameRow, seats: seats as SeatRow[] };
}

export async function gameIdByCode(
	db: Database,
	code: string,
): Promise<string> {
	const [row] = await db
		.select({ id: games.id })
		.from(games)
		.where(eq(games.code, code.trim().toUpperCase()));
	if (!row) throw gameError("NOT_FOUND", "gameNotFound");
	return row.id;
}

export type MutateCtx = { tx: Tx; game: GameRow; seats: SeatRow[] };
export type MutateOutput<R> = {
	state: GameState;
	result: R;
	/** undefined = keep; null = clear */
	deadline?: Date | null;
};

/**
 * The single write path for game state. Locks the game row, runs `fn` against
 * the current state, then saves the new state and its projections in the same
 * transaction. Returning null means "no change" (used for idempotent steps).
 */
export async function mutateGame<R>(
	db: Database,
	gameId: string,
	fn: (
		state: GameState,
		ctx: MutateCtx,
	) => Promise<MutateOutput<R> | null> | MutateOutput<R> | null,
): Promise<{ changed: boolean; result: R | null; state: GameState }> {
	return db.transaction(async (tx) => {
		const [locked] = await tx
			.select(gameColumns)
			.from(games)
			.where(eq(games.id, gameId))
			.for("update");
		if (!locked?.state) throw gameError("NOT_FOUND", "gameNotFound");
		const game = locked as GameRow;
		const seats = (await tx
			.select(seatColumns)
			.from(players)
			.where(eq(players.gameId, gameId))
			.orderBy(players.seat)) as SeatRow[];
		const out = await fn(game.state, { tx, game, seats });
		if (!out) return { changed: false, result: null, state: game.state };
		await saveState(tx, gameId, out.state, seats, out.deadline);
		return { changed: true, result: out.result, state: out.state };
	});
}

async function saveState(
	tx: Tx,
	gameId: string,
	state: GameState,
	seats: SeatRow[],
	deadline?: Date | null,
) {
	const rowId = (playerId: string) => {
		const row = seats.find((s) => s.seat === seatOf(playerId));
		if (!row) throw new Error(`no seat row for ${playerId}`);
		return row.id;
	};

	await tx
		.update(games)
		.set({
			state,
			status: state.phase === "ended" ? "finished" : "active",
			round: state.round,
			phase: state.phase,
			lockdown: state.lockdown,
			sector: state.sector,
			progress: state.progress,
			jam: state.jam,
			threatDeck: state.threatDeck,
			version: sql`${games.version} + 1`,
			...(deadline !== undefined ? { phaseDeadline: deadline } : {}),
		})
		.where(eq(games.id, gameId));

	for (const p of state.players) {
		await tx
			.update(players)
			.set({ role: p.role, quarantined: p.quarantined })
			.where(and(eq(players.gameId, gameId), eq(players.seat, p.seat)));
	}

	// Hands change every phase; they are small, so rewrite them.
	await tx.delete(hands).where(eq(hands.gameId, gameId));
	const handRows = state.players.flatMap((p) =>
		p.hand.map((card) => ({
			gameId,
			playerId: rowId(p.id),
			cardId: card.id,
			card,
		})),
	);
	if (handRows.length > 0) await tx.insert(hands).values(handRows);

	if (state.plays.length > 0) {
		await tx
			.insert(plays)
			.values(
				state.plays.map((p) => ({
					gameId,
					round: p.round,
					cardId: p.card.id,
					ownerId: rowId(p.owner),
					card: p.card,
					offType: p.offType,
					pileIndex: p.pileIndex,
					auto: p.auto,
				})),
			)
			.onConflictDoUpdate({
				target: [plays.gameId, plays.round, plays.cardId],
				set: { pileIndex: sql`excluded.pile_index` },
			});
	}

	if (state.messages.length > 0) {
		await tx
			.insert(messages)
			.values(
				state.messages.map((m) => ({
					gameId,
					id: m.id,
					round: m.round,
					recipientId: m.to ? rowId(m.to) : null,
					kind: m.kind,
					text: m.text,
					claim: m.claim,
					truth: m.truth,
				})),
			)
			.onConflictDoNothing();
	}

	if (state.pactOffers.length > 0) {
		await tx
			.insert(pactOffers)
			.values(
				state.pactOffers.map((o) => ({
					gameId,
					round: o.round,
					playerId: rowId(o.player),
					accepted: o.accepted,
				})),
			)
			.onConflictDoUpdate({
				target: [pactOffers.gameId, pactOffers.round],
				set: { accepted: sql`excluded.accepted` },
			});
	}
}

/** Marks seats as ready for the current phase (bots, or a player who pressed Ready). */
export async function setReady(
	tx: Tx | Database,
	gameId: string,
	seatIds: string[],
	key: string,
) {
	for (const id of seatIds) {
		await tx
			.update(players)
			.set({ readyKey: key })
			.where(and(eq(players.gameId, gameId), eq(players.id, id)));
	}
}
