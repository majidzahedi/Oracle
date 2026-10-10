import {
	autoPlayChoice,
	type GameState,
	getPlayer,
	type ToolCard,
} from "@oracle/engine";

/**
 * Placeholder bots for stage 4: they keep the game moving but play no strategy.
 * Stage 6 replaces this with bots that chat, suspect and (as traitor) sabotage,
 * using only their own private view.
 */

export const botAnswersPact = (_state: GameState, _bot: string): boolean =>
	false;

/** Best matching card, else the lowest tool card (playing is mandatory), else nothing. */
export function botPlay(state: GameState, bot: string): string[] {
	const choice = autoPlayChoice(state, bot);
	if (choice.length > 0) return choice;
	const tools = getPlayer(state, bot)
		.hand.filter((c): c is ToolCard => c.kind === "tool")
		.sort((a, b) => a.value - b.value);
	return tools[0] ? [tools[0].id] : [];
}

/** Bots abstain from quarantine votes and vote to leave nobody behind. */
export const botVote = (_state: GameState, _bot: string): string | null => null;
