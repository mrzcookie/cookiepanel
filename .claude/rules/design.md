# Design language

> **Status: live.** The design language is now **"The Console"** (dark default) /
> **"Daylight"** — implemented and documented in **`DESIGN.md`** + **`PRODUCT.md`**
> at the repo root (the `impeccable` skill's context files). Tokens live in
> `apps/panel/src/styles/global.css`. `DESIGN.md` is the spec; this file is the
> short orientation. The "prior direction" below is the original reference it was
> built from.

## Now

- The theme is applied: azure-on-ink, mono-as-chassis, `[ LABEL ]` bracket status
  chips, `// section` eyebrows, hairlines not shadows, sharp `0.25rem` corners.
  Read **`DESIGN.md`** before touching UI.
- Use the **semantic tokens** (`text-ok`/`text-warn`/`bg-warn-wash`/…), never
  hardcoded palette colors. Status is shown with `StatusIndicator` bracket chips,
  not dot-pills.
- Drive further design work through the **`impeccable`** skill; keep components
  presentational so re-skins stay cheap.

## Prior direction (non-binding reference)

The previous rewrite had a deliberate design system worth knowing about, in case
we revive parts of it:

- **"The Console" (dark, default) / "Daylight" (light).** The mood is
  **"azure-on-ink"** — a calm, precise *instrument panel* for non-technical
  users, explicitly *not* "developer terminal cosplay." One restrained accent
  (azure) that's "the only thing that lights up"; color carries **state**, never
  decoration.
- **Sharp, not soft** — small radius, **hairlines instead of drop shadows** for
  elevation and grouping.
- **Mono as structure** — a monospace face (not just for code) for labels, data,
  IDs, ports, status; a humanist sans for prose.
- **Signature motifs:** `[ LABEL ]` bracket status chips, `// section` eyebrows,
  hairline divider readouts.

The full prior spec (exact OKLCH tokens, fonts, component patterns) lives in
`../cookiepanel-oldv2/DESIGN.md` and its `global.css` if ever needed. Don't port
it wholesale without an explicit decision — it's one option, not the plan.
