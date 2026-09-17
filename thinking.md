# Substrate — Architecture Decisions

_Consolidated from discussion on the target architecture report. September 16, 2026._

## Vision

Substrate is a life companion for people who want to live intentionally and build a life they love. The user is the main character of their own life; Substrate is where they see, track and improve every part of it.

The architectural consequence of that statement: the **user** is the aggregate root, not any tracker, goal, or area. Everything else is a way of looking at the user's life, not a thing that owns part of it.

---

## Decision 1 — Offline is not a requirement

Confirmed: no offline mode needed.

This collapses the biggest fork in the research report. Options B (hand-rolled sync), C (WatermelonDB), and D (per-user Durable Objects) are all off the table for v1. **Ship Option A: D1 + Workers + Drizzle, server-authoritative with an optimistic client cache.**

The entire sync discourse in the sources — Actual Budget's CRDTs, hybrid logical clocks, Merkle trees, tombstone GC — solves _multi-collaborator_ problems. With one human and one account, there is no real concurrency to resolve. Before committing, sanity-check the honest version of the question: _will two of my own devices ever write conflicting data within the same few seconds?_ If the answer is "basically never," last-write-wins on a server-set `updated_at` is sufficient and the rest is insurance you don't need to build.

**Still do this, because it's nearly free:** put `public_id` (prefixed nanoid), `updated_at`, `seq`, `deleted_at`, `utc_instant`, `local_date`, and `tz` on every syncable table from row one. Columns you never read cost nothing. Retrofitting sync identity onto months of existing rows is the expensive version.

---

## Decision 2 — Navigation hierarchy, not ownership hierarchy

**This is the central decision.**

The original sketch read as a containment tree:

```
avatar → areas → goals → trackers/tasks → data
```

That is an _ownership_ hierarchy, and building it that way recreates exactly the problem the research warned about. It doesn't remove the owning object — it just promotes it from "tracker" to "goal."

The correct shape is a thin **meaning layer** sitting on top of a flat **fact layer**:

```
                        Avatar
                   (derived life state)
                          ▲
                          │ aggregation
     ┌────────────────────┴────────────────────┐
     │  MEANING LAYER — config, owns no rows   │
     │    Areas    │    Goals    │   Lenses    │
     └────────────────────┬────────────────────┘
                          │ reference (queries, M:N links)
                          ▼
     ┌─────────────────────────────────────────┐
     │  OBSERVATION LOG — the only authority   │
     │  flat, typed, keyed to (user, local_date)│
     └─────────────────────────────────────────┘
                          ▲
        ┌─────────────────┼─────────────────┐
     Capture           Tasks           Money ledger
                    (emit observations)
```

Two arrow types, two different meanings:

- **Upward (solid)** — aggregation. Facts roll up into meaning.
- **Downward (dashed)** — reference. Goals and lenses _query_ the log; they never hold rows in it.

**The rule: nothing owns observations except the user.**

### Why this matters concretely

**Re-planning is the common case.** People restructure their goals far more often than they restructure their life. Under ownership, deleting an area or completing a goal raises a bad question — what happens to the data? You end up with soft-deleted goals kept alive purely so their history doesn't vanish, or cascade rules you're afraid to touch. Under reference, you can delete an area, abandon a goal, or rewrite an entire quarter's plan and every observation is untouched.

**Metric reuse.** Sleep duration serves a health goal _and_ a focus goal, and shows up in relationships when correlated against mood. In a tree you must pick one parent or duplicate the metric. Here every link is many-to-many, so you never choose.

---

## Decision 3 — Goals are queries, not containers

```sql
CREATE TABLE goals (
  id            INTEGER PRIMARY KEY,
  public_id     TEXT NOT NULL UNIQUE,
  user_id       INTEGER NOT NULL,
  parent_id     INTEGER,          -- self-ref: 5y → 1y → quarter → week, arbitrary depth
  label         TEXT NOT NULL,
  horizon       TEXT,             -- free text label, NOT a fixed enum of levels
  starts_on     TEXT,             -- local date
  ends_on       TEXT,             -- local date
  status        TEXT NOT NULL,    -- active|achieved|abandoned|paused
  updated_at    INTEGER NOT NULL, seq INTEGER, deleted_at INTEGER
);

-- 0..N per goal. This is HOW progress is measured.
CREATE TABLE goal_targets (
  id          INTEGER PRIMARY KEY,
  goal_id     INTEGER NOT NULL,
  metric_id   INTEGER NOT NULL,   -- points at the global metric registry
  comparator  TEXT NOT NULL,      -- >= | <= | == | between
  target_num  REAL,
  window      TEXT NOT NULL       -- daily | weekly | cumulative | final
);

CREATE TABLE goal_areas (         -- M:N — a goal can span areas
  goal_id INTEGER NOT NULL, area_id INTEGER NOT NULL,
  PRIMARY KEY (goal_id, area_id)
);
```

**Progress is computed, never stored.** A goal's progress is a query over `observations` filtered by `goal_targets`. Backfilling a missed day or correcting a bad entry fixes goal progress automatically — no counters drifting out of sync with the log.

**Zero targets is a valid goal.** "Be more present with my family" has no metric, and that must work natively. A model requiring every goal to be measurable quietly pushes users toward only setting goals they can count — the opposite of what the vision is after.

**One table, not one per horizon.** Do not model 5yr / 3yr / quarterly / weekly as distinct types or tables. Self-reference plus a `horizon` label handles arbitrary user-defined structures. Otherwise the day someone wants a 6-week goal, you're writing a migration.

---

## Decision 4 — Areas are per-user; `domain` is not

The research report puts a `domain` column on the global `metrics` registry (`health|money|time|mood|custom`). The vision wants areas to be **fully user-customizable**. These cannot be the same field — the metric registry is global and closed, areas are per-user and open.

**Resolution:**

- Keep `domain` on `metrics` as a shipped default for grouping and onboarding.
- Add a per-user `area_metrics` mapping (M:N) so a user can decide sleep belongs in their "Performance" area rather than "Health."

```sql
CREATE TABLE areas (
  id INTEGER PRIMARY KEY, public_id TEXT NOT NULL UNIQUE, user_id INTEGER NOT NULL,
  label TEXT NOT NULL, sort_order INTEGER,
  updated_at INTEGER NOT NULL, seq INTEGER, deleted_at INTEGER
);
CREATE TABLE area_metrics (
  area_id INTEGER NOT NULL, metric_id INTEGER NOT NULL,
  PRIMARY KEY (area_id, metric_id)
);
```

---

## Decision 5 — Tasks stay separate; they emit observations

An observation is a **recorded fact**. A task is **intent with state** — todo/done, due dates, recurrence, and the real possibility of never being completed.

Merging them means either observations acquire a `status` column they shouldn't have, or tasks lose the ability to exist unfinished. Neither is acceptable.

**Keep `tasks` as its own table. Completing a task emits a boolean observation** — the same satellite pattern as the money ledger. That way "did I do my morning routine" still correlates against mood and sleep without polluting the log with unsettled state.

Recurring tasks: a task template that generates instances; each completed instance emits.

---

## Decision 6 — Reflections get their own table

Unbounded text, attached to a period rather than a point. Not aggregatable, often long — they don't belong in the observation log. But they share the date spine, which is what makes "show me my week" assemble cleanly.

```sql
CREATE TABLE reflections (
  id INTEGER PRIMARY KEY, public_id TEXT NOT NULL UNIQUE, user_id INTEGER NOT NULL,
  scope TEXT NOT NULL,          -- day|week|month|adhoc
  period_start TEXT, period_end TEXT,   -- local dates
  body TEXT NOT NULL,
  utc_instant INTEGER NOT NULL, local_date TEXT NOT NULL, tz TEXT NOT NULL,
  updated_at INTEGER NOT NULL, seq INTEGER, deleted_at INTEGER
);
CREATE TABLE reflection_links (       -- optional M:N to goals and areas
  reflection_id INTEGER NOT NULL, target_kind TEXT NOT NULL, target_id INTEGER NOT NULL,
  PRIMARY KEY (reflection_id, target_kind, target_id)
);
```

---

## Decision 7 — Vision board is a soft reference

Vision items are images and aspirational text. A goal **may** point at one; it must never be required to.

If vision items become mandatory parents of goals, you've added a compulsory step before anyone can do anything in the app — which will hurt most during onboarding, exactly when you can least afford friction.

---

## Decision 8 — Money is a satellite; time is not (yet)

Both money and time share a _role_ — emit daily rollup observations — but not a _structure_. Their invariants are incompatible, and invariants are the entire reason to pull a subsystem out of the generic substrate.

|                     | Money                                               | Time                                 |
| ------------------- | --------------------------------------------------- | ------------------------------------ |
| Core invariant      | entries per transaction sum to zero                 | intervals on a channel don't overlap |
| Conservation        | yes — money moves between accounts                  | none — time is just spent            |
| One event touches   | two+ accounts                                       | one activity                         |
| Derived quantity    | running balance from inception                      | duration summed per day              |
| Mutable after write | never (corrections are contra-entries)              | yes (a running timer has no end)     |
| Needs               | currency, minor units, debit/credit, pending/posted | start, end, open-interval state      |

Merging them produces a table where `account_id`, `amount_minor`, `currency`, and `direction` are null for every time row and `start`/`end` are null for every money row. No `CHECK` constraint covers both: "sums to zero" is per-group arithmetic, "doesn't overlap" is per-range collision. That's the "amount + category" mistake re-committed one layer down — a generic container that holds both but guarantees neither.

**The steelman, noted:** time-as-double-entry is real. Beancount users budget 24 hours a day across accounts and "borrow" from sleep to fund work. It's elegant — but it only works if every minute is accounted for, requiring an `Unallocated` account and a UX where unlogged time is an error state. For a life companion that's punishing.

### Time collapses into observations for v1

The observation table already has `value_start` and `value_end`. "Worked 90 minutes on the app, 2–3:30pm" is just an observation with a duration semantic type. **No time satellite needed.**

Build one only when you need something observations genuinely can't express:

- **running timers** — an open interval, mutable until stopped (observations are settled facts)
- **overlap resolution** — the ActivityWatch problem: competing signals for the same minute
- **automatic capture** — heartbeat merging from a device or app

None are day-one for a tracker where people log intentionally.

**Net: one satellite (money) plus tasks. That's the right number for a solo build.**

---

## Technical details to settle now

**Enforce the sparse-column invariant in SQL.** The `value_num` / `value_text` / `value_bool` / `value_start` / `value_end` pattern needs "exactly one populated, selected by the metric's semantic type" encoded as a `CHECK` constraint on the table — not left to the repository layer alone.

**`seq` isn't self-implementing.** A server-assigned monotonic cursor on D1 needs either a `counters` row incremented transactionally per user, or a willingness to lean on rowid ordering under a single-writer assumption (which, given Decision 1, you likely have).

**Decide now whether the metric registry is user-extensible.** Exist allows custom attributes; the template-picker plan implies the same. If custom metrics are coming, decide whether they live in the same `metrics` table with a `manual`/`owner` flag (Exist's approach) or a separate namespace. It barely changes the DDL, but it determines what the template picker writes.

---

## Carried forward from the research report

Unchanged and still correct:

- Flat typed `observations` table with `value[x]` columns, nullable `event_id` grouping
- Global metric registry with semantic type, canonical unit, explicit `aggregation` (HealthKit-style, not Exist's implicit approach)
- The `utc_instant` / `local_date` / `tz` triple, plus per-user `day_start_offset_minutes`
- All timezone math isolated in one module; business logic on `YYYY-MM-DD` string comparison; local-noon for date-only backfills; update `tz` per event on travel without rewriting history
- Double-entry ledger for money, emitting daily rollup observations
- Dual-ID: integer rowid for internal joins, prefixed nanoid `public_id` as external identity
- `daily_facts` as a pure disposable cache — deferred until a screen actually drags
- Template picker for metric creation; never expose aggregation / unit / direction to users

---

## Scope warning

"Ideally the only companion they need" and "whatever solving that problem takes, we build" is unbounded scope. As a solo builder, that — not the schema — is the most likely thing to kill this project.

The architecture above is the hedge. A flat substrate with a thin meaning layer lets areas, goals, tasks, reflections, and whatever comes next arrive as **config and queries rather than migrations**. It's what makes unbounded ambition survivable.

But pick **one loop** and make it excellent first. The strongest candidate: **daily capture → weekly reflection.** Everything else waits.

---

## Build sequence

1. Metric registry + flat `observations` + events + entities on D1/Drizzle, all sync columns present but unused
2. Areas + goals + `goal_targets` (goals as queries from day one — this shape is hard to retrofit)
3. Three hardcoded lenses: habit boolean, money spend, time duration — hand-wired, no manifest yet
4. Double-entry ledger emitting spend observations
5. Today / capture / trends screens with hand-written cross-domain SQL
6. Tasks + reflections
7. Extract the manifest/lens format after ~a month of real personal use
8. Add `daily_facts` when a screen drags
9. Weekly correlation + review
10. Vision board
11. Time satellite — only if timers or auto-capture become real requirements

---

## Open questions

- Is the metric registry user-extensible at launch, or seeded-only?
- What does the avatar actually _show_? "Derived life state" needs a concrete composite definition — likely a weighted rollup across areas, stored in `daily_facts` like any other derived metric.
- Does a goal without targets still show progress, or only a status? (Affects whether qualitative goals feel first-class or second-class in the UI.)
