import type * as Schemas from "@app/schemas";
import Utilities from "@/utils";
import { addDaysToLocalDate, formatDuration, formatMetricValue, getTodayLocalDate } from "./-utils";

// DEV_NOTE: design/tracker-detail.png's ENTRIES column. What changed from the old flat
// "2026-09-04 · label — value" line is the hierarchy: what the entry *was* reads first, when it
// happened reads second, and the value sits right-aligned in its own column so a run of them can be
// compared down the page instead of read one at a time.

interface TrackerEntryListProps {
  entries: Schemas.TrackerEntryApiShape[];
  tracker: Schemas.TrackerApiShape;
}

function dayLabel(localDate: string): string {
  const today = getTodayLocalDate();
  if (localDate === today) return "Today";
  if (localDate === addDaysToLocalDate(today, -1)) return "Yesterday";
  return new Date(`${localDate}T00:00:00.000Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    timeZone: "UTC",
  });
}

// DEV_NOTE: the locale is pinned to en-US for the time rather than left to the viewer's — the
// format is a product decision here ("2:30 PM"), and an unpinned locale renders the same instant as
// "14:30" or "2:30 pm" depending on the browser. The date half is DD-MM-YYYY via Utilities, so
// neither half is left to chance.
// DEV_NOTE: the day is UTC (it is a localDate, a calendar day) but the *time* is the viewer's own —
// occurredAt is a real instant, and the hour something happened is only meaningful locally.
function formatTimestamp(localDate: string, occurredAt: Date | string): string {
  const date = Utilities.formatFullDate(localDate);
  const time = new Date(occurredAt).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${date} · ${time}`;
}

// DEV_NOTE: the same entry shape reads differently per control — a duration in seconds, an amount in
// minor units, or a plain count. Display units are a presentation concern; storage stays canonical
// (invariant 2). The primary metric's semantic type drives the formatting where there is one, so a
// `form` tracker measuring millilitres doesn't print a bare integer.
function describeEntryValue(
  entry: Schemas.TrackerEntryApiShape,
  tracker: Schemas.TrackerApiShape,
): string {
  const control = tracker.manifest.control;
  if (control === "timer") {
    return entry.durationSeconds === null ? "RUNNING" : formatDuration(entry.durationSeconds);
  }
  if (control === "toggle") return "DONE";

  const value = entry.values[0];
  if (!value || value.valueNum === null) return "—";

  const metric =
    tracker.metricDetails.find((detail) => detail.key === value.metricKey) ??
    tracker.metricDetails.find((detail) => detail.key === tracker.primaryMetricKey) ??
    null;
  if (!metric) return String(value.valueNum);

  return formatMetricValue(value.valueNum, metric.semanticType, metric.canonicalUnit);
}

export function TrackerEntryList({ entries, tracker }: TrackerEntryListProps) {
  // Newest first — a log is read from the most recent end, and the API's range order is ascending.
  const ordered = [...entries].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  );

  // DEV_NOTE: decided per entry, not per tracker — a timer's finished sessions are measurements and
  // read as numbers, while the one still running is a status, and a rule set at the list level
  // would style the whole column by whichever kind happened to be present.
  const isStatusValue = (entry: Schemas.TrackerEntryApiShape) =>
    tracker.manifest.control === "toggle" ||
    (tracker.manifest.control === "timer" && entry.durationSeconds === null);

  return (
    <div className="flex flex-col">
      {ordered.map((entry) => (
        <div
          key={entry.publicId}
          className="flex items-start justify-between gap-4 border-b border-border px-6 py-3.5"
        >
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-sm font-medium">
              {entry.label ?? dayLabel(entry.localDate)}
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatTimestamp(entry.localDate, entry.occurredAt)}
            </span>
          </div>
          <span
            className={
              isStatusValue(entry)
                ? "shrink-0 text-xs font-semibold tracking-widest text-primary uppercase"
                : "shrink-0 text-sm tabular-nums"
            }
          >
            {describeEntryValue(entry, tracker)}
          </span>
        </div>
      ))}
    </div>
  );
}
