import { and, eq, isNull } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import getDbClient from "@/db/dbClient";
import { metrics } from "@/db/tables";
import * as Schemas from "@app/schemas";
import AppLogger from "@/providers/logger";
import Utility from "@/utils/Utility";

export default class MetricsDAL {
  private db: DrizzleD1Database;

  constructor(env: Env) {
    this.db = getDbClient(env);
  }

  async createMetric(params: Schemas.CreateMetricDALRequest) {
    const response: Schemas.ApiResponse & { metric?: Schemas.Metric } = { isSuccess: false };

    try {
      const now = new Date();
      const metricResponse = await this.db
        .insert(metrics)
        .values({
          publicId: Utility.generatePublicId("met_"),
          userId: params.userId,
          key: params.key,
          name: params.name,
          semanticType: params.semanticType,
          canonicalUnit: params.canonicalUnit,
          defaultAgg: params.defaultAgg,
          direction: params.direction,
          dateAttribution: params.dateAttribution,
          createdAt: now,
          updatedAt: null,
        })
        .returning()
        .get();

      response.isSuccess = true;
      response.message = "Metric created successfully";
      response.metric = metricResponse;
    } catch (error) {
      const message = "Unknown error in creating metric";
      AppLogger.error({
        category: Schemas.LogCategory.DAL,
        action: Schemas.LogAction.CreateMetric,
        message,
        error,
        metadata: params,
      });
      response.message = message;
    }

    return response;
  }

  async getMetric(params: Schemas.FindMetricDALRequest) {
    const response: Schemas.ApiResponse & { metric?: Schemas.Metric } = { isSuccess: false };

    try {
      const [metric] = await this.db
        .select()
        .from(metrics)
        .where(
          and(
            eq(metrics.publicId, params.publicId),
            eq(metrics.userId, params.userId),
            isNull(metrics.deletedAt),
          ),
        )
        .limit(1);

      if (!metric) {
        const message = "Metric not found";
        AppLogger.error({
          category: Schemas.LogCategory.DAL,
          action: Schemas.LogAction.GetMetricDetails,
          message,
          metadata: params,
        });
        response.message = message;
        return response;
      }

      response.isSuccess = true;
      response.message = "Metric fetched successfully";
      response.metric = metric;
    } catch (error) {
      const message = "Unknown error in fetching metric";
      AppLogger.error({
        category: Schemas.LogCategory.DAL,
        action: Schemas.LogAction.GetMetricDetails,
        message,
        error,
        metadata: params,
      });
      response.message = message;
    }

    return response;
  }

  // DEV_NOTE: metrics are unique per (user_id, key) — the get-or-create lookup domain Repos use
  // before writing an entry, so they never race-create a duplicate metric for the same key.
  async getMetricByKey(params: Schemas.FindMetricByKeyDALRequest) {
    const response: Schemas.ApiResponse & { metric?: Schemas.Metric } = { isSuccess: false };

    try {
      const [metric] = await this.db
        .select()
        .from(metrics)
        .where(
          and(
            eq(metrics.userId, params.userId),
            eq(metrics.key, params.key),
            isNull(metrics.deletedAt),
          ),
        )
        .limit(1);

      response.isSuccess = true;
      response.message = metric ? "Metric fetched successfully" : "Metric not found";
      response.metric = metric;
    } catch (error) {
      const message = "Unknown error in fetching metric by key";
      AppLogger.error({
        category: Schemas.LogCategory.DAL,
        action: Schemas.LogAction.GetMetricDetails,
        message,
        error,
        metadata: params,
      });
      response.message = message;
    }

    return response;
  }

  async getMetrics(params: Schemas.GetMetricsDALRequest) {
    const response: Schemas.ApiResponse & { metrics?: Schemas.Metric[] } = { isSuccess: false };

    try {
      const metricsResponse = await this.db
        .select()
        .from(metrics)
        .where(and(eq(metrics.userId, params.userId), isNull(metrics.deletedAt)));

      response.isSuccess = true;
      response.message = "Metrics fetched successfully";
      response.metrics = metricsResponse;
    } catch (error) {
      const message = "Unknown error in listing metrics";
      AppLogger.error({
        category: Schemas.LogCategory.DAL,
        action: Schemas.LogAction.GetMetrics,
        message,
        error,
        metadata: params,
      });
      response.message = message;
    }

    return response;
  }
}
