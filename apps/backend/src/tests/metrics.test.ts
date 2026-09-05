import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import worker from "../index";

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

const runSuffix = Math.random().toString(36).slice(2, 8);

// DEV_NOTE: metrics had create + list and nothing else, which made a mistyped one permanent. What's
// under test here is the pair of rules that make editing safe: only the three presentation fields
// can change, and a metric something still points at can't be deleted at all.

interface MetricShape {
  publicId: string;
  key: string;
  name: string;
  defaultAgg: string;
  direction: string;
  semanticType: string;
  canonicalUnit: string;
  usage?: { trackerCount: number; entryCount: number };
  id?: unknown;
}

async function createMetric(key: string): Promise<MetricShape> {
  const res = await worker.fetch(
    makeRequest("/metrics", "POST", {
      metric: {
        key,
        name: `Metric ${key}`,
        semanticType: "count",
        canonicalUnit: "reps",
        defaultAgg: "sum",
        direction: "higher_better",
        dateAttribution: "start",
      },
    }),
    testEnv,
    createExecutionContext(),
  );
  const body = (await res.json()) as { metric: MetricShape };
  return body.metric;
}

function patch(publicId: string, metric: unknown) {
  return worker.fetch(
    makeRequest(`/metrics/${publicId}`, "PATCH", { metric }),
    testEnv,
    createExecutionContext(),
  );
}

function list() {
  return worker.fetch(makeRequest("/metrics"), testEnv, createExecutionContext());
}

function remove(publicId: string) {
  return worker.fetch(
    makeRequest(`/metrics/${publicId}`, "DELETE"),
    testEnv,
    createExecutionContext(),
  );
}

describe("Editing a metric", () => {
  let ctx: ExecutionContext;
  let metric: MetricShape;

  beforeAll(async () => {
    metric = await createMetric(`editable_${runSuffix}`);
  }, 120_000);

  beforeEach(() => {
    ctx = createExecutionContext();
  });

  it("renames without touching the fields it wasn't given", async () => {
    const withAgg = await patch(metric.publicId, { defaultAgg: "max" });
    expect(withAgg.status).toBe(200);

    const renamed = await patch(metric.publicId, { name: `Renamed ${runSuffix}` });
    await waitOnExecutionContext(ctx);
    expect(renamed.status).toBe(200);

    const body = (await renamed.json()) as { metric: MetricShape };
    expect(body.metric.name).toBe(`Renamed ${runSuffix}`);
    // The rename didn't send defaultAgg — a partial update must not blank what it never saw.
    expect(body.metric.defaultAgg).toBe("max");
  });

  // DEV_NOTE: the manifest refers to a metric by key, not by id — a key change would detach every
  // tracker pointing at it, so the schema refuses the field outright rather than ignoring it.
  it("rejects a key change — the schema doesn't accept the field at all", async () => {
    const res = await patch(metric.publicId, { key: `stolen_${runSuffix}` });
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(400);
  });

  it("rejects semanticType, canonicalUnit and dateAttribution changes too", async () => {
    for (const field of [
      { semanticType: "duration_seconds" },
      { canonicalUnit: "seconds" },
      { dateAttribution: "end" },
    ]) {
      const res = await patch(metric.publicId, field);
      expect(res.status).toBe(400);
    }
    await waitOnExecutionContext(ctx);
  });

  it("rejects an empty patch rather than bumping updated_at for nothing", async () => {
    const res = await patch(metric.publicId, {});
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(400);
  });

  it("404s on a metric that isn't there", async () => {
    const res = await patch("met_does_not_exist", { name: "Nope" });
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
  });
});

describe("Listing metrics", () => {
  let ctx: ExecutionContext;

  beforeEach(() => {
    ctx = createExecutionContext();
  });

  it("carries usage counts and never leaks the internal id", async () => {
    const created = await createMetric(`listed_${runSuffix}`);

    const res = await list();
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { metrics: MetricShape[] };
    const found = body.metrics.find((entry) => entry.publicId === created.publicId);
    expect(found).toBeDefined();
    expect(found?.id).toBeUndefined();
    // Nothing points at a metric nobody has used yet — the grouped-count miss is the zero.
    expect(found?.usage).toEqual({ trackerCount: 0, entryCount: 0 });
  });
});

describe("Deleting a metric", () => {
  let ctx: ExecutionContext;

  beforeEach(() => {
    ctx = createExecutionContext();
  });

  it("deletes one nothing points at", async () => {
    const disposable = await createMetric(`disposable_${runSuffix}`);

    const res = await remove(disposable.publicId);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);

    const after = await list();
    const body = (await after.json()) as { metrics: MetricShape[] };
    expect(body.metrics.some((entry) => entry.publicId === disposable.publicId)).toBe(false);
  });

  // DEV_NOTE: 409 not 404 — the metric exists, the request is refused because of what points at it,
  // and the counts come back so the caller knows what to detach first.
  it("refuses to delete one a tracker still points at, and says what's using it", async () => {
    const inUse = await createMetric(`in_use_${runSuffix}`);

    const trackerRes = await worker.fetch(
      makeRequest("/trackers", "POST", {
        tracker: {
          name: `Uses Metric ${runSuffix}`,
          manifest: {
            control: "increment",
            metrics: [],
            target: null,
            step: null,
            entryMode: "retro",
            schedule: { type: "daily" },
            compute: null,
          },
          activeFrom: "2026-01-01",
        },
        metric: { mode: "existing", metricPublicId: inUse.publicId },
      }),
      testEnv,
      createExecutionContext(),
    );
    expect(trackerRes.status).toBe(201);
    const trackerBody = (await trackerRes.json()) as { tracker: { publicId: string } };

    const res = await remove(inUse.publicId);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(409);

    const body = (await res.json()) as {
      isSuccess: boolean;
      usage: { trackerCount: number; entryCount: number };
    };
    expect(body.isSuccess).toBe(false);
    expect(body.usage.trackerCount).toBeGreaterThan(0);

    await worker.fetch(
      makeRequest(`/trackers/${trackerBody.tracker.publicId}`, "DELETE"),
      testEnv,
      createExecutionContext(),
    );
  });

  it("404s on a metric that isn't there", async () => {
    const res = await remove("met_does_not_exist");
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
  });
});

describe("Unauthenticated requests", () => {
  it("PATCH and DELETE without auth return 401", async () => {
    mockAuthenticateRequest.mockResolvedValueOnce({ isSignedIn: false, reason: "no-token" });
    const patchRes = await worker.fetch(
      makeRequest("/metrics/met_whatever", "PATCH", { metric: { name: "x" } }),
      testEnv,
      createExecutionContext(),
    );
    expect(patchRes.status).toBe(401);

    mockAuthenticateRequest.mockResolvedValueOnce({ isSignedIn: false, reason: "no-token" });
    const deleteRes = await worker.fetch(
      makeRequest("/metrics/met_whatever", "DELETE"),
      testEnv,
      createExecutionContext(),
    );
    expect(deleteRes.status).toBe(401);
  });
});
