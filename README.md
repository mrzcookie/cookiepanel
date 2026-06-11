# CookiePanel

A hosted, multi-tenant control panel for running Docker game servers and apps on
**your own Linux boxes** — plus the per-box daemon that does the work.

Connect a machine you own and CookiePanel turns it into a managed fleet: deploy a
server from a **Template**, watch live resource usage, and manage files,
networks, ports, firewall, schedules, and backups — no terminal required. It's
built for people who aren't Linux admins: you think in *servers* and *templates*,
not images and containers. The goal is **easy + secure** by default.

## How it works

CookiePanel is two programs:

- A central web **panel** (the hosted SaaS) owns identity, organizations,
  templates, and the desired state of your fleet.
- A per-box Go **daemon** (`cookied`) owns each machine — Docker, networking,
  firewall, and disk — and keeps running even if the panel is unreachable.

The panel drives each box over an authenticated HTTPS API — secured with a
per-node key and a pinned certificate; the daemon heartbeats back with live
status. A shared API contract keeps the two in sync. (See
`.claude/rules/architecture.md` for the trust model.)

## Layout

```
apps/
  panel/    TanStack Start web app + API (the hosted panel)
  daemon/   cookied — the Go agent that runs on each managed box
```

> **Status: structural rewrite in progress.** The panel is being built
> **UI-first** — shadcn components and presentational React with static
> placeholder data, and **no backend wiring yet**. The data layer (auth,
> persistence) and the real daemon land in later phases. The daemon is currently
> a buildable stub.

## Prerequisites

- Node 24+ and pnpm 10.28+
- Go 1.25+

## Getting started

```bash
pnpm install        # install JS/TS workspaces
pnpm dev            # run the panel (Vite dev) on :3000

pnpm daemon:build   # build the cookied binary
pnpm daemon:run     # run the daemon (stub for now)
```

## Commands

| Command             | What it does                  |
|---------------------|-------------------------------|
| `pnpm dev`          | Run the panel dev server      |
| `pnpm build`        | Build TS workspaces (panel)   |
| `pnpm typecheck`    | Type-check TS workspaces      |
| `pnpm check`        | Biome lint + format           |
| `pnpm daemon:build` | Build the `cookied` binary    |
| `pnpm daemon:run`   | Run the `cookied` daemon      |
| `pnpm daemon:test`  | Run the daemon's Go tests     |

## Repo docs

- `CLAUDE.md` — the project guide (what CookiePanel is, the rules, the current
  phase). The entry point for contributors and AI agents.
- `.claude/rules/` — deep dives: `architecture`, `domain`, `panel`, `daemon`,
  `security`, `design`.

## License

Copyright (C) 2026 CookiePanel.

This program is free software: licensed under the GNU Affero General Public
License, either version 3 or (at your option) any later version
([AGPL-3.0-or-later](./LICENSE)).
