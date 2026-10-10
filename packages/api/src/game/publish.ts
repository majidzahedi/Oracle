import type { Database } from "@oracle/db";
import { gameChannel, playerChannel } from "@oracle/realtime";
import type { Inngest } from "inngest";

import { loadGame } from "./store";
import { buildPrivate, buildPublic, currentVotes } from "./views";

export type GameDeps = { db: Database; inngest: Inngest.Any; secret: string };

/**
 * Pushes the current state: the public view on `game:{id}` and each seated
 * human's private view on their own channel. Snapshots are idempotent, so a
 * retried step publishing twice is harmless. Failures never fail the caller;
 * clients also refetch on reconnect.
 */
export async function publishGame(
	deps: Pick<GameDeps, "db" | "inngest">,
	gameId: string,
): Promise<void> {
	try {
		const { game, seats } = await loadGame(deps.db, gameId);
		const voted = await currentVotes(deps.db, game, seats);
		const ch = gameChannel({ gameId });
		await deps.inngest.realtime.publish(
			ch.state,
			buildPublic(game, seats, voted),
		);
		await Promise.all(
			seats
				.filter((s) => !s.isBot && s.userId)
				.map((s) =>
					deps.inngest.realtime.publish(
						playerChannel({ gameId, playerId: s.id }).me,
						buildPrivate(game.state, s, voted),
					),
				),
		);
	} catch (e) {
		console.error("publishGame failed", gameId, e);
	}
}
