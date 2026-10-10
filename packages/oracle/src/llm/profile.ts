import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

export const PROVIDERS = [
	"ollama",
	"openai-compatible",
	"anthropic",
	"openai",
	"google",
	"laya",
] as const;
export type Provider = (typeof PROVIDERS)[number];

/** Typed-decision engines (Laya / TypeSafe Jev): they answer choices, they cannot write text. */
export const DECISION_PROVIDERS: readonly Provider[] = ["laya"];
export const isLanguageModel = (p: Provider) => !DECISION_PROVIDERS.includes(p);

/** Checkpoints a Laya server ships (plus Jev's id); a decision engine has no model listing. */
export const LAYA_MODELS = [
	"multilingual",
	"english",
	"typed-decisions",
	"jev-1",
];

export const DEFAULT_BASE_URL: Partial<Record<Provider, string>> = {
	ollama: "http://localhost:11434/v1",
	laya: "http://localhost:8000",
};

/** An LLM configuration managed in the admin dashboard. apiKey is already decrypted here. */
export type LlmProfile = {
	id: string;
	name: string;
	provider: Provider;
	model: string;
	baseUrl: string | null;
	apiKey: string | null;
	temperature: number;
	/** Per model call. */
	timeoutMs: number;
	/** Ask the model to check that each text really states its claim. */
	verifyClaims: boolean;
};

/** Builds an AI SDK model for a profile. Ollama and friends go through the OpenAI-compatible API. */
export function createModel(p: LlmProfile): LanguageModel {
	const baseURL = p.baseUrl || DEFAULT_BASE_URL[p.provider] || undefined;
	const apiKey = p.apiKey || undefined;
	switch (p.provider) {
		case "ollama":
		case "openai-compatible":
			if (!baseURL)
				throw new Error(
					"baseUrl is required for an OpenAI-compatible provider",
				);
			return createOpenAICompatible({
				name: p.provider,
				baseURL,
				apiKey,
				supportsStructuredOutputs: true,
			})(p.model);
		case "anthropic":
			return createAnthropic({ apiKey, baseURL })(p.model);
		case "openai":
			return createOpenAI({ apiKey, baseURL })(p.model);
		case "google":
			return createGoogleGenerativeAI({ apiKey, baseURL })(p.model);
		case "laya":
			throw new Error(
				"a decision engine cannot write text; use it for decisions only",
			);
	}
}

/** Lists models a server offers (OpenAI-compatible `/models`; Ollama also has `/api/tags`). */
export async function listModels(
	p: Pick<LlmProfile, "provider" | "baseUrl" | "apiKey">,
): Promise<string[]> {
	const base = (p.baseUrl || DEFAULT_BASE_URL[p.provider] || "").replace(
		/\/$/,
		"",
	);
	if (!base) return [];
	if (p.provider === "laya") return LAYA_MODELS;
	const headers: Record<string, string> = p.apiKey
		? { Authorization: `Bearer ${p.apiKey}` }
		: {};
	const res = await fetch(`${base}/models`, {
		headers,
		signal: AbortSignal.timeout(8000),
	});
	if (res.ok) {
		const body = (await res.json()) as { data?: Array<{ id: string }> };
		return (body.data ?? []).map((m) => m.id).sort();
	}
	if (p.provider === "ollama") {
		const tags = await fetch(`${base.replace(/\/v1$/, "")}/api/tags`, {
			signal: AbortSignal.timeout(8000),
		});
		if (tags.ok) {
			const body = (await tags.json()) as { models?: Array<{ name: string }> };
			return (body.models ?? []).map((m) => m.name).sort();
		}
	}
	throw new Error(`model list failed: HTTP ${res.status}`);
}
