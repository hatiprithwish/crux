import { and, count, eq, isNull } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import getDbClient from "@/db/dbClient";
import { entryValues, metrics, trackers } from "@/db/tables";
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

  // DEV_NOTE: two grouped queries for the whole list, not one pair per metric — a user with thirty
  // metrics would otherwise cost sixty round trips to render one screen. Both scans are index-backed
  // (IDX_entry_values_metric_id; trackers' user_id index narrows before the group).
  async getMetricsUsage(params: Schemas.GetMetricsDALRequest) {
    const response: Schemas.ApiResponse & { usage?: Map<number, Schemas.MetricUsage> } = {
      isSuccess: false,
    };

    try {
      const trackerCounts = await this.db
        .select({ metricId: trackers.primaryMetricId, total: count() })
        .from(trackers)
        .where(and(eq(trackers.userId, params.userId), isNull(trackers.deletedAt)))
        .groupBy(trackers.primaryMetricId);

      // DEV_NOTE: joined through metrics rather than filtered on entry_values alone — entry_values
      // has no user_id of its own, and counting another user's readings would be a data leak.
      const entryCounts = await this.db
        .select({ metricId: entryValues.metricId, total: count() })
        .from(entryValues)
        .innerJoin(metrics, eq(metrics.id, entryValues.metricId))
        .where(and(eq(metrics.userId, params.userId), isNull(metrics.deletedAt)))
        .groupBy(entryValues.metricId);

      const usage = new Map<number, Schemas.MetricUsage>();
      for (const row of trackerCounts) {
        usage.set(row.metricId, { trackerCount: row.total, entryCount: 0 });
      }
      for (const row of entryCounts) {
        const existing = usage.get(row.metricId);
        if (existing) existing.entryCount = row.total;
        else usage.set(row.metricId, { trackerCount: 0, entryCount: row.total });
      }

      response.isSuccess = true;
      response.message = "Metrics usage fetched successfully";
      response.usage = usage;
    } catch (error) {
      const message = "Unknown error in fetching metrics usage";
      AppLogger.error({
        category: Schemas.LogCategory.DAL,
        action: Schemas.LogAction.GetMetricsUsage,
        message,
        error,
        metadata: params,
      });
      response.message = message;
    }

    return response;
  }

  async updateMetric(params: Schemas.UpdateMetricDALRequest) {
    const response: Schemas.ApiResponse & { metric?: Schemas.Metric } = { isSuccess: false };

    try {
      const now = new Date();
      const metricResponse = await this.db
        .update(metrics)
        .set({ ...params.fields, updatedAt: now })
        .where(
          and(
            eq(metrics.publicId, params.publicId),
            eq(metrics.userId, params.userId),
            isNull(metrics.deletedAt),
          ),
        )
        .returning()
        .get();

      if (!metricResponse) {
        const message = "Metric not found";
        AppLogger.error({
          category: Schemas.LogCategory.DAL,
          action: Schemas.LogAction.UpdateMetric,
          message,
          metadata: params,
        });
        response.message = message;
        return response;
      }

      response.isSuccess = true;
      response.message = "Metric updated successfully";
      response.metric = metricResponse;
    } catch (error) {
      const message = "Unknown error in updating metric";
      AppLogger.error({
        category: Schemas.LogCategory.DAL,
        action: Schemas.LogAction.UpdateMetric,
        message,
        error,
        metadata: params,
      });
      response.message = message;
    }

    return response;
  }

  // DEV_NOTE: invariant 9 — soft delete only. No hard deletes, ever. The key stays occupied in the
  // unique (user_id, key) index afterwards, which is deliberate: a deleted metric's readings are
  // still on disk, and letting a new metric claim the same key would silently adopt them.
  async deleteMetric(params: Schemas.DeleteMetricDALRequest) {
    const response: Schemas.ApiResponse = { isSuccess: false };

    try {
      const now = new Date();
      const deleted = await this.db
        .update(metrics)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(
            eq(metrics.publicId, params.publicId),
            eq(metrics.userId, params.userId),
            isNull(metrics.deletedAt),
          ),
        )
        .returning()
        .get();

      if (!deleted) {
        const message = "Metric not found";
        AppLogger.error({
          category: Schemas.LogCategory.DAL,
          action: Schemas.LogAction.DeleteMetric,
          message,
          metadata: params,
        });
        response.message = message;
        return response;
      }

      response.isSuccess = true;
      response.message = "Metric deleted successfully";
    } catch (error) {
      const message = "Unknown error in deleting metric";
      AppLogger.error({
        category: Schemas.LogCategory.DAL,
        action: Schemas.LogAction.DeleteMetric,
        message,
        error,
        metadata: params,
      });
      response.message = message;
    }

    return response;
  }
}
