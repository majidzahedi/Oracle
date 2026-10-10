CREATE TABLE "account" (
	"id" text PRIMARY KEY,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL UNIQUE,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"email" text NOT NULL UNIQUE,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"is_anonymous" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" text PRIMARY KEY,
	"game_id" text NOT NULL,
	"round" integer NOT NULL,
	"player_id" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" text PRIMARY KEY,
	"code" text NOT NULL UNIQUE,
	"host_user_id" text NOT NULL,
	"status" text DEFAULT 'lobby' NOT NULL,
	"round" integer DEFAULT 0 NOT NULL,
	"phase" text DEFAULT 'setup' NOT NULL,
	"lockdown" integer DEFAULT 0 NOT NULL,
	"sector" integer DEFAULT 0 NOT NULL,
	"progress" jsonb DEFAULT '{"power":0,"code":0,"force":0}' NOT NULL,
	"jam" integer DEFAULT 0 NOT NULL,
	"seed" text NOT NULL,
	"threat_deck" jsonb DEFAULT '[]' NOT NULL,
	"state" jsonb,
	"version" integer DEFAULT 0 NOT NULL,
	"phase_deadline" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hands" (
	"game_id" text,
	"player_id" text NOT NULL,
	"card_id" text,
	"card" jsonb NOT NULL,
	CONSTRAINT "hands_pkey" PRIMARY KEY("game_id","card_id")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"game_id" text,
	"id" text,
	"round" integer NOT NULL,
	"recipient_id" text,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"claim" jsonb,
	"truth" boolean,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "messages_pkey" PRIMARY KEY("game_id","id")
);
--> statement-breakpoint
CREATE TABLE "pact_offers" (
	"game_id" text,
	"round" integer,
	"player_id" text NOT NULL,
	"accepted" boolean,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "pact_offers_pkey" PRIMARY KEY("game_id","round")
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" text PRIMARY KEY,
	"game_id" text NOT NULL,
	"user_id" text,
	"seat" integer NOT NULL,
	"name" text NOT NULL,
	"is_bot" boolean DEFAULT false NOT NULL,
	"role" text,
	"quarantined" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plays" (
	"game_id" text,
	"round" integer,
	"card_id" text,
	"owner_id" text NOT NULL,
	"card" jsonb NOT NULL,
	"off_type" boolean NOT NULL,
	"pile_index" integer,
	"auto" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "plays_pkey" PRIMARY KEY("game_id","round","card_id")
);
--> statement-breakpoint
CREATE TABLE "votes" (
	"game_id" text,
	"round" integer,
	"kind" text,
	"voter_id" text,
	"target_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "votes_pkey" PRIMARY KEY("game_id","round","kind","voter_id")
);
--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");--> statement-breakpoint
CREATE INDEX "chat_game_idx" ON "chat_messages" ("game_id","created_at");--> statement-breakpoint
CREATE INDEX "games_status_idx" ON "games" ("status");--> statement-breakpoint
CREATE INDEX "hands_player_idx" ON "hands" ("player_id");--> statement-breakpoint
CREATE INDEX "messages_recipient_idx" ON "messages" ("game_id","recipient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "players_game_seat_uq" ON "players" ("game_id","seat");--> statement-breakpoint
CREATE UNIQUE INDEX "players_game_user_uq" ON "players" ("game_id","user_id");--> statement-breakpoint
CREATE INDEX "players_user_idx" ON "players" ("user_id");--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_game_id_games_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_player_id_players_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_host_user_id_user_id_fkey" FOREIGN KEY ("host_user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "hands" ADD CONSTRAINT "hands_game_id_games_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "hands" ADD CONSTRAINT "hands_player_id_players_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_game_id_games_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_recipient_id_players_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "players"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "pact_offers" ADD CONSTRAINT "pact_offers_game_id_games_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "pact_offers" ADD CONSTRAINT "pact_offers_player_id_players_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_game_id_games_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "plays" ADD CONSTRAINT "plays_game_id_games_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "plays" ADD CONSTRAINT "plays_owner_id_players_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "players"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_game_id_games_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_voter_id_players_id_fkey" FOREIGN KEY ("voter_id") REFERENCES "players"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_target_id_players_id_fkey" FOREIGN KEY ("target_id") REFERENCES "players"("id") ON DELETE CASCADE;