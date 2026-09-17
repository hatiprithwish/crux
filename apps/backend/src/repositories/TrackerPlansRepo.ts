import TrackerPlansDAL, { type TrackerMomentWithPlan } from "@/data-access-layer/TrackerPlansDAL";
import TrackersDAL from "@/data-access-layer/TrackersDAL";
import { utcDateString } from "@/utils/DateTime";
import * as Schemas from "@app/schemas";

// DEV_NOTE: plans and moments are children of a tracker, so every method resolves the tracker by
// (userId, publicId) first — that lookup is the ownership check, and it turns the client's publicId
// into the internal id the child tables are keyed on.
export default class TrackerPlansRepo {
  private trackerPlansDal: TrackerPlansDAL;
  private trackersDal: TrackersDAL;

  constructor(env: Env) {
    this.trackerPlansDal = new TrackerPlansDAL(env);
    this.trackersDal = new TrackersDAL(env);
  }

  toPlanApiShape(plan: Schemas.TrackerPlan): Schemas.TrackerPlanApiShape {
    const {
      id: _id,
      userId: _userId,
      trackerId: _trackerId,
      deletedAt: _deletedAt,
      ...rest
    } = plan;
    return rest;
  }

  private withOutcomeLabel(moment: TrackerMomentWithPlan): Schemas.TrackerMomentApiShape {
    const {
      id: _id,
      userId: _userId,
      trackerId: _trackerId,
      planId: _planId,
      deletedAt: _deletedAt,
      ...rest
    } = moment;
    return {
      ...rest,
      momentOutcomeLabel: Schemas.TRACKER_MOMENT_OUTCOME_LABEL_MAP[moment.momentOutcome],
    };
  }

  private async resolveTracker(userId: string, publicId: string) {
    const result = await this.trackersDal.getTracker({ userId, publicId });
    return { tracker: result.tracker ?? null, message: result.message };
  }

  private async listPlans(
    userId: string,
    trackerId: number,
    message: string,
  ): Promise<Schemas.WriteTrackerPlansApiResponse> {
    const result = await this.trackerPlansDal.getPlans({ userId, trackerId });
    if (!result.isSuccess) return { isSuccess: false, message: result.message };

    return {
      isSuccess: true,
      message,
      plans: (result.plans ?? []).map((plan) => this.toPlanApiShape(plan)),
    };
  }

  // --- plans -----------------------------------------------------------------------------------

  async getPlans(params: {
    userId: string;
    trackerPublicId: string;
  }): Promise<Schemas.GetTrackerPlansApiResponse> {
    const { tracker, message } = await this.resolveTracker(params.userId, params.trackerPublicId);
    if (!tracker) return { isSuccess: false, message };

    return this.listPlans(params.userId, tracker.id, "Plans fetched successfully");
  }

  async createPlan(
    params: Schemas.CreateTrackerPlanApiRequest & { userId: string; trackerPublicId: string },
  ): Promise<Schemas.WriteTrackerPlansApiResponse> {
    const { tracker, message } = await this.resolveTracker(params.userId, params.trackerPublicId);
    if (!tracker) return { isSuccess: false, message };

    const created = await this.trackerPlansDal.createPlan({
      userId: params.userId,
      trackerId: tracker.id,
      cue: params.plan.cue,
      response: params.plan.response,
    });
    if (!created.isSuccess) return { isSuccess: false, message: created.message };

    return this.listPlans(params.userId, tracker.id, "Plan created successfully");
  }

  async updatePlan(
    params: Schemas.UpdateTrackerPlanApiRequest & {
      userId: string;
      trackerPublicId: string;
      planPublicId: string;
    },
  ): Promise<Schemas.WriteTrackerPlansApiResponse> {
    const { tracker, message } = await this.resolveTracker(params.userId, params.trackerPublicId);
    if (!tracker) return { isSuccess: false, message };

    const updated = await this.trackerPlansDal.updatePlan({
      userId: params.userId,
      trackerId: tracker.id,
      publicId: params.planPublicId,
      fields: params.plan,
    });
    if (!updated.isSuccess) return { isSuccess: false, message: updated.message };

    return this.listPlans(params.userId, tracker.id, "Plan updated successfully");
  }

  async deletePlan(params: {
    userId: string;
    trackerPublicId: string;
    planPublicId: string;
  }): Promise<Schemas.WriteTrackerPlansApiResponse> {
    const { tracker, message } = await this.resolveTracker(params.userId, params.trackerPublicId);
    if (!tracker) return { isSuccess: false, message };

    const deleted = await this.trackerPlansDal.deletePlan({
      userId: params.userId,
      trackerId: tracker.id,
      publicId: params.planPublicId,
    });
    if (!deleted.isSuccess) return { isSuccess: false, message: deleted.message };

    return this.listPlans(params.userId, tracker.id, "Plan deleted successfully");
  }

  async reorderPlans(
    params: Schemas.ReorderTrackerPlansApiRequest & { userId: string; trackerPublicId: string },
  ): Promise<Schemas.WriteTrackerPlansApiResponse> {
    const { tracker, message } = await this.resolveTracker(params.userId, params.trackerPublicId);
    if (!tracker) return { isSuccess: false, message };

    const existing = await this.trackerPlansDal.getPlans({
      userId: params.userId,
      trackerId: tracker.id,
    });
    if (!existing.isSuccess || !existing.plans) {
      return { isSuccess: false, message: existing.message };
    }

    const byPublicId = new Map(existing.plans.map((plan) => [plan.publicId, plan]));
    const isCompleteReorder =
      params.planPublicIds.length === byPublicId.size &&
      new Set(params.planPublicIds).size === byPublicId.size &&
      params.planPublicIds.every((publicId) => byPublicId.has(publicId));
    if (!isCompleteReorder) {
      return { isSuccess: false, message: "Reorder must include every plan exactly once" };
    }

    const reordered = await this.trackerPlansDal.reorderPlans({
      userId: params.userId,
      order: params.planPublicIds.map((publicId, index) => ({
        id: (byPublicId.get(publicId) as Schemas.TrackerPlan).id,
        sortOrder: index,
      })),
    });
    if (!reordered.isSuccess) return { isSuccess: false, message: reordered.message };

    return this.listPlans(params.userId, tracker.id, "Plans reordered successfully");
  }

  // --- moments ---------------------------------------------------------------------------------

  async getMoments(params: {
    userId: string;
    trackerPublicId: string;
    dateFrom: string;
    dateTo: string;
  }): Promise<Schemas.GetTrackerMomentsApiResponse> {
    const { tracker, message } = await this.resolveTracker(params.userId, params.trackerPublicId);
    if (!tracker) return { isSuccess: false, message };

    const result = await this.trackerPlansDal.getMoments({
      userId: params.userId,
      trackerId: tracker.id,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
    });
    if (!result.isSuccess) return { isSuccess: false, message: result.message };

    return {
      isSuccess: true,
      message: result.message,
      moments: (result.moments ?? []).map((moment) => this.withOutcomeLabel(moment)),
    };
  }

  // DEV_NOTE: a moment is always "now" — it is captured while the trigger is firing, and the UTC
  // day matches how entries.local_date is resolved (see TrackersRepo's APP_TZ note).
  async createMoment(
    params: Schemas.CreateTrackerMomentApiRequest & { userId: string; trackerPublicId: string },
  ): Promise<Schemas.CreateTrackerMomentApiResponse> {
    const { tracker, message } = await this.resolveTracker(params.userId, params.trackerPublicId);
    if (!tracker) return { isSuccess: false, message };
    if (tracker.archivedAt) return { isSuccess: false, message: "Tracker is archived" };

    let plan: Schemas.TrackerPlan | null = null;
    if (params.moment.planPublicId) {
      const found = await this.trackerPlansDal.getPlan({
        userId: params.userId,
        trackerId: tracker.id,
        publicId: params.moment.planPublicId,
      });
      if (!found.isSuccess || !found.plan) return { isSuccess: false, message: found.message };
      plan = found.plan;
    } else if (params.moment.newCue) {
      const created = await this.trackerPlansDal.createPlan({
        userId: params.userId,
        trackerId: tracker.id,
        cue: params.moment.newCue,
        response: null,
      });
      if (!created.isSuccess || !created.plan) {
        return { isSuccess: false, message: created.message };
      }
      plan = created.plan;
    }

    const written = await this.trackerPlansDal.createMoment({
      userId: params.userId,
      trackerId: tracker.id,
      planId: plan?.id ?? null,
      momentOutcome: params.moment.momentOutcome,
      localDate: utcDateString(new Date()),
      note: params.moment.note ?? null,
    });
    if (!written.isSuccess || !written.moment) {
      return { isSuccess: false, message: written.message };
    }

    const plans = await this.listPlans(params.userId, tracker.id, written.message ?? "");
    if (!plans.isSuccess) return { isSuccess: false, message: plans.message };

    return {
      isSuccess: true,
      message: written.message,
      moment: this.withOutcomeLabel({
        ...written.moment,
        plan: plan ? { publicId: plan.publicId, cue: plan.cue } : null,
      }),
      plans: plans.plans,
    };
  }

  async deleteMoment(params: {
    userId: string;
    trackerPublicId: string;
    momentPublicId: string;
  }): Promise<Schemas.ApiResponse> {
    const { tracker, message } = await this.resolveTracker(params.userId, params.trackerPublicId);
    if (!tracker) return { isSuccess: false, message };

    return this.trackerPlansDal.deleteMoment({
      userId: params.userId,
      trackerId: tracker.id,
      publicId: params.momentPublicId,
    });
  }
}
