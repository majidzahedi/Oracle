import { sql } from "drizzle-orm";
import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	real,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

import { games } from "./game";

/**
 * LLM configurations for the Oracle, managed in the admin dashboard. API keys
 * are stored encrypted (AES-GCM) and never returned to clients.
 */
export const llmProfiles = pgTable(
	"llm_profiles",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		/** ollama | openai-compatible | anthropic | openai | google */
		provider: text("provider").notNull(),
		model: text("model").notNull(),
		baseUrl: text("base_url"),
		apiKeyEnc: text("api_key_enc"),
		/** Last 4 characters, for display. */
		apiKeyHint: text("api_key_hint"),
		temperature: real("temperature").notNull().default(0.8),
		timeoutMs: integer("timeout_ms").notNull().default(60000),
		verifyClaims: boolean("verify_claims").notNull().default(true),
		enabled: boolean("enabled").notNull().default(true),
		isDefault: boolean("is_default").notNull().default(false),
		/** The typed-decision engine (Laya / Jev) used for claim checks and chat reading. At most one. */
		isDecider: boolean("is_decider").notNull().default(false),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(t) => [
		uniqueIndex("llm_profiles_one_default")
			.on(t.isDefault)
			.where(sql`${t.isDefault}`),
		uniqueIndex("llm_profiles_one_decider")
			.on(t.isDecider)
			.where(sql`${t.isDecider}`),
	],
);

/** One row per Oracle generation, for the admin dashboard (latency, fallbacks, errors). */
export const oracleCalls = pgTable(
	"oracle_calls",
	{
		id: text("id").primaryKey(),
		gameId: text("game_id")
			.notNull()
			.references(() => games.id, { onDelete: "cascade" }),
		round: integer("round").notNull(),
		purpose: text("purpose").notNull(),
		profileId: text("profile_id"),
		/** llm | mixed | scripted */
		source: text("source").notNull(),
		attempts: integer("attempts").notNull(),
		fallbacks: integer("fallbacks").notNull(),
		latencyMs: integer("latency_ms").notNull(),
		errors: jsonb("errors").$type<string[]>().notNull().default([]),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(t) => [index("oracle_calls_created_idx").on(t.createdAt)],
);
