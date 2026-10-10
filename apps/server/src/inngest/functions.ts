import { systemChannel } from "./channels";
import { inngest } from "./client";
import { gameCreated, ping } from "./events";

// Placeholder for the durable per-game loop (implemented in stage 4).
export const gameLoop = inngest.createFunction(
	{
		id: "game-loop",
		triggers: [gameCreated],
		concurrency: { key: "event.data.gameId", limit: 1 },
	},
	async ({ event, step }) => {
		await step.run("init", () => ({ gameId: event.data.gameId }));
		return { gameId: event.data.gameId, status: "stub" };
	},
);

// Smoke test: proves the serve route, step execution and Realtime publishing work.
export const pingFn = inngest.createFunction(
	{ id: "ping", triggers: [ping] },
	async ({ event, step }) => {
		const message = await step.run("echo", () => `pong: ${event.data.message}`);
		await step.realtime.publish("publish-pong", systemChannel.pong, {
			message,
			at: new Date().toISOString(),
		});
		return { message };
	},
);

export const functions = [gameLoop, pingFn];
