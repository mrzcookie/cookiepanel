# Design language

> **Status: intent only.** Nothing here is binding. The current phase uses
> **shadcn defaults**, and the **`impeccable` skill owns the real design language
> later**. The "prior direction" below is recorded for reference, to adopt,
> adapt, or discard when the UI matures — not a spec to implement now.

## Now

- Build with **shadcn defaults** — basic, consistent, easy to restyle later.
  Don't hand-craft a bespoke theme during the UI-first phase; we want pages and
  flows in place first, on a neutral skin.
- Keep components presentational and the styling shallow (Tailwind utilities,
  shadcn primitives) so a later design pass can re-skin without rewrites.
- When a real design language is wanted, drive it through the **`impeccable`**
  skill rather than inventing one ad hoc.

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
