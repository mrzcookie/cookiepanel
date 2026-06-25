# @cookiepanel/contract

The **single source of truth** for the panel↔daemon HTTPS API. One OpenAPI spec
(`openapi.yaml`) is code-generated into typed bindings for both sides, and each
side asserts its hand-written wire types **conform** to the generated ones — so
the panel (TypeScript) and the daemon (Go) can't drift apart.

## Files

- **`openapi.yaml`** — the spec. The one thing you edit to change the API.
- **`gen/contract.ts`** — generated TypeScript types (committed). The panel imports
  these as `@cookiepanel/contract`.
- **`../../apps/daemon/internal/contract/contract.gen.go`** — generated Go types
  (committed). The daemon imports them as `internal/contract`.

Generated files are **committed** (not gitignored) so a fresh checkout builds and
type-checks without a generate step, and the conformance checks run in the normal
`tsc` / `go test`. CI regenerates and fails if the committed output drifts from the
spec.

## Workflow — changing the API

1. Edit `openapi.yaml`.
2. `pnpm --filter @cookiepanel/contract generate` (runs both codegens).
3. Update the hand-written types on whichever side changed
   (`apps/panel/src/server/nodes/daemon-client.ts` /
   the daemon's domain structs) until conformance passes.
4. Commit the spec **and** the regenerated `gen/` output.

## Conformance (the anti-drift guarantee)

- **Panel:** `apps/panel/src/server/contract/conformance.ts` — `Expect<Equal<…>>`
  type assertions; a mismatch fails `pnpm typecheck`.
- **Daemon:** `apps/daemon/internal/contract/conformance_test.go` — JSON round-trip
  assertions; a mismatch fails `go test`.

## Codegen

- TS: [`openapi-typescript`](https://openapi-ts.dev) → `gen/contract.ts`.
- Go: [`oapi-codegen`](https://github.com/oapi-codegen/oapi-codegen) (models only)
  → the daemon module. Config in `oapi-codegen.yaml`.

The console WebSocket (`GET /api/servers/{id}/ws`) is intentionally **not** in the
spec — it isn't request/response shaped.
