# Panel conventions

`apps/panel` is `@cookiepanel/panel`: **TanStack Start (SSR) + React 19 +
Tailwind v4**, file-based routing, server functions for the API. This file has
two parts: how we work **now** (UI-first), and the **intended** shape of the
data layer for later. Don't build the "later" parts before their phase.

## Now: the UI-first phase

The whole panel is being built as **pure UI first**:

- **shadcn components + presentational React components.** Add shadcn primitives
  via the CLI/MCP; build domain components on top of them. Keep components
  presentational — props in, markup out.
- **Static placeholder data.** Pages render from local stub data, not a backend.
  There is **no `src/server`, no server functions, no database, and no auth yet**.
- **Don't reach for a backend that isn't there.** If a page needs data, define a
  typed stub and feed it in. We wire real data later, behind the same component
  props.
- **Styling:** Tailwind v4 (`@import "tailwindcss"` in `src/styles/global.css`),
  Biome-sorted classes. Design language is shadcn defaults for now — see
  `design.md`.

When in doubt, model a page on its eventual job (a fleet view, a server detail,
a template editor) but implement only the view with fake data.

## Later: the server layer (target shape)

When the data layer lands, server code lives under **`src/server/**`, which is
server-only** — it must never reach the client bundle. That means `node:crypto`,
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

The panel's server layer will make authenticated HTTPS calls to each box's
`cookied` (node key + cert pin + the shared contract — see `architecture.md`).
**How that's structured inside the panel is an open question** — whether it's one
client abstraction, where the fake-vs-real split lives, etc. Don't commit to a
particular shape yet. Whatever it is, panel business logic should depend on a
typed boundary, not scatter raw daemon HTTP calls through the codebase.

## Data fetching (target pattern)

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
  with one child route per tab (e.g. account → general / SSH keys / activity;
  node detail → overview / networking / storage / settings).
- Trailing-underscore segments escape layout nesting while keeping the URL (a
  detail route opts out of its list's layout). `$param` = dynamic segment.

## Auth stack (target)

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
