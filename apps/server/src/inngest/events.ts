import { eventType } from "inngest";
import { z } from "zod";

export { gameCreated } from "@oracle/api/events";

export const ping = eventType("oracle/ping", {
	schema: z.object({ message: z.string() }),
});
