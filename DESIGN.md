# DESIGN.md — Raptor "The Console"

The panel's design system. **"The Console"** (dark) is the default; **"Daylight"**
(light) is a faithful inversion. Source of truth for tokens is
`apps/panel/src/styles/global.css`. Register: **product**. Pairs with `PRODUCT.md`.

## North star

An instrument panel for people who don't speak Linux. A calm, precise control
surface, not a toy and not developer-terminal cosplay. The motifs (mono readouts,
bracket chips, hairline rules) carry *meaning* (state, identity, data), never
decoration. When in doubt: quieter and sharper.

Dark is the default (`__root.tsx` `ThemeProvider defaultTheme="dark"`, system kept
opt-in) because the product reads as a steady always-on console, and the single
red accent has to be the only thing that lights up.

## Color

OKLCH, with a **warm undertone (hue ~25)** on every neutral so the grays tie to
the red brand. Never `#000`/`#fff`. **Strategy: Restrained** — tinted ink
neutrals plus ONE red accent (`--primary`), with a small semantic set used only
for state. The accent is for primary actions, active nav, and live indicators;
never for fill or decoration.

Key tokens (Console `.dark` / Daylight `:root`):

| Role | Console | Daylight |
| --- | --- | --- |
| `--background` | `oklch(0.145 0.012 25)` | `oklch(0.975 0.004 25)` |
| `--foreground` | `oklch(0.96 0.005 25)` | `oklch(0.18 0.018 25)` |
| `--card` | `oklch(0.185 0.013 25)` | `oklch(0.955 0.006 25)` |
| `--primary` (red) | `oklch(0.63 0.21 25)` | `oklch(0.545 0.215 25)` |
| `--muted-foreground` | `oklch(0.64 0.011 25)` | `oklch(0.46 0.013 25)` |
| `--border` | `oklch(0.3 0.012 25)` | `oklch(0.88 0.01 25)` |

**Semantic vocabulary** (mapped in `@theme` → `text-ok`, `bg-warn-wash`, etc.):
`--ok` green (150), `--warn` amber (75-80), `--destructive` red (~10), `--brand`
= `--primary` (red); washes `--ok-wash` / `--warn-wash` / `--brand-wash` /
`--danger-wash` for state banners; `--rule-bright` for a brighter hairline. Use
these, never hardcoded `text-emerald-500` / `bg-amber-500`. The fixed console
surface is `--color-terminal` (`#0a0c11`), shared with the xterm theme.

## Typography

- `--font-sans` / `--font-heading`: **Hanken Grotesk** (variable). Body, headings,
  nav, descriptions.
- `--font-mono`: **JetBrains Mono** (variable). **Mono is the chassis**, not just
  for code: buttons, form labels, table headers, status chips, section eyebrows,
  badges, and all data (IDs, ports, IPs, versions, counts) are mono. Numerics get
  `tabular-nums`.
- Fixed-rem scale. Page titles `font-bold text-2xl tracking-tight`; card titles
  `font-medium text-base`; body `text-sm`; helper/meta `text-xs`.
- Eyebrows: `font-mono text-[0.7rem] uppercase tracking-[0.18em]`. Labels / table
  heads: mono `uppercase` + `tracking-wide` / `tracking-wider`.

## Shape & elevation

- **Sharp corners.** `--radius: 0.25rem`, multiplier scale `--radius-sm`..`-4xl`
  = 0.6/0.85/1/1.4/1.8/2.2/2.6×. `rounded-lg`/`rounded-xl` are the workhorses;
  nothing pill-soft (badges are `rounded-sm`).
- **Hairlines, not shadows.** Surfaces are framed by `ring-1 ring-foreground/10`
  or `border`, never drop-shadow as elevation. Dividers are `h-px bg-border` /
  `divide-y`. The one permitted "light" effect is the metal-bezel inset on primary
  buttons (`[data-slot=button][data-variant=default]` in global.css).
- Thin tinted scrollbars (`--border` thumb, transparent track); `::selection` is
  the primary at 30%.

## Motion

- 150-250ms, ease-out only. House curve `--ease-out-quint:
  cubic-bezier(0.2,0.8,0.2,1)`. No bounce, no page-load choreography.
- The one ambient motion: `live-pulse` (alpha 1 → 0.55, 1.4s) on live status
  readouts, with `motion-reduce:animate-none`. No glow, ever.

## Signature motifs

1. **Bracket status chips** `[ LABEL ]` — `components/status-indicator.tsx`, mono +
   uppercase + `tabular-nums`, colored by a `StatusTone` from `lib/status.ts`
   (`online|pending|error|muted` → `text-ok|text-warn|text-destructive|
   text-muted-foreground`), optional `live` pulse. THE way state is shown across
   nodes, servers, drives, eggs. No dot-pills.
2. **`// section` eyebrows** — `font-mono text-[0.7rem] uppercase
   tracking-[0.18em]`, rendered as `// label`. A categorical kicker, never a
   restatement of the title. On the `page-header.tsx` `eyebrow` prop (list pages:
   `// fleet`, `// infrastructure`, `// networking`, `// library`) and the sidebar
   nav group (`// manage`).
3. **Status readout** — `[ N ONLINE ] / M NODES` in mono `tabular-nums`, live
   pulse on the count, in the sidebar footer (`app-sidebar.tsx` `NodeReadout`).
4. **`.terminal` surface** — deep cool-ink console block (dark in both themes) for
   logs / install commands; the live server console is xterm.js on the same ink.

## Components

Every interactive component ships all states (default/hover/focus/active/
disabled/loading/error). Vocabulary stays identical screen to screen.

- **Buttons** (`ui/button.tsx`): mono, uppercase, `tracking-wider`, `rounded-lg`,
  `text-xs`. Variants default(red + bezel)/outline/secondary/ghost/destructive
  (tinted, not solid red)/link. `active:translate-y-px`.
- **Badges** (`ui/badge.tsx`): sharp `rounded-sm`, mono uppercase `text-[0.7rem]`.
  For ownership/flags (`OFFICIAL`, `UPDATE`, `LOCKED`), not status (use chips).
- **Cards** (`ui/card.tsx`): `rounded-xl bg-card ring-1`. For info panels and
  forms; footers use `border-t bg-muted/50`. **Never nest cards.**
- **Tables** (`ui/table.tsx`): heads mono uppercase `tracking-wider` muted; cells
  roomy (`px-3 py-2.5`); rows hairline-divided; data mono `tabular-nums`. Data
  tables live in bordered/ringed sections, not stacked cards.
- **Inputs / labels** (`ui/input.tsx`, `ui/label.tsx`): inputs `rounded-lg border`
  bg-transparent (`dark:bg-input/30`); labels mono uppercase `tracking-wide`.
- **Empty states** (`empty-state.tsx`): dashed-border panel, a *bare* muted glyph
  (no filled bubble), title + description.
- **Sidebar** (`app-sidebar.tsx`, shadcn collapsible-to-icon): red Raptor brand
  + wordmark, the `// manage` nav, the node status readout in the footer,
  `SidebarRail` for the edge handle. The collapse trigger lives in the top bar.

## Bans (on top of impeccable's shared bans)

- No glow / neon. No drop-shadow as elevation (hairlines only). No big-number +
  gradient hero. No dot-pill statuses (bracket chips). No pill-soft badges. No
  hardcoded palette colors where a semantic token exists. No soft filled icon
  bubbles. Mono is structural, never "techy" decoration.

## Not yet done (deferred polish)

- Eyebrows are wired on the four list pages only; detail headers rely on the
  back-link for context (intentional, to avoid redundant kickers).
- The semantic washes (`*-wash`) are defined and used on the egg install-risk
  banner; extend them to other state banners as they appear.
