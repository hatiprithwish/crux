import { Hono } from "hono";
import MetricsRepo from "@/repositories/MetricsRepo";
import checkAuth from "@/middlewares/AuthMiddleware";
import type AppContext from "@/config/AppContext";
import * as Schemas from "@app/schemas";
import { zValidator } from "@hono/zod-validator";
import z from "zod";

// DEV_NOTE: metrics used to be declared only as a side effect of creating a tracker
// (ZTrackerMetricSpec's "new" branch), which made a mistyped one permanent — nothing could reach it
// afterwards to rename or remove it. This is the surface the /metrics screen edits, and the
// "existing" branch still reads its list to make two trackers roll into one number.
const MetricsRoutes = new Hono<AppContext>();

const ZPublicIdParam = z.object({ publicId: z.string() });

MetricsRoutes.post(
  "/",
  checkAuth,
  zValidator("json", Schemas.ZCreateMetricApiRequest),
  async (c) => {
    const userId = c.get("clerkUserId");
    const body = c.req.valid("json");

    const repo = new MetricsRepo(c.env);
    const response = await repo.createMetric({ metric: body.metric, userId });

    return c.json(response, response.isSuccess ? 201 : 500);
  },
);

MetricsRoutes.get("/", checkAuth, async (c) => {
  const userId = c.get("clerkUserId");

  const repo = new MetricsRepo(c.env);
  const response = await repo.getMetrics({ userId });

  return c.json(response, response.isSuccess ? 200 : 500);
});

MetricsRoutes.patch(
  "/:publicId",
  checkAuth,
  zValidator("param", ZPublicIdParam),
  zValidator("json", Schemas.ZUpdateMetricApiRequest),
  async (c) => {
    const userId = c.get("clerkUserId");
    const { publicId } = c.req.valid("param");
    const body = c.req.valid("json");

    const repo = new MetricsRepo(c.env);
    const response = await repo.updateMetric({ userId, publicId, metric: body.metric });

    return c.json(response, response.isSuccess ? 200 : 404);
  },
);

// DEV_NOTE: 409 rather than 404 when the metric exists but something still points at it — the
// request is refused because of the metric's state, not because it's missing, and the response
// carries the counts that caused the refusal. `usage` present is what distinguishes the two.
MetricsRoutes.delete("/:publicId", checkAuth, zValidator("param", ZPublicIdParam), async (c) => {
  const userId = c.get("clerkUserId");
  const { publicId } = c.req.valid("param");

  const repo = new MetricsRepo(c.env);
  const response = await repo.deleteMetric({ userId, publicId });

  if (response.isSuccess) return c.json(response, 200);
  return c.json(response, response.usage ? 409 : 404);
});

export default MetricsRoutes;
