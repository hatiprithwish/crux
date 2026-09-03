import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import worker from "../index";
import getDbClient from "@/db/dbClient";
import { dailyFacts, trackers } from "@/db/tables";
// Declare env type for this test suite
declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}

const TEST_USER_ID = "user_test123";

const mockAuthenticateRequest = vi.fn().mockResolvedValue({
  isSignedIn: true,
  reason: null,
  toAuth: () => ({
    userId: TEST_USER_ID,
    sessionClaims: { email: "test@example.com" },
  }),
});

// Mock Clerk authentication — real token verification needs network + valid keys
vi.mock("@/providers/clerk", () => ({
  default: {
    getClerkClient: () => ({
      authenticateRequest: mockAuthenticateRequest,
    }),
  },
}));

// Mock logger to avoid logtape init overhead in tests
vi.mock("@/providers/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  configureLogger: vi.fn().mockResolvedValue(undefined),
  disposeLogger: vi.fn().mockResolvedValue(undefined),
  withRequestContext: vi.fn().mockImplementation((_id, next) => next()),
}));

// DEV_NOTE: wrangler.jsonc's top-level vars sets APP_ENV=local for this test env too, which would
// bypass the Clerk mock below entirely (see AuthMiddleware.ts). Force it off so these tests keep
// exercising the real checkAuth → Clerk path they're actually testing.
const testEnv = { ...env, APP_ENV: "staging" as const };

function makeRequest(path: string, method = "GET", body?: unknown) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

const today = new Date().toISOString().slice(0, 10);

function dayBefore(n: number): string {
  const date = new Date(`${today}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - n);
  return date.toISOString().slice(0, 10);
}

// DEV_NOTE: the Phase-0-era habit, expressed as a manifest instead of as HabitsRepo — a toggle
// control on a dedicated boolean metric, daily schedule, no target. implementation.md's Phase 6
// testable unit is that this behaves identically to the hardcoded version it replaced.
function habitManifest(entryMode: "live" | "retro" = "retro") {
  return {
    control: "toggle" as const,
    metrics: [] as string[],
    target: null,
    step: null,
    entryMode,
    schedule: { type: "daily" as const },
    compute: null,
  };
}

function newMetricSpec(name: string) {
  return {
    mode: "new" as const,
    metric: {
      name,
      semanticType: "boolean" as const,
      canonicalUnit: "boolean",
      defaultAgg: "sum" as const,
      direction: "higher_better" as const,
      dateAttribution: "start" as const,
    },
  };
}

async function createTracker(
  body: unknown,
): Promise<{ publicId: string; primaryMetricPublicId: string; primaryMetricKey: string }> {
  const res = await worker.fetch(
    makeRequest("/trackers", "POST", body),
    testEnv,
    createExecutionContext(),
  );
  const created = (await res.json()) as {
    tracker: { publicId: string; primaryMetricPublicId: string; primaryMetricKey: string };
  };
  return created.tracker;
}

async function archiveTracker(publicId: string) {
  await worker.fetch(
    makeRequest(`/trackers/${publicId}`, "DELETE"),
    testEnv,
    createExecutionContext(),
  );
}

describe("Trackers routes (authenticated)", () => {
  let ctx: ExecutionContext;

  beforeEach(() => {
    ctx = createExecutionContext();
    mockAuthenticateRequest.mockResolvedValue({
      isSignedIn: true,
      reason: null,
      toAuth: () => ({
        userId: TEST_USER_ID,
        sessionClaims: { email: "test@example.com" },
      }),
    });
  });

  it("GET /trackers returns 200", async () => {
    const res = await worker.fetch(makeRequest("/trackers"), testEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
  });

  it("POST /trackers returns 201 and the tracker is structurally publicId-only", async () => {
    const res = await worker.fetch(
      makeRequest("/trackers", "POST", {
        tracker: { name: "Test Tracker", manifest: habitManifest(), activeFrom: today },
        metric: newMetricSpec("Test Tracker"),
      }),
      testEnv,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(201);

    const body = (await res.json()) as {
      tracker?: {
        publicId?: string;
        id?: unknown;
        primaryMetricId?: unknown;
        primaryMetricPublicId?: string;
      };
    };
    expect(body.tracker?.publicId).toEqual(expect.any(String));
    expect(body.tracker?.primaryMetricPublicId).toEqual(expect.any(String));
    expect(body.tracker?.id).toBeUndefined();
    expect(body.tracker?.primaryMetricId).toBeUndefined();

    await archiveTracker(body.tracker!.publicId as string);
  });

  it("DELETE /trackers/:publicId archives it, then it no longer appears in the list", async () => {
    const tracker = await createTracker({
      tracker: { name: "Tracker To Archive", manifest: habitManifest(), activeFrom: today },
      metric: newMetricSpec("Tracker To Archive"),
    });

    const deleteRes = await worker.fetch(
      makeRequest(`/trackers/${tracker.publicId}`, "DELETE"),
      testEnv,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(deleteRes.status).toBe(200);

    const listRes = await worker.fetch(makeRequest("/trackers"), testEnv, createExecutionContext());
    const list = (await listRes.json()) as { trackers: { publicId: string }[] };
    expect(list.trackers.map((t) => t.publicId)).not.toContain(tracker.publicId);
  });

  // DEV_NOTE: the branch that makes cross-domain aggregation reachable (architecture.md §6) — two
  // trackers pointing at one metric is what lets their numbers roll up together.
  it("a second tracker can reuse an existing metric instead of declaring a new one", async () => {
    const first = await createTracker({
      tracker: { name: "Pushups", manifest: habitManifest(), activeFrom: today },
      metric: newMetricSpec("Fitness reps"),
    });

    const second = await createTracker({
      tracker: { name: "Squats", manifest: habitManifest(), activeFrom: today },
      metric: { mode: "existing", metricPublicId: first.primaryMetricPublicId },
    });

    expect(second.primaryMetricPublicId).toBe(first.primaryMetricPublicId);

    await archiveTracker(first.publicId);
    await archiveTracker(second.publicId);
  });

  it("rejects a manifest naming an unregistered compute module", async () => {
    const res = await worker.fetch(
      makeRequest("/trackers", "POST", {
        tracker: {
          name: "Bad Compute",
          manifest: { ...habitManifest(), compute: "not.a.module.v1" },
          activeFrom: today,
        },
        metric: newMetricSpec("Bad Compute"),
      }),
      testEnv,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(400);
  });
});

// DEV_NOTE: implementation.md Phase 6's testable unit — a toggle tracker created through the
// generic flow, with zero code specific to habits anywhere behind it, behaving exactly as the
// Phase-0 hardcoded Habit did: idempotent day logging, daily_facts materialised on write and gone
// on unlog, range reads.
describe("Trackers — toggle control (habit parity)", () => {
  let ctx: ExecutionContext;
  let trackerPublicId: string;

  beforeAll(async () => {
    const tracker = await createTracker({
      tracker: { name: "Logging Test Habit", manifest: habitManifest(), activeFrom: today },
      metric: newMetricSpec("Logging Test Habit"),
    });
    trackerPublicId = tracker.publicId;
  });

  afterAll(async () => {
    await archiveTracker(trackerPublicId);
  });

  beforeEach(() => {
    ctx = createExecutionContext();
  });

  async function toggle(date: string, completed: boolean) {
    return worker.fetch(
      makeRequest(`/trackers/${trackerPublicId}/entries`, "POST", {
        payload: { control: "toggle", date, completed },
      }),
      testEnv,
      createExecutionContext(),
    );
  }

  async function getDailyFactCount(localDate: string) {
    const db = getDbClient(testEnv);
    const [tracker] = await db
      .select()
      .from(trackers)
      .where(eq(trackers.publicId, trackerPublicId));

    const [fact] = await db
      .select()
      .from(dailyFacts)
      .where(
        and(
          eq(dailyFacts.userId, TEST_USER_ID),
          eq(dailyFacts.localDate, localDate),
          eq(dailyFacts.metricId, tracker.primaryMetricId),
          isNull(dailyFacts.entityId),
        ),
      );
    return fact?.count;
  }

  it("logging a day writes an entry and materializes daily_facts", async () => {
    const res = await toggle("2026-02-01", true);
    expect(res.status).toBe(201);

    const body = (await res.json()) as { entry?: { localDate: string }; todayCount?: number };
    expect(body.entry?.localDate).toBe("2026-02-01");
    expect(await getDailyFactCount("2026-02-01")).toBe(1);
  });

  it("logging the same day again is idempotent — no duplicate entry", async () => {
    const res = await toggle("2026-02-01", true);
    expect(res.status).toBe(201);
    expect(await getDailyFactCount("2026-02-01")).toBe(1);
  });

  it("unlogging a day deletes the entry and the daily_facts row", async () => {
    const res = await toggle("2026-02-01", false);
    expect(res.status).toBe(201);
    expect(await getDailyFactCount("2026-02-01")).toBeUndefined();
  });

  it("range query returns entries logged across multiple days", async () => {
    await toggle("2026-02-02", true);
    await toggle("2026-02-03", true);

    const res = await worker.fetch(
      makeRequest(`/trackers/${trackerPublicId}/entries?from=2026-02-02&to=2026-02-03`),
      testEnv,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { entries: { localDate: string }[] };
    expect(body.entries.map((entry) => entry.localDate).sort()).toEqual([
      "2026-02-02",
      "2026-02-03",
    ]);
  });

  it("rejects a payload whose control doesn't match the manifest", async () => {
    const res = await worker.fetch(
      makeRequest(`/trackers/${trackerPublicId}/entries`, "POST", {
        payload: { control: "increment", date: today },
      }),
      testEnv,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(400);
  });
});

// DEV_NOTE: manifest.entryMode was decoration until the engine — "live" means the tracker only
// accepts today (a tap-as-it-happens control), "retro" accepts any date.
describe("Trackers — entryMode enforcement", () => {
  let trackerPublicId: string;

  beforeAll(async () => {
    const tracker = await createTracker({
      tracker: { name: "Live Only Habit", manifest: habitManifest("live"), activeFrom: today },
      metric: newMetricSpec("Live Only Habit"),
    });
    trackerPublicId = tracker.publicId;
  });

  afterAll(async () => {
    await archiveTracker(trackerPublicId);
  });

  it("a live tracker rejects a backdated entry but accepts today", async () => {
    const backdated = await worker.fetch(
      makeRequest(`/trackers/${trackerPublicId}/entries`, "POST", {
        payload: { control: "toggle", date: dayBefore(3), completed: true },
      }),
      testEnv,
      createExecutionContext(),
    );
    expect(backdated.status).toBe(400);

    const live = await worker.fetch(
      makeRequest(`/trackers/${trackerPublicId}/entries`, "POST", {
        payload: { control: "toggle", date: today, completed: true },
      }),
      testEnv,
      createExecutionContext(),
    );
    expect(live.status).toBe(201);
  });
});

// DEV_NOTE: the numeric controls Habits/Money/Time never exercised. increment/stepper are additive
// (one entry per tap), daily_total *sets* the day — that distinction is the whole reason
// ControlHandlers plans "append" vs "replace_day" instead of a single upsert.
describe("Trackers — numeric controls", () => {
  let stepperPublicId: string;
  let dailyTotalPublicId: string;

  const countMetric = (name: string) => ({
    mode: "new" as const,
    metric: {
      name,
      semanticType: "count" as const,
      canonicalUnit: "count",
      defaultAgg: "sum" as const,
      direction: "higher_better" as const,
      dateAttribution: "start" as const,
    },
  });

  beforeAll(async () => {
    const stepper = await createTracker({
      tracker: {
        name: "Water Glasses",
        manifest: {
          control: "stepper",
          metrics: [],
          target: 8,
          step: 1,
          entryMode: "retro",
          schedule: { type: "daily" },
          compute: null,
        },
        activeFrom: today,
      },
      metric: countMetric("Water Glasses"),
    });
    stepperPublicId = stepper.publicId;

    const dailyTotal = await createTracker({
      tracker: {
        name: "Weight Log",
        manifest: {
          control: "daily_total",
          metrics: [],
          target: null,
          step: null,
          entryMode: "retro",
          schedule: { type: "daily" },
          compute: null,
        },
        activeFrom: today,
      },
      metric: countMetric("Weight Log"),
    });
    dailyTotalPublicId = dailyTotal.publicId;
  });

  afterAll(async () => {
    await archiveTracker(stepperPublicId);
    await archiveTracker(dailyTotalPublicId);
  });

  it("stepper entries accumulate across taps", async () => {
    const date = "2026-03-01";
    for (const steps of [2, 3]) {
      const res = await worker.fetch(
        makeRequest(`/trackers/${stepperPublicId}/entries`, "POST", {
          payload: { control: "stepper", date, steps },
        }),
        testEnv,
        createExecutionContext(),
      );
      expect(res.status).toBe(201);
    }

    const res = await worker.fetch(
      makeRequest(`/trackers/${stepperPublicId}/entries?from=${date}&to=${date}`),
      testEnv,
      createExecutionContext(),
    );
    const body = (await res.json()) as { entries: { values: { valueNum: number }[] }[] };
    const total = body.entries.reduce((sum, entry) => sum + entry.values[0].valueNum, 0);
    expect(total).toBe(5);
  });

  it("daily_total replaces the day rather than adding to it", async () => {
    const date = "2026-03-02";
    for (const total of [70, 72] as const) {
      const res = await worker.fetch(
        makeRequest(`/trackers/${dailyTotalPublicId}/entries`, "POST", {
          payload: { control: "daily_total", date, total },
        }),
        testEnv,
        createExecutionContext(),
      );
      expect(res.status).toBe(201);
      const body = (await res.json()) as { todaySum: number | null };
      expect(body.todaySum).toBe(total);
    }

    const res = await worker.fetch(
      makeRequest(`/trackers/${dailyTotalPublicId}/entries?from=${date}&to=${date}`),
      testEnv,
      createExecutionContext(),
    );
    const body = (await res.json()) as { entries: unknown[] };
    expect(body.entries).toHaveLength(1);
  });
});

describe("Trackers — heatmap + streak", () => {
  let ctx: ExecutionContext;
  let trackerPublicId: string;

  beforeAll(async () => {
    const tracker = await createTracker({
      tracker: { name: "Heatmap Test Habit", manifest: habitManifest(), activeFrom: today },
      metric: newMetricSpec("Heatmap Test Habit"),
    });
    trackerPublicId = tracker.publicId;

    // DEV_NOTE: a tracker's activeFrom is whatever the caller passed (here, today) — the heatmap
    // treats any date before it as not_active regardless of logging, so backdating directly in the
    // DB is the only way to simulate "this has existed for a week" without waiting real days.
    const db = getDbClient(testEnv);
    await db
      .update(trackers)
      .set({ activeFrom: dayBefore(6) })
      .where(eq(trackers.publicId, trackerPublicId));

    // Log days 5,4 ago and 2,1 ago — a gap on day 3 (implementation.md Phase 1's testable unit).
    for (const n of [5, 4, 2, 1]) {
      await worker.fetch(
        makeRequest(`/trackers/${trackerPublicId}/entries`, "POST", {
          payload: { control: "toggle", date: dayBefore(n), completed: true },
        }),
        testEnv,
        createExecutionContext(),
      );
    }
  });

  afterAll(async () => {
    await archiveTracker(trackerPublicId);
  });

  beforeEach(() => {
    ctx = createExecutionContext();
  });

  it("gap renders as no_data, and the streak reflects only the post-gap run", async () => {
    const res = await worker.fetch(
      makeRequest(`/trackers/${trackerPublicId}/heatmap?from=${dayBefore(6)}&to=${today}`),
      testEnv,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      days: { localDate: string; state: string }[];
      streak: number;
    };
    const byDate = Object.fromEntries(body.days.map((day) => [day.localDate, day.state]));

    expect(byDate[dayBefore(3)]).toBe("no_data");
    expect(byDate[dayBefore(2)]).toBe("met");
    expect(byDate[dayBefore(1)]).toBe("met");
    expect(byDate[today]).toBe("no_data");

    // today isn't logged, so the streak counts through yesterday only: days 2 and 1 ago.
    expect(body.streak).toBe(2);
  });

  it("the list endpoint reports the same streak with ?withToday=true", async () => {
    const res = await worker.fetch(
      makeRequest("/trackers?withToday=true"),
      testEnv,
      createExecutionContext(),
    );
    const body = (await res.json()) as {
      today: { tracker: { publicId: string }; streak: number; todaySum: number | null }[];
    };
    const row = body.today.find((entry) => entry.tracker.publicId === trackerPublicId);
    expect(row?.streak).toBe(2);
    expect(row?.todaySum).toBeNull();
  });
});

describe("Unauthenticated requests", () => {
  it("GET /trackers without auth returns 401", async () => {
    mockAuthenticateRequest.mockResolvedValueOnce({
      isSignedIn: false,
      reason: "no-token",
      toAuth: () => null,
    });

    const ctx = createExecutionContext();
    const res = await worker.fetch(makeRequest("/trackers"), testEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });
});
