import EntitiesDAL from "@/data-access-layer/EntitiesDAL";
import EntriesDAL from "@/data-access-layer/EntriesDAL";
import MetricsDAL from "@/data-access-layer/MetricsDAL";
import TrackersDAL from "@/data-access-layer/TrackersDAL";
import { planQuickAdd, type PlannedEntry } from "@/manifest/ControlHandlers";
import { getComputeModule, validateComputeManifest } from "@/manifest/ComputeRegistry";
import Utility from "@/utils/Utility";
import type * as Schemas from "@app/schemas";

// DEV_NOTE: architecture.md §7 step 4 — the manifest engine. One Repo for every tracker there will
// ever be, replacing HabitsRepo/MoneyRepo/TimeRepo: what used to be three hardcoded domains is now
// three rows whose manifest says which control writes them (ControlHandlers) and which module, if
// any, handles what a control can't (ComputeRegistry). Composes the same shared DALs those Repos
// did — there is no TrackersDAL-level change in this phase.
//
// DEV_NOTE: no per-user timezone preference exists anywhere in the app yet (mirrors the frontend's
// -utils.ts) — dates are UTC-based end to end. entries.tz is stored per invariant 4 so this can be
// swapped for a real per-user tz later without a data migration; today it's always "UTC".
const APP_TZ = "UTC";

// DEV_NOTE: how far back the Today screen's single daily_facts scan reaches. Long enough for any
// streak a user will plausibly be mid-way through, short enough that listing N trackers stays one
// bounded range scan. The heatmap endpoint takes its own explicit range and isn't capped by this.
const STREAK_WINDOW_DAYS = 120;

type MetricLookup = {
  byId: Map<number, Schemas.Metric>;
  byKey: Map<string, Schemas.Metric>;
  byPublicId: Map<string, Schemas.Metric>;
};

export default class TrackersRepo {
  private entitiesDal: EntitiesDAL;
  private entriesDal: EntriesDAL;
  private metricsDal: MetricsDAL;
  private trackersDal: TrackersDAL;

  constructor(env: Env) {
    this.entitiesDal = new EntitiesDAL(env);
    this.entriesDal = new EntriesDAL(env);
    this.metricsDal = new MetricsDAL(env);
    this.trackersDal = new TrackersDAL(env);
  }

  // --- date helpers ----------------------------------------------------------------------------

  private todayLocalDate(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private addDays(localDate: string, delta: number): string {
    const date = new Date(`${localDate}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + delta);
    return date.toISOString().slice(0, 10);
  }

  private dayOfWeek(localDate: string): number {
    return new Date(`${localDate}T00:00:00.000Z`).getUTCDay();
  }

  // DEV_NOTE: a "times_per_week" schedule names a count, not days — so every day is an opportunity
  // and none is a miss. Returning true here is what keeps invariant 7 honest for that shape: an
  // unlogged day renders as no-data, never as a failure.
  private isScheduled(localDate: string, schedule: Schemas.TrackerSchedule): boolean {
    if (schedule.type === "days_of_week") return schedule.days.includes(this.dayOfWeek(localDate));
    return true;
  }

  // --- shared lookups --------------------------------------------------------------------------

  private async loadMetrics(userId: string): Promise<MetricLookup | null> {
    const result = await this.metricsDal.getMetrics({ userId });
    if (!result.isSuccess || !result.metrics) return null;

    return {
      byId: new Map(result.metrics.map((metric) => [metric.id, metric])),
      byKey: new Map(result.metrics.map((metric) => [metric.key, metric])),
      byPublicId: new Map(result.metrics.map((metric) => [metric.publicId, metric])),
    };
  }

  private toTrackerApiShape(
    tracker: Schemas.Tracker,
    metrics: MetricLookup,
  ): Schemas.TrackerApiShape {
    const { id: _id, primaryMetricId, deletedAt: _deletedAt, ...rest } = tracker;
    const metric = metrics.byId.get(primaryMetricId);

    return {
      ...rest,
      primaryMetricPublicId: metric?.publicId ?? "",
      primaryMetricKey: metric?.key ?? "",
      // DEV_NOTE: resolved from the manifest's own key list, so a client renders labels and units
      // without a second request or a client-side join against /metrics.
      metricDetails: tracker.manifest.metrics.flatMap((key) => {
        const declared = metrics.byKey.get(key);
        return declared
          ? [
              {
                metricPublicId: declared.publicId,
                key: declared.key,
                name: declared.name,
                semanticType: declared.semanticType,
                canonicalUnit: declared.canonicalUnit,
              },
            ]
          : [];
      }),
    };
  }

  private toEntryApiShape(
    entry: Schemas.Entry & { values: Schemas.EntryValue[]; entities: Schemas.EntryEntityLink[] },
    metrics: MetricLookup,
    entityPublicIdById: Map<number, string>,
  ): Schemas.TrackerEntryApiShape {
    const endedAt = entry.endedAt ?? null;

    return {
      publicId: entry.publicId,
      entryKind: entry.entryKind,
      occurredAt: entry.occurredAt,
      endedAt,
      durationSeconds: endedAt
        ? Math.round((endedAt.getTime() - entry.occurredAt.getTime()) / 1000)
        : null,
      localDate: entry.localDate,
      label: entry.label ?? null,
      note: entry.note ?? null,
      transferGroupId: entry.transferGroupId ?? null,
      values: entry.values.map((value) => ({
        metricPublicId: metrics.byId.get(value.metricId)?.publicId ?? "",
        metricKey: metrics.byId.get(value.metricId)?.key ?? "",
        valueNum: value.valueNum ?? null,
        valueText: value.valueText ?? null,
        valueJson: value.valueJson ?? null,
        currency: value.currency ?? null,
        valueBase: value.valueBase ?? null,
        fxRate: value.fxRate ?? null,
      })),
      entities: entry.entities.flatMap((link) => {
        const entityPublicId = entityPublicIdById.get(link.entityId);
        // DEV_NOTE: architecture.md §4.1 point 2 — an unresolvable entity link is dropped rather
        // than rendered as a blank row. The weekly orphan scan is what reports it as the repository
        // bug it would be.
        return entityPublicId ? [{ entityPublicId, role: link.role }] : [];
      }),
      createdAt: entry.createdAt,
    };
  }

  private async resolveEntityPublicIds(
    userId: string,
    entityIds: number[],
  ): Promise<Map<number, string>> {
    const unique = [...new Set(entityIds)];
    if (unique.length === 0) return new Map();

    const result = await this.entitiesDal.getEntitiesByIds({ userId, ids: unique });
    return new Map((result.entities ?? []).map((entity) => [entity.id, entity.publicId]));
  }

  // --- create ----------------------------------------------------------------------------------

  // DEV_NOTE: the generic replacement for HabitsRepo.createHabit and Money/Time's lazily-created
  // singleton trackers. Metric resolution is the only branch: reuse a declared metric (what makes
  // two trackers roll into one number, architecture.md §6) or declare a new one inline.
  async createTracker(
    params: Schemas.CreateTrackerApiRequest & { userId: string },
  ): Promise<Schemas.CreateTrackerApiResponse> {
    const computeCheck = validateComputeManifest(params.tracker.manifest);
    if (!computeCheck.isSuccess) {
      return { isSuccess: false, message: computeCheck.message };
    }

    let metric: Schemas.Metric | undefined;

    if (params.metric.mode === "existing") {
      const result = await this.metricsDal.getMetric({
        userId: params.userId,
        publicId: params.metric.metricPublicId,
      });
      if (!result.isSuccess || !result.metric) {
        return { isSuccess: false, message: result.message ?? "Metric not found" };
      }
      metric = result.metric;
    } else {
      const spec = params.metric.metric;
      // DEV_NOTE: metrics are unique per (user_id, key). An explicit key that already exists is
      // reused, not rejected — that's how a shared metric like money_expense_amount ends up on a
      // second tracker without the caller needing to look up its publicId first. An omitted key
      // gets a generated one, so "just make me a metric for this" can't collide.
      const key = spec.key ?? `metric_${Utility.generatePublicId()}`;

      const existing = await this.metricsDal.getMetricByKey({ userId: params.userId, key });
      if (existing.isSuccess && existing.metric) {
        metric = existing.metric;
      } else {
        const created = await this.metricsDal.createMetric({
          userId: params.userId,
          key,
          name: spec.name,
          semanticType: spec.semanticType,
          canonicalUnit: spec.canonicalUnit,
          defaultAgg: spec.defaultAgg,
          direction: spec.direction,
          dateAttribution: spec.dateAttribution,
        });
        if (!created.isSuccess || !created.metric) {
          return { isSuccess: false, message: created.message };
        }
        metric = created.metric;
      }
    }

    // DEV_NOTE: the primary metric is always declared in the manifest — every control writes it, so
    // a manifest that omitted it would describe a tracker that writes a metric it never listed.
    const manifestMetrics = params.tracker.manifest.metrics.includes(metric.key)
      ? params.tracker.manifest.metrics
      : [metric.key, ...params.tracker.manifest.metrics];

    const created = await this.trackersDal.createTracker({
      userId: params.userId,
      primaryMetricId: metric.id,
      name: params.tracker.name,
      colorIndex: params.tracker.colorIndex,
      manifest: { ...params.tracker.manifest, metrics: manifestMetrics },
      sortOrder: params.tracker.sortOrder,
      activeFrom: params.tracker.activeFrom,
      activeTo: params.tracker.activeTo,
    });
    if (!created.isSuccess || !created.tracker) {
      return { isSuccess: false, message: created.message };
    }

    const metrics = await this.loadMetrics(params.userId);
    if (!metrics) return { isSuccess: false, message: "Failed to load metrics" };

    return {
      isSuccess: true,
      message: "Tracker created successfully",
      tracker: this.toTrackerApiShape(created.tracker, metrics),
    };
  }

  // --- read ------------------------------------------------------------------------------------

  async getTrackers(params: {
    userId: string;
    withToday: boolean;
    archived?: boolean;
  }): Promise<Schemas.GetTrackersApiResponse> {
    const [trackersResult, metrics] = await Promise.all([
      this.trackersDal.getTrackers({ userId: params.userId, archived: params.archived }),
      this.loadMetrics(params.userId),
    ]);
    if (!trackersResult.isSuccess || !trackersResult.trackers) {
      return { isSuccess: false, message: trackersResult.message };
    }
    if (!metrics) return { isSuccess: false, message: "Failed to load metrics" };

    const trackers = trackersResult.trackers;
    const shapes = trackers.map((tracker) => this.toTrackerApiShape(tracker, metrics));

    // DEV_NOTE: an archived tracker has no today — no quick-add widget renders for it, and asking
    // for streaks on rows the user is deciding whether to restore is a range scan for nothing.
    if (!params.withToday || params.archived) {
      return { isSuccess: true, message: "Trackers fetched successfully", trackers: shapes };
    }

    const today = this.todayLocalDate();
    const windowStart = this.addDays(today, -(STREAK_WINDOW_DAYS - 1));

    // DEV_NOTE: one range scan for every tracker's primary metric — the Today screen renders N
    // widgets off a single query rather than N round trips against a remote D1 binding.
    const factsResult = await this.entriesDal.getDailyFactsForMetrics({
      userId: params.userId,
      metricIds: trackers.map((tracker) => tracker.primaryMetricId),
      dateFrom: windowStart,
      dateTo: today,
    });
    if (!factsResult.isSuccess) {
      return { isSuccess: false, message: factsResult.message };
    }

    const sumsByMetric = new Map<number, Map<string, number>>();
    for (const fact of factsResult.dailyFacts ?? []) {
      const byDate = sumsByMetric.get(fact.metricId) ?? new Map<string, number>();
      byDate.set(fact.localDate, fact.sum);
      sumsByMetric.set(fact.metricId, byDate);
    }

    const todayShapes: Schemas.TrackerTodayApiShape[] = [];
    for (const [index, tracker] of trackers.entries()) {
      const sums = sumsByMetric.get(tracker.primaryMetricId) ?? new Map<string, number>();
      const todaySum = sums.has(today) ? (sums.get(today) as number) : null;

      let openSession: Schemas.TrackerEntryApiShape | null = null;
      if (tracker.manifest.control === "timer") {
        openSession = await this.loadOpenSession(params.userId, tracker, metrics);
      }

      todayShapes.push({
        tracker: shapes[index],
        todaySum,
        todayCount: todaySum === null ? 0 : 1,
        streak: this.computeStreak(sums, tracker, today),
        openSession,
      });
    }

    return {
      isSuccess: true,
      message: "Trackers fetched successfully",
      trackers: shapes,
      today: todayShapes,
    };
  }

  async getTracker(params: {
    userId: string;
    publicId: string;
  }): Promise<Schemas.GetTrackerApiResponse> {
    const [trackerResult, metrics] = await Promise.all([
      this.trackersDal.getTracker(params),
      this.loadMetrics(params.userId),
    ]);
    if (!trackerResult.isSuccess || !trackerResult.tracker) {
      return { isSuccess: false, message: trackerResult.message };
    }
    if (!metrics) return { isSuccess: false, message: "Failed to load metrics" };

    return {
      isSuccess: true,
      message: "Tracker fetched successfully",
      tracker: this.toTrackerApiShape(trackerResult.tracker, metrics),
    };
  }

  async archiveTracker(params: { userId: string; publicId: string }): Promise<Schemas.ApiResponse> {
    const result = await this.trackersDal.archiveTracker(params);
    return { isSuccess: result.isSuccess, message: result.message };
  }

  async unarchiveTracker(params: {
    userId: string;
    publicId: string;
  }): Promise<Schemas.UnarchiveTrackerApiResponse> {
    const result = await this.trackersDal.unarchiveTracker(params);
    if (!result.isSuccess || !result.tracker) {
      return { isSuccess: false, message: result.message };
    }

    const metrics = await this.loadMetrics(params.userId);
    if (!metrics) return { isSuccess: false, message: "Failed to load metrics" };

    return {
      isSuccess: true,
      message: result.message,
      tracker: this.toTrackerApiShape(result.tracker, metrics),
    };
  }

  async unarchiveAllTrackers(params: {
    userId: string;
  }): Promise<Schemas.UnarchiveAllTrackersApiResponse> {
    const result = await this.trackersDal.unarchiveAllTrackers(params);
    return {
      isSuccess: result.isSuccess,
      message: result.message,
      restoredCount: result.restoredCount,
    };
  }

  async getEntries(params: {
    userId: string;
    publicId: string;
    dateFrom: string;
    dateTo: string;
  }): Promise<Schemas.GetTrackerEntriesApiResponse> {
    const trackerResult = await this.trackersDal.getTracker({
      userId: params.userId,
      publicId: params.publicId,
    });
    if (!trackerResult.isSuccess || !trackerResult.tracker) {
      return { isSuccess: false, message: trackerResult.message };
    }

    const metrics = await this.loadMetrics(params.userId);
    if (!metrics) return { isSuccess: false, message: "Failed to load metrics" };

    const result = await this.entriesDal.getEntriesWithParts({
      userId: params.userId,
      trackerId: trackerResult.tracker.id,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
    });
    if (!result.isSuccess) {
      return { isSuccess: false, message: result.message };
    }

    const entries = result.entries ?? [];
    const entityPublicIdById = await this.resolveEntityPublicIds(
      params.userId,
      entries.flatMap((entry) => entry.entities.map((link) => link.entityId)),
    );

    return {
      isSuccess: true,
      message: "Entries fetched successfully",
      entries: entries.map((entry) => this.toEntryApiShape(entry, metrics, entityPublicIdById)),
    };
  }

  async getRunningSession(params: {
    userId: string;
    publicId: string;
  }): Promise<Schemas.GetRunningSessionApiResponse> {
    const trackerResult = await this.trackersDal.getTracker({
      userId: params.userId,
      publicId: params.publicId,
    });
    if (!trackerResult.isSuccess || !trackerResult.tracker) {
      return { isSuccess: false, message: trackerResult.message };
    }

    const metrics = await this.loadMetrics(params.userId);
    if (!metrics) return { isSuccess: false, message: "Failed to load metrics" };

    const session = await this.loadOpenSession(params.userId, trackerResult.tracker, metrics);
    return { isSuccess: true, message: "Running session fetched successfully", session };
  }

  private async loadOpenSession(
    userId: string,
    tracker: Schemas.Tracker,
    metrics: MetricLookup,
  ): Promise<Schemas.TrackerEntryApiShape | null> {
    const open = await this.entriesDal.getOpenIntervalEntry({ userId, trackerId: tracker.id });
    if (!open.isSuccess || !open.entry) return null;

    const entityPublicIdById = await this.resolveEntityPublicIds(
      userId,
      open.entry.entities.map((link) => link.entityId),
    );
    return this.toEntryApiShape(open.entry, metrics, entityPublicIdById);
  }

  // DEV_NOTE: architecture.md §6 — generalised from HabitsRepo.getHabitHeatmap. Habits produced
  // three states because it has no target and no schedule; a manifest-driven tracker gets all four
  // (plus not_active before activeFrom): a day the schedule never asked about is "not_scheduled",
  // and a logged day below manifest.target is "partial" rather than a silent miss.
  async getHeatmap(params: {
    userId: string;
    publicId: string;
    dateFrom: string;
    dateTo: string;
  }): Promise<Schemas.GetTrackerHeatmapApiResponse> {
    const trackerResult = await this.trackersDal.getTracker({
      userId: params.userId,
      publicId: params.publicId,
    });
    if (!trackerResult.isSuccess || !trackerResult.tracker) {
      return { isSuccess: false, message: trackerResult.message };
    }
    const tracker = trackerResult.tracker;

    const factsResult = await this.entriesDal.getDailyFacts({
      userId: params.userId,
      metricId: tracker.primaryMetricId,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
    });
    if (!factsResult.isSuccess) {
      return { isSuccess: false, message: factsResult.message };
    }

    const sums = new Map(
      (factsResult.dailyFacts ?? [])
        .filter((fact) => fact.count > 0)
        .map((fact) => [fact.localDate, fact.sum] as const),
    );

    const target = tracker.manifest.target;
    const days: Schemas.TrackerHeatmapDay[] = [];
    for (let date = params.dateFrom; date <= params.dateTo; date = this.addDays(date, 1)) {
      days.push({
        localDate: date,
        state: this.dayState(date, sums, tracker),
        sum: sums.has(date) ? (sums.get(date) as number) : null,
        target,
      });
    }

    return {
      isSuccess: true,
      message: "Heatmap fetched successfully",
      days,
      streak: this.computeStreak(sums, tracker, this.todayLocalDate()),
    };
  }

  private dayState(
    localDate: string,
    sums: Map<string, number>,
    tracker: Schemas.Tracker,
  ): Schemas.TrackerDayState {
    if (localDate < tracker.activeFrom) return "not_active";
    if (!this.isScheduled(localDate, tracker.manifest.schedule)) return "not_scheduled";
    if (!sums.has(localDate)) return "no_data";

    const target = tracker.manifest.target;
    if (target === null) return "met";
    return (sums.get(localDate) as number) >= target ? "met" : "partial";
  }

  // DEV_NOTE: invariant 8 — streaks count through yesterday; today only extends the streak if
  // already met (an unmet today doesn't break it, since the day isn't over). Unscheduled days are
  // skipped rather than counted or broken on (architecture.md §6 "skip unscheduled days").
  private computeStreak(
    sums: Map<string, number>,
    tracker: Schemas.Tracker,
    today: string,
  ): number {
    let streak = this.dayState(today, sums, tracker) === "met" ? 1 : 0;
    let cursor = this.addDays(today, -1);

    while (cursor >= tracker.activeFrom) {
      const state = this.dayState(cursor, sums, tracker);
      if (state === "not_scheduled") {
        cursor = this.addDays(cursor, -1);
        continue;
      }
      if (state !== "met") break;
      streak++;
      cursor = this.addDays(cursor, -1);
    }

    return streak;
  }

  async getBreakdown(params: {
    userId: string;
    publicId: string;
    dateFrom: string;
    dateTo: string;
    role?: Schemas.EntryRole;
  }): Promise<Schemas.GetTrackerBreakdownApiResponse> {
    const trackerResult = await this.trackersDal.getTracker({
      userId: params.userId,
      publicId: params.publicId,
    });
    if (!trackerResult.isSuccess || !trackerResult.tracker) {
      return { isSuccess: false, message: trackerResult.message };
    }
    const tracker = trackerResult.tracker;

    const result = await this.entriesDal.getIntervalBreakdown({
      userId: params.userId,
      trackerId: tracker.id,
      metricId: tracker.primaryMetricId,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      role: params.role,
    });
    if (!result.isSuccess) {
      return { isSuccess: false, message: result.message };
    }

    const rows = result.rows ?? [];
    const entityPublicIdById = await this.resolveEntityPublicIds(
      params.userId,
      rows.flatMap((row) => (row.entityId === null ? [] : [row.entityId])),
    );

    return {
      isSuccess: true,
      message: "Breakdown fetched successfully",
      rows: rows.map((row) => ({
        label: row.label,
        entityPublicId:
          row.entityId === null ? null : (entityPublicIdById.get(row.entityId) ?? null),
        entryCount: row.entryCount,
        total: row.total,
      })),
    };
  }

  // --- write -----------------------------------------------------------------------------------

  async quickAdd(params: {
    userId: string;
    publicId: string;
    payload: Schemas.QuickAddPayload;
  }): Promise<Schemas.QuickAddApiResponse> {
    const trackerResult = await this.trackersDal.getTracker({
      userId: params.userId,
      publicId: params.publicId,
    });
    if (!trackerResult.isSuccess || !trackerResult.tracker) {
      return { isSuccess: false, message: trackerResult.message };
    }
    const tracker = trackerResult.tracker;
    if (tracker.archivedAt) {
      return { isSuccess: false, message: "Tracker is archived" };
    }

    const metrics = await this.loadMetrics(params.userId);
    if (!metrics) return { isSuccess: false, message: "Failed to load metrics" };

    const primaryMetric = metrics.byId.get(tracker.primaryMetricId);
    if (!primaryMetric) {
      return { isSuccess: false, message: "Tracker's primary metric not found" };
    }

    const plan = planQuickAdd({
      manifest: tracker.manifest,
      payload: params.payload,
      primaryMetricKey: primaryMetric.key,
      todayLocalDate: this.todayLocalDate(),
      now: new Date(),
    });
    if (!plan.isSuccess || !plan.action) {
      return { isSuccess: false, message: plan.message };
    }
    const action = plan.action;

    switch (action.kind) {
      case "clear_day": {
        const cleared = await this.clearDay(params.userId, tracker.id, action.localDate);
        if (!cleared.isSuccess) return cleared;
        return this.withTodayTotals(params.userId, tracker, action.localDate, {
          isSuccess: true,
          message: "Entry cleared successfully",
        });
      }

      case "ensure_day": {
        const existing = await this.entriesDal.getEntriesWithParts({
          userId: params.userId,
          trackerId: tracker.id,
          dateFrom: action.localDate,
          dateTo: action.localDate,
        });
        if (!existing.isSuccess) return { isSuccess: false, message: existing.message };

        const alreadyLogged = existing.entries?.[0];
        if (alreadyLogged) {
          const entityPublicIdById = await this.resolveEntityPublicIds(
            params.userId,
            alreadyLogged.entities.map((link) => link.entityId),
          );
          return this.withTodayTotals(params.userId, tracker, action.localDate, {
            isSuccess: true,
            message: "Already logged for this date",
            entry: this.toEntryApiShape(alreadyLogged, metrics, entityPublicIdById),
          });
        }

        return this.writePlanned(params.userId, tracker, action.entry, metrics);
      }

      case "replace_day": {
        const cleared = await this.clearDay(params.userId, tracker.id, action.localDate);
        if (!cleared.isSuccess) return cleared;
        return this.writePlanned(params.userId, tracker, action.entry, metrics);
      }

      case "append":
        return this.writePlanned(params.userId, tracker, action.entry, metrics);

      case "start_interval": {
        // DEV_NOTE: one running session per tracker — carried over from TimeRepo.startTimer. Two
        // open intervals would make getOpenIntervalEntry's "the" running session a lie.
        const open = await this.entriesDal.getOpenIntervalEntry({
          userId: params.userId,
          trackerId: tracker.id,
        });
        if (!open.isSuccess) return { isSuccess: false, message: open.message };
        if (open.entry) return { isSuccess: false, message: "A timer is already running" };

        return this.writePlanned(params.userId, tracker, action.entry, metrics);
      }

      case "stop_interval":
        return this.stopInterval(params.userId, tracker, action.entryPublicId, metrics);
    }
  }

  private async clearDay(
    userId: string,
    trackerId: number,
    localDate: string,
  ): Promise<Schemas.ApiResponse> {
    const existing = await this.entriesDal.getEntries({
      userId,
      trackerId,
      dateFrom: localDate,
      dateTo: localDate,
    });
    if (!existing.isSuccess) return { isSuccess: false, message: existing.message };

    for (const entry of existing.entries ?? []) {
      const deleted = await this.entriesDal.deleteEntry({ userId, publicId: entry.publicId });
      if (!deleted.isSuccess) return { isSuccess: false, message: deleted.message };
    }

    return { isSuccess: true, message: "Day cleared successfully" };
  }

  private async writePlanned(
    userId: string,
    tracker: Schemas.Tracker,
    planned: PlannedEntry,
    metrics: MetricLookup,
  ): Promise<Schemas.QuickAddApiResponse> {
    const values: {
      metricId: number;
      valueNum?: number | null;
      valueText?: string | null;
      valueJson?: string | null;
      currency?: string | null;
      valueBase?: number | null;
      fxRate?: number | null;
    }[] = [];
    for (const value of planned.values) {
      const metric = metrics.byKey.get(value.metricKey);
      if (!metric) return { isSuccess: false, message: `Metric "${value.metricKey}" not found` };
      values.push({
        metricId: metric.id,
        valueNum: value.valueNum ?? null,
        valueText: value.valueText ?? null,
        valueJson: value.valueJson ?? null,
        currency: value.currency ?? null,
        valueBase: value.valueBase ?? null,
        fxRate: value.fxRate ?? null,
      });
    }

    const links = await this.resolveEntityLinks(userId, planned.entityLinks);
    if (!links.isSuccess) return { isSuccess: false, message: links.message };

    const written = await this.entriesDal.writeEntry({
      userId,
      trackerId: tracker.id,
      entryKind: planned.entryKind,
      occurredAt: planned.occurredAt,
      endedAt: planned.endedAt,
      localDate: planned.localDate,
      tz: APP_TZ,
      label: planned.label,
      note: planned.note,
      source: "manual",
      values,
      entityLinks: links.entityLinks,
    });
    if (!written.isSuccess || !written.entry) {
      return { isSuccess: false, message: written.message };
    }

    const entityPublicIdById = await this.resolveEntityPublicIds(
      userId,
      written.entry.entities.map((link) => link.entityId),
    );

    return this.withTodayTotals(userId, tracker, planned.localDate, {
      isSuccess: true,
      message: "Entry logged successfully",
      entry: this.toEntryApiShape(written.entry, metrics, entityPublicIdById),
    });
  }

  // DEV_NOTE: ported from TimeRepo.stopTimer — ended_at is the one mutable column on entries
  // (invariant 1's "append-mostly"), and the duration reading is appended only once the session
  // closes, so a running timer never contributes a partial number to any aggregate.
  private async stopInterval(
    userId: string,
    tracker: Schemas.Tracker,
    entryPublicId: string,
    metrics: MetricLookup,
  ): Promise<Schemas.QuickAddApiResponse> {
    const closed = await this.entriesDal.updateEntryEndedAt({
      userId,
      publicId: entryPublicId,
      endedAt: new Date(),
    });
    if (!closed.isSuccess || !closed.entry) {
      return { isSuccess: false, message: closed.message };
    }
    const entry = closed.entry;

    const withParts = await this.entriesDal.getEntriesWithParts({
      userId,
      trackerId: tracker.id,
      dateFrom: entry.localDate,
      dateTo: entry.localDate,
    });
    if (!withParts.isSuccess) return { isSuccess: false, message: withParts.message };

    const stored = withParts.entries?.find((candidate) => candidate.publicId === entry.publicId);
    const entityLinks = stored?.entities ?? [];

    const durationSeconds = Math.round(
      ((entry.endedAt as Date).getTime() - entry.occurredAt.getTime()) / 1000,
    );

    const appended = await this.entriesDal.appendEntryValue({
      userId,
      entryId: entry.id,
      localDate: entry.localDate,
      metricId: tracker.primaryMetricId,
      valueNum: durationSeconds,
      entityIds: entityLinks.map((link) => link.entityId),
    });
    if (!appended.isSuccess) return { isSuccess: false, message: appended.message };

    const entityPublicIdById = await this.resolveEntityPublicIds(
      userId,
      entityLinks.map((link) => link.entityId),
    );

    return this.withTodayTotals(userId, tracker, entry.localDate, {
      isSuccess: true,
      message: "Timer stopped successfully",
      entry: this.toEntryApiShape(
        { ...entry, values: appended.value ? [appended.value] : [], entities: entityLinks },
        metrics,
        entityPublicIdById,
      ),
    });
  }

  // DEV_NOTE: every quick-add answers with the day's resulting total, so a widget re-renders off
  // the response instead of round-tripping the list query it just invalidated.
  private async withTodayTotals(
    userId: string,
    tracker: Schemas.Tracker,
    localDate: string,
    response: Schemas.QuickAddApiResponse,
  ): Promise<Schemas.QuickAddApiResponse> {
    const facts = await this.entriesDal.getDailyFacts({
      userId,
      metricId: tracker.primaryMetricId,
      dateFrom: localDate,
      dateTo: localDate,
    });

    const fact = facts.dailyFacts?.[0];
    return {
      ...response,
      todaySum: fact ? fact.sum : null,
      todayCount: fact ? fact.count : 0,
    };
  }

  // DEV_NOTE: architecture.md §4.1 point 1 — the repository resolves every relationship column by
  // public_id on the way in. Archived entities are rejected here (an archived account shouldn't
  // take new expenses), which is the check MoneyRepo used to run per-domain.
  private async resolveEntityLinks(
    userId: string,
    links: Schemas.EntityLinkInput[],
  ): Promise<
    Schemas.ApiResponse & { entityLinks: { entityId: number; role: Schemas.EntryRole }[] }
  > {
    const resolved: { entityId: number; role: Schemas.EntryRole }[] = [];

    for (const link of links) {
      const result = await this.entitiesDal.getEntity({ userId, publicId: link.entityPublicId });
      if (!result.isSuccess || !result.entity) {
        return { isSuccess: false, message: "Linked entity not found", entityLinks: [] };
      }
      if (result.entity.archivedAt) {
        return {
          isSuccess: false,
          message: `Entity "${result.entity.name}" is archived`,
          entityLinks: [],
        };
      }
      resolved.push({ entityId: result.entity.id, role: link.role });
    }

    return { isSuccess: true, entityLinks: resolved };
  }

  // --- compute escape hatch --------------------------------------------------------------------

  async runCompute(params: {
    userId: string;
    publicId: string;
    compute: Schemas.ComputeInput;
  }): Promise<Schemas.RunComputeApiResponse> {
    const trackerResult = await this.trackersDal.getTracker({
      userId: params.userId,
      publicId: params.publicId,
    });
    if (!trackerResult.isSuccess || !trackerResult.tracker) {
      return { isSuccess: false, message: trackerResult.message };
    }
    const tracker = trackerResult.tracker;

    if (tracker.manifest.compute !== params.compute.key) {
      return {
        isSuccess: false,
        message: tracker.manifest.compute
          ? `This tracker runs "${tracker.manifest.compute}", not "${params.compute.key}"`
          : "This tracker has no compute module",
      };
    }

    const metrics = await this.loadMetrics(params.userId);
    if (!metrics) return { isSuccess: false, message: "Failed to load metrics" };

    const module = getComputeModule(params.compute.key);
    return module.run(
      {
        userId: params.userId,
        tracker,
        tz: APP_TZ,
        entriesDal: this.entriesDal,
        entitiesDal: this.entitiesDal,
        metricIdByKey: new Map(
          tracker.manifest.metrics.flatMap((key) => {
            const metric = metrics.byKey.get(key);
            return metric ? [[key, metric.id] as const] : [];
          }),
        ),
      },
      params.compute,
    );
  }
}
