# Panel conventions

`apps/panel` is `@cookiepanel/panel`: **TanStack Start (SSR) + React 19 +
Tailwind v4**, file-based routing, server functions for the API. This file has
two parts: the **UI patterns** the panel is built on and the **data/server
layer** behind them. The data layer is now wired for essentially everything; only
a few intentional features still run on stubs (a live activity/notification feed,
some cross-org admin views, the `/` overview) — keep *those* presentational and
don't half-wire them.

## The UI / stub layer

The panel's surface is presentational; most of it is fed by the real data layer
(below), and the handful of not-yet-built features render from a stub store until
their backend exists:

- **shadcn components + presentational React components.** Add shadcn primitives
  via the CLI/MCP; build domain components on top of them. Keep components
  presentational — props in, markup out.
- **Stub data behind the props.** A not-yet-wired feature renders from its stub
  store (`lib/stores/*`), not a backend. **Don't invent a backend for it** —
  define a typed stub and feed it in; when its data layer lands it swaps in behind
  the same props. If it's unclear whether a request means the UI or a backend that
  doesn't exist yet, assume the UI and ask.
- **Styling:** Tailwind v4 (`@import "tailwindcss"` in `src/styles/global.css`),
  Biome-sorted classes. Design language is **"The Console"** (live) — see
  `design.md` / `DESIGN.md`.

When in doubt, model a page on its eventual job (a fleet view, a server detail,
a template editor) but implement only the view with fake data.

**Folder layout.** Where components and lib modules go (the `ui`/`layout`/`shared`/
domain split, the `lib/domain` vs `stores` vs `stubs` split, the server import
boundary, the no-barrels rule) is documented in **`apps/panel/ARCHITECTURE.md`**.
Read it before adding files so the tree stays sorted.

## The data/server layer

Server code lives under **`src/server/**`, which is server-only** — it must never
reach the client bundle. That means `node:crypto`,
the DB client, `node:https`, the auth server config, and validated secrets/env
all stay under `src/server`. Client-safe domain types and helpers live in
`src/lib/**` so both the server and the UI can import them.

The backend is **three layers, strictly separated**:

1. **Repository** — the *only* layer that touches the database (Drizzle).
   Plain query objects, one per entity. **Every predicate is org-scoped**: each
   method takes the `orgId` and ANDs it into the `where`, so a row in another
   org is indistinguishable from a missing one (the IDOR defense at the data
   layer). Repos return full rows; projecting to client-safe views is the
   service's job.
2. **Service** — business logic, validation, projections, and the
   desired→actual state machine (see `domain.md`). Guards that throw on
   cross-org/ownership violations live here, and they throw a **generic
   not-found** so ids can't be probed. Secrets get sealed here before leaving
   the server; client-safe views (with secrets stripped) are produced here.
3. **Server functions** — thin **`auth + validate + delegate`** shims, created
   with `createServerFn`. They validate input (Zod), call a guard to establish
   the org + resource scope, delegate to a service, and return. **No SQL, no
   business logic** in this layer.

> The prior rewrite often **collapsed service + server-fn into one file** per
> domain (e.g. `server/templates/index.ts`) — guards/projections as private
> functions, `createServerFn` wrappers as the public surface. The layering is
> *conceptual*; it needn't be three separate files, but the data layer must stay
> isolated in the repository.

### Multi-tenant enforcement (defense in depth)

Org-scoping is checked at two tiers and the session value is **never trusted
alone**:

- A `requireOrg`-style guard reads the active org from the session **and
  re-queries membership in the DB** before any org-scoped op — the active-org id
  rides a cookie cache and can go stale.
- A resource guard (`requireNode`, `requireTemplate`, …) then loads the target
  **scoped to that org** and throws a generic not-found if absent — so
  cross-org ids look identical to missing ones.
- The repository layer ANDs `organizationId` into every predicate as a backstop.

Full rationale and the secrets discipline: `security.md`.

### Reaching the daemon

The panel's server layer makes authenticated HTTPS calls to each box's `cookied`
(node key + cert pin + the shared contract — see `architecture.md`). This is
funnelled through **one client module**, `src/server/nodes/daemon-client.ts`:
`loadDialer(nodeId)` unseals the node key, the pinning agent verifies the cert
before any byte is written, per-op timeouts apply, and typed wrappers return the
contract shapes (reads as `DaemonRead<T>`, degrading to `{ ok: false }` when the
box is unreachable). Panel business logic depends on those typed wrappers — never
on raw daemon HTTP scattered through the codebase. A daemon-derived feature is
org-scoped at its server-fn boundary first (re-verify the node/server belongs to
the caller's org), then reaches the box via this client.

## Data fetching

TanStack Query + Router SSR, in one flow: **server fn → `queryOptions` → loader
`ensureQueryData` → component `useSuspenseQuery`**.

- Define `queryOptions` factories (in `lib/*-queries.ts`) pairing a query key
  with a server-fn call.
- Route **loaders preload** via `context.queryClient.ensureQueryData(...)` so SSR
  renders with data — no loading flash, no hydration mismatch.
- Components read with `useSuspenseQuery(sameOptions)` to hit the warm cache.
- A **fresh `QueryClient` per request** (never shared across requests), wired
  with `setupRouterSsrQueryIntegration`; the client is injected via router
  context (`createRootRouteWithContext<{ queryClient }>`).
- **Live readouts** (status, usage, fleet) use a polling policy
  (`refetchInterval`, only while focused).
- **Mutations** are usually plain async handlers: call the `Fn`, toast, then
  explicitly invalidate the affected query keys.
- **Auth state is separate** — it lives on the auth library's own React hooks,
  not the query/loader path.

## Routing conventions

File-based routing under `src/routes/`. Conventions that matter:

- **No `/dashboard` prefix.** Authed pages live under a **pathless `_app`
  layout** (`_app.tsx`) that adds the app shell + auth guard **without** adding a
  URL segment, so URLs stay clean (`/nodes`, `/servers`, `/account`).
- **`/` is the dashboard.** Signed in, `/` is the control-room overview; signed
  out, it's the landing page. `/home` is always the marketing landing.
- **Auth/utility pages sit outside `_app`** (no app shell): `login`, `register`,
  `onboarding`, invitation-accept, auth-error. Each bounces already-signed-in
  users away.
- **Tabbed sub-pages** = a parent layout route holding a tab bar + `<Outlet />`,
  with one child route per tab (e.g. account → general / activity; node detail →
  overview / networking / storage / settings).
- Trailing-underscore segments escape layout nesting while keeping the URL (a
  detail route opts out of its list's layout). `$param` = dynamic segment.

## Auth stack

- **Better Auth**, via its **minimal entrypoint** (`better-auth/minimal`) to
  avoid the Kysely dependency; DB through the Drizzle adapter.
- **Passwordless** — email/password disabled; sign-in is a **magic link** plus
  optional social providers (shown only when their env creds exist).
- Plugins: `organization()` (multi-tenancy) + `magicLink()`; the TanStack Start
  cookies plugin **must be last** so `Set-Cookie` is forwarded.
- **Env via t3-env** (`@t3-oss/env-core` + Zod, server-only, eager-validated).
  The auth env prefix is **`AUTH_`** (`AUTH_SECRET`, `AUTH_URL`) — *not*
  `BETTER_AUTH_`.
- **Theme** via `next-themes` (`attribute="class"`, default dark), also
  persisted to the user row so it follows the account.

## Version churn to watch

TanStack Start/Router/Query APIs (`createServerFn`, `createFileRoute`, the
SSR-query integration) move across minor versions. Verify signatures against the
installed versions rather than trusting any snippet — including the ones here.
