import { z } from "zod";
import {
  ZQuickAddPayload,
  ZTrackerBase,
  ZTrackerManifest,
  ZTrackerMetricSpec,
} from "./TrackersCommon";
import { ZComputeInput } from "./ComputeCommon";
import { ZEntryRole } from "../core/DomainEnums";

// DEV_NOTE: one create endpoint for every tracker, hardcoded domain or not — the manifest says what
// it is, and `metric` says which metric it writes (reused or newly declared). This is the API half
// of architecture.md §7 step 4: adding a tracker is a row insert, not a deploy.
export const ZCreateTrackerApiRequest = z.object({
  tracker: ZTrackerBase,
  metric: ZTrackerMetricSpec,
});
export type CreateTrackerApiRequest = z.infer<typeof ZCreateTrackerApiRequest>;

// DEV_NOTE: editing is deliberately narrower than creating, and the omissions are the whole point.
// `control`, `compute` and `metrics` are absent — and so is the `metric` spec create takes: every
// entry already written was shaped by the tracker's control and points at its primary metric, so
// swapping either reinterprets history rather than editing the tracker. Same reasoning that keeps
// `kind` out of ZUpdateEntityApiRequest.
// DEV_NOTE: strict, like the wrapper below — an edit naming `control` is a request to reinterpret
// history, and stripping the key silently would answer it with a 200 that changed nothing.
// DEV_NOTE: `direction` is patchable alongside `target` — the two are one judgement (is 30 minutes
// a floor or a ceiling?), and a tracker whose target can be edited while its direction can't would
// let a user set a cap that still scores as a floor.
// DEV_NOTE: `displayUnit` is patchable for the same reason `target` is, and the two travel
// together — it says what unit the target and every quick-add box are typed in, so an edit moving
// a tracker from seconds to minutes without it would leave the new target in the old unit.
// Changing it reinterprets nothing already stored: entries are canonical seconds either way.
export const ZUpdateTrackerManifest = ZTrackerManifest.pick({
  target: true,
  step: true,
  direction: true,
  entryMode: true,
  schedule: true,
  displayUnit: true,
})
  .partial()
  .strict();
export type UpdateTrackerManifest = z.infer<typeof ZUpdateTrackerManifest>;

// DEV_NOTE: `activeTo` is absent because archive/unarchive own that column (TrackersDAL sets and
// clears it in pairs with archivedAt) — an edit writing it directly would render a live tracker's
// heatmap dead without archiving it.
export const ZUpdateTrackerApiRequest = z.object({
  tracker: ZTrackerBase.omit({ manifest: true, activeTo: true })
    .partial()
    .extend({ manifest: ZUpdateTrackerManifest.optional() })
    .strict()
    .refine((tracker) => Object.keys(tracker).length > 0, {
      message: "Provide at least one field to update",
    }),
});
export type UpdateTrackerApiRequest = z.infer<typeof ZUpdateTrackerApiRequest>;

export const ZQuickAddApiRequest = z.object({
  payload: ZQuickAddPayload,
});
export type QuickAddApiRequest = z.infer<typeof ZQuickAddApiRequest>;

export const ZRunComputeApiRequest = z.object({
  compute: ZComputeInput,
});
export type RunComputeApiRequest = z.infer<typeof ZRunComputeApiRequest>;

export const ZTrackerRangeApiQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type TrackerRangeApiQuery = z.infer<typeof ZTrackerRangeApiQuery>;

export const ZTrackerBreakdownApiQuery = ZTrackerRangeApiQuery.extend({
  role: ZEntryRole.optional(),
});
export type TrackerBreakdownApiQuery = z.infer<typeof ZTrackerBreakdownApiQuery>;

// DEV_NOTE: the list endpoint doubles as the Today screen's single fetch — withToday makes it pay
// for the extra daily_facts range scan only when a caller actually renders quick-add widgets.
export const ZGetTrackersApiQuery = z.object({
  withToday: z.enum(["true", "false"]).optional(),
  // DEV_NOTE: archived rows are the restore screen's whole subject, so they need a way to be asked
  // for. Absent, the list behaves exactly as it always has and never shows one.
  archived: z.enum(["true", "false"]).optional(),
});
export type GetTrackersApiQuery = z.infer<typeof ZGetTrackersApiQuery>;

// DEV_NOTE: date is optional — absent means "server's today", which is all the Today screen ever
// asks for. Explicit dates exist for tests and for a future day-in-review screen.
export const ZTrackerTimelineApiQuery = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export type TrackerTimelineApiQuery = z.infer<typeof ZTrackerTimelineApiQuery>;
