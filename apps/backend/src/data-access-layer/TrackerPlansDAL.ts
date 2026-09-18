import { and, asc, desc, eq, gte, inArray, isNull, lte, max } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import getDbClient from "@/db/dbClient";
import { trackerMoments, trackerPlans } from "@/db/tables";
import * as Schemas from "@app/schemas";
import AppLogger from "@/providers/logger";
import Utility from "@/utils/Utility";

export type TrackerMomentWithPlan = Schemas.TrackerMoment & {
  plan: { publicId: string; cue: string } | null;
};

export default class TrackerPlansDAL {
  private db: DrizzleD1Database;

  constructor(env: Env) {
    this.db = getDbClient(env);
  }

  // --- plans -----------------------------------------------------------------------------------

  // DEV_NOTE: appended after the tracker's existing plans — sortOrder is display order within the
  // Plans tab, independent of isPriority (which plans surface on the Today row).
  async createPlan(params: Schemas.CreateTrackerPlanDALRequest) {
    const response: Schemas.ApiResponse & { plan?: Schemas.TrackerPlan } = { isSuccess: false };

    try {
      const now = new Date();
      const [last] = await this.db
        .select({ sortOrder: max(trackerPlans.sortOrder) })
        .from(trackerPlans)
        .where(
          and(
            eq(trackerPlans.trackerId, params.trackerId),
            eq(trackerPlans.userId, params.userId),
            isNull(trackerPlans.deletedAt),
          ),
        );

      const plan = await this.db
        .insert(trackerPlans)
        .values({
          publicId: Utility.generatePublicId("tpl_"),
          userId: params.userId,
          trackerId: params.trackerId,
          cue: params.cue,
          response: params.response,
          isPriority: false,
          sortOrder: (last?.sortOrder ?? -1) + 1,
          createdAt: now,
          updatedAt: null,
        })
        .returning()
        .get();

      response.isSuccess = true;
      response.message = "Plan created successfully";
      response.plan = plan;
    } catch (error) {
      const message = "Unknown error in creating plan";
      AppLogger.error({
        category: Schemas.LogCategory.DAL,
        action: Schemas.LogAction.CreateTrackerPlan,
        message,
        error,
        metadata: params,
      });
      response.message = message;
    }

    return response;
  }

  async getPlans(params: Schemas.GetTrackerPlansDALRequest) {
    const response: Schemas.ApiResponse & { plans?: Schemas.TrackerPlan[] } = {
      isSuccess: false,
    };

    try {
      const plans = await this.db
        .select()
        .from(trackerPlans)
        .where(
          and(
            eq(trackerPlans.trackerId, params.trackerId),
            eq(trackerPlans.userId, params.userId),
            isNull(trackerPlans.deletedAt),
          ),
        )
        .orderBy(asc(trackerPlans.sortOrder), asc(trackerPlans.id));

      response.isSuccess = true;
      response.message = "Plans fetched successfully";
      response.plans = plans;
    } catch (error) {
      const message = "Unknown error in listing plans";
      AppLogger.error({
        category: Schemas.LogCategory.DAL,
        action: Schemas.LogAction.GetTrackerPlans,
        message,
        error,
        metadata: params,
      });
      response.message = message;
    }

    return response;
  }

  // DEV_NOTE: the Today screen's batch read — N trackers must not become N queries. Chunked for
  // D1's bound-parameter cap.
  async getPlansForTrackers(params: Schemas.GetTrackerPlansForTrackersDALRequest) {
    const response: Schemas.ApiResponse & { plans?: Schemas.TrackerPlan[] } = {
      isSuccess: false,
    };

    if (params.trackerIds.length === 0) {
      response.isSuccess = true;
      response.message = "Plans fetched successfully";
      response.plans = [];
      return response;
    }

    try {
      const plans: Schemas.TrackerPlan[] = [];
      for (const ids of Utility.chunk(params.trackerIds)) {
        const rows = await this.db
          .select()
          .from(trackerPlans)
          .where(
            and(
              eq(trackerPlans.userId, params.userId),
              inArray(trackerPlans.trackerId, ids),
              isNull(trackerPlans.deletedAt),
            ),
          )
          .orderBy(asc(trackerPlans.sortOrder), asc(trackerPlans.id));
        plans.push(...rows);
      }

      response.isSuccess = true;
      response.message = "Plans fetched successfully";
      response.plans = plans;
    } catch (error) {
      const message = "Unknown error in listing plans for trackers";
      AppLogger.error({
        category: Schemas.LogCategory.DAL,
        action: Schemas.LogAction.GetTrackerPlans,
        message,
        error,
        metadata: params,
      });
      response.message = message;
    }

    return response;
  }

  async getPlan(params: Schemas.FindTrackerPlanDALRequest) {
    const response: Schemas.ApiResponse & { plan?: Schemas.TrackerPlan } = { isSuccess: false };

    try {
      const [plan] = await this.db
        .select()
        .from(trackerPlans)
        .where(
          and(
            eq(trackerPlans.publicId, params.publicId),
            eq(trackerPlans.trackerId, params.trackerId),
            eq(trackerPlans.userId, params.userId),
            isNull(trackerPlans.deletedAt),
          ),
        )
        .limit(1);

      if (!plan) {
        const message = "Plan not found";
        AppLogger.error({
          category: Schemas.LogCategory.DAL,
          action: Schemas.LogAction.GetTrackerPlans,
          message,
          metadata: params,
        });
        response.message = message;
        return response;
      }

      response.isSuccess = true;
      response.message = "Plan fetched successfully";
      response.plan = plan;
    } catch (error) {
      const message = "Unknown error in fetching plan";
      AppLogger.error({
        category: Schemas.LogCategory.DAL,
        action: Schemas.LogAction.GetTrackerPlans,
        message,
        error,
        metadata: params,
      });
      response.message = message;
    }

    return response;
  }

  async updatePlan(params: Schemas.UpdateTrackerPlanDALRequest) {
    const response: Schemas.ApiResponse & { plan?: Schemas.TrackerPlan } = { isSuccess: false };

    try {
      const now = new Date();
      const plan = await this.db
        .update(trackerPlans)
        .set({ ...params.fields, updatedAt: now })
        .where(
          and(
            eq(trackerPlans.publicId, params.publicId),
            eq(trackerPlans.trackerId, params.trackerId),
            eq(trackerPlans.userId, params.userId),
            isNull(trackerPlans.deletedAt),
          ),
        )
        .returning()
        .get();

      if (!plan) {
        const message = "Plan not found";
        AppLogger.error({
          category: Schemas.LogCategory.DAL,
          action: Schemas.LogAction.UpdateTrackerPlan,
          message,
          metadata: params,
        });
        response.message = message;
        return response;
      }

      response.isSuccess = true;
      response.message = "Plan updated successfully";
      response.plan = plan;
    } catch (error) {
      const message = "Unknown error in updating plan";
      AppLogger.error({
        category: Schemas.LogCategory.DAL,
        action: Schemas.LogAction.UpdateTrackerPlan,
        message,
        error,
        metadata: params,
      });
      response.message = message;
    }

    return response;
  }

  // DEV_NOTE: soft delete only (invariant 9). Moments that pointed at the plan keep their plan_id,
  // and getMoments still resolves its cue, so past records don't lose what they were about.
  async deletePlan(params: Schemas.FindTrackerPlanDALRequest) {
    const response: Schemas.ApiResponse = { isSuccess: false };

    try {
      const now = new Date();
      const deleted = await this.db
        .update(trackerPlans)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(
            eq(trackerPlans.publicId, params.publicId),
            eq(trackerPlans.trackerId, params.trackerId),
            eq(trackerPlans.userId, params.userId),
            isNull(trackerPlans.deletedAt),
          ),
        )
        .returning()
        .get();

      if (!deleted) {
        const message = "Plan not found";
        AppLogger.error({
          category: Schemas.LogCategory.DAL,
          action: Schemas.LogAction.DeleteTrackerPlan,
          message,
          metadata: params,
        });
        response.message = message;
        return response;
      }

      response.isSuccess = true;
      response.message = "Plan deleted successfully";
    } catch (error) {
      const message = "Unknown error in deleting plan";
      AppLogger.error({
        category: Schemas.LogCategory.DAL,
        action: Schemas.LogAction.DeleteTrackerPlan,
        message,
        error,
        metadata: params,
      });
      response.message = message;
    }

    return response;
  }

  // --- moments ---------------------------------------------------------------------------------

  async createMoment(params: Schemas.CreateTrackerMomentDALRequest) {
    const response: Schemas.ApiResponse & { moment?: Schemas.TrackerMoment } = {
      isSuccess: false,
    };

    try {
      const now = new Date();
      const moment = await this.db
        .insert(trackerMoments)
        .values({
          publicId: Utility.generatePublicId("tmo_"),
          userId: params.userId,
          trackerId: params.trackerId,
          planId: params.planId,
          momentOutcome: params.momentOutcome,
          localDate: params.localDate,
          occurredAt: now,
          note: params.note,
          createdAt: now,
          updatedAt: null,
        })
        .returning()
        .get();

      response.isSuccess = true;
      response.message = "Moment recorded successfully";
      response.moment = moment;
    } catch (error) {
      const message = "Unknown error in recording moment";
      AppLogger.error({
        category: Schemas.LogCategory.DAL,
        action: Schemas.LogAction.CreateTrackerMoment,
        message,
        error,
        metadata: params,
      });
      response.message = message;
    }

    return response;
  }

  // DEV_NOTE: left join without a deleted_at filter on the plan side — a moment about a trigger the
  // user has since removed still reads as that trigger, not as "unknown".
  async getMoments(params: Schemas.GetTrackerMomentsDALRequest) {
    const response: Schemas.ApiResponse & { moments?: TrackerMomentWithPlan[] } = {
      isSuccess: false,
    };

    try {
      const rows = await this.db
        .select({
          moment: trackerMoments,
          planPublicId: trackerPlans.publicId,
          planCue: trackerPlans.cue,
        })
        .from(trackerMoments)
        .leftJoin(trackerPlans, eq(trackerPlans.id, trackerMoments.planId))
        .where(
          and(
            eq(trackerMoments.trackerId, params.trackerId),
            eq(trackerMoments.userId, params.userId),
            gte(trackerMoments.localDate, params.dateFrom),
            lte(trackerMoments.localDate, params.dateTo),
            isNull(trackerMoments.deletedAt),
          ),
        )
        .orderBy(desc(trackerMoments.occurredAt));

      response.isSuccess = true;
      response.message = "Moments fetched successfully";
      response.moments = rows.map((row) => ({
        ...row.moment,
        plan:
          row.planPublicId !== null && row.planCue !== null
            ? { publicId: row.planPublicId, cue: row.planCue }
            : null,
      }));
    } catch (error) {
      const message = "Unknown error in listing moments";
      AppLogger.error({
        category: Schemas.LogCategory.DAL,
        action: Schemas.LogAction.GetTrackerMoments,
        message,
        error,
        metadata: params,
      });
      response.message = message;
    }

    return response;
  }

  async deleteMoment(params: Schemas.DeleteTrackerMomentDALRequest) {
    const response: Schemas.ApiResponse = { isSuccess: false };

    try {
      const now = new Date();
      const deleted = await this.db
        .update(trackerMoments)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(
            eq(trackerMoments.publicId, params.publicId),
            eq(trackerMoments.trackerId, params.trackerId),
            eq(trackerMoments.userId, params.userId),
            isNull(trackerMoments.deletedAt),
          ),
        )
        .returning()
        .get();

      if (!deleted) {
        const message = "Moment not found";
        AppLogger.error({
          category: Schemas.LogCategory.DAL,
          action: Schemas.LogAction.DeleteTrackerMoment,
          message,
          metadata: params,
        });
        response.message = message;
        return response;
      }

      response.isSuccess = true;
      response.message = "Moment deleted successfully";
    } catch (error) {
      const message = "Unknown error in deleting moment";
      AppLogger.error({
        category: Schemas.LogCategory.DAL,
        action: Schemas.LogAction.DeleteTrackerMoment,
        message,
        error,
        metadata: params,
      });
      response.message = message;
    }

    return response;
  }
}
