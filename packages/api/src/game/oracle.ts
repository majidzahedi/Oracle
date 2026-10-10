import { createModel, type OracleCtx } from "@oracle/oracle";

import { loadProfile } from "../llm/profiles";
import type { GameDeps } from "./publish";
import type { GameRow, SeatRow } from "./store";
import { names, recentChat } from "./views";

/**
 * The Oracle for one game: its pinned LLM profile (or scripted), language,
 * player names and recent public chat. A missing/disabled profile or a broken
 * configuration degrades to the scripted Oracle instead of stalling the game.
 */
export async function oracleFor(
	deps: GameDeps,
	game: GameRow,
	seats: SeatRow[],
): Promise<{ ctx: OracleCtx; profileId: string | null }> {
	const base = { lang: game.language, names: names(seats) };
	if (game.oracleProfile === "scripted" || game.oracleProfile === "default") {
		return { ctx: { ...base, model: null, profile: null }, profileId: null };
	}
	try {
		const profile = await loadProfile(deps.db, deps.secret, game.oracleProfile);
		if (!profile)
			return { ctx: { ...base, model: null, profile: null }, profileId: null };
		const chat = await recentChat(deps.db, game.id, seats);
		return {
			ctx: {
				...base,
				model: createModel(profile),
				profile,
				talk: { chat: chat.map((c) => ({ name: c.name, text: c.text })) },
			},
			profileId: profile.id,
		};
	} catch (e) {
		console.error("oracle profile unusable, using scripted", e);
		return { ctx: { ...base, model: null, profile: null }, profileId: null };
	}
}
