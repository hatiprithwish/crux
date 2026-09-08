import { useEffect, useState } from "react";
import type * as Schemas from "@app/schemas";

const HOUR_LABELS = [0, 4, 8, 12, 16, 20, 24];

function fractionOfDay(date: Date): number {
  return (date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600) / 24;
}

interface TrackerTimelineProps {
  entries: Schemas.TrackerTimelineEntryApiShape[];
}

// DEV_NOTE: design/today-web.png's 24h ruler — one tick per entry logged today, across every
// tracker, off GET /trackers/today/timeline (see docs/redesign-backlog.md for why that endpoint
// exists). Ticks are positioned by simple percentage-of-day math, not a charting library — there are
// at most a few dozen entries a day, and a div per tick is cheaper than a dependency.
export function TrackerTimeline({ entries }: TrackerTimelineProps) {
  // DEV_NOTE: lazy state init + an effect, not `new Date()` inline — render must stay pure, and the
  // "now" marker only needs to move once a minute, not on every re-render.
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col gap-1.5 py-2">
      <div className="relative h-6">
        <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
        {entries.map((entry) => (
          <div
            key={`${entry.trackerPublicId}-${entry.occurredAt}`}
            className="absolute top-0 h-full w-px bg-foreground/70"
            style={{ left: `${fractionOfDay(new Date(entry.occurredAt)) * 100}%` }}
            title={new Date(entry.occurredAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          />
        ))}
        <div
          className="absolute top-0 h-full w-0.5 bg-primary"
          style={{ left: `${fractionOfDay(now) * 100}%` }}
          title={`Now — ${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
        />
      </div>
      <div className="relative h-4 text-xs text-muted-foreground">
        {HOUR_LABELS.map((hour) => (
          <span
            key={hour}
            className="absolute -translate-x-1/2 tabular-nums first:translate-x-0 last:-translate-x-full"
            style={{ left: `${(hour / 24) * 100}%` }}
          >
            {String(hour).padStart(2, "0")}
          </span>
        ))}
      </div>
    </div>
  );
}
