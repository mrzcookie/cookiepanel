import { defineConfig } from "drizzle-kit";

import { serverEnv } from "@/lib/server/env";

export default defineConfig({
	dialect: "postgresql",
	schema: "./src/lib/server/db/schema.ts",
	dbCredentials: {
		url: serverEnv.DATABASE_URL,
	},
});
