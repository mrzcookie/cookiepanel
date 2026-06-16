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
  server/      server-only code (DB, auth, daemon client). Lands in a later phase;
               does not exist yet.
  styles/      global.css (Tailwind v4 + tokens).
```

Imports always use the `@/` alias (maps to `src/`), always deep paths
(`@/components/<folder>/<file>`, `@/lib/domain/<entity>`). No barrels — see below.

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
nodes/  servers/  networks/  templates/  schedules/  auth/
            domain folders, mirroring the route nouns. Components used by one domain.
            (servers/database/ holds the SQL/Redis/Mongo browsers.)
```

**Where does a new component go?** Used by one domain → that domain folder. Used
across 3+ domains / generic → `shared/`. Part of the app frame (rendered once,
knows about routing/session/theme) → `layout/`. A shadcn primitive → `ui/`.

## lib/

```
domain/   client-safe domain TYPES + pure helpers, by entity (nodes, servers,
          networks, templates, deploy, files, schedules, *-browser, ...). No state.
          This is the durable layer: it survives the data-layer rewrite and is what
          src/server will import. NEVER put mutable state or stub data here.
stores/   the UI-first stub stores (one per entity). Mutable useSyncExternalStore
          state built on the shared createStore factory. THROWN AWAY wholesale when
          the real data layer lands — treat them as scaffolding.
stubs/    seed DATA only (index.ts: NODES, SERVERS, TEMPLATES, ...). The stores read
          from here. No type declarations (those live in domain/).
store.ts  createStore<T>(seed) — the tiny factory every store uses (get/set/use, plus
          a useWith selector hook for subscribing to a slice).
utils.ts status.ts format.ts slug.ts list-view.ts nav.ts
          cross-cutting pure leaf helpers — kept flat at the root (high fan-out;
          no domain coupling). utils.ts (cn) is the shadcn convention; don't move it.
```

### The server import boundary (honor it now)

When `src/server` lands, it may import `@/lib/domain/*` and the root pure helpers,
but **must never** import `@/lib/stores/*` or `@/lib/stubs/*` (those are client-only
scaffolding that would drag stub data into the server bundle). Keeping domain types
out of `stubs/` is what makes this boundary enforceable.

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
  account/ networks/ templates_/   dynamic segment with its own children.
admin/                           the cross-org admin surface, same shape.
  route.tsx  index.tsx  nodes/ orgs/ users/ templates/ ...
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
  `_app/templates_/$templateId_/edit.tsx`). See `.claude/rules/panel.md` for the
  URL conventions (pathless `_app`, tabbed sub-pages, `$param`).

## Conventions

- **kebab-case** filenames everywhere; stores keep the `-store.ts` suffix.
- **No barrel `index.ts` files.** Deep imports keep TanStack Start's per-route
  code-splitting tight (a barrel pulls a whole folder into every route that touches
  one symbol). The one exception is `lib/stubs/index.ts` — the folder entrypoint, so
  callers still write `@/lib/stubs`.
- **Don't scatter manual memoization.** The React Compiler is on
  (`vite.config.ts`); let it memoize. Reach for a store selector (`useWith`) before
  `useMemo`/`useCallback`.

## Tooling

- `pnpm check` — Biome (lint + format + organize imports). `pnpm typecheck` — tsc
  (strict, incl. `noUncheckedIndexedAccess`, `verbatimModuleSyntax`).
- `pnpm knip` — unused files / exports / deps gate (config: `knip.json`).
- `pnpm analyze` — `rollup-plugin-visualizer` treemap to `.analyze/bundle.html`;
  confirms Monaco / xterm / recharts stay in their own chunks, out of the entry.
