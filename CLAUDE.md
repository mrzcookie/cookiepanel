# CookiePanel — project guide

CookiePanel is a **hosted, multi-tenant control panel for running Docker game
servers and apps on your own Linux boxes**. You connect a machine you own, and
CookiePanel turns it into a managed fleet: spin up a Minecraft (or any) server
from a **Template**, watch live CPU/memory, and manage files, networks, ports,
firewall, schedules, and backups — without touching a terminal.

The user we build for is **not a Linux admin**. They think in "servers" and
"templates," not images and containers, and they should never have to learn the
difference. Product north star: **easy + secure** — hide the jargon, be secure
by default.

## The two halves

CookiePanel is one product made of two programs:

- **Panel** — the hosted web app (the SaaS we run). It owns identity,
  organizations, templates, and the *desired* state of the fleet. Multi-tenant:
  everything is scoped to an organization.
- **Daemon (`cookied`)** — a small Go agent that runs on each managed box, as
  root. It owns the box: Docker containers, host networking, firewall, disk,
  files, schedules, and backups. It keeps working even when the panel is
  unreachable.

The panel drives each box by making **authenticated HTTPS calls** to its
`cookied`; the daemon **heartbeats** back to the panel with live status. The
wire format is pinned by a **shared API contract** so the two never drift. See
`.claude/rules/architecture.md` for how that connection actually works.

## Monorepo layout

- `apps/panel` — `@cookiepanel/panel`: TanStack Start (SSR) + React 19 +
  Tailwind v4 web app & API. Server-only code lives under `src/server`.
- `apps/daemon` — `cookied`: the Go agent for each managed box (an active,
  phased build — it enrolls + heartbeats today; the rest lands slice by slice).
- Tooling: pnpm workspaces + Turborepo + Go workspace (`go.work`) + Biome +
  lefthook.

## Domain model (the nouns)

- **Organization** — the tenant. Everything is scoped to the active org.
- **Member / Invitation** — users belong to orgs with a role (owner/admin/…).
- **Node** — a managed Linux box running `cookied`.
- **Server** — a Docker container (a game/app instance) running on a node.
- **Template** — a reusable recipe for a server (image, variable schema,
  startup, install script). Users pick Templates; raw image strings stay hidden.
- **Network / Allocation (port)** — Docker networks and the port slots servers
  bind to on a node.
- **Drive** — a physical disk on a node (format / mount / store server data).
- **Schedule / Backup** — daemon-side cron automation and snapshot/restore.
- **SSH key / SFTP session** — account-level access for file management.
- **Activity log** — an audit trail of meaningful actions, scoped to an org.

Full glossary, fields, and relationships: `.claude/rules/domain.md`.

## Current phase: building the daemon + the panel↔daemon connection

The panel's data/server layer is **essentially complete** — every panel-owned,
DB-backed entity (organizations, members, users, activity, the node registry,
templates, billing, the admin surface) is wired through the real
repository → service → server-function layers. What's left in the panel are the
**daemon-derived** features (servers, networks, drives, firewall, files, SFTP,
schedules, backups), which by design can't be real until `cookied` exists.

So the current phase is **the daemon and the wire to it**, built in vertical
slices — each slice ships one capability end-to-end (a daemon subsystem + its
panel-side connection + the UI swapped off its stub) and is independently
committable:

- **Slices 0–1** — scaffolding + enrollment/heartbeat: a box pairs with the panel
  and flips `pending → online` with real hardware/Docker info.
- **Slice 2** — the panel→daemon control channel (the daemon's HTTPS API + the
  panel's node-client seam, with cert pinning).
- **Slices 3+** — Docker/servers, the console WebSocket, networks/firewall/ports,
  files/SFTP, schedules/backups, host maintenance — each swapping its
  `lib/stores/*` stub for real daemon-backed data.

Until a feature's slice lands it **stays on its stub store** — keep it
presentational, don't half-wire it. When it's unclear whether a request means the
UI or a daemon capability that isn't built yet, assume the UI and ask. `apps/daemon`
is now an active build (no longer a stub); the rules files describe the *target*
architecture it's converging on.

## Non-negotiable rules

- **Multi-tenant isolation.** Every operation is scoped to the active
  organization. Always re-check server-side that the target
  node/server/network/etc. belongs to the caller's org before acting. Treat
  cross-org access as a security bug (IDOR), not an edge case.
- **Secure by default.** Encrypt secrets at rest, never return secrets to the
  client, never log them. The daemon runs as root — validate all external input
  (paths, ports, names) and never shell-inject.
- **Templates over images.** Users see Templates, never raw Docker image strings.

Details and rationale: `.claude/rules/security.md`.

## Commands

- `pnpm dev` — run the panel (Vite dev, :3000)
- `pnpm build` / `pnpm typecheck` — build / type-check TS workspaces
- `pnpm check` — Biome lint + format (write)
- `pnpm daemon:build` / `pnpm daemon:run` — build / run the daemon

## Code style

- TS / CSS / JSON: **Biome** — tabs, line width 80, double quotes, semicolons,
  trailing commas `es5`, organized imports, sorted Tailwind classes. Run
  `pnpm check`.
- Go: `gofmt` + `go vet` (enforced by the lefthook pre-commit hook).
- Match the conventions of the surrounding code.

## Commits

Conventional Commits (`feat:`, `fix:`, `chore:`, `refactor:`, …): a short
subject line, then a blank line, then a `-` bulleted body listing what changed.

## Deep-dive docs (read on demand)

These live in `.claude/rules/`. Read the relevant one before working in that
area — they hold the detail this file deliberately leaves out.

- `architecture.md` — the two halves, how the panel and daemon talk (HTTPS,
  per-node key, cert pinning, enrollment, heartbeat), and the shared contract.
- `domain.md` — every domain noun, its fields, relationships, and lifecycle.
- `panel.md` — panel conventions: the UI/stub patterns and the data-layer shape
  (layering / routing / data-fetching / auth) we're now building behind the UI.
- `daemon.md` — what `cookied` is and will own, subsystem by subsystem, and its
  on-box security posture.
- `security.md` — the non-negotiables in full: tenant isolation, secrets,
  validating untrusted input on a root daemon.
- `design.md` — design language orientation: "The Console" (dark) / "Daylight"
  is live; the full spec lives in `DESIGN.md` and the `impeccable` skill drives
  further design work.

## Reference projects (read-only — never edit)

Two earlier versions sit beside this repo. They are kept **for reference only;
never edit them**, and you should not need them — this guide and the rules files
are meant to be self-contained.

- `../cookiepanel-old` — the most *complete* version: a full `cookied` daemon
  and the API contract package.
- `../cookiepanel-oldv2` — the cleanest *panel* structure (layering, auth,
  templates, routing).
