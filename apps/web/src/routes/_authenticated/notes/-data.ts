import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/tanstack-react-start";
import { apiClient } from "@/providers/apiClient";
import type * as Schemas from "@app/schemas";
import { toast } from "sonner";

export class NotesQueries {
  // DEV_NOTE: Keys form a hierarchy — detail extends all. Invalidating all() also invalidates every detail, so one call clears the entire notes cache.
  static readonly keys = {
    all: () => ["notes"] as const,
    detail: (id: number) => ["notes", id] as const,
  };

  static list(getToken: () => Promise<string | null>) {
    return queryOptions({
      queryKey: NotesQueries.keys.all(),
      queryFn: ({ signal }) =>
        apiClient<Schemas.GetNotesApiResponse>("/notes", getToken, { signal }),
    });
  }

  static detail(id: number, getToken: () => Promise<string | null>) {
    return queryOptions({
      queryKey: NotesQueries.keys.detail(id),
      queryFn: ({ signal }) =>
        apiClient<Schemas.GetNoteApiResponse>(`/notes/${id}`, getToken, {
          signal,
        }),
    });
  }
}

export function useCreateNote() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: Schemas.CreateNoteApiRequest) =>
      apiClient<Schemas.CreateNoteApiResponse>("/notes", getToken, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: NotesQueries.keys.all(),
      });
    },
    onError: () => {
      toast.error("Failed to create note. Please try again.");
    },
  });
}

export function useUpdateNote() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: Schemas.UpdateNoteApiRequest }) =>
      apiClient<Schemas.UpdateNoteApiResponse>(`/notes/${id}`, getToken, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: async (response) => {
      if (response.note) {
        queryClient.setQueryData(NotesQueries.keys.detail(response.note.id), response);
      }
      await queryClient.invalidateQueries({
        queryKey: NotesQueries.keys.all(),
      });
    },
    onError: () => {
      toast.error("Failed to update note. Please try again.");
    },
  });
}

export function useDeleteNote() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => apiClient<void>(`/notes/${id}`, getToken, { method: "DELETE" }),
    onSuccess: async (_data, id) => {
      queryClient.removeQueries({ queryKey: NotesQueries.keys.detail(id) });
      await queryClient.invalidateQueries({
        queryKey: NotesQueries.keys.all(),
      });
    },
    onError: () => {
      toast.error("Failed to delete note. Please try again.");
    },
  });
}
