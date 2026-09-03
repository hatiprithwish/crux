import { useState } from "react";
import { Button } from "@/shadcn/ui/button";
import type * as Schemas from "@app/schemas";
import type { ControlProps } from "./-TrackerRow";
import { EntityLinkFields } from "./-EntityLinkFields";
import { getTodayLocalDate } from "./-utils";

// DEV_NOTE: the ± variant of increment — a negative step writes a negative entry rather than
// deleting one, so the log stays append-only (invariant 1) and a correction is visible as what it
// was, not as a hole.
export function StepperControl({ tracker, today, onQuickAdd, isPending }: ControlProps) {
  const step = tracker.manifest.step ?? 1;
  const [links, setLinks] = useState<Schemas.EntityLinkInput[]>([]);

  const send = (steps: number) =>
    onQuickAdd({ control: "stepper", date: getTodayLocalDate(), steps, entityLinks: links });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() => send(-1)}
          aria-label={`Subtract ${step} from ${tracker.name}`}
        >
          −{step}
        </Button>
        <span className="text-sm tabular-nums min-w-12 text-center">
          {today?.todaySum ?? 0}
          {tracker.manifest.target !== null ? ` / ${tracker.manifest.target}` : ""}
        </span>
        <Button
          size="sm"
          disabled={isPending}
          onClick={() => send(1)}
          aria-label={`Add ${step} to ${tracker.name}`}
        >
          +{step}
        </Button>
      </div>

      <EntityLinkFields value={links} onChange={setLinks} />
    </div>
  );
}
