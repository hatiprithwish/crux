import { useMemo, useState } from "react";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import type * as Schemas from "@app/schemas";
import { Button } from "@/shadcn/ui/button";
import { addDaysToLocalDate } from "./-utils";
import TrackerHeatmapCell, { STATE_CLASSES, STATE_LABELS } from "./-TrackerHeatmapCell";

interface TrackerMonthCalendarProps {
  // Same flat day list the desktop grid draws — this view only changes how it's laid out.
  days: Schemas.TrackerHeatmapDay[];
  metric: Schemas.TrackerMetricDetail | null;
  note?: string;
  onSelectDay?: (localDate: string) => void;
  selectedDate?: string | null;
}

// Keyed by day name, like the desktop grid's WEEKDAY_ROWS — "S" and "T" both appear twice, so the
// visible letter alone isn't a unique key.
const WEEKDAY_COLUMNS = [
  { day: "sunday", label: "S" },
  { day: "monday", label: "M" },
  { day: "tuesday", label: "T" },
  { day: "wednesday", label: "W" },
  { day: "thursday", label: "T" },
  { day: "friday", label: "F" },
  { day: "saturday", label: "S" },
];

function monthKey(localDate: string): string {
  return localDate.slice(0, 7); // "YYYY-MM"
}

function addMonths(key: string, delta: number): string {
  const [year, month] = key.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

// DEV_NOTE: the mobile alternative to the desktop's GitHub-style contribution grid
// (-TrackerHeatmap.tsx). Squeezing 52 columns into a phone's width made every cell an illegible
// sliver; a year spread wide only works with the width a desktop window actually has. One month at
// a time, paged, is the same shape every calendar app on a phone already uses.
export function TrackerMonthCalendar({
  days,
  metric,
  note,
  onSelectDay,
  selectedDate,
}: TrackerMonthCalendarProps) {
  const dayByDate = useMemo(() => new Map(days.map((day) => [day.localDate, day])), [days]);

  // DEV_NOTE: bounded by what was actually fetched (the heatmap query's own window), not by the
  // tracker's activeFrom — paging past the loaded days would render a month with no data behind it
  // at all, which is a different, worse blank than "not_active" already covers for days that were
  // loaded but predate the tracker.
  const earliestMonth = days[0] ? monthKey(days[0].localDate) : null;
  const latestMonth = days[days.length - 1] ? monthKey(days[days.length - 1].localDate) : null;

  const [month, setMonth] = useState(() => latestMonth ?? monthKey(new Date().toISOString()));

  if (!earliestMonth || !latestMonth) {
    return (
      <p className="border-b border-border px-6 py-5 text-sm text-muted-foreground">
        No days to show.
      </p>
    );
  }

  const [year, monthNum] = month.split("-").map(Number);
  const firstOfMonth = `${month}-01`;
  const daysInMonth = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
  const leadingBlanks = new Date(`${firstOfMonth}T00:00:00.000Z`).getUTCDay();

  // DEV_NOTE: padding cells are the tail of the prior month, and the fetched window (364 days)
  // very often already covers those dates with real state — a lookup keyed only on date would
  // paint them as if they belonged to this month. `kind` keeps them structural placeholders
  // regardless of what `dayByDate` knows about that date, the same way the desktop grid's leading
  // blanks never look days up either. The date still rides along so each cell has a stable key.
  type Cell = { kind: "pad"; localDate: string } | { kind: "day"; localDate: string };
  const cells: Cell[] = [
    ...Array.from({ length: leadingBlanks }, (_, index) => ({
      kind: "pad" as const,
      localDate: addDaysToLocalDate(firstOfMonth, index - leadingBlanks),
    })),
    ...Array.from({ length: daysInMonth }, (_, index) => ({
      kind: "day" as const,
      localDate: `${month}-${String(index + 1).padStart(2, "0")}`,
    })),
  ];

  return (
    <div className="flex flex-col border-b border-border">
      <div className="flex items-center justify-between gap-4 border-b border-border px-6 py-2.5">
        <p className="text-[10px] font-medium tracking-widest text-muted-foreground uppercase">
          History
        </p>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Previous month"
            disabled={month <= earliestMonth}
            onClick={() => setMonth((current) => addMonths(current, -1))}
          >
            <CaretLeft />
          </Button>
          <p className="min-w-32 text-center text-xs text-muted-foreground tabular-nums">
            {monthLabel(month)}
          </p>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Next month"
            disabled={month >= latestMonth}
            onClick={() => setMonth((current) => addMonths(current, 1))}
          >
            <CaretRight />
          </Button>
        </div>
      </div>

      <div className="px-6 py-5">
        <div className="grid grid-cols-7 gap-1.5">
          {WEEKDAY_COLUMNS.map((column) => (
            <span
              key={column.day}
              className="flex h-4 items-center justify-center text-[0.625rem] leading-none text-muted-foreground"
            >
              {column.label}
            </span>
          ))}

          {cells.map((cell) => {
            if (cell.kind === "pad") {
              return <div key={cell.localDate} className="aspect-square" />;
            }

            const day = dayByDate.get(cell.localDate);
            // A day outside the fetched window (before the query's own range) has nothing to
            // render against — same as a padding cell, not a state.
            if (!day) return <div key={cell.localDate} className="aspect-square" />;

            return (
              <TrackerHeatmapCell
                key={cell.localDate}
                day={day}
                metric={metric}
                onSelectDay={onSelectDay}
                selectedDate={selectedDate}
                className="aspect-square w-full rounded-xs"
              />
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-2 px-6 pb-5">
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-[0.625rem] tracking-wide text-muted-foreground uppercase">
          {(Object.keys(STATE_LABELS) as Schemas.TrackerDayState[])
            .filter((state) => state !== "not_active")
            .map((state) => (
              <span key={state} className="flex items-center gap-1.5">
                <span className={`size-3 rounded-xs ${STATE_CLASSES[state]}`} />
                {STATE_LABELS[state]}
              </span>
            ))}
        </div>
        {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      </div>
    </div>
  );
}
