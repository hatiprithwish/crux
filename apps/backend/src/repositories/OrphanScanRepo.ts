import OrphanScanDAL, { type OrphanCounts } from "@/data-access-layer/OrphanScanDAL";
import AppLogger from "@/providers/logger";
import * as Schemas from "@app/schemas";

// DEV_NOTE: unlike every other Repo in this codebase, this one logs directly rather than leaving
// logging to its DAL — "log any non-zero count" (architecture.md §4.1) is the feature itself, not
// incidental error handling around a business-rule failure. No Routes file either: this has no HTTP
// endpoint, it's invoked straight from the Worker's scheduled() handler (see index.ts).
export default class OrphanScanRepo {
  private orphanScanDal: OrphanScanDAL;

  constructor(env: Env) {
    this.orphanScanDal = new OrphanScanDAL(env);
  }

  async runScan(): Promise<Schemas.ApiResponse & { counts?: OrphanCounts }> {
    const result = await this.orphanScanDal.scanForOrphans();
    if (!result.isSuccess || !result.counts) {
      return { isSuccess: false, message: result.message };
    }

    const { counts } = result;
    const orphanedTables = (Object.keys(counts) as (keyof OrphanCounts)[]).filter(
      (table) => counts[table] > 0,
    );

    // DEV_NOTE: never auto-deletes — "a bug in the repository layer, not a data problem to patch."
    // Logged once per table so each shows up as its own signal, not folded into one opaque count.
    for (const table of orphanedTables) {
      AppLogger.error({
        category: Schemas.LogCategory.DB,
        action: Schemas.LogAction.OrphanRowsDetected,
        message: `Orphan scan found ${counts[table]} orphaned row(s) in ${table}`,
        metadata: { table, count: counts[table] },
      });
    }

    return { isSuccess: true, message: "Orphan scan completed successfully", counts };
  }
}
