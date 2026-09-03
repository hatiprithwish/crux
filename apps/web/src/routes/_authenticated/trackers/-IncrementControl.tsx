import { useState } from "react";
import { Button } from "@/shadcn/ui/button";
import type * as Schemas from "@app/schemas";
import type { ControlProps } from "./-TrackerRow";
import { EntityLinkFields } from "./-EntityLinkFields";
import { getTodayLocalDate } from "./-utils";

// DEV_NOTE: additive — every tap is its own entry, so the day's total is a sum of taps rather than
// a value being overwritten. That's the difference from daily_total, and it's why the backend plans
// an "append" here.
export function IncrementControl({ tracker, today, onQuickAdd, isPending }: ControlProps) {
  const step = tracker.manifest.step ?? 1;
  const [links, setLinks] = useState<Schemas.EntityLinkInput[]>([]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="text-sm tabular-nums text-muted-foreground">
          {today?.todaySum ?? 0}
          {tracker.manifest.target !== null ? ` / ${tracker.manifest.target}` : ""}
        </span>
        <Button
          size="sm"
          disabled={isPending}
          onClick={() =>
            onQuickAdd({ control: "increment", date: getTodayLocalDate(), entityLinks: links })
          }
          aria-label={`Add ${step} to ${tracker.name}`}
        >
          +{step}
        </Button>
      </div>

      <EntityLinkFields value={links} onChange={setLinks} />
    </div>
  );
}
