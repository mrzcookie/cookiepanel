# PRODUCT.md — RaptorPanel

Context for design work. Pairs with `DESIGN.md` (the design system) and the
deep-dive rules in `.claude/rules/`. Read both before any UI task.

**Register: product.** Design serves the task. This is an operational control
surface, not a marketing artifact; restraint and legibility beat expression.

## What it is

RaptorPanel is a **hosted, multi-tenant control panel for running Docker game
servers and apps on your own Linux boxes**. You connect a machine you own, and
RaptorPanel turns it into a managed fleet: spin up a Minecraft (or any) server
from a **Egg**, watch live CPU/memory, and manage files, networks, ports,
firewall, schedules, and backups, without touching a terminal.

Two programs, one product: the hosted **Panel** (this app) owns identity, orgs,
eggs, and desired state; the **daemon** (`wings`) runs as root on each box
and does the real work. The panel drives boxes over authenticated HTTPS; the
daemon heartbeats back.

## Who it's for

The owner is **not a Linux admin**. They think in "servers" and "eggs," not
images and containers, and should never have to learn the difference. A typical
moment: a small-community owner glancing at whether their game server is up, on a
laptop in a normal room, wanting confidence in a beat. They are capable but
time-poor and jargon-averse.

## North star

**Easy + secure.** Hide the jargon, be secure by default. The interface should
feel like a calm, precise instrument panel: a steady, always-on console you trust
at a glance. Every readout (a status, a port, a usage bar) should answer a
question without a second look.

## Voice & tone

- Plain, direct, confident. Short labels; sentences only when they teach.
- Name things the way the owner thinks (server, node, egg, port), never the
  way Docker does (container, image, bind mount).
- Errors are honest and actionable, never blaming. Destructive actions say what
  is lost and ask once.
- No em dashes in UI copy. No marketing adjectives in product chrome.

## Anti-references (what to avoid)

- **Developer-terminal cosplay.** The mono + ink aesthetic carries *meaning*
  (state, identity, data), it is not "hacker" decoration. No neon, no glow, no
  Matrix.
- **Toy dashboards.** No big-number hero metrics, no confetti, no rounded-pill
  everything.
- **Generic SaaS-cream.** Not the soft-shadow, lavender-gradient, friendly-blob
  egg. This is an instrument, not a brochure.
- **Over-confirmation.** Don't modal every action. Inline and progressive first;
  confirm only what's destructive or irreversible.

## Strategic principles

1. **Color carries state, never decoration.** One azure accent is the only thing
   that lights up; green/amber/red appear only to signal state.
2. **Hairlines over shadows.** Elevation and grouping come from rules and tint,
   not drop-shadows.
3. **Mono is structure.** Data, labels, and status read as console readouts.
4. **Secure by default is visible.** Guard rails (protected ports, system
   drives, install-script acknowledgements) are shown, not hidden.
5. **Eggs over images.** Users pick Eggs; raw image strings never
   surface in the UI.
