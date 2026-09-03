import { createMiddleware } from "hono/factory";
import AppLogger from "@/providers/logger";
import * as Schemas from "@app/schemas";
import ClerkProvider from "@/providers/clerk";
import type AppContext from "@/config/AppContext";

const checkAuth = createMiddleware<AppContext>(async (c, next) => {
  // DEV_NOTE: exact match only — APP_ENV must literally be "local", never `!== "production"`.
  // Unset/misspelled/staging/production always falls through to real Clerk auth below.
  if (c.env.APP_ENV === "local") {
    if (!c.env.DEV_USER_ID) {
      AppLogger.error({
        category: Schemas.LogCategory.Middleware,
        action: Schemas.LogAction.VerifyToken,
        message: "APP_ENV=local but DEV_USER_ID is unset — set it in .dev.vars",
      });
      return c.json({ isSuccess: false, message: "Server misconfigured for local auth" }, 500);
    }

    AppLogger.warn({
      category: Schemas.LogCategory.Middleware,
      action: Schemas.LogAction.VerifyToken,
      message: "Auth bypassed via APP_ENV=local",
      metadata: { userId: c.env.DEV_USER_ID },
    });

    c.set("clerkUserId", c.env.DEV_USER_ID);
    c.set("clerkEmail", "");
    c.set("clerkSessionId", "local-dev-session");

    await next();
    return;
  }

  const clerk = ClerkProvider.getClerkClient(c.env);

  const allowedOrigins = c.env.ALLOWED_CORS_ORIGIN.split(",");
  const requestState = await clerk.authenticateRequest(c.req.raw, {
    authorizedParties: allowedOrigins,
  });

  if (!requestState.isSignedIn) {
    AppLogger.warn({
      category: Schemas.LogCategory.Middleware,
      action: Schemas.LogAction.VerifyToken,
      message: "Unauthenticated request",
      metadata: { reason: requestState.reason },
    });
    return c.json({ isSuccess: false, message: "Can't authorize request" }, 401);
  }

  const auth = requestState.toAuth();
  const claims = auth.sessionClaims as Record<string, unknown>;
  const email =
    typeof claims["email"] === "string"
      ? claims["email"]
      : typeof claims["email_address"] === "string"
        ? claims["email_address"]
        : typeof claims["primary_email_address"] === "string"
          ? claims["primary_email_address"]
          : "";

  c.set("clerkUserId", auth.userId!);
  c.set("clerkEmail", email);
  c.set("clerkSessionId", auth.sessionId!);

  AppLogger.info({
    category: Schemas.LogCategory.Middleware,
    action: Schemas.LogAction.VerifyToken,
    message: "Request authenticated",
    metadata: { userId: auth.userId },
  });

  await next();
});

export default checkAuth;
