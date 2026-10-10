import {
	type Claim,
	evaluateClaim,
	type GameState,
	type MessageInput,
	offerPact,
	pactCandidates,
	validateMessage,
} from "@oracle/engine";
import { generateText, type LanguageModel, Output } from "ai";
import type { z } from "zod";
import { type Decider, decideAssertsClaim } from "../decide/jev";

import { type Lang, type Names, renderClaim } from "../render";
import {
	scriptedLieDetector,
	scriptedMercy,
	scriptedNightMessages,
	scriptedPactOffer,
	scriptedWhisper,
} from "../scripted";
import { checkText } from "./checks";
import type { LlmProfile } from "./profile";
import {
	lieDetectorPrompt,
	mercyPrompt,
	nightPrompt,
	persona,
	type TableTalk,
	verifyPrompt,
	whisperPrompt,
} from "./prompts";
import {
	nightPlan,
	textOut,
	toEngineClaim,
	verdicts,
	whisperOut,
} from "./schemas";

/** Everything the Oracle needs for one call. `model` null = scripted only. */
export type OracleCtx = {
	model: LanguageModel | null;
	profile: Pick<
		LlmProfile,
		"temperature" | "timeoutMs" | "verifyClaims"
	> | null;
	lang: Lang;
	names: Names;
	talk?: TableTalk;
	/** Typed-decision engine (Laya / Jev). When set, it checks claims instead of a second LLM call. */
	decider?: Decider | null;
};

export type OracleReport = {
	purpose: "night" | "whisper" | "mercy" | "lieDetector";
	source: "llm" | "mixed" | "scripted";
	attempts: number;
	fallbacks: number;
	latencyMs: number;
	errors: string[];
};

export const MAX_ATTEMPTS = 3;

async function generate<S extends z.ZodTypeAny>(
	ctx: OracleCtx,
	schema: S,
	prompt: string,
): Promise<z.infer<S>> {
	if (!ctx.model || !ctx.profile) throw new Error("no model");
	const { output } = await generateText({
		model: ctx.model,
		output: Output.object({ schema }),
		system: persona(ctx.lang),
		prompt,
		temperature: ctx.profile.temperature,
		timeout: ctx.profile.timeoutMs,
		maxRetries: 1,
	});
	return output as z.infer<S>;
}

/**
 * Asks the model whether each text asserts its claim. Returns, per item, true
 * (asserts it) or false. A failing verifier call accepts the items: the
 * deterministic checks already passed and the engine already stored the truth.
 */
async function verify(
	ctx: OracleCtx,
	items: Array<{ text: string; claim: Claim }>,
	errors: string[],
): Promise<boolean[]> {
	if (items.length === 0) return [];
	if (ctx.decider) {
		// One fast forward pass per item; a failing engine falls back to the LLM verifier.
		try {
			const decider = ctx.decider;
			return await Promise.all(
				items.map((it) =>
					decideAssertsClaim(
						decider,
						it.text,
						renderClaim(it.claim, ctx.names, "en"),
					),
				),
			);
		} catch (e) {
			errors.push(`decision engine failed: ${(e as Error).message}`);
		}
	}
	if (!ctx.profile?.verifyClaims) return items.map(() => true);
	try {
		const out = await generate(
			ctx,
			verdicts,
			verifyPrompt(
				items.map((it) => ({
					text: it.text,
					claimEn: renderClaim(it.claim, ctx.names, "en"),
				})),
			),
		);
		return items.map(
			(_, i) => out.verdicts.find((v) => v.index === i)?.asserts === "claim",
		);
	} catch (e) {
		errors.push(`verifier failed: ${(e as Error).message}`);
		return items.map(() => true);
	}
}

const report = (
	purpose: OracleReport["purpose"],
	start: number,
	attempts: number,
	fallbacks: number,
	total: number,
	errors: string[],
): OracleReport => ({
	purpose,
	source:
		fallbacks === 0 && attempts > 0
			? "llm"
			: fallbacks >= total
				? "scripted"
				: "mixed",
	attempts,
	fallbacks,
	latencyMs: Date.now() - start,
	errors,
});

// ---------------------------------------------------------------------------
// Night

export type NightResult = {
	pactOffer: string | null;
	messages: MessageInput[];
	report: OracleReport;
};

/**
 * Tonight's Pact decision and one private message per player. Every message is
 * checked: the engine validates the claim (Static => false, about someone else),
 * the model's intended truth must match the real truth, the text must name the
 * claim's player, and the verifier must agree the text states the claim.
 * Rejected messages are regenerated with feedback; what still fails falls back
 * to scripted messages, so the game never stalls.
 */
export async function oracleNight(
	ctx: OracleCtx,
	state: GameState,
): Promise<NightResult> {
	const start = Date.now();
	const errors: string[] = [];
	const players = state.players.map((p) => p.id);
	const accepted = new Map<string, MessageInput>();
	let pactOffer: string | null | undefined;
	let afterOffer = state;
	let feedback: string[] = [];
	let attempts = 0;

	while (
		ctx.model &&
		accepted.size < players.length &&
		attempts < MAX_ATTEMPTS
	) {
		attempts++;
		let plan: z.infer<typeof nightPlan>;
		try {
			plan = await generate(
				ctx,
				nightPlan,
				nightPrompt(afterOffer, ctx.names, ctx.talk, feedback),
			);
		} catch (e) {
			errors.push(`attempt ${attempts}: ${(e as Error).message}`);
			break;
		}
		feedback = [];
		if (pactOffer === undefined) {
			// The Pact is decided once, on the first usable answer.
			const offer =
				plan.pactOffer && pactCandidates(state).includes(plan.pactOffer)
					? plan.pactOffer
					: null;
			if (plan.pactOffer && !offer)
				errors.push(`ignored invalid pact offer ${plan.pactOffer}`);
			pactOffer = offer;
			afterOffer = offer ? offerPact(state, offer) : state;
		}
		const candidates: Array<{ msg: MessageInput; claim: Claim }> = [];
		for (const to of players.filter((p) => !accepted.has(p))) {
			const m = plan.messages.find((x) => x.to === to);
			const who = ctx.names[to] ?? to;
			if (!m) {
				feedback.push(`missing the message to ${to} (${who})`);
				continue;
			}
			const claim = toEngineClaim(m.claim);
			if (typeof claim === "string") {
				feedback.push(`message to ${to}: ${claim}`);
				continue;
			}
			const msg: MessageInput = {
				to,
				kind: "night",
				text: m.text.trim(),
				claim,
			};
			const engineError = validateMessage(afterOffer, msg);
			if (engineError) {
				feedback.push(
					`message to ${to}: rejected by the rules (${engineError})`,
				);
				continue;
			}
			const real = evaluateClaim(afterOffer, claim);
			if (real !== m.intendedTruth) {
				feedback.push(
					`message to ${to}: you marked it ${m.intendedTruth ? "true" : "false"} but it is actually ${real ? "true" : "false"}; re-read the hidden state`,
				);
				continue;
			}
			const textProblems = checkText(msg.text, claim, ctx.names, {
				allowNamed: [to],
			});
			if (textProblems.length) {
				feedback.push(`message to ${to}: ${textProblems.join("; ")}`);
				continue;
			}
			candidates.push({ msg, claim });
		}
		const ok = await verify(
			ctx,
			candidates.map((c) => ({ text: c.msg.text, claim: c.claim })),
			errors,
		);
		candidates.forEach((c, i) => {
			if (ok[i]) accepted.set(c.msg.to as string, c.msg);
			else
				feedback.push(
					`message to ${c.msg.to}: the text does not clearly state its claim (${renderClaim(c.claim, ctx.names, "en")})`,
				);
		});
		if (feedback.length)
			errors.push(...feedback.map((f) => `attempt ${attempts}: ${f}`));
	}

	if (pactOffer === undefined) {
		pactOffer = scriptedPactOffer(state);
		afterOffer = pactOffer ? offerPact(state, pactOffer) : state;
	}
	const scripted = scriptedNightMessages(afterOffer, ctx.names, ctx.lang);
	const messages = players.map(
		(to) =>
			accepted.get(to) ?? (scripted.find((m) => m.to === to) as MessageInput),
	);
	return {
		pactOffer,
		messages,
		report: report(
			"night",
			start,
			attempts,
			players.length - accepted.size,
			players.length,
			errors,
		),
	};
}

// ---------------------------------------------------------------------------
// Whisper, Mercy, Lie Detector

export async function oracleWhisper(
	ctx: OracleCtx,
	state: GameState,
): Promise<{ message: MessageInput; report: OracleReport }> {
	const start = Date.now();
	const errors: string[] = [];
	let feedback: string[] = [];
	let attempts = 0;
	while (ctx.model && attempts < MAX_ATTEMPTS) {
		attempts++;
		try {
			const out = await generate(
				ctx,
				whisperOut,
				whisperPrompt(state, ctx.names, ctx.talk, feedback),
			);
			feedback = [];
			const claim = toEngineClaim(out.claim);
			if (typeof claim === "string") feedback.push(claim);
			else {
				const msg: MessageInput = {
					to: null,
					kind: "whisper",
					text: out.text.trim(),
					claim,
				};
				const engineError = validateMessage(state, msg);
				if (engineError)
					feedback.push(`rejected by the rules (${engineError})`);
				else if (evaluateClaim(state, claim) !== out.intendedTruth)
					feedback.push("intendedTruth does not match the hidden state");
				else feedback.push(...checkText(msg.text, claim, ctx.names));
				if (!feedback.length) {
					const [ok] = await verify(ctx, [{ text: msg.text, claim }], errors);
					if (ok)
						return {
							message: msg,
							report: report("whisper", start, attempts, 0, 1, errors),
						};
					feedback.push("the text does not clearly state its claim");
				}
			}
			errors.push(...feedback.map((f) => `attempt ${attempts}: ${f}`));
		} catch (e) {
			errors.push(`attempt ${attempts}: ${(e as Error).message}`);
			break;
		}
	}
	return {
		message: scriptedWhisper(state, ctx.names, ctx.lang),
		report: report("whisper", start, attempts, 1, 1, errors),
	};
}

export async function oracleMercy(
	ctx: OracleCtx,
	state: GameState,
	favored: string,
): Promise<{ message: MessageInput; report: OracleReport }> {
	const start = Date.now();
	const errors: string[] = [];
	let feedback: string[] = [];
	let attempts = 0;
	while (ctx.model && attempts < MAX_ATTEMPTS) {
		attempts++;
		try {
			const out = await generate(
				ctx,
				textOut,
				mercyPrompt(state, ctx.names, favored, feedback),
			);
			// Mercy makes no claim; it must name the favored player and no one else.
			feedback = checkText(
				out.text,
				{ type: "isTraitor", player: favored },
				ctx.names,
			);
			if (!feedback.length) {
				return {
					message: {
						to: null,
						kind: "mercy",
						text: out.text.trim(),
						claim: null,
					},
					report: report("mercy", start, attempts, 0, 1, errors),
				};
			}
			errors.push(...feedback.map((f) => `attempt ${attempts}: ${f}`));
		} catch (e) {
			errors.push(`attempt ${attempts}: ${(e as Error).message}`);
			break;
		}
	}
	return {
		message: scriptedMercy(favored, ctx.names, ctx.lang),
		report: report("mercy", start, attempts, 1, 1, errors),
	};
}

/**
 * Lie Detector: the engine has already fixed the answer (`truthfulClaim`). The
 * model only writes the sentence, which must state exactly that claim.
 */
export async function oracleLieDetector(
	ctx: OracleCtx,
	state: GameState,
	to: string,
	truthfulClaim: Claim,
): Promise<{ message: MessageInput; report: OracleReport }> {
	const start = Date.now();
	const errors: string[] = [];
	let feedback: string[] = [];
	let attempts = 0;
	const claimEn = renderClaim(truthfulClaim, ctx.names, "en");
	while (ctx.model && attempts < MAX_ATTEMPTS) {
		attempts++;
		try {
			const out = await generate(
				ctx,
				textOut,
				lieDetectorPrompt(state, ctx.names, to, claimEn, feedback),
			);
			const msg: MessageInput = {
				to,
				kind: "lieDetector",
				text: out.text.trim(),
				claim: truthfulClaim,
			};
			feedback = checkText(msg.text, truthfulClaim, ctx.names, {
				allowNamed: [to],
			});
			const engineError = validateMessage(state, msg);
			if (engineError) feedback.push(engineError);
			if (!feedback.length) {
				const [ok] = await verify(
					ctx,
					[{ text: msg.text, claim: truthfulClaim }],
					errors,
				);
				if (ok)
					return {
						message: msg,
						report: report("lieDetector", start, attempts, 0, 1, errors),
					};
				feedback.push(`the text must state exactly: ${claimEn}`);
			}
			errors.push(...feedback.map((f) => `attempt ${attempts}: ${f}`));
		} catch (e) {
			errors.push(`attempt ${attempts}: ${(e as Error).message}`);
			break;
		}
	}
	return {
		message: scriptedLieDetector(state, to, truthfulClaim, ctx.names, ctx.lang),
		report: report("lieDetector", start, attempts, 1, 1, errors),
	};
}
