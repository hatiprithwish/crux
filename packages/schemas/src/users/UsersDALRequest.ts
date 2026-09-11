import type { User, UserRoleEnum } from "./UsersCommon";

export interface SyncClerkUserDALRequest {
  clerkId: string;
  email: string;
  role: UserRoleEnum;
}

// DEV_NOTE: partial by construction — only the fields the caller actually sent are written, so a
// tz-only PATCH can't blank homeCurrency it never showed.
export type UpdateUserDALRequest = Pick<User, "clerkId"> & {
  fields: Partial<Pick<User, "tz" | "homeCurrency">>;
};
