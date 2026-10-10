/**
 * Client for typed-decision models that speak the Jev protocol
 * (`POST /v1/systemone`): self-hosted Laya (`laya-serve`) or TypeSafe's hosted
 * Jev. They answer fixed-option questions about a text in one forward pass, so
 * the game uses them only where it needs a choice, never for writing text.
 */

export type DeciderProfile = {
	baseUrl: string;
	apiKey: string | null;
	/** e.g. "multilingual", "english", "jev-1"; empty = server default routing. */
	model: string | null;
	timeoutMs: number;
};

export type ChoiceAnswer = { choice: string; probability: number };

export interface Decider {
	/** One `choice` question about `state`. Rejects on transport or protocol errors. */
	choice(
		state: Record<string, string>,
		instructions: string,
		criteria: Record<string, string>,
	): Promise<ChoiceAnswer>;
}

type ChoiceWire = {
	type?: string;
	choice?: string;
	probabilities?: Record<string, number>;
};

export function createJevDecider(p: DeciderProfile): Decider {
	const url = `${p.baseUrl.replace(/\/$/, "")}/v1/systemone`;
	return {
		async choice(state, instructions, criteria) {
			const res = await fetch(url, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					...(p.apiKey ? { authorization: `Bearer ${p.apiKey}` } : {}),
				},
				body: JSON.stringify({
					...(p.model ? { model: p.model } : {}),
					state,
					questions: { q: { type: "choice", instructions, criteria } },
				}),
				signal: AbortSignal.timeout(p.timeoutMs),
			});
			if (!res.ok)
				throw new Error(
					`decision engine HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`,
				);
			const body = (await res.json()) as {
				answers?: Record<string, ChoiceWire>;
			};
			const a = body.answers?.q;
			if (!a?.choice || !(a.choice in criteria))
				throw new Error("decision engine returned no valid choice");
			return {
				choice: a.choice,
				probability: a.probabilities?.[a.choice] ?? 0,
			};
		},
	};
}

/** Minimum probability for a verdict to count. Below it, the decision is treated as unsure. */
export const MIN_DECISION_PROBABILITY = 0.5;

/** Does `text` assert `claimEn`, its opposite, or neither? true only for a confident "claim". */
export async function decideAssertsClaim(
	d: Decider,
	text: string,
	claimEn: string,
): Promise<boolean> {
	const a = await d.choice(
		{ statement: text, claim: claimEn },
		"Read the statement. Does it assert the claim, assert the opposite of the claim, or neither?",
		{
			claim: "the statement asserts the claim",
			negation: "the statement asserts the opposite of the claim",
			unrelated: "the statement asserts neither",
		},
	);
	return a.choice === "claim" && a.probability >= MIN_DECISION_PROBABILITY;
}

/**
 * Who a chat line accuses or casts suspicion on (player id), or null. Used by
 * bots to read the table. `players` maps ids to display names.
 */
export async function decideAccused(
	d: Decider,
	text: string,
	players: Record<string, string>,
): Promise<string | null> {
	const criteria: Record<string, string> = {
		nobody: "accuses or suspects no one",
	};
	for (const [id, name] of Object.entries(players))
		criteria[id] = `accuses or casts suspicion on ${name}`;
	const a = await d.choice(
		{ message: text },
		"Who does this chat message accuse or cast suspicion on?",
		criteria,
	);
	return a.choice !== "nobody" && a.probability >= MIN_DECISION_PROBABILITY
		? a.choice
		: null;
}
