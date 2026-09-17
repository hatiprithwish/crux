import type { TrackerMomentApiShape, TrackerPlanApiShape } from "./TrackerPlansCommon";
import type { ApiResponse } from "../common";

// DEV_NOTE: every plan write answers with the tracker's whole ordered list — a create, delete or
// reorder all re-cut which plan is first, and the first one is what the Today row shows.
export interface GetTrackerPlansApiResponse extends ApiResponse {
  plans?: TrackerPlanApiShape[];
}

export interface WriteTrackerPlansApiResponse extends ApiResponse {
  plans?: TrackerPlanApiShape[];
}

export interface GetTrackerMomentsApiResponse extends ApiResponse {
  moments?: TrackerMomentApiShape[];
}

// DEV_NOTE: `plans` is present because a moment can create a plan inline (newCue) — the capture
// sheet's chips must show it next time without a refetch.
export interface CreateTrackerMomentApiResponse extends ApiResponse {
  moment?: TrackerMomentApiShape;
  plans?: TrackerPlanApiShape[];
}
