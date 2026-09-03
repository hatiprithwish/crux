import { z } from "zod";
import { ZDateAttribution, ZDefaultAgg, ZDirection, ZSemanticType } from "../core/DomainEnums";

// DEV_NOTE: declared globally per user, reused across trackers — see architecture.md §5 "metrics".
// This is what makes cross-domain aggregation possible: two trackers pointing at the same metric
// roll into one number.

// Create Metric Body
export const ZMetricBase = z.object({
  key: z.string(),
  name: z.string(),
  semanticType: ZSemanticType,
  canonicalUnit: z.string(),
  defaultAgg: ZDefaultAgg.default("sum"),
  direction: ZDirection.default("higher_better"),
  dateAttribution: ZDateAttribution.default("start"),
});
export type MetricBase = z.infer<typeof ZMetricBase>;

// Whole Metric Body — DB shape
// DEV_NOTE: id is the internal autoincrement PK — used by DAL/Repo for joins only, NEVER sent to a client
export const ZMetric = ZMetricBase.extend({
  id: z.number(),
  publicId: z.string(),
  userId: z.string(),
  createdAt: z.date(),
  updatedAt: z.date().nullable().optional(),
  deletedAt: z.date().nullable().optional(),
});
export type Metric = z.infer<typeof ZMetric>;

// API response shape — id structurally omitted, publicId is client-facing
export type MetricApiShape = Omit<Metric, "id" | "deletedAt">;
