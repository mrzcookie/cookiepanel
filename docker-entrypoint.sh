#!/bin/sh
set -e

# Container entrypoint for the Raptor panel.
#
# Applies pending DB migrations, then starts the Bun server. Migrations run on
# every boot by default (drizzle skips already-applied files, so it's
# idempotent); set RUN_MIGRATIONS=false to leave them to a separate job.

if [ "${RUN_MIGRATIONS:-true}" != "false" ]; then
	echo "[entrypoint] applying database migrations"
	bun run /app/migrate.ts
fi

echo "[entrypoint] starting panel on :${PORT:-3000}"
exec bun run /app/.output/server/index.mjs
