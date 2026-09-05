import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/tanstack-react-start";
import { apiClient, ApiError } from "@/providers/apiClient";
import type * as Schemas from "@app/schemas";
import { toast } from "sonner";

// DEV_NOTE: moved out of trackers/-data.ts once metrics got a screen of their own — a metric is a
// user-global resource (architecture.md §5 "metrics"), not a detail of the tracker that happened to
// declare it, so its cache lives next to the screen that owns it. The tracker form still reads
// list() from here for the "reuse an existing metric" branch.
export class MetricsQueries {
  // DEV_NOTE: keys are hierarchical — all() invalidates every detail below it.
  static readonly keys = {
    all: () => ["metrics"] as const,
    detail: (publicId: string) => ["metrics", publicId] as const,
  };

  static list(getToken: () => Promise<string | null>) {
    return queryOptions({
      queryKey: MetricsQueries.keys.all(),
      queryFn: ({ signal }) =>
        apiClient<Schemas.GetMetricsApiResponse>("/metrics", getToken, { signal }),
    });
  }
}

export function useCreateMetric() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: Schemas.CreateMetricApiRequest) =>
      apiClient<Schemas.CreateMetricApiResponse>("/metrics", getToken, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: MetricsQueries.keys.all() });
    },
    // DEV_NOTE: the server's message names the conflict ("Metric \"x\" already exists"), which is
    // the whole content of the failure — a generic string here would hide the one useful fact.
    onError: (error) => {
      toast.error(
        error instanceof ApiError ? error.message : "Failed to create metric. Please try again.",
      );
    },
  });
}

export function useUpdateMetric() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ publicId, body }: { publicId: string; body: Schemas.UpdateMetricApiRequest }) =>
      apiClient<Schemas.UpdateMetricApiResponse>(`/metrics/${publicId}`, getToken, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: MetricsQueries.keys.all() });
    },
    onError: () => {
      toast.error("Failed to update metric. Please try again.");
    },
  });
}

export function useDeleteMetric() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (publicId: string) =>
      apiClient<Schemas.DeleteMetricApiResponse>(`/metrics/${publicId}`, getToken, {
        method: "DELETE",
      }),
    onSuccess: async (_data, publicId) => {
      queryClient.removeQueries({ queryKey: MetricsQueries.keys.detail(publicId) });
      await queryClient.invalidateQueries({ queryKey: MetricsQueries.keys.all() });
    },
    // DEV_NOTE: a 409 says which trackers and how many readings still point at the metric. That
    // count is what tells the user what to detach first, so it goes in the toast verbatim.
    onError: (error) => {
      toast.error(
        error instanceof ApiError ? error.message : "Failed to delete metric. Please try again.",
      );
    },
  });
}
