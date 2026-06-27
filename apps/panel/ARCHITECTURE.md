# Panel architecture — how the code is organized

How `apps/panel`'s source is laid out, and where new code goes. Pairs with
`.claude/rules/panel.md` (the phase rules + intended data layer) and `DESIGN.md`
(the design system). The top-level split is fixed by `panel.md`; this file
documents the organization **within** it.

## Top-level layers (fixed)

```
src/
  routes/      file-based routing (TanStack Start). Paths ARE the URLs — never
               move/rename. routeTree.gen.ts is generated; don't hand-edit it.
               Hybrid layout: the two big surfaces (_app/, admin/) use
               directory-based routing (a route.tsx layout per folder, nested
               subfolders); the top-level auth/utility pages (__root, home,
               login, onboarding) stay flat. See "routes/" below.
  components/  UI (presentational). See below.
  lib/         client-safe domain types, pure helpers, and the stub stores. See below.
  server/      server-only code. env.ts (t3-env) validates env; db/ has the
               Drizzle client + schema + migrations; auth/ is Better Auth;
               email.ts (Resend) and redis.ts (Upstash) are shared. Daemon later.
  styles/      global.css (Tailwind v4 + tokens).
```

Imports always use the `@/` alias (maps to `src/`), always deep paths
(`@/components/<folder>/<file>`, `@/lib/domain/<entity>`). No barrels — see below.

Two `src/` root files wire the framework: `router.tsx` (router + TanStack Query
SSR) and `start.ts` (the Start instance — its request middleware mounts the
Better Auth handler at `/api/auth/*`, since this Start version has no
server-route file API).

## components/

```
ui/         shadcn primitives (vendored). Re-add via the shadcn CLI; keep families
            whole. The only place that may import radix-ui / cva directly.
layout/     the app chrome — singletons rendered once: app-shell, app-sidebar,
            account-menu, org-switcher, theme-switcher, error-screen.
shared/     cross-cutting presentational parts a route composes (used by 3+ areas):
            page-header, status-indicator, entity-card, empty-state, detail-list,
            route-tabs, activity-list, image-upload-field, code-editor.
            shared/list/  the list-page composite (list-page + toolbar + view-toggle).
wizard/     the wizard kit (wizard-frame, wizard-stepper, terminal-block) shared by
            the connect-node / create-server / schedule wizards.
nodes/  servers/  networks/  eggs/  schedules/  auth/
            domain folders, mirroring the route nouns. Components used by one domain.
            (servers/database/ holds the SQL/Redis/Mongo browsers.)
```

**Where does a new component go?** Used by one domain → that domain folder. Used
across 3+ domains / generic → `shared/`. Part of the app frame (rendered once,
knows about routing/session/theme) → `layout/`. A shadcn primitive → `ui/`.

## lib/

```
domain/   client-safe domain TYPES + pure helpers, by entity (nodes, servers,
          networks, eggs, deploy, files, schedules, backups, sftp, billing,
          admin, *-browser, ...). No state. This is the durable layer: the typed
          boundary src/server and the UI share. NEVER put mutable state or stub
          data here.
stores/   UI-first stub stores — mutable useSyncExternalStore state on the shared
          createStore factory, used by features whose backend doesn't exist yet.
          Most have been thrown away as the real data layer replaced them; what
          remains is presentational/placeholder scaffolding (e.g. notifications,
          the live activity feed). Treat any new one as temporary.
stubs/    seed DATA only — no type declarations (those live in domain/). index.ts
          holds the EGGS seed (also fed to db:seed), imported as @/lib/stubs;
          surface-specific seed files sit alongside it, e.g. admin.ts (the platform
          /admin cross-org dataset), deep-imported as @/lib/stubs/admin.
store.ts  createStore<T>(seed) — the tiny factory every store uses (get/set/use, plus
          a useWith selector hook for subscribing to a slice).
utils.ts status.ts format.ts slug.ts list-view.ts nav.ts admin-nav.ts
          eggs-scope.ts
          cross-cutting pure leaf helpers — kept flat at the root (high fan-out; no
          domain coupling). nav.ts/admin-nav.ts are the app vs admin nav config;
          eggs-scope.ts is a UI-surface descriptor (org vs admin eggs).
          utils.ts (cn) is the shadcn convention; don't move it.
```

### Server feature folders

Each feature under `src/server/<feature>/` is `index.ts` (the server functions —
thin `auth + validate + delegate` shims) plus `repository.ts` (the only layer
that touches the DB; see `panel.md`). The folder name encodes the **caller
scope**, matching the guard every function in it uses:

- `user/` — the caller's own user, `requireSession` (self-service).
- `organization/`, `nodes/`, … — the caller's active org, `requireOrg` (the
  default for domain entities; don't nest them under a shared `org/` parent —
  org-scope is the default, so the prefix carries no information).
- `admin/<entity>/` — cross-tenant platform admin, `requirePlatformAdmin`. **Everything
  under `admin/` gates on `requirePlatformAdmin`** — that's the checkable invariant.
  Mirrors `routes/admin/` and `components/admin/`.

Names are the domain noun, and singular vs. plural marks the scope: the
**singular** self-service folder is the caller's own (`user/`, `organization/`),
the **plural** admin folder is the whole collection (`admin/users/`,
`admin/orgs/`) — same noun, two scopes, with a different guard, repository, and
attack surface each. The `admin/` prefix is what disambiguates them; never lean
on a one-letter `user`/`users` difference to carry that split.

`activity/` is the cross-scope audit log and the one shared-read exception:
`record.ts` (the best-effort write helper — imports only the repository, so it
stays out of the auth import cycle), `repository.ts`, and `index.ts` (the org /
self / admin read feeds). The shared image-upload orchestration —
put → persist → strand-cleanup → drop-the-previous — lives once in
`storage/managed-image.ts` (`replaceManagedImage`), behind which each avatar/logo
call site passes only a one-line `persist` callback.

### The server import boundary

`src/server` may import `@/lib/domain/*` and the root pure helpers, but **must
never** import `@/lib/stores/*` or `@/lib/stubs/*` (those are client-only
scaffolding that would drag stub data into the server bundle). Keeping domain types
out of `stubs/` is what makes this boundary enforceable.

### Database & migrations

`src/server/db/schema/` is the Drizzle schema — one file per concern, re-exported
from `index.ts` (what the db client and drizzle-kit read). `auth.ts` is generated
by Better Auth; regenerate with `pnpm --filter @raptor/panel auth:generate`
after changing the auth config.

**Name every migration.** Generate with an explicit `--name`:

```
pnpm --filter @raptor/panel exec drizzle-kit generate --name <change>
```

That writes `src/server/db/migrations/NNNN_<change>.sql` (e.g. `0000_init_auth.sql`);
never ship the random default name. Apply with `db:migrate`. The Postgres + Redis
the panel needs in dev live in `infra/compose.yaml` (`pnpm dev:up`).

### Object storage

`src/server/storage/` is the server-only object-storage module: it wraps
S3-compatible storage (`@aws-sdk/client-s3`, so it works with MinIO / Cloudflare
R2 / AWS S3) for egg icons and uploads. It's **optional** — gated by
`isStorageConfigured()`, so the panel runs without it and features that need it
degrade gracefully. For dev, a MinIO server (plus a provisioned `raptor`
bucket) runs in `infra/compose.yaml` (`pnpm dev:up`); the matching `S3_*` env
defaults live in `.env.example`.

## routes/

File-based routing (TanStack Start); `routeTree.gen.ts` is generated on dev/build
from the file tree — don't hand-edit it. The tree is **hybrid**:

```
__root.tsx                       the root route.
home.tsx login.tsx onboarding.tsx
                                 top-level auth/utility pages — kept FLAT (a
                                 handful of leaves; no shell, outside _app).
_app/                            the signed-in app surface (pathless layout —
  route.tsx                        no URL segment). route.tsx is the folder's
  index.tsx                        layout/guard; index.tsx is its index route.
  nodes/  servers/  settings/      one subfolder per section; $param/ for a
  account/ networks/ eggs_/   dynamic segment with its own children.
admin/                           the cross-org admin surface, same shape.
  route.tsx  index.tsx  nodes/ orgs/ users/ eggs/ ...
```

Rules that matter:

- **Directory style for the two big surfaces** (`_app/`, `admin/`); flat for the
  top-level pages. Within a folder, the **layout** route is `route.tsx`, the
  index is `index.tsx`, and every other leaf is a plain `<name>.tsx`.
- **The folder path IS the URL** — `_app/servers/$serverId/files.tsx` →
  `/servers/$serverId/files`. The `createFileRoute("/...")` id matches the path,
  so moving a file between flat/directory style is purely cosmetic (same URL,
  same id) — but never change the *path*, it's the public URL.
- **Trailing-underscore escapes nesting** while keeping the URL: a `$id_/` folder
  or `name_` segment opts a detail/edit route out of its list's layout (e.g.
  `_app/eggs_/$eggId_/edit.tsx`). See `.claude/rules/panel.md` for the
  URL conventions (pathless `_app`, tabbed sub-pages, `$param`).

## Conventions

- **kebab-case** filenames everywhere; stores keep the `-store.ts` suffix.
- **No barrel `index.ts` files.** Deep imports keep TanStack Start's per-route
  code-splitting tight (a barrel pulls a whole folder into every route that touches
  one symbol). The one exception is `lib/stubs/index.ts` — the folder entrypoint, so
  callers still write `@/lib/stubs`; its sibling seed files (e.g. `stubs/admin.ts`)
  are deep-imported by path like everything else.
- **Don't scatter manual memoization.** The React Compiler is on
  (`vite.config.ts`); let it memoize. Reach for a store selector (`useWith`) before
  `useMemo`/`useCallback`.

## Tooling

- `pnpm check` — Biome (lint + format + organize imports). `pnpm typecheck` — tsc
  (strict, incl. `noUncheckedIndexedAccess`, `verbatimModuleSyntax`).
- `pnpm knip` — unused files / exports / deps gate (config: `knip.json`).
- `pnpm analyze` — `rollup-plugin-visualizer` treemap to `.analyze/bundle.html`;
  confirms Monaco / xterm / recharts stay in their own chunks, out of the entry.
