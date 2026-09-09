import type * as Schemas from "@app/schemas";
import { cn } from "@/utils/tailwind";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shadcn/ui/tooltip";
import { formatDayLabel, formatMetricValue } from "./-utils";
import TrackerDayTooltip from "./-TrackerDayTooltip";

// DEV_NOTE: design/tracker-detail-mobile.png's "MINUTES PER DAY" panel. The heatmap answers "did I
// do it"; this answers "how much", which a five-state colour scale structurally cannot. Both read
// the same `days` array — no second request, and no charting library for what is a div per day.
//
// DEV_NOTE: not rendered for toggle trackers (see the detail page) — every bar on a boolean metric
// is the same height, which is the heatmap with extra steps.
const BAR_WINDOW_DAYS = 14;

// DEV_NOTE: the target is read off each day rather than passed in from the manifest. A tracker's
// goal is a value *from a date* (TrackerTargetsCommon), so a window that straddles the day a target
// changed has two of them in it — one flat line at today's value would draw days as under-target
// that were met against the goal actually in force, which is the same lie the scoring path used to
// tell. Each bar carries its own line segment, so the line steps where the goal did.
interface TrackerDailyBarsProps {
  days: Schemas.TrackerHeatmapDay[];
  metric: Schemas.TrackerMetricDetail | null;
}

function formatBarDate(localDate: string): string {
  return new Date(`${localDate}T00:00:00.000Z`)
    .toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })
    .toUpperCase();
}

export function TrackerDailyBars({ days, metric }: TrackerDailyBarsProps) {
  const window = days.slice(-BAR_WINDOW_DAYS);
  const values = window.flatMap((day) => (day.sum === null ? [] : [day.sum]));
  if (values.length === 0) return null;

  const targets = window.flatMap((day) => (day.target === null ? [] : [day.target]));
  // The target in force on the last day in the window — what the header prints, since a header can
  // only say one number and "what you are aiming for now" is the useful one.
  const currentTarget = window[window.length - 1].target;

  // DEV_NOTE: the target is part of the scale, not just a line drawn over it — a run of days all
  // under target should look under target, which it can't if the tallest bar always fills the box.
  // Every target in the window counts, not just the current one: a window containing a goal that
  // was later lowered still has to fit the taller line.
  const ceiling = Math.max(...values, ...targets, 0);
  if (ceiling <= 0) return null;

  return (
    <section className="flex flex-col border-b border-border">
      <div className="flex items-baseline justify-between gap-4 border-b border-border px-6 py-2.5">
        <p className="text-[10px] font-medium tracking-widest text-muted-foreground uppercase">
          {metric ? metric.name : "Per day"} · per day
        </p>
        <p className="text-xs text-muted-foreground">
          {window.length} days
          {currentTarget !== null && metric
            ? ` · target ${formatMetricValue(
                currentTarget,
                metric.semanticType,
                metric.canonicalUnit,
              )}`
            : ""}
        </p>
      </div>

      <div className="relative mx-6 mt-5 flex h-28 items-end gap-1.5">
        {window.map((day) => {
          const height = day.sum === null ? 0 : (day.sum / ceiling) * 100;
          const describeDay =
            day.sum === null || !metric
              ? "nothing logged"
              : formatMetricValue(day.sum, metric.semanticType, metric.canonicalUnit);

          return (
            <Tooltip key={day.localDate}>
              {/* DEV_NOTE: the whole column is the hover target, not the bar — a 2px hairline for a
                  day with nothing logged is the day a reader most wants to hover and the one they
                  could never hit. Tabbable for the same reason the heatmap's cells are: the tooltip
                  is the only place these numbers are written down. */}
              <TooltipTrigger asChild>
                <div
                  className="relative flex h-full flex-1 items-end rounded-xs transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  tabIndex={0}
                  role="img"
                  aria-label={`${formatDayLabel(day.localDate)} — ${describeDay}`}
                >
                  {/* DEV_NOTE: one segment per day rather than one line across the panel, so the
                      target steps on the day the goal changed instead of pretending today's applied
                      all along. Drawn inside the day's own column, which is what makes the step land
                      in the gap between two bars rather than through one of them. */}
                  {day.target !== null && day.target > 0 ? (
                    <div
                      className="pointer-events-none absolute inset-x-0 border-t border-dashed border-border"
                      style={{ bottom: `${(day.target / ceiling) * 100}%` }}
                      aria-hidden
                    />
                  ) : null}

                  {/* A day with nothing logged keeps its slot as a hairline rather than a
                      zero-height gap — an absent day and a small day must not look identical
                      (invariant 7). */}
                  <div
                    className={cn(
                      "w-full rounded-xs",
                      day.state === "met" ? "bg-foreground" : "bg-muted-foreground/50",
                      day.sum === null && "bg-border",
                    )}
                    style={{ height: day.sum === null ? "2px" : `${Math.max(height, 2)}%` }}
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent className="flex-col items-stretch">
                <TrackerDayTooltip day={day} metric={metric} />
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      <div className="flex justify-between px-6 py-3 text-[0.625rem] tracking-wide text-muted-foreground uppercase tabular-nums">
        <span>{formatBarDate(window[0].localDate)}</span>
        <span>{formatBarDate(window[window.length - 1].localDate)}</span>
      </div>
    </section>
  );
}
