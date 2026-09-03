import type {
  TrackerApiShape,
  TrackerBreakdownRow,
  TrackerEntryApiShape,
  TrackerHeatmapDay,
  TrackerTodayApiShape,
} from "./TrackersCommon";
import type { MoneyTransferComputeResult } from "./ComputeCommon";
import type { ApiResponse } from "../common";

export interface CreateTrackerApiResponse extends ApiResponse {
  tracker?: TrackerApiShape;
}

export interface GetTrackerApiResponse extends ApiResponse {
  tracker?: TrackerApiShape;
}

// DEV_NOTE: `today` is populated only when the caller asked for it (?withToday=true); `trackers` is
// always present on success, so a list view never has to unwrap the heavier shape.
export interface GetTrackersApiResponse extends ApiResponse {
  trackers?: TrackerApiShape[];
  today?: TrackerTodayApiShape[];
}

// DEV_NOTE: entry is absent when the quick-add cleared the day (toggle completed:false) or started
// nothing — `state` is what the widget renders off, not the presence of an entry.
export interface QuickAddApiResponse extends ApiResponse {
  entry?: TrackerEntryApiShape;
  todaySum?: number | null;
  todayCount?: number;
}

export interface GetTrackerEntriesApiResponse extends ApiResponse {
  entries?: TrackerEntryApiShape[];
}

export interface GetTrackerHeatmapApiResponse extends ApiResponse {
  days?: TrackerHeatmapDay[];
  streak?: number;
}

export interface GetTrackerBreakdownApiResponse extends ApiResponse {
  rows?: TrackerBreakdownRow[];
}

export interface GetRunningSessionApiResponse extends ApiResponse {
  session?: TrackerEntryApiShape | null;
}

// DEV_NOTE: one response type per compute module's result — a second module adds a member here, not
// a new endpoint.
export interface RunComputeApiResponse extends ApiResponse {
  transfer?: MoneyTransferComputeResult;
}

// DEV_NOTE: restoring is the inverse of archiving, so it answers with the restored row the same way
// create does — the client swaps it into the live list without refetching to find out what it got.
export interface UnarchiveTrackerApiResponse extends ApiResponse {
  tracker?: TrackerApiShape;
}

export interface UnarchiveAllTrackersApiResponse extends ApiResponse {
  restoredCount?: number;
}
