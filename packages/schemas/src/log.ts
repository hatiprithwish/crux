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

  // Notes
  CreateNote = "CreateNote",
  GetNoteDetails = "GetNoteDetails",
  ListNotes = "ListNotes",
  UpdateNote = "UpdateNote",
  DeleteNote = "DeleteNote",

  // Substrate — entities
  CreateEntity = "CreateEntity",
  GetEntityDetails = "GetEntityDetails",
  GetEntities = "GetEntities",
  UpdateEntity = "UpdateEntity",
  ArchiveEntity = "ArchiveEntity",
  UnarchiveEntity = "UnarchiveEntity",
  GetEntityRollup = "GetEntityRollup",
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
  ArchiveTracker = "ArchiveTracker",
  UnarchiveTracker = "UnarchiveTracker",
  DeleteTracker = "DeleteTracker",

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
  RunCompute = "RunCompute",

  // Infra — weekly orphan scan (architecture.md §4.1)
  RunOrphanScan = "RunOrphanScan",
  OrphanRowsDetected = "OrphanRowsDetected",
}
