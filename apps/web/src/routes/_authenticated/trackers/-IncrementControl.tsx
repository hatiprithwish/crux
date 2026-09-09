import { useState } from "react";
import { Button } from "@/shadcn/ui/button";
import type * as Schemas from "@app/schemas";
import type { ControlProps } from "./-TrackerRow";
import { EntityLinkFields } from "./-EntityLinkFields";
import { formatDayPhrase, formatMetricValue } from "./-utils";

// DEV_NOTE: additive — every tap is its own entry, so the day's total is a sum of taps rather than
// a value being overwritten. That's the difference from daily_total, and it's why the backend plans
// an "append" here.
export function IncrementControl({
  tracker,
  localDate,
  daySum,
  onQuickAdd,
  isPending,
}: ControlProps) {
  const step = tracker.manifest.step ?? 1;
  const [links, setLinks] = useState<Schemas.EntityLinkInput[]>([]);

  // DEV_NOTE: both numbers are canonical and were printed raw, which reads correctly for the count
  // metric this control derives and wrongly for any other — a tracker repointed at a duration
  // metric showed "165 / 240" where its own history screen said "2m 45s". formatMetricValue is the
  // one place that translation happens, so this readout goes through it too.
  const primaryMetric = tracker.metricDetails.find(
    (metric) => metric.key === tracker.primaryMetricKey,
  );
  const readout = (value: number) =>
    primaryMetric
      ? formatMetricValue(value, primaryMetric.semanticType, primaryMetric.canonicalUnit)
      : String(value);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="text-sm tabular-nums text-muted-foreground">
          {readout(daySum ?? 0)}
          {tracker.manifest.target !== null ? ` / ${readout(tracker.manifest.target)}` : ""}
        </span>
        <Button
          size="sm"
          disabled={isPending}
          onClick={() => onQuickAdd({ control: "increment", date: localDate, entityLinks: links })}
          aria-label={`Add ${step} to ${tracker.name} ${formatDayPhrase(localDate)}`}
        >
          +{step}
        </Button>
      </div>

      <EntityLinkFields value={links} onChange={setLinks} />
    </div>
  );
}
