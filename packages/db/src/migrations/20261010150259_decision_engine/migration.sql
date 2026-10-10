ALTER TABLE "games" ADD COLUMN "decision_profile" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "llm_profiles" ADD COLUMN "is_decider" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "llm_profiles_one_decider" ON "llm_profiles" ("is_decider") WHERE "is_decider";