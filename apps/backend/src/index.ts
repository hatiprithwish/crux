import { honoLogger } from "@logtape/hono";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { requestId } from "hono/request-id";
import { configureLogger, disposeLogger, withRequestContext } from "@/providers/logger";
import AuthRoutes from "@/routes/AuthRoutes";
import UsersRoutes from "@/routes/UserRoutes";
import NotesRoutes from "@/routes/NotesRoutes";
import TrackersRoutes from "@/routes/TrackersRoutes";
import EntitiesRoutes from "@/routes/EntitiesRoutes";
import MetricsRoutes from "@/routes/MetricsRoutes";
import OrphanScanRepo from "@/repositories/OrphanScanRepo";
import * as Schemas from "@app/schemas";
import Constants from "@/config/Constants";

// DEV_NOTE: Configure logger at the top level to ensure it's ready before handling any requests
await configureLogger();

const app = new Hono<{ Bindings: Env }>();

app.use((c, next) =>
  cors({
    origin: (origin) => {
      const allowed = c.env.ALLOWED_CORS_ORIGIN.split(",");
      return allowed.includes(origin) ? origin : null;
    },
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "x-request-id"],
    exposeHeaders: ["x-request-id"],
    maxAge: 7200,
    credentials: true,
  })(c, next),
);
app.use(requestId({ headerName: "x-request-id" }));

app.use(async (c, next) => {
  await withRequestContext(c.get("requestId"), next);
});

app.use(
  honoLogger({
    category: [Constants.APP_NAME, Schemas.LogCategory.Middleware],
    level: "info",
  }),
);

app.route("/auth", AuthRoutes);
app.route("/users", UsersRoutes);
app.route("/notes", NotesRoutes);
// DEV_NOTE: the manifest engine's three surfaces replaced /habits, /money and /time — a tracker is
// a row whose manifest says what it is (architecture.md §7 step 4), entities are the shared named
// things any tracker links entries to, and metrics is what "reuse a metric" reads from.
app.route("/trackers", TrackersRoutes);
app.route("/entities", EntitiesRoutes);
app.route("/metrics", MetricsRoutes);

export default {
  fetch(req: Request, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(disposeLogger());
    return app.fetch(req, env, ctx);
  },
  // DEV_NOTE: architecture.md §4.1 — weekly cron trigger (see wrangler.jsonc's triggers.crons) that
  // runs the orphan scan and logs any non-zero count as a bug signal. No HTTP surface, so this
  // bypasses the Hono app entirely and calls the Repo directly.
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    // DEV_NOTE: the module-level `await configureLogger()` above already ran before this handler
    // can be invoked — mirrors fetch(), which only ever disposes, never re-configures.
    ctx.waitUntil(new OrphanScanRepo(env).runScan().then(() => disposeLogger()));
  },
};
