import { Link } from "@tanstack/react-router";
import { cn } from "@/utils/tailwind";
import type * as Schemas from "@app/schemas";
import { useQuickAdd } from "./-data";
import { ToggleControl } from "./-ToggleControl";
import { IncrementControl } from "./-IncrementControl";
import { StepperControl } from "./-StepperControl";
import { DailyTotalControl } from "./-DailyTotalControl";
import { TimerControl } from "./-TimerControl";
import { AmountPadControl } from "./-AmountPadControl";
import { FormControl } from "./-FormControl";
import { MomentCapture } from "./-MomentCapture";
import { describeSchedule, getTodayLocalDate } from "./-utils";

// DEV_NOTE: architecture.md §6 — "One TrackerRow component, five child controls" (seven, as it
// turned out). This is the whole of the frontend's per-domain knowledge: a switch on
// manifest.control. Adding a habit, an expense tracker or a timer needs no new component.
//
// DEV_NOTE: the props name a *day*, not "today" — the same seven controls write the row's own day
// here and an earlier one from the heatmap's backfill panel (-TrackerBackfillPanel.tsx). Taking a
// TrackerTodayApiShape instead would make every control reach through a shape that only the Today
// screen can produce, and the backfill panel would have to forge one.
export interface ControlProps {
  tracker: Schemas.TrackerApiShape;
  // The date every payload this control sends is written against.
  localDate: string;
  daySum: number | null; // null = nothing logged that day (invariant 7 — never coalesced to 0)
  dayCount: number;
  openSession: Schemas.TrackerEntryApiShape | null; // timer trackers only
  onQuickAdd: (payload: Schemas.QuickAddPayload) => void;
  isPending: boolean;
}

interface TrackerRowProps {
  today: Schemas.TrackerTodayApiShape;
}

export default function TrackerRow({ today }: TrackerRowProps) {
  const tracker = today.tracker;
  const quickAdd = useQuickAdd();

  const controlProps: ControlProps = {
    tracker,
    localDate: getTodayLocalDate(),
    daySum: today.todaySum,
    dayCount: today.todayCount,
    openSession: today.openSession,
    isPending: quickAdd.isPending,
    onQuickAdd: (payload) => quickAdd.mutate({ publicId: tracker.publicId, payload }),
  };

  const isRunning = tracker.manifest.control === "timer" && today.openSession !== null;
  const topPlan = today.plans[0] ?? null;

  return (
    <div
      className={cn(
        // px-6 matches every other section on the screen — the row is the page's content now, not
        // a card inside a centred column. Name and control share one line (design/today-web.png) —
        // editing/archiving a tracker is the management list's job (/trackers/all), not this row's.
        // flex-wrap is the fallback for a control too wide for a narrow phone (a timer's label
        // field, an amount pad's three inputs) — it drops to its own line instead of forcing the
        // whole page into horizontal scroll.
        "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-6 py-4",
        isRunning && "border-l-2 border-l-primary bg-primary/5 pl-5.5",
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        {/* DEV_NOTE: the slot is rendered whether or not the tracker has an icon, so every name
            in the list starts at the same x — a list where only some rows are indented is harder
            to scan than one with no icons at all. */}
        <div className="flex size-8 shrink-0 items-center justify-center rounded-sm border border-border text-base">
          {tracker.icon}
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="truncate text-base font-medium">
            {/* DEV_NOTE: underlined on hover because it is a link to the history screen — the
                only path there now that the row no longer duplicates it as a button. */}
            <Link
              to="/trackers/$trackerId"
              params={{ trackerId: tracker.publicId }}
              className="hover:underline"
            >
              {tracker.name}
            </Link>
          </span>
          {/* DEV_NOTE: the first if-then plan takes the schedule's place — seeing the plan every
              time the row is read is the reminder; the schedule lives on the detail page. */}
          {topPlan ? (
            <span className="line-clamp-2 text-xs text-foreground/80 sm:truncate">
              <span className="text-muted-foreground">If</span> {topPlan.cue}
              {topPlan.response ? (
                <>
                  <span className="text-primary"> → </span>
                  {topPlan.response}
                </>
              ) : null}
              {today.streak > 0 ? (
                <span className="text-muted-foreground"> · {today.streak} day streak</span>
              ) : null}
            </span>
          ) : (
            <span className="truncate text-xs text-muted-foreground">
              {describeSchedule(tracker.manifest.schedule)}
              {today.streak > 0 ? ` · ${today.streak} day streak` : ""}
            </span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-start gap-1">
        {renderControl(tracker.manifest.control, controlProps)}
        <MomentCapture tracker={tracker} plans={today.plans} />
      </div>
    </div>
  );
}

// DEV_NOTE: exported because the backfill panel renders the same switch against an earlier date —
// a second copy of it there is how the two screens would drift apart the first time a control is
// added.
export function renderControl(control: Schemas.Control, props: ControlProps) {
  switch (control) {
    case "toggle":
      return <ToggleControl {...props} />;
    case "increment":
      return <IncrementControl {...props} />;
    case "stepper":
      return <StepperControl {...props} />;
    case "daily_total":
      return <DailyTotalControl {...props} />;
    case "timer":
      return <TimerControl {...props} />;
    case "amount_pad":
      return <AmountPadControl {...props} />;
    case "form":
      return <FormControl {...props} />;
  }
}
