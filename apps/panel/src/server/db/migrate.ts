import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/**
 * Standalone migration runner for production / CI — the Docker entrypoint calls
 * this once before the server starts. Unlike `drizzle-kit migrate`, it needs
 * only `drizzle-orm` + `postgres` at runtime (no dev tooling), so the deploy
 * image stays lean. It applies every pending file in ./migrations against
 * `DATABASE_URL`, then exits; drizzle skips already-applied migrations, so it's
 * safe to run on every boot.
 *
 * It reads `process.env.DATABASE_URL` directly rather than the validated
 * `@/server/env` on purpose: it runs outside the app, before the server boots,
 * and must not drag in the full runtime env surface.
 */

const url = process.env.DATABASE_URL;
if (!url) {
	throw new Error("DATABASE_URL is required to run migrations");
}

// Migrations must run serially on a single connection; close it as soon as
// they finish so the process can exit cleanly.
const sql = postgres(url, { max: 1 });

// Resolve ./migrations relative to this file so the same script works both in
// the repo (src/server/db/migrate.ts) and in the image, where the script and
// its SQL are copied side by side.
const migrationsFolder = fileURLToPath(
	new URL("./migrations", import.meta.url)
);

try {
	// biome-ignore lint/suspicious/noConsole: progress output for a CLI migrator.
	console.log("[migrate] applying pending migrations…");
	await migrate(drizzle(sql), { migrationsFolder });
	// biome-ignore lint/suspicious/noConsole: progress output for a CLI migrator.
	console.log("[migrate] done");
} finally {
	await sql.end();
}
