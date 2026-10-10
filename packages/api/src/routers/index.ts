import type { RouterClient } from "@orpc/server";

import { publicProcedure } from "../index";
import { lobbyRouter } from "./lobby";
import { realtimeRouter } from "./realtime";

export const appRouter = {
	healthCheck: publicProcedure.handler(() => {
		return "OK";
	}),
	lobby: lobbyRouter,
	realtime: realtimeRouter,
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
