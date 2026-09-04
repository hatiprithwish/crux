import { and, eq, isNotNull, isNull } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import getDbClient from "@/db/dbClient";
import { trackers } from "@/db/tables";
import * as Schemas from "@app/schemas";
import AppLogger from "@/providers/logger";
import Utility from "@/utils/Utility";

type CreateTrackerParams = {
  userId: string;
  primaryMetricId: number;
  name: string;
  colorIndex?: number | null;
  manifest: Schemas.TrackerManifest;
  sortOrder?: number;
  activeFrom: string;
  activeTo?: string | null;
};

export default class TrackersDAL {
  private db: DrizzleD1Database;

  constructor(env: Env) {
    this.db = getDbClient(env);
  }

  async createTracker(params: CreateTrackerParams) {
    const response: Schemas.ApiResponse & { tracker?: Schemas.Tracker } = { isSuccess: false };

    try {
      const now = new Date();
      const trackerResponse = await this.db
        .insert(trackers)
        .values({
          publicId: Utility.generatePublicId("trk_"),
          userId: params.userId,
          name: params.name,
          colorIndex: params.colorIndex ?? null,
          primaryMetricId: params.primaryMetricId,
          manifestJson: params.manifest,
          manifestVersion: 1,
          sortOrder: params.sortOrder ?? 0,
          activeFrom: params.activeFrom,
          activeTo: params.activeTo ?? null,
          createdAt: now,
          updatedAt: null,
        })
        .returning()
        .get();

      response.isSuccess = true;
      response.message = "Tracker created successfully";
      response.tracker = this.toTracker(trackerResponse);
    } catch (error) {
      const message = "Unknown error in creating tracker";
      AppLogger.error({
        category: Schemas.LogCategory.DAL,
        action: Schemas.LogAction.CreateTracker,
        message,
        error,
        metadata: params,
      });
      response.message = message;
    }

    return response;
  }

  async getTracker(params: { userId: string; publicId: string }) {
    const response: Schemas.ApiResponse & { tracker?: Schemas.Tracker } = { isSuccess: false };

    try {
      const [tracker] = await this.db
        .select()
        .from(trackers)
        .where(
          and(
            eq(trackers.publicId, params.publicId),
            eq(trackers.userId, params.userId),
            isNull(trackers.deletedAt),
          ),
        )
        .limit(1);

      if (!tracker) {
        const message = "Tracker not found";
        AppLogger.error({
          category: Schemas.LogCategory.DAL,
          action: Schemas.LogAction.GetTrackerDetails,
          message,
          metadata: params,
        });
        response.message = message;
        return response;
      }

      response.isSuccess = true;
      response.message = "Tracker fetched successfully";
      response.tracker = this.toTracker(tracker);
    } catch (error) {
      const message = "Unknown error in fetching tracker";
      AppLogger.error({
        category: Schemas.LogCategory.DAL,
        action: Schemas.LogAction.GetTrackerDetails,
        message,
        error,
        metadata: params,
      });
      response.message = message;
    }

    return response;
  }

  // DEV_NOTE: archiving is the only "delete" a client can do to a tracker, so the default list never
  // surfaces one again — but `archived: true` returns exactly those, which is what the restore
  // screen reads. Soft-deleted rows stay invisible to both (invariant 9 keeps them, nothing shows
  // them).
  async getTrackers(params: { userId: string; archived?: boolean }) {
    const response: Schemas.ApiResponse & { trackers?: Schemas.Tracker[] } = { isSuccess: false };

    try {
      const trackersResponse = await this.db
        .select()
        .from(trackers)
        .where(
          and(
            eq(trackers.userId, params.userId),
            params.archived ? isNotNull(trackers.archivedAt) : isNull(trackers.archivedAt),
            isNull(trackers.deletedAt),
          ),
        );

      response.isSuccess = true;
      response.message = "Trackers fetched successfully";
      response.trackers = trackersResponse.map((tracker) => this.toTracker(tracker));
    } catch (error) {
      const message = "Unknown error in listing trackers";
      AppLogger.error({
        category: Schemas.LogCategory.DAL,
        action: Schemas.LogAction.GetTrackers,
        message,
        error,
        metadata: params,
      });
      response.message = message;
    }

    return response;
  }

  async archiveTracker(params: { userId: string; publicId: string }) {
    const response: Schemas.ApiResponse & { tracker?: Schemas.Tracker } = { isSuccess: false };

    try {
      const now = new Date();
      const trackerResponse = await this.db
        .update(trackers)
        .set({ archivedAt: now, activeTo: now.toISOString().slice(0, 10), updatedAt: now })
        .where(
          and(
            eq(trackers.publicId, params.publicId),
            eq(trackers.userId, params.userId),
            isNull(trackers.deletedAt),
          ),
        )
        .returning()
        .get();

      if (!trackerResponse) {
        const message = "Tracker not found";
        AppLogger.error({
          category: Schemas.LogCategory.DAL,
          action: Schemas.LogAction.ArchiveTracker,
          message,
          metadata: params,
        });
        response.message = message;
        return response;
      }

      response.isSuccess = true;
      response.message = "Tracker archived successfully";
      response.tracker = this.toTracker(trackerResponse);
    } catch (error) {
      const message = "Unknown error in archiving tracker";
      AppLogger.error({
        category: Schemas.LogCategory.DAL,
        action: Schemas.LogAction.ArchiveTracker,
        message,
        error,
        metadata: params,
      });
      response.message = message;
    }

    return response;
  }

  // DEV_NOTE: the inverse of archiveTracker, and it has to clear BOTH columns that method sets —
  // archived_at hides the row, but active_to is what tells the heatmap the tracker stopped being
  // active on that date. Restoring one without the other gives you a tracker that lists fine and
  // renders a dead history.
  //
  // DEV_NOTE: guarded on archived_at IS NOT NULL, so restoring an already-live tracker is a "not
  // found" no-op rather than a silent timestamp rewrite.
  async unarchiveTracker(params: { userId: string; publicId: string }) {
    const response: Schemas.ApiResponse & { tracker?: Schemas.Tracker } = { isSuccess: false };

    try {
      const now = new Date();
      const trackerResponse = await this.db
        .update(trackers)
        .set({ archivedAt: null, activeTo: null, updatedAt: now })
        .where(
          and(
            eq(trackers.publicId, params.publicId),
            eq(trackers.userId, params.userId),
            isNotNull(trackers.archivedAt),
            isNull(trackers.deletedAt),
          ),
        )
        .returning()
        .get();

      if (!trackerResponse) {
        const message = "Archived tracker not found";
        AppLogger.error({
          category: Schemas.LogCategory.DAL,
          action: Schemas.LogAction.UnarchiveTracker,
          message,
          metadata: params,
        });
        response.message = message;
        return response;
      }

      response.isSuccess = true;
      response.message = "Tracker restored successfully";
      response.tracker = this.toTracker(trackerResponse);
    } catch (error) {
      const message = "Unknown error in restoring tracker";
      AppLogger.error({
        category: Schemas.LogCategory.DAL,
        action: Schemas.LogAction.UnarchiveTracker,
        message,
        error,
        metadata: params,
      });
      response.message = message;
    }

    return response;
  }

  // DEV_NOTE: one statement, not a loop over unarchiveTracker — "restore everything" is a single
  // user intent and a per-row fan-out against a remote D1 binding would be N round trips for it.
  async unarchiveAllTrackers(params: { userId: string }) {
    const response: Schemas.ApiResponse & { restoredCount?: number } = { isSuccess: false };

    try {
      const now = new Date();
      const restored = await this.db
        .update(trackers)
        .set({ archivedAt: null, activeTo: null, updatedAt: now })
        .where(
          and(
            eq(trackers.userId, params.userId),
            isNotNull(trackers.archivedAt),
            isNull(trackers.deletedAt),
          ),
        )
        .returning();

      response.isSuccess = true;
      response.message = "Trackers restored successfully";
      response.restoredCount = restored.length;
    } catch (error) {
      const message = "Unknown error in restoring trackers";
      AppLogger.error({
        category: Schemas.LogCategory.DAL,
        action: Schemas.LogAction.UnarchiveTracker,
        message,
        error,
        metadata: params,
      });
      response.message = message;
    }

    return response;
  }

  // DEV_NOTE: invariant 9 — soft delete only. Cascading to this tracker's entries/entry_values/
  // entry_entities is the caller's job (architecture.md §4.1 point 4 — "cascade deletes are now
  // manual"), not this DAL's — EntriesDAL owns entries.
  async deleteTracker(params: { userId: string; publicId: string }) {
    const response: Schemas.ApiResponse = { isSuccess: false };

    try {
      const now = new Date();
      const deleted = await this.db
        .update(trackers)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(
            eq(trackers.publicId, params.publicId),
            eq(trackers.userId, params.userId),
            isNull(trackers.deletedAt),
          ),
        )
        .returning()
        .get();

      if (!deleted) {
        const message = "Tracker not found";
        AppLogger.error({
          category: Schemas.LogCategory.DAL,
          action: Schemas.LogAction.DeleteTracker,
          message,
          metadata: params,
        });
        response.message = message;
        return response;
      }

      response.isSuccess = true;
      response.message = "Tracker deleted successfully";
    } catch (error) {
      const message = "Unknown error in deleting tracker";
      AppLogger.error({
        category: Schemas.LogCategory.DAL,
        action: Schemas.LogAction.DeleteTracker,
        message,
        error,
        metadata: params,
      });
      response.message = message;
    }

    return response;
  }

  // DEV_NOTE: drizzle's json-mode column types manifestJson as TrackerManifest | null at the
  // select level even though the column is notNull — narrow it back for callers.
  private toTracker(row: typeof trackers.$inferSelect): Schemas.Tracker {
    const { manifestJson, ...rest } = row;
    return { ...rest, manifest: manifestJson as Schemas.TrackerManifest };
  }
}
