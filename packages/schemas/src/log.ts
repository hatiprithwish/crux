export enum LogCategory {
  Route = "Route",
  DAL = "DAL",
  Repo = "Repo",
  Middleware = "Middleware",
  DB = "DB",
}

export enum LogAction {
  // Infra
  UnhandledError = "UnhandledError",

  // Auth
  VerifyToken = "VerifyToken",
  SyncClerkUser = "SyncClerkUser",
  SignOut = "SignOut",

  // User
  GetUserDetails = "GetUserDetails",

  // Substrate — entities
  CreateEntity = "CreateEntity",
  GetEntityDetails = "GetEntityDetails",
  GetEntities = "GetEntities",
  UpdateEntity = "UpdateEntity",
  ArchiveEntity = "ArchiveEntity",
  UnarchiveEntity = "UnarchiveEntity",
  GetEntityRollup = "GetEntityRollup",
  GetEntityStats = "GetEntityStats",
  DeleteEntity = "DeleteEntity",

  // Substrate — metrics
  CreateMetric = "CreateMetric",
  GetMetricDetails = "GetMetricDetails",
  GetMetrics = "GetMetrics",
  GetMetricsUsage = "GetMetricsUsage",
  UpdateMetric = "UpdateMetric",
  DeleteMetric = "DeleteMetric",

  // Substrate — trackers
  CreateTracker = "CreateTracker",
  GetTrackerDetails = "GetTrackerDetails",
  GetTrackers = "GetTrackers",
  UpdateTracker = "UpdateTracker",
  ArchiveTracker = "ArchiveTracker",
  UnarchiveTracker = "UnarchiveTracker",
  DeleteTracker = "DeleteTracker",

  // Substrate — tracker target history (a target is a value *from a date*, not one number)
  CreateTrackerTarget = "CreateTrackerTarget",
  GetTrackerTargets = "GetTrackerTargets",
  DeleteTrackerTarget = "DeleteTrackerTarget",

  // Substrate — entries
  WriteEntry = "WriteEntry",
  GetEntries = "GetEntries",
  GetEntriesWithParts = "GetEntriesWithParts",
  DeleteEntry = "DeleteEntry",
  GetDailyFacts = "GetDailyFacts",
  UpdateEntryEndedAt = "UpdateEntryEndedAt",
  AppendEntryValue = "AppendEntryValue",
  GetOpenIntervalEntry = "GetOpenIntervalEntry",
  GetIntervalBreakdown = "GetIntervalBreakdown",
  GetDailyFactsForMetrics = "GetDailyFactsForMetrics",

  // Manifest engine — generic tracker surfaces (replaced the per-domain Habits/Money/Time actions)
  QuickAddEntry = "QuickAddEntry",
  GetTrackerHeatmap = "GetTrackerHeatmap",
  GetTrackerBreakdown = "GetTrackerBreakdown",
  GetTrackerTimeline = "GetTrackerTimeline",
  RunCompute = "RunCompute",

  // Infra — weekly orphan scan (architecture.md §4.1)
  RunOrphanScan = "RunOrphanScan",
  OrphanRowsDetected = "OrphanRowsDetected",
}
