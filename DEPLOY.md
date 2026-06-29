# Deploying the panel (Dokploy)

The panel ships as a **single long-lived Bun container**. It builds with Nitro's
`bun` preset and runs the self-contained `.output` server. The image's entrypoint
applies pending DB migrations, then starts the server on **port 3000**, with a
dependency-free liveness route at **`/healthz`**.

This is a host-it-yourself setup (Dokploy on your own VPS) — there is no
serverless/Vercel coupling. The DB driver is plain `postgres.js` over TCP, so any
normal Postgres works.

## Dokploy: create the application

1. **New → Application**, point it at this repo/branch.
2. **Build Type:** `Dockerfile`
   - **Dockerfile path:** `./Dockerfile`
   - **Build context:** repo root (the build needs the lockfile + the
     `@raptor/contract` workspace source).
3. **Port:** `3000` (the domain/SSL is handled by Dokploy's Traefik).
4. **Health check path:** `/healthz`.
5. Set the environment variables below, then deploy.

### Optional build-time arg

`VITE_NODES_DOMAIN` is a **public** client var baked into the bundle at build
time (the base domain for managed-node subdomains). Leave it unset to turn the
managed-DNS path off, or pass it as a Docker build arg
(`--build-arg VITE_NODES_DOMAIN=nodes.example.com`).

## Backing services

Attach these as Dokploy services (or point at external ones):

- **Postgres** — set `DATABASE_URL`. Migrations run automatically on each boot
  (idempotent; set `RUN_MIGRATIONS=false` to disable and run them as a separate
  job).
- **Redis** — Better Auth's session + rate-limit storage. A plain Redis over
  TCP; set `REDIS_URL` (e.g. `redis://default:pass@host:6379`).

## Environment variables

**Required** (the app refuses to boot without these):

| Var | What |
| --- | --- |
| `DATABASE_URL` | Postgres connection string |
| `REDIS_URL` | Redis connection string (`redis://` or `rediss://`) |
| `AUTH_SECRET` | Better Auth signing secret (`openssl rand -base64 32`) |
| `AUTH_URL` | Public base URL the app is served from |
| `ENCRYPTION_KEY` | 32-byte hex for sealing secrets (`openssl rand -hex 32`) |

**Optional** (feature groups — absent = that feature is off): OAuth
(`GITHUB_*`, `GOOGLE_*`), email (`RESEND_API_KEY`, `EMAIL_FROM`), billing
(`POLAR_*`), managed DNS (`CLOUDFLARE_*`), daemon releases
(`DAEMON_LATEST_VERSION`, `DAEMON_RELEASE_BASE_URL`), object storage (`S3_*`).
See `apps/panel/src/server/env.ts` for the full, validated list.

`NODE_ENV=production` and `PORT=3000` are set in the image; override `PORT` if
your platform needs a different one.

## Build / run locally

```bash
# build the production server (the `bun` preset is set in vite.config.ts)
bun run --filter @raptor/panel build

# run migrations, then the server
bun run --filter @raptor/panel db:migrate:deploy
bun run --filter @raptor/panel start     # bun run .output/server/index.mjs

# or build the image the way Dokploy does
docker build -t raptor-panel .
docker run --rm -p 3000:3000 --env-file apps/panel/.env raptor-panel
```
