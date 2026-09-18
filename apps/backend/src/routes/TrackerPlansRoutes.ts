import { Hono } from "hono";
import TrackerPlansRepo from "@/repositories/TrackerPlansRepo";
import checkAuth from "@/middlewares/AuthMiddleware";
import type AppContext from "@/config/AppContext";
import * as Schemas from "@app/schemas";
import { zValidator } from "@hono/zod-validator";
import z from "zod";

// DEV_NOTE: mounted at /trackers/:trackerPublicId (see index.ts) — plans and moments only exist
// under a tracker, and the tracker's publicId in the path is what every handler scopes by.
const TrackerPlansRoutes = new Hono<AppContext>();

const ZTrackerParam = z.object({ trackerPublicId: z.string() });
const ZPlanParam = ZTrackerParam.extend({ planPublicId: z.string() });
const ZMomentParam = ZTrackerParam.extend({ momentPublicId: z.string() });

TrackerPlansRoutes.get("/plans", checkAuth, zValidator("param", ZTrackerParam), async (c) => {
  const userId = c.get("clerkUserId");
  const { trackerPublicId } = c.req.valid("param");

  const repo = new TrackerPlansRepo(c.env);
  const response = await repo.getPlans({ userId, trackerPublicId });

  return c.json(response, response.isSuccess ? 200 : 404);
});

TrackerPlansRoutes.post(
  "/plans",
  checkAuth,
  zValidator("param", ZTrackerParam),
  zValidator("json", Schemas.ZCreateTrackerPlanApiRequest),
  async (c) => {
    const userId = c.get("clerkUserId");
    const { trackerPublicId } = c.req.valid("param");
    const body = c.req.valid("json");

    const repo = new TrackerPlansRepo(c.env);
    const response = await repo.createPlan({ ...body, userId, trackerPublicId });

    return c.json(response, response.isSuccess ? 201 : 404);
  },
);

TrackerPlansRoutes.patch(
  "/plans/:planPublicId",
  checkAuth,
  zValidator("param", ZPlanParam),
  zValidator("json", Schemas.ZUpdateTrackerPlanApiRequest),
  async (c) => {
    const userId = c.get("clerkUserId");
    const { trackerPublicId, planPublicId } = c.req.valid("param");
    const body = c.req.valid("json");

    const repo = new TrackerPlansRepo(c.env);
    const response = await repo.updatePlan({ ...body, userId, trackerPublicId, planPublicId });

    return c.json(response, response.isSuccess ? 200 : 404);
  },
);

TrackerPlansRoutes.delete(
  "/plans/:planPublicId",
  checkAuth,
  zValidator("param", ZPlanParam),
  async (c) => {
    const userId = c.get("clerkUserId");
    const { trackerPublicId, planPublicId } = c.req.valid("param");

    const repo = new TrackerPlansRepo(c.env);
    const response = await repo.deletePlan({ userId, trackerPublicId, planPublicId });

    return c.json(response, response.isSuccess ? 200 : 404);
  },
);

TrackerPlansRoutes.get(
  "/moments",
  checkAuth,
  zValidator("param", ZTrackerParam),
  zValidator("query", Schemas.ZGetTrackerMomentsApiQuery),
  async (c) => {
    const userId = c.get("clerkUserId");
    const { trackerPublicId } = c.req.valid("param");
    const { from, to } = c.req.valid("query");

    const repo = new TrackerPlansRepo(c.env);
    const response = await repo.getMoments({
      userId,
      trackerPublicId,
      dateFrom: from,
      dateTo: to,
    });

    return c.json(response, response.isSuccess ? 200 : 404);
  },
);

TrackerPlansRoutes.post(
  "/moments",
  checkAuth,
  zValidator("param", ZTrackerParam),
  zValidator("json", Schemas.ZCreateTrackerMomentApiRequest),
  async (c) => {
    const userId = c.get("clerkUserId");
    const { trackerPublicId } = c.req.valid("param");
    const body = c.req.valid("json");

    const repo = new TrackerPlansRepo(c.env);
    const response = await repo.createMoment({ ...body, userId, trackerPublicId });

    return c.json(response, response.isSuccess ? 201 : 400);
  },
);

TrackerPlansRoutes.delete(
  "/moments/:momentPublicId",
  checkAuth,
  zValidator("param", ZMomentParam),
  async (c) => {
    const userId = c.get("clerkUserId");
    const { trackerPublicId, momentPublicId } = c.req.valid("param");

    const repo = new TrackerPlansRepo(c.env);
    const response = await repo.deleteMoment({ userId, trackerPublicId, momentPublicId });

    return c.json(response, response.isSuccess ? 200 : 404);
  },
);

export default TrackerPlansRoutes;
