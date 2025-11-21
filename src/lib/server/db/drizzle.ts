import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import { serverEnv } from "@/lib/server/env";

export const client = neon(serverEnv.DATABASE_URL);
export const database = drizzle({ client });
