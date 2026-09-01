# Design Token Contract - For CLAUDE DESIGN

## What this file is

This is the single source of truth for every CSS custom property used across
all apps built on this scaffold. Token **names** are defined here permanently.
Token **values** are overridden per app in `apps/web/src/styles.css`.

---

## Rules

1. **Never use hex values or raw colour strings in component code.**
   Always reference a token: `var(--primary)`, `text-primary`, `bg-background`.

2. **Never invent a new token name inside a component.**
   If a concept is not covered by the tokens below, add it here first, then use it.

3. **Never rename an existing token.**
   Names are the stable contract. Values change; names do not.

4. **App-specific tokens that have no universal meaning use a namespaced prefix.**
   Format: `--[appname]-[concept]`. Example: `--isotope-ai-bg`.
   These go in the app's `styles.css` below the scaffold token block.
   They are never added to this file.

5. **All tokens must exist in both `:root` (light) and `.dark`.**
   No token is light-only or dark-only.

6. **When building a new app, follow this checklist:**
   - Copy `styles.css` from the scaffold
   - Override values in the two blocks below (`:root` and `.dark`)
   - Do not add or remove token names from those blocks
   - Add any app-specific tokens in a clearly separated third block

---

## Token reference

### 1. shadcn tokens

These are owned by shadcn/ui. Names and semantics are fixed by the library.
Override values only.

```
TOKEN                     SEMANTIC ROLE
─────────────────────────────────────────────────────────────────────
--background              Page / app background
--foreground              Primary text colour

--card                    Panel, card, modal surface (sits above background)
--card-foreground         Text on card

--popover                 Dropdown, tooltip, context menu surface
--popover-foreground      Text on popover

--primary                 Primary action colour — buttons, active nav, focus rings
--primary-foreground      Text/icon on primary background

--secondary               Secondary surface — hovered rows, secondary inputs, fills
--secondary-foreground    Text on secondary

--muted                   Neutral background — empty states, disabled fills, neutral badges
--muted-foreground        Muted text — timestamps, placeholders, captions

--accent                  Ghost hover target background (usually same value as --secondary)
--accent-foreground       Text on accent hover

--destructive             Danger / error actions and states — delete, fail, block
                          Note: do not use for warnings. Use --warning for caution states.

--border                  All borders and dividers
--input                   Input field border (often same value as --border)
--ring                    Focus ring colour (usually same value as --primary)

--radius                  Base border radius. All radius scales derive from this.
                          --radius-sm = 0.6×, --radius-md = 0.8×, --radius-lg = 1×,
                          --radius-xl = 1.4×, --radius-2xl = 1.8×

--sidebar                 Sidebar panel background
--sidebar-foreground      Sidebar text
--sidebar-primary         Active nav item / sidebar primary action
--sidebar-primary-foreground
--sidebar-accent          Sidebar hover state
--sidebar-accent-foreground
--sidebar-border          Sidebar internal border
--sidebar-ring            Sidebar focus ring

--chart-1                 Primary data series (usually matches brand primary)
--chart-2                 Secondary data series
--chart-3                 Tertiary data series
--chart-4                 Quaternary data series
--chart-5                 Quinary data series
```

---

### 2. Extended semantic tokens

These are gaps that shadcn does not cover but every serious product app needs.
Scaffold defines the names. Apps override the values.

```
TOKEN                     SEMANTIC ROLE
─────────────────────────────────────────────────────────────────────

── Text hierarchy ────────────────────────────────────────────────────

--text-secondary          Mid-tone text — descriptions, subtitles, supporting copy.
                          Sits between --foreground (primary) and --muted-foreground
                          (timestamps). Use for body copy that is not the main heading.

── Surface layering ──────────────────────────────────────────────────

--surface-raised          Elevated surface — hovered rows, active list items, pressed
                          states, chip/tag fills. One step above --background,
                          one step below --card.

── Feedback: success ─────────────────────────────────────────────────

--success                 Success foreground — icons, borders, solid badges
--success-bg              Success background — alert banners, badge fills
--success-text            Success text — label text inside success badges/alerts

Use for: saved confirmations, completed tasks, positive outcomes,
verified states, paid invoices, accepted records.

── Feedback: warning ─────────────────────────────────────────────────

--warning                 Warning foreground
--warning-bg              Warning background
--warning-text            Warning text

Use for: caution states, expiring items, pending approvals,
conditional fits, stalled actions, low confidence signals.
Never use for errors — use --destructive for errors.

── Feedback: info / pipeline ─────────────────────────────────────────

--pipeline                Info / in-progress foreground
--pipeline-bg             Info / in-progress background
--pipeline-text           Info / in-progress text

Use for: active states, in-progress tasks, running jobs,
pipeline stages, pending transactions, shipping states.
This is a 4th semantic colour distinct from success/warning/danger.
Named --pipeline (not --info) because "in-progress" is the dominant
use case across productivity, ops, and tracking apps.

── Feedback: danger extended ─────────────────────────────────────────

--danger                  Alias for --destructive. Use this name in components
                          for semantic clarity (danger button, danger badge).
                          Value must always equal var(--destructive).
--danger-bg               Danger background — danger alert fills, hover on danger buttons
--danger-text             Danger text — label text inside danger badges/alerts

── AI-generated content marker ───────────────────────────────────────

--ai                      AI content foreground — icons, borders on AI output boxes
--ai-bg                   AI content background
--ai-border               AI content left-border accent (used on callout boxes)
--ai-text                 AI content text colour

Use for: AI-generated drafts, research summaries, AI activity feeds,
machine-produced output that the user needs to review before acting.
Amber is the conventional colour for this in Isotope. Future apps may
use a different colour — the token name stays the same.

Reserve this colour exclusively for AI-generated content.
Do not use it for warnings or highlights unrelated to AI output.
```

---

## How to start a new app on this scaffold

### Step 1 — Copy styles.css

Copy `apps/web/src/styles.css` from the scaffold into your new app's
`apps/web/src/` directory. Do not rename it.

### Step 2 — Override the palette

In `styles.css`, change only the **values** inside `:root {}` and `.dark {}`.
Do not add or remove variable names from these two blocks.

Minimum changes per app:

- `--primary` + `--primary-foreground` (your brand colour)
- `--background`, `--foreground` (surface personality — warm, cool, neutral)
- `--card`, `--secondary`, `--muted`, `--border`, `--sidebar` (cascade from background)
- `--radius` (sharp / rounded personality)
- `--chart-1` through `--chart-5` (your data palette)
- All extended tokens: `--success-*`, `--warning-*`, `--pipeline-*`,
  `--danger-bg`, `--danger-text`, `--ai-*`
- Font: change the `@import` and `--font-sans` value

### Step 3 — Add app-specific tokens (if needed)

Below the scaffold token block, add a clearly separated section:

```css
/* ── [AppName]-specific tokens ──────────────────────────────── */
/* Tokens with no universal equivalent. Prefixed to avoid collision. */
--isotope-xyz: ...;
```

### Step 4 — Start the Claude Design session

Paste this system prompt before describing any screen:

---

```
You are designing for a scaffold that uses shadcn/ui + Tailwind v4.
All CSS custom properties must use exactly these token names — no others.

shadcn tokens (always available):
--background, --foreground,
--card, --card-foreground,
--popover, --popover-foreground,
--primary, --primary-foreground,
--secondary, --secondary-foreground,
--muted, --muted-foreground,
--accent, --accent-foreground,
--destructive,
--border, --input, --ring,
--radius,
--sidebar, --sidebar-foreground, --sidebar-primary,
--sidebar-primary-foreground, --sidebar-accent,
--sidebar-accent-foreground, --sidebar-border, --sidebar-ring,
--chart-1, --chart-2, --chart-3, --chart-4, --chart-5

Extended semantic tokens (scaffold adds):
--text-secondary,
--surface-raised,
--success, --success-bg, --success-text,
--warning, --warning-bg, --warning-text,
--pipeline, --pipeline-bg, --pipeline-text,
--danger, --danger-bg, --danger-text,
--ai, --ai-bg, --ai-border, --ai-text

Rules:
- Never use hex values directly in components.
- Never invent new token names. If a concept is missing, say so and I will add it.
- All spacing uses Tailwind utility classes (p-4, gap-2, etc.).
- All border radius uses var(--radius) or Tailwind radius classes derived from it.
- For app-specific tokens with no universal equivalent, use --[appname]-[concept].
```

---

## Token count summary

| Group                | Tokens | Stable?                |
| -------------------- | ------ | ---------------------- |
| shadcn core          | 28     | ✅ Fixed by shadcn     |
| shadcn sidebar       | 8      | ✅ Fixed by shadcn     |
| shadcn charts        | 5      | ✅ Fixed by shadcn     |
| Extended scaffold    | 14     | ✅ Fixed by this file  |
| App-specific         | varies | ⚠️ Per app, namespaced |
| **Total (scaffold)** | **55** |                        |
