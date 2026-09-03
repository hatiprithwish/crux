import { Hono } from "hono";
import EntitiesRepo from "@/repositories/EntitiesRepo";
import checkAuth from "@/middlewares/AuthMiddleware";
import type AppContext from "@/config/AppContext";
import * as Schemas from "@app/schemas";
import { zValidator } from "@hono/zod-validator";
import z from "zod";

// DEV_NOTE: replaces /money/accounts, /money/categories and /time/projects — one surface, `kind`
// picks which. See EntitiesRepo.
const EntitiesRoutes = new Hono<AppContext>();

const ZPublicIdParam = z.object({ publicId: z.string() });

EntitiesRoutes.post(
  "/",
  checkAuth,
  zValidator("json", Schemas.ZCreateEntityApiRequest),
  async (c) => {
    const userId = c.get("clerkUserId");
    const body = c.req.valid("json");

    const repo = new EntitiesRepo(c.env);
    const response = await repo.createEntity({ entity: body.entity, userId });

    return c.json(response, response.isSuccess ? 201 : 500);
  },
);

EntitiesRoutes.get("/", checkAuth, zValidator("query", Schemas.ZGetEntitiesApiQuery), async (c) => {
  const userId = c.get("clerkUserId");
  const { kind, archived } = c.req.valid("query");

  const repo = new EntitiesRepo(c.env);
  const response = await repo.getEntities({ userId, kind, archived: archived === "true" });

  return c.json(response, response.isSuccess ? 200 : 500);
});

// DEV_NOTE: registered before /:publicId so "unarchive-all" can't be read as an entity publicId.
EntitiesRoutes.post("/unarchive-all", checkAuth, async (c) => {
  const userId = c.get("clerkUserId");

  const repo = new EntitiesRepo(c.env);
  const response = await repo.unarchiveAllEntities({ userId });

  return c.json(response, response.isSuccess ? 200 : 500);
});

EntitiesRoutes.post(
  "/:publicId/unarchive",
  checkAuth,
  zValidator("param", ZPublicIdParam),
  async (c) => {
    const userId = c.get("clerkUserId");
    const { publicId } = c.req.valid("param");

    const repo = new EntitiesRepo(c.env);
    const response = await repo.unarchiveEntity({ userId, publicId });

    return c.json(response, response.isSuccess ? 200 : 404);
  },
);

EntitiesRoutes.get("/:publicId", checkAuth, zValidator("param", ZPublicIdParam), async (c) => {
  const userId = c.get("clerkUserId");
  const { publicId } = c.req.valid("param");

  const repo = new EntitiesRepo(c.env);
  const response = await repo.getEntity({ userId, publicId });

  return c.json(response, response.isSuccess ? 200 : 404);
});

EntitiesRoutes.patch(
  "/:publicId",
  checkAuth,
  zValidator("param", ZPublicIdParam),
  zValidator("json", Schemas.ZUpdateEntityApiRequest),
  async (c) => {
    const userId = c.get("clerkUserId");
    const { publicId } = c.req.valid("param");
    const body = c.req.valid("json");

    const repo = new EntitiesRepo(c.env);
    const response = await repo.updateEntity({ userId, publicId, entity: body.entity });

    return c.json(response, response.isSuccess ? 200 : 404);
  },
);

EntitiesRoutes.delete("/:publicId", checkAuth, zValidator("param", ZPublicIdParam), async (c) => {
  const userId = c.get("clerkUserId");
  const { publicId } = c.req.valid("param");

  const repo = new EntitiesRepo(c.env);
  const response = await repo.archiveEntity({ userId, publicId });

  return c.json(response, response.isSuccess ? 200 : 404);
});

// DEV_NOTE: implementation.md Phase 4 — the cross-domain read. Deliberately hung off the entity, not
// off a tracker: the question is "everything that points at this thing", and trackers are exactly
// what it looks past.
EntitiesRoutes.get(
  "/:publicId/rollup",
  checkAuth,
  zValidator("param", ZPublicIdParam),
  zValidator("query", Schemas.ZEntityRollupApiQuery),
  async (c) => {
    const userId = c.get("clerkUserId");
    const { publicId } = c.req.valid("param");
    const { from, to, role } = c.req.valid("query");

    const repo = new EntitiesRepo(c.env);
    const response = await repo.getRollup({ userId, publicId, dateFrom: from, dateTo: to, role });

    return c.json(response, response.isSuccess ? 200 : 404);
  },
);

export default EntitiesRoutes;
