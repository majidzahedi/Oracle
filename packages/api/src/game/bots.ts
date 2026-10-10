import {
	type ActionPlan,
	type BotCtx,
	type BotView,
	type DayPlan,
	type FinalPlan,
	type NightPlan,
	type Planned,
	planAction,
	planDay,
	planFinal,
	planNight,
	planVote,
	type VotePlan,
} from "@oracle/bots";
import { botTurns } from "@oracle/db/schema/game";
import { createModel } from "@oracle/oracle";
import { and, eq } from "drizzle-orm";

import { loadProfile } from "../llm/profiles";
import {
	botAct,
	botAnswerPact,
	botChat,
	botPlay,
	botReady,
	botVote,
} from "./actions";
import type { GameDeps } from "./publish";
import { enginePlayerId, type GameRow, loadGame, type SeatRow } from "./store";
import { viewForSeat } from "./views";

/**
 * Bot turns. Each bot decides from `viewForSeat` (exactly what a human in that
 * seat would see) with the game's LLM profile, or heuristics without one. The
 * plan is stored in `bot_turns` before acting, so a re-run of the step replays
 * the same plan without calling the model again; execution goes through the
 * same action functions as humans and each action is safe to repeat.
 */

export type BotPhase = "night" | "day" | "action" | "vote" | "final";

async function botCtxFor(deps: GameDeps, game: GameRow): Promise<BotCtx> {
	const none: BotCtx = { model: null, profile: null, lang: game.language };
	if (game.oracleProfile === "scripted" || game.oracleProfile === "default")
		return none;
	try {
		const profile = await loadProfile(deps.db, deps.secret, game.oracleProfile);
		return profile
			? { model: createModel(profile), profile, lang: game.language }
			: none;
	} catch {
		return none;
	}
}

const PLANNERS: Record<
	BotPhase,
	(ctx: BotCtx, v: BotView) => Promise<Planned<unknown>>
> = {
	night: planNight,
	day: planDay,
	action: planAction,
	vote: planVote,
	final: planFinal,
};

/** Never let one bot's rejected move stop the others (the engine is the judge). */
async function tryAct(label: string, fn: () => Promise<unknown>) {
	try {
		await fn();
	} catch (e) {
		const msg = (e as Error).message;
		if (!/ALREADY_PLAYED|already|CARD_NOT_IN_HAND|WRONG_PHASE/.test(msg))
			console.warn(`bot ${label}: ${msg}`);
	}
}

async function storedOrNewPlan(
	deps: GameDeps,
	game: GameRow,
	seats: SeatRow[],
	bot: SeatRow,
	phase: BotPhase,
	ctx: BotCtx,
) {
	const where = and(
		eq(botTurns.gameId, game.id),
		eq(botTurns.round, game.state.round),
		eq(botTurns.phase, phase),
		eq(botTurns.seatId, bot.id),
	);
	const [stored] = await deps.db.select().from(botTurns).where(where);
	if (stored) return stored.plan;
	const view = (await viewForSeat(deps.db, game, seats, bot)) as BotView;
	const start = Date.now();
	const planned = await PLANNERS[phase](ctx, view);
	await deps.db
		.insert(botTurns)
		.values({
			gameId: game.id,
			round: game.state.round,
			phase,
			seatId: bot.id,
			plan: planned.plan,
			source: planned.source,
			errors: planned.errors.slice(0, 20),
			latencyMs: Date.now() - start,
		})
		.onConflictDoNothing();
	const [row] = await deps.db.select().from(botTurns).where(where);
	return row?.plan ?? planned.plan;
}

async function execute(
	deps: GameDeps,
	game: GameRow,
	bot: SeatRow,
	phase: BotPhase,
	plan: unknown,
) {
	const g = game.id;
	const label = `${enginePlayerId(bot.seat)} ${phase}`;
	const chatId = (i: number) =>
		`${g}:${game.state.round}:${phase}:${bot.id}:${i}`;
	switch (phase) {
		case "night": {
			const p = plan as NightPlan;
			if (p.acceptPact !== null)
				await tryAct(label, () =>
					botAnswerPact(deps, g, bot.id, p.acceptPact as boolean),
				);
			else await tryAct(label, () => botReady(deps, g, bot.id));
			return;
		}
		case "day": {
			const p = plan as DayPlan;
			for (const [i, line] of p.chat.entries())
				await tryAct(label, () => botChat(deps, g, bot.id, line, chatId(i)));
			if (p.action) {
				const action = p.action;
				await tryAct(label, () => botAct(deps, g, bot.id, action));
			}
			await tryAct(label, () => botReady(deps, g, bot.id));
			return;
		}
		case "action":
			await tryAct(label, () =>
				botPlay(deps, g, bot.id, (plan as ActionPlan).cardIds),
			);
			return;
		case "vote": {
			const p = plan as VotePlan;
			if (p.scanPileIndex !== null) {
				const pileIndex = p.scanPileIndex;
				await tryAct(label, () =>
					botAct(deps, g, bot.id, { action: "scanner", pileIndex }),
				);
			}
			for (const [i, line] of p.chat.entries())
				await tryAct(label, () => botChat(deps, g, bot.id, line, chatId(i)));
			await tryAct(label, () => botVote(deps, g, bot.id, p.target));
			return;
		}
		case "final":
			await tryAct(label, () =>
				botVote(deps, g, bot.id, (plan as FinalPlan).target),
			);
			return;
	}
}

/** All bots take their turn for the current phase (in parallel). Idempotent per round and phase. */
export async function runBotTurns(
	deps: GameDeps,
	gameId: string,
	round: number,
	phase: BotPhase,
) {
	const { game, seats } = await loadGame(deps.db, gameId);
	if (game.state.round !== round || game.state.phase !== phase) return;
	const bots = seats.filter((s) => s.isBot);
	if (bots.length === 0) return;
	const ctx = await botCtxFor(deps, game);
	await Promise.all(
		bots.map(async (bot) => {
			const pid = enginePlayerId(bot.seat);
			if (
				phase === "action" &&
				game.state.players.find((p) => p.id === pid)?.quarantined
			)
				return;
			const plan = await storedOrNewPlan(deps, game, seats, bot, phase, ctx);
			await execute(deps, game, bot, phase, plan);
		}),
	);
}
