import type { Database } from "@oracle/db";
import { chatMessages, players, votes } from "@oracle/db/schema/game";
import {
	type GameState,
	playerView,
	publicView,
	revealLog,
} from "@oracle/engine";
import type {
	ActionResultView,
	ChatMessage,
	GameView,
	PrivateView,
	PublicGameView,
	SeatStatus,
} from "@oracle/realtime";
import { and, desc, eq } from "drizzle-orm";

import {
	enginePlayerId,
	type GameRow,
	readyKey,
	type SeatRow,
	type Tx,
} from "./store";

export type VoteRow = { voterId: string; targetId: string | null };

export const voteKind = (state: GameState): "final" | "quarantine" =>
	state.phase === "final" ? "final" : "quarantine";

/** Votes for the current round and phase, keyed by engine player id. */
export async function currentVotes(
	db: Database | Tx,
	game: GameRow,
	seats: SeatRow[],
) {
	const rows = await db
		.select({ voterId: votes.voterId, targetId: votes.targetId })
		.from(votes)
		.where(
			and(
				eq(votes.gameId, game.id),
				eq(votes.round, game.state.round),
				eq(votes.kind, voteKind(game.state)),
			),
		);
	const engineId = (rowId: string | null) => {
		const s = seats.find((x) => x.id === rowId);
		return s ? enginePlayerId(s.seat) : null;
	};
	const out: Record<string, string | null> = {};
	for (const r of rows) {
		const voter = engineId(r.voterId);
		if (voter) out[voter] = engineId(r.targetId);
	}
	return out;
}

export function names(seats: SeatRow[]): Record<string, string> {
	return Object.fromEntries(seats.map((s) => [enginePlayerId(s.seat), s.name]));
}

function seatStatus(
	state: GameState,
	seat: SeatRow,
	voted: Record<string, string | null>,
): SeatStatus {
	const id = enginePlayerId(seat.seat);
	const p = state.players.find((x) => x.id === id);
	switch (state.phase) {
		case "night":
		case "day":
			return seat.readyKey === readyKey(state) ? "done" : "waiting";
		case "action":
			if (p?.quarantined) return "quarantined";
			return state.actedThisRound.includes(id) ? "done" : "waiting";
		case "vote":
		case "final":
			return id in voted ? "done" : "waiting";
		default:
			return "waiting";
	}
}

/** Tabs check in every 15s; a human silent for 45s is shown as away. */
export const AWAY_AFTER_MS = 45_000;
const isAway = (s: SeatRow) =>
	!s.isBot &&
	(!s.lastSeenAt || Date.now() - s.lastSeenAt.getTime() > AWAY_AFTER_MS);

export function buildPublic(
	game: GameRow,
	seats: SeatRow[],
	voted: Record<string, string | null>,
): PublicGameView {
	const state = game.state;
	const pub = publicView(state);
	const lastPile = [...state.feed]
		.reverse()
		.find((f) => f.kind === "pileRevealed");
	return {
		gameId: game.id,
		code: game.code,
		status: state.phase === "ended" ? "finished" : game.status,
		version: game.version,
		round: pub.round,
		phase: pub.phase,
		deadline: game.phaseDeadline ? game.phaseDeadline.toISOString() : null,
		lockdown: pub.lockdown,
		sector: pub.sector,
		lockName: pub.lockName,
		targets: pub.targets,
		progress: pub.progress,
		jam: pub.jam,
		deckCount: pub.deckCount,
		seats: seats.map((s) => {
			const p = pub.players.find((x) => x.seat === s.seat);
			return {
				playerId: enginePlayerId(s.seat),
				seat: s.seat,
				name: s.name,
				isBot: s.isBot,
				quarantined: p?.quarantined ?? false,
				handCount: p?.handCount ?? 0,
				status: seatStatus(state, s, voted),
				away: isAway(s),
			};
		}),
		pile: pub.pile,
		pileRound: lastPile?.round ?? null,
		feed: pub.feed,
		publicMessages: pub.publicMessages,
		outcome: pub.outcome,
		log:
			state.phase === "ended"
				? { ...revealLog(state), names: names(seats) }
				: null,
	};
}

function results(state: GameState, me: string): ActionResultView[] {
	const out: ActionResultView[] = [];
	for (const u of state.actionUses) {
		if (u.player !== me) continue;
		switch (u.action) {
			case "decoder": {
				const msg = state.messages.find(
					(m) => m.kind === "night" && m.round === u.round && m.to === u.target,
				);
				out.push({
					round: u.round,
					action: "decoder",
					target: u.target ?? "",
					message: msg?.text ?? null,
				});
				break;
			}
			case "lieDetector":
				if (u.claim)
					out.push({
						round: u.round,
						action: "lieDetector",
						claim: u.claim,
						answer: u.answer ?? false,
					});
				break;
			case "scanner": {
				const play = state.plays.find(
					(p) => p.round === u.round && p.pileIndex === u.pileIndex,
				);
				if (play) {
					out.push({
						round: u.round,
						action: "scanner",
						pileIndex: play.pileIndex ?? 0,
						card: play.card,
						owner: play.owner,
					});
				}
				break;
			}
			case "shield":
			case "override":
				out.push({ round: u.round, action: u.action });
				break;
		}
	}
	return out;
}

export function buildPrivate(
	state: GameState,
	seat: SeatRow,
	voted: Record<string, string | null>,
): PrivateView {
	const id = enginePlayerId(seat.seat);
	const v = playerView(state, id);
	return {
		playerId: id,
		seat: seat.seat,
		role: v.me.role,
		hand: v.me.hand,
		messages: v.me.messages,
		pactOffer: v.me.pactOffer ? { round: v.me.pactOffer.round } : null,
		results: results(state, id),
		ready: seat.readyKey === readyKey(state),
		acted: state.actedThisRound.includes(id),
		myVote: id in voted ? voted[id] : undefined,
	};
}

export async function recentChat(
	db: Database | Tx,
	gameId: string,
	seats: SeatRow[],
): Promise<ChatMessage[]> {
	const rows = await db
		.select({
			id: chatMessages.id,
			round: chatMessages.round,
			playerRowId: chatMessages.playerId,
			text: chatMessages.text,
			at: chatMessages.createdAt,
		})
		.from(chatMessages)
		.where(eq(chatMessages.gameId, gameId))
		.orderBy(desc(chatMessages.createdAt))
		.limit(100);
	return rows.reverse().map((r) => {
		const s = seats.find((x) => x.id === r.playerRowId);
		return {
			id: r.id,
			round: r.round,
			playerId: s ? enginePlayerId(s.seat) : "?",
			name: s?.name ?? "?",
			text: r.text,
			at: r.at.toISOString(),
		};
	});
}

export async function buildGameView(
	db: Database,
	game: GameRow,
	seats: SeatRow[],
	userId: string,
): Promise<GameView> {
	return viewForSeat(
		db,
		game,
		seats,
		seats.find((s) => s.userId === userId),
	);
}

/** The view a given seat sees (null seat = spectator). Bots get exactly this, never GameState. */
export async function viewForSeat(
	db: Database,
	game: GameRow,
	seats: SeatRow[],
	seat: SeatRow | undefined,
): Promise<GameView> {
	const voted = await currentVotes(db, game, seats);
	return {
		public: buildPublic(game, seats, voted),
		me: seat ? buildPrivate(game.state, seat, voted) : null,
		chat: await recentChat(db, game.id, seats),
	};
}

/** Seat row of the signed-in user, or a FORBIDDEN error. */
export async function seatOfUser(
	db: Database | Tx,
	gameId: string,
	userId: string,
) {
	const [row] = await db
		.select({ id: players.id, seat: players.seat })
		.from(players)
		.where(and(eq(players.gameId, gameId), eq(players.userId, userId)));
	return row ?? null;
}
