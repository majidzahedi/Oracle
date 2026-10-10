import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth";

/**
 * `games.state` holds the authoritative engine GameState (server-only). The other
 * columns and tables are projections of it, written in the same transaction, for
 * queries, the API and the post-game log. Roles and truth values live only in
 * server-side columns and are never selected into client responses before the end.
 */
export const games = pgTable(
	"games",
	{
		id: text("id").primaryKey(),
		code: text("code").notNull().unique(),
		hostUserId: text("host_user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		status: text("status", { enum: ["lobby", "active", "finished"] })
			.notNull()
			.default("lobby"),
		round: integer("round").notNull().default(0),
		phase: text("phase").notNull().default("setup"),
		lockdown: integer("lockdown").notNull().default(0),
		sector: integer("sector").notNull().default(0),
		progress: jsonb("progress")
			.$type<{ power: number; code: number; force: number }>()
			.notNull()
			.default({ power: 0, code: 0, force: 0 }),
		jam: integer("jam").notNull().default(0),
		seed: text("seed").notNull(),
		/** Language the Oracle speaks in this game. */
		language: text("language", { enum: ["fa", "en"] })
			.notNull()
			.default("fa"),
		/**
		 * Which Oracle runs this game. In the lobby: "default" | "scripted" | a profile id.
		 * At start, "default" is resolved to the current default profile (or "scripted").
		 */
		oracleProfile: text("oracle_profile").notNull().default("default"),
		threatDeck: jsonb("threat_deck").$type<string[]>().notNull().default([]),
		state: jsonb("state").$type<unknown>(),
		/** Bumped on every write; used for optimistic concurrency and client refetches. */
		version: integer("version").notNull().default(0),
		phaseDeadline: timestamp("phase_deadline"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(t) => [index("games_status_idx").on(t.status)],
);

export const players = pgTable(
	"players",
	{
		id: text("id").primaryKey(),
		gameId: text("game_id")
			.notNull()
			.references(() => games.id, { onDelete: "cascade" }),
		/** null for bots */
		userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
		seat: integer("seat").notNull(),
		name: text("name").notNull(),
		isBot: boolean("is_bot").notNull().default(false),
		/** null until the game starts. Secret. */
		role: text("role", { enum: ["innocent", "traitor"] }),
		quarantined: boolean("quarantined").notNull().default(false),
		/** `${round}:${phase}` when the player pressed Ready (or answered the Pact) in that phase. */
		readyKey: text("ready_key"),
		lastSeenAt: timestamp("last_seen_at"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(t) => [
		uniqueIndex("players_game_seat_uq").on(t.gameId, t.seat),
		uniqueIndex("players_game_user_uq").on(t.gameId, t.userId),
		index("players_user_idx").on(t.userId),
	],
);

export const hands = pgTable(
	"hands",
	{
		gameId: text("game_id")
			.notNull()
			.references(() => games.id, { onDelete: "cascade" }),
		playerId: text("player_id")
			.notNull()
			.references(() => players.id, { onDelete: "cascade" }),
		cardId: text("card_id").notNull(),
		card: jsonb("card").notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.gameId, t.cardId] }),
		index("hands_player_idx").on(t.playerId),
	],
);

export const plays = pgTable(
	"plays",
	{
		gameId: text("game_id")
			.notNull()
			.references(() => games.id, { onDelete: "cascade" }),
		round: integer("round").notNull(),
		cardId: text("card_id").notNull(),
		ownerId: text("owner_id")
			.notNull()
			.references(() => players.id, { onDelete: "cascade" }),
		card: jsonb("card").notNull(),
		offType: boolean("off_type").notNull(),
		pileIndex: integer("pile_index"),
		auto: boolean("auto").notNull().default(false),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(t) => [primaryKey({ columns: [t.gameId, t.round, t.cardId] })],
);

/** Oracle messages. recipientId null = public. truth is the engine-computed real value. */
export const messages = pgTable(
	"messages",
	{
		gameId: text("game_id")
			.notNull()
			.references(() => games.id, { onDelete: "cascade" }),
		/** Engine message id (unique within a game). */
		id: text("id").notNull(),
		round: integer("round").notNull(),
		recipientId: text("recipient_id").references(() => players.id, {
			onDelete: "cascade",
		}),
		kind: text("kind").notNull(),
		text: text("text").notNull(),
		claim: jsonb("claim"),
		truth: boolean("truth"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.gameId, t.id] }),
		index("messages_recipient_idx").on(t.gameId, t.recipientId),
	],
);

/** Player-to-player chat during the game. */
export const chatMessages = pgTable(
	"chat_messages",
	{
		id: text("id").primaryKey(),
		gameId: text("game_id")
			.notNull()
			.references(() => games.id, { onDelete: "cascade" }),
		round: integer("round").notNull(),
		playerId: text("player_id")
			.notNull()
			.references(() => players.id, { onDelete: "cascade" }),
		text: text("text").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(t) => [index("chat_game_idx").on(t.gameId, t.createdAt)],
);

export const votes = pgTable(
	"votes",
	{
		gameId: text("game_id")
			.notNull()
			.references(() => games.id, { onDelete: "cascade" }),
		round: integer("round").notNull(),
		kind: text("kind", { enum: ["quarantine", "final"] }).notNull(),
		voterId: text("voter_id")
			.notNull()
			.references(() => players.id, { onDelete: "cascade" }),
		/** null = abstain / nobody */
		targetId: text("target_id").references(() => players.id, {
			onDelete: "cascade",
		}),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(t) => [primaryKey({ columns: [t.gameId, t.round, t.kind, t.voterId] })],
);

export const pactOffers = pgTable(
	"pact_offers",
	{
		gameId: text("game_id")
			.notNull()
			.references(() => games.id, { onDelete: "cascade" }),
		round: integer("round").notNull(),
		playerId: text("player_id")
			.notNull()
			.references(() => players.id, { onDelete: "cascade" }),
		/** null while unanswered */
		accepted: boolean("accepted"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(t) => [primaryKey({ columns: [t.gameId, t.round] })],
);

/**
 * A bot's decision for one phase, stored before it acts. If the step re-runs
 * after a crash, the stored plan is replayed instead of asking the model again.
 */
export const botTurns = pgTable(
	"bot_turns",
	{
		gameId: text("game_id")
			.notNull()
			.references(() => games.id, { onDelete: "cascade" }),
		round: integer("round").notNull(),
		phase: text("phase").notNull(),
		seatId: text("seat_id")
			.notNull()
			.references(() => players.id, { onDelete: "cascade" }),
		plan: jsonb("plan").notNull(),
		/** llm | mixed | heuristic */
		source: text("source").notNull(),
		errors: jsonb("errors").$type<string[]>().notNull().default([]),
		latencyMs: integer("latency_ms").notNull().default(0),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(t) => [primaryKey({ columns: [t.gameId, t.round, t.phase, t.seatId] })],
);
