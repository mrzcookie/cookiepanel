import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/server/env";
import * as schema from "./schema";

/**
 * The Drizzle client (server-only). The repository layer is the only place
 * that imports this; services and routes go through repositories, never raw
 * SQL. Org-scoping is enforced in those repositories (see `security.md`).
 */

// One postgres.js pool, reused across requests. In dev it's cached on
// globalThis so HMR re-evaluating this module doesn't open a fresh pool each
// time and exhaust connections.
const globalForDb = globalThis as unknown as {
	__raptorDbClient?: ReturnType<typeof postgres>;
};

const client = globalForDb.__raptorDbClient ?? postgres(env.DATABASE_URL);
if (env.NODE_ENV !== "production") {
	globalForDb.__raptorDbClient = client;
}

export const db = drizzle(client, { schema });
