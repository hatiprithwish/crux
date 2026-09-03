import type { Tracker, TrackerBase } from "./TrackersCommon";

export type CreateTrackerDALRequest = TrackerBase & Pick<Tracker, "userId"> & { metricId: number };

// Params to find a tracker by its public ID and user ID (for authorization)
export type FindTrackerDALRequest = Pick<Tracker, "publicId" | "userId">;

export type GetTrackersDALRequest = Pick<Tracker, "userId">;
