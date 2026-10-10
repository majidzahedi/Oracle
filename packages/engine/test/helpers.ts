import {
	type ActionKind,
	type Card,
	deal,
	type GameState,
	startAction,
	startDay,
	startNight,
	type ThreatKind,
	type ToolCard,
	type ToolType,
} from "../src";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export const P = ["p1", "p2", "p3", "p4"] as const;

let n = 0;
export const tool = (type: ToolType, value: number): ToolCard => ({
	id: `t-${type}-${value}-${n++}`,
	kind: "tool",
	type,
	value,
});
export const action = (a: ActionKind): Card => ({
	id: `a-${a}-${n++}`,
	kind: "action",
	action: a,
});

export function newGame(seed = "seed-1"): GameState {
	return deal({ seed, playerIds: [...P] });
}

/** Test-only state surgery: replace a player's hand. */
export function setHand(state: GameState, id: string, hand: Card[]): GameState {
	const s = clone(state);
	const p = s.players.find((x) => x.id === id);
	if (!p) throw new Error(id);
	p.hand = hand;
	return s;
}

export function setThreat(state: GameState, threat: ThreatKind): GameState {
	return { ...clone(state), currentThreat: threat };
}

/** Round 1 night with a known threat. */
export function night(
	state = newGame(),
	threat: ThreatKind = "jam",
): GameState {
	return setThreat(startNight(state), threat);
}

export function toAction(state: GameState): GameState {
	return startAction(startDay(state));
}

/** Gives every player a fixed hand and moves to the Action phase. */
export function actionWithHands(
	hands: Partial<Record<(typeof P)[number], Card[]>>,
	threat: ThreatKind = "jam",
	base?: GameState,
): GameState {
	let s = night(base, threat);
	for (const id of P) s = setHand(s, id, hands[id] ?? []);
	return toAction(s);
}

export function cardIds(state: GameState, id: string): string[] {
	return state.players.find((p) => p.id === id)?.hand.map((c) => c.id) ?? [];
}

export function totalCards(state: GameState): number {
	const inPlay = state.plays.filter(
		(p) => p.round === state.round && p.pileIndex === null,
	).length;
	return (
		state.deck.length +
		state.discard.length +
		state.players.reduce((n, p) => n + p.hand.length, 0) +
		inPlay
	);
}
