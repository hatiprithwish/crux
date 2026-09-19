import type {
  TrackerApiShape,
  TrackerBreakdownRow,
  TrackerEntryApiShape,
  TrackerHeatmapDay,
  TrackerTimelineEntryApiShape,
  TrackerTodayApiShape,
  TrackerTodayStatsApiShape,
} from "./TrackersCommon";
import type { MoneyTransferComputeResult } from "./ComputeCommon";
import type { TrackerTargetApiShape } from "./TrackerTargetsCommon";
import type { ApiResponse } from "../common";

export interface CreateTrackerApiResponse extends ApiResponse {
  tracker?: TrackerApiShape;
}

export interface GetTrackerApiResponse extends ApiResponse {
  tracker?: TrackerApiShape;
}

// DEV_NOTE: answers with the updated row for the same reason create and unarchive do — the client
// swaps it into its cache instead of refetching to find out what it just wrote.
export interface UpdateTrackerApiResponse extends ApiResponse {
  tracker?: TrackerApiShape;
}

// DEV_NOTE: `today` and `todayStats` are populated only when the caller asked for it
// (?withToday=true); `trackers` is always present on success, so a list view never has to unwrap
// the heavier shape.
export interface GetTrackersApiResponse extends ApiResponse {
  trackers?: TrackerApiShape[];
  today?: TrackerTodayApiShape[];
  todayStats?: TrackerTodayStatsApiShape;
}

// DEV_NOTE: returns the whole list, re-sorted — same reasoning as WriteTrackerTargetApiResponse:
// a write that re-cuts every row's order would leave the client holding a list it now has to
// refetch to trust otherwise.
export interface ReorderTrackersApiResponse extends ApiResponse {
  trackers?: TrackerApiShape[];
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

// DEV_NOTE: today's timeline is a cross-tracker read (unlike everything else in this file, which is
// scoped to one tracker) — it backs the Today screen's ruler, not a tracker detail page.
export interface GetTrackerTimelineApiResponse extends ApiResponse {
  entries?: TrackerTimelineEntryApiShape[];
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

// DEV_NOTE: one call re-keys at most a bounded batch, so a caller loops until `remainingCount` is 0.
export interface RekeyEntryDaysApiResponse extends ApiResponse {
  rekeyedCount?: number;
  remainingCount?: number;
}

// DEV_NOTE: always the whole history, ascending by effectiveFrom, never one row — a single target
// row means nothing on its own ("300 from 1 Sept" is only a fact about September once you know
// what follows it), and the screen that reads this renders the eras between rows.
export interface GetTrackerTargetsApiResponse extends ApiResponse {
  targets?: TrackerTargetApiShape[];
}

// DEV_NOTE: answers with the full history rather than just the row written, for the same reason
// update answers with the tracker — a write here re-cuts every era around it (a row inserted
// between two others shortens the one before it), so returning one row would leave the client
// holding a list it now has to refetch to trust.
export interface WriteTrackerTargetApiResponse extends ApiResponse {
  targets?: TrackerTargetApiShape[];
}
