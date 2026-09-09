import type * as Schemas from "@app/schemas";
import { cn } from "@/utils/tailwind";
import Utilities from "@/utils";
import { formatMetricValue } from "./-utils";

// DEV_NOTE: design/tracker-detail-mobile.png's "MINUTES PER DAY" panel. The heatmap answers "did I
// do it"; this answers "how much", which a five-state colour scale structurally cannot. Both read
// the same `days` array — no second request, and no charting library for what is a div per day.
//
// DEV_NOTE: not rendered for toggle trackers (see the detail page) — every bar on a boolean metric
// is the same height, which is the heatmap with extra steps.
const BAR_WINDOW_DAYS = 14;

interface TrackerDailyBarsProps {
  days: Schemas.TrackerHeatmapDay[];
  metric: Schemas.TrackerMetricDetail | null;
  target: number | null;
}

function formatBarDate(localDate: string): string {
  return new Date(`${localDate}T00:00:00.000Z`)
    .toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })
    .toUpperCase();
}

export function TrackerDailyBars({ days, metric, target }: TrackerDailyBarsProps) {
  const window = days.slice(-BAR_WINDOW_DAYS);
  const values = window.flatMap((day) => (day.sum === null ? [] : [day.sum]));
  if (values.length === 0) return null;

  // DEV_NOTE: the target is part of the scale, not just a line drawn over it — a run of days all
  // under target should look under target, which it can't if the tallest bar always fills the box.
  const ceiling = Math.max(...values, target ?? 0);
  if (ceiling <= 0) return null;

  return (
    <section className="flex flex-col border-b border-border">
      <div className="flex items-baseline justify-between gap-4 border-b border-border px-6 py-2.5">
        <p className="text-[10px] font-medium tracking-widest text-muted-foreground uppercase">
          {metric ? metric.name : "Per day"} · per day
        </p>
        <p className="text-xs text-muted-foreground">
          {window.length} days
          {target !== null && metric
            ? ` · target ${formatMetricValue(target, metric.semanticType, metric.canonicalUnit)}`
            : ""}
        </p>
      </div>

      <div className="relative mx-6 mt-5 flex h-28 items-end gap-1.5">
        {target !== null && target > 0 ? (
          <div
            className="pointer-events-none absolute inset-x-0 border-t border-dashed border-border"
            style={{ bottom: `${(target / ceiling) * 100}%` }}
            aria-hidden
          />
        ) : null}

        {window.map((day) => {
          const height = day.sum === null ? 0 : (day.sum / ceiling) * 100;

          return (
            <div
              key={day.localDate}
              className="flex h-full flex-1 items-end"
              title={`${Utilities.formatFullDate(day.localDate)} — ${
                day.sum === null || !metric
                  ? "nothing logged"
                  : formatMetricValue(day.sum, metric.semanticType, metric.canonicalUnit)
              }`}
            >
              {/* A day with nothing logged keeps its slot as a hairline rather than a zero-height
                  gap — an absent day and a small day must not look identical (invariant 7). */}
              <div
                className={cn(
                  "w-full rounded-xs",
                  day.state === "met" ? "bg-foreground" : "bg-muted-foreground/50",
                  day.sum === null && "bg-border",
                )}
                style={{ height: day.sum === null ? "2px" : `${Math.max(height, 2)}%` }}
              />
            </div>
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
