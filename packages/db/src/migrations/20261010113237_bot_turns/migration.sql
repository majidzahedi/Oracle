CREATE TABLE "bot_turns" (
	"game_id" text,
	"round" integer,
	"phase" text,
	"seat_id" text,
	"plan" jsonb NOT NULL,
	"source" text NOT NULL,
	"errors" jsonb DEFAULT '[]' NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "bot_turns_pkey" PRIMARY KEY("game_id","round","phase","seat_id")
);
--> statement-breakpoint
ALTER TABLE "bot_turns" ADD CONSTRAINT "bot_turns_game_id_games_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "bot_turns" ADD CONSTRAINT "bot_turns_seat_id_players_id_fkey" FOREIGN KEY ("seat_id") REFERENCES "players"("id") ON DELETE CASCADE;