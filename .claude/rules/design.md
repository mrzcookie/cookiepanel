# Design language

> **Status: live.** The design language is now **"The Console"** (dark default) /
> **"Daylight"** — implemented and documented in **`DESIGN.md`** + **`PRODUCT.md`**
> at the repo root (the `impeccable` skill's context files). Tokens live in
> `apps/panel/src/styles/global.css`. `DESIGN.md` is the spec; this file is the
> short orientation.

## Now

- The theme is applied: azure-on-ink, mono-as-chassis, `[ LABEL ]` bracket status
  chips, `// section` eyebrows, hairlines not shadows, sharp `0.25rem` corners.
  Read **`DESIGN.md`** before touching UI.
- Use the **semantic tokens** (`text-ok`/`text-warn`/`bg-warn-wash`/…), never
  hardcoded palette colors. Status is shown with `StatusIndicator` bracket chips,
  not dot-pills.
- Drive further design work through the **`impeccable`** skill; keep components
  presentational so re-skins stay cheap.
