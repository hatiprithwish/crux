import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/tanstack-react-start";
import { DotsThree, Archive, PencilSimple } from "@phosphor-icons/react";
import type * as Schemas from "@app/schemas";
import { Button } from "@/shadcn/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shadcn/ui/dropdown-menu";
import { AppTable, type AppTableColumn, type AppTableSortDirection } from "@/components/app-table";
import Utilities from "@/utils";
import { TrackersQueries, useArchiveTracker } from "../-data";
import { CONTROL_NAMES, DIRECTION_LABELS, describeSchedule, formatMetricValue } from "../-utils";

// DEV_NOTE: Today (trackers/index.tsx) renders only the trackers due today (isDueToday), each as a
// quick-add widget two lines tall. This screen is the other half — every non-archived tracker, due
// or not, started or not, one line each, every field that was a decision when it was created, side
// by side down a column so twelve trackers can be compared instead of read one at a time.
//
// DEV_NOTE: /trackers/all, not a top-level route — a static segment beats $trackerId in TanStack
// Router's ranking, and it sits beside the existing trackers/new for the same reason.
export const Route = createFileRoute("/_authenticated/trackers/all/")({
  component: AllTrackersPage,
});

// DEV_NOTE: the same list() the Today screen subscribes to, key and all — withToday is what carries
// `streak`, and asking for it under a second key would mean a second range scan over daily_facts
// returning bytes React Query already holds. Both screens read one cache entry.
type TrackerRow = Schemas.TrackerTodayApiShape;

type SortKey = "name" | "control" | "schedule" | "streak" | "activeFrom";

// DEV_NOTE: AppTable's sorting is documented server-side — onSort is a notification, not an
// implementation, and it never reorders `data` itself. The list is one request with every tracker
// in it, so sorting it here is a comparison over an array in memory; a sort param on /trackers
// would be a round trip to reorder something the client already holds in full.
function compareRows(a: TrackerRow, b: TrackerRow, key: SortKey): number {
  switch (key) {
    case "name":
      return a.tracker.name.localeCompare(b.tracker.name);
    case "control":
      return CONTROL_NAMES[a.tracker.manifest.control].localeCompare(
        CONTROL_NAMES[b.tracker.manifest.control],
      );
    case "schedule":
      return describeSchedule(a.tracker.manifest.schedule).localeCompare(
        describeSchedule(b.tracker.manifest.schedule),
      );
    case "streak":
      return a.streak - b.streak;
    case "activeFrom":
      return a.tracker.activeFrom.localeCompare(b.tracker.activeFrom);
  }
}

// DEV_NOTE: a target is a number in the metric's canonical unit, so it reads through the same
// formatter the Today screen and the detail page use — a currency_minor target of 50000 is "500.00"
// and a duration one is "3h 20m", never a bare five-digit integer (invariant 2: canonical storage,
// presentation applied late).
function formatTarget(tracker: Schemas.TrackerApiShape): string {
  if (tracker.manifest.target === null) return "—";

  const primary = tracker.metricDetails.find((detail) => detail.key === tracker.primaryMetricKey);
  if (!primary) return String(tracker.manifest.target);

  return formatMetricValue(tracker.manifest.target, primary.semanticType, primary.canonicalUnit);
}

function TrackerActions({ tracker }: { tracker: Schemas.TrackerApiShape }) {
  const archiveTracker = useArchiveTracker();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Options for ${tracker.name}`}>
          <DotsThree className="size-4" weight="bold" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link to="/trackers/$trackerId/edit" params={{ trackerId: tracker.publicId }}>
            <PencilSimple className="size-4" />
            Edit
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          disabled={archiveTracker.isPending}
          onSelect={() => archiveTracker.mutate(tracker.publicId)}
        >
          <Archive className="size-4" />
          Archive
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AllTrackersPage() {
  const { getToken } = useAuth();
  const { data, isPending, isError } = useQuery(TrackersQueries.list(true, getToken));

  // DEV_NOTE: null = the server's own order (trackers.sortOrder), which is the order the user
  // arranged them in and the one Today renders. A column sort is a temporary lens over that, not a
  // replacement for it, so there is no default sort column.
  const [sortBy, setSortBy] = useState<SortKey | null>(null);
  const [sortOrder, setSortOrder] = useState<AppTableSortDirection>("asc");

  const rows = useMemo(() => {
    const todayRows = data?.today ?? [];
    if (sortBy === null) return todayRows;

    const direction = sortOrder === "asc" ? 1 : -1;
    return [...todayRows].sort((a, b) => compareRows(a, b, sortBy) * direction);
  }, [data?.today, sortBy, sortOrder]);

  const columns: AppTableColumn<TrackerRow>[] = [
    {
      key: "name",
      header: "Name",
      sortKey: "name",
      cell: (row) => (
        <div className="flex items-center gap-2.5">
          {/* The slot renders whether or not the tracker has an icon, so every name in the column
              starts at the same x — the same reason TrackerRow keeps it. */}
          <span className="flex size-6 shrink-0 items-center justify-center rounded-sm border border-border text-xs">
            {row.tracker.icon}
          </span>
          <Link
            to="/trackers/$trackerId"
            params={{ trackerId: row.tracker.publicId }}
            className="font-medium hover:underline"
          >
            {row.tracker.name}
          </Link>
        </div>
      ),
    },
    {
      key: "control",
      header: "Control",
      sortKey: "control",
      cell: (row) => CONTROL_NAMES[row.tracker.manifest.control],
    },
    {
      key: "schedule",
      header: "Schedule",
      sortKey: "schedule",
      cell: (row) => describeSchedule(row.tracker.manifest.schedule),
    },
    {
      key: "target",
      header: "Target",
      className: "tabular-nums",
      cell: (row) => formatTarget(row.tracker),
    },
    {
      key: "direction",
      header: "Direction",
      headerTooltip:
        "How a day is scored against its target — whether the target is a floor to clear or a ceiling to stay under.",
      // DEV_NOTE: nullable on the manifest means "inherit the metric's default", but the Repo
      // resolves it on write, so a stored manifest always carries a real direction. The fallback is
      // for rows written before that resolution existed.
      cell: (row) =>
        row.tracker.manifest.direction === null
          ? "—"
          : DIRECTION_LABELS[row.tracker.manifest.direction],
    },
    {
      key: "metric",
      header: "Metric",
      headerTooltip:
        "The metric this tracker writes. Two trackers sharing one metric roll into a single number.",
      cell: (row) => <span className="text-muted-foreground">{row.tracker.primaryMetricKey}</span>,
    },
    {
      key: "streak",
      header: "Streak",
      sortKey: "streak",
      className: "tabular-nums",
      // DEV_NOTE: 0 is a real answer here (the streak is broken), unlike a null metric value —
      // invariant 7 is about absent measurements, not about a computed count that came out zero.
      cell: (row) => (row.streak > 0 ? `${row.streak} days` : "—"),
    },
    {
      key: "activeFrom",
      header: "Starts",
      sortKey: "activeFrom",
      className: "tabular-nums",
      cell: (row) => Utilities.formatFullDate(row.tracker.activeFrom),
    },
    {
      key: "actions",
      header: "",
      // DEV_NOTE: not data, so it stays out of the column-visibility panel — a blank row in that
      // list is unlabelled, unsearchable, and hiding it silently removes edit and archive.
      alwaysVisible: true,
      headerClassName: "w-12",
      className: "w-12",
      cell: (row) => <TrackerActions tracker={row.tracker} />,
    },
  ];

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-start justify-between gap-4 border-b border-border px-6 py-8">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
            Every tracker you have
          </p>
          <h1 className="font-heading text-3xl font-semibold">
            {rows.length === 0 ? "Trackers" : `Trackers · ${rows.length}`}
          </h1>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/trackers/new">New tracker</Link>
        </Button>
      </header>

      <div className="px-6 py-5">
        <AppTable<TrackerRow>
          columns={columns}
          data={rows}
          keyExtractor={(row) => row.tracker.publicId}
          isLoading={isPending}
          errorMsg={isError ? "Failed to load trackers." : undefined}
          sortBy={sortBy ?? undefined}
          sortOrder={sortOrder}
          // DEV_NOTE: AppTable hands back the direction it wants rather than asking us to derive
          // it, so a second click on the same header arrives here as "desc" already.
          onSort={(column, dir) => {
            setSortBy(column as SortKey);
            setSortOrder(dir);
          }}
          emptyState={
            <div className="flex flex-col items-start gap-4 py-8">
              <div className="flex flex-col gap-1">
                <p className="text-base font-medium">Nothing to manage yet.</p>
                <p className="max-w-md text-sm text-muted-foreground">
                  Every tracker you build shows up here with the decisions behind it — what it
                  measures, how often it asks, and what counts as a good day.
                </p>
              </div>
              <Button asChild>
                <Link to="/trackers/new">Build a tracker</Link>
              </Button>
            </div>
          }
        />
      </div>
    </div>
  );
}
