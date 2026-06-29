# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────────
# Raptor panel — production image (single long-lived Bun container, for Dokploy).
#
# One Bun toolchain throughout: install the workspace, build the panel with
# Nitro's `bun` preset (set in apps/panel/vite.config.ts), and run the
# self-contained `.output` server. A tiny entrypoint applies DB migrations, then
# starts the server.
#
# The build context is the repo ROOT — the panel is one workspace package and
# the build needs the lockfile + the @raptor/contract source. In Dokploy:
#   Build Type    = Dockerfile
#   Dockerfile    = ./Dockerfile
#   Build Context = repo root
# Real secrets are NOT baked in — they're injected as env vars at runtime.
# ─────────────────────────────────────────────────────────────────────────────

# ---- builder: install the workspace and build the panel ----
FROM oven/bun:1 AS builder
WORKDIR /repo

# Install with the committed bun lockfile (deterministic). The whole repo is in
# context (minus .dockerignore); the workspace resolves @raptor/contract from
# source.
COPY . .
RUN bun install --frozen-lockfile

# Public, build-time client var — baked into the bundle, so it must be present
# now (not at runtime). Optional: the managed-DNS path is simply off when empty.
# Pass with `--build-arg VITE_NODES_DOMAIN=nodes.example.com`.
ARG VITE_NODES_DOMAIN=""
ENV VITE_NODES_DOMAIN=${VITE_NODES_DOMAIN}

# Build the panel. The `bun` preset is set in vite.config.ts, and the build
# script runs Vite under the Bun runtime (`bun --bun vite build`). No secrets are
# needed to build, so env validation is skipped — the real env is supplied at
# runtime.
RUN SKIP_ENV_VALIDATION=1 bun run --filter @raptor/panel build

# ---- runtime: slim Bun image running the built server ----
FROM oven/bun:1-slim AS runtime
ENV NODE_ENV=production \
	PORT=3000
WORKDIR /app

# The self-contained Nitro output (bundles its own server deps), runnable by Bun.
COPY --from=builder /repo/apps/panel/.output ./.output

# The standalone migrator + its SQL. It needs only drizzle-orm + postgres at
# runtime (pinned to the app's versions — keep in sync with
# apps/panel/package.json), installed cleanly here so the image ships no dev
# tooling. migrate.ts resolves ./migrations relative to itself.
COPY --from=builder /repo/apps/panel/src/server/db/migrate.ts ./migrate.ts
COPY --from=builder /repo/apps/panel/src/server/db/migrations ./migrations
RUN bun add drizzle-orm@0.45.2 postgres@3.4.9

COPY --from=builder /repo/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

EXPOSE 3000

# Liveness — hits the dependency-free /healthz route via Bun (already present).
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
	CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["./docker-entrypoint.sh"]
