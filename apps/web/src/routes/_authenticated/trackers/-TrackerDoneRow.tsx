import { Link } from "@tanstack/react-router";
import type * as Schemas from "@app/schemas";
import { formatMetricValue } from "./-utils";

interface TrackerDoneRowProps {
  today: Schemas.TrackerTodayApiShape;
  // Last entry logged today for this tracker, off GET /trackers/today/timeline — the same request
  // that used to feed the 24h ruler, repurposed here for the one figure this row needs from it.
  lastOccurredAt: Date | null;
}

// DEV_NOTE: design/today-mobile.png's collapsed "DONE" rows — "Morning walk · 32 min · 07:10". A
// separate component from TrackerRow rather than a variant prop on it: nothing here is
// interactive (no quick-add control, no options menu), so it doesn't share TrackerRow's props or
// its per-control switch.
export function TrackerDoneRow({ today, lastOccurredAt }: TrackerDoneRowProps) {
  const tracker = today.tracker;
  const metric = tracker.metricDetails[0];
  const value = metric
    ? formatMetricValue(today.todaySum, metric.semanticType, metric.canonicalUnit)
    : "—";
  const time = lastOccurredAt
    ? lastOccurredAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div className="flex items-center justify-between gap-4 border-b border-border px-6 py-3 text-muted-foreground">
      <div className="flex items-center gap-3">
        <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary" />
        <Link
          to="/trackers/$trackerId"
          params={{ trackerId: tracker.publicId }}
          className="text-sm hover:text-foreground hover:underline"
        >
          {tracker.name}
        </Link>
      </div>
      <span className="text-sm tabular-nums">
        {value}
        {time ? ` · ${time}` : ""}
      </span>
    </div>
  );
}
