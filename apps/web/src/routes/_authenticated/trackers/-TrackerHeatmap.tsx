import type * as Schemas from "@app/schemas";
import { addDaysToLocalDate, dayOfWeek } from "./-utils";

// DEV_NOTE: architecture.md §6 — grid position is client-side arithmetic over a server-supplied day
// list; the server decides the state (it owns the schedule and target). Five states, and none of
// them is "zero": a gap is neutral (invariant 7), an unscheduled day is not a miss, and nothing
// renders before the tracker's activeFrom.
const STATE_CLASSES: Record<Schemas.TrackerDayState, string> = {
  not_active: "bg-transparent",
  not_scheduled: "bg-muted/40",
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

interface TrackerHeatmapProps {
  days: Schemas.TrackerHeatmapDay[];
}

export default function TrackerHeatmap({ days }: TrackerHeatmapProps) {
  if (days.length === 0) return <p className="text-sm text-muted-foreground">No days to show.</p>;

  // Pad the first week so the grid's rows line up with days of the week.
  const leadingBlanks = dayOfWeek(days[0].localDate);

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-flow-col grid-rows-7 gap-1 overflow-x-auto">
        {Array.from({ length: leadingBlanks }, (_, index) =>
          addDaysToLocalDate(days[0].localDate, index - leadingBlanks),
        ).map((paddingDate) => (
          <div key={`blank-${paddingDate}`} className="size-3 rounded-xs" />
        ))}
        {days.map((day) => (
          <div
            key={day.localDate}
            className={`size-3 rounded-xs ${STATE_CLASSES[day.state]}`}
            title={`${day.localDate} — ${STATE_LABELS[day.state]}${
              day.sum !== null
                ? ` (${day.sum}${day.target !== null ? ` / ${day.target}` : ""})`
                : ""
            }`}
          />
        ))}
      </div>

      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        {(Object.keys(STATE_LABELS) as Schemas.TrackerDayState[])
          .filter((state) => state !== "not_active")
          .map((state) => (
            <span key={state} className="flex items-center gap-1">
              <span className={`size-3 rounded-xs ${STATE_CLASSES[state]}`} />
              {STATE_LABELS[state]}
            </span>
          ))}
      </div>
    </div>
  );
}
