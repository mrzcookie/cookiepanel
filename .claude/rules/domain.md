# Domain model

> **Status: built.** This is the product's *conceptual* model — what the nouns
> are and how they relate. The panel-owned entities (below) are real Postgres
> tables; the daemon-derived ones are live from the box (reported over the
> contract, merged onto the registry at read time). All of it is implemented;
> field names here are descriptive, not a frozen schema.

Everything is scoped to an **Organization**. The model splits cleanly into two
halves, and that split is the important, durable part:

- **Panel-owned (DB-backed, Postgres):** Organization, User, Member, Invitation,
  Node *registry*, Server *registry* (template snapshot + sealed secret vars),
  Template (+ images + variables), Port allocations, Activity log. These are
  *desired state* and identity — the panel's source of truth.
- **Daemon-derived (live, from the box):** a Server's *live* state (running/
  stopped, cpu/mem), Network, Drive, Firewall, and a Node's *live* fields
  (status, hardware, usage, heartbeats). These are *actual state* — the daemon
  reports them and the panel layers them onto the registry at read time; when a
  box is unreachable they read as `{ ok: false }` and the UI degrades.

## Tenancy & identity

### Organization — the tenant
The unit of multi-tenancy; every other noun lives under one. Key fields: `name`,
`slug` (unique), `logo`. Owns members, invitations, nodes, and org-owned
templates. **Org-scoping is the central invariant** — re-verified server-side on
every operation, never trusted from the session alone. See `security.md`.

### User
An account, managed by the auth layer. Holds a theme preference (also persisted
to the row so it follows the account). Belongs to orgs via Member. (File access
is per-server SFTP with daemon-minted credentials — there are no account-level
SSH keys.)

### Member
The join between a User and an Organization, with a `role` (owner / admin /
member). **Note:** the role is stored, but **role-based gating is deferred**
today — actions check org *membership*, not role. A panel-wide RBAC design
comes later.

### Invitation
A pending offer to join an org: `email`, optional `role`, `status`, `expiresAt`,
inviter. Accepting it creates a Member.

## Fleet

### Node — a managed Linux box running `cookied`
The panel keeps a durable **registry row**; **live state is not stored** — it
comes from heartbeats and is merged in on read.
- Registry (panel-owned): `id` (stable across renames), `name` (display),
  `fqdn` (where the panel reaches the daemon), `daemonPort`, `managed` (panel
  minted a subdomain + DNS vs. operator-pointed address), the enrollment token
  hash, and operator-set allocatable caps (CPU / memory / disk — never exceed
  detected hardware).
- Live (daemon-derived): `status` (online / offline / unhealthy / pending),
  public IP, OS / arch / CPU / memory / disk totals, daemon version (+ whether
  an update exists), container counts, `lastHeartbeatAt`.
- Actions: update daemon, restart daemon, prune, reboot, remove.

### Server — a Docker container (a game/app instance) on a Node
Created from a Template. A panel **registry row** (org/node, the template id +
version snapshotted at creation, the server-only image string, and sealed secret
variables) carrying **daemon-derived live state** (state, cpu/mem) merged in at
read time.
- Fields: `nodeId`, `name`, `templateName` (friendly — **never a raw image
  string**), the `templateId` + version **snapshotted at creation**,
  `updateAvailable` (the source template has a newer published version), `state`
  (running / stopped / starting / installing / failed), primary published
  `port`, live `cpuPercent` / `memUsedBytes`, `memLimitBytes`, and `networkIds`
  (the **source of truth** for server↔network membership — a network's server
  count is *derived* from this).
- The org-wide list view also carries the node name/address so the UI can show a
  player connect string (`host:port`).
- Actions: start / stop / restart / remove.

### Network — a Docker network on a Node
Daemon-derived. `driver` (bridge / macvlan / ipvlan), optional `subnet` (CIDR) +
`gateway`, `internal` (no outbound access), and a `serverCount` derived from
servers' `networkIds`. Servers attach/detach to networks.

### Allocation (port) — a port slot on a Node
**Panel-owned registry** (not daemon-derived). A bind `ip` (`0.0.0.0` = all
interfaces) + `port` (1–65535), and which server (if any) holds it. A free slot
can be released; one assigned to a server cannot. Firewall rules open/close in
lockstep with allocations.

### Drive — a physical disk on a Node
Daemon-derived. `device`, `model`, size/used bytes, `filesystem` (null =
unformatted), `mountpoint` (null = unmounted), and whether server data is stored
on it. Lifecycle: format / mount / unmount / set as the data target. **Hard
guard:** the OS/system drive (mounted at `/` or `/boot`) can never be formatted,
unmounted, or repurposed — enforced in the UI *and* authoritatively server-side.

### Firewall — daemon-side runtime state
No panel table. `backend` (ufw / iptables / none), `active`, and a list of
`{port, protocol}` rules. **Guard:** SSH (22) and the daemon's own port can't be
closed, so a click can't lock the operator out.

## Templates — "templates over images"

### Template — the panel's "egg"
A reusable, deployable recipe for a server/app, and the embodiment of the
**templates-over-images** rule. Equivalent to a Pterodactyl/Pelican *egg*. This
is the panel's first and richest DB-backed entity.
- Ownership: `organizationId` **NULL = official/platform-owned** (read-only to
  every org); non-null = org-owned and editable. That null check is the *only*
  switch marking a template "official."
- Shape: `name` / `slug` / `summary` / `description`, `category`, an icon
  reference (S3 key), `origin` (official / scratch / import / fork), `status`
  (draft → published → archived), and a `version` that bumps on re-publish.
- Lineage: a template can be **forked** from an official/org one (single-level).
- Runtime config: a `startupCommand` with `{{VAR}}` tokens, stop signal, "done"
  markers, config-file templates.
- Install spec: an optional `installScript` (+ container image + entrypoint).
  The script runs as root on the box, so the daemon isolates it — it runs once
  in a resource-bounded throwaway container with a hard timeout, never on the
  host (see `daemon.md`).

Two child collections hang off a Template:

- **Images** — a `label` → Docker `image` mapping. **The image string and its
  digest are server-only**; the client only ever sees the friendly label. This
  *is* the templates-over-images promise, enforced in the data model.
- **Variables** — friendly env-vars the user fills in: `name`, `description`,
  the underlying `envVariable`, a default, view/edit flags, a **`secret`** flag
  (write-only, per-server, never returned), and validation `rules` (required /
  string / numeric / min / max / regex / …). Imported "Laravel-style" rule
  strings are normalized into typed rules; regexes compile under RE2, never raw.

**Authoring lifecycle.** Create from scratch, import (JSON or URL), or fork.
Import/export interops with Pterodactyl/Pelican eggs. Authors choose a simple
variable "type" (text / number / toggle / select) — the editor never exposes raw
rule syntax or raw image strings.

## Access & audit

### Activity log
Audit trail of meaningful actions: who, which org, category, action, target, IP.

## Daemon-owned automation & access

These nouns have **no panel table** — they live on the box (so they keep working
while the panel is offline) and the panel reads/edits them over the contract,
degrading to `{ ok: false }` when a box is unreachable.

- **Schedule** — cron automation for a server. Typed steps: command / wait /
  power (start/stop/restart) / backup. Defined in the daemon's local store so it
  fires across restarts and while the panel is down; the panel is the editor.
- **Backup** — snapshot/restore of a server's data volume, deduplicated borg
  archives with a shared per-node repo. Runs in a throwaway container.
- **SFTP session** — per-server file access via a daemon-minted, short-lived
  username/password (one active per server). The file manager (browse/edit/
  upload/download/archive) is built on top.

## Desired vs. actual state (the reconciliation idea)

The panel↔daemon split *is* a desired-vs-actual state machine:

- The **panel owns desired state** (registry rows: nodes, templates,
  allocations) and issues **intent** (provision this server, open this port).
- The **daemon owns actual state** and **converges** to the intent, then reports
  back. A server goes `installing → running` (or `failed`); the panel reflects
  whatever the daemon last reported, merged onto the registry row at read time.

When you build the service layer, business logic and this intent→convergence
flow live there — not in the thin request handlers and not in the data layer.
See `panel.md`.
