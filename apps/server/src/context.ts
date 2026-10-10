import type { Context as ApiContext } from "@oracle/api/context";
import type { Context as HonoContext } from "hono";

import { ENV } from "./env.server";
import { inngest } from "./inngest/client";
import { auth, db } from "./services";

export type CreateContextOptions = {
	context: HonoContext;
};

const adminEmails = new Set(
	(ENV.ADMIN_EMAILS ?? "")
		.split(",")
		.map((e) => e.trim().toLowerCase())
		.filter(Boolean),
);

export async function createContext({
	context,
}: CreateContextOptions): Promise<ApiContext> {
	const session = await auth.api.getSession({
		headers: context.req.raw.headers,
	});
	const user = session?.user;
	return {
		db,
		session,
		inngest,
		secret: ENV.BETTER_AUTH_SECRET,
		isAdmin: Boolean(
			user && !user.isAnonymous && adminEmails.has(user.email.toLowerCase()),
		),
	};
}

export type Context = Awaited<ReturnType<typeof createContext>>;
