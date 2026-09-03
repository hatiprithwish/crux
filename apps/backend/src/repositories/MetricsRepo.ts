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

    return {
      isSuccess: true,
      message: "Metrics fetched successfully",
      metrics: result.metrics.map((metric) => this.toApiShape(metric)),
    };
  }
}
