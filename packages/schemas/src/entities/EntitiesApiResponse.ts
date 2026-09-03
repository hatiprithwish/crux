import type { EntityApiShape } from "../core";
import type { EntityRollupApiShape } from "./EntitiesRollupCommon";
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

export interface GetEntitiesApiResponse extends ApiResponse {
  entities?: EntityApiShape[];
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
