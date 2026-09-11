import { Hono } from "hono";
import TrackersRepo from "@/repositories/TrackersRepo";
import checkAuth from "@/middlewares/AuthMiddleware";
import type AppContext from "@/config/AppContext";
import * as Schemas from "@app/schemas";
import { zValidator } from "@hono/zod-validator";
import z from "zod";

// DEV_NOTE: architecture.md §7 step 4 — this is the whole tracker API. /habits, /money and /time
// are gone: a habit, an expense and a timer session are the same POST here, differing only in the
// quick-add payload their manifest.control declares.
const TrackersRoutes = new Hono<AppContext>();

const ZPublicIdParam = z.object({ publicId: z.string() });

TrackersRoutes.post(
  "/",
  checkAuth,
  zValidator("json", Schemas.ZCreateTrackerApiRequest),
  async (c) => {
    const userId = c.get("clerkUserId");
    const body = c.req.valid("json");

    const repo = new TrackersRepo(c.env);
    const response = await repo.createTracker({ ...body, userId });

    return c.json(response, response.isSuccess ? 201 : 500);
  },
);

TrackersRoutes.get("/", checkAuth, zValidator("query", Schemas.ZGetTrackersApiQuery), async (c) => {
  const userId = c.get("clerkUserId");
  const { withToday, archived } = c.req.valid("query");

  const repo = new TrackersRepo(c.env);
  const response = await repo.getTrackers({
    userId,
    withToday: withToday === "true",
    archived: archived === "true",
  });

  return c.json(response, response.isSuccess ? 200 : 500);
});

// DEV_NOTE: registered before the /:publicId routes below so "unarchive-all" is never parsed as a
// tracker publicId. POST, not DELETE-with-a-flag, because restoring is its own intent.
TrackersRoutes.post("/unarchive-all", checkAuth, async (c) => {
  const userId = c.get("clerkUserId");

  const repo = new TrackersRepo(c.env);
  const response = await repo.unarchiveAllTrackers({ userId });

  return c.json(response, response.isSuccess ? 200 : 500);
});

// DEV_NOTE: registered before /:publicId below for the same reason as unarchive-all — "reorder"
// must never be parsed as a tracker publicId.
TrackersRoutes.post(
  "/reorder",
  checkAuth,
  zValidator("json", Schemas.ZReorderTrackersApiRequest),
  async (c) => {
    const userId = c.get("clerkUserId");
    const { trackerPublicIds } = c.req.valid("json");

    const repo = new TrackersRepo(c.env);
    const response = await repo.reorderTrackers({ userId, trackerPublicIds });

    return c.json(response, response.isSuccess ? 200 : 400);
  },
);

// DEV_NOTE: registered before /:publicId below for the same reason as unarchive-all — "today" must
// never be parsed as a tracker publicId.
TrackersRoutes.get(
  "/today/timeline",
  checkAuth,
  zValidator("query", Schemas.ZTrackerTimelineApiQuery),
  async (c) => {
    const userId = c.get("clerkUserId");
    const { date } = c.req.valid("query");

    const repo = new TrackersRepo(c.env);
    const response = await repo.getTimeline({ userId, date });

    return c.json(response, response.isSuccess ? 200 : 500);
  },
);

TrackersRoutes.post(
  "/:publicId/unarchive",
  checkAuth,
  zValidator("param", ZPublicIdParam),
  async (c) => {
    const userId = c.get("clerkUserId");
    const { publicId } = c.req.valid("param");

    const repo = new TrackersRepo(c.env);
    const response = await repo.unarchiveTracker({ userId, publicId });

    return c.json(response, response.isSuccess ? 200 : 404);
  },
);

TrackersRoutes.get("/:publicId", checkAuth, zValidator("param", ZPublicIdParam), async (c) => {
  const userId = c.get("clerkUserId");
  const { publicId } = c.req.valid("param");

  const repo = new TrackersRepo(c.env);
  const response = await repo.getTracker({ userId, publicId });

  return c.json(response, response.isSuccess ? 200 : 404);
});

// DEV_NOTE: PATCH, not PUT — the body is a partial by design (ZUpdateTrackerApiRequest), and the
// fields it deliberately can't name (control, compute, the primary metric) must keep their stored
// values rather than being absent from a full replacement.
TrackersRoutes.patch(
  "/:publicId",
  checkAuth,
  zValidator("param", ZPublicIdParam),
  zValidator("json", Schemas.ZUpdateTrackerApiRequest),
  async (c) => {
    const userId = c.get("clerkUserId");
    const { publicId } = c.req.valid("param");
    const body = c.req.valid("json");

    const repo = new TrackersRepo(c.env);
    const response = await repo.updateTracker({
      userId,
      publicId,
      tracker: body.tracker,
      targetEffectiveFrom: body.targetEffectiveFrom,
    });

    return c.json(response, response.isSuccess ? 200 : 404);
  },
);

TrackersRoutes.delete("/:publicId", checkAuth, zValidator("param", ZPublicIdParam), async (c) => {
  const userId = c.get("clerkUserId");
  const { publicId } = c.req.valid("param");

  const repo = new TrackersRepo(c.env);
  const response = await repo.archiveTracker({ userId, publicId });

  return c.json(response, response.isSuccess ? 200 : 404);
});

// DEV_NOTE: one write endpoint for all seven controls. The payload is discriminated on `control`
// and must match the tracker's manifest — a toggle payload sent to a timer is a 400, not a
// silently-wrong entry.
TrackersRoutes.post(
  "/:publicId/entries",
  checkAuth,
  zValidator("param", ZPublicIdParam),
  zValidator("json", Schemas.ZQuickAddApiRequest),
  async (c) => {
    const userId = c.get("clerkUserId");
    const { publicId } = c.req.valid("param");
    const { payload } = c.req.valid("json");

    const repo = new TrackersRepo(c.env);
    const response = await repo.quickAdd({ userId, publicId, payload });

    return c.json(response, response.isSuccess ? 201 : 400);
  },
);

TrackersRoutes.get(
  "/:publicId/entries",
  checkAuth,
  zValidator("param", ZPublicIdParam),
  zValidator("query", Schemas.ZTrackerRangeApiQuery),
  async (c) => {
    const userId = c.get("clerkUserId");
    const { publicId } = c.req.valid("param");
    const { from, to } = c.req.valid("query");

    const repo = new TrackersRepo(c.env);
    const response = await repo.getEntries({ userId, publicId, dateFrom: from, dateTo: to });

    return c.json(response, response.isSuccess ? 200 : 404);
  },
);

TrackersRoutes.get(
  "/:publicId/heatmap",
  checkAuth,
  zValidator("param", ZPublicIdParam),
  zValidator("query", Schemas.ZTrackerRangeApiQuery),
  async (c) => {
    const userId = c.get("clerkUserId");
    const { publicId } = c.req.valid("param");
    const { from, to } = c.req.valid("query");

    const repo = new TrackersRepo(c.env);
    const response = await repo.getHeatmap({ userId, publicId, dateFrom: from, dateTo: to });

    return c.json(response, response.isSuccess ? 200 : 404);
  },
);

TrackersRoutes.get(
  "/:publicId/breakdown",
  checkAuth,
  zValidator("param", ZPublicIdParam),
  zValidator("query", Schemas.ZTrackerBreakdownApiQuery),
  async (c) => {
    const userId = c.get("clerkUserId");
    const { publicId } = c.req.valid("param");
    const { from, to, role } = c.req.valid("query");

    const repo = new TrackersRepo(c.env);
    const response = await repo.getBreakdown({
      userId,
      publicId,
      dateFrom: from,
      dateTo: to,
      role,
    });

    return c.json(response, response.isSuccess ? 200 : 404);
  },
);

TrackersRoutes.get(
  "/:publicId/running",
  checkAuth,
  zValidator("param", ZPublicIdParam),
  async (c) => {
    const userId = c.get("clerkUserId");
    const { publicId } = c.req.valid("param");

    const repo = new TrackersRepo(c.env);
    const response = await repo.getRunningSession({ userId, publicId });

    return c.json(response, response.isSuccess ? 200 : 404);
  },
);

// DEV_NOTE: the target history's own surface, beside the PATCH that covers the common case. A
// target is a value from a date (see TrackerTargetsCommon), so editing when a goal started is a
// different act from editing the tracker, and it needs a route that can address one era.
TrackersRoutes.get(
  "/:publicId/targets",
  checkAuth,
  zValidator("param", ZPublicIdParam),
  async (c) => {
    const userId = c.get("clerkUserId");
    const { publicId } = c.req.valid("param");

    const repo = new TrackersRepo(c.env);
    const response = await repo.getTrackerTargets({ userId, publicId });

    return c.json(response, response.isSuccess ? 200 : 404);
  },
);

// DEV_NOTE: POST, and idempotent on (tracker, effectiveFrom) — setting a target for a date the
// history already covers replaces that era's value rather than failing on the unique index or
// stacking a second row on the same day.
TrackersRoutes.post(
  "/:publicId/targets",
  checkAuth,
  zValidator("param", ZPublicIdParam),
  zValidator("json", Schemas.ZCreateTrackerTargetApiRequest),
  async (c) => {
    const userId = c.get("clerkUserId");
    const { publicId } = c.req.valid("param");
    const body = c.req.valid("json");

    const repo = new TrackersRepo(c.env);
    const response = await repo.createTrackerTarget({ userId, publicId, target: body.target });

    return c.json(response, response.isSuccess ? 201 : 404);
  },
);

TrackersRoutes.delete(
  "/:publicId/targets/:targetPublicId",
  checkAuth,
  zValidator("param", ZPublicIdParam.extend({ targetPublicId: z.string() })),
  async (c) => {
    const userId = c.get("clerkUserId");
    const { publicId, targetPublicId } = c.req.valid("param");

    const repo = new TrackersRepo(c.env);
    const response = await repo.deleteTrackerTarget({ userId, publicId, targetPublicId });

    return c.json(response, response.isSuccess ? 200 : 404);
  },
);

// DEV_NOTE: the escape hatch's only HTTP surface (architecture.md §5) — the tracker's own manifest
// decides which module may run, so this can't be used to invoke arbitrary logic against any tracker.
TrackersRoutes.post(
  "/:publicId/compute",
  checkAuth,
  zValidator("param", ZPublicIdParam),
  zValidator("json", Schemas.ZRunComputeApiRequest),
  async (c) => {
    const userId = c.get("clerkUserId");
    const { publicId } = c.req.valid("param");
    const { compute } = c.req.valid("json");

    const repo = new TrackersRepo(c.env);
    const response = await repo.runCompute({ userId, publicId, compute });

    return c.json(response, response.isSuccess ? 201 : 400);
  },
);

export default TrackersRoutes;
