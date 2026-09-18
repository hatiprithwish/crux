import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import worker from "../index";
import type * as Schemas from "@app/schemas";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}

const TEST_USER_ID = "user_test_plans";
const OTHER_USER_ID = "user_test_plans_other";

const mockAuthenticateRequest = vi.fn();
function signInAs(userId: string) {
  mockAuthenticateRequest.mockResolvedValue({
    isSignedIn: true,
    reason: null,
    toAuth: () => ({ userId, sessionClaims: { email: "test@example.com" } }),
  });
}

vi.mock("@/providers/clerk", () => ({
  default: {
    getClerkClient: () => ({ authenticateRequest: mockAuthenticateRequest }),
  },
}));

vi.mock("@/providers/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  configureLogger: vi.fn().mockResolvedValue(undefined),
  disposeLogger: vi.fn().mockResolvedValue(undefined),
  withRequestContext: vi.fn().mockImplementation((_id, next) => next()),
}));

// DEV_NOTE: same as trackers.test.ts — keep checkAuth on the real Clerk path, not APP_ENV=local.
const testEnv = { ...env, APP_ENV: "staging" as const };

const today = new Date().toISOString().slice(0, 10);

async function call<T>(path: string, method = "GET", body?: unknown) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }),
    testEnv,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return { status: res.status, json: (await res.json()) as T };
}

describe("Tracker plans and moments", () => {
  let trackerPublicId: string;

  beforeAll(async () => {
    signInAs(TEST_USER_ID);
    const created = await call<Schemas.CreateTrackerApiResponse>("/trackers", "POST", {
      tracker: {
        name: `Doomscrolling ${Date.now()}`,
        activeFrom: today,
        manifest: {
          control: "increment",
          metrics: [],
          target: null,
          step: 1,
          direction: "lower_better",
          entryMode: "live",
          schedule: { type: "daily" },
          compute: null,
        },
      },
      metric: {
        mode: "new",
        metric: {
          name: "Doomscroll sessions",
          semanticType: "count",
          canonicalUnit: "count",
          defaultAgg: "sum",
          defaultDirection: "lower_better",
          dateAttribution: "start",
        },
      },
    });
    trackerPublicId = created.json.tracker?.publicId as string;
  });

  afterAll(async () => {
    signInAs(TEST_USER_ID);
    await call(`/trackers/${trackerPublicId}`, "DELETE");
  });

  it("creates plans in order, publicId-only, and surfaces them on the Today read", async () => {
    signInAs(TEST_USER_ID);
    const first = await call<Schemas.WriteTrackerPlansApiResponse>(
      `/trackers/${trackerPublicId}/plans`,
      "POST",
      { plan: { cue: "Phone in bed", response: "Charge it across the room" } },
    );
    expect(first.status).toBe(201);

    const second = await call<Schemas.WriteTrackerPlansApiResponse>(
      `/trackers/${trackerPublicId}/plans`,
      "POST",
      { plan: { cue: "Bored after dinner", response: null } },
    );
    expect(second.status).toBe(201);
    expect(second.json.plans?.map((plan) => plan.cue)).toEqual([
      "Phone in bed",
      "Bored after dinner",
    ]);
    for (const plan of second.json.plans ?? []) {
      expect(plan).not.toHaveProperty("id");
      expect(plan).not.toHaveProperty("trackerId");
      expect(plan).not.toHaveProperty("userId");
    }

    const list = await call<Schemas.GetTrackersApiResponse>("/trackers?withToday=true");
    const row = list.json.today?.find((today) => today.tracker.publicId === trackerPublicId);
    expect(row?.plans.map((plan) => plan.cue)).toEqual(["Phone in bed", "Bored after dinner"]);
  });

  it("updates and deletes plans", async () => {
    signInAs(TEST_USER_ID);
    const plans = await call<Schemas.GetTrackerPlansApiResponse>(
      `/trackers/${trackerPublicId}/plans`,
    );
    const [phone, bored] = plans.json.plans ?? [];

    const updated = await call<Schemas.WriteTrackerPlansApiResponse>(
      `/trackers/${trackerPublicId}/plans/${bored.publicId}`,
      "PATCH",
      { plan: { response: "Walk for 10 minutes" } },
    );
    expect(updated.status).toBe(200);
    expect(updated.json.plans?.[1].response).toBe("Walk for 10 minutes");

    const empty = await call(`/trackers/${trackerPublicId}/plans/${phone.publicId}`, "PATCH", {
      plan: {},
    });
    expect(empty.status).toBe(400);
  });

  it("records moments against an existing plan, a new cue, or none — without touching entries", async () => {
    signInAs(TEST_USER_ID);
    const plans = await call<Schemas.GetTrackerPlansApiResponse>(
      `/trackers/${trackerPublicId}/plans`,
    );
    const firstPlan = plans.json.plans?.[0] as Schemas.TrackerPlanApiShape;

    const held = await call<Schemas.CreateTrackerMomentApiResponse>(
      `/trackers/${trackerPublicId}/moments`,
      "POST",
      { moment: { momentOutcome: 1, planPublicId: firstPlan.publicId } },
    );
    expect(held.status).toBe(201);
    expect(held.json.moment?.momentOutcomeLabel).toBe("held");
    expect(held.json.moment?.plan?.cue).toBe(firstPlan.cue);
    expect(held.json.moment).not.toHaveProperty("planId");

    const slipped = await call<Schemas.CreateTrackerMomentApiResponse>(
      `/trackers/${trackerPublicId}/moments`,
      "POST",
      { moment: { momentOutcome: 2, newCue: "Waiting for the kettle", note: "Scrolled 20 min" } },
    );
    expect(slipped.status).toBe(201);
    expect(slipped.json.moment?.momentOutcomeLabel).toBe("slipped");
    expect(slipped.json.plans?.some((plan) => plan.cue === "Waiting for the kettle")).toBe(true);

    const bare = await call<Schemas.CreateTrackerMomentApiResponse>(
      `/trackers/${trackerPublicId}/moments`,
      "POST",
      { moment: { momentOutcome: 1 } },
    );
    expect(bare.status).toBe(201);
    expect(bare.json.moment?.plan).toBeNull();

    const both = await call(`/trackers/${trackerPublicId}/moments`, "POST", {
      moment: { momentOutcome: 1, planPublicId: firstPlan.publicId, newCue: "x" },
    });
    expect(both.status).toBe(400);

    const moments = await call<Schemas.GetTrackerMomentsApiResponse>(
      `/trackers/${trackerPublicId}/moments?from=${today}&to=${today}`,
    );
    expect(moments.json.moments).toHaveLength(3);

    const entries = await call<Schemas.GetTrackerEntriesApiResponse>(
      `/trackers/${trackerPublicId}/entries?from=${today}&to=${today}`,
    );
    expect(entries.json.entries).toHaveLength(0);
  });

  it("keeps a deleted plan's cue on its past moments, and deletes a moment", async () => {
    signInAs(TEST_USER_ID);
    const plans = await call<Schemas.GetTrackerPlansApiResponse>(
      `/trackers/${trackerPublicId}/plans`,
    );
    const firstPlan = plans.json.plans?.[0] as Schemas.TrackerPlanApiShape;

    const deleted = await call<Schemas.WriteTrackerPlansApiResponse>(
      `/trackers/${trackerPublicId}/plans/${firstPlan.publicId}`,
      "DELETE",
    );
    expect(deleted.status).toBe(200);
    expect(deleted.json.plans?.some((plan) => plan.publicId === firstPlan.publicId)).toBe(false);

    const moments = await call<Schemas.GetTrackerMomentsApiResponse>(
      `/trackers/${trackerPublicId}/moments?from=${today}&to=${today}`,
    );
    const aboutDeleted = moments.json.moments?.find(
      (moment) => moment.plan?.publicId === firstPlan.publicId,
    );
    expect(aboutDeleted?.plan?.cue).toBe(firstPlan.cue);

    const removed = await call(
      `/trackers/${trackerPublicId}/moments/${aboutDeleted?.publicId}`,
      "DELETE",
    );
    expect(removed.status).toBe(200);

    const after = await call<Schemas.GetTrackerMomentsApiResponse>(
      `/trackers/${trackerPublicId}/moments?from=${today}&to=${today}`,
    );
    expect(after.json.moments).toHaveLength(2);
  });

  it("another user cannot read or write this tracker's plans", async () => {
    signInAs(OTHER_USER_ID);
    const read = await call(`/trackers/${trackerPublicId}/plans`);
    expect(read.status).toBe(404);

    const write = await call(`/trackers/${trackerPublicId}/moments`, "POST", {
      moment: { momentOutcome: 1 },
    });
    expect(write.status).toBe(400);
  });
});
