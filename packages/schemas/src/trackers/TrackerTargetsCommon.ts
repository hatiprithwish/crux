import { z } from "zod";

const ZLocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// DEV_NOTE: a tracker's target is not one number, it is a number *from a date*. Scoring a day
// against `manifest.target` read the live value for every day in the range, so raising a goal
// retroactively demoted every day already logged under the old one — a month of "met" turning into
// a month of "partial" because the user got more ambitious today. `daily_facts.target_at_time`
// was the column architecture.md §6 reserved for this, and it can't carry it: its key is
// (user, date, metric, entity) with no tracker in it, so two trackers sharing one metric have one
// slot between them; it only exists on days that have entries, so an unlogged day has no target to
// score against; and it's written at entry time, so backfilling August today would stamp today's
// goal onto an August day. This table is the same idea keyed correctly — per tracker, independent
// of whether anything was logged, and append-only so an old row is never rewritten by a new goal.
//
// DEV_NOTE: `target` is nullable, and null is the load-bearing value: it means "no target from this
// date", which is what every tracker's history looks like before the day its owner first set one.
// The scoring path already treats a null target as "any logged day is met" (TrackersRepo.dayState),
// so an era with no goal scores exactly as it did while it was being lived.
//
// DEV_NOTE: `direction` is deliberately NOT versioned here, even though ZTrackerManifest documents
// it as one judgement with `target`. Raising a target opens a new chapter; flipping direction is a
// correction to what the number always meant ("30 minutes was a ceiling, not a floor"), and the
// honest answer to a correction is to rescore the days it was wrong about. It stays on the manifest.
export const ZTrackerTargetBase = z.object({
  // The first day this target applies to. Resolution is "latest row whose effectiveFrom <= day",
  // so a day earlier than every row has no target at all rather than the oldest one.
  effectiveFrom: ZLocalDate,
  // Canonical units, exactly like manifest.target — the display unit is a per-tracker reading habit
  // and converting happens at the form boundary (invariant 2).
  target: z.number().nullable(),
});
export type TrackerTargetBase = z.infer<typeof ZTrackerTargetBase>;

// Whole row — DB shape.
// DEV_NOTE: id / trackerId are internal autoincrement PKs, never sent to a client (invariant 11).
export const ZTrackerTarget = ZTrackerTargetBase.extend({
  id: z.number(),
  publicId: z.string(),
  userId: z.string(),
  trackerId: z.number(),
  createdAt: z.date(),
  updatedAt: z.date().nullable().optional(),
  deletedAt: z.date().nullable().optional(),
});
export type TrackerTarget = z.infer<typeof ZTrackerTarget>;

// API response shape — internal ids structurally omitted, publicId is client-facing.
export type TrackerTargetApiShape = Omit<
  TrackerTarget,
  "id" | "userId" | "trackerId" | "deletedAt"
>;
