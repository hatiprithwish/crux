import { z } from "zod";

// DEV_NOTE: an implementation intention — "If <cue>, then <response>". One row is one trigger and
// the plan for it. `response` is nullable because naming a trigger comes before knowing what to do
// about it: capturing "bored after dinner" the first time it shows up must not demand a plan.
export const ZTrackerPlanBase = z.object({
  cue: z.string().trim().min(1).max(200),
  response: z.string().trim().min(1).max(200).nullable(),
});
export type TrackerPlanBase = z.infer<typeof ZTrackerPlanBase>;

// DEV_NOTE: the form's raw strings — an empty "then" box is a trigger with no plan yet, mapped to
// null on submit rather than rejected.
export const ZTrackerPlanFormValues = z.object({
  cue: z.string().trim().min(1, "Name what sets it off").max(200),
  response: z.string().trim().max(200),
});
export type TrackerPlanFormValues = z.infer<typeof ZTrackerPlanFormValues>;

// Whole row — DB shape.
export const ZTrackerPlan = ZTrackerPlanBase.extend({
  id: z.number(),
  publicId: z.string(),
  userId: z.string(),
  trackerId: z.number(),
  // DEV_NOTE: user-chosen, not derived — which live plans surface on the Today row. Multiple plans
  // per tracker can be priority at once; none marked falls back to the first by sortOrder. Set to
  // false at creation and toggled afterward (see ZUpdateTrackerPlanApiRequest), not a form field.
  isPriority: z.boolean(),
  sortOrder: z.number(),
  createdAt: z.date(),
  updatedAt: z.date().nullable().optional(),
  deletedAt: z.date().nullable().optional(),
});
export type TrackerPlan = z.infer<typeof ZTrackerPlan>;

export type TrackerPlanApiShape = Omit<TrackerPlan, "id" | "userId" | "trackerId" | "deletedAt">;

// DEV_NOTE: two outcomes, read through the tracker's direction. On a lower_better tracker "held"
// means the urge was resisted and "slipped" means it won; on a higher_better one "held" means the
// plan was followed and "slipped" means it was skipped. One vocabulary keeps the trigger counts
// comparable across every tracker instead of forking the enum per direction.
export enum TrackerMomentOutcomeIntEnum {
  Held = 1,
  Slipped = 2,
}

export enum TrackerMomentOutcomeLabelEnum {
  Held = "held",
  Slipped = "slipped",
}

export const TRACKER_MOMENT_OUTCOME_LABEL_MAP: Record<
  TrackerMomentOutcomeIntEnum,
  TrackerMomentOutcomeLabelEnum
> = {
  [TrackerMomentOutcomeIntEnum.Held]: TrackerMomentOutcomeLabelEnum.Held,
  [TrackerMomentOutcomeIntEnum.Slipped]: TrackerMomentOutcomeLabelEnum.Slipped,
};

export const ZTrackerMomentOutcome = z.enum(TrackerMomentOutcomeIntEnum);

// DEV_NOTE: a moment is a reflective record of a trigger firing, deliberately separate from
// entries — resisting an urge is not a logged unit of the habit and must never move a score.
export const ZTrackerMoment = z.object({
  id: z.number(),
  publicId: z.string(),
  userId: z.string(),
  trackerId: z.number(),
  planId: z.number().nullable(),
  momentOutcome: ZTrackerMomentOutcome,
  localDate: z.string(),
  occurredAt: z.date(),
  note: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date().nullable().optional(),
  deletedAt: z.date().nullable().optional(),
});
export type TrackerMoment = z.infer<typeof ZTrackerMoment>;

// DEV_NOTE: carries the plan's cue alongside its publicId so a moment whose plan was since removed
// still reads as what it was about, and the insight list needs no second lookup.
export type TrackerMomentApiShape = Omit<
  TrackerMoment,
  "id" | "userId" | "trackerId" | "planId" | "deletedAt"
> & {
  momentOutcomeLabel: TrackerMomentOutcomeLabelEnum;
  plan: { publicId: string; cue: string } | null;
};
