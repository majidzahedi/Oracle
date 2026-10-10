import type { Database } from "@oracle/db";
import { llmProfiles, oracleCalls } from "@oracle/db/schema/llm";
import {
	createModel,
	type LlmProfile,
	listModels,
	type OracleReport,
	type Provider,
} from "@oracle/oracle";
import { ORPCError } from "@orpc/server";
import { generateText, Output } from "ai";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { decryptSecret, encryptSecret } from "./crypto";

type Row = typeof llmProfiles.$inferSelect;

/** What the admin UI sees: never the key itself. */
export type ProfileView = Omit<Row, "apiKeyEnc"> & { hasApiKey: boolean };

export const toView = ({ apiKeyEnc, ...rest }: Row): ProfileView => ({
	...rest,
	hasApiKey: Boolean(apiKeyEnc),
});

export type ProfileInput = {
	name: string;
	provider: Provider;
	model: string;
	baseUrl: string | null;
	/** undefined = keep the stored key, null or "" = remove it */
	apiKey?: string | null;
	temperature: number;
	timeoutMs: number;
	verifyClaims: boolean;
	enabled: boolean;
};

const notFound = () =>
	new ORPCError("NOT_FOUND", { message: "profileNotFound" });

export async function listProfiles(db: Database): Promise<ProfileView[]> {
	const rows = await db
		.select()
		.from(llmProfiles)
		.orderBy(llmProfiles.createdAt);
	return rows.map(toView);
}

async function keyFields(input: ProfileInput, secret: string) {
	if (input.apiKey === undefined) return {};
	if (!input.apiKey) return { apiKeyEnc: null, apiKeyHint: null };
	return {
		apiKeyEnc: await encryptSecret(input.apiKey, secret),
		apiKeyHint: input.apiKey.slice(-4),
	};
}

export async function createProfile(
	db: Database,
	secret: string,
	input: ProfileInput,
): Promise<ProfileView> {
	const { apiKey: _, ...fields } = input;
	const [row] = await db
		.insert(llmProfiles)
		.values({
			id: crypto.randomUUID(),
			...fields,
			baseUrl: fields.baseUrl || null,
			...(await keyFields(input, secret)),
		})
		.returning();
	return toView(row as Row);
}

export async function updateProfile(
	db: Database,
	secret: string,
	id: string,
	input: ProfileInput,
): Promise<ProfileView> {
	const { apiKey: _, ...fields } = input;
	const [row] = await db
		.update(llmProfiles)
		.set({
			...fields,
			baseUrl: fields.baseUrl || null,
			...(await keyFields(input, secret)),
		})
		.where(eq(llmProfiles.id, id))
		.returning();
	if (!row) throw notFound();
	return toView(row);
}

export async function deleteProfile(db: Database, id: string) {
	await db.delete(llmProfiles).where(eq(llmProfiles.id, id));
	return { ok: true };
}

/** id null = no default (games use the scripted Oracle unless the host picks a profile). */
export async function setDefault(db: Database, id: string | null) {
	await db.transaction(async (tx) => {
		await tx
			.update(llmProfiles)
			.set({ isDefault: false })
			.where(eq(llmProfiles.isDefault, true));
		if (id) {
			const [row] = await tx
				.update(llmProfiles)
				.set({ isDefault: true })
				.where(eq(llmProfiles.id, id))
				.returning();
			if (!row) throw notFound();
		}
	});
	return { ok: true };
}

async function toProfile(row: Row, secret: string): Promise<LlmProfile> {
	return {
		id: row.id,
		name: row.name,
		provider: row.provider as Provider,
		model: row.model,
		baseUrl: row.baseUrl,
		apiKey: row.apiKeyEnc ? await decryptSecret(row.apiKeyEnc, secret) : null,
		temperature: row.temperature,
		timeoutMs: row.timeoutMs,
		verifyClaims: row.verifyClaims,
	};
}

/** Loads a usable (enabled) profile with its decrypted key, or null. */
export async function loadProfile(
	db: Database,
	secret: string,
	id: string,
): Promise<LlmProfile | null> {
	const [row] = await db
		.select()
		.from(llmProfiles)
		.where(and(eq(llmProfiles.id, id), eq(llmProfiles.enabled, true)));
	return row ? toProfile(row, secret) : null;
}

export async function defaultProfileId(db: Database): Promise<string | null> {
	const [row] = await db
		.select({ id: llmProfiles.id })
		.from(llmProfiles)
		.where(and(eq(llmProfiles.isDefault, true), eq(llmProfiles.enabled, true)));
	return row?.id ?? null;
}

/** Sends a tiny structured request so the admin can see that a profile works, and how fast. */
export async function testProfile(db: Database, secret: string, id: string) {
	const [row] = await db
		.select()
		.from(llmProfiles)
		.where(eq(llmProfiles.id, id));
	if (!row) throw notFound();
	const profile = await toProfile(row, secret);
	const start = Date.now();
	try {
		const { output } = await generateText({
			model: createModel(profile),
			output: Output.object({ schema: z.object({ greeting: z.string() }) }),
			prompt:
				"You are the Oracle, the AI of an underground vault. Greet four trapped prisoners in one unsettling sentence.",
			temperature: profile.temperature,
			timeout: profile.timeoutMs,
			maxRetries: 0,
		});
		return {
			ok: true as const,
			latencyMs: Date.now() - start,
			sample: output.greeting,
		};
	} catch (e) {
		return {
			ok: false as const,
			latencyMs: Date.now() - start,
			error: (e as Error).message.slice(0, 500),
		};
	}
}

/** Model discovery for the form. Uses the stored key when editing an existing profile. */
export async function discoverModels(
	db: Database,
	secret: string,
	input: {
		provider: Provider;
		baseUrl: string | null;
		apiKey?: string | null;
		profileId?: string;
	},
) {
	let apiKey = input.apiKey ?? null;
	if (!apiKey && input.profileId) {
		const [row] = await db
			.select()
			.from(llmProfiles)
			.where(eq(llmProfiles.id, input.profileId));
		if (row?.apiKeyEnc) apiKey = await decryptSecret(row.apiKeyEnc, secret);
	}
	try {
		return {
			models: await listModels({
				provider: input.provider,
				baseUrl: input.baseUrl,
				apiKey,
			}),
			error: null,
		};
	} catch (e) {
		return {
			models: [] as string[],
			error: (e as Error).message.slice(0, 300),
		};
	}
}

export async function logOracleCall(
	db: Database,
	call: {
		gameId: string;
		round: number;
		profileId: string | null;
		report: OracleReport;
	},
) {
	await db.insert(oracleCalls).values({
		id: crypto.randomUUID(),
		gameId: call.gameId,
		round: call.round,
		purpose: call.report.purpose,
		profileId: call.profileId,
		source: call.report.source,
		attempts: call.report.attempts,
		fallbacks: call.report.fallbacks,
		latencyMs: call.report.latencyMs,
		errors: call.report.errors.slice(0, 30),
	});
}

export async function recentCalls(db: Database, limit = 50) {
	return db
		.select()
		.from(oracleCalls)
		.orderBy(desc(oracleCalls.createdAt))
		.limit(limit);
}
