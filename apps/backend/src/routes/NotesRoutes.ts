import { Hono } from "hono";
import NotesRepo from "@/repositories/NotesRepo";
import checkAuth from "@/middlewares/AuthMiddleware";
import type AppContext from "@/config/AppContext";
import * as Schemas from "@app/schemas";
import { zValidator } from "@hono/zod-validator";
import z from "zod";

const NotesRoutes = new Hono<AppContext>();

NotesRoutes.post("/", checkAuth, zValidator("json", Schemas.ZCreateNoteApiRequest), async (c) => {
  const userId = c.get("clerkUserId");
  const body = c.req.valid("json");

  const repo = new NotesRepo(c.env);
  const response = await repo.createNote({
    note: body.note,
    userId,
  });

  return c.json(response, response.isSuccess ? 201 : 500);
});

NotesRoutes.get("/", checkAuth, async (c) => {
  const userId = c.get("clerkUserId");

  const repo = new NotesRepo(c.env);
  const response = await repo.getNotes({ userId });

  return c.json(response, response.isSuccess ? 200 : 500);
});

NotesRoutes.get("/:id", checkAuth, zValidator("param", z.object({ id: z.string() })), async (c) => {
  const userId = c.get("clerkUserId");
  const { id } = c.req.valid("param");

  const repo = new NotesRepo(c.env);
  const response = await repo.getNoteDetails({ id: Number(id), userId });

  return c.json(response, response.isSuccess ? 200 : 404);
});

NotesRoutes.patch(
  "/:id",
  checkAuth,
  zValidator("param", z.object({ id: z.string() })),
  zValidator("json", Schemas.ZUpdateNoteApiRequest),
  async (c) => {
    const userId = c.get("clerkUserId");
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    const repo = new NotesRepo(c.env);
    const response = await repo.updateNote({ id: Number(id), userId, ...body });

    return c.json(response, response.isSuccess ? 200 : 404);
  },
);

NotesRoutes.delete(
  "/:id",
  checkAuth,
  zValidator("param", z.object({ id: z.string() })),
  async (c) => {
    const userId = c.get("clerkUserId");
    const { id } = c.req.valid("param");

    const repo = new NotesRepo(c.env);
    const response = await repo.deleteNote({ id: Number(id), userId });

    return c.json(response, response.isSuccess ? 200 : 404);
  },
);

export default NotesRoutes;
