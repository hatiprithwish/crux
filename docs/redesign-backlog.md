# Crux — redesign backlog

Companion to `architecture.md`. Tracks what the visual redesign (starting with the Today
screen, see `design/`) surfaced but deliberately did not build in the first pass. Each
entry says what the mockup shows, why it didn't ship with the rest, and what building it
actually requires.

---

## Cross-tracker insight panels (Today screen, right column)

`design/today-web.png` shows two widgets next to the tracker list:

- **Correlation card** — "Deep work × Sleep · r +0.62", a scatter/line overlay chart plus
  a one-line generated insight ("7h+ sleep is followed by 1h20m more deep work").
- **Spending breakdown** — a per-day bar chart for the current month plus a category
  split (Rent/Food/Tools/Other %).

**Why deferred:** no backend surface computes a correlation between two trackers' daily
sums, and nothing generates the natural-language insight line. Spending's monthly
bar/category chart is closer — `GET /trackers/:publicId/breakdown` already returns
category totals — but the day-by-day bar series and the "this month" framing don't exist
yet.

**What it needs:**

- A `compute`-style module (see `ComputeRegistry`) or a new Repo method that takes two
  tracker/metric ids and a date range, joins their `daily_facts` rows on `local_date`,
  and returns a Pearson `r`. Decide where the insight sentence comes from — templated
  off thresholds on `r`, or out of scope entirely.
- A new endpoint (`GET /trackers/:publicId/correlate?with=<publicId>&from=&to=`) plus
  schema types, following the DAL → Repo → Route layering.
- A day-bucketed variant of the breakdown query for the spending bar chart.

## "Log my day" batch flow

Every mockup's header has a `LOG MY DAY` button. No batch-logging endpoint or modal flow
exists anywhere in the app today — `useQuickAdd` writes one tracker at a time. The
mockups imply a guided sequence through every unlogged tracker for the day (the mobile
"2" badge suggests "2 trackers left").

**What it needs:** UX decision first (single modal stepping through unlogged trackers,
vs. inline focus-jump down the list), then whatever backend support that shape needs —
likely still one `useQuickAdd` call per tracker, so this may be purely a frontend
flow. Left for a follow-up pass once the plain Today screen is live.

## Per-entity attributes on the Things list

`design/things-mobile.png` shows a credit account's row ending in "due 5 Sep" where the other
rows show their last-entry date. That's a per-entity fact, not a usage statistic: the
`entity_attrs` table exists for exactly this (a goal's target date, an account's due date) and
is still read and written by nothing.

The rest of that row shipped — `GET /entities?withStats=true` returns `entryCount`,
`lastEntryDate` and a combinable `total` per entity (`EntitiesRepo.buildStats`).

**What it needs:** a DAL surface over `entity_attrs`, a decision about which keys are
first-class enough to render (due date? opening balance?), and a field for them in
`-EntityForm.tsx`. Until then a row says when it was last used, which is the fact the screen
was actually missing.

## Currency symbols

`formatMinorAmount` prints "1182.40", not "₹1,18,240" — every currency figure in the app,
including the Things rows and their net line, is a bare number unless the entry itself carried
a currency code. `users.home_currency` is stored (defaulting to INR) but no API response
exposes it, so the client has nothing to format against.

**What it needs:** `home_currency` on the user response, then `Intl.NumberFormat` in
`formatMinorAmount` instead of a `toFixed(2)`.

## Per-user timezone

`TrackersRepo`'s `APP_TZ` is hardcoded to `"UTC"` (see its DEV_NOTE) — `entries.tz` is
stored per-row already so this is a read-side change only, not a migration. Not part of
the redesign, but the Today screen's "day boundary" is the first place a wrong timezone
would visibly bite, so noting it here.

## Mobile bottom-tab nav polish

The sidebar shell (this redesign) ships a responsive bottom tab bar for small screens
mirroring the sidebar's four primary links. `design/today-mobile.png` additionally shows
a "2" unread/unlogged badge on the tab bar's log action and a swipe-to-log gesture on
rows — neither is part of the first pass.
