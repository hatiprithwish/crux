import type { MetricApiShape } from "./MetricsCommon";
import type { ApiResponse } from "../common";

export interface CreateMetricApiResponse extends ApiResponse {
  metric?: MetricApiShape;
}

export interface GetMetricApiResponse extends ApiResponse {
  metric?: MetricApiShape;
}

// DEV_NOTE: the tracker-create form reads this to offer "reuse an existing metric" — the branch of
// ZTrackerMetricSpec that makes cross-domain aggregation reachable from the UI.
export interface GetMetricsApiResponse extends ApiResponse {
  metrics?: MetricApiShape[];
}
