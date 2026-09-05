import MetricsDAL from "@/data-access-layer/MetricsDAL";
import type * as Schemas from "@app/schemas";

// DEV_NOTE: metrics had no HTTP surface while every domain created its own behind the scenes. The
// manifest engine's "reuse an existing metric" branch (ZTrackerMetricSpec) needs one — that's the
// branch that lets two trackers roll into a single number (architecture.md §6), and it's
// unreachable from the UI without a list to pick from.
export default class MetricsRepo {
  private metricsDal: MetricsDAL;

  constructor(env: Env) {
    this.metricsDal = new MetricsDAL(env);
  }

  private toApiShape(metric: Schemas.Metric): Schemas.MetricApiShape {
    const { id: _id, deletedAt: _deletedAt, ...rest } = metric;
    return rest;
  }

  async createMetric(
    params: Schemas.CreateMetricApiRequest & { userId: string },
  ): Promise<Schemas.CreateMetricApiResponse> {
    const existing = await this.metricsDal.getMetricByKey({
      userId: params.userId,
      key: params.metric.key,
    });
    if (existing.isSuccess && existing.metric) {
      return { isSuccess: false, message: `Metric "${params.metric.key}" already exists` };
    }

    const result = await this.metricsDal.createMetric({ ...params.metric, userId: params.userId });
    if (!result.isSuccess || !result.metric) {
      return { isSuccess: false, message: result.message };
    }

    return {
      isSuccess: true,
      message: "Metric created successfully",
      metric: this.toApiShape(result.metric),
    };
  }

  async getMetrics(params: { userId: string }): Promise<Schemas.GetMetricsApiResponse> {
    const result = await this.metricsDal.getMetrics(params);
    if (!result.isSuccess || !result.metrics) {
      return { isSuccess: false, message: result.message };
    }

    const usageResult = await this.metricsDal.getMetricsUsage(params);
    if (!usageResult.isSuccess || !usageResult.usage) {
      return { isSuccess: false, message: usageResult.message };
    }
    const usageByMetricId = usageResult.usage;

    return {
      isSuccess: true,
      message: "Metrics fetched successfully",
      metrics: result.metrics.map((metric) => ({
        ...this.toApiShape(metric),
        // DEV_NOTE: a metric nothing points at yet is absent from the grouped counts, not zero in
        // them — the map miss is the zero.
        usage: usageByMetricId.get(metric.id) ?? { trackerCount: 0, entryCount: 0 },
      })),
    };
  }

  async updateMetric(
    params: Schemas.UpdateMetricApiRequest & { userId: string; publicId: string },
  ): Promise<Schemas.UpdateMetricApiResponse> {
    const fields: Schemas.UpdateMetricDALRequest["fields"] = {};
    if (params.metric.name !== undefined) fields.name = params.metric.name;
    if (params.metric.defaultAgg !== undefined) fields.defaultAgg = params.metric.defaultAgg;
    if (params.metric.direction !== undefined) fields.direction = params.metric.direction;

    const result = await this.metricsDal.updateMetric({
      userId: params.userId,
      publicId: params.publicId,
      fields,
    });
    if (!result.isSuccess || !result.metric) {
      return { isSuccess: false, message: result.message };
    }

    return {
      isSuccess: true,
      message: "Metric updated successfully",
      metric: this.toApiShape(result.metric),
    };
  }

  // DEV_NOTE: refuses while anything still points at the metric. Soft-deleting one a tracker holds
  // as its primary_metric_id would leave that tracker rendering a heatmap over a metric the list
  // endpoint no longer returns, and the readings already written against it would become
  // unreachable rather than deleted. Detach first, then delete — the counts come back with the
  // refusal so the user knows what to detach.
  async deleteMetric(params: {
    userId: string;
    publicId: string;
  }): Promise<Schemas.DeleteMetricApiResponse> {
    const existing = await this.metricsDal.getMetric(params);
    if (!existing.isSuccess || !existing.metric) {
      return { isSuccess: false, message: existing.message ?? "Metric not found" };
    }

    const usageResult = await this.metricsDal.getMetricsUsage({ userId: params.userId });
    if (!usageResult.isSuccess || !usageResult.usage) {
      return { isSuccess: false, message: usageResult.message };
    }

    const usage = usageResult.usage.get(existing.metric.id) ?? { trackerCount: 0, entryCount: 0 };
    if (usage.trackerCount > 0 || usage.entryCount > 0) {
      return {
        isSuccess: false,
        message: `Metric is still in use by ${usage.trackerCount} tracker(s) and has ${usage.entryCount} reading(s)`,
        usage,
      };
    }

    const result = await this.metricsDal.deleteMetric(params);
    if (!result.isSuccess) {
      return { isSuccess: false, message: result.message };
    }

    return { isSuccess: true, message: "Metric deleted successfully" };
  }
}
