import { PROVIDERS } from "@oracle/oracle";
import { z } from "zod";

import { adminProcedure, protectedProcedure } from "../index";
import * as profiles from "../llm/profiles";

const profileInput = z.object({
	name: z.string().trim().min(1).max(60),
	provider: z.enum(PROVIDERS),
	model: z.string().trim().min(1).max(200),
	baseUrl: z
		.string()
		.trim()
		.url()
		.nullable()
		.or(z.literal("").transform(() => null)),
	apiKey: z.string().max(500).nullable().optional(),
	temperature: z.number().min(0).max(2),
	timeoutMs: z.number().int().min(2000).max(600_000),
	verifyClaims: z.boolean(),
	enabled: z.boolean(),
});

export const adminRouter = {
	/** Lets the UI decide whether to show the admin link. */
	me: protectedProcedure.handler(({ context }) => ({
		isAdmin: context.isAdmin,
	})),
	profiles: {
		list: adminProcedure.handler(({ context }) =>
			profiles.listProfiles(context.db),
		),
		create: adminProcedure
			.input(profileInput)
			.handler(({ context, input }) =>
				profiles.createProfile(context.db, context.secret, input),
			),
		update: adminProcedure
			.input(z.object({ id: z.string(), data: profileInput }))
			.handler(({ context, input }) =>
				profiles.updateProfile(
					context.db,
					context.secret,
					input.id,
					input.data,
				),
			),
		remove: adminProcedure
			.input(z.object({ id: z.string() }))
			.handler(({ context, input }) =>
				profiles.deleteProfile(context.db, input.id),
			),
		setDefault: adminProcedure
			.input(z.object({ id: z.string().nullable() }))
			.handler(({ context, input }) =>
				profiles.setDefault(context.db, input.id),
			),
		test: adminProcedure
			.input(z.object({ id: z.string() }))
			.handler(({ context, input }) =>
				profiles.testProfile(context.db, context.secret, input.id),
			),
		models: adminProcedure
			.input(
				z.object({
					provider: z.enum(PROVIDERS),
					baseUrl: z.string().nullable(),
					apiKey: z.string().nullable().optional(),
					profileId: z.string().optional(),
				}),
			)
			.handler(({ context, input }) =>
				profiles.discoverModels(context.db, context.secret, input),
			),
	},
	calls: adminProcedure.handler(({ context }) =>
		profiles.recentCalls(context.db),
	),
};
