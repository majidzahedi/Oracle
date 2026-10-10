CREATE TABLE "llm_profiles" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"base_url" text,
	"api_key_enc" text,
	"api_key_hint" text,
	"temperature" real DEFAULT 0.8 NOT NULL,
	"timeout_ms" integer DEFAULT 60000 NOT NULL,
	"verify_claims" boolean DEFAULT true NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oracle_calls" (
	"id" text PRIMARY KEY,
	"game_id" text NOT NULL,
	"round" integer NOT NULL,
	"purpose" text NOT NULL,
	"profile_id" text,
	"source" text NOT NULL,
	"attempts" integer NOT NULL,
	"fallbacks" integer NOT NULL,
	"latency_ms" integer NOT NULL,
	"errors" jsonb DEFAULT '[]' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "oracle_profile" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "llm_profiles_one_default" ON "llm_profiles" ("is_default") WHERE "is_default";--> statement-breakpoint
CREATE INDEX "oracle_calls_created_idx" ON "oracle_calls" ("created_at");--> statement-breakpoint
ALTER TABLE "oracle_calls" ADD CONSTRAINT "oracle_calls_game_id_games_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE;