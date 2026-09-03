import { Hono } from "hono";
import UsersRepo from "@/repositories/UsersRepo";
import checkAuth from "@/middlewares/AuthMiddleware";
import ClerkProvider from "@/providers/clerk";
import type AppContext from "@/config/AppContext";
import * as Schemas from "@app/schemas";
import AppLogger from "@/providers/logger";

const UsersRoutes = new Hono<AppContext>();

UsersRoutes.post("/clerk-sync", checkAuth, async (c) => {
  const clerkId = c.get("clerkUserId");

  const clerk = ClerkProvider.getClerkClient(c.env);

  let email: string;
  try {
    const clerkUser = await clerk.users.getUser(clerkId);
    email = clerkUser.emailAddresses[0]?.emailAddress ?? "";
  } catch (error) {
    const message = "Failed to fetch user from Clerk";
    AppLogger.error({
      category: Schemas.LogCategory.Route,
      action: Schemas.LogAction.SyncClerkUser,
      message,
      error,
      metadata: { clerkId },
    });
    return c.json({ isSuccess: false, message }, 500);
  }

  const repo = new UsersRepo(c.env);
  const response = await repo.syncClerkUser({
    clerkId,
    email,
    role: Schemas.UserRoleEnum.User,
  });

  return c.json(response, response.isSuccess ? 200 : 500);
});

UsersRoutes.get("/me", checkAuth, async (c) => {
  const clerkId = c.get("clerkUserId");

  const repo = new UsersRepo(c.env);
  const response = await repo.getUserDetails({ clerkId });

  return c.json(response, response.isSuccess ? 200 : 404);
});

export default UsersRoutes;
