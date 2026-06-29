# Raptor

A hosted, multi-tenant control panel for running Docker game servers and apps on
**your own Linux boxes** — plus the per-box daemon that does the work.

Connect a machine you own and Raptor turns it into a managed fleet: deploy a
server from an **Egg**, watch live resource usage, and manage files,
networks, ports, firewall, schedules, and backups — no terminal required. It's
built for people who aren't Linux admins: you think in *servers* and *eggs*,
not images and containers. The goal is **easy + secure** by default.

## How it works

Raptor is two programs:

- A central web **panel** (the hosted SaaS) owns identity, organizations,
  eggs, and the desired state of your fleet.
- A per-box Go **daemon** (`wings`) owns each machine — Docker, networking,
  firewall, and disk — and keeps running even if the panel is unreachable.

The panel drives each box over an authenticated HTTPS API — secured with a
per-node key and a pinned certificate; the daemon heartbeats back with live
status. A shared API contract keeps the two in sync. (See
`.claude/rules/architecture.md` for the trust model.)

## Layout

```
apps/
  panel/    TanStack Start web app + API (the hosted panel)
  wings/    the Go agent that runs on each managed box
```

> **Status: feature-complete; now in testing/hardening.** The panel's data layer
> and every planned `wings` subsystem are built and wired end-to-end:
> enrollment + heartbeat, the pinned HTTPS control API, Docker servers (lifecycle
> + console + stats), networks/firewall/ports, the sandboxed file manager + SFTP,
> the egg-style install pipeline + config templating, the cron scheduler + borg
> backups, host maintenance + physical-drive management, the offline IPC socket +
> TUI, ACME TLS, disk quotas, the Redis/Mongo/SQL database browsers, and a
> tag-driven release pipeline (`wings` self-updates; new boxes install via
> `/install.sh`). What's left is **real-world testing on managed Linux boxes**
> (several privileged paths only run for real on a node) plus a few intentional
> deferrals (a live activity/notification feed, some cross-org admin views, the
> signed-in `/` overview dashboard).

## Prerequisites

- Bun 1.2+
- Go 1.25+
- Docker (for the local dev infra — Postgres + Redis; see `infra/`)

## Getting started

```bash
bun install                  # install JS/TS workspaces
bun run dev:up               # start dev infra (Postgres + Redis) — see infra/

cp apps/panel/.env.example apps/panel/.env          # then fill AUTH_SECRET + ENCRYPTION_KEY
bun run --filter @raptor/panel db:migrate      # apply database migrations

bun run dev                  # run the panel (Vite dev) on :3000
bun run dev:down             # stop the dev infra when done

bun run wings:build         # build the wings binary
bun run wings:run           # run the daemon (heartbeat loop; needs `wings configure` first)
```

## Commands

| Command                | What it does                  |
|------------------------|-------------------------------|
| `bun run dev`          | Run the panel dev server      |
| `bun run dev:up`       | Start dev infra (Postgres + Redis) |
| `bun run dev:down`     | Stop the dev infra            |
| `bun run build`        | Build TS workspaces (panel)   |
| `bun run typecheck`    | Type-check TS workspaces      |
| `bun run check`        | Biome lint + format           |
| `bun run wings:build` | Build the `wings` binary    |
| `bun run wings:run`   | Run the `wings` daemon      |
| `bun run wings:test`  | Run the daemon's Go tests     |

## Repo docs

- `CLAUDE.md` — the project guide (what Raptor is, the rules, the current
  phase). The entry point for contributors and AI agents.
- `.claude/rules/` — deep dives: `architecture`, `domain`, `panel`, `daemon`,
  `security`, `design`.

## License

Copyright (C) 2026 Xena Studios.

This program is free software: licensed under version 3 of the GNU Affero
General Public License ([AGPL-3.0-only](./LICENSE)).
