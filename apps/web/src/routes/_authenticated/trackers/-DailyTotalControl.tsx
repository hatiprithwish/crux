import { useState } from "react";
import { ArrowRight } from "@phosphor-icons/react";
import { Button } from "@/shadcn/ui/button";
import { Input } from "@/shadcn/ui/input";
import type * as Schemas from "@app/schemas";
import type { ControlProps } from "./-TrackerRow";
import { EntityLinkFields } from "./-EntityLinkFields";
import {
  DISPLAY_UNIT_SUFFIXES,
  formatDayLabel,
  formatMetricValue,
  resolveDisplayUnit,
  toCanonical,
} from "./-utils";

// The suffix map spells out full words for the aria-label ("in minutes"); the input itself only
// has room for a short cue, so the same suffix becomes its placeholder in title case ("Min").
function placeholderFor(unitSuffix: string | null): string {
  if (unitSuffix === null) return "Total";
  if (unitSuffix.length > 1) return unitSuffix[0].toUpperCase() + unitSuffix.slice(1);
  return unitSuffix.toUpperCase();
}

// DEV_NOTE: sets the day rather than adding to it — a weight reading replaces yesterday's typo, it
// doesn't stack on it. The server plans "replace_day" for exactly this reason.
//
// DEV_NOTE: the box asks for a number in the tracker's display unit and sends canonical (invariant
// 2). Without the conversion it asked for a number in *seconds* while saying nothing about it, so a
// duration tracker read "4" as four seconds when four minutes was meant — and then rendered it back
// as "4s", which is the only reason the mismatch was ever visible.
export function DailyTotalControl({
  tracker,
  localDate,
  daySum,
  onQuickAdd,
  isPending,
}: ControlProps) {
  const dayLabel = formatDayLabel(localDate);
  const [value, setValue] = useState<string>("");
  const [links, setLinks] = useState<Schemas.EntityLinkInput[]>([]);

  const primaryMetric = tracker.metricDetails.find(
    (metric) => metric.key === tracker.primaryMetricKey,
  );
  const displayUnit = resolveDisplayUnit(tracker.manifest, primaryMetric?.semanticType);
  const unitSuffix = displayUnit === null ? null : DISPLAY_UNIT_SUFFIXES[displayUnit];

  const submit = () => {
    const typed = Number(value);
    if (value === "" || Number.isNaN(typed)) return;
    onQuickAdd({
      control: "daily_total",
      date: localDate,
      total: toCanonical(typed, displayUnit),
      entityLinks: links,
    });
    setValue("");
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        {/* DEV_NOTE: through formatMetricValue like every other readout — it printed the raw
            canonical number before, so a duration tracker's day showed "165" beside an input that
            takes minutes. Nothing renders at all while daySum is null (invariant 7 still holds —
            it's just that an unlogged Today row has nothing worth saying yet, rather than an em
            dash sitting in front of an empty box). */}
        {daySum !== null && (
          <span className="text-sm tabular-nums text-muted-foreground">
            {primaryMetric
              ? formatMetricValue(daySum, primaryMetric.semanticType, primaryMetric.canonicalUnit)
              : daySum}
          </span>
        )}
        <Input
          type="number"
          step="any"
          value={value}
          placeholder={placeholderFor(unitSuffix)}
          className="w-20"
          aria-label={
            unitSuffix === null
              ? `${dayLabel}'s total for ${tracker.name}`
              : `${dayLabel}'s total for ${tracker.name}, in ${displayUnit}`
          }
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
        />
        <Button
          size="icon-sm"
          disabled={isPending || value === ""}
          onClick={submit}
          aria-label={`Save ${dayLabel}'s total for ${tracker.name}`}
        >
          <ArrowRight />
        </Button>
      </div>

      <EntityLinkFields value={links} onChange={setLinks} />
    </div>
  );
}
