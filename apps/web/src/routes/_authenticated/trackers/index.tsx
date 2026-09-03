import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/tanstack-react-start";
import { Button } from "@/shadcn/ui/button";
import { TrackersQueries } from "./-data";
import TrackerRow from "./-TrackerRow";

// DEV_NOTE: architecture.md §6 "Today screen" — every tracker, each rendering the quick-add widget
// its manifest.control names, off one request (?withToday=true returns the day's totals, streaks
// and any open session alongside the trackers).
export const Route = createFileRoute("/_authenticated/trackers/")({
  component: TrackersPage,
});

function TrackersPage() {
  const { getToken } = useAuth();
  const { data, isPending, isError } = useQuery(TrackersQueries.list(true, getToken));
  const today = data?.today ?? [];

  return (
    <div className="mx-auto max-w-2xl p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Today</h1>
        <Button asChild>
          <Link to="/trackers/new">New tracker</Link>
        </Button>
      </div>

      {isPending ? (
        <p className="text-muted-foreground">Loading trackers...</p>
      ) : isError ? (
        <p className="text-destructive">Failed to load trackers.</p>
      ) : today.length === 0 ? (
        <p className="text-muted-foreground">No trackers yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {today.map((row) => (
            <TrackerRow key={row.tracker.publicId} today={row} />
          ))}
        </div>
      )}
    </div>
  );
}
