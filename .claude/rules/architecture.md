# Architecture — the two halves and how they talk

> **Status: built.** The panel↔daemon protocol below is implemented on both
> sides — enrollment + heartbeat, the pinned HTTPS control channel, and the full
> per-subsystem surface. The panel's auth + data layer is mature; `apps/wings`
> implements every subsystem. What remains is end-to-end testing on real boxes,
> not building the wire. This describes how it works today.

Raptor is one product split into two programs that run in different places
and trust each other over the network.

## Panel (control plane)

The hosted SaaS we run. A TanStack Start app (SSR + API) backed by Postgres. It
owns:

- **Identity & tenancy** — users, organizations, members, invitations.
- **Eggs** — the recipes users deploy from (the panel's "egg" library).
- **Desired state** — the registry of nodes, port allocations, and what *should*
  be running where. The panel records intent; the daemon makes it real.

The panel never touches a box's OS directly. It expresses intent by calling that
box's daemon, and it reads live state from what the daemon reports.

## Daemon — `wings` (the box)

A single Go binary on each managed Linux box, running **as root**. It owns the
box's *actual* state: Docker containers, networks, firewall, disks, files,
schedules, backups. It persists its own state locally and is **offline-resilient**
— schedules keep firing and the box stays controllable even when the panel is
unreachable; the panel reconciles on reconnect. Full subsystem breakdown:
`daemon.md`.

## How the two connect

Three directions of traffic, by design:

1. **Panel → daemon (control).** The daemon serves an **HTTPS API**; the panel
   makes authenticated calls to it to create servers, open ports, manage files,
   etc. This is the main control channel.
2. **Daemon → panel (heartbeat).** The daemon periodically calls home with live
   system + Docker info, its TLS cert fingerprint, and its API port. This is how
   the panel learns a node's status, hardware, and address.
3. **Box-local (offline control).** The daemon also exposes a **root-only Unix
   socket** for an on-box CLI/TUI, so an operator can manage the box directly
   even with the panel down. Never involves the panel.

### Trust model

The panel and daemon don't share a CA or a network — trust is bootstrapped
per node and then pinned.

- **Per-node key.** At enrollment the panel mints a durable secret (a "node
  key") for the box. It's the **Bearer token** in both directions: the panel
  presents it on every API call to the daemon, and the daemon presents it when
  it heartbeats. The panel stores only a hash + an encrypted copy; the daemon
  stores it `0600`, root-only.
- **TLS + cert pinning.** The daemon serves HTTPS with either a **self-signed**
  cert (default) or a **Let's Encrypt / ACME** cert for its FQDN.
  - Self-signed: the panel pins `sha256(leaf cert)`. The daemon keeps the same
    cert across restarts so the pin stays stable. The fingerprint reaches the
    panel **via the heartbeat** — the panel can't make its first call until it
    has seen one.
  - ACME: there's nothing stable to pin (public certs rotate), so the panel
    verifies against the normal system trust store instead.
- **Browser console (WebSocket).** Live console + stats stream over a WebSocket
  straight from the browser to the daemon. Browsers can't set auth headers on a
  WS upgrade, so the panel mints a **short-lived HS256 JWT** (signed with a
  separate per-node signing secret) and passes it as a query param. The daemon
  verifies it locally — no panel round-trip — and checks it's bound to this
  exact server and node.

### Enrollment (pairing a box)

1. The operator creates a Node in the panel and gets a one-line install command
   carrying a **single-use bootstrap token** (the panel stores only its hash +
   an expiry).
2. They run that command on the box. `wings` installs and calls the panel's
   enrollment endpoint with the token.
3. The panel validates the token, **mints the durable node key + signing secret**,
   returns them **once**, and marks the node active. The box persists them and
   starts heartbeating; the node flips from `pending` to `online`.
4. The panel does **not** trust the daemon's self-reported FQDN — the address is
   operator-owned (set at node creation). Only the cert fingerprint and the
   observed source IP are taken from the daemon. (A bootstrap-token holder must
   not be able to redirect credentialed panel calls to an attacker host.)

## The shared contract (so the halves never drift)

The panel↔daemon API is defined **once** as an OpenAPI spec in the
`@raptor/contract` package (`packages/contract/openapi.yaml`). Code
generation produces typed bindings for **both** sides:

- **TypeScript types** (`openapi-typescript`) the panel imports as
  `@raptor/contract`.
- **Go types** (`oapi-codegen`, models-only) the daemon imports as
  `internal/contract`.

Generated bindings are **committed** (not gitignored) so a fresh checkout builds
and type-checks without a generate step. The two sides bind to the contract
differently, by their role:

- **Panel (the API's client) consumes the generated types directly.** The
  `daemon-client` wire types are aliases of `components["schemas"][…]` — there's
  nothing to drift, because the panel's types *are* the spec's. A spec change
  regenerates `gen/contract.ts`; the panel then either still compiles or fails at
  the consumer, in the normal `tsc`.
- **Daemon (the API's owner) keeps its hand-written domain structs and asserts
  conformance.** Those structs have behavior and identity (they're the box's
  domain model, not pure DTOs), so they stay hand-owned; a Go JSON round-trip test
  (`internal/contract/conformance_test.go`, in the normal `go test`) fails the
  build if any struct's wire form drifts from the spec.
- **Drift check.** A CI job regenerates from the spec and fails if the committed
  bindings are stale (`git diff --exit-code`).

So the loop is: daemon struct ⟷ spec (conformance) ⟷ generated types ⟷ panel
(direct consumption) — drift anywhere fails a build. The workflow to evolve the
API: edit `openapi.yaml`, run `bun run --filter @raptor/contract generate`,
reconcile the daemon structs until conformance passes (the panel just recompiles),
and commit the spec **and** the regenerated output.

The contract covers the full panel→daemon surface: system, servers, networks,
firewall, drives, files, sftp, schedules, backups. The console WebSocket is
intentionally **not** modelled — it isn't request/response shaped.

> Why the asymmetry: the panel is a *client* of the API, so consuming generated
> types is the correct dependency direction. The daemon *implements* the API, so
> aliasing its domain model to the wire codegen would invert that direction (and
> force Go-specific pointer-skip hints into the neutral spec) for no gain over
> conformance — which already guarantees no drift. So the daemon stays hand-written
> + asserted.

## Panel-side note

The panel reaches each box through **one client module** —
`src/server/nodes/daemon-client.ts`. It owns the whole seam: `loadDialer(nodeId)`
unseals the node key, the cert-pinning agent verifies `sha256(leaf)` against the
pin (or trust-store for ACME) before any byte is written, per-op timeouts apply,
and `DaemonError` carries failures. Panel business logic depends on the typed
wrappers there (and on `DaemonRead<T>` for reads that degrade when a box is
offline) — never on raw daemon HTTP scattered through the codebase.

## Phasing

The product was built **panel-first**: the panel matured against stubbed data,
then its data layer landed, then the real daemon. Both are now built. The panel
stays runnable without a reachable box — daemon-derived reads return
`DaemonRead<T>` (`{ ok: false }` when offline) and the UI degrades gracefully
rather than erroring. See `panel.md`.
