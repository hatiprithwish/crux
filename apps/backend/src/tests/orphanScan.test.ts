import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, vi, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import worker from "../index";
import getDbClient from "@/db/dbClient";
import { entryValues } from "@/db/tables";
import MetricsDAL from "@/data-access-layer/MetricsDAL";
import OrphanScanRepo from "@/repositories/OrphanScanRepo";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}

// DEV_NOTE: this session's remote D1 proxy connection has been visibly unstable throughout this
// whole test suite — individual queries intermittently fail with `{ remote: true, retryable: true }`
// ("Network connection lost"), unrelated to the query itself. Every DAL method here catches
// internally and resolves with `isSuccess: false` rather than throwing (see e.g.
// MetricsDAL.createMetric), so retrying is keyed on that flag. A handful of retries turns transport
// flakiness into a non-issue without masking a real failure — a genuine bug fails the same way every
// attempt, a transport hiccup doesn't.
async function withRetry<T extends { isSuccess: boolean }>(
  fn: () => Promise<T>,
  attempts = 5,
): Promise<T> {
  let result: T;
  for (let i = 0; i < attempts; i++) {
    result = await fn();
    if (result.isSuccess) return result;
  }
  return result!;
}

const mockError = vi.fn();

vi.mock("@/providers/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: (params: unknown) => mockError(params) },
  configureLogger: vi.fn().mockResolvedValue(undefined),
  disposeLogger: vi.fn().mockResolvedValue(undefined),
  withRequestContext: vi.fn().mockImplementation((_id, next) => next()),
}));

const testEnv = { ...env, APP_ENV: "staging" as const };
const userId = "user_test_orphan_scan";

describe("Weekly orphan scan (architecture.md §4.1)", () => {
  let metricId: number;
  let orphanEntryId: number | undefined;

  afterAll(async () => {
    if (orphanEntryId === undefined) return;
    const db = getDbClient(testEnv);
    await db
      .delete(entryValues)
      .where(and(eq(entryValues.entryId, orphanEntryId), eq(entryValues.metricId, metricId)));
  });

  it("finds exactly one orphaned entry_values row and none elsewhere", async () => {
    // DEV_NOTE: D1 here is `remote: true` — a real, persistent database. A fresh metric key (not a
    // fixed one) means this test's orphan row can never collide with a leftover from a previous run,
    // and a baseline scan (rather than asserting literal zero) makes the assertion robust to any
    // orphan that predates this test for an unrelated reason.
    const metricResult = await withRetry(() =>
      new MetricsDAL(testEnv).createMetric({
        userId,
        key: `orphan_scan_test_${Date.now()}`,
        name: "Orphan Scan Test Metric",
        semanticType: "count",
        canonicalUnit: "count",
        defaultAgg: "sum",
        direction: "higher_better",
        dateAttribution: "start",
      }),
    );
    if (!metricResult.isSuccess || !metricResult.metric) {
      throw new Error("Failed to create test metric");
    }
    metricId = metricResult.metric.id;

    const baseline = await withRetry(() => new OrphanScanRepo(testEnv).runScan());
    if (!baseline.isSuccess || !baseline.counts) {
      throw new Error("Failed to compute baseline orphan counts");
    }

    // No matching `entries` row for this id — invariant 13 (no FK) is what makes this possible to
    // write at all. A fresh id per attempt (not a fixed sentinel) so a retry can never collide with
    // an earlier attempt's row on the (entry_id, metric_id) primary key.
    for (let attempt = 0; attempt < 5 && orphanEntryId === undefined; attempt++) {
      const candidateEntryId = 2_100_000_000 + attempt;
      try {
        await getDbClient(testEnv)
          .insert(entryValues)
          .values({ entryId: candidateEntryId, metricId, valueNum: 1 });
        orphanEntryId = candidateEntryId;
      } catch {
        // retry with the next candidate id
      }
    }
    if (orphanEntryId === undefined) {
      throw new Error("Failed to insert the orphaned entry_values row");
    }

    // DEV_NOTE: the scheduled handler itself has no retry logic in production (it shouldn't need
    // any there), so this retries the whole invoke-and-check cycle instead — safe because re-running
    // the scan while the orphan row is still present just re-logs the same finding.
    let sawExpectedLog = false;
    for (let attempt = 0; attempt < 5 && !sawExpectedLog; attempt++) {
      mockError.mockClear();
      const ctx = createExecutionContext();
      await worker.scheduled(
        { scheduledTime: Date.now(), cron: "0 0 * * 0", noRetry: () => {} },
        testEnv,
        ctx,
      );
      await waitOnExecutionContext(ctx);

      sawExpectedLog = mockError.mock.calls.some(
        ([call]) =>
          call?.action === "OrphanRowsDetected" &&
          call?.metadata?.table === "entryValues" &&
          call?.metadata?.count === baseline.counts!.entryValues + 1,
      );
    }

    expect(sawExpectedLog).toBe(true);
    expect(mockError).not.toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ table: "entryEntities" }) }),
    );
    expect(mockError).not.toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ table: "entries" }) }),
    );

    // DEV_NOTE: confirms the DAL counts agree with what got logged, not just that *something* logged.
    const after = await withRetry(() => new OrphanScanRepo(testEnv).runScan());
    expect(after.counts?.entryValues).toBe(baseline.counts.entryValues + 1);
    expect(after.counts?.entryEntities).toBe(baseline.counts.entryEntities);
    expect(after.counts?.entries).toBe(baseline.counts.entries);
  });
});
