import { eventType } from "inngest";
import { z } from "zod";

/** Inngest events shared by the API (senders) and apps/server functions (triggers, waits). */
export const gameCreated = eventType("game/created", {
	schema: z.object({ gameId: z.string() }),
});

const phaseDone = z.object({ gameId: z.string(), round: z.number() });

/** Everyone is ready at night (the Pact recipient answered). */
export const nightEnded = eventType("game/night.ended", { schema: phaseDone });
export const pactAnswered = eventType("game/pact.answered", {
	schema: phaseDone,
});
export const dayEnded = eventType("game/day.ended", { schema: phaseDone });
export const actionsDone = eventType("game/actions.done", {
	schema: phaseDone,
});
export const votesDone = eventType("game/votes.done", {
	schema: phaseDone.extend({ kind: z.enum(["quarantine", "final"]) }),
});
