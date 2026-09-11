import { Hono } from "hono";
import NotificationsRepo from "@/repositories/NotificationsRepo";
import checkAuth from "@/middlewares/AuthMiddleware";
import type AppContext from "@/config/AppContext";
import * as Schemas from "@app/schemas";
import { zValidator } from "@hono/zod-validator";
import z from "zod";

const NotificationsRoutes = new Hono<AppContext>();

const ZPublicIdParam = z.object({ publicId: z.string() });

NotificationsRoutes.get("/vapid-public-key", checkAuth, async (c) => {
  const repo = new NotificationsRepo(c.env);
  const response = repo.getVapidPublicKey();

  return c.json(response, response.isSuccess ? 200 : 500);
});

NotificationsRoutes.post(
  "/subscriptions",
  checkAuth,
  zValidator("json", Schemas.ZCreatePushSubscriptionApiRequest),
  async (c) => {
    const userId = c.get("clerkUserId");
    const body = c.req.valid("json");

    const repo = new NotificationsRepo(c.env);
    const response = await repo.createPushSubscription({ subscription: body.subscription, userId });

    return c.json(response, response.isSuccess ? 201 : 500);
  },
);

NotificationsRoutes.get("/subscriptions", checkAuth, async (c) => {
  const userId = c.get("clerkUserId");

  const repo = new NotificationsRepo(c.env);
  const response = await repo.getPushSubscriptions({ userId });

  return c.json(response, response.isSuccess ? 200 : 500);
});

NotificationsRoutes.delete(
  "/subscriptions/:publicId",
  checkAuth,
  zValidator("param", ZPublicIdParam),
  async (c) => {
    const userId = c.get("clerkUserId");
    const { publicId } = c.req.valid("param");

    const repo = new NotificationsRepo(c.env);
    const response = await repo.deletePushSubscription({ userId, publicId });

    return c.json(response, response.isSuccess ? 200 : 404);
  },
);

NotificationsRoutes.get("/prefs", checkAuth, async (c) => {
  const userId = c.get("clerkUserId");

  const repo = new NotificationsRepo(c.env);
  const response = await repo.getNotificationPrefs({ userId });

  return c.json(response, response.isSuccess ? 200 : 500);
});

NotificationsRoutes.patch(
  "/prefs",
  checkAuth,
  zValidator("json", Schemas.ZUpdateNotificationPrefsApiRequest),
  async (c) => {
    const userId = c.get("clerkUserId");
    const body = c.req.valid("json");

    const repo = new NotificationsRepo(c.env);
    const response = await repo.updateNotificationPrefs({ ...body, userId });

    return c.json(response, response.isSuccess ? 200 : 500);
  },
);

// DEV_NOTE: crons are production-only, so this is the only way to exercise push end to end in
// staging, and it doubles as the settings screen's "Send a test notification" button.
NotificationsRoutes.post("/test", checkAuth, async (c) => {
  const userId = c.get("clerkUserId");

  const repo = new NotificationsRepo(c.env);
  const response = await repo.sendTestNotification({ userId });

  return c.json(response, response.isSuccess ? 200 : 500);
});

export default NotificationsRoutes;
