import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/tanstack-react-start";
import { Button } from "@/shadcn/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shadcn/ui/card";
import { TrackersQueries, useUnarchiveAllTrackers, useUnarchiveTracker } from "../trackers/-data";
import { EntitiesQueries, useUnarchiveAllEntities, useUnarchiveEntity } from "../entities/-data";
import { describeSchedule } from "../trackers/-utils";

// DEV_NOTE: archiving is the only "delete" this app has (invariant 9 — soft deletes only, no hard
// deletes ever), which makes it a one-way door unless something can open it again. This screen is
// that door: everything archived, trackers and entities alike, restorable one at a time or all at
// once. Nothing here can destroy anything.
export const Route = createFileRoute("/_authenticated/archived/")({
  component: ArchivedPage,
});

function ArchivedPage() {
  const { getToken } = useAuth();
  const trackersQuery = useQuery(TrackersQueries.archived(getToken));
  const entitiesQuery = useQuery(EntitiesQueries.archived(getToken));

  const unarchiveTracker = useUnarchiveTracker();
  const unarchiveAllTrackers = useUnarchiveAllTrackers();
  const unarchiveEntity = useUnarchiveEntity();
  const unarchiveAllEntities = useUnarchiveAllEntities();

  const trackers = trackersQuery.data?.trackers ?? [];
  const entities = entitiesQuery.data?.entities ?? [];
  const isRestoringAll = unarchiveAllTrackers.isPending || unarchiveAllEntities.isPending;

  return (
    <div className="mx-auto max-w-2xl p-6 flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Archived</h1>
        <Button
          disabled={isRestoringAll || (trackers.length === 0 && entities.length === 0)}
          onClick={() => {
            // DEV_NOTE: two calls rather than one combined endpoint — trackers and entities are
            // separate surfaces, and a partial failure should leave the other half restored rather
            // than rolling back work the user asked for.
            if (trackers.length > 0) unarchiveAllTrackers.mutate();
            if (entities.length > 0) unarchiveAllEntities.mutate();
          }}
        >
          {isRestoringAll ? "Restoring..." : "Restore everything"}
        </Button>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Trackers</CardTitle>
          {trackers.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              disabled={unarchiveAllTrackers.isPending}
              onClick={() => unarchiveAllTrackers.mutate()}
            >
              Restore all
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          {trackersQuery.isPending ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : trackersQuery.isError ? (
            <p className="text-sm text-destructive">Failed to load archived trackers.</p>
          ) : trackers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No archived trackers.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {trackers.map((tracker) => (
                <div key={tracker.publicId} className="flex items-center justify-between gap-4">
                  <div className="flex flex-col">
                    <span>
                      {tracker.emoji ? `${tracker.emoji} ` : ""}
                      {tracker.name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {tracker.manifest.control} · {describeSchedule(tracker.manifest.schedule)}
                      {tracker.archivedAt
                        ? ` · archived ${new Date(tracker.archivedAt).toISOString().slice(0, 10)}`
                        : ""}
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={unarchiveTracker.isPending}
                    onClick={() => unarchiveTracker.mutate(tracker.publicId)}
                  >
                    Restore
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Entities</CardTitle>
          {entities.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              disabled={unarchiveAllEntities.isPending}
              onClick={() => unarchiveAllEntities.mutate()}
            >
              Restore all
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          {entitiesQuery.isPending ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : entitiesQuery.isError ? (
            <p className="text-sm text-destructive">Failed to load archived entities.</p>
          ) : entities.length === 0 ? (
            <p className="text-sm text-muted-foreground">No archived entities.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {entities.map((entity) => (
                <div key={entity.publicId} className="flex items-center justify-between gap-4">
                  <div className="flex flex-col">
                    <span>
                      {entity.emoji ? `${entity.emoji} ` : ""}
                      {entity.name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {entity.kind}
                      {entity.archivedAt
                        ? ` · archived ${new Date(entity.archivedAt).toISOString().slice(0, 10)}`
                        : ""}
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={unarchiveEntity.isPending}
                    onClick={() => unarchiveEntity.mutate(entity.publicId)}
                  >
                    Restore
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
