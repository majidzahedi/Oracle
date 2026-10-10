import { realtime, staticSchema } from "inngest";
import { z } from "zod";

import type { ChatMessage, PrivateView, PublicGameView } from "./views";

export type * from "./views";

/**
 * Channel definitions shared by the server (publish, token minting) and the web
 * app (useRealtime). Each channel only ever carries data its subscribers are
 * allowed to see; tokens are minted server-side after an auth check.
 */

/** Public channel `game:{id}`: board, feed, Lockdown, revealed pile (no owners), chat. */
export const gameChannel = realtime.channel({
	name: ({ gameId }: { gameId: string }) => `game:${gameId}`,
	topics: {
		/** Seats or lobby status changed. */
		lobby: { schema: z.object({ version: z.number() }) },
		state: { schema: staticSchema<PublicGameView>() },
		chat: { schema: staticSchema<ChatMessage>() },
	},
});

export const GAME_TOPICS = ["lobby", "state", "chat"] as const;

/** Private channel `game:{id}:p:{playerId}`: hand, night messages, Pact offer, action results. */
export const playerChannel = realtime.channel({
	name: ({ gameId, playerId }: { gameId: string; playerId: string }) =>
		`game:${gameId}:p:${playerId}`,
	topics: {
		me: { schema: staticSchema<PrivateView>() },
	},
});

export const PLAYER_TOPICS = ["me"] as const;
