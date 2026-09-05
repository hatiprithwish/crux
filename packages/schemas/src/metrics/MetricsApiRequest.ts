import { z } from "zod";
import { ZMetricBase, ZMetricValues } from "./MetricsCommon";

export const ZCreateMetricApiRequest = z.object({
  metric: ZMetricBase,
});
export type CreateMetricApiRequest = z.infer<typeof ZCreateMetricApiRequest>;

// DEV_NOTE: only three of the seven fields are editable, and the other four are omitted rather than
// ignored — a request that tries to change one gets a 400 instead of silently doing nothing.
//   key              — manifest.metrics stores metric *keys*, not ids (ZTrackerManifest). Renaming
//                      one orphans every manifest pointing at it.
//   semanticType     — the quick-add controls read it to decide how to interpret a value; changing
//   canonicalUnit      it reinterprets every entry_values row and daily_facts total already written
//                      under the old meaning, without rewriting any of them.
//   dateAttribution  — decides which local_date an interval entry lands on. Flipping it leaves old
//                      daily_facts rows disagreeing with new ones.
// Same reasoning as an entity's immutable `kind` (see ZUpdateEntityApiRequest).
//
// DEV_NOTE: picked from ZMetricValues, NOT ZMetricBase — .partial() leaves a .default() in place,
// so a patch built off ZMetricBase would parse `{}` into {defaultAgg: "sum", direction:
// "higher_better"} and quietly reset both on any edit that only sent a name.
export const ZUpdateMetricApiRequest = z.object({
  metric: ZMetricValues.pick({ name: true, defaultAgg: true, direction: true })
    .partial()
    .strict()
    .refine((metric) => Object.keys(metric).length > 0, {
      message: "Provide at least one field to update",
    }),
});
export type UpdateMetricApiRequest = z.infer<typeof ZUpdateMetricApiRequest>;
