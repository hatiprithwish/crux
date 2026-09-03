import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import worker from "../index";
// DEV_NOTE: no direct db access here, unlike the other suites — every assertion goes through the
// rollup endpoint, because what's under test is the aggregation contract, not the row layout.
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

// DEV_NOTE: implementation.md Phase 4's testable unit — "create one entity, link entries from two
// different trackers/metrics to it via entry_entities, confirm the aggregation endpoint sums both
// without triple-counting (invariant 6 — filtered by exactly one role)".
//
// DEV_NOTE: D1 here is `remote: true` — a real, persistent database. Every fixture below is
// run-scoped so repeat runs can't collide or accumulate into each other's assertions.
const runSuffix = Math.random().toString(36).slice(2, 8);

const countMetric = (key: string, name: string) => ({
  mode: "new" as const,
  metric: {
    key,
    name,
    semanticType: "count" as const,
    canonicalUnit: "count",
    defaultAgg: "sum" as const,
    direction: "higher_better" as const,
    dateAttribution: "start" as const,
  },
});

function incrementManifest(step: number) {
  return {
    control: "increment" as const,
    metrics: [] as string[],
    target: null,
    step,
    entryMode: "retro" as const,
    schedule: { type: "daily" as const },
    compute: null,
  };
}

async function createTracker(name: string, manifest: unknown, metric: unknown): Promise<string> {
  const res = await worker.fetch(
    makeRequest("/trackers", "POST", {
      tracker: { name, manifest, activeFrom: today, emoji: null },
      metric,
    }),
    testEnv,
    createExecutionContext(),
  );
  const body = (await res.json()) as { tracker: { publicId: string } };
  return body.tracker.publicId;
}

async function createEntity(name: string, kind: string): Promise<string> {
  const res = await worker.fetch(
    makeRequest("/entities", "POST", { entity: { name, kind } }),
    testEnv,
    createExecutionContext(),
  );
  const body = (await res.json()) as { entity: { publicId: string } };
  return body.entity.publicId;
}

describe("Cross-domain rollup (architecture.md §6)", () => {
  let ctx: ExecutionContext;
  let fitnessEntityPublicId: string;
  let personEntityPublicId: string;
  let pushupsTrackerPublicId: string;
  let squatsTrackerPublicId: string;
  const logDate = "2026-04-01";

  beforeAll(async () => {
    fitnessEntityPublicId = await createEntity(`Fitness-${runSuffix}`, "project");
    personEntityPublicId = await createEntity(`Coach-${runSuffix}`, "person");

    pushupsTrackerPublicId = await createTracker(
      `Pushups ${runSuffix}`,
      incrementManifest(10),
      countMetric(`rollup_pushups_${runSuffix}`, "Pushups"),
    );
    squatsTrackerPublicId = await createTracker(
      `Squats ${runSuffix}`,
      incrementManifest(5),
      countMetric(`rollup_squats_${runSuffix}`, "Squats"),
    );
    // DEV_NOTE: same widened budget as time.test.ts's breakdown hook — four creates, each a remote
    // round trip, before a single assertion runs.
  }, 120_000);

  afterAll(async () => {
    for (const publicId of [pushupsTrackerPublicId, squatsTrackerPublicId]) {
      await worker.fetch(
        makeRequest(`/trackers/${publicId}`, "DELETE"),
        testEnv,
        createExecutionContext(),
      );
    }
    for (const publicId of [fitnessEntityPublicId, personEntityPublicId]) {
      await worker.fetch(
        makeRequest(`/entities/${publicId}`, "DELETE"),
        testEnv,
        createExecutionContext(),
      );
    }
  }, 120_000);

  beforeEach(() => {
    ctx = createExecutionContext();
  });

  function logTo(trackerPublicId: string, entityLinks: { entityPublicId: string; role: string }[]) {
    return worker.fetch(
      makeRequest(`/trackers/${trackerPublicId}/entries`, "POST", {
        payload: { control: "increment", date: logDate, entityLinks },
      }),
      testEnv,
      createExecutionContext(),
    );
  }

  function getRollup(query: string) {
    return worker.fetch(
      makeRequest(`/entities/${fitnessEntityPublicId}/rollup?${query}`),
      testEnv,
      createExecutionContext(),
    );
  }

  it("sums two trackers' metrics against one entity, each metric once", async () => {
    // One tap on each tracker, both attributed to the same entity: 10 pushups + 5 squats.
    const pushups = await logTo(pushupsTrackerPublicId, [
      { entityPublicId: fitnessEntityPublicId, role: "project" },
    ]);
    expect(pushups.status).toBe(201);

    const squats = await logTo(squatsTrackerPublicId, [
      { entityPublicId: fitnessEntityPublicId, role: "project" },
    ]);
    expect(squats.status).toBe(201);

    const res = await getRollup(`from=${logDate}&to=${logDate}`);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      rollup: {
        metrics: { metricKey: string; sum: number; count: number }[];
        combined: { sum: number; count: number; canonicalUnit: string } | null;
      };
    };

    const pushupRow = body.rollup.metrics.find(
      (row) => row.metricKey === `rollup_pushups_${runSuffix}`,
    );
    const squatRow = body.rollup.metrics.find(
      (row) => row.metricKey === `rollup_squats_${runSuffix}`,
    );

    expect(pushupRow?.sum).toBe(10);
    expect(pushupRow?.count).toBe(1);
    expect(squatRow?.sum).toBe(5);
    expect(squatRow?.count).toBe(1);

    // Both metrics are counts in the same canonical unit, so they legitimately combine — this is
    // architecture.md §6's "pushups and running roll into one Fitness number".
    expect(body.rollup.combined?.canonicalUnit).toBe("count");
    expect(body.rollup.combined?.sum).toBe(15);
  });

  // DEV_NOTE: invariant 6 — the failure this guards against is an entry linked to several entities
  // being counted once per link inside a single entity's total.
  it("an entry linked to two entities is still counted once in each rollup", async () => {
    const res = await logTo(pushupsTrackerPublicId, [
      { entityPublicId: fitnessEntityPublicId, role: "project" },
      { entityPublicId: personEntityPublicId, role: "person" },
    ]);
    expect(res.status).toBe(201);

    const fitnessRes = await getRollup(`from=${logDate}&to=${logDate}`);
    const fitness = (await fitnessRes.json()) as {
      rollup: { metrics: { metricKey: string; sum: number; count: number }[] };
    };
    const pushupRow = fitness.rollup.metrics.find(
      (row) => row.metricKey === `rollup_pushups_${runSuffix}`,
    );

    // Two taps of 10 now exist against Fitness — the multi-entity one contributes 10, not 20.
    expect(pushupRow?.sum).toBe(20);
    expect(pushupRow?.count).toBe(2);

    const personRes = await worker.fetch(
      makeRequest(`/entities/${personEntityPublicId}/rollup?from=${logDate}&to=${logDate}`),
      testEnv,
      createExecutionContext(),
    );
    const person = (await personRes.json()) as {
      rollup: { metrics: { metricKey: string; sum: number; count: number }[] };
    };
    const personPushups = person.rollup.metrics.find(
      (row) => row.metricKey === `rollup_pushups_${runSuffix}`,
    );

    // The same entry counts once here too — attribution fans out, it doesn't multiply.
    expect(personPushups?.sum).toBe(10);
    expect(personPushups?.count).toBe(1);
  });

  // DEV_NOTE: the role slice reads entries directly rather than daily_facts (which has no role
  // column) — both paths must agree, which is what this asserts.
  it("slicing by a role the entity was never linked under returns nothing", async () => {
    const matching = await getRollup(`from=${logDate}&to=${logDate}&role=project`);
    const matched = (await matching.json()) as {
      rollup: { metrics: { sum: number }[]; role: string | null };
    };
    expect(matched.rollup.role).toBe("project");
    expect(matched.rollup.metrics.length).toBeGreaterThan(0);

    const other = await getRollup(`from=${logDate}&to=${logDate}&role=account`);
    const otherBody = (await other.json()) as { rollup: { metrics: unknown[] } };
    expect(otherBody.rollup.metrics).toHaveLength(0);
  });

  it("a window with nothing attributed reports no metrics, not zeros (invariant 7)", async () => {
    const res = await getRollup("from=2020-01-01&to=2020-01-31");
    const body = (await res.json()) as {
      rollup: { metrics: unknown[]; combined: unknown | null };
    };
    expect(body.rollup.metrics).toHaveLength(0);
    expect(body.rollup.combined).toBe(null);
  });
});

describe("Unauthenticated requests", () => {
  it("GET /entities/:publicId/rollup without auth returns 401", async () => {
    mockAuthenticateRequest.mockResolvedValueOnce({
      isSignedIn: false,
      reason: "no-token",
      toAuth: () => null,
    });

    const ctx = createExecutionContext();
    const res = await worker.fetch(
      makeRequest("/entities/ent_none/rollup?from=2026-01-01&to=2026-01-02"),
      testEnv,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });
});
