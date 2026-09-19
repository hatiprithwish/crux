import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, vi, afterAll, beforeAll } from "vitest";
import { and, eq } from "drizzle-orm";
import worker from "../index";
import getDbClient from "@/db/dbClient";
import { dailyFacts, entries, entryValues, users } from "@/db/tables";
import * as Schemas from "@app/schemas";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}

const TEST_USER_ID = `user_test_rekey_${Date.now()}`;
const METRIC_ID = 987654;
const TRACKER_ID = 987654;

const mockAuthenticateRequest = vi.fn().mockResolvedValue({
  isSignedIn: true,
  reason: null,
  toAuth: () => ({ userId: TEST_USER_ID, sessionClaims: { email: "rekey@example.com" } }),
});

vi.mock("@/providers/clerk", () => ({
  default: { getClerkClient: () => ({ authenticateRequest: mockAuthenticateRequest }) },
}));

vi.mock("@/providers/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  configureLogger: vi.fn().mockResolvedValue(undefined),
  disposeLogger: vi.fn().mockResolvedValue(undefined),
  withRequestContext: vi.fn().mockImplementation((_id, next) => next()),
}));

const testEnv = { ...env, APP_ENV: "staging" as const };

// 18:43 UTC on 18 Sep 2026 is 00:13 IST on 19 Sep — the moment the bug report describes.
const WRITTEN_AT = new Date(Date.UTC(2026, 8, 18, 18, 43, 0));

async function seedEntry(params: { source: string; localDate: string; publicId: string }) {
  const db = getDbClient(testEnv);
  const row = await db
    .insert(entries)
    .values({
      publicId: params.publicId,
      userId: TEST_USER_ID,
      trackerId: TRACKER_ID,
      entryKind: "point",
      occurredAt: new Date(Date.UTC(2026, 8, 18, 0, 0, 0)),
      localDate: params.localDate,
      tz: "UTC",
      source: params.source,
      rev: 1,
      createdAt: WRITTEN_AT,
    })
    .returning()
    .get();
  await db.insert(entryValues).values({ entryId: row.id, metricId: METRIC_ID, valueNum: 1 });
  return row;
}

async function factCount(localDate: string) {
  const db = getDbClient(testEnv);
  const [fact] = await db
    .select()
    .from(dailyFacts)
    .where(
      and(
        eq(dailyFacts.userId, TEST_USER_ID),
        eq(dailyFacts.metricId, METRIC_ID),
        eq(dailyFacts.localDate, localDate),
      ),
    );
  return fact?.count ?? 0;
}

describe("POST /trackers/rekey-days", () => {
  let liveId: number;
  let retroId: number;

  beforeAll(async () => {
    const db = getDbClient(testEnv);
    const now = new Date();
    await db.insert(users).values({
      publicId: `usr_rekey_${Date.now()}`,
      clerkId: TEST_USER_ID,
      email: `${TEST_USER_ID}@example.com`,
      role: Schemas.UserRoleEnum.User,
      tz: "Asia/Kolkata",
      createdAt: now,
      updatedAt: now,
    });
    liveId = (
      await seedEntry({
        source: "manual",
        localDate: "2026-09-18",
        publicId: `eny_rk_live_${Date.now()}`,
      })
    ).id;
    retroId = (
      await seedEntry({
        source: "manual_retro",
        localDate: "2026-09-18",
        publicId: `eny_rk_retro_${Date.now()}`,
      })
    ).id;
    await db.insert(dailyFacts).values({
      userId: TEST_USER_ID,
      localDate: "2026-09-18",
      metricId: METRIC_ID,
      entityId: null,
      sum: 2,
      count: 2,
      min: 1,
      max: 1,
      avg: 1,
      targetAtTime: null,
      updatedAt: now,
    });
  });

  afterAll(async () => {
    const db = getDbClient(testEnv);
    await db.delete(entryValues).where(eq(entryValues.metricId, METRIC_ID));
    await db.delete(entries).where(eq(entries.userId, TEST_USER_ID));
    await db.delete(dailyFacts).where(eq(dailyFacts.userId, TEST_USER_ID));
    await db.delete(users).where(eq(users.clerkId, TEST_USER_ID));
  });

  async function rekey() {
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request("http://localhost/trackers/rekey-days", { method: "POST" }),
      testEnv,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    return res;
  }

  it("moves a write-time-keyed entry to the owner's day, leaves a user-picked day alone, and rebuilds facts", async () => {
    const res = await rekey();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rekeyedCount: number; remainingCount: number };
    expect(body.rekeyedCount).toBe(1);
    expect(body.remainingCount).toBe(0);

    const db = getDbClient(testEnv);
    const [live] = await db.select().from(entries).where(eq(entries.id, liveId));
    const [retro] = await db.select().from(entries).where(eq(entries.id, retroId));
    expect(live.localDate).toBe("2026-09-19");
    expect(live.tz).toBe("Asia/Kolkata");
    expect(retro.localDate).toBe("2026-09-18");

    expect(await factCount("2026-09-19")).toBe(1);
    expect(await factCount("2026-09-18")).toBe(1);
  });

  it("is a no-op on a second call", async () => {
    const res = await rekey();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rekeyedCount: number; remainingCount: number };
    expect(body.rekeyedCount).toBe(0);
    expect(body.remainingCount).toBe(0);
  });
});
