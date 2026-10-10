import type { ActionInput, ToolCard } from "@oracle/engine";

import {
	type BotView,
	chance,
	holds,
	isOffType,
	names,
	neededTypes,
	others,
	suspicion,
	toolCards,
	topSuspect,
} from "./view";

export type Lang = "fa" | "en";

export type NightPlan = { acceptPact: boolean | null };
export type DayPlan = { chat: string[]; action: ActionInput | null };
export type ActionPlan = { cardIds: string[] };
export type VotePlan = {
	target: string | null;
	chat: string[];
	scanPileIndex: number | null;
};
export type FinalPlan = { target: string | null };

const T = {
	revealed: {
		en: (m: string) => `The Oracle told me: “${m}”`,
		fa: (m: string) => `اوراکل به من گفت: «${m}»`,
	},
	distrust: {
		en: (p: string) => `I don't trust ${p}.`,
		fa: (p: string) => `به ${p} اعتماد ندارم.`,
	},
	framed: {
		en: (p: string) => `The Oracle told me ${p} serves it.`,
		fa: (p: string) => `اوراکل به من گفت ${p} در خدمت اوست.`,
	},
	focus: {
		en: () => "Let's focus on the lock. Play matching cards.",
		fa: () => "روی قفل تمرکز کنیم. کارت‌های درست بازی کنید.",
	},
	voteFor: {
		en: (p: string) => `I'm voting for ${p}.`,
		fa: (p: string) => `به ${p} رأی می‌دهم.`,
	},
} as const;

const seedOf = (v: BotView, purpose: string) =>
	`${v.public.gameId}:${v.public.round}:${v.me.playerId}:${purpose}`;
const isTraitor = (v: BotView) => v.me.role === "traitor";

export function heuristicNight(v: BotView): NightPlan {
	if (!v.me.pactOffer) return { acceptPact: null };
	// About one bot in four takes the deal, so bot games sometimes have a traitor.
	return { acceptPact: chance(seedOf(v, "pact")) < 0.25 };
}

export function heuristicDay(v: BotView, lang: Lang): DayPlan {
	const nm = names(v);
	const chat: string[] = [];
	const tonight = v.me.messages.find(
		(m) => m.round === v.public.round && m.kind === "night",
	);
	const top = topSuspect(v);
	if (isTraitor(v)) {
		// Frame whoever the table already doubts, otherwise someone at random.
		const target =
			top.player ??
			others(v)[Math.floor(chance(seedOf(v, "frame")) * others(v).length)];
		if (target && chance(seedOf(v, "lie")) < 0.6)
			chat.push(T.framed[lang](nm[target] ?? target));
		else if (tonight) chat.push(T.revealed[lang](tonight.text));
	} else {
		if (tonight && chance(seedOf(v, "reveal")) < 0.75)
			chat.push(T.revealed[lang](tonight.text));
		if (top.player && top.score >= 3)
			chat.push(T.distrust[lang](nm[top.player] ?? top.player));
		if (chat.length === 0) chat.push(T.focus[lang]());
	}
	return { chat: chat.slice(0, 2), action: heuristicDayAction(v) };
}

function heuristicDayAction(v: BotView): ActionInput | null {
	const top = topSuspect(v);
	if (!isTraitor(v)) {
		if (holds(v, "shield") && v.public.lockdown >= 8)
			return { action: "shield" };
		if (holds(v, "override") && v.public.lockdown >= 6)
			return { action: "override" };
	}
	if (holds(v, "lieDetector")) {
		return top.player && top.score > 0
			? {
					action: "lieDetector",
					claim: { type: "isTraitor", player: top.player },
				}
			: { action: "lieDetector", claim: { type: "traitorExists" } };
	}
	if (holds(v, "decoder") && top.player)
		return { action: "decoder", target: top.player };
	return null;
}

export function heuristicAction(v: BotView): ActionPlan {
	const tools = toolCards(v.me.hand);
	if (tools.length === 0) return { cardIds: [] };
	const needed = neededTypes(v);
	const matching = tools
		.filter((c) => !isOffType(v, c.type))
		.sort((a, b) => rank(needed, b) - rank(needed, a) || b.value - a.value);
	if (isTraitor(v)) {
		const off = tools
			.filter((c) => isOffType(v, c.type))
			.sort((a, b) => b.value - a.value);
		// Sabotage often, but not every round, to stay hidden.
		if (off[0] && chance(seedOf(v, "sabotage")) < 0.6)
			return { cardIds: [off[0].id] };
		const weakest = [...(matching.length ? matching : tools)].sort(
			(a, b) => a.value - b.value,
		)[0] as ToolCard;
		return { cardIds: [weakest.id] };
	}
	if (matching.length === 0) {
		// Playing is mandatory: give away the least harmful card.
		return {
			cardIds: [
				([...tools].sort((a, b) => a.value - b.value)[0] as ToolCard).id,
			],
		};
	}
	return { cardIds: matching.slice(0, 2).map((c) => c.id) };
}

const rank = (needed: string[], c: ToolCard) =>
	needed.includes(c.type) ? needed.length - needed.indexOf(c.type) : 0;

export function heuristicVote(v: BotView, lang: Lang): VotePlan {
	const nm = names(v);
	const s = suspicion(v);
	let target: string | null = null;
	if (isTraitor(v)) {
		// Pile onto whoever looks guilty, to get an innocent quarantined.
		const framed = Object.entries(s).sort((a, b) => b[1] - a[1])[0];
		if (framed && framed[1] >= 2) target = framed[0];
	} else {
		const top = topSuspect(v);
		if (top.player && top.score >= 4) target = top.player;
	}
	let scanPileIndex: number | null = null;
	if (holds(v, "scanner") && v.public.pileRound === v.public.round) {
		const i = v.public.pile.findIndex((c) => isOffType(v, c.type));
		scanPileIndex = i >= 0 ? i : null;
	}
	return {
		target,
		chat: target ? [T.voteFor[lang](nm[target] ?? target)] : [],
		scanPileIndex,
	};
}

export function heuristicFinal(v: BotView): FinalPlan {
	if (isTraitor(v)) return { target: null };
	const top = topSuspect(v);
	return { target: top.player && top.score >= 4 ? top.player : null };
}
