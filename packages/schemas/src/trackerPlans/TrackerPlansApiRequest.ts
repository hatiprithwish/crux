import { z } from "zod";
import { ZTrackerMomentOutcome, ZTrackerPlan, ZTrackerPlanBase } from "./TrackerPlansCommon";

export const ZCreateTrackerPlanApiRequest = z.object({
  plan: ZTrackerPlanBase,
});
export type CreateTrackerPlanApiRequest = z.infer<typeof ZCreateTrackerPlanApiRequest>;

export const ZUpdateTrackerPlanApiRequest = z.object({
  plan: ZTrackerPlanBase.extend({ isPriority: ZTrackerPlan.shape.isPriority })
    .partial()
    .strict()
    .refine((plan) => Object.keys(plan).length > 0, {
      message: "Provide at least one field to update",
    }),
});
export type UpdateTrackerPlanApiRequest = z.infer<typeof ZUpdateTrackerPlanApiRequest>;

// DEV_NOTE: `planPublicId` or `newCue`, never both — capture happens mid-urge, so a trigger the user
// hasn't named yet is created in the same request rather than forcing a detour to the plan editor.
// Neither is also valid: "an urge hit and I don't know why" is still worth recording.
export const ZCreateTrackerMomentApiRequest = z.object({
  moment: z
    .object({
      momentOutcome: ZTrackerMomentOutcome,
      planPublicId: z.string().optional(),
      newCue: z.string().trim().min(1).max(200).optional(),
      note: z.string().trim().max(1000).nullable().optional(),
    })
    .strict()
    .refine((moment) => !(moment.planPublicId && moment.newCue), {
      message: "Provide either planPublicId or newCue, not both",
    }),
});
export type CreateTrackerMomentApiRequest = z.infer<typeof ZCreateTrackerMomentApiRequest>;

export const ZGetTrackerMomentsApiQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type GetTrackerMomentsApiQuery = z.infer<typeof ZGetTrackerMomentsApiQuery>;
