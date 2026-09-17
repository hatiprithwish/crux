import type * as Schemas from "@app/schemas";
import { addDaysToLocalDate, dayOfWeek, useIsMobile } from "./-utils";
import TrackerHeatmapCell, { STATE_CLASSES, STATE_LABELS } from "./-TrackerHeatmapCell";
import { TrackerMonthCalendar } from "./-TrackerMonthCalendar";

// DEV_NOTE: architecture.md §6 — grid position is client-side arithmetic over a server-supplied day
// list; the server decides the state (it owns the schedule and target). Five states, and none of
// them is "zero": a gap is neutral (invariant 7), an unscheduled day is not a miss, and nothing
// renders before the tracker's activeFrom. The state colours and labels themselves live in
// -TrackerHeatmapCell.tsx, shared with the mobile month calendar below.

// DEV_NOTE: design/tracker-detail.png labels alternate rows only (M, W, F, S). Labelling all seven
// makes a column of text as tall as the grid is wide, and the unlabelled rows are readable by
// position once their neighbours are named.
// Keyed by day name rather than row index — two rows are labelled "S" and two "T", so the visible
// letter is not unique on its own.
const WEEKDAY_ROWS = [
  { day: "sunday", label: "" },
  { day: "monday", label: "M" },
  { day: "tuesday", label: "" },
  { day: "wednesday", label: "W" },
  { day: "thursday", label: "" },
  { day: "friday", label: "F" },
  { day: "saturday", label: "S" },
];

interface TrackerHeatmapProps {
  days: Schemas.TrackerHeatmapDay[];
  // DEV_NOTE: only for reading a day's number out loud on hover — the grid's five colours never
  // depend on it. Nullable because a tracker's primary metric can be missing from the manifest's
  // details, in which case the tooltip says what happened without saying how much.
  metric: Schemas.TrackerMetricDetail | null;
  // Explains the blank cells at the start of the grid, when the window reaches back past the day
  // the tracker began. Rendered here rather than by the caller so it sits inside the section's own
  // rule instead of adding a second one under it.
  note?: string;
  // DEV_NOTE: the grid is a read-only picture until a caller says otherwise — passing this turns
  // every cell the tracker was active for into a button that opens the day for logging. The caller
  // decides whether backfill is allowed at all (a "live" tracker's server rejects any date but
  // today), so the interaction can't appear on a screen where the write would 400.
  onSelectDay?: (localDate: string) => void;
  selectedDate?: string | null;
}

// DEV_NOTE: the caption under the grid names the range it covers — "17 weeks" alone doesn't say
// which seventeen, and a heatmap with no dates on it is the one chart where a reader can't work out
// the axis from the marks.
function formatMonth(localDate: string): string {
  return new Date(`${localDate}T00:00:00.000Z`).toLocaleDateString("en-GB", {
    month: "short",
    timeZone: "UTC",
  });
}

// DEV_NOTE: a year spread across 52 columns only reads on a desktop window. Squeezed into a phone's
// width the same grid becomes a stripe of illegible slivers — a fixed cell size with horizontal
// scroll trades that for having to swipe through a year one week at a time either way, so mobile
// gets a different layout instead: -TrackerMonthCalendar.tsx, one month per screen, paged, the same
// shape every calendar app on a phone already uses. Same `days`, same five states, same tap-to-log —
// only the arrangement changes.
export default function TrackerHeatmap({
  days,
  metric,
  note,
  onSelectDay,
  selectedDate,
}: TrackerHeatmapProps) {
  const isMobile = useIsMobile();

  if (days.length === 0)
    return (
      <p className="border-b border-border px-6 py-5 text-sm text-muted-foreground">
        No days to show.
      </p>
    );

  if (isMobile) {
    return (
      <TrackerMonthCalendar
        days={days}
        metric={metric}
        note={note}
        onSelectDay={onSelectDay}
        selectedDate={selectedDate}
      />
    );
  }

  // Pad the first week so the grid's rows line up with days of the week.
  const leadingBlanks = dayOfWeek(days[0].localDate);
  const weeks = Math.ceil((leadingBlanks + days.length) / 7);

  return (
    <div className="flex flex-col border-b border-border">
      <div className="flex items-baseline justify-between gap-4 border-b border-border px-6 py-2.5">
        <p className="text-[10px] font-medium tracking-widest text-muted-foreground uppercase">
          History · {weeks} weeks
        </p>
        <p className="text-xs text-muted-foreground">
          {formatMonth(days[0].localDate)} — {formatMonth(days[days.length - 1].localDate)}
        </p>
      </div>

      <div className="flex gap-2 overflow-x-auto px-6 py-5">
        <div className="grid shrink-0 grid-rows-7 gap-1">
          {WEEKDAY_ROWS.map((row) => (
            <span
              key={row.day}
              className="flex h-4 items-center text-[0.625rem] leading-none text-muted-foreground"
            >
              {row.label}
            </span>
          ))}
        </div>

        {/* DEV_NOTE: fixed-size cells (h-4 w-4), not auto-cols-fr — fr tracks stretch to fill
            whatever width the grid box has *regardless of column count*, which reads fine at ~52
            columns (each lands near 11px) but turns 3 columns (a tracker a few days old) into
            three giant bars filling the same box. A fixed cell size makes the grid's own width
            follow its column count instead — few weeks sit compact, many weeks overflow the
            container and the wrapping `overflow-x-auto` above takes over. This branch only ever
            renders on a desktop width now (the mobile calendar owns anything narrower). */}
        <div className="grid auto-cols-min grid-flow-col grid-rows-7 gap-1">
          {Array.from({ length: leadingBlanks }, (_, index) =>
            addDaysToLocalDate(days[0].localDate, index - leadingBlanks),
          ).map((paddingDate) => (
            <div key={`blank-${paddingDate}`} className="h-4 w-4 rounded-xs" />
          ))}
          {days.map((day) => (
            <TrackerHeatmapCell
              key={day.localDate}
              day={day}
              metric={metric}
              onSelectDay={onSelectDay}
              selectedDate={selectedDate}
              className="h-4 w-4 rounded-xs"
            />
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-6 pb-5">
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
