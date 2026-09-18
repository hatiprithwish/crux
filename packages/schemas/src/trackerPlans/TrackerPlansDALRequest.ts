import type { TrackerMoment, TrackerPlan, TrackerPlanBase } from "./TrackerPlansCommon";

export type CreateTrackerPlanDALRequest = TrackerPlanBase &
  Pick<TrackerPlan, "userId" | "trackerId">;

export type UpdateTrackerPlanDALRequest = Pick<TrackerPlan, "userId" | "trackerId" | "publicId"> & {
  fields: Partial<TrackerPlanBase & Pick<TrackerPlan, "isPriority">>;
};

export type FindTrackerPlanDALRequest = Pick<TrackerPlan, "userId" | "trackerId" | "publicId">;

export type GetTrackerPlansDALRequest = Pick<TrackerPlan, "userId" | "trackerId">;

export type GetTrackerPlansForTrackersDALRequest = Pick<TrackerPlan, "userId"> & {
  trackerIds: number[];
};

export type ReorderTrackerPlansDALRequest = Pick<TrackerPlan, "userId"> & {
  order: { id: number; sortOrder: number }[];
};

export type CreateTrackerMomentDALRequest = Pick<
  TrackerMoment,
  "userId" | "trackerId" | "planId" | "momentOutcome" | "localDate" | "note"
>;

export type GetTrackerMomentsDALRequest = Pick<TrackerMoment, "userId" | "trackerId"> & {
  dateFrom: string;
  dateTo: string;
};

export type DeleteTrackerMomentDALRequest = Pick<
  TrackerMoment,
  "userId" | "trackerId" | "publicId"
>;
