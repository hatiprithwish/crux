import type { MetricApiShape, MetricWithUsageApiShape } from "./MetricsCommon";
import type { ApiResponse } from "../common";

export interface CreateMetricApiResponse extends ApiResponse {
  metric?: MetricApiShape;
}

export interface GetMetricApiResponse extends ApiResponse {
  metric?: MetricApiShape;
}

// DEV_NOTE: the tracker-create form reads this to offer "reuse an existing metric" — the branch of
// ZTrackerMetricSpec that makes cross-domain aggregation reachable from the UI. Usage rides along
// because the /metrics screen has to disable delete on anything still pointed at, and a second
// round trip per metric to find that out would be one query per row.
export interface GetMetricsApiResponse extends ApiResponse {
  metrics?: MetricWithUsageApiShape[];
}

export interface UpdateMetricApiResponse extends ApiResponse {
  metric?: MetricApiShape;
}

// DEV_NOTE: carries the usage that blocked it — a bare "can't delete this" leaves the user with no
// way to find out what to detach first.
export interface DeleteMetricApiResponse extends ApiResponse {
  usage?: MetricWithUsageApiShape["usage"];
}
