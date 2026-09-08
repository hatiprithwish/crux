import type { Metric, MetricBase } from "./MetricsCommon";

export type CreateMetricDALRequest = MetricBase & Pick<Metric, "userId">;

// Params to find a metric by its public ID and user ID (for authorization)
export type FindMetricDALRequest = Pick<Metric, "publicId" | "userId">;

// DEV_NOTE: metrics are unique per (user_id, key) — this is the get-or-create lookup path domain
// Repos use before writing an entry, so they never race-create a duplicate metric for the same key.
export type FindMetricByKeyDALRequest = Pick<Metric, "userId" | "key">;

// DEV_NOTE: internal id, so this one never crosses the API boundary — it exists for the paths that
// already hold a tracker's primary_metric_id and need the metric's default_agg to read a day's
// number (Aggregation.factValue).
export type FindMetricByIdDALRequest = Pick<Metric, "userId" | "id">;

export type GetMetricsDALRequest = Pick<Metric, "userId">;

// DEV_NOTE: partial by construction — only the keys the caller actually sent are written, so an
// edit that touched the name alone can't blank the aggregation it never showed.
export type UpdateMetricDALRequest = Pick<Metric, "publicId" | "userId"> & {
  fields: Partial<Pick<MetricBase, "name" | "defaultAgg" | "defaultDirection">>;
};

export type DeleteMetricDALRequest = Pick<Metric, "publicId" | "userId">;
