import {
	actionsDone,
	dayEnded,
	nightEnded,
	votesDone,
} from "@oracle/api/events";
import {
	closeVotes,
	finish,
	openAction,
	openDay,
	openNight,
	oracleSpeaksAtNight,
	oracleSpeaksInPublic,
	type PhaseDurations,
	type PhaseStatus,
	resolve,
} from "@oracle/api/game/loop";

import { ENV } from "../env.server";
import { db } from "../services";
import { systemChannel } from "./channels";
import { inngest } from "./client";
import { gameCreated, ping } from "./events";

const durations: PhaseDurations = {
	night: ENV.PHASE_NIGHT_SECONDS ?? 45,
	day: ENV.PHASE_DAY_SECONDS ?? 210,
	action: ENV.PHASE_ACTION_SECONDS ?? 90,
	vote: ENV.PHASE_VOTE_SECONDS ?? 60,
	final: ENV.PHASE_FINAL_SECONDS ?? 60,
};

/** Lockdown rises by 2 on every failed lock, so real games end long before this. */
const MAX_ROUNDS = 40;

/**
 * One durable run per game. Engine logic runs in `step.run` (idempotent, memoized);
 * player input arrives as "phase done" events sent by the API once every active
 * player has acted. Waits time out at the phase deadline stored in the DB, so a
 * restart never extends a phase, and idle players are auto-played or skipped.
 */
export const gameLoop = inngest.createFunction(
	{
		id: "game-loop",
		triggers: [gameCreated],
		concurrency: { key: "event.data.gameId", limit: 1 },
	},
	async ({ event, step }) => {
		const gameId = event.data.gameId;
		const deps = { db, inngest, secret: ENV.BETTER_AUTH_SECRET };

		for (let round = 1; round <= MAX_ROUNDS; round++) {
			const match = `async.data.gameId == event.data.gameId && async.data.round == ${round}`;
			const waitFor = async (
				id: string,
				ev:
					| typeof nightEnded
					| typeof dayEnded
					| typeof actionsDone
					| typeof votesDone,
				st: PhaseStatus,
				extra = "",
			) => {
				if (st.complete || !st.deadline) return;
				await step.waitForEvent(id, {
					event: ev,
					timeout: new Date(st.deadline),
					if: match + extra,
				});
			};

			const opened = await step.run(`r${round}-night`, () =>
				openNight(deps, gameId, round),
			);
			if (opened.phase === "ended") break;
			// The model call lives in its own memoized step: a restart never calls it twice.
			const night = await step.run(`r${round}-oracle-night`, () =>
				oracleSpeaksAtNight(deps, gameId, round, durations),
			);
			await waitFor(`r${round}-wait-night`, nightEnded, night);

			const day = await step.run(`r${round}-day`, () =>
				openDay(deps, gameId, round, durations),
			);
			await waitFor(`r${round}-wait-day`, dayEnded, day);

			const action = await step.run(`r${round}-action`, () =>
				openAction(deps, gameId, round, durations),
			);
			await waitFor(`r${round}-wait-actions`, actionsDone, action);

			const resolved = await step.run(`r${round}-resolve`, () =>
				resolve(deps, gameId, round, durations),
			);
			if (resolved.phase === "ended") break;
			await step.run(`r${round}-oracle-public`, () =>
				oracleSpeaksInPublic(deps, gameId, round),
			);
			if (resolved.phase === "final") {
				await waitFor(
					`r${round}-wait-final`,
					votesDone,
					resolved,
					" && async.data.kind == 'final'",
				);
				await step.run(`r${round}-finish`, () => finish(deps, gameId, round));
				break;
			}
			await waitFor(
				`r${round}-wait-votes`,
				votesDone,
				resolved,
				" && async.data.kind == 'quarantine'",
			);
			await step.run(`r${round}-votes`, () => closeVotes(deps, gameId, round));
		}
		return { gameId };
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
