import { realtime } from "inngest";
import { z } from "zod";

/**
 * Channel definitions shared by the server (publish, token minting) and the web
 * app (useRealtime). Payloads are deliberately thin: clients refetch their own
 * redacted view after a message, so nothing secret ever travels on a channel
 * that more than one player can read.
 */

/** Public channel `game:{id}`: everyone looking at the game may subscribe. */
export const gameChannel = realtime.channel({
	name: ({ gameId }: { gameId: string }) => `game:${gameId}`,
	topics: {
		/** Seats or lobby status changed. */
		lobby: { schema: z.object({ version: z.number() }) },
	},
});

export const GAME_TOPICS = ["lobby"] as const;
