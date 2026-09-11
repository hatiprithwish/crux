import UsersDAL from "@/data-access-layer/UsersDAL";
import { isValidTimeZone } from "@/utils/DateTime";
import type * as Schemas from "@app/schemas";

export default class UsersRepo {
  private dal: UsersDAL;

  constructor(env: Env) {
    this.dal = new UsersDAL(env);
  }

  async syncClerkUser(params: Schemas.SyncClerkUserApiRequest) {
    return await this.dal.upsertUser(params);
  }

  async getUserDetails(params: { clerkId: string }) {
    return await this.dal.getUserDetails({
      clerkId: params.clerkId,
    });
  }

  // DEV_NOTE: tz validity is a business rule (a real IANA zone), not a shape check — the schemas
  // package can't reach Intl-backed DateTime.ts, so it's enforced here rather than in the Zod schema.
  async updateUser(
    params: Schemas.UpdateUserApiRequest & { clerkId: string },
  ): Promise<Schemas.UpdateUserApiResponse> {
    if (params.tz !== undefined && !isValidTimeZone(params.tz)) {
      return { isSuccess: false, message: "Invalid timezone" };
    }

    const fields: Schemas.UpdateUserDALRequest["fields"] = {};
    if (params.tz !== undefined) fields.tz = params.tz;
    if (params.homeCurrency !== undefined) fields.homeCurrency = params.homeCurrency;

    return await this.dal.updateUser({ clerkId: params.clerkId, fields });
  }
}
