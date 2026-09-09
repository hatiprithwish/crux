import EntitiesDAL from "@/data-access-layer/EntitiesDAL";
import EntriesDAL from "@/data-access-layer/EntriesDAL";
import MetricsDAL from "@/data-access-layer/MetricsDAL";
import TrackersDAL from "@/data-access-layer/TrackersDAL";
import { factValue } from "@/manifest/Aggregation";
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

  // --- target history --------------------------------------------------------------------------

  // DEV_NOTE: the fix for "raising a target rescored every day I'd already lived". Scoring used to
  // read `tracker.manifest.target` — the live value — for every day in the range, so a goal set
  // today reached backwards and demoted a month of met days to partial. A target is a value *from
  // a date*: this resolves which one was in force on the day being scored.
  //
  // DEV_NOTE: a day earlier than every row resolves to null, not to the oldest row, and null means
  // "no target then" — which dayState already scores as met for any logged day. That is what makes
  // the era before a user first set a goal read the way they actually lived it.
  //
  // Rows arrive ascending (TrackersDAL orders them), so the last one that has started is the one in
  // force. Walked backwards because the recent end is where every read lands.
  private resolveTargetAt(targets: Schemas.TrackerTarget[], localDate: string): number | null {
    for (let index = targets.length - 1; index >= 0; index--) {
      if (targets[index].effectiveFrom <= localDate) return targets[index].target;
    }
    return null;
  }

  private toTargetApiShape(target: Schemas.TrackerTarget): Schemas.TrackerTargetApiShape {
    const {
      id: _id,
      userId: _userId,
      trackerId: _trackerId,
      deletedAt: _deletedAt,
      ...rest
    } = target;
    return rest;
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
                defaultDirection: declared.defaultDirection,
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
          defaultDirection: spec.defaultDirection,
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
      icon: params.tracker.icon,
      colorIndex: params.tracker.colorIndex,
      // DEV_NOTE: null direction means "inherit the metric's default", and it's resolved here
      // rather than at read time for the same reason manifestMetrics is: the Repo owns the
      // invariant, so a stored manifest always scores a day on its own without a metric lookup.
      manifest: {
        ...params.tracker.manifest,
        metrics: manifestMetrics,
        direction: params.tracker.manifest.direction ?? metric.defaultDirection,
      },
      sortOrder: params.tracker.sortOrder,
      activeFrom: params.tracker.activeFrom,
      activeTo: params.tracker.activeTo,
    });
    if (!created.isSuccess || !created.tracker) {
      return { isSuccess: false, message: created.message };
    }

    // DEV_NOTE: the tracker's first target era opens on the day it starts, carrying whatever the
    // form said — including null, which is the correct row for a tracker created with no goal: it
    // makes "there was no target then" a recorded fact rather than the absence of one, so a target
    // added later stops at the day it was added instead of reaching back to the beginning.
    const seeded = await this.trackersDal.createTrackerTarget({
      userId: params.userId,
      trackerId: created.tracker.id,
      effectiveFrom: created.tracker.activeFrom,
      target: created.tracker.manifest.target,
    });
    if (!seeded.isSuccess) {
      return { isSuccess: false, message: seeded.message };
    }

    const metrics = await this.loadMetrics(params.userId);
    if (!metrics) return { isSuccess: false, message: "Failed to load metrics" };

    return {
      isSuccess: true,
      message: "Tracker created successfully",
      tracker: this.toTrackerApiShape(created.tracker, metrics),
    };
  }

  // --- update ----------------------------------------------------------------------------------

  // DEV_NOTE: the manifest is merged onto the stored one rather than replacing it, which is what
  // keeps control / metrics / compute out of a client's reach (ZUpdateTrackerApiRequest can't even
  // name them). An edit therefore changes how a tracker is scheduled and scored, never how its
  // history is interpreted: the entries already written stay attached to the same primary metric,
  // shaped by the same control.
  async updateTracker(
    params: Schemas.UpdateTrackerApiRequest & { userId: string; publicId: string },
  ): Promise<Schemas.UpdateTrackerApiResponse> {
    const existing = await this.trackersDal.getTracker({
      userId: params.userId,
      publicId: params.publicId,
    });
    if (!existing.isSuccess || !existing.tracker) {
      return { isSuccess: false, message: existing.message };
    }

    const metrics = await this.loadMetrics(params.userId);
    if (!metrics) return { isSuccess: false, message: "Failed to load metrics" };

    const { manifest: manifestPatch, ...columns } = params.tracker;
    const merged = manifestPatch ? { ...existing.tracker.manifest, ...manifestPatch } : undefined;
    // DEV_NOTE: same resolution createTracker does — an edit that clears direction is asking to go
    // back to the metric's default, not to store a null the scoring path would have to interpret.
    const manifest = merged
      ? {
          ...merged,
          direction:
            merged.direction ??
            metrics.byId.get(existing.tracker.primaryMetricId)?.defaultDirection ??
            "higher_better",
        }
      : undefined;

    // DEV_NOTE: re-validated even though control and compute can't be edited — the pairing is the
    // invariant, and a stored manifest that no longer satisfies it (a compute module retired
    // between create and edit) should fail here rather than be written forward untouched.
    if (manifest) {
      const computeCheck = validateComputeManifest(manifest);
      if (!computeCheck.isSuccess) {
        return { isSuccess: false, message: computeCheck.message };
      }
    }

    // DEV_NOTE: a changed target opens a new era rather than rewriting the tracker's history — the
    // point of the whole table. Guarded on the value actually changing, so renaming a tracker or
    // reshuffling its schedule writes no row, and re-saving the edit form unchanged is a no-op
    // rather than a stack of identical eras.
    //
    // DEV_NOTE: the era is written BEFORE the tracker row, not after, because manifest.target is
    // derived from the history rather than parallel to it (see below). Writing the tracker first
    // and the era second would mean deciding what the current target is from a history that hasn't
    // been written yet.
    const targetChanged =
      manifest !== undefined && manifest.target !== existing.tracker.manifest.target;
    if (targetChanged) {
      const written = await this.trackersDal.createTrackerTarget({
        userId: params.userId,
        trackerId: existing.tracker.id,
        // Today unless the caller says otherwise — "I've decided to aim higher" is a statement
        // about now. An explicit date is how a user backdates a goal they adopted before they got
        // around to typing it in.
        effectiveFrom: params.targetEffectiveFrom ?? this.todayLocalDate(),
        target: manifest.target,
      });
      if (!written.isSuccess) {
        return { isSuccess: false, message: written.message };
      }
    }

    // DEV_NOTE: manifest.target still exists and still means "the target this tracker is aiming for
    // today" — the eyebrow, the edit form and the quick-add widgets read it — but it is no longer
    // what scores a day, and it is no longer simply what the request said. Backdating a goal to
    // last June while a newer era already stands leaves today's target where it was, so the stored
    // value is resolved from the history rather than copied from the patch. In the ordinary case
    // (a new target from today) the two are the same number.
    let manifestToWrite = manifest;
    if (targetChanged) {
      const history = await this.trackersDal.getTrackerTargets({
        userId: params.userId,
        trackerId: existing.tracker.id,
      });
      if (!history.isSuccess) {
        return { isSuccess: false, message: history.message };
      }
      manifestToWrite = {
        ...manifest,
        target: this.resolveTargetAt(history.targets ?? [], this.todayLocalDate()),
      };
    }

    const updated = await this.trackersDal.updateTracker({
      userId: params.userId,
      publicId: params.publicId,
      fields: { ...columns, ...(manifestToWrite ? { manifest: manifestToWrite } : {}) },
    });
    if (!updated.isSuccess || !updated.tracker) {
      return { isSuccess: false, message: updated.message };
    }

    return {
      isSuccess: true,
      message: "Tracker updated successfully",
      tracker: this.toTrackerApiShape(updated.tracker, metrics),
    };
  }

  // --- target history --------------------------------------------------------------------------

  async getTrackerTargets(params: {
    userId: string;
    publicId: string;
  }): Promise<Schemas.GetTrackerTargetsApiResponse> {
    const trackerResult = await this.trackersDal.getTracker(params);
    if (!trackerResult.isSuccess || !trackerResult.tracker) {
      return { isSuccess: false, message: trackerResult.message };
    }

    const result = await this.trackersDal.getTrackerTargets({
      userId: params.userId,
      trackerId: trackerResult.tracker.id,
    });
    if (!result.isSuccess) {
      return { isSuccess: false, message: result.message };
    }

    return {
      isSuccess: true,
      message: "Targets fetched successfully",
      targets: (result.targets ?? []).map((target) => this.toTargetApiShape(target)),
    };
  }

  // DEV_NOTE: writing a row whose effectiveFrom is the newest in the history also updates
  // manifest.target, because that field means "the tracker's current target" — the eyebrow, the
  // edit form and every quick-add widget read it, and leaving it behind would have the page claim
  // one goal while the heatmap scored another. A row written *into the past* touches nothing:
  // correcting last month's history is not a statement about what the tracker aims for today.
  async createTrackerTarget(
    params: Schemas.CreateTrackerTargetApiRequest & { userId: string; publicId: string },
  ): Promise<Schemas.WriteTrackerTargetApiResponse> {
    const trackerResult = await this.trackersDal.getTracker({
      userId: params.userId,
      publicId: params.publicId,
    });
    if (!trackerResult.isSuccess || !trackerResult.tracker) {
      return { isSuccess: false, message: trackerResult.message };
    }
    const tracker = trackerResult.tracker;

    const written = await this.trackersDal.createTrackerTarget({
      userId: params.userId,
      trackerId: tracker.id,
      effectiveFrom: params.target.effectiveFrom,
      target: params.target.target,
    });
    if (!written.isSuccess) {
      return { isSuccess: false, message: written.message };
    }

    const synced = await this.syncManifestTargetToHead(tracker);
    if (!synced.isSuccess) return { isSuccess: false, message: synced.message };

    return this.listTargets(params.userId, tracker.id, "Target saved successfully");
  }

  // DEV_NOTE: deleting a row removes an era boundary rather than a target — the days it covered
  // fall back to whatever row precedes it, or to no target at all if it was the first. That is the
  // undo for a boundary put in the wrong place, and it's why the row is addressed by its own
  // publicId instead of by the date it starts.
  async deleteTrackerTarget(params: {
    userId: string;
    publicId: string;
    targetPublicId: string;
  }): Promise<Schemas.WriteTrackerTargetApiResponse> {
    const trackerResult = await this.trackersDal.getTracker({
      userId: params.userId,
      publicId: params.publicId,
    });
    if (!trackerResult.isSuccess || !trackerResult.tracker) {
      return { isSuccess: false, message: trackerResult.message };
    }
    const tracker = trackerResult.tracker;

    const deleted = await this.trackersDal.deleteTrackerTarget({
      userId: params.userId,
      trackerId: tracker.id,
      publicId: params.targetPublicId,
    });
    if (!deleted.isSuccess) {
      return { isSuccess: false, message: deleted.message };
    }

    const synced = await this.syncManifestTargetToHead(tracker);
    if (!synced.isSuccess) return { isSuccess: false, message: synced.message };

    return this.listTargets(params.userId, tracker.id, "Target deleted successfully");
  }

  private async listTargets(
    userId: string,
    trackerId: number,
    message: string,
  ): Promise<Schemas.WriteTrackerTargetApiResponse> {
    const result = await this.trackersDal.getTrackerTargets({ userId, trackerId });
    if (!result.isSuccess) {
      return { isSuccess: false, message: result.message };
    }

    return {
      isSuccess: true,
      message,
      targets: (result.targets ?? []).map((target) => this.toTargetApiShape(target)),
    };
  }

  // DEV_NOTE: manifest.target is the current target, and "current" means the target in force today
  // — so after any edit to the history it is re-read from the history rather than left holding
  // whatever the last PATCH put there. A history that ends in the future deliberately doesn't win:
  // resolveTargetAt(today) is what the tracker is aiming for right now.
  private async syncManifestTargetToHead(tracker: Schemas.Tracker): Promise<Schemas.ApiResponse> {
    const result = await this.trackersDal.getTrackerTargets({
      userId: tracker.userId,
      trackerId: tracker.id,
    });
    if (!result.isSuccess) return { isSuccess: false, message: result.message };

    const current = this.resolveTargetAt(result.targets ?? [], this.todayLocalDate());
    if (current === tracker.manifest.target) return { isSuccess: true };

    const updated = await this.trackersDal.updateTracker({
      userId: tracker.userId,
      publicId: tracker.publicId,
      fields: { manifest: { ...tracker.manifest, target: current } },
    });
    return { isSuccess: updated.isSuccess, message: updated.message };
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
    // widgets off a single query rather than N round trips against a remote D1 binding. The target
    // histories come back the same way, for the same reason: computeStreak needs the goal that was
    // in force on each day it walks, and N trackers must not become N extra queries.
    const [factsResult, targetsResult] = await Promise.all([
      this.entriesDal.getDailyFactsForMetrics({
        userId: params.userId,
        metricIds: trackers.map((tracker) => tracker.primaryMetricId),
        dateFrom: windowStart,
        dateTo: today,
      }),
      this.trackersDal.getTrackerTargetsForTrackers({
        userId: params.userId,
        trackerIds: trackers.map((tracker) => tracker.id),
      }),
    ]);
    if (!factsResult.isSuccess) {
      return { isSuccess: false, message: factsResult.message };
    }
    if (!targetsResult.isSuccess) {
      return { isSuccess: false, message: targetsResult.message };
    }

    // Grouped per tracker; rows arrive already ascending by effectiveFrom, and grouping preserves
    // that order, which is what resolveTargetAt walks.
    const targetsByTracker = new Map<number, Schemas.TrackerTarget[]>();
    for (const target of targetsResult.targets ?? []) {
      const existing = targetsByTracker.get(target.trackerId);
      if (existing) existing.push(target);
      else targetsByTracker.set(target.trackerId, [target]);
    }

    // DEV_NOTE: the day's number is whatever the metric's default_agg says it is, not its sum —
    // see Aggregation.factValue. A null value is left out of the map entirely rather than stored as
    // 0, so an aggregate that was never computed reads as "no data" and not as an empty day
    // (invariant 7).
    const valuesByMetric = new Map<number, Map<string, number>>();
    for (const fact of factsResult.dailyFacts ?? []) {
      const agg = metrics.byId.get(fact.metricId)?.defaultAgg ?? "sum";
      const value = factValue(fact, agg);
      if (value === null) continue;

      const byDate = valuesByMetric.get(fact.metricId) ?? new Map<string, number>();
      byDate.set(fact.localDate, value);
      valuesByMetric.set(fact.metricId, byDate);
    }

    const todayShapes: Schemas.TrackerTodayApiShape[] = [];
    for (const [index, tracker] of trackers.entries()) {
      const sums = valuesByMetric.get(tracker.primaryMetricId) ?? new Map<string, number>();
      const todaySum = sums.has(today) ? (sums.get(today) as number) : null;

      let openSession: Schemas.TrackerEntryApiShape | null = null;
      if (tracker.manifest.control === "timer") {
        openSession = await this.loadOpenSession(params.userId, tracker, metrics);
      }

      todayShapes.push({
        tracker: shapes[index],
        todaySum,
        todayCount: todaySum === null ? 0 : 1,
        streak: this.computeStreak(sums, tracker, targetsByTracker.get(tracker.id) ?? [], today),
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

  // DEV_NOTE: backs the Today screen's ruler (docs/redesign-backlog.md's timeline ruler item) — a
  // flat, cross-tracker list of today's entries, not per-tracker like everything else in this file.
  async getTimeline(params: {
    userId: string;
    date?: string;
  }): Promise<Schemas.GetTrackerTimelineApiResponse> {
    const localDate = params.date ?? this.todayLocalDate();

    const [entriesResult, trackersResult] = await Promise.all([
      this.entriesDal.getEntriesForDate({ userId: params.userId, localDate }),
      this.trackersDal.getTrackers({ userId: params.userId }),
    ]);
    if (!entriesResult.isSuccess || !entriesResult.entries) {
      return { isSuccess: false, message: entriesResult.message };
    }
    if (!trackersResult.isSuccess || !trackersResult.trackers) {
      return { isSuccess: false, message: trackersResult.message };
    }

    const publicIdById = new Map(
      trackersResult.trackers.map((tracker) => [tracker.id, tracker.publicId]),
    );

    const entries: Schemas.TrackerTimelineEntryApiShape[] = entriesResult.entries
      .filter((entry) => publicIdById.has(entry.trackerId))
      .map((entry) => ({
        trackerPublicId: publicIdById.get(entry.trackerId) as string,
        occurredAt: entry.occurredAt,
        endedAt: entry.endedAt ?? null,
      }))
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

    return { isSuccess: true, message: "Timeline fetched successfully", entries };
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
    // DEV_NOTE: metrics are loaded here for one field — the primary metric's default_agg, which
    // decides what a cell's number is. One indexed select of the user's own metrics, the same one
    // every list call already makes, rather than reading `.sum` and being wrong for avg metrics.
    const [trackerResult, metrics] = await Promise.all([
      this.trackersDal.getTracker({ userId: params.userId, publicId: params.publicId }),
      this.loadMetrics(params.userId),
    ]);
    if (!trackerResult.isSuccess || !trackerResult.tracker) {
      return { isSuccess: false, message: trackerResult.message };
    }
    if (!metrics) return { isSuccess: false, message: "Failed to load metrics" };
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

    const agg = metrics.byId.get(tracker.primaryMetricId)?.defaultAgg ?? "sum";
    const sums = new Map(
      (factsResult.dailyFacts ?? [])
        .filter((fact) => fact.count > 0)
        .flatMap((fact) => {
          const value = factValue(fact, agg);
          return value === null ? [] : [[fact.localDate, value] as const];
        }),
    );

    // DEV_NOTE: one query for the tracker's whole target history, then resolved per day in TS — the
    // table holds a row per *change*, not per day, so this is a handful of rows however long the
    // range is, and doing it per-day in SQL would be 364 lookups for the same answer.
    const targetsResult = await this.trackersDal.getTrackerTargets({
      userId: params.userId,
      trackerId: tracker.id,
    });
    if (!targetsResult.isSuccess) {
      return { isSuccess: false, message: targetsResult.message };
    }
    const targets = targetsResult.targets ?? [];

    const days: Schemas.TrackerHeatmapDay[] = [];
    for (let date = params.dateFrom; date <= params.dateTo; date = this.addDays(date, 1)) {
      // DEV_NOTE: the day's own target travels with the day, which is what lets the client draw a
      // target line that steps when the goal changed rather than one flat line at today's value.
      const target = this.resolveTargetAt(targets, date);
      days.push({
        localDate: date,
        state: this.dayState(date, sums, tracker, target),
        sum: sums.has(date) ? (sums.get(date) as number) : null,
        target,
      });
    }

    return {
      isSuccess: true,
      message: "Heatmap fetched successfully",
      days,
      streak: this.computeStreak(sums, tracker, targets, this.todayLocalDate()),
    };
  }

  // DEV_NOTE: `target` is passed in rather than read off the manifest — it is the target that was in
  // force on `localDate` (resolveTargetAt), not the one configured today. That parameter is the
  // whole bug fix: everything else here is unchanged.
  private dayState(
    localDate: string,
    sums: Map<string, number>,
    tracker: Schemas.Tracker,
    target: number | null,
  ): Schemas.TrackerDayState {
    if (localDate < tracker.activeFrom) return "not_active";
    if (!this.isScheduled(localDate, tracker.manifest.schedule)) return "not_scheduled";
    if (!sums.has(localDate)) return "no_data";

    // DEV_NOTE: architecture.md §6 — "compare using `direction` and the target in force". A
    // neutral tracker states there is no better side to be on, so a logged day is met and nothing
    // is scored against the target, exactly as a tracker with no target at all.
    // The ?? is for manifests written before direction moved onto them (migration 0004 backfills
    // the stored rows; this keeps an unmigrated read honest rather than crashing).
    //
    // DEV_NOTE: direction is read live, unlike the target. Raising a goal opens a new chapter, so
    // the old one keeps its old bar; flipping direction says the number always meant the opposite
    // of what was stored, and the honest response to a correction is to rescore what it got wrong.
    const direction = tracker.manifest.direction ?? "higher_better";
    if (target === null || direction === "neutral") return "met";

    const sum = sums.get(localDate) as number;
    const met = direction === "lower_better" ? sum <= target : sum >= target;
    return met ? "met" : "partial";
  }

  // DEV_NOTE: invariant 8 — streaks count through yesterday; today only extends the streak if
  // already met (an unmet today doesn't break it, since the day isn't over). Unscheduled days are
  // skipped rather than counted or broken on (architecture.md §6 "skip unscheduled days").
  private computeStreak(
    sums: Map<string, number>,
    tracker: Schemas.Tracker,
    targets: Schemas.TrackerTarget[],
    today: string,
  ): number {
    const stateOn = (date: string) =>
      this.dayState(date, sums, tracker, this.resolveTargetAt(targets, date));

    let streak = stateOn(today) === "met" ? 1 : 0;
    let cursor = this.addDays(today, -1);

    while (cursor >= tracker.activeFrom) {
      const state = stateOn(cursor);
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
      source: planned.source,
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
    const [facts, metric] = await Promise.all([
      this.entriesDal.getDailyFacts({
        userId,
        metricId: tracker.primaryMetricId,
        dateFrom: localDate,
        dateTo: localDate,
      }),
      this.metricsDal.getMetricById({ userId, id: tracker.primaryMetricId }),
    ]);

    // DEV_NOTE: the same selector the list endpoint uses (Aggregation.factValue) — the widget
    // re-renders off this number, so it has to be the number the next list call will report, not
    // the raw sum underneath it.
    const fact = facts.dailyFacts?.[0];
    const agg = metric.metric?.defaultAgg ?? "sum";
    return {
      ...response,
      todaySum: fact ? factValue(fact, agg) : null,
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
