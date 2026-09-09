import type * as Schemas from "@app/schemas";
import { cn } from "@/utils/tailwind";
import Utilities from "@/utils";
import { addDaysToLocalDate, dayOfWeek } from "./-utils";

// DEV_NOTE: architecture.md §6 — grid position is client-side arithmetic over a server-supplied day
// list; the server decides the state (it owns the schedule and target). Five states, and none of
// them is "zero": a gap is neutral (invariant 7), an unscheduled day is not a miss, and nothing
// renders before the tracker's activeFrom.
const STATE_CLASSES: Record<Schemas.TrackerDayState, string> = {
  not_active: "bg-transparent",
  not_scheduled: "border border-border bg-transparent",
  no_data: "bg-muted",
  partial: "bg-primary/40",
  met: "bg-primary",
};

const STATE_LABELS: Record<Schemas.TrackerDayState, string> = {
  not_active: "before this tracker started",
  not_scheduled: "not scheduled",
  no_data: "nothing logged",
  partial: "below target",
  met: "met",
};

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

export default function TrackerHeatmap({
  days,
  note,
  onSelectDay,
  selectedDate,
}: TrackerHeatmapProps) {
  if (days.length === 0)
    return (
      <p className="border-b border-border px-6 py-5 text-sm text-muted-foreground">
        No days to show.
      </p>
    );

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

        {/* DEV_NOTE: auto-cols-fr, not fixed-width cells — a year's grid then spreads across
            whatever width the column has instead of sitting in the left third of it. Row height is
            fixed at h-4 rather than derived from the (variable) column width, because the weekday
            labels beside it are a separate grid: anything that makes a cell's height depend on the
            viewport puts the two grids out of step. min-w is what makes the overflow-x scroll kick
            in on a phone instead of squeezing 52 weeks into 320px. */}
        <div className="grid min-w-xl flex-1 auto-cols-fr grid-flow-col grid-rows-7 gap-1">
          {Array.from({ length: leadingBlanks }, (_, index) =>
            addDaysToLocalDate(days[0].localDate, index - leadingBlanks),
          ).map((paddingDate) => (
            <div key={`blank-${paddingDate}`} className="h-4 w-full rounded-xs" />
          ))}
          {days.map((day) => {
            const description = `${Utilities.formatFullDate(day.localDate)} — ${STATE_LABELS[day.state]}${
              day.sum !== null
                ? ` (${day.sum}${day.target !== null ? ` / ${day.target}` : ""})`
                : ""
            }`;
            const className = `h-4 w-full rounded-xs ${STATE_CLASSES[day.state]}`;

            // A day before the tracker existed has nothing to log against — it is padding with a
            // date, not a cell.
            if (!onSelectDay || day.state === "not_active") {
              return <div key={day.localDate} className={className} title={description} />;
            }

            return (
              <button
                key={day.localDate}
                type="button"
                onClick={() => onSelectDay(day.localDate)}
                // DEV_NOTE: the ring sits outside the cell (offset) rather than inside it — a
                // 16px-tall square with an inset ring reads as a different *state*, and the five
                // states are the only thing colour is allowed to mean in this grid.
                className={cn(
                  className,
                  "cursor-pointer transition-transform hover:scale-125 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:outline-none",
                  selectedDate === day.localDate &&
                    "ring-2 ring-primary ring-offset-1 ring-offset-background",
                )}
                title={description}
                aria-label={`Log ${description}`}
                aria-pressed={selectedDate === day.localDate}
              />
            );
          })}
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
