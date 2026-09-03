import { z } from "zod";
import { ZQuickAddPayload, ZTrackerBase, ZTrackerMetricSpec } from "./TrackersCommon";
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
