import { eventType } from "inngest";
import { z } from "zod";

/** Inngest events shared by the API (senders) and apps/server functions (triggers, waits). */
export const gameCreated = eventType("game/created", {
	schema: z.object({ gameId: z.string() }),
});
