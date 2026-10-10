import { realtime } from "inngest";
import { z } from "zod";

// Stage 1 smoke-test channel. Game channels (public + per-player) arrive in stage 4.
export const systemChannel = realtime.channel({
	name: "system",
	topics: {
		pong: { schema: z.object({ message: z.string(), at: z.string() }) },
	},
});
