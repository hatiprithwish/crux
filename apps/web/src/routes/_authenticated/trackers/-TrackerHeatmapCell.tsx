import type * as Schemas from "@app/schemas";
import { cn } from "@/utils/tailwind";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shadcn/ui/tooltip";
import { formatDayLabel, formatMetricValue } from "./-utils";
import TrackerDayTooltip from "./-TrackerDayTooltip";

// DEV_NOTE: architecture.md §6 — grid position is client-side arithmetic over a server-supplied day
// list; the server decides the state (it owns the schedule and target). Five states, and none of
// them is "zero": a gap is neutral (invariant 7), an unscheduled day is not a miss, and nothing
// renders before the tracker's activeFrom.
export const STATE_CLASSES: Record<Schemas.TrackerDayState, string> = {
  not_active: "bg-transparent",
  not_scheduled: "border border-border bg-transparent",
  no_data: "bg-muted",
  partial: "bg-primary/40",
  met: "bg-primary",
};

export const STATE_LABELS: Record<Schemas.TrackerDayState, string> = {
  not_active: "before this tracker started",
  not_scheduled: "not scheduled",
  no_data: "nothing logged",
  partial: "below target",
  met: "met",
};

interface TrackerHeatmapCellProps {
  day: Schemas.TrackerHeatmapDay;
  metric: Schemas.TrackerMetricDetail | null;
  onSelectDay?: (localDate: string) => void;
  selectedDate?: string | null;
  className: string;
}

// DEV_NOTE: the one cell renderer for both layouts that draw this data — the 52-week contribution
// grid (-TrackerHeatmap.tsx) and the mobile month calendar (-TrackerMonthCalendar.tsx). Same states,
// same tooltip, same tap-to-log affordance either way; only the grid position around it differs.
export default function TrackerHeatmapCell({
  day,
  metric,
  onSelectDay,
  selectedDate,
  className,
}: TrackerHeatmapCellProps) {
  const cellClassName = cn(className, STATE_CLASSES[day.state]);

  // A day before the tracker existed has nothing to log against and nothing to say — it is padding
  // with a date, not a cell, so it gets no tooltip either.
  if (day.state === "not_active") {
    return <div className={cellClassName} />;
  }

  // DEV_NOTE: the same sentence the tooltip renders, flattened for a screen reader — the tooltip's
  // own content is announced too, but only once focus reaches the cell, and a cell with no
  // accessible name is unreachable by name in the first place.
  const label = `${formatDayLabel(day.localDate)} — ${STATE_LABELS[day.state]}${
    day.sum !== null && metric
      ? `, ${formatMetricValue(day.sum, metric.semanticType, metric.canonicalUnit)}`
      : ""
  }`;
  const canLog = Boolean(onSelectDay);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {canLog ? (
          <button
            type="button"
            onClick={() => onSelectDay?.(day.localDate)}
            // DEV_NOTE: the ring sits outside the cell (offset) rather than inside it — an
            // inset ring on a small square reads as a different *state*, and the five states are
            // the only thing colour is allowed to mean in this grid.
            className={cn(
              cellClassName,
              "cursor-pointer transition-transform hover:scale-125 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:outline-none",
              selectedDate === day.localDate &&
                "ring-2 ring-primary ring-offset-1 ring-offset-background",
            )}
            aria-label={`Log ${label}`}
            aria-pressed={selectedDate === day.localDate}
          />
        ) : (
          // A read-only cell is still hoverable, and tabbable so the tooltip is reachable without a
          // mouse — it just has nothing to do when activated.
          <div className={cellClassName} tabIndex={0} role="img" aria-label={label} />
        )}
      </TooltipTrigger>
      <TooltipContent className="flex-col items-stretch">
        <TrackerDayTooltip
          day={day}
          metric={metric}
          hint={canLog ? "Select to log this day" : undefined}
        />
      </TooltipContent>
    </Tooltip>
  );
}
