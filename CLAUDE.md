# Raptor — project guide

Raptor is a **hosted, multi-tenant control panel for running Docker game
servers and apps on your own Linux boxes**. You connect a machine you own, and
Raptor turns it into a managed fleet: spin up a Minecraft (or any) server
from an **Egg**, watch live CPU/memory, and manage files, networks, ports,
firewall, schedules, and backups — without touching a terminal.

The user we build for is **not a Linux admin**. They think in "servers" and
"eggs," not images and containers, and they should never have to learn the
difference. Product north star: **easy + secure** — hide the jargon, be secure
by default.

## The two halves

Raptor is one product made of two programs:

- **Panel** — the hosted web app (the SaaS we run). It owns identity,
  organizations, eggs, and the *desired* state of the fleet. Multi-tenant:
  everything is scoped to an organization.
- **Daemon (`wings`)** — a small Go agent that runs on each managed box, as
  root. It owns the box: Docker containers, host networking, firewall, disk,
  files, schedules, and backups. It keeps working even when the panel is
  unreachable.

The panel drives each box by making **authenticated HTTPS calls** to its
`wings`; the daemon **heartbeats** back to the panel with live status. The
wire format is pinned by a **shared API contract** so the two never drift. See
`.claude/rules/architecture.md` for how that connection actually works.

## Monorepo layout

- `apps/panel` — `@raptor/panel`: TanStack Start (SSR) + React 19 +
  Tailwind v4 web app & API. Server-only code lives under `src/server`.
- `apps/wings` — `wings`: the Go agent for each managed box (all subsystems
  built; in testing + hardening).
- Tooling: pnpm workspaces + Turborepo + Go workspace (`go.work`) + Biome +
  lefthook.

## Domain model (the nouns)

- **Organization** — the tenant. Everything is scoped to the active org.
- **Member / Invitation** — users belong to orgs with a role (owner/admin/…).
- **Node** — a managed Linux box running `wings`.
- **Server** — a Docker container (a game/app instance) running on a node.
- **Egg** — a reusable recipe for a server (image, variable schema,
  startup, install script). Users pick Eggs; raw image strings stay hidden.
- **Network / Allocation (port)** — Docker networks and the port slots servers
  bind to on a node.
- **Drive** — a physical disk on a node (format / mount / store server data).
- **Schedule / Backup** — daemon-side cron automation and snapshot/restore.
- **SFTP session** — per-server file access via daemon-minted, short-lived
  credentials (no account-level SSH keys).
- **Activity log** — an audit trail of meaningful actions, scoped to an org.

Full glossary, fields, and relationships: `.claude/rules/domain.md`.

## Current phase: testing + hardening (build essentially complete)

Both halves are built and wired end-to-end. The panel's data/server layer is
complete — every panel-owned entity (organizations, members, users, activity, the
node registry, eggs, billing, the admin surface) runs through the real
repository → service → server-function layers. And **every planned `wings`
subsystem is implemented** and connected to the panel over the pinned HTTPS
contract: enrollment + heartbeat, Docker servers (lifecycle + console + stats),
networks/firewall/ports, the sandboxed file manager + SFTP, the egg install
pipeline + config templating, the cron scheduler + borg backups, host maintenance
+ physical drives, the offline IPC socket + TUI, ACME TLS, disk quotas, and the
Redis/Mongo/SQL database browsers. Releases ship via a tag-driven pipeline
(`wings` self-updates; new boxes install via the panel's `/install.sh`).

So the work now is **testing and hardening, not building features**:

- **End-to-end testing on real managed Linux boxes.** Many privileged daemon
  paths (mkfs/mount, firewall, systemd, self-update, disk quota, the openat2
  filesystem ops) only run for real on a node — they're unit-tested for logic but
  need on-box verification. The macOS dev box exercises the fallbacks.
- **A few intentional deferrals stay on stubs** — keep these presentational,
  don't half-wire them: the live activity/notification feed
  (`lib/stores/notifications-store`), some cross-org **admin** views (subdomains,
  time-series charts, the fleet node list), and the signed-in `/` control-room
  overview. When it's unclear whether a request means one of these or something
  already wired, check whether its data layer exists, and ask.

## Non-negotiable rules

- **Multi-tenant isolation.** Every operation is scoped to the active
  organization. Always re-check server-side that the target
  node/server/network/etc. belongs to the caller's org before acting. Treat
  cross-org access as a security bug (IDOR), not an edge case.
- **Secure by default.** Encrypt secrets at rest, never return secrets to the
  client, never log them. The daemon runs as root — validate all external input
  (paths, ports, names) and never shell-inject.
- **Eggs over images.** Users see Eggs, never raw Docker image strings.

Details and rationale: `.claude/rules/security.md`.

## Commands

- `pnpm dev` — run the panel (Vite dev, :3000)
- `pnpm build` / `pnpm typecheck` — build / type-check TS workspaces
- `pnpm check` — Biome lint + format (write)
- `pnpm wings:build` / `pnpm wings:run` — build / run the daemon

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
- `panel.md` — panel conventions: the UI patterns and the data-layer shape
  (layering / routing / data-fetching / auth) behind them.
- `daemon.md` — what `wings` owns, subsystem by subsystem, and its on-box
  security posture.
- `security.md` — the non-negotiables in full: tenant isolation, secrets,
  validating untrusted input on a root daemon.
- `design.md` — design language orientation: "The Console" (dark) / "Daylight"
  is live; the full spec lives in `DESIGN.md` and the `impeccable` skill drives
  further design work.
