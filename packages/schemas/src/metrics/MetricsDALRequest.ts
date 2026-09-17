import type { Metric, MetricBase } from "./MetricsCommon";

export type CreateMetricDALRequest = MetricBase;

export type FindMetricDALRequest = Pick<Metric, "publicId">;

// DEV_NOTE: metrics are unique on `key` — the get-or-create lookup the tracker form's "new metric"
// branch uses so a second tracker naming the same key reuses the row instead of racing a duplicate.
export type FindMetricByKeyDALRequest = Pick<Metric, "key">;

// DEV_NOTE: internal id, so this one never crosses the API boundary — it exists for the paths that
// already hold a tracker's primary_metric_id and need the metric's default_agg to read a day's
// number (Aggregation.factValue).
export type FindMetricByIdDALRequest = Pick<Metric, "id">;

// DEV_NOTE: usage is still per user even though the metric is global — "is anything of mine still
// pointing at this" is the question the delete guard asks.
export type GetMetricsUsageDALRequest = { userId: string };

// DEV_NOTE: partial by construction — only the keys the caller actually sent are written, so an
// edit that touched the name alone can't blank the aggregation it never showed.
export type UpdateMetricDALRequest = Pick<Metric, "publicId"> & {
  fields: Partial<Pick<MetricBase, "name" | "defaultAgg" | "defaultDirection">>;
};

export type DeleteMetricDALRequest = Pick<Metric, "publicId">;
