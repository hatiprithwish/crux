import { useState } from "react";
import { Button } from "@/shadcn/ui/button";
import type * as Schemas from "@app/schemas";
import type { ControlProps } from "./-TrackerRow";
import { EntityLinkFields } from "./-EntityLinkFields";
import { formatDayPhrase, formatMetricValue } from "./-utils";

// DEV_NOTE: the ± variant of increment — a negative step writes a negative entry rather than
// deleting one, so the log stays append-only (invariant 1) and a correction is visible as what it
// was, not as a hole.
export function StepperControl({
  tracker,
  localDate,
  daySum,
  onQuickAdd,
  isPending,
}: ControlProps) {
  const step = tracker.manifest.step ?? 1;
  const dayPhrase = formatDayPhrase(localDate);
  const [links, setLinks] = useState<Schemas.EntityLinkInput[]>([]);

  // DEV_NOTE: same reasoning as IncrementControl — the day's sum and the target are canonical
  // numbers, and printing them raw only reads correctly for a count metric. The button labels stay
  // raw on purpose: ±60 on a duration is the step as the manifest holds it, and dressing it up as
  // "±1m" would promise a rounding the write path doesn't do.
  const primaryMetric = tracker.metricDetails.find(
    (metric) => metric.key === tracker.primaryMetricKey,
  );
  const readout = (value: number) =>
    primaryMetric
      ? formatMetricValue(value, primaryMetric.semanticType, primaryMetric.canonicalUnit)
      : String(value);

  const send = (steps: number) =>
    onQuickAdd({ control: "stepper", date: localDate, steps, entityLinks: links });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() => send(-1)}
          aria-label={`Subtract ${step} from ${tracker.name} ${dayPhrase}`}
        >
          −{step}
        </Button>
        <span className="text-sm tabular-nums min-w-12 text-center">
          {readout(daySum ?? 0)}
          {tracker.manifest.target !== null ? ` / ${readout(tracker.manifest.target)}` : ""}
        </span>
        <Button
          size="sm"
          disabled={isPending}
          onClick={() => send(1)}
          aria-label={`Add ${step} to ${tracker.name} ${dayPhrase}`}
        >
          +{step}
        </Button>
      </div>

      <EntityLinkFields value={links} onChange={setLinks} />
    </div>
  );
}
