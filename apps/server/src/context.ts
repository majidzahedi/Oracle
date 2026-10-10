import type { Context as ApiContext } from "@oracle/api/context";
import type { Context as HonoContext } from "hono";
import { inngest } from "./inngest/client";
import { auth, db } from "./services";

export type CreateContextOptions = {
	context: HonoContext;
};

export async function createContext({
	context,
}: CreateContextOptions): Promise<ApiContext> {
	const session = await auth.api.getSession({
		headers: context.req.raw.headers,
	});
	return {
		db,
		session,
		inngest,
	};
}

export type Context = Awaited<ReturnType<typeof createContext>>;
