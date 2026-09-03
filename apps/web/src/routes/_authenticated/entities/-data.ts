import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/tanstack-react-start";
import { apiClient } from "@/providers/apiClient";
import type * as Schemas from "@app/schemas";
import { toast } from "sonner";

// DEV_NOTE: replaces Money's account/category queries and Time's project queries — one surface,
// keyed by kind. Keys stay hierarchical: all() invalidates every kind's list.
export class EntitiesQueries {
  static readonly keys = {
    all: () => ["entities"] as const,
    list: (kind: Schemas.EntityKind) => ["entities", kind] as const,
    archived: () => ["entities", "archived"] as const,
    detail: (publicId: string) => ["entities", "detail", publicId] as const,
    rollup: (publicId: string) => ["entities", "detail", publicId, "rollup"] as const,
  };

  static list(kind: Schemas.EntityKind, getToken: () => Promise<string | null>) {
    return queryOptions({
      queryKey: EntitiesQueries.keys.list(kind),
      queryFn: ({ signal }) =>
        apiClient<Schemas.GetEntitiesApiResponse>(`/entities?kind=${kind}`, getToken, { signal }),
    });
  }

  // DEV_NOTE: no kind filter — the restore screen shows everything the user archived, whatever it
  // was, because "which kind was it again?" is not a question they can answer before seeing it.
  static archived(getToken: () => Promise<string | null>) {
    return queryOptions({
      queryKey: EntitiesQueries.keys.archived(),
      queryFn: ({ signal }) =>
        apiClient<Schemas.GetEntitiesApiResponse>("/entities?archived=true", getToken, { signal }),
    });
  }

  static detail(publicId: string, getToken: () => Promise<string | null>) {
    return queryOptions({
      queryKey: EntitiesQueries.keys.detail(publicId),
      queryFn: ({ signal }) =>
        apiClient<Schemas.GetEntityApiResponse>(`/entities/${publicId}`, getToken, { signal }),
    });
  }

  // DEV_NOTE: architecture.md §6 — the cross-domain read. `role` is the optional "slice by"
  // parameter; omitted, the rollup covers every role that ever pointed at this entity.
  static rollup(
    publicId: string,
    from: string,
    to: string,
    getToken: () => Promise<string | null>,
    role?: Schemas.EntryRole,
  ) {
    return queryOptions({
      queryKey: [...EntitiesQueries.keys.rollup(publicId), from, to, role ?? "all"] as const,
      queryFn: ({ signal }) =>
        apiClient<Schemas.GetEntityRollupApiResponse>(
          `/entities/${publicId}/rollup?from=${from}&to=${to}${role ? `&role=${role}` : ""}`,
          getToken,
          { signal },
        ),
    });
  }
}

export function useCreateEntity() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: Schemas.CreateEntityApiRequest) =>
      apiClient<Schemas.CreateEntityApiResponse>("/entities", getToken, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: EntitiesQueries.keys.all() });
    },
    onError: () => {
      toast.error("Failed to create. Please try again.");
    },
  });
}

// DEV_NOTE: setQueryData on the detail cache so the edited name is on screen before the refetch
// lands, then invalidate the lists that render it elsewhere.
export function useUpdateEntity() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ publicId, entity }: { publicId: string } & Schemas.UpdateEntityApiRequest) =>
      apiClient<Schemas.UpdateEntityApiResponse>(`/entities/${publicId}`, getToken, {
        method: "PATCH",
        body: JSON.stringify({ entity }),
      }),
    onSuccess: async (response, { publicId }) => {
      if (response.entity) {
        queryClient.setQueryData(EntitiesQueries.keys.detail(publicId), response);
      }
      await queryClient.invalidateQueries({ queryKey: EntitiesQueries.keys.all() });
    },
    onError: () => {
      toast.error("Failed to save changes. Please try again.");
    },
  });
}

export function useArchiveEntity() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (publicId: string) =>
      apiClient<Schemas.ApiResponse>(`/entities/${publicId}`, getToken, { method: "DELETE" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: EntitiesQueries.keys.all() });
    },
    onError: () => {
      toast.error("Failed to archive. Please try again.");
    },
  });
}

export function useUnarchiveEntity() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (publicId: string) =>
      apiClient<Schemas.UnarchiveEntityApiResponse>(`/entities/${publicId}/unarchive`, getToken, {
        method: "POST",
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: EntitiesQueries.keys.all() });
    },
    onError: () => {
      toast.error("Failed to restore. Please try again.");
    },
  });
}

export function useUnarchiveAllEntities() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      apiClient<Schemas.UnarchiveAllEntitiesApiResponse>("/entities/unarchive-all", getToken, {
        method: "POST",
      }),
    onSuccess: async (response) => {
      toast.success(
        response.restoredCount === 1
          ? "1 entity restored"
          : `${response.restoredCount ?? 0} entities restored`,
      );
      await queryClient.invalidateQueries({ queryKey: EntitiesQueries.keys.all() });
    },
    onError: () => {
      toast.error("Failed to restore. Please try again.");
    },
  });
}
