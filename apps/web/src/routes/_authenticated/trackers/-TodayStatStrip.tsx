import { cn } from "@/utils/tailwind";
import { formatDuration, formatMinorAmount } from "./-utils";

// DEV_NOTE: design/today-web.png's five-cell strip. Four figures come straight off
// GetTrackersApiResponse.todayStats (server-computed off the same sums/targets it already loads
// for streaks — see TrackersRepo.getTrackers); "Tracking days" is the one exception, sourced from
// AppSidebar's useDayNumber so the two don't drift into disagreeing about what day it is.
export interface TodayStats {
  loggedCount: number;
  totalCount: number;
  timeTodaySeconds: number | null;
  spentTodayMinor: number | null;
  sevenDayRatePercent: number | null;
}

interface CellProps {
  value: string;
  label: string;
}

function Cell({ value, label }: CellProps) {
  return (
    <div className="flex flex-col gap-1 border-r border-border px-6 py-5 last:border-r-0">
      <span className="font-heading text-2xl leading-none font-light tabular-nums">{value}</span>
      <span className="text-[10px] font-medium tracking-widest text-muted-foreground uppercase">
        {label}
      </span>
    </div>
  );
}

interface TodayStatStripProps {
  stats: TodayStats | undefined;
  dayNumber: number | null;
  isPending: boolean;
  className?: string;
}

export function TodayStatStrip({ stats, dayNumber, isPending, className }: TodayStatStripProps) {
  const em = "—";

  return (
    <div
      className={cn(
        "grid grid-cols-2 border-b border-border sm:grid-cols-3 lg:grid-cols-5",
        className,
      )}
    >
      <Cell
        value={isPending ? em : `${stats?.loggedCount ?? 0} / ${stats?.totalCount ?? 0}`}
        label="Logged"
      />
      <Cell
        value={
          isPending || stats?.timeTodaySeconds == null ? em : formatDuration(stats.timeTodaySeconds)
        }
        label="Time"
      />
      <Cell
        value={
          isPending || stats?.spentTodayMinor == null
            ? em
            : formatMinorAmount(stats.spentTodayMinor)
        }
        label="Spent"
      />
      <Cell
        value={
          isPending || stats?.sevenDayRatePercent == null ? em : `${stats.sevenDayRatePercent}%`
        }
        label="7-day rate"
      />
      <Cell value={dayNumber === null ? em : String(dayNumber)} label="Tracking" />
    </div>
  );
}
