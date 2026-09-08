import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/tanstack-react-start";
import { Button } from "@/shadcn/ui/button";
import { TrackersQueries } from "./-data";
import TrackerRow from "./-TrackerRow";
import { TrackerTimeline } from "./-TrackerTimeline";
import { getTodayLocalDate } from "./-utils";

// DEV_NOTE: architecture.md §6 "Today screen" — every tracker, each rendering the quick-add widget
// its manifest.control names, off one request (?withToday=true returns the day's totals, streaks
// and any open session alongside the trackers). The 24h ruler is a second, cross-tracker request
// (see -TrackerTimeline.tsx) — the list endpoint has no reason to carry per-entry timestamps.
export const Route = createFileRoute("/_authenticated/trackers/")({
  component: TrackersPage,
});

// DEV_NOTE: UTC throughout, matching -utils.ts's getTodayLocalDate/dayOfWeek — the app has no
// per-user timezone yet, so parsing localDate in the viewer's own zone could roll it to the
// adjacent day.
function formatTodayLabel(localDate: string): string {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  const weekday = date.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  const day = date.getUTCDate();
  const month = date.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
  return `${weekday} ${day} ${month}`.toUpperCase();
}

function TrackersPage() {
  const { getToken } = useAuth();
  const today = getTodayLocalDate();
  const { data, isPending, isError } = useQuery(TrackersQueries.list(true, getToken));
  const timeline = useQuery(TrackersQueries.timeline(today, getToken));

  const trackers = data?.trackers ?? [];
  const todayRows = data?.today ?? [];
  const loggedCount = todayRows.filter(
    (row) => row.todaySum !== null || row.todayCount > 0 || row.openSession !== null,
  ).length;

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
            {formatTodayLabel(today)}
          </p>
          <h1 className="font-heading text-3xl font-semibold">
            {trackers.length === 0
              ? "Today"
              : `Today · ${loggedCount} of ${todayRows.length} logged`}
          </h1>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/trackers/new">New tracker</Link>
        </Button>
      </div>

      <TrackerTimeline entries={timeline.data?.entries ?? []} />

      {isPending ? (
        <p className="mt-4 text-muted-foreground">Loading trackers...</p>
      ) : isError ? (
        <p className="mt-4 text-destructive">Failed to load trackers.</p>
      ) : trackers.length === 0 ? (
        <div className="mt-10 flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <h2 className="text-xl font-medium">An empty rule.</h2>
            <h2 className="text-xl font-medium">Put one mark on it.</h2>
            <p className="max-w-md text-sm text-muted-foreground">
              One tracker is enough to find out whether the habit holds. The other five can wait
              until it does.
            </p>
          </div>
          <Button asChild size="lg" className="self-start">
            <Link to="/trackers/new">Build a tracker</Link>
          </Button>
        </div>
      ) : (
        <div className="mt-2 flex flex-col">
          {todayRows.map((row) => (
            <TrackerRow key={row.tracker.publicId} today={row} />
          ))}
        </div>
      )}
    </div>
  );
}
