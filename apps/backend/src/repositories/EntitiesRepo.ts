import EntitiesDAL from "@/data-access-layer/EntitiesDAL";
import EntriesDAL from "@/data-access-layer/EntriesDAL";
import MetricsDAL from "@/data-access-layer/MetricsDAL";
import type * as Schemas from "@app/schemas";

// DEV_NOTE: the generic replacement for MoneyRepo's account/category CRUD and TimeRepo's project
// CRUD — three copies of the same six methods that differed only by `kind`. Entities live outside
// trackers precisely so the same one can be referenced from any number of them (architecture.md §5),
// which is what makes a single surface the right shape here.
export default class EntitiesRepo {
  private entitiesDal: EntitiesDAL;
  private entriesDal: EntriesDAL;
  private metricsDal: MetricsDAL;

  constructor(env: Env) {
    this.entitiesDal = new EntitiesDAL(env);
    this.entriesDal = new EntriesDAL(env);
    this.metricsDal = new MetricsDAL(env);
  }

  // DEV_NOTE: invariant 11 — id/parentId are internal join keys and never leave the server;
  // parentPublicId crosses the API boundary instead.
  private toApiShape(
    entity: Schemas.Entity,
    parentPublicId: string | null,
  ): Schemas.EntityApiShape {
    const { id: _id, parentId: _parentId, deletedAt: _deletedAt, ...rest } = entity;
    return { ...rest, parentPublicId };
  }

  private async resolveParentPublicId(
    userId: string,
    parentId: number | null,
  ): Promise<string | null> {
    if (parentId === null) return null;
    const result = await this.entitiesDal.getEntitiesByIds({ userId, ids: [parentId] });
    return result.entities?.[0]?.publicId ?? null;
  }

  async createEntity(
    params: Schemas.CreateEntityApiRequest & { userId: string },
  ): Promise<Schemas.CreateEntityApiResponse> {
    let parentId: number | null = null;

    if (params.entity.parentPublicId) {
      const parent = await this.entitiesDal.getEntity({
        userId: params.userId,
        publicId: params.entity.parentPublicId,
      });
      if (!parent.isSuccess || !parent.entity) {
        return { isSuccess: false, message: "Parent entity not found" };
      }
      parentId = parent.entity.id;
    }

    const result = await this.entitiesDal.createEntity({
      userId: params.userId,
      kind: params.entity.kind,
      name: params.entity.name,
      emoji: params.entity.emoji,
      colorIndex: params.entity.colorIndex,
      parentId,
      status: params.entity.status,
      startedOn: params.entity.startedOn,
      endedOn: params.entity.endedOn,
      sortOrder: params.entity.sortOrder,
    });
    if (!result.isSuccess || !result.entity) {
      return { isSuccess: false, message: result.message };
    }

    return {
      isSuccess: true,
      message: "Entity created successfully",
      entity: this.toApiShape(result.entity, params.entity.parentPublicId ?? null),
    };
  }

  // DEV_NOTE: an archived entity stays editable — fixing a typo in something you archived shouldn't
  // require restoring it first, and archiving is a visibility flag, not a lock.
  async updateEntity(
    params: Schemas.UpdateEntityApiRequest & { userId: string; publicId: string },
  ): Promise<Schemas.UpdateEntityApiResponse> {
    const existing = await this.entitiesDal.getEntity({
      userId: params.userId,
      publicId: params.publicId,
    });
    if (!existing.isSuccess || !existing.entity) {
      return { isSuccess: false, message: existing.message ?? "Entity not found" };
    }

    const fields: Parameters<EntitiesDAL["updateEntity"]>[0]["fields"] = {};
    if (params.entity.name !== undefined) fields.name = params.entity.name;
    if (params.entity.emoji !== undefined) fields.emoji = params.entity.emoji;
    if (params.entity.colorIndex !== undefined) fields.colorIndex = params.entity.colorIndex;
    if (params.entity.status !== undefined) fields.status = params.entity.status;
    if (params.entity.startedOn !== undefined) fields.startedOn = params.entity.startedOn;
    if (params.entity.endedOn !== undefined) fields.endedOn = params.entity.endedOn;
    if (params.entity.sortOrder !== undefined) fields.sortOrder = params.entity.sortOrder;

    // DEV_NOTE: architecture.md §4.1 point 1 — the repository resolves relationship columns by
    // public_id on the way in. Explicit null clears the parent; an absent key leaves it alone.
    let parentPublicId: string | null | undefined =
      existing.entity.parentId === null ? null : undefined;
    if (params.entity.parentPublicId !== undefined) {
      if (params.entity.parentPublicId === null) {
        fields.parentId = null;
        parentPublicId = null;
      } else {
        if (params.entity.parentPublicId === params.publicId) {
          return { isSuccess: false, message: "An entity cannot be its own parent" };
        }
        const parent = await this.entitiesDal.getEntity({
          userId: params.userId,
          publicId: params.entity.parentPublicId,
        });
        if (!parent.isSuccess || !parent.entity) {
          return { isSuccess: false, message: "Parent entity not found" };
        }
        fields.parentId = parent.entity.id;
        parentPublicId = parent.entity.publicId;
      }
    }

    if (Object.keys(fields).length === 0) {
      return { isSuccess: false, message: "Nothing to update" };
    }

    const result = await this.entitiesDal.updateEntity({
      userId: params.userId,
      publicId: params.publicId,
      fields,
    });
    if (!result.isSuccess || !result.entity) {
      return { isSuccess: false, message: result.message };
    }

    return {
      isSuccess: true,
      message: "Entity updated successfully",
      entity: this.toApiShape(
        result.entity,
        parentPublicId !== undefined
          ? parentPublicId
          : await this.resolveParentPublicId(params.userId, result.entity.parentId),
      ),
    };
  }

  async getEntities(params: {
    userId: string;
    kind?: Schemas.EntityKind;
    archived?: boolean;
  }): Promise<Schemas.GetEntitiesApiResponse> {
    const result = await this.entitiesDal.getEntities(params);
    if (!result.isSuccess || !result.entities) {
      return { isSuccess: false, message: result.message };
    }

    const parentIds = [
      ...new Set(
        result.entities.flatMap((entity) => (entity.parentId === null ? [] : [entity.parentId])),
      ),
    ];
    const parents = parentIds.length
      ? await this.entitiesDal.getEntitiesByIds({ userId: params.userId, ids: parentIds })
      : { entities: [] as Schemas.Entity[] };
    const publicIdById = new Map((parents.entities ?? []).map((e) => [e.id, e.publicId]));

    return {
      isSuccess: true,
      message: "Entities fetched successfully",
      entities: result.entities.map((entity) =>
        this.toApiShape(
          entity,
          entity.parentId === null ? null : (publicIdById.get(entity.parentId) ?? null),
        ),
      ),
    };
  }

  async getEntity(params: {
    userId: string;
    publicId: string;
  }): Promise<Schemas.GetEntityApiResponse> {
    const result = await this.entitiesDal.getEntity(params);
    if (!result.isSuccess || !result.entity) {
      return { isSuccess: false, message: result.message };
    }

    return {
      isSuccess: true,
      message: "Entity fetched successfully",
      entity: this.toApiShape(
        result.entity,
        await this.resolveParentPublicId(params.userId, result.entity.parentId),
      ),
    };
  }

  // DEV_NOTE: architecture.md §6 / implementation.md Phase 4 — one entity's total across every
  // metric that points at it, which is the whole payoff of metrics being declared globally rather
  // than per tracker (§5). A tracker never appears here: two trackers writing the same metric roll
  // into one row, which is exactly the point.
  async getRollup(params: {
    userId: string;
    publicId: string;
    dateFrom: string;
    dateTo: string;
    role?: Schemas.EntryRole;
  }): Promise<Schemas.GetEntityRollupApiResponse> {
    const entityResult = await this.entitiesDal.getEntity({
      userId: params.userId,
      publicId: params.publicId,
    });
    if (!entityResult.isSuccess || !entityResult.entity) {
      return { isSuccess: false, message: entityResult.message ?? "Entity not found" };
    }
    const entity = entityResult.entity;

    const [rollupResult, metricsResult] = await Promise.all([
      this.entriesDal.getEntityRollup({
        userId: params.userId,
        entityId: entity.id,
        dateFrom: params.dateFrom,
        dateTo: params.dateTo,
        role: params.role,
      }),
      this.metricsDal.getMetrics({ userId: params.userId }),
    ]);
    if (!rollupResult.isSuccess || !rollupResult.rows) {
      return { isSuccess: false, message: rollupResult.message };
    }
    if (!metricsResult.isSuccess || !metricsResult.metrics) {
      return { isSuccess: false, message: metricsResult.message };
    }

    const metricById = new Map(metricsResult.metrics.map((metric) => [metric.id, metric]));

    const metrics: Schemas.EntityRollupMetricRow[] = [];
    for (const row of rollupResult.rows) {
      const metric = metricById.get(row.metricId);
      // DEV_NOTE: architecture.md §4.1 point 2 — a fact row whose metric can't be resolved is
      // dropped rather than rendered with a blank name. The weekly orphan scan reports it as the
      // repository bug it would be.
      if (!metric) continue;

      metrics.push({
        metricPublicId: metric.publicId,
        metricKey: metric.key,
        metricName: metric.name,
        semanticType: metric.semanticType,
        canonicalUnit: metric.canonicalUnit,
        defaultAgg: metric.defaultAgg,
        direction: metric.direction,
        sum: row.sum,
        count: row.count,
      });
    }

    metrics.sort((a, b) => a.metricName.localeCompare(b.metricName));

    return {
      isSuccess: true,
      message: "Entity rollup fetched successfully",
      rollup: {
        entityPublicId: entity.publicId,
        entityName: entity.name,
        entityKind: entity.kind,
        from: params.dateFrom,
        to: params.dateTo,
        role: params.role ?? null,
        metrics,
        combined: this.combine(metrics),
      },
    };
  }

  // DEV_NOTE: only metrics that agree on semantic type AND canonical unit combine. Pushups + squats
  // (both `count`) give the doc's single "Fitness number"; pushups + a 5k run do not, because reps
  // plus metres is a number that means nothing. Returning null is the honest answer there — the
  // client shows the per-metric rows instead of a fabricated total.
  private combine(metrics: Schemas.EntityRollupMetricRow[]): Schemas.EntityRollupCombined | null {
    if (metrics.length === 0) return null;

    const [first] = metrics;
    const uniform = metrics.every(
      (metric) =>
        metric.semanticType === first.semanticType && metric.canonicalUnit === first.canonicalUnit,
    );
    if (!uniform) return null;

    return {
      semanticType: first.semanticType,
      canonicalUnit: first.canonicalUnit,
      sum: metrics.reduce((total, metric) => total + metric.sum, 0),
      count: metrics.reduce((total, metric) => total + metric.count, 0),
    };
  }

  async unarchiveEntity(params: {
    userId: string;
    publicId: string;
  }): Promise<Schemas.UnarchiveEntityApiResponse> {
    const result = await this.entitiesDal.unarchiveEntity(params);
    if (!result.isSuccess || !result.entity) {
      return { isSuccess: false, message: result.message };
    }

    return {
      isSuccess: true,
      message: result.message,
      entity: this.toApiShape(
        result.entity,
        await this.resolveParentPublicId(params.userId, result.entity.parentId),
      ),
    };
  }

  async unarchiveAllEntities(params: {
    userId: string;
  }): Promise<Schemas.UnarchiveAllEntitiesApiResponse> {
    const result = await this.entitiesDal.unarchiveAllEntities(params);
    return {
      isSuccess: result.isSuccess,
      message: result.message,
      restoredCount: result.restoredCount,
    };
  }

  async archiveEntity(params: { userId: string; publicId: string }): Promise<Schemas.ApiResponse> {
    const result = await this.entitiesDal.archiveEntity(params);
    return { isSuccess: result.isSuccess, message: result.message };
  }
}
