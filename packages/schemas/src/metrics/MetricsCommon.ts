import { z } from "zod";
import { ZDateAttribution, ZDefaultAgg, ZDirection, ZSemanticType } from "../core/DomainEnums";

// DEV_NOTE: declared globally per user, reused across trackers — see architecture.md §5 "metrics".
// This is what makes cross-domain aggregation possible: two trackers pointing at the same metric
// roll into one number.

// Create Metric Body
// DEV_NOTE: key/name/canonicalUnit are min(1) because a metric is global and permanent — an empty
// key is unaddressable from a manifest, and an empty unit makes every value it holds ambiguous.
// The tracker form's inline branch omits `key` entirely rather than sending "" (ZTrackerMetricSpec).
// DEV_NOTE: every field spelled out, no defaults — a form always holds a concrete value for each
// one, so its validator needs an input type that matches its output type. ZMetricBase below is this
// plus the three server-side defaults, which is what an API request validates against.
export const ZMetricValues = z.object({
  key: z.string().min(1, "Key is required"),
  name: z.string().min(1, "Name is required"),
  semanticType: ZSemanticType,
  canonicalUnit: z.string().min(1, "Unit is required"),
  defaultAgg: ZDefaultAgg,
  direction: ZDirection,
  dateAttribution: ZDateAttribution,
});

export const ZMetricBase = ZMetricValues.extend({
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

// DEV_NOTE: a metric is global per user, so "can I delete this?" is not a question the client can
// answer from the metric alone — it has to know what still points at it. trackerCount counts
// trackers whose primary_metric_id is this metric; entryCount counts the readings already written
// against it. Both non-zero means the metric is load-bearing history, not a mistake to clean up.
export interface MetricUsage {
  trackerCount: number;
  entryCount: number;
}

export type MetricWithUsageApiShape = MetricApiShape & { usage: MetricUsage };
