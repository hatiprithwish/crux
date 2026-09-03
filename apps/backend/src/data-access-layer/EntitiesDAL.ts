import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import getDbClient from "@/db/dbClient";
import { entities } from "@/db/tables";
import * as Schemas from "@app/schemas";
import AppLogger from "@/providers/logger";
import Utility from "@/utils/Utility";

type CreateEntityParams = {
  userId: string;
  kind: Schemas.EntityKind;
  name: string;
  emoji?: string | null;
  colorIndex?: number | null;
  parentId?: number | null;
  status?: Schemas.EntityStatus | null;
  startedOn?: string | null;
  endedOn?: string | null;
  sortOrder?: number;
};

export default class EntitiesDAL {
  private db: DrizzleD1Database;

  constructor(env: Env) {
    this.db = getDbClient(env);
  }

  async createEntity(params: CreateEntityParams) {
    const response: Schemas.ApiResponse & { entity?: Schemas.Entity } = { isSuccess: false };

    try {
      const now = new Date();
      const entityResponse = await this.db
        .insert(entities)
        .values({
          publicId: Utility.generatePublicId("ent_"),
          userId: params.userId,
          kind: params.kind,
          name: params.name,
          emoji: params.emoji ?? null,
          colorIndex: params.colorIndex ?? null,
          parentId: params.parentId ?? null,
          status: params.status ?? null,
          startedOn: params.startedOn ?? null,
          endedOn: params.endedOn ?? null,
          sortOrder: params.sortOrder ?? 0,
          createdAt: now,
          updatedAt: null,
        })
        .returning()
        .get();

      response.isSuccess = true;
      response.message = "Entity created successfully";
      response.entity = entityResponse;
    } catch (error) {
      const message = "Unknown error in creating entity";
      AppLogger.error({
        category: Schemas.LogCategory.DAL,
        action: Schemas.LogAction.CreateEntity,
        message,
        error,
        metadata: params,
      });
      response.message = message;
    }

    return response;
  }

  // DEV_NOTE: partial by construction — only the fields the caller actually sent are written, so a
  // rename can't blank an emoji the form never showed. `kind` is absent on purpose (see
  // ZUpdateEntityApiRequest): an entity's kind is load-bearing for every entry_entities role that
  // already points at it.
  async updateEntity(params: {
    userId: string;
    publicId: string;
    fields: {
      name?: string;
      emoji?: string | null;
      colorIndex?: number | null;
      parentId?: number | null;
      status?: Schemas.EntityStatus | null;
      startedOn?: string | null;
      endedOn?: string | null;
      sortOrder?: number;
    };
  }) {
    const response: Schemas.ApiResponse & { entity?: Schemas.Entity } = { isSuccess: false };

    try {
      const now = new Date();
      const entityResponse = await this.db
        .update(entities)
        .set({ ...params.fields, updatedAt: now })
        .where(
          and(
            eq(entities.publicId, params.publicId),
            eq(entities.userId, params.userId),
            isNull(entities.deletedAt),
          ),
        )
        .returning()
        .get();

      if (!entityResponse) {
        const message = "Entity not found";
        AppLogger.error({
          category: Schemas.LogCategory.DAL,
          action: Schemas.LogAction.UpdateEntity,
          message,
          metadata: params,
        });
        response.message = message;
        return response;
      }

      response.isSuccess = true;
      response.message = "Entity updated successfully";
      response.entity = entityResponse;
    } catch (error) {
      const message = "Unknown error in updating entity";
      AppLogger.error({
        category: Schemas.LogCategory.DAL,
        action: Schemas.LogAction.UpdateEntity,
        message,
        error,
        metadata: params,
      });
      response.message = message;
    }

    return response;
  }

  // DEV_NOTE: unlike getEntities, archived/deleted entities are still findable here — archiving
  // hides an entity from its list, it doesn't delete it, and its historical entries should stay
  // reachable. Soft-deleted ones are excluded (invariant 9 doesn't mean "still fully live").
  async getEntity(params: { userId: string; publicId: string }) {
    const response: Schemas.ApiResponse & { entity?: Schemas.Entity } = { isSuccess: false };

    try {
      const [entity] = await this.db
        .select()
        .from(entities)
        .where(
          and(
            eq(entities.publicId, params.publicId),
            eq(entities.userId, params.userId),
            isNull(entities.deletedAt),
          ),
        )
        .limit(1);

      if (!entity) {
        const message = "Entity not found";
        AppLogger.error({
          category: Schemas.LogCategory.DAL,
          action: Schemas.LogAction.GetEntityDetails,
          message,
          metadata: params,
        });
        response.message = message;
        return response;
      }

      response.isSuccess = true;
      response.message = "Entity fetched successfully";
      response.entity = entity;
    } catch (error) {
      const message = "Unknown error in fetching entity";
      AppLogger.error({
        category: Schemas.LogCategory.DAL,
        action: Schemas.LogAction.GetEntityDetails,
        message,
        error,
        metadata: params,
      });
      response.message = message;
    }

    return response;
  }

  // DEV_NOTE: archived/deleted entities are excluded — archiving is the only "delete" a client can
  // do to an entity, so a plain list should never surface one again.
  // DEV_NOTE: `kind` is optional so the restore screen can list every archived entity at once —
  // asking a user which kind of thing they archived before showing them what they archived is
  // backwards. `archived: true` flips the archived filter the same way getTrackers does.
  async getEntities(params: { userId: string; kind?: Schemas.EntityKind; archived?: boolean }) {
    const response: Schemas.ApiResponse & { entities?: Schemas.Entity[] } = { isSuccess: false };

    try {
      const entitiesResponse = await this.db
        .select()
        .from(entities)
        .where(
          and(
            eq(entities.userId, params.userId),
            params.kind ? eq(entities.kind, params.kind) : undefined,
            params.archived ? isNotNull(entities.archivedAt) : isNull(entities.archivedAt),
            isNull(entities.deletedAt),
          ),
        );

      response.isSuccess = true;
      response.message = "Entities fetched successfully";
      response.entities = entitiesResponse;
    } catch (error) {
      const message = "Unknown error in listing entities";
      AppLogger.error({
        category: Schemas.LogCategory.DAL,
        action: Schemas.LogAction.GetEntities,
        message,
        error,
        metadata: params,
      });
      response.message = message;
    }

    return response;
  }

  // DEV_NOTE: internal-only, DAL-to-DAL lookup (e.g. MoneyRepo resolving entry_entities' entityId
  // ints back to publicId for a response) — never exposed as its own route, so taking ids in is fine
  // here even though nothing crossing the API boundary ever carries an id (invariant 11). Includes
  // archived entities on purpose: a past expense against a since-archived category must still
  // resolve, the same way getEntity (singular) already does.
  async getEntitiesByIds(params: { userId: string; ids: number[] }) {
    const response: Schemas.ApiResponse & { entities?: Schemas.Entity[] } = { isSuccess: false };

    if (params.ids.length === 0) {
      response.isSuccess = true;
      response.message = "Entities fetched successfully";
      response.entities = [];
      return response;
    }

    try {
      // DEV_NOTE: chunked for D1's 100-bound-parameter cap — the caller's id list is however many
      // entities a range of entries happened to touch, which is not a number this can assume.
      const entitiesResponse: Schemas.Entity[] = [];
      for (const ids of Utility.chunk(params.ids)) {
        const rows = await this.db
          .select()
          .from(entities)
          .where(
            and(
              eq(entities.userId, params.userId),
              inArray(entities.id, ids),
              isNull(entities.deletedAt),
            ),
          );
        entitiesResponse.push(...rows);
      }

      response.isSuccess = true;
      response.message = "Entities fetched successfully";
      response.entities = entitiesResponse;
    } catch (error) {
      const message = "Unknown error in listing entities by id";
      AppLogger.error({
        category: Schemas.LogCategory.DAL,
        action: Schemas.LogAction.GetEntities,
        message,
        error,
        metadata: params,
      });
      response.message = message;
    }

    return response;
  }

  async archiveEntity(params: { userId: string; publicId: string }) {
    const response: Schemas.ApiResponse & { entity?: Schemas.Entity } = { isSuccess: false };

    try {
      const now = new Date();
      const entityResponse = await this.db
        .update(entities)
        .set({ archivedAt: now, updatedAt: now })
        .where(
          and(
            eq(entities.publicId, params.publicId),
            eq(entities.userId, params.userId),
            isNull(entities.deletedAt),
          ),
        )
        .returning()
        .get();

      if (!entityResponse) {
        const message = "Entity not found";
        AppLogger.error({
          category: Schemas.LogCategory.DAL,
          action: Schemas.LogAction.ArchiveEntity,
          message,
          metadata: params,
        });
        response.message = message;
        return response;
      }

      response.isSuccess = true;
      response.message = "Entity archived successfully";
      response.entity = entityResponse;
    } catch (error) {
      const message = "Unknown error in archiving entity";
      AppLogger.error({
        category: Schemas.LogCategory.DAL,
        action: Schemas.LogAction.ArchiveEntity,
        message,
        error,
        metadata: params,
      });
      response.message = message;
    }

    return response;
  }

  // DEV_NOTE: the inverse of archiveEntity. Unlike a tracker there's no active_to to clear — an
  // entity has started_on/ended_on, which are user-stated facts about the thing itself, not
  // archival bookkeeping, so restoring must leave them exactly as they were.
  async unarchiveEntity(params: { userId: string; publicId: string }) {
    const response: Schemas.ApiResponse & { entity?: Schemas.Entity } = { isSuccess: false };

    try {
      const now = new Date();
      const entityResponse = await this.db
        .update(entities)
        .set({ archivedAt: null, updatedAt: now })
        .where(
          and(
            eq(entities.publicId, params.publicId),
            eq(entities.userId, params.userId),
            isNotNull(entities.archivedAt),
            isNull(entities.deletedAt),
          ),
        )
        .returning()
        .get();

      if (!entityResponse) {
        const message = "Archived entity not found";
        AppLogger.error({
          category: Schemas.LogCategory.DAL,
          action: Schemas.LogAction.UnarchiveEntity,
          message,
          metadata: params,
        });
        response.message = message;
        return response;
      }

      response.isSuccess = true;
      response.message = "Entity restored successfully";
      response.entity = entityResponse;
    } catch (error) {
      const message = "Unknown error in restoring entity";
      AppLogger.error({
        category: Schemas.LogCategory.DAL,
        action: Schemas.LogAction.UnarchiveEntity,
        message,
        error,
        metadata: params,
      });
      response.message = message;
    }

    return response;
  }

  async unarchiveAllEntities(params: { userId: string }) {
    const response: Schemas.ApiResponse & { restoredCount?: number } = { isSuccess: false };

    try {
      const now = new Date();
      const restored = await this.db
        .update(entities)
        .set({ archivedAt: null, updatedAt: now })
        .where(
          and(
            eq(entities.userId, params.userId),
            isNotNull(entities.archivedAt),
            isNull(entities.deletedAt),
          ),
        )
        .returning();

      response.isSuccess = true;
      response.message = "Entities restored successfully";
      response.restoredCount = restored.length;
    } catch (error) {
      const message = "Unknown error in restoring entities";
      AppLogger.error({
        category: Schemas.LogCategory.DAL,
        action: Schemas.LogAction.UnarchiveEntity,
        message,
        error,
        metadata: params,
      });
      response.message = message;
    }

    return response;
  }

  // DEV_NOTE: invariant 9 — soft delete only. No hard deletes, ever.
  async deleteEntity(params: { userId: string; publicId: string }) {
    const response: Schemas.ApiResponse = { isSuccess: false };

    try {
      const now = new Date();
      const deleted = await this.db
        .update(entities)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(
            eq(entities.publicId, params.publicId),
            eq(entities.userId, params.userId),
            isNull(entities.deletedAt),
          ),
        )
        .returning()
        .get();

      if (!deleted) {
        const message = "Entity not found";
        AppLogger.error({
          category: Schemas.LogCategory.DAL,
          action: Schemas.LogAction.DeleteEntity,
          message,
          metadata: params,
        });
        response.message = message;
        return response;
      }

      response.isSuccess = true;
      response.message = "Entity deleted successfully";
    } catch (error) {
      const message = "Unknown error in deleting entity";
      AppLogger.error({
        category: Schemas.LogCategory.DAL,
        action: Schemas.LogAction.DeleteEntity,
        message,
        error,
        metadata: params,
      });
      response.message = message;
    }

    return response;
  }
}
