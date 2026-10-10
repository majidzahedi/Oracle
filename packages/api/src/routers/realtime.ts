import { GAME_TOPICS, gameChannel } from "@oracle/realtime";
import { getSubscriptionToken } from "inngest/realtime";
import { z } from "zod";

import { protectedProcedure } from "../index";
import { gameIdForCode } from "../lobby/service";

export const realtimeRouter = {
	/**
	 * Token for the public `game:{id}` channel. It only ever carries public data,
	 * so any signed-in user who knows the code may subscribe. Private per-player
	 * channels (stage 4) additionally check seat ownership.
	 */
	gameToken: protectedProcedure
		.input(z.object({ code: z.string() }))
		.handler(async ({ context, input }) => {
			const gameId = await gameIdForCode(context.db, input.code);
			const token = await getSubscriptionToken(context.inngest, {
				channel: gameChannel({ gameId }),
				topics: [...GAME_TOPICS],
			});
			return {
				key: token.key as string,
				apiBaseUrl: token.apiBaseUrl as string | undefined,
			};
		}),
};
