import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/tanstack-react-start";
import { Button } from "@/shadcn/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shadcn/ui/card";
import type * as Schemas from "@app/schemas";
import { MetricsQueries, useCreateMetric, useDeleteMetric, useUpdateMetric } from "./-data";
import { MetricForm } from "./-MetricForm";

// DEV_NOTE: metrics are declared globally per user and reused across trackers (architecture.md §5)
// — that reuse is the whole reason two trackers can roll into one number. Until this screen existed
// the only way to make one was the tracker form's inline branch, which meant a mistyped metric was
// permanent: nothing could reach it afterwards to rename it or take it out of the picker.
export const Route = createFileRoute("/_authenticated/metrics/")({
  component: MetricsPage,
});

function describeUsage(usage: Schemas.MetricUsage) {
  if (usage.trackerCount === 0 && usage.entryCount === 0) return "Unused";
  const trackers = `${usage.trackerCount} tracker${usage.trackerCount === 1 ? "" : "s"}`;
  const entries = `${usage.entryCount} reading${usage.entryCount === 1 ? "" : "s"}`;
  return `${trackers} · ${entries}`;
}

function MetricsPage() {
  const { getToken } = useAuth();
  const { data, isPending, isError } = useQuery(MetricsQueries.list(getToken));
  const createMetric = useCreateMetric();
  const updateMetric = useUpdateMetric();
  const deleteMetric = useDeleteMetric();

  const [isCreating, setIsCreating] = useState(false);
  const [editingPublicId, setEditingPublicId] = useState<string | null>(null);

  const metrics = data?.metrics ?? [];

  return (
    <div className="mx-auto max-w-2xl p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Metrics</h1>
          <span className="text-sm text-muted-foreground">
            What your trackers measure. Two trackers pointing at one metric roll into one number.
          </span>
        </div>
        <Button onClick={() => setIsCreating((current) => !current)}>
          {isCreating ? "Cancel" : "New metric"}
        </Button>
      </div>

      {isCreating ? (
        <Card>
          <CardHeader>
            <CardTitle>New metric</CardTitle>
          </CardHeader>
          <CardContent>
            <MetricForm
              submitLabel="Create metric"
              onSubmit={async (value) => {
                await createMetric.mutateAsync({ metric: value });
                setIsCreating(false);
              }}
              onCancel={() => setIsCreating(false)}
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>All metrics</CardTitle>
        </CardHeader>
        <CardContent>
          {isPending ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : isError ? (
            <p className="text-sm text-destructive">Failed to load metrics.</p>
          ) : metrics.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing here yet. Creating a tracker declares one automatically.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {metrics.map((metric) => {
                const isEditing = editingPublicId === metric.publicId;
                // DEV_NOTE: delete is refused server-side (409) once anything points at the metric.
                // Disabling it here says so before the round trip, and the title explains why —
                // a greyed-out button with no reason is worse than no button.
                const isInUse = metric.usage.trackerCount > 0 || metric.usage.entryCount > 0;

                return (
                  <div key={metric.publicId} className="flex flex-col gap-3 rounded-md border p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex flex-col">
                        <span className="font-medium">{metric.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {metric.key} · {metric.semanticType} · {metric.canonicalUnit} ·{" "}
                          {metric.defaultAgg} · {metric.direction}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {describeUsage(metric.usage)}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEditingPublicId(isEditing ? null : metric.publicId)}
                        >
                          {isEditing ? "Cancel" : "Edit"}
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={isInUse || deleteMetric.isPending}
                          title={
                            isInUse
                              ? "Still used by a tracker or has readings. Detach it first."
                              : undefined
                          }
                          onClick={() => deleteMetric.mutate(metric.publicId)}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>

                    {isEditing ? (
                      <MetricForm
                        submitLabel="Save changes"
                        lockImmutable
                        initialValue={{
                          key: metric.key,
                          name: metric.name,
                          semanticType: metric.semanticType,
                          canonicalUnit: metric.canonicalUnit,
                          defaultAgg: metric.defaultAgg,
                          direction: metric.direction,
                          dateAttribution: metric.dateAttribution,
                        }}
                        onSubmit={async (value) => {
                          // DEV_NOTE: only the three editable fields are sent — the update schema
                          // is .strict(), so including the locked ones would be a 400 rather than
                          // a silent no-op.
                          await updateMetric.mutateAsync({
                            publicId: metric.publicId,
                            body: {
                              metric: {
                                name: value.name,
                                defaultAgg: value.defaultAgg,
                                direction: value.direction,
                              },
                            },
                          });
                          setEditingPublicId(null);
                        }}
                        onCancel={() => setEditingPublicId(null)}
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
