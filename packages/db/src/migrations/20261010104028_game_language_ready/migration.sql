ALTER TABLE "games" ADD COLUMN "language" text DEFAULT 'fa' NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "ready_key" text;