import { Hono } from "hono";
import MetricsRepo from "@/repositories/MetricsRepo";
import checkAuth from "@/middlewares/AuthMiddleware";
import type AppContext from "@/config/AppContext";
import * as Schemas from "@app/schemas";
import { zValidator } from "@hono/zod-validator";

// DEV_NOTE: read-mostly — metrics are usually declared as a side effect of creating a tracker
// (ZTrackerMetricSpec's "new" branch). This exists so the tracker-create form can offer the
// "existing" branch, which is what makes two trackers roll into one number.
const MetricsRoutes = new Hono<AppContext>();

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

export default MetricsRoutes;
