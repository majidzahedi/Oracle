import type { Card, Claim, ToolCard, ToolType } from "@oracle/engine";
import type { GameView, PrivateView } from "@oracle/realtime";

/**
 * Everything a bot knows: exactly the view a human in that seat receives.
 * Bots never see the engine's GameState, other hands, roles or truth values.
 */
export type BotView = GameView & { me: PrivateView };

export const toolCards = (hand: Card[]) =>
	hand.filter((c): c is ToolCard => c.kind === "tool");
export const actionCards = (hand: Card[]) =>
	hand.filter((c) => c.kind === "action");
export const holds = (v: BotView, action: string) =>
	v.me.hand.some((c) => c.kind === "action" && c.action === action);

export function names(v: GameView): Record<string, string> {
	return Object.fromEntries(v.public.seats.map((s) => [s.playerId, s.name]));
}

export const others = (v: BotView) =>
	v.public.seats
		.filter((s) => s.playerId !== v.me.playerId)
		.map((s) => s.playerId);

/** Lock types still needed, most needed first. */
export function neededTypes(v: GameView): ToolType[] {
	const t = v.public.targets;
	return (Object.keys(t) as ToolType[])
		.map((k) => ({ k, need: (t[k] ?? 0) - v.public.progress[k] }))
		.filter((x) => x.need > 0)
		.sort((a, b) => b.need - a.need)
		.map((x) => x.k);
}

export const isOffType = (v: GameView, type: ToolType) =>
	!(type in v.public.targets);

/** Deterministic pseudo-random in [0,1) from a string, so a replayed decision is the same. */
export function chance(seed: string): number {
	let h = 2166136261;
	for (let i = 0; i < seed.length; i++)
		h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
	h ^= h >>> 13;
	h = Math.imul(h, 0x5bd1e995);
	return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

function innerClaim(c: Claim): { claim: Claim; negated: boolean } {
	let negated = false;
	let cur = c;
	while (cur.type === "not") {
		negated = !negated;
		cur = cur.claim;
	}
	return { claim: cur, negated };
}

/**
 * The bot's own suspicion of each other player, built only from its view:
 * certain evidence (its Lie Detector answers, Scanner results) weighs most;
 * Oracle statements, quarantines and table talk are weak hints.
 */
export function suspicion(v: BotView): Record<string, number> {
	const nm = names(v);
	const score: Record<string, number> = Object.fromEntries(
		others(v).map((p) => [p, 0]),
	);
	const bump = (p: string, n: number) => {
		if (p in score) score[p] = (score[p] ?? 0) + n;
	};
	const mentioned = (text: string) =>
		others(v).filter(
			(p) =>
				nm[p] &&
				text
					.toLocaleLowerCase()
					.includes((nm[p] as string).toLocaleLowerCase()),
		);

	for (const r of v.me.results) {
		if (r.action === "lieDetector") {
			const { claim } = innerClaim(r.claim);
			const truth = r.answer;
			if (claim.type === "isTraitor") bump(claim.player, truth ? 100 : -50);
			if (claim.type === "playedOffType") bump(claim.player, truth ? 6 : -1);
			if (claim.type === "receivedPact") bump(claim.player, truth ? 3 : -1);
		} else if (r.action === "scanner" && isOffType(v, r.card.type)) {
			bump(r.owner, 6);
		} else if (r.action === "decoder" && r.message) {
			for (const p of mentioned(r.message)) bump(p, 0.5);
		}
	}
	for (const m of v.me.messages) for (const p of mentioned(m.text)) bump(p, 1);
	for (const m of v.public.publicMessages)
		if (m.kind === "whisper") for (const p of mentioned(m.text)) bump(p, 1);
	for (const f of v.public.feed)
		if (f.kind === "quarantine" && f.player) bump(f.player, 1);
	for (const c of v.chat) {
		if (c.playerId === v.me.playerId) continue;
		for (const p of mentioned(c.text)) bump(p, 0.5);
	}
	return score;
}

/** Most suspected other player and their score. */
export function topSuspect(v: BotView): {
	player: string | null;
	score: number;
} {
	const s = suspicion(v);
	let best: string | null = null;
	for (const p of Object.keys(s))
		if (best === null || (s[p] ?? 0) > (s[best] ?? 0)) best = p;
	return { player: best, score: best ? (s[best] ?? 0) : 0 };
}
