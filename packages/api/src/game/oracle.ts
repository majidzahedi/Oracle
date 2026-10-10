import type { Decider, OracleCtx } from "@oracle/oracle";
import { createModel } from "@oracle/oracle";

import { loadDecider, loadProfile } from "../llm/profiles";
import type { GameDeps } from "./publish";
import type { GameRow, SeatRow } from "./store";
import { names, recentChat } from "./views";

/** The game's pinned decision engine (Laya / Jev), or null. Never fails the caller. */
export async function deciderFor(
	deps: GameDeps,
	game: GameRow,
): Promise<Decider | null> {
	if (game.decisionProfile === "none") return null;
	try {
		return await loadDecider(deps.db, deps.secret, game.decisionProfile);
	} catch (e) {
		console.error("decision engine unusable", e);
		return null;
	}
}

/**
 * The Oracle for one game: its pinned LLM profile (or scripted), language,
 * player names, recent public chat and the decision engine used to check
 * claims. A missing/disabled profile or a broken configuration degrades to the
 * scripted Oracle instead of stalling the game.
 */
export async function oracleFor(
	deps: GameDeps,
	game: GameRow,
	seats: SeatRow[],
): Promise<{ ctx: OracleCtx; profileId: string | null }> {
	const base = { lang: game.language, names: names(seats) };
	const scripted = {
		ctx: { ...base, model: null, profile: null },
		profileId: null,
	};
	if (game.oracleProfile === "scripted" || game.oracleProfile === "default")
		return scripted;
	try {
		const profile = await loadProfile(deps.db, deps.secret, game.oracleProfile);
		if (!profile) return scripted;
		const chat = await recentChat(deps.db, game.id, seats);
		return {
			ctx: {
				...base,
				model: createModel(profile),
				profile,
				talk: { chat: chat.map((c) => ({ name: c.name, text: c.text })) },
				decider: await deciderFor(deps, game),
			},
			profileId: profile.id,
		};
	} catch (e) {
		console.error("oracle profile unusable, using scripted", e);
		return scripted;
	}
}
