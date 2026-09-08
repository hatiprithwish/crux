import type * as Schemas from "@app/schemas";
import { cn } from "@/utils/tailwind";

// DEV_NOTE: design/tracker-detail.png's four-cell strip. Every figure but the streak is derived
// here, client-side, from the heatmap days the server already sent — the states it returns
// (not_active / not_scheduled / no_data / partial / met) are exactly the vocabulary these counts
// need, so a second endpoint would re-answer a question already on the wire.
//
// DEV_NOTE: the current streak is NOT recomputed here. TrackersRepo.computeStreak owns invariant 8
// ("today doesn't break a streak — the day isn't over"), and a second implementation of that rule
// in the client is a second implementation to disagree with.
export interface TrackerStats {
  daysLogged: number;
  scheduledDays: number;
  metDays: number;
  percentMet: number | null;
  bestStreak: number;
}

// DEV_NOTE: same walk as the server's computeStreak, minus the today exemption: unscheduled days
// and days before the tracker started are skipped rather than counted or broken on, and any
// scheduled day that isn't `met` ends the run. Bounded by the window it was given, which is why the
// label beside it names that window rather than claiming an all-time record.
export function deriveTrackerStats(days: Schemas.TrackerHeatmapDay[]): TrackerStats {
  let daysLogged = 0;
  let scheduledDays = 0;
  let metDays = 0;
  let bestStreak = 0;
  let run = 0;

  for (const day of days) {
    if (day.sum !== null) daysLogged++;

    if (day.state === "not_active" || day.state === "not_scheduled") continue;

    scheduledDays++;
    if (day.state === "met") {
      metDays++;
      run++;
      bestStreak = Math.max(bestStreak, run);
    } else {
      run = 0;
    }
  }

  return {
    daysLogged,
    scheduledDays,
    metDays,
    // Null, not 0 — a tracker with no scheduled day in the window has no rate to report, and 0%
    // would read as "you missed everything" (invariant 7).
    percentMet: scheduledDays === 0 ? null : Math.round((metDays / scheduledDays) * 100),
    bestStreak,
  };
}

interface StatProps {
  value: string;
  unit?: string;
  label: string;
  accent?: boolean;
}

function Stat({ value, unit, label, accent }: StatProps) {
  return (
    <div className="flex flex-col gap-1.5 border-r border-border px-6 py-5 last:border-r-0">
      <span
        className={cn(
          "font-heading text-3xl leading-none font-light tabular-nums",
          accent ? "text-primary" : "text-foreground",
        )}
      >
        {value}
        {unit ? <span className="ml-0.5 text-base text-muted-foreground">{unit}</span> : null}
      </span>
      <span className="text-[10px] font-medium tracking-widest text-muted-foreground uppercase">
        {label}
      </span>
    </div>
  );
}

interface TrackerStatStripProps {
  stats: TrackerStats;
  streak: number;
  windowDays: number;
  // True when the window reaches back past the tracker's activeFrom — only then is the rate a
  // "since active" figure rather than a slice of one.
  coversStart: boolean;
  isPending?: boolean;
}

// DEV_NOTE: the strip keeps its shape while the heatmap request is in flight, showing em dashes
// rather than being replaced by a "Loading…" line — four cells appearing after the fact would shove
// the whole page down on every visit.
export function TrackerStatStrip({
  stats,
  streak,
  windowDays,
  coversStart,
  isPending,
}: TrackerStatStripProps) {
  const windowLabel = windowDays % 7 === 0 ? `last ${windowDays / 7} weeks` : `last ${windowDays}d`;
  const value = (figure: number, blankAtZero = false) =>
    isPending || (blankAtZero && figure === 0) ? "—" : String(figure);

  return (
    <div className="grid grid-cols-2 border-b border-border sm:grid-cols-4">
      <Stat value={value(streak)} label="Day streak" accent={!isPending && streak > 0} />
      <Stat value={value(stats.daysLogged)} label="Days logged" />
      <Stat
        value={isPending || stats.percentMet === null ? "—" : String(stats.percentMet)}
        unit={isPending || stats.percentMet === null ? undefined : "%"}
        label={coversStart ? "Since active" : windowLabel}
      />
      <Stat
        value={value(stats.bestStreak, true)}
        label={coversStart ? "Best streak" : `Best · ${windowLabel}`}
      />
    </div>
  );
}
