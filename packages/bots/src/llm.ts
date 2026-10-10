import type { ActionInput, Claim } from "@oracle/engine";
import { renderClaim } from "@oracle/oracle";
import { generateText, type LanguageModel, Output } from "ai";
import { z } from "zod";

import {
	type ActionPlan,
	type DayPlan,
	type FinalPlan,
	heuristicAction,
	heuristicDay,
	heuristicFinal,
	heuristicNight,
	heuristicVote,
	type Lang,
	type NightPlan,
	type VotePlan,
} from "./heuristic";
import {
	type BotView,
	chance,
	holds,
	names,
	others,
	suspicion,
	toolCards,
} from "./view";

export type BotCtx = {
	model: LanguageModel | null;
	profile: { temperature: number; timeoutMs: number } | null;
	lang: Lang;
};

export type Planned<T> = {
	plan: T;
	source: "llm" | "heuristic" | "mixed";
	errors: string[];
};

const PERSONAS = [
	"cautious and analytical; speaks briefly and only accuses with evidence",
	"bold and talkative; quick to voice suspicions",
	"calm and diplomatic; tries to keep the group together",
] as const;

function persona(v: BotView) {
	return PERSONAS[
		Math.floor(
			chance(`${v.public.gameId}:${v.me.playerId}:persona`) * PERSONAS.length,
		)
	];
}

/** The bot's own view as prompt text. Everything here is something a human in the seat could see. */
export function describeView(v: BotView): string {
	const nm = names(v);
	const n = (id: string) => nm[id] ?? id;
	const pub = v.public;
	const lines = [
		`You are ${n(v.me.playerId)} (${v.me.playerId}), a prisoner in the Oracle's vault. Personality: ${persona(v)}.`,
		v.me.role === "traitor"
			? "SECRET: you accepted the Oracle's Pact. You win if Lockdown reaches 12 or you escape unidentified. Sabotage quietly, deflect suspicion, never admit it."
			: "You are innocent. Open the locks, escape, and leave the traitor (if any) behind.",
		`Round ${pub.round}, phase ${pub.phase}. Lockdown ${pub.lockdown}/12.`,
		`Current lock: ${pub.lockName}. Needs ${Object.entries(pub.targets)
			.map(([t, need]) => `${t} ${pub.progress[t as "power"]}/${need}`)
			.join(", ")}. Off-type cards subtract from the first type.`,
		`Players: ${pub.seats.map((s) => `${s.playerId}=${s.name}${s.quarantined ? " (quarantined)" : ""}`).join(", ")}.`,
		`Your hand: ${v.me.hand.map((c) => (c.kind === "tool" ? `[${c.id}] ${c.type} ${c.value}` : `[${c.id}] ${c.action}`)).join(", ") || "empty"}.`,
	];
	if (v.me.messages.length) {
		lines.push("What the Oracle told you privately (it may lie):");
		for (const m of v.me.messages.slice(-6))
			lines.push(`- round ${m.round} (${m.kind}): ${m.text}`);
	}
	if (v.me.results.length) {
		lines.push("What you learned for certain:");
		for (const r of v.me.results) {
			if (r.action === "lieDetector")
				lines.push(
					`- Lie Detector (always true): ${renderClaim(r.answer ? r.claim : ({ type: "not", claim: r.claim } as Claim), nm, "en")}`,
				);
			if (r.action === "scanner")
				lines.push(
					`- Scanner: ${n(r.owner)} played ${r.card.type} ${r.card.value} in round ${r.round}`,
				);
			if (r.action === "decoder")
				lines.push(
					`- Decoder: ${n(r.target)} was told: ${r.message ?? "nothing"}`,
				);
		}
	}
	const pubMsgs = pub.publicMessages.slice(-4);
	if (pubMsgs.length) {
		lines.push("The Oracle said publicly:");
		for (const m of pubMsgs) lines.push(`- round ${m.round}: ${m.text}`);
	}
	if (pub.pile.length)
		lines.push(
			`Last revealed pile (round ${pub.pileRound}): ${pub.pile.map((c, i) => `#${i} ${c.type} ${c.value}`).join(", ")}.`,
		);
	const quarantines = pub.feed.filter(
		(f) => f.kind === "quarantine" && f.player,
	);
	if (quarantines.length)
		lines.push(
			`Quarantined before: ${quarantines.map((f) => (f.kind === "quarantine" ? n(f.player ?? "") : "")).join(", ")}.`,
		);
	if (v.chat.length) {
		lines.push("Recent table talk:");
		for (const c of v.chat.slice(-12))
			lines.push(`- ${c.name}: ${c.text.slice(0, 200)}`);
	}
	const s = suspicion(v);
	lines.push(
		`Your current suspicion scores: ${others(v)
			.map((p) => `${n(p)} ${(s[p] ?? 0).toFixed(1)}`)
			.join(", ")}.`,
	);
	return lines.join("\n");
}

const chatSchema = z
	.array(z.string())
	.max(2)
	.describe("0-2 short chat lines, in character");

async function ask<S extends z.ZodTypeAny>(
	ctx: BotCtx,
	v: BotView,
	schema: S,
	task: string,
): Promise<z.infer<S>> {
	if (!ctx.model || !ctx.profile) throw new Error("no model");
	const { output } = await generateText({
		model: ctx.model,
		output: Output.object({ schema }),
		system: [
			"You play a social-deduction card game as one of four prisoners.",
			ctx.lang === "fa"
				? "Write chat lines in Persian (Farsi)."
				: "Write chat lines in English.",
			"Refer to players by name in chat, never by ids. Keep chat lines under 160 characters.",
		].join("\n"),
		prompt: `${describeView(v)}\n\n${task}`,
		temperature: ctx.profile.temperature,
		timeout: ctx.profile.timeoutMs,
		maxRetries: 1,
	});
	return output as z.infer<S>;
}

function cleanChat(lines: unknown, errors: string[]): string[] {
	if (!Array.isArray(lines)) return [];
	return lines
		.filter((l): l is string => typeof l === "string")
		.map((l) => l.trim())
		.filter((l) => {
			if (!l) return false;
			if (/\bp[1-4]\b/i.test(l)) {
				errors.push(`dropped chat line with an id: ${l.slice(0, 60)}`);
				return false;
			}
			return true;
		})
		.slice(0, 2)
		.map((l) => l.slice(0, 200));
}

async function attempt<T>(
	ctx: BotCtx,
	fallback: () => T,
	run: (errors: string[]) => Promise<{ plan: T; mixed: boolean }>,
): Promise<Planned<T>> {
	const errors: string[] = [];
	if (!ctx.model) return { plan: fallback(), source: "heuristic", errors };
	try {
		const { plan, mixed } = await run(errors);
		return { plan, source: mixed ? "mixed" : "llm", errors };
	} catch (e) {
		errors.push((e as Error).message.slice(0, 300));
		return { plan: fallback(), source: "heuristic", errors };
	}
}

// ---------------------------------------------------------------------------

export function planNight(
	ctx: BotCtx,
	v: BotView,
): Promise<Planned<NightPlan>> {
	if (!v.me.pactOffer)
		return Promise.resolve({
			plan: { acceptPact: null },
			source: "heuristic",
			errors: [],
		});
	return attempt(
		ctx,
		() => heuristicNight(v),
		async () => {
			const out = await ask(
				ctx,
				v,
				z.object({ acceptPact: z.boolean(), reason: z.string() }),
				'The Oracle secretly offers you the Pact: "Help me, and you\'ll walk out of here alive. Alone." Accepting makes you the traitor. Decide in character.',
			);
			return { plan: { acceptPact: out.acceptPact }, mixed: false };
		},
	);
}

const dayActionSchema = z.object({
	kind: z.enum(["none", "decoder", "lieDetector", "shield", "override"]),
	target: z
		.string()
		.nullable()
		.describe(
			"Player id for decoder, or the player your Lie Detector question is about",
		),
	question: z
		.enum(["isTraitor", "receivedPact", "playedOffType", "traitorExists"])
		.nullable(),
	round: z
		.number()
		.int()
		.nullable()
		.describe("Round for a playedOffType question"),
});

export function planDay(ctx: BotCtx, v: BotView): Promise<Planned<DayPlan>> {
	const fallback = () => heuristicDay(v, ctx.lang);
	return attempt(ctx, fallback, async (errors) => {
		const usable = ["decoder", "lieDetector", "shield", "override"].filter(
			(a) => holds(v, a),
		);
		const out = await ask(
			ctx,
			v,
			z.object({ chat: chatSchema, action: dayActionSchema }),
			[
				"It is DAY: talk to the table. You may reveal your night message, or lie about it.",
				`Action cards you can use now: ${usable.join(", ") || "none"} (use kind "none" otherwise).`,
				"Lie Detector questions: isTraitor(player), receivedPact(player), playedOffType(player, past round), traitorExists.",
			].join("\n"),
		);
		const chat = cleanChat(out.chat, errors);
		const action = validDayAction(v, out.action, errors);
		const heuristic = fallback();
		return {
			plan: {
				chat: chat.length ? chat : heuristic.chat,
				action: action === undefined ? heuristic.action : action,
			},
			mixed: chat.length === 0 || action === undefined,
		};
	});
}

/** null = deliberately no action; undefined = invalid (use the heuristic). */
function validDayAction(
	v: BotView,
	a: z.infer<typeof dayActionSchema>,
	errors: string[],
): ActionInput | null | undefined {
	if (a.kind === "none") return null;
	if (!holds(v, a.kind)) {
		errors.push(`not holding ${a.kind}`);
		return undefined;
	}
	const target = a.target && others(v).includes(a.target) ? a.target : null;
	if (a.kind === "shield" || a.kind === "override") return { action: a.kind };
	if (a.kind === "decoder") {
		if (!target) errors.push("decoder needs another player");
		return target ? { action: "decoder", target } : undefined;
	}
	switch (a.question) {
		case "traitorExists":
			return { action: "lieDetector", claim: { type: "traitorExists" } };
		case "isTraitor":
		case "receivedPact":
			return target
				? { action: "lieDetector", claim: { type: a.question, player: target } }
				: undefined;
		case "playedOffType":
			return target && a.round && a.round >= 1 && a.round < v.public.round
				? {
						action: "lieDetector",
						claim: { type: "playedOffType", player: target, round: a.round },
					}
				: undefined;
		default:
			errors.push("lie detector without a valid question");
			return undefined;
	}
}

export function planAction(
	ctx: BotCtx,
	v: BotView,
): Promise<Planned<ActionPlan>> {
	const fallback = () => heuristicAction(v);
	return attempt(ctx, fallback, async (errors) => {
		const tools = toolCards(v.me.hand);
		if (tools.length === 0) return { plan: { cardIds: [] }, mixed: false };
		const out = await ask(
			ctx,
			v,
			z.object({
				cardIds: z.array(z.string()).min(1).max(2),
				reason: z.string(),
			}),
			"ACTION phase: play 1 or 2 TOOL cards face down (by their [id]). Matching types add progress; off-type cards subtract from the first type.",
		);
		const ids = [...new Set(out.cardIds)];
		if (
			ids.length >= 1 &&
			ids.length <= 2 &&
			ids.every((id) => tools.some((c) => c.id === id))
		) {
			return { plan: { cardIds: ids }, mixed: false };
		}
		errors.push(`invalid cards ${JSON.stringify(out.cardIds)}`);
		return { plan: fallback(), mixed: true };
	});
}

export function planVote(ctx: BotCtx, v: BotView): Promise<Planned<VotePlan>> {
	const fallback = () => heuristicVote(v, ctx.lang);
	return attempt(ctx, fallback, async (errors) => {
		const canScan =
			holds(v, "scanner") &&
			v.public.pileRound === v.public.round &&
			v.public.pile.length > 0;
		const out = await ask(
			ctx,
			v,
			z.object({
				target: z
					.string()
					.nullable()
					.describe(
						"Player id to quarantine (needs 3 votes), or null to abstain",
					),
				chat: chatSchema,
				scanPileIndex: z
					.number()
					.int()
					.nullable()
					.describe("Pile card # to Scan, or null"),
			}),
			[
				"VOTE: choose someone to quarantine for the next Action phase, or abstain (null). You cannot vote for yourself.",
				canScan
					? "You hold a Scanner: you may pick a pile card # to learn who played it."
					: "You have no Scanner to use.",
			].join("\n"),
		);
		const target =
			out.target === null || others(v).includes(out.target)
				? out.target
				: undefined;
		if (target === undefined) errors.push(`invalid vote target ${out.target}`);
		const scan =
			canScan &&
			out.scanPileIndex !== null &&
			out.scanPileIndex >= 0 &&
			out.scanPileIndex < v.public.pile.length
				? out.scanPileIndex
				: null;
		const h = fallback();
		return {
			plan: {
				target: target === undefined ? h.target : target,
				chat: cleanChat(out.chat, errors),
				scanPileIndex: scan,
			},
			mixed: target === undefined,
		};
	});
}

export function planFinal(
	ctx: BotCtx,
	v: BotView,
): Promise<Planned<FinalPlan>> {
	const fallback = () => heuristicFinal(v);
	return attempt(ctx, fallback, async (errors) => {
		const out = await ask(
			ctx,
			v,
			z.object({ target: z.string().nullable(), reason: z.string() }),
			"The EXIT is open. Choose one player to leave behind (needs 3 of 4 votes), or null for nobody. You may name anyone, even yourself.",
		);
		const valid =
			out.target === null ||
			v.public.seats.some((s) => s.playerId === out.target);
		if (!valid) errors.push(`invalid final target ${out.target}`);
		return {
			plan: { target: valid ? out.target : fallback().target },
			mixed: !valid,
		};
	});
}
