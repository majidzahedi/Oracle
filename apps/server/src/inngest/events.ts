import { eventType } from "inngest";
import { z } from "zod";

export const gameCreated = eventType("game/created", {
	schema: z.object({ gameId: z.string() }),
});

export const ping = eventType("oracle/ping", {
	schema: z.object({ message: z.string() }),
});
