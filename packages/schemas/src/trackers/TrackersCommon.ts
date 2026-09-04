import { z } from "zod";
import { ZControl, ZEntryRole } from "../core/DomainEnums";
import type { EntryKind, EntryRole, SemanticType } from "../core/DomainEnums";
import { ZMetricBase } from "../metrics/MetricsCommon";
import { ZComputeKey } from "./ComputeCommon";

const ZLocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// DEV_NOTE: schedule.type discriminates the shape — see architecture.md §5 "trackers" manifest shape.
export const ZTrackerSchedule = z.discriminatedUnion("type", [
  z.object({ type: z.literal("daily") }),
  z.object({ type: z.literal("days_of_week"), days: z.array(z.number().min(0).max(6)) }),
  z.object({ type: z.literal("times_per_week"), count: z.number() }),
]);
export type TrackerSchedule = z.infer<typeof ZTrackerSchedule>;

// DEV_NOTE: `compute` is the escape hatch — a registered module key (see ComputeCommon.ts), not
// free text. Null for everything the seven controls already cover, which is everything except
// Money's transfer.
export const ZTrackerManifest = z.object({
  control: ZControl,
  metrics: z.array(z.string()),
  target: z.number().nullable(),
  step: z.number().nullable(),
  entryMode: z.enum(["live", "retro"]),
  schedule: ZTrackerSchedule,
  compute: ZComputeKey.nullable(),
});
export type TrackerManifest = z.infer<typeof ZTrackerManifest>;

// Create Tracker Body
export const ZTrackerBase = z.object({
  name: z.string(),
  colorIndex: z.number().nullable().optional(),
  manifest: ZTrackerManifest,
  sortOrder: z.number().optional(),
  activeFrom: z.string(), // YYYY-MM-DD; heatmaps render nothing before this
  activeTo: z.string().nullable().optional(),
});
export type TrackerBase = z.infer<typeof ZTrackerBase>;

// DEV_NOTE: a tracker needs a primary metric, and there are exactly two honest ways to get one:
// point at a metric that already exists (what makes cross-domain aggregation possible — "pushups
// and running roll into one Fitness number", architecture.md §6), or declare a new one inline (what
// every Phase 0–3 hardcoded Repo did). `key` is optional on the new branch: omit it and the Repo
// generates a collision-proof one, since metrics are unique per (user_id, key).
export const ZTrackerMetricSpec = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("existing"), metricPublicId: z.string() }),
  z.object({
    mode: z.literal("new"),
    metric: ZMetricBase.omit({ key: true }).extend({ key: z.string().optional() }),
  }),
]);
export type TrackerMetricSpec = z.infer<typeof ZTrackerMetricSpec>;

// Whole Tracker Body — DB shape
// DEV_NOTE: id / primaryMetricId are internal autoincrement PKs — used by DAL/Repo for joins only,
// NEVER sent to a client as-is.
export const ZTracker = ZTrackerBase.extend({
  id: z.number(),
  publicId: z.string(),
  userId: z.string(),
  primaryMetricId: z.number(),
  manifestVersion: z.number(),
  createdAt: z.date(),
  updatedAt: z.date().nullable().optional(),
  archivedAt: z.date().nullable().optional(),
  deletedAt: z.date().nullable().optional(),
});
export type Tracker = z.infer<typeof ZTracker>;

// DEV_NOTE: manifest.metrics is a list of keys — machine identifiers, not labels. A form control
// rendering one input per declared metric needs the human name and unit too, and asking the client
// to fetch /metrics and join it locally would just move the join somewhere worse.
export interface TrackerMetricDetail {
  metricPublicId: string;
  key: string;
  name: string;
  semanticType: SemanticType;
  canonicalUnit: string;
}

// API response shape — internal ids structurally omitted, publicId is client-facing
export type TrackerApiShape = Omit<Tracker, "id" | "primaryMetricId" | "deletedAt"> & {
  primaryMetricPublicId: string;
  primaryMetricKey: string;
  metricDetails: TrackerMetricDetail[];
};

// --- Quick-add: the manifest engine's write surface -------------------------------------------
// DEV_NOTE: architecture.md §6 — "manifest.control picks the quick-add widget". This union is the
// wire half of that: one member per control, so the frontend widget and the backend handler are
// two ends of the same discriminated type instead of seven bespoke endpoints. The Repo rejects a
// payload whose `control` doesn't match the tracker's own manifest.control.

export const ZEntityLinkInput = z.object({
  entityPublicId: z.string(),
  role: ZEntryRole,
});
export type EntityLinkInput = z.infer<typeof ZEntityLinkInput>;

// DEV_NOTE: metricKey (not a publicId) because the manifest itself lists metrics by key — a form
// payload naming a metric the manifest doesn't declare is rejected rather than silently written.
export const ZFormValueInput = z.object({
  metricKey: z.string(),
  valueNum: z.number().nullable().optional(),
  valueText: z.string().nullable().optional(),
  valueJson: z.string().nullable().optional(),
  currency: z.string().length(3).nullable().optional(),
  fxRate: z.number().positive().nullable().optional(),
});
export type FormValueInput = z.infer<typeof ZFormValueInput>;

export const ZTimerAction = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("start"),
    label: z.string().min(1),
    entityLinks: z.array(ZEntityLinkInput).default([]),
  }),
  z.object({ action: z.literal("stop"), entryPublicId: z.string() }),
]);
export type TimerAction = z.infer<typeof ZTimerAction>;

// DEV_NOTE: every control carries entityLinks, not just the money/time-shaped ones. Attribution is
// what makes architecture.md §6's cross-domain rollup possible — "pushups and running roll into one
// Fitness number because they point at the same entity" needs a *count* tracker to be linkable, not
// only an amount or a session. Empty by default, so nothing is forced to care.
export const ZQuickAddPayload = z.discriminatedUnion("control", [
  // Idempotent day set — completed:true is a no-op if already logged, false clears the day.
  z.object({
    control: z.literal("toggle"),
    date: ZLocalDate,
    completed: z.boolean(),
    entityLinks: z.array(ZEntityLinkInput).default([]),
  }),
  // One tap = one entry of manifest.step (default 1). Always additive.
  z.object({
    control: z.literal("increment"),
    date: ZLocalDate,
    note: z.string().nullable().optional(),
    entityLinks: z.array(ZEntityLinkInput).default([]),
  }),
  // Signed multiple of manifest.step — the ± variant of increment.
  z.object({
    control: z.literal("stepper"),
    date: ZLocalDate,
    steps: z.number().int(),
    entityLinks: z.array(ZEntityLinkInput).default([]),
  }),
  // Sets the day's total outright (replaces whatever's logged), rather than adding to it.
  z.object({
    control: z.literal("daily_total"),
    date: ZLocalDate,
    total: z.number(),
    entityLinks: z.array(ZEntityLinkInput).default([]),
  }),
  z.object({
    control: z.literal("amount_pad"),
    date: ZLocalDate,
    amountMinor: z.number().int(),
    currency: z.string().length(3),
    fxRate: z.number().positive(),
    entityLinks: z.array(ZEntityLinkInput).default([]),
    note: z.string().nullable().optional(),
  }),
  z.object({
    control: z.literal("form"),
    date: ZLocalDate,
    values: z.array(ZFormValueInput).min(1),
    entityLinks: z.array(ZEntityLinkInput).default([]),
    label: z.string().nullable().optional(),
    note: z.string().nullable().optional(),
  }),
  z.object({ control: z.literal("timer"), timer: ZTimerAction }),
]);
export type QuickAddPayload = z.infer<typeof ZQuickAddPayload>;

// --- Read surfaces -----------------------------------------------------------------------------

// API response shape — one entry with its readings and entity links, all publicId-only. Replaces
// HabitEntry / MoneyExpense / TimeSession: every domain reads its entries back through this one
// shape now, and interprets the values it declared in its own manifest.
export interface TrackerEntryValueApiShape {
  metricPublicId: string;
  metricKey: string;
  valueNum: number | null;
  valueText: string | null;
  valueJson: string | null;
  currency: string | null;
  valueBase: number | null;
  fxRate: number | null;
}

export interface TrackerEntryApiShape {
  publicId: string;
  entryKind: EntryKind;
  occurredAt: Date;
  endedAt: Date | null;
  durationSeconds: number | null; // null for point entries and still-running intervals
  localDate: string;
  label: string | null;
  note: string | null;
  transferGroupId: string | null;
  values: TrackerEntryValueApiShape[];
  entities: { entityPublicId: string; role: EntryRole }[];
  createdAt: Date;
}

// DEV_NOTE: architecture.md §6 — four cell states plus "nothing renders before active_from".
// Habits only ever produced three of them (it has no target); a tracker with manifest.target now
// gets "partial" (sum below target) vs "met", and a non-daily manifest.schedule gets
// "not_scheduled" for days it never asked about — which is not the same as a missed day
// (invariant 7: missing data is neutral).
export type TrackerDayState = "not_active" | "not_scheduled" | "no_data" | "partial" | "met";

export interface TrackerHeatmapDay {
  localDate: string;
  state: TrackerDayState;
  sum: number | null;
  target: number | null;
}

// DEV_NOTE: architecture.md §6 "Time-tracker breakdown" — generalised off Time's: `role` is the
// "slice by" parameter, and a null entityPublicId is the explicit left-join bucket for entries with
// no entity in that role, not a dropped row.
export interface TrackerBreakdownRow {
  label: string | null;
  entityPublicId: string | null;
  entryCount: number;
  total: number;
}

// API response shape — a tracker plus everything the Today screen needs to render its quick-add
// widget without a second round trip per row.
export interface TrackerTodayApiShape {
  tracker: TrackerApiShape;
  todaySum: number | null; // null = nothing logged today (invariant 7 — never coalesced to 0)
  todayCount: number;
  streak: number;
  openSession: TrackerEntryApiShape | null; // timer trackers only
}
