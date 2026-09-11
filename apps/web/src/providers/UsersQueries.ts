import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/tanstack-react-start";
import { apiClient } from "@/providers/apiClient";
import type * as Schemas from "@app/schemas";
import { toast } from "sonner";

// DEV_NOTE: no `_authenticated/users` route exists — this backs the sidebar's "Day N" and account
// footer, which are shared chrome rendered above every route, not a page of their own. `/settings`
// reads and writes the same `me()` query rather than getting its own — one user row, one cache
// entry. Lives here instead of a feature's `-data.ts` for that reason.
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

export function useUpdateUser() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: Schemas.UpdateUserApiRequest) =>
      apiClient<Schemas.UpdateUserApiResponse>("/users/me", getToken, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: (response) => {
      if (response.user) {
        queryClient.setQueryData(UsersQueries.keys.me(), response);
      }
    },
    onError: () => {
      toast.error("Failed to save changes. Please try again.");
    },
  });
}
