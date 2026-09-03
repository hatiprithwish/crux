import type { Metric, MetricBase } from "./MetricsCommon";

export type CreateMetricDALRequest = MetricBase & Pick<Metric, "userId">;

// Params to find a metric by its public ID and user ID (for authorization)
export type FindMetricDALRequest = Pick<Metric, "publicId" | "userId">;

// DEV_NOTE: metrics are unique per (user_id, key) — this is the get-or-create lookup path domain
// Repos use before writing an entry, so they never race-create a duplicate metric for the same key.
export type FindMetricByKeyDALRequest = Pick<Metric, "userId" | "key">;

export type GetMetricsDALRequest = Pick<Metric, "userId">;
