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
// control on a dedicated boolean metric, daily schedule, no target. docs/archive/implementation.md's Phase 6
// testable unit is that this behaves identically to the hardcoded version it replaced.
function habitManifest(entryMode: "live" | "retro" = "retro") {
  return {
    control: "toggle" as const,
    metrics: [] as string[],
    target: null,
    step: null,
    direction: null,
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
      defaultDirection: "higher_better" as const,
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

// DEV_NOTE: editing is narrower than creating on purpose — the control and the primary metric are
// what every entry already written was shaped by and points at, so they are absent from the request
// schema entirely. These tests pin both halves: what an edit may change, and what it may not name.
describe("Trackers — editing", () => {
  let ctx: ExecutionContext;

  beforeEach(() => {
    ctx = createExecutionContext();
  });

  it("PATCH /trackers/:publicId updates the named fields and leaves the rest alone", async () => {
    const tracker = await createTracker({
      tracker: {
        name: "Tracker To Edit",
        icon: "🛁",
        manifest: { ...habitManifest(), target: 1 },
        activeFrom: today,
      },
      metric: newMetricSpec("Tracker To Edit"),
    });

    const res = await worker.fetch(
      makeRequest(`/trackers/${tracker.publicId}`, "PATCH", {
        tracker: {
          name: "Renamed Tracker",
          manifest: { target: 3, schedule: { type: "days_of_week", days: [1, 3, 5] } },
        },
      }),
      testEnv,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      tracker?: {
        name: string;
        icon: string | null;
        primaryMetricPublicId: string;
        manifest: {
          control: string;
          metrics: string[];
          target: number | null;
          entryMode: string;
          schedule: { type: string; days?: number[] };
        };
      };
    };

    expect(body.tracker?.name).toBe("Renamed Tracker");
    expect(body.tracker?.manifest.target).toBe(3);
    expect(body.tracker?.manifest.schedule).toEqual({ type: "days_of_week", days: [1, 3, 5] });
    // Untouched fields survive a partial write — including the manifest keys the patch never named.
    expect(body.tracker?.icon).toBe("🛁");
    expect(body.tracker?.manifest.control).toBe("toggle");
    expect(body.tracker?.manifest.entryMode).toBe("retro");
    expect(body.tracker?.manifest.metrics).toEqual([tracker.primaryMetricKey]);
    expect(body.tracker?.primaryMetricPublicId).toBe(tracker.primaryMetricPublicId);

    await archiveTracker(tracker.publicId);
  });

  it("rejects an edit naming the control, and one naming no fields at all", async () => {
    const tracker = await createTracker({
      tracker: { name: "Tracker With Fixed Control", manifest: habitManifest(), activeFrom: today },
      metric: newMetricSpec("Tracker With Fixed Control"),
    });

    const controlRes = await worker.fetch(
      makeRequest(`/trackers/${tracker.publicId}`, "PATCH", {
        tracker: { manifest: { control: "timer" } },
      }),
      testEnv,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(controlRes.status).toBe(400);

    const emptyRes = await worker.fetch(
      makeRequest(`/trackers/${tracker.publicId}`, "PATCH", { tracker: {} }),
      testEnv,
      createExecutionContext(),
    );
    expect(emptyRes.status).toBe(400);

    // The rejected edits changed nothing.
    const getRes = await worker.fetch(
      makeRequest(`/trackers/${tracker.publicId}`),
      testEnv,
      createExecutionContext(),
    );
    const stored = (await getRes.json()) as { tracker: { manifest: { control: string } } };
    expect(stored.tracker.manifest.control).toBe("toggle");

    await archiveTracker(tracker.publicId);
  });

  it("PATCH on an unknown tracker is a 404", async () => {
    const res = await worker.fetch(
      makeRequest("/trackers/trk_does_not_exist", "PATCH", { tracker: { name: "Nope" } }),
      testEnv,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
  });
});

// DEV_NOTE: docs/archive/implementation.md Phase 6's testable unit — a toggle tracker created through the
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
      defaultDirection: "higher_better" as const,
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
          direction: null,
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
          direction: null,
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

// DEV_NOTE: metrics.default_agg decides what one day of a quantity *is*, and every read path used
// to ignore it and take the sum — so an averaged metric reported a total. Two weigh-ins of 20 and
// 40 are an average of 30, not a 60 that exists nowhere. This asserts the day's number, the number
// a quick-add answers with, and the day's score against a target, since all three read it.
describe("Trackers — metric aggregation", () => {
  let avgPublicId: string;
  const avgDate = "2026-06-01";

  beforeAll(async () => {
    const tracker = await createTracker({
      tracker: {
        name: "Body Weight",
        manifest: {
          control: "stepper",
          metrics: [],
          // 50 sits between the average (30) and the sum (60), so the day's state says which of
          // the two the scoring path actually read.
          target: 50,
          step: 1,
          direction: "higher_better",
          entryMode: "retro",
          schedule: { type: "daily" },
          compute: null,
        },
        activeFrom: "2026-01-01",
      },
      metric: {
        mode: "new" as const,
        metric: {
          key: `agg_avg_${Date.now()}`,
          name: "Body Weight",
          semanticType: "mass_grams" as const,
          canonicalUnit: "grams",
          defaultAgg: "avg" as const,
          defaultDirection: "higher_better" as const,
          dateAttribution: "start" as const,
        },
      },
    });
    avgPublicId = tracker.publicId;
  });

  afterAll(async () => {
    await archiveTracker(avgPublicId);
  });

  it("reports the day's average rather than its sum", async () => {
    let lastBody: { todaySum: number | null } = { todaySum: null };
    for (const steps of [20, 40]) {
      const res = await worker.fetch(
        makeRequest(`/trackers/${avgPublicId}/entries`, "POST", {
          payload: { control: "stepper", date: avgDate, steps },
        }),
        testEnv,
        createExecutionContext(),
      );
      expect(res.status).toBe(201);
      lastBody = (await res.json()) as { todaySum: number | null };
    }

    // The quick-add response is what the widget re-renders off, so it has to agree with the list.
    expect(lastBody.todaySum).toBe(30);

    const res = await worker.fetch(
      makeRequest(`/trackers/${avgPublicId}/heatmap?from=${avgDate}&to=${avgDate}`),
      testEnv,
      createExecutionContext(),
    );
    const body = (await res.json()) as { days: { localDate: string; sum: number | null }[] };
    const day = body.days.find((entry) => entry.localDate === avgDate);
    expect(day?.sum).toBe(30);
  });

  it("scores the day against the target using the aggregated value", async () => {
    const res = await worker.fetch(
      makeRequest(`/trackers/${avgPublicId}/heatmap?from=${avgDate}&to=${avgDate}`),
      testEnv,
      createExecutionContext(),
    );
    const body = (await res.json()) as { days: { localDate: string; state: string }[] };
    // avg 30 is short of the target of 50 — had it read the sum of 60, this would say "met".
    expect(body.days.find((day) => day.localDate === avgDate)?.state).toBe("partial");
  });
});

// DEV_NOTE: direction lives on the manifest, not on the metric — the same `minutes` metric can be
// a floor for one tracker and a ceiling for another, which is unrepresentable while one global
// metric owns the answer. These are the two halves of that: a tracker scoring downwards, and a
// tracker that stated nothing inheriting the metric's default.
describe("Trackers — manifest direction", () => {
  let capPublicId: string;
  let inheritPublicId: string;
  const capDate = "2026-05-01";

  const minutesMetric = (key: string, defaultDirection: "higher_better" | "lower_better") => ({
    mode: "new" as const,
    metric: {
      key,
      name: `Minutes ${key}`,
      semanticType: "duration_seconds" as const,
      canonicalUnit: "seconds",
      defaultAgg: "sum" as const,
      defaultDirection,
      dateAttribution: "start" as const,
    },
  });

  beforeAll(async () => {
    // A cap: 30 or fewer is the win, so a day *under* target is met and a day over it is partial.
    const cap = await createTracker({
      tracker: {
        name: "Doomscrolling",
        manifest: {
          control: "daily_total",
          metrics: [],
          target: 30,
          step: null,
          direction: "lower_better",
          entryMode: "retro",
          schedule: { type: "daily" },
          compute: null,
        },
        activeFrom: "2026-01-01",
      },
      metric: minutesMetric(`direction_cap_${Date.now()}`, "higher_better"),
    });
    capPublicId = cap.publicId;

    const inherit = await createTracker({
      tracker: {
        name: "Inherits Direction",
        manifest: {
          control: "daily_total",
          metrics: [],
          target: 30,
          step: null,
          direction: null,
          entryMode: "retro",
          schedule: { type: "daily" },
          compute: null,
        },
        activeFrom: "2026-01-01",
      },
      metric: minutesMetric(`direction_inherit_${Date.now()}`, "lower_better"),
    });
    inheritPublicId = inherit.publicId;
  });

  afterAll(async () => {
    await archiveTracker(capPublicId);
    await archiveTracker(inheritPublicId);
  });

  async function stateOn(publicId: string, date: string): Promise<string | undefined> {
    const res = await worker.fetch(
      makeRequest(`/trackers/${publicId}/heatmap?from=${date}&to=${date}`),
      testEnv,
      createExecutionContext(),
    );
    const body = (await res.json()) as { days: { localDate: string; state: string }[] };
    return body.days.find((day) => day.localDate === date)?.state;
  }

  it("scores a lower_better day under target as met and over target as partial", async () => {
    await worker.fetch(
      makeRequest(`/trackers/${capPublicId}/entries`, "POST", {
        payload: { control: "daily_total", date: capDate, total: 20 },
      }),
      testEnv,
      createExecutionContext(),
    );
    expect(await stateOn(capPublicId, capDate)).toBe("met");

    // daily_total replaces the day, so this is the same day blowing past the cap.
    await worker.fetch(
      makeRequest(`/trackers/${capPublicId}/entries`, "POST", {
        payload: { control: "daily_total", date: capDate, total: 45 },
      }),
      testEnv,
      createExecutionContext(),
    );
    expect(await stateOn(capPublicId, capDate)).toBe("partial");
  });

  it("resolves a null manifest direction to the metric's default on write", async () => {
    const res = await worker.fetch(
      makeRequest(`/trackers/${inheritPublicId}`),
      testEnv,
      createExecutionContext(),
    );
    const body = (await res.json()) as { tracker: { manifest: { direction: string | null } } };
    expect(body.tracker.manifest.direction).toBe("lower_better");
  });

  it("PATCHing direction rescores days already logged", async () => {
    const date = "2026-05-02";
    await worker.fetch(
      makeRequest(`/trackers/${inheritPublicId}/entries`, "POST", {
        payload: { control: "daily_total", date, total: 45 },
      }),
      testEnv,
      createExecutionContext(),
    );
    // 45 against a target of 30 — a miss while lower is better, a win the moment it isn't.
    expect(await stateOn(inheritPublicId, date)).toBe("partial");

    const patched = await worker.fetch(
      makeRequest(`/trackers/${inheritPublicId}`, "PATCH", {
        tracker: { manifest: { direction: "higher_better" } },
      }),
      testEnv,
      createExecutionContext(),
    );
    expect(patched.status).toBe(200);
    expect(await stateOn(inheritPublicId, date)).toBe("met");
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

    // Log days 5,4 ago and 2,1 ago — a gap on day 3 (docs/archive/implementation.md Phase 1's testable unit).
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

describe("Trackers — today timeline", () => {
  let loggedPublicId: string;
  let unloggedPublicId: string;

  beforeAll(async () => {
    const logged = await createTracker({
      tracker: { name: "Timeline Logged Habit", manifest: habitManifest(), activeFrom: today },
      metric: newMetricSpec("Timeline Logged Habit"),
    });
    loggedPublicId = logged.publicId;

    const unlogged = await createTracker({
      tracker: { name: "Timeline Unlogged Habit", manifest: habitManifest(), activeFrom: today },
      metric: newMetricSpec("Timeline Unlogged Habit"),
    });
    unloggedPublicId = unlogged.publicId;

    await worker.fetch(
      makeRequest(`/trackers/${loggedPublicId}/entries`, "POST", {
        payload: { control: "toggle", date: today, completed: true },
      }),
      testEnv,
      createExecutionContext(),
    );
  });

  afterAll(async () => {
    await archiveTracker(loggedPublicId);
    await archiveTracker(unloggedPublicId);
  });

  it("returns one tick for the logged tracker and nothing for the unlogged one", async () => {
    const res = await worker.fetch(
      makeRequest("/trackers/today/timeline"),
      testEnv,
      createExecutionContext(),
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      entries: { trackerPublicId: string; occurredAt: string }[];
    };
    const forLogged = body.entries.filter((entry) => entry.trackerPublicId === loggedPublicId);
    const forUnlogged = body.entries.filter((entry) => entry.trackerPublicId === unloggedPublicId);

    expect(forLogged).toHaveLength(1);
    expect(forUnlogged).toHaveLength(0);
    expect(new Date(forLogged[0].occurredAt).toISOString().slice(0, 10)).toBe(today);
  });

  it("an explicit ?date= in the past returns none of today's entries", async () => {
    const res = await worker.fetch(
      makeRequest(`/trackers/today/timeline?date=${dayBefore(30)}`),
      testEnv,
      createExecutionContext(),
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as { entries: { trackerPublicId: string }[] };
    expect(body.entries.some((entry) => entry.trackerPublicId === loggedPublicId)).toBe(false);
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
