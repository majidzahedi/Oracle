import {
	GAME_TOPICS,
	gameChannel,
	PLAYER_TOPICS,
	playerChannel,
} from "@oracle/realtime";
import { getSubscriptionToken } from "inngest/realtime";
import { z } from "zod";

import { gameError, gameIdByCode } from "../game/store";
import { seatOfUser } from "../game/views";
import { protectedProcedure } from "../index";

const token = (t: { key?: string; apiBaseUrl?: string }) => ({
	key: t.key as string,
	apiBaseUrl: t.apiBaseUrl,
});

export const realtimeRouter = {
	/** Public `game:{id}` channel: only public data, so any signed-in user with the code may subscribe. */
	gameToken: protectedProcedure
		.input(z.object({ code: z.string() }))
		.handler(async ({ context, input }) => {
			const gameId = await gameIdByCode(context.db, input.code);
			return token(
				await getSubscriptionToken(context.inngest, {
					channel: gameChannel({ gameId }),
					topics: [...GAME_TOPICS],
				}),
			);
		}),
	/** Private `game:{id}:p:{playerId}` channel: issued only after confirming the user owns that seat. */
	playerToken: protectedProcedure
		.input(z.object({ code: z.string() }))
		.handler(async ({ context, input }) => {
			const gameId = await gameIdByCode(context.db, input.code);
			const seat = await seatOfUser(
				context.db,
				gameId,
				context.session.user.id,
			);
			if (!seat) throw gameError("FORBIDDEN", "notSeated");
			return {
				playerId: seat.id,
				...token(
					await getSubscriptionToken(context.inngest, {
						channel: playerChannel({ gameId, playerId: seat.id }),
						topics: [...PLAYER_TOPICS],
					}),
				),
			};
		}),
};
