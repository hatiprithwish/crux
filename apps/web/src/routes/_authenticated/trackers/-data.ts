import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/tanstack-react-start";
import { apiClient } from "@/providers/apiClient";
import type * as Schemas from "@app/schemas";
import { toast } from "sonner";

// DEV_NOTE: replaces HabitsQueries / MoneyQueries / TimeQueries — every domain reads and writes
// through these now. Keys are hierarchical: all() invalidates the list (both plain and withToday),
// detail(publicId) invalidates every per-tracker read (entries, heatmap, breakdown, running).
export class TrackersQueries {
  static readonly keys = {
    all: () => ["trackers"] as const,
    list: (withToday: boolean) => ["trackers", "list", withToday] as const,
    archived: () => ["trackers", "archived"] as const,
    detail: (publicId: string) => ["trackers", publicId] as const,
    entries: (publicId: string) => ["trackers", publicId, "entries"] as const,
    heatmap: (publicId: string) => ["trackers", publicId, "heatmap"] as const,
    breakdown: (publicId: string) => ["trackers", publicId, "breakdown"] as const,
    running: (publicId: string) => ["trackers", publicId, "running"] as const,
  };

  static list(withToday: boolean, getToken: () => Promise<string | null>) {
    return queryOptions({
      queryKey: TrackersQueries.keys.list(withToday),
      queryFn: ({ signal }) =>
        apiClient<Schemas.GetTrackersApiResponse>(
          `/trackers?withToday=${withToday ? "true" : "false"}`,
          getToken,
          { signal },
        ),
    });
  }

  // DEV_NOTE: separate key from list() — restoring has to invalidate both, and a shared key would
  // make the archived screen and the Today screen fight over the same cache entry.
  static archived(getToken: () => Promise<string | null>) {
    return queryOptions({
      queryKey: TrackersQueries.keys.archived(),
      queryFn: ({ signal }) =>
        apiClient<Schemas.GetTrackersApiResponse>("/trackers?archived=true", getToken, { signal }),
    });
  }

  static detail(publicId: string, getToken: () => Promise<string | null>) {
    return queryOptions({
      queryKey: TrackersQueries.keys.detail(publicId),
      queryFn: ({ signal }) =>
        apiClient<Schemas.GetTrackerApiResponse>(`/trackers/${publicId}`, getToken, { signal }),
    });
  }

  static entries(
    publicId: string,
    from: string,
    to: string,
    getToken: () => Promise<string | null>,
  ) {
    return queryOptions({
      queryKey: [...TrackersQueries.keys.entries(publicId), from, to] as const,
      queryFn: ({ signal }) =>
        apiClient<Schemas.GetTrackerEntriesApiResponse>(
          `/trackers/${publicId}/entries?from=${from}&to=${to}`,
          getToken,
          { signal },
        ),
    });
  }

  static heatmap(
    publicId: string,
    from: string,
    to: string,
    getToken: () => Promise<string | null>,
  ) {
    return queryOptions({
      queryKey: [...TrackersQueries.keys.heatmap(publicId), from, to] as const,
      queryFn: ({ signal }) =>
        apiClient<Schemas.GetTrackerHeatmapApiResponse>(
          `/trackers/${publicId}/heatmap?from=${from}&to=${to}`,
          getToken,
          { signal },
        ),
    });
  }

  static breakdown(
    publicId: string,
    from: string,
    to: string,
    role: Schemas.EntryRole,
    getToken: () => Promise<string | null>,
  ) {
    return queryOptions({
      queryKey: [...TrackersQueries.keys.breakdown(publicId), from, to, role] as const,
      queryFn: ({ signal }) =>
        apiClient<Schemas.GetTrackerBreakdownApiResponse>(
          `/trackers/${publicId}/breakdown?from=${from}&to=${to}&role=${role}`,
          getToken,
          { signal },
        ),
    });
  }

  static running(publicId: string, getToken: () => Promise<string | null>) {
    return queryOptions({
      queryKey: TrackersQueries.keys.running(publicId),
      queryFn: ({ signal }) =>
        apiClient<Schemas.GetRunningSessionApiResponse>(`/trackers/${publicId}/running`, getToken, {
          signal,
        }),
    });
  }
}

export function useCreateTracker() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: Schemas.CreateTrackerApiRequest) =>
      apiClient<Schemas.CreateTrackerApiResponse>("/trackers", getToken, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: TrackersQueries.keys.all() });
    },
    onError: () => {
      toast.error("Failed to create tracker. Please try again.");
    },
  });
}

// DEV_NOTE: one mutation for all seven controls — the payload is the discriminated union the
// backend's ControlHandlers dispatches on, so a new control needs a widget and a handler, not a new
// endpoint or a new hook.
export function useQuickAdd() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ publicId, payload }: { publicId: string; payload: Schemas.QuickAddPayload }) =>
      apiClient<Schemas.QuickAddApiResponse>(`/trackers/${publicId}/entries`, getToken, {
        method: "POST",
        body: JSON.stringify({ payload }),
      }),
    onSuccess: async (_response, { publicId }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: TrackersQueries.keys.all() }),
        queryClient.invalidateQueries({ queryKey: TrackersQueries.keys.detail(publicId) }),
      ]);
    },
    onError: () => {
      toast.error("Failed to log entry. Please try again.");
    },
  });
}

export function useRunCompute() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ publicId, compute }: { publicId: string; compute: Schemas.ComputeInput }) =>
      apiClient<Schemas.RunComputeApiResponse>(`/trackers/${publicId}/compute`, getToken, {
        method: "POST",
        body: JSON.stringify({ compute }),
      }),
    onSuccess: async (_response, { publicId }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: TrackersQueries.keys.all() }),
        queryClient.invalidateQueries({ queryKey: TrackersQueries.keys.detail(publicId) }),
      ]);
    },
    onError: () => {
      toast.error("Failed to run this action. Please try again.");
    },
  });
}

export function useArchiveTracker() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (publicId: string) =>
      apiClient<Schemas.ApiResponse>(`/trackers/${publicId}`, getToken, { method: "DELETE" }),
    onSuccess: async (_response, publicId) => {
      queryClient.removeQueries({ queryKey: TrackersQueries.keys.detail(publicId) });
      await queryClient.invalidateQueries({ queryKey: TrackersQueries.keys.all() });
    },
    onError: () => {
      toast.error("Failed to archive tracker. Please try again.");
    },
  });
}

export function useUnarchiveTracker() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (publicId: string) =>
      apiClient<Schemas.UnarchiveTrackerApiResponse>(`/trackers/${publicId}/unarchive`, getToken, {
        method: "POST",
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: TrackersQueries.keys.all() });
    },
    onError: () => {
      toast.error("Failed to restore tracker. Please try again.");
    },
  });
}

export function useUnarchiveAllTrackers() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      apiClient<Schemas.UnarchiveAllTrackersApiResponse>("/trackers/unarchive-all", getToken, {
        method: "POST",
      }),
    onSuccess: async (response) => {
      toast.success(
        response.restoredCount === 1
          ? "1 tracker restored"
          : `${response.restoredCount ?? 0} trackers restored`,
      );
      await queryClient.invalidateQueries({ queryKey: TrackersQueries.keys.all() });
    },
    onError: () => {
      toast.error("Failed to restore trackers. Please try again.");
    },
  });
}

export class MetricsQueries {
  static readonly keys = {
    all: () => ["metrics"] as const,
  };

  static list(getToken: () => Promise<string | null>) {
    return queryOptions({
      queryKey: MetricsQueries.keys.all(),
      queryFn: ({ signal }) =>
        apiClient<Schemas.GetMetricsApiResponse>("/metrics", getToken, { signal }),
    });
  }
}
