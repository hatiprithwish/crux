import { eq, isNull, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import getDbClient from "@/db/dbClient";
import { entries, entryEntities, entryValues, trackers } from "@/db/tables";
import * as Schemas from "@app/schemas";
import AppLogger from "@/providers/logger";

export type OrphanCounts = {
  entryValues: number;
  entryEntities: number;
  entries: number;
};

// DEV_NOTE: architecture.md §4.1 — no table declares `references` (invariant 13, a deliberate
// trade for offline sync + soft deletes), so referential integrity is the repository layer's job to
// verify, not SQLite's. This is the weekly check: three left-joins to the would-be parent, counting
// rows where it's missing. A non-zero count here is a bug in the repository layer that let a
// relationship column point nowhere — never auto-fixed, only surfaced (see OrphanScanRepo).
export default class OrphanScanDAL {
  private db: DrizzleD1Database;

  constructor(env: Env) {
    this.db = getDbClient(env);
  }

  async scanForOrphans() {
    const response: Schemas.ApiResponse & { counts?: OrphanCounts } = { isSuccess: false };

    try {
      const [orphanedValues] = await this.db
        .select({ count: sql<number>`COUNT(*)`.mapWith(Number) })
        .from(entryValues)
        .leftJoin(entries, eq(entries.id, entryValues.entryId))
        .where(isNull(entries.id));

      const [orphanedEntityLinks] = await this.db
        .select({ count: sql<number>`COUNT(*)`.mapWith(Number) })
        .from(entryEntities)
        .leftJoin(entries, eq(entries.id, entryEntities.entryId))
        .where(isNull(entries.id));

      const [orphanedEntries] = await this.db
        .select({ count: sql<number>`COUNT(*)`.mapWith(Number) })
        .from(entries)
        .leftJoin(trackers, eq(trackers.id, entries.trackerId))
        .where(isNull(trackers.id));

      response.isSuccess = true;
      response.message = "Orphan scan completed successfully";
      response.counts = {
        entryValues: orphanedValues?.count ?? 0,
        entryEntities: orphanedEntityLinks?.count ?? 0,
        entries: orphanedEntries?.count ?? 0,
      };
    } catch (error) {
      const message = "Unknown error in scanning for orphaned rows";
      AppLogger.error({
        category: Schemas.LogCategory.DAL,
        action: Schemas.LogAction.RunOrphanScan,
        message,
        error,
      });
      response.message = message;
    }

    return response;
  }
}
