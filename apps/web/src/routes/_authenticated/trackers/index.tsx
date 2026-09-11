import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/tanstack-react-start";
import { CaretDown, DotsSixVertical, MagnifyingGlass } from "@phosphor-icons/react";
import { Button } from "@/shadcn/ui/button";
import { Input } from "@/shadcn/ui/input";
import { cn } from "@/utils/tailwind";
import { useDayNumber } from "@/components/AppSidebar";
import type * as Schemas from "@app/schemas";
import { TrackersQueries, useReorderTrackers } from "./-data";
import TrackerRow from "./-TrackerRow";
import { TrackerDoneRow } from "./-TrackerDoneRow";
import { TodayStatStrip } from "./-TodayStatStrip";
import { getTodayLocalDate } from "./-utils";

// DEV_NOTE: architecture.md §6 "Today screen" — every tracker, each rendering the quick-add widget
// its manifest.control names, off one request (?withToday=true returns the day's totals, streaks
// and now todayStats alongside the trackers).
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

// A tracker counts as logged the same way TrackersRepo.getTrackers counts loggedCount — a value
// written today, or (for a timer) a session still running.
function isLogged(row: Schemas.TrackerTodayApiShape): boolean {
  return row.todaySum !== null || row.openSession !== null;
}

function moveItem<T>(list: T[], from: number, to: number): T[] {
  const copy = [...list];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

function TrackersPage() {
  const { getToken } = useAuth();
  const today = getTodayLocalDate();
  const dayNumber = useDayNumber();
  const { data, isPending, isError } = useQuery(TrackersQueries.list(true, getToken));
  const timeline = useQuery(TrackersQueries.timeline(today, getToken));
  const reorderTrackers = useReorderTrackers();

  const [query, setQuery] = useState("");
  const [doneOpen, setDoneOpen] = useState(true);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const trackers = data?.trackers ?? [];

  // DEV_NOTE: the last entry logged today per tracker, off the same cross-tracker timeline request
  // that used to feed the 24h ruler (docs/redesign-backlog.md — the ruler itself is gone, the
  // request's data still earns its keep for the Done section's timestamp).
  const lastOccurredByTracker = useMemo(() => {
    const map = new Map<string, Date>();
    for (const entry of timeline.data?.entries ?? []) {
      const occurredAt = new Date(entry.occurredAt);
      const existing = map.get(entry.trackerPublicId);
      if (!existing || occurredAt > existing) map.set(entry.trackerPublicId, occurredAt);
    }
    return map;
  }, [timeline.data?.entries]);

  const filteredRows = useMemo(() => {
    const rows = data?.today ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => row.tracker.name.toLowerCase().includes(needle));
  }, [data?.today, query]);

  const unloggedRows = filteredRows.filter((row) => !isLogged(row));
  const doneRows = filteredRows.filter((row) => isLogged(row));
  const isFiltering = query.trim().length > 0;

  function handleDrop(dropIndex: number) {
    if (dragIndex === null || dragIndex === dropIndex) {
      setDragIndex(null);
      return;
    }

    const reordered = moveItem(unloggedRows, dragIndex, dropIndex);
    reorderTrackers.mutate([
      ...reordered.map((row) => row.tracker.publicId),
      ...doneRows.map((row) => row.tracker.publicId),
    ]);
    setDragIndex(null);
  }

  // DEV_NOTE: full-bleed, matching -TrackerForm.tsx and the tracker detail screen. The mockup's
  // centred sheet is a phone; on a desktop window a max-w-2xl column put the day's list in a strip
  // with two empty margins wider than the content. The rows run edge to edge instead, and the
  // right-hand insight panels design/today-web.png shows will drop into the space beside them when
  // the surface backing them exists (see docs/redesign-backlog.md).
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-start justify-between gap-4 border-b border-border px-6 py-8">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
            {formatTodayLabel(today)}
          </p>
          <h1 className="font-heading text-3xl font-semibold">Today</h1>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/trackers/new">New tracker</Link>
        </Button>
      </header>

      {trackers.length > 0 && (
        <TodayStatStrip stats={data?.todayStats} dayNumber={dayNumber} isPending={isPending} />
      )}

      {trackers.length > 0 && (
        <div className="flex items-center justify-between gap-4 border-b border-border px-6 py-2">
          <div className="relative w-full max-w-sm">
            <MagnifyingGlass className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search trackers"
              className="rounded-sm pl-9"
            />
          </div>
          <div className="flex shrink-0 items-center gap-4 text-xs font-medium tracking-widest text-muted-foreground uppercase">
            <span>To log · {unloggedRows.length}</span>
            {!isFiltering && unloggedRows.length > 1 && (
              <span className="hidden items-center gap-1 sm:flex" title="Drag rows to reorder">
                <DotsSixVertical className="size-3.5" />
                Your order
              </span>
            )}
          </div>
        </div>
      )}

      {isPending ? (
        <p className="px-6 py-5 text-muted-foreground">Loading trackers...</p>
      ) : isError ? (
        <p className="px-6 py-5 text-destructive">Failed to load trackers.</p>
      ) : trackers.length === 0 ? (
        <div className="flex flex-col gap-4 px-6 py-10">
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
        <div className="flex flex-col">
          {unloggedRows.length === 0 && doneRows.length === 0 ? (
            <p className="px-6 py-10 text-center text-muted-foreground">
              No trackers match "{query}".
            </p>
          ) : (
            unloggedRows.map((row, index) => (
              <div
                key={row.tracker.publicId}
                draggable={!isFiltering}
                onDragStart={() => setDragIndex(index)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  handleDrop(index);
                }}
                className={cn(dragIndex === index && "opacity-50")}
              >
                <TrackerRow today={row} />
              </div>
            ))
          )}

          {doneRows.length > 0 && (
            <div className="flex flex-col">
              <button
                type="button"
                onClick={() => setDoneOpen((open) => !open)}
                className="flex items-center justify-between border-b border-border px-6 py-2 text-xs font-medium tracking-widest text-muted-foreground uppercase hover:text-foreground"
              >
                <span>Done · {doneRows.length}</span>
                <CaretDown
                  className={cn("size-3.5 transition-transform", !doneOpen && "-rotate-90")}
                />
              </button>
              {doneOpen &&
                doneRows.map((row) => (
                  <TrackerDoneRow
                    key={row.tracker.publicId}
                    today={row}
                    lastOccurredAt={lastOccurredByTracker.get(row.tracker.publicId) ?? null}
                  />
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
