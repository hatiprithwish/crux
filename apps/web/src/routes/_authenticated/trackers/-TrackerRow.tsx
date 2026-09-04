import { Link } from "@tanstack/react-router";
import { DotsThree, Archive } from "@phosphor-icons/react";
import { Button } from "@/shadcn/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shadcn/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shadcn/ui/dropdown-menu";
import type * as Schemas from "@app/schemas";
import { useArchiveTracker, useQuickAdd } from "./-data";
import { ToggleControl } from "./-ToggleControl";
import { IncrementControl } from "./-IncrementControl";
import { StepperControl } from "./-StepperControl";
import { DailyTotalControl } from "./-DailyTotalControl";
import { TimerControl } from "./-TimerControl";
import { AmountPadControl } from "./-AmountPadControl";
import { FormControl } from "./-FormControl";
import { describeSchedule } from "./-utils";

// DEV_NOTE: architecture.md §6 — "One TrackerRow component, five child controls" (seven, as it
// turned out). This is the whole of the frontend's per-domain knowledge: a switch on
// manifest.control. Adding a habit, an expense tracker or a timer needs no new component.
export interface ControlProps {
  tracker: Schemas.TrackerApiShape;
  today: Schemas.TrackerTodayApiShape | null;
  onQuickAdd: (payload: Schemas.QuickAddPayload) => void;
  isPending: boolean;
}

interface TrackerRowProps {
  today: Schemas.TrackerTodayApiShape;
}

export default function TrackerRow({ today }: TrackerRowProps) {
  const tracker = today.tracker;
  const quickAdd = useQuickAdd();
  const archiveTracker = useArchiveTracker();

  const controlProps: ControlProps = {
    tracker,
    today,
    isPending: quickAdd.isPending,
    onQuickAdd: (payload) => quickAdd.mutate({ publicId: tracker.publicId, payload }),
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <CardTitle>
            {/* DEV_NOTE: underlined on hover because it is a link to the history screen — the
                only path there now that the row no longer duplicates it as a button. */}
            <Link
              to="/trackers/$trackerId"
              params={{ trackerId: tracker.publicId }}
              className="hover:underline"
            >
              {tracker.emoji ? `${tracker.emoji} ` : ""}
              {tracker.name}
            </Link>
          </CardTitle>
          <span className="text-xs text-muted-foreground">
            {describeSchedule(tracker.manifest.schedule)}
            {today.streak > 0 ? ` · ${today.streak} day streak` : ""}
          </span>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Tracker options">
              <DotsThree className="size-4" weight="bold" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              variant="destructive"
              disabled={archiveTracker.isPending}
              onSelect={() => archiveTracker.mutate(tracker.publicId)}
            >
              <Archive className="size-4" />
              Archive
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardHeader>
      <CardContent>{renderControl(tracker.manifest.control, controlProps)}</CardContent>
    </Card>
  );
}

function renderControl(control: Schemas.Control, props: ControlProps) {
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
