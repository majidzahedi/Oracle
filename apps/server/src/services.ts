import { createAuth } from "@oracle/auth";
import { createDb } from "@oracle/db";

import { ENV } from "./env.server";

export const db = createDb(ENV);
export const auth = createAuth(ENV, db);
