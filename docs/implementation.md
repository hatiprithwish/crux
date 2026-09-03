# Crux — implementation phases

Companion to `architecture.md`. That doc is the target state; this one is the order we get there
in, broken into phases small enough to build, test, and ship independently. Each phase ends in a
working, testable slice — not a layer (no "phase: write all the DALs").

Current state: **every phase is done.** Phase 4 was built last, after Phase 6, rather than in
number order — the engine made it smaller, since attribution stopped being a per-domain concern.

Phase 6 changed the shape of everything above it: Habits, Money and Time are no longer three
hardcoded implementations, they are three tracker rows. `/habits`, `/money` and `/time` no longer
exist — `/trackers`, `/entities` and `/metrics` replaced them. Read the phases below as the history
of how the substrate got here, not as a description of the code today.

---

## Phase 0 — Substrate + Habits (done)

**What exists:** `users`/`metrics`/`entities`/`entity_attrs`/`trackers`/`entries`/`entry_values`/
`entry_entities`/`daily_facts` per architecture.md §5. `EntitiesDAL`, `MetricsDAL`, `TrackersDAL`,
`EntriesDAL`. Habits as the first hardcoded tracker: create (auto-creates a dedicated boolean
metric + a `control: "toggle"` tracker), log/unlog a day (idempotent), archive, list, get entries
in a date range. `daily_facts` recomputed on every write/delete.

**Testable unit:** create a habit, PUT a day as completed, GET it back, confirm `daily_facts` has a
`count: 1` row. Covered by `entries.test.ts` + `habits.test.ts`.

**Not in Phase 0, on purpose:** no heatmap, no streaks, no Money/Time, no manifest engine, no
orphan-scan cron.

---

## Phase 1 — Habits: heatmap + streaks (done)

Habits can be logged but nothing reads the history back as anything other than a flat list. This
phase finishes architecture.md §6's "Habit heatmap" and "Streaks" for the one tracker that exists.

**Backend**

- `GET /habits/:publicId/heatmap?from=&to=` (or extend the existing entries-range endpoint) — one
  indexed range scan of `daily_facts` for the habit's `primary_metric_id`, up to 365 days.
- Streak count: fetch the range, walk descending in TypeScript, skip days before
  `trackers.active_from`, break on a missing day. No `target_at_time` yet (Habits has no goals) —
  "met" is just `count > 0`.

**Frontend**

- `-HabitHeatmap.tsx`: grid, client-side date-position arithmetic, 3 cell states for Habits
  specifically (not-yet-active / no-data / done — no partial state without a numeric target).
- Streak number on `HabitCard`.

**Golden file to mirror:** none yet — this _is_ the first read-surface, so it sets the pattern
Money/Time's read surfaces will follow.

**Testable end-to-end unit:** log a habit for 5 consecutive days with a gap on day 3, load the
heatmap, assert the gap renders as "no-data" (not zero, not a break marker) per invariant 7, and
the streak counter shows the correct post-gap streak length.

---

## Phase 2 — Money tracker (done)

Second hardcoded tracker (architecture.md §7 step 2). First real use of `currency`/`value_base`/
`fx_rate` (invariant 3) and `entry_role: "account"`.

**Resolved:** categories became entities of `kind: "tag"` linked through a new `tag` role, not
free text on `entries.label` — architecture.md §3's `entry_role` enum carries `tag` for exactly
this. The original framing of the question follows.

**Open question at the time:** architecture.md's `entry_role` enum is
`project | person | place | account` — there's no `tag`/`category` role. Money needs
expense-categorization (groceries, rent, ...). Either (a) categories are `entities` of
`kind: "tag"` linked via a role that doesn't exist yet, meaning the enum needs an amendment, or
(b) categories live on `entries.label` (free text, already exists, doc says "drill-down groups on
this") instead of as a linked entity. (b) requires no schema change and matches how the doc already
uses `label` for Time's breakdown — recommend that, but confirm before writing code since it's a
real modeling choice, not just an implementation detail.

**Backend**

- `EntitiesDAL` already supports `kind: "account"` — no DAL change needed, just a route.
- New `EntitiesRoutes.ts` (mirrors `HabitsRoutes.ts`) scoped to `kind=account`, or fold
  account-management into a `MoneyRoutes.ts` the way Habits folds entity concerns into itself.
- `MoneyRepo.ts` (mirrors `HabitsRepo.ts`): creates one metric per account+currency pair (or one
  `expense_amount` metric reused with `currency` carried per-`entry_values` row — decide which once
  the category question above is settled, since it affects whether metrics are per-account or
  shared), tracker with `control: "amount_pad"` or `"form"`, `semantic_type: "currency_minor"`.
- FX: `fx_rate` and `value_base` are set at write time from a rate the caller supplies (no live FX
  API in v1 — out of scope, matches "no automatic ingestion" in §9). Historical rate is never
  recomputed later (invariant 3).
- `transfer_group_id`: writing a transfer creates two entries (debit one account, credit another)
  sharing a `transfer_group_id`, in one repo call.

**Frontend**

- Account list/create (mirrors Habits' `new/index.tsx` pattern).
- Expense entry form (`control: "amount_pad"`): amount, currency, account, category (per the
  decision above), optional note.

**Testable end-to-end unit:** create two accounts, log an expense in a foreign currency, confirm
`entry_values.value_base` is in `home_currency` and `fx_rate` is stored; log a transfer between the
two accounts, confirm both sides share one `transfer_group_id` and each account's daily total
moves in the correct direction.

---

## Phase 3 — Time tracker (done)

Third hardcoded tracker — completes "three hardcoded trackers" (§7 step 2). First real use of
`entry_kind: "interval"`, `ended_at`, and `entry_role: "project"`.

**Backend**

- `TimeRepo.ts`: tracker with `control: "timer"`, metric `semantic_type: "duration_seconds"`.
- Start: write an entry with `entry_kind: "interval"`, `ended_at: null` (open session).
- Stop: update... except entries are append-only/soft-delete, never mutated in place per invariant
  1. Resolve by: the open-session entry is soft-deleted and replaced by a new closed entry with the
     same `occurred_at` and a set `ended_at`, OR (cleaner) `ended_at` is the one exception to
     append-only and gets a real `updateEntryEndedAt` DAL method carved out for exactly this case.
     **Resolved:** `ended_at` is the one exception to append-only, with `EntriesDAL.updateEntryEndedAt`
     carved out for exactly this case (guarded on `ended_at is null`, so closing twice is a no-op). The
     duration reading is appended on stop, never on start — a running session contributes nothing to
     any aggregate.
- `label` is the project/task name for the breakdown group-by (§6 "Time-tracker breakdown").

**Frontend**

- Start/stop timer control, running-session indicator (open entries where `ended_at is null`).
- Breakdown view: query `entries` directly (not `daily_facts` — needs `count(*)` of sessions and
  `label` grouping, per §6), grouped by `label`, sliced by `role: "project"`, left-joined so
  unassigned time gets an explicit bucket.

**Testable end-to-end unit:** start a timer, stop it after some elapsed time, confirm one closed
interval entry exists with correct `occurred_at`/`ended_at`; log two sessions under different
labels, confirm the breakdown view returns per-label session counts and summed duration.

---

## Phase 4 — Cross-domain aggregation (done — built after Phase 6)

Now that three domains produce real entries linked to entities, build the read surface
architecture.md §6 describes: "Pushups and running roll into one 'Fitness' number because they
point at the same entity."

**Backend**

- One hand-written query (§7 step 6: "productise only the five or six queries you actually
  re-run") — filter `daily_facts` by one `entity_id` across metrics, sum. Not a generic
  "cross-domain query builder" — a specific endpoint for a specific dashboard need once one exists.

**Frontend**

- A dashboard card/section showing one entity's rolled-up total across whatever metrics point at
  it.

**Testable end-to-end unit:** create one entity, link entries from two different trackers/metrics
to it via `entry_entities`, confirm the aggregation endpoint sums both without triple-counting
(invariant 6 — filtered by exactly one role).

**What it produced.** `EntriesDAL.getEntityRollup` is the one hand-written query, with two paths
because `daily_facts` has no `role` column: no role given, it reads the entity-scoped fact rows
directly (they were computed from the _distinct_ entries linked to that entity, so one entry linked
under two roles still counts once); a role given, it falls back to
`entries ⋈ entry_values ⋈ entry_entities` filtered to that single role. Both use the same
`COALESCE(value_base, value_num)` as `recomputeDailyFacts`, so they agree with each other and total
in home currency (invariant 3). `EntitiesRepo.getRollup` attaches metric metadata;
`GET /entities/:publicId/rollup?from=&to=&role=` serves it; the entity detail page renders it.

**Scoping to one entity is what satisfies invariant 6.** There is nothing to group across, so an
entry pointing at three entities contributes once to each of their rollups and is never multiplied
inside any one of them. `rollup.test.ts` asserts exactly that.

**Metrics only combine when they agree.** Two `count` metrics in the same canonical unit (pushups +
squats) produce the single "Fitness number" §6 describes. A count and a distance do not — reps plus
metres is a number that means nothing, so `combined` is null and the client shows the per-metric
rows instead of inventing a total.

**It exposed a real gap in Phase 6.** Only `amount_pad`, `form` and `timer` accepted `entityLinks`,
so a count-style habit could not be attributed to an entity at all — which is precisely the
pushups-roll-into-Fitness case. Every quick-add payload now carries `entityLinks` (empty by
default), and the four simple controls render the picker when the user has entities to pick.

---

## Phase 5 — Weekly orphan-scan cron Worker (done)

Architecture.md §4.1 point 3 — infrastructure hygiene, not tied to any specific feature, can slot
in any time after Phase 0. Doing it here (post-Phase 3) means there's real multi-table data to
validate the query against.

**Backend**

- `scheduled()` handler on the Worker, cron-triggered weekly (`wrangler.jsonc` `triggers.crons`).
- Runs the exact `union all` query from architecture.md §4.1, logs any non-zero count via
  `AppLogger` as a bug signal (never auto-deletes — "a bug in the repository layer, not a data
  problem to patch").

**Testable end-to-end unit:** manually insert an orphaned `entry_values` row (no matching `entries`
row) in a test DB, invoke the scheduled handler directly (`wrangler dev --test-scheduled` or a unit
test calling the handler function), assert it logs exactly one orphan for `entry_values` and zero
for the other two checks.

---

## Phase 6 — Manifest engine extraction (done)

Architecture.md §7 step 4: "Extract the manifest format from what those three demonstrably share.
Rule of three." This is the phase that turns "three hardcoded trackers" into "a generic tracker
system" — and it's explicitly gated on Phases 1–3 having been _used_, not just built. Don't start
this phase until Habits/Money/Time have been in real use for a while (§7 step 3) — building the
abstraction before that is exactly the premature-generalization the doc warns against.

**What "done" looks like:** a generic "New tracker" flow that reads `manifest.control` and renders
the right quick-add widget (toggle/stepper/increment/timer/daily_total/amount_pad/form) without
per-domain frontend code, and a generic tracker-creation API that takes a manifest instead of each
domain having its own bespoke create-tracker Repo method.

**Testable end-to-end unit:** create a new tracker of an existing control type (e.g. another toggle
habit) through the generic flow, with zero new frontend or backend code beyond the manifest engine
itself, and confirm it behaves identically to a Phase-0-era hardcoded Habit.

**What it produced.** `manifest/ControlHandlers.ts` plans writes for all seven controls as a pure
function of manifest + payload (no I/O); `manifest/ComputeRegistry.ts` holds the escape hatch;
`TrackersRepo` executes the plans against the same shared DALs the three domain Repos used.
`HabitsRepo`, `MoneyRepo` and `TimeRepo` and their routes are gone, as are the `habits`, `money` and
`time` schema packages. `EntitiesRepo` absorbed Money's accounts/categories and Time's projects
(`kind` was the only difference between them); `MetricsRepo` exists so the "reuse an existing
metric" branch is reachable from the UI. No DB schema change was needed.

**Rule of three held, with one exception.** The seven controls cover every write the three domains
performed except a Money transfer — two entries sharing a `transfer_group_id` with opposite signs.
That is the sole registered compute module (`money.transfer.v1`), and it is what justifies the
escape hatch existing at all. Anything a control can express does not belong there.

**Three things the manifest only became real under the engine:** `entryMode` now actually gates
backdating (`live` = today only) instead of being decoration; the heatmap gained the `partial` and
`not_scheduled` states Habits could never produce, since it had neither a target nor a non-daily
schedule; and Money/Time stopped being found by `manifest.control === "form" | "timer"` lookups,
which a user-created tracker of the same control would have hijacked.

---

## Explicitly not phased — wait for the doc's own trigger condition

These are in architecture.md §8 ("Deferred, deliberately") and shouldn't get a phase number until
their stated trigger shows up:

- **Goals table** — wait for a tracker that actually needs a target beyond what `manifest.target`
  already covers.
- **Split allocation** (weights per entity) — wait for a real multi-entity-per-entry use case;
  one-role-per-entry covers the phases above.
- **Local-first sync / client-generated `public_id`** (invariant 12 currently unmet — the server
  generates every `public_id` today) — wait for an actual offline use case. `rev` + soft deletes
  already keep the door open.
- **Weekly/monthly rollup tables** — wait for `daily_facts` range scans to actually get slow.
- **Multi-user/sharing** — `user_id` is already on every table; no other prep needed until asked
  for.
