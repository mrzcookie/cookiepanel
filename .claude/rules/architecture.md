# Architecture — the two halves and how they talk

> **Status.** This describes the *target* system. Today the panel is a UI-first
> scaffold and the daemon is a stub; neither side of the connection below is
> wired yet. This is the design to build toward, not what exists.

CookiePanel is one product split into two programs that run in different places
and trust each other over the network.

## Panel (control plane)

The hosted SaaS we run. A TanStack Start app (SSR + API) backed by Postgres. It
owns:

- **Identity & tenancy** — users, organizations, members, invitations.
- **Templates** — the recipes users deploy from (the panel's "egg" library).
- **Desired state** — the registry of nodes, port allocations, and what *should*
  be running where. The panel records intent; the daemon makes it real.

The panel never touches a box's OS directly. It expresses intent by calling that
box's daemon, and it reads live state from what the daemon reports.

## Daemon — `cookied` (the box)

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
2. They run that command on the box. `cookied` installs and calls the panel's
   enrollment endpoint with the token.
3. The panel validates the token, **mints the durable node key + signing secret**,
   returns them **once**, and marks the node active. The box persists them and
   starts heartbeating; the node flips from `pending` to `online`.
4. The panel does **not** trust the daemon's self-reported FQDN — the address is
   operator-owned (set at node creation). Only the cert fingerprint and the
   observed source IP are taken from the daemon. (A bootstrap-token holder must
   not be able to redirect credentialed panel calls to an attacker host.)

## The shared contract (so the halves never drift)

The panel↔daemon API is defined **once** as an OpenAPI spec in a contract
package. Code generation produces typed bindings for **both** sides from that
one spec:

- **TypeScript types** for the panel.
- **Go types (and client)** for the daemon.

CI regenerates and fails on any diff, so a change to the API is a change to the
spec — the two languages can't fall out of sync. The workflow to evolve the API:
edit the spec, regenerate, commit the spec (generated artifacts are gitignored),
let CI verify.

The contract covers the full surface: system/stats, servers/containers, files,
networks, firewall, schedules, backups, and the console WebSocket.

> The earlier `../cookiepanel-old` had this contract package but had only
> formalized a few routes in the spec (the rest were hand-written on both
> sides). Re-deriving the full route table into the spec is the intended path.

## Panel-side note

How the panel's server layer actually reaches the daemon — a dedicated client
module, a fake-vs-real split for dev, where timeouts and the pinning agent live
— is an **open design choice for this rewrite, not yet decided**. The prior
version routed everything through one client abstraction; we may or may not do
the same. What's fixed is the *protocol above* (HTTPS + node key + cert pin +
contract), not the panel's internal plumbing for it. Don't enshrine a particular
client shape in code or docs until we choose one.

## Phasing

The product is built **panel-first**: mature the panel against static/stubbed
data, then build the data layer, then the real daemon. The panel must always be
runnable without a daemon binary — early on with placeholder data, later with a
stub/fake for the box. See `panel.md` for what that means in the panel codebase.
