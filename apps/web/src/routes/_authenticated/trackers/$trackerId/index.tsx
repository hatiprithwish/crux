import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/tanstack-react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/shadcn/ui/card";
import { Button } from "@/shadcn/ui/button";
import { TrackersQueries, useRunCompute } from "../-data";
import TrackerHeatmap from "../-TrackerHeatmap";
import { TransferForm } from "../-TransferForm";
import {
  addDaysToLocalDate,
  describeSchedule,
  formatDuration,
  formatMinorAmount,
  getTodayLocalDate,
} from "../-utils";

// DEV_NOTE: one detail page for every tracker — the heatmap, streak, entry log and breakdown are
// all generic reads now. What used to be three domain pages differs here only in which sections
// apply: an interval tracker gets the breakdown, a compute tracker gets its module's form.
export const Route = createFileRoute("/_authenticated/trackers/$trackerId/")({
  component: TrackerDetailPage,
});

const HEATMAP_WINDOW_DAYS = 120;
const BREAKDOWN_WINDOW_DAYS = 30;

function TrackerDetailPage() {
  const { trackerId } = Route.useParams();
  const { getToken } = useAuth();
  const navigate = useNavigate();
  const runCompute = useRunCompute();

  const today = getTodayLocalDate();
  const heatmapFrom = addDaysToLocalDate(today, -(HEATMAP_WINDOW_DAYS - 1));
  const breakdownFrom = addDaysToLocalDate(today, -(BREAKDOWN_WINDOW_DAYS - 1));

  const trackerQuery = useQuery(TrackersQueries.detail(trackerId, getToken));
  const heatmapQuery = useQuery(TrackersQueries.heatmap(trackerId, heatmapFrom, today, getToken));
  const entriesQuery = useQuery(TrackersQueries.entries(trackerId, breakdownFrom, today, getToken));
  const tracker = trackerQuery.data?.tracker;
  const isInterval = tracker?.manifest.control === "timer";
  const breakdownQuery = useQuery({
    ...TrackersQueries.breakdown(trackerId, breakdownFrom, today, "project", getToken),
    enabled: isInterval,
  });

  if (trackerQuery.isPending) {
    return <div className="mx-auto max-w-2xl p-6">Loading tracker...</div>;
  }
  if (trackerQuery.isError || !tracker) {
    return <div className="mx-auto max-w-2xl p-6 text-destructive">Failed to load tracker.</div>;
  }

  const entries = entriesQuery.data?.entries ?? [];

  return (
    <div className="mx-auto max-w-2xl p-6 flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">{tracker.name}</h1>
          <span className="text-sm text-muted-foreground">
            {tracker.manifest.control} · {describeSchedule(tracker.manifest.schedule)}
            {tracker.manifest.target !== null ? ` · target ${tracker.manifest.target}` : ""}
          </span>
        </div>
        <Button variant="outline" onClick={() => navigate({ to: "/trackers" })}>
          Back
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            History
            {heatmapQuery.data?.streak ? ` · ${heatmapQuery.data.streak} day streak` : ""}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {heatmapQuery.isPending ? (
            <p className="text-sm text-muted-foreground">Loading history...</p>
          ) : heatmapQuery.isError ? (
            <p className="text-sm text-destructive">Failed to load history.</p>
          ) : (
            <TrackerHeatmap days={heatmapQuery.data?.days ?? []} />
          )}
        </CardContent>
      </Card>

      {tracker.manifest.compute === "money.transfer.v1" ? (
        <Card>
          <CardHeader>
            <CardTitle>Transfer between accounts</CardTitle>
          </CardHeader>
          <CardContent>
            <TransferForm
              onSubmit={async (payload) => {
                await runCompute.mutateAsync({
                  publicId: tracker.publicId,
                  compute: { key: "money.transfer.v1", payload },
                });
              }}
            />
          </CardContent>
        </Card>
      ) : null}

      {isInterval ? (
        <Card>
          <CardHeader>
            <CardTitle>Breakdown — last {BREAKDOWN_WINDOW_DAYS} days</CardTitle>
          </CardHeader>
          <CardContent>
            {breakdownQuery.isPending ? (
              <p className="text-sm text-muted-foreground">Loading breakdown...</p>
            ) : breakdownQuery.isError ? (
              <p className="text-sm text-destructive">Failed to load breakdown.</p>
            ) : (breakdownQuery.data?.rows ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing logged in this window.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {(breakdownQuery.data?.rows ?? []).map((row) => (
                  <div
                    key={`${row.label ?? "unlabelled"}-${row.entityPublicId ?? "none"}`}
                    className="flex items-center justify-between text-sm"
                  >
                    <span>{row.label ?? "Unlabelled"}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {row.entryCount} × · {formatDuration(row.total)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Entries — last {BREAKDOWN_WINDOW_DAYS} days</CardTitle>
        </CardHeader>
        <CardContent>
          {entriesQuery.isPending ? (
            <p className="text-sm text-muted-foreground">Loading entries...</p>
          ) : entriesQuery.isError ? (
            <p className="text-sm text-destructive">Failed to load entries.</p>
          ) : entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing logged in this window.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {entries.map((entry) => (
                <div key={entry.publicId} className="flex items-center justify-between text-sm">
                  <span>
                    {entry.localDate}
                    {entry.label ? ` · ${entry.label}` : ""}
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {describeEntryValue(entry, tracker.manifest.control)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// DEV_NOTE: the same entry shape reads differently per control — a duration in seconds, an amount in
// minor units, or a plain count. Display units are a presentation concern; storage stays canonical
// (invariant 2).
function describeEntryValue(
  entry: {
    values: { valueNum: number | null; currency: string | null }[];
    durationSeconds: number | null;
  },
  control: string,
): string {
  if (control === "timer") {
    return entry.durationSeconds === null ? "running" : formatDuration(entry.durationSeconds);
  }

  const value = entry.values[0];
  if (!value || value.valueNum === null) return "—";
  if (control === "amount_pad") return formatMinorAmount(value.valueNum, value.currency);
  return String(value.valueNum);
}
