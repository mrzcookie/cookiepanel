# Security — the non-negotiables

Raptor runs other people's servers on machines they own, and one panel
serves many tenants. Two properties are non-negotiable: **tenants can never
reach each other's resources**, and **the root daemon never trusts its input**.
Treat a violation of either as a bug, not an edge case.

## 1. Multi-tenant isolation (IDOR is the threat)

Every operation is scoped to the caller's **active organization**, and that
scope is **re-verified server-side on every request**. A user must never be able
to read or act on another org's node, server, network, egg, allocation, or
file by guessing or replaying an id.

Defense in depth — all three tiers, not just one:

- **Don't trust the session's active-org alone.** The active-org id rides a
  short-lived cookie cache and can go stale (e.g. the user was removed from that
  org in another session). Re-query membership in the DB before any org-scoped
  operation.
- **Load the target scoped to the org**, and return a **generic not-found** when
  it's absent — a row in another org must be **indistinguishable from a missing
  one**, so ids can't be probed. Never return "forbidden" in a way that confirms
  the id exists.
- **Backstop in the data layer.** Every repository predicate ANDs the
  `organizationId`, so even a service-layer bug can't fetch or mutate another
  org's row.

A shared dev/stub fixture is **not** isolation — when state is faked across orgs,
add an explicit ownership check (e.g. on the provisioning org) and delete it when
real data lands.

## 2. Secrets

- **Encrypt at rest.** Per-server secret variable values are sealed with
  authenticated encryption (AES-GCM), with the ciphertext **bound to its context**
  (org + server + env-var name) via the GCM AAD, so a blob can't be lifted from
  one server and replayed into another.
- **Never return secrets to the client.** Secret variables are write-only;
  client-safe projections strip them (a secret's "default" reads back as null).
  Server-only fields — Docker image strings/digests, install-script provenance —
  never appear in client responses either.
- **Never log secrets.** Plaintext exists only at the moment of dispatch to the
  box, then is dropped.
- **Validate the key material.** The encryption key is validated at load (correct
  length) and lives only in server-only env (`src/server` / t3-env), never in the
  client bundle.

## 3. The daemon runs as root — validate everything

`wings` runs as root on the box, so all external input is hostile until proven
otherwise (full detail in `daemon.md`):

- **Paths** are sandboxed to a server's volume and re-checked to stay under root
  after cleaning — no `../` traversal.
- **Ports** are bounded to 1–65535, protocols to tcp/udp.
- **Names/ids** pass regex allowlists — no shell metacharacters.
- **No shell injection** — invoke external tools with arg vectors, never a shell
  string.
- **Untrusted code** (egg install scripts) runs in a resource-bounded
  throwaway container with a hard timeout, never on the host.
- **Guard rails that prevent self-lockout / data loss:** the firewall refuses to
  close SSH (22) or the daemon's own port; the OS/system drive can never be
  formatted, unmounted, or repurposed. Enforce these **authoritatively
  server-side**, not just in the UI.

## 4. The panel↔daemon trust boundary

The panel and daemon don't share a CA or a network (see `architecture.md`):

- **Per-node Bearer key** authenticates both directions; the panel stores only a
  hash + an encrypted copy, the daemon stores it `0600`.
- **TLS with cert pinning** for self-signed daemons (`sha256(leaf)`), or
  trust-store verification for ACME certs.
- **Enrollment is a single-use bootstrap token**; the durable credentials are
  returned exactly once and the token is invalidated.
- **The panel does not trust daemon-self-reported identity** (e.g. FQDN) — the
  address is operator-owned; only the cert fingerprint and observed IP come from
  the daemon.
- **Browser console** uses a short-lived, narrowly-scoped HS256 JWT (separate
  signing secret), verified by the daemon and bound to one server + node.

## 5. Eggs over images (a product+security rule)

Users pick **Eggs**, never raw Docker image strings. The image string and
its digest are **server-only**; the client sees a friendly label. Official
(platform-owned) eggs are read-only to tenants. A egg's install script
runs as root on the box, so the daemon isolates it in a resource-bounded
throwaway container with a hard timeout (see `daemon.md`). This keeps untrusted
image/script choices behind a curated, auditable boundary.
