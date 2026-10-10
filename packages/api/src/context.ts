import type { Session } from "@oracle/auth";
import type { Database } from "@oracle/db";

export type Context = {
	session: Session | null;
	db: Database;
};
