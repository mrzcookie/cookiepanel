import { existsSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

// drizzle-kit runs outside the app (no env validation in scope), so load the
// panel's .env ourselves with Node's built-in loader before reading the URL.
if (existsSync(".env")) {
	process.loadEnvFile(".env");
}

const url = process.env.DATABASE_URL ?? "";

// `generate` only needs the schema; `migrate`/`push`/`studio`/`pull` need a
// live connection — fail clearly when the URL is missing for those.
const needsConnection = process.argv.some((arg) =>
	["migrate", "push", "studio", "pull", "check", "up"].includes(arg)
);
if (needsConnection && !url) {
	throw new Error("DATABASE_URL is required for this drizzle-kit command");
}

export default defineConfig({
	dialect: "postgresql",
	schema: "./src/server/db/schema/index.ts",
	out: "./src/server/db/migrations",
	dbCredentials: { url },
	strict: true,
	verbose: true,
});
