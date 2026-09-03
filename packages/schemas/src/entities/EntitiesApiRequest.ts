import { z } from "zod";
import { ZEntityBase, ZEntityKind } from "../core";
import { ZEntityRollupQuery } from "./EntitiesRollupCommon";

// DEV_NOTE: one entity API for every domain — Money's accounts (kind "account") and categories
// (kind "tag") and Time's projects (kind "project") were three near-identical CRUD surfaces on
// three domain Repos before the manifest engine; `kind` is the only thing that differed.
export const ZCreateEntityApiRequest = z.object({
  entity: ZEntityBase,
});
export type CreateEntityApiRequest = z.infer<typeof ZCreateEntityApiRequest>;

// DEV_NOTE: kind is optional — the restore screen lists every archived entity regardless of kind,
// and making someone pick a kind before seeing what they archived is backwards.
// DEV_NOTE: `kind` is deliberately absent — everything else about an entity is editable, but its
// kind is not. entry_entities records the ROLE at write time, and roles mirror kinds: turning an
// account into a project would leave every past expense linked under role "account" to a thing that
// claims to be a project, and invariant 6's "exactly one role" slices would quietly disagree with
// the entity list. Wrong kind = archive it and make the right one.
// DEV_NOTE: strict, so sending `kind` is a 400 rather than being silently stripped — a client that
// thinks it changed something and didn't is worse than a rejection. The refine makes an empty patch
// a validation error too, instead of a request that bumps updated_at for nothing.
export const ZUpdateEntityApiRequest = z.object({
  entity: ZEntityBase.omit({ kind: true })
    .partial()
    .strict()
    .refine((entity) => Object.keys(entity).length > 0, {
      message: "Provide at least one field to update",
    }),
});
export type UpdateEntityApiRequest = z.infer<typeof ZUpdateEntityApiRequest>;

export const ZGetEntitiesApiQuery = z.object({
  kind: ZEntityKind.optional(),
  archived: z.enum(["true", "false"]).optional(),
});
export type GetEntitiesApiQuery = z.infer<typeof ZGetEntitiesApiQuery>;

export const ZEntityRollupApiQuery = ZEntityRollupQuery;
export type EntityRollupApiQuery = z.infer<typeof ZEntityRollupApiQuery>;
