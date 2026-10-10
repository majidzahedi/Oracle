import type { Claim } from "@oracle/engine";
import { z } from "zod";

/**
 * Claims in a flat, model-friendly shape. `negated` flips the statement, e.g.
 * { type: "isTraitor", player: "p2", negated: true } = "p2 is NOT the traitor".
 * Nullable instead of optional fields keeps strict JSON-schema modes happy.
 */
export const llmClaim = z.object({
	type: z.enum(["isTraitor", "receivedPact", "playedOffType", "traitorExists"]),
	player: z
		.string()
		.nullable()
		.describe("Player id like p2. Null only for traitorExists."),
	round: z
		.number()
		.int()
		.nullable()
		.describe("Round number. Only for playedOffType, otherwise null."),
	negated: z
		.boolean()
		.describe("True if the text asserts the opposite of the claim."),
});
export type LlmClaim = z.infer<typeof llmClaim>;

export const nightMessage = z.object({
	to: z.string().describe("Recipient player id"),
	claim: llmClaim,
	intendedTruth: z
		.boolean()
		.describe("Whether you intend this statement to be true"),
	text: z.string().describe("What you say to the recipient, in character"),
});

export const nightPlan = z.object({
	pactOffer: z
		.string()
		.nullable()
		.describe("Player id to offer the Pact to tonight, or null"),
	messages: z.array(nightMessage),
});
export type NightPlanOutput = z.infer<typeof nightPlan>;

export const whisperOut = z.object({
	claim: llmClaim,
	intendedTruth: z.boolean(),
	text: z.string(),
});

export const textOut = z.object({ text: z.string() });

export const verdicts = z.object({
	verdicts: z.array(
		z.object({
			index: z.number().int(),
			asserts: z.enum(["claim", "negation", "unrelated"]),
		}),
	),
});

/** Converts to an engine claim, or returns an error string. */
export function toEngineClaim(c: LlmClaim): Claim | string {
	let base: Claim;
	if (c.type === "traitorExists") base = { type: "traitorExists" };
	else if (!c.player) return `claim ${c.type} needs a player`;
	else if (c.type === "playedOffType") {
		if (!c.round) return "playedOffType needs a round";
		base = { type: "playedOffType", player: c.player, round: c.round };
	} else base = { type: c.type, player: c.player };
	return c.negated ? { type: "not", claim: base } : base;
}

export function fromEngineClaim(claim: Claim): LlmClaim {
	let negated = false;
	let c = claim;
	while (c.type === "not") {
		negated = !negated;
		c = c.claim;
	}
	if (c.type === "noTraitorYet")
		return {
			type: "traitorExists",
			player: null,
			round: null,
			negated: !negated,
		};
	return {
		type: c.type,
		player: "player" in c ? c.player : null,
		round: c.type === "playedOffType" ? c.round : null,
		negated,
	};
}
