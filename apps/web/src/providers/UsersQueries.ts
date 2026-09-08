import { queryOptions } from "@tanstack/react-query";
import { apiClient } from "@/providers/apiClient";
import type * as Schemas from "@app/schemas";

// DEV_NOTE: no `_authenticated/users` route exists — this backs the sidebar's "Day N" and account
// footer, which are shared chrome rendered above every route, not a page of their own. Lives here
// instead of a feature's `-data.ts` for that reason.
export class UsersQueries {
  static readonly keys = {
    me: () => ["users", "me"] as const,
  };

  static me(getToken: () => Promise<string | null>) {
    return queryOptions({
      queryKey: UsersQueries.keys.me(),
      queryFn: ({ signal }) =>
        apiClient<Schemas.GetUserDetailsApiResponse>("/users/me", getToken, { signal }),
    });
  }
}
