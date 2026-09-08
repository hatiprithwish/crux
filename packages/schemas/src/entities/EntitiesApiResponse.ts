import type { EntityApiShape } from "../core";
import type { EntityRollupApiShape } from "./EntitiesRollupCommon";
import type { EntityStatsApiShape } from "./EntitiesStatsCommon";
import type { ApiResponse } from "../common";

export interface CreateEntityApiResponse extends ApiResponse {
  entity?: EntityApiShape;
}

export interface GetEntityApiResponse extends ApiResponse {
  entity?: EntityApiShape;
}

export interface UpdateEntityApiResponse extends ApiResponse {
  entity?: EntityApiShape;
}

// DEV_NOTE: `stats` is a sibling array keyed by publicId rather than a field on the entity — an
// entity is the same row whether or not the caller asked for usage, and folding the aggregate in
// would make EntityApiShape's numbers absent-or-present depending on a query param.
export interface GetEntitiesApiResponse extends ApiResponse {
  entities?: EntityApiShape[];
  stats?: EntityStatsApiShape[];
}

// DEV_NOTE: rollup is absent, never a zeroed shell, when the entity has nothing in the range —
// invariant 7. The client renders "nothing attributed yet", not a row of zeros.
export interface GetEntityRollupApiResponse extends ApiResponse {
  rollup?: EntityRollupApiShape;
}

export interface UnarchiveEntityApiResponse extends ApiResponse {
  entity?: EntityApiShape;
}

export interface UnarchiveAllEntitiesApiResponse extends ApiResponse {
  restoredCount?: number;
}
