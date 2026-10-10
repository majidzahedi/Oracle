import type { Session } from "@oracle/auth";
import type { Database } from "@oracle/db";
import type { Inngest } from "inngest";

export type Context = {
	session: Session | null;
	db: Database;
	/** Injected by apps/server, which owns the Inngest client configuration. */
	inngest: Inngest.Any;
};
