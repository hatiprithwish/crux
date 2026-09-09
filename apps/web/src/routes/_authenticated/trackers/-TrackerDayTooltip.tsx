import type * as Schemas from "@app/schemas";
import Utilities from "@/utils";
import { formatDayLabel, formatMetricValue } from "./-utils";

// DEV_NOTE: the heatmap and the bar chart draw the same `days` array two ways, and a reader hovering
// either one is asking the same question — what happened on that day. One component answers it, so
// the two panels can't drift into describing a day differently (they did: the grid printed the raw
// canonical number, `14400`, where the bars printed `4h 0m`).
//
// DEV_NOTE: replaces the native `title` attribute both panels used. `title` waits a second or two,
// can't be styled, and truncates to one line — on a grid of 371 cells that is the difference between
// a chart you can read and a chart you can only look at.
const STATE_LABELS: Record<Schemas.TrackerDayState, string> = {
  not_active: "Before this tracker started",
  not_scheduled: "Not scheduled",
  no_data: "Nothing logged",
  partial: "Below target",
  met: "Met",
};

interface TrackerDayTooltipProps {
  day: Schemas.TrackerHeatmapDay;
  metric: Schemas.TrackerMetricDetail | null;
  // The affordance line under the numbers — "Click to log", only where the cell is actually a
  // button. Passed in rather than assumed, because the caller is what decides that.
  hint?: string;
}

export default function TrackerDayTooltip({ day, metric, hint }: TrackerDayTooltipProps) {
  const value =
    day.sum !== null && metric
      ? formatMetricValue(day.sum, metric.semanticType, metric.canonicalUnit)
      : null;

  // DEV_NOTE: the gap to the target as a magnitude plus a word, not a signed number — a negative
  // duration formats as "-1h -0m", and "over"/"under" is what a reader wanted from the sign anyway.
  // Deliberately not "ahead"/"behind": which side is good depends on the tracker's direction, and
  // the state line above already says whether the day counted.
  const delta =
    day.sum !== null && day.target !== null && metric
      ? {
          amount: formatMetricValue(
            Math.abs(day.sum - day.target),
            metric.semanticType,
            metric.canonicalUnit,
          ),
          word: day.sum >= day.target ? "over" : "under",
        }
      : null;

  return (
    <div className="flex flex-col gap-1 py-0.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium">{formatDayLabel(day.localDate)}</span>
        <span className="text-background/60 tabular-nums">
          {Utilities.formatFullDate(day.localDate)}
        </span>
      </div>

      <span className="text-sm font-medium tabular-nums">{value ?? "Nothing logged"}</span>

      {day.target !== null && metric ? (
        <span className="text-background/70 tabular-nums">
          Target {formatMetricValue(day.target, metric.semanticType, metric.canonicalUnit)}
          {delta ? ` · ${delta.amount} ${delta.word}` : ""}
        </span>
      ) : (
        <span className="text-background/70">No target</span>
      )}

      <span className="text-background/70">{STATE_LABELS[day.state]}</span>

      {hint ? <span className="text-background/50">{hint}</span> : null}
    </div>
  );
}
