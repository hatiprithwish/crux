import { useState } from "react";
import { Button } from "@/shadcn/ui/button";
import { Input } from "@/shadcn/ui/input";
import { Field, FieldLabel } from "@/shadcn/ui/field";
import type * as Schemas from "@app/schemas";
import type { ControlProps } from "./-TrackerRow";
import { EntityLinkFields } from "./-EntityLinkFields";
import { DISPLAY_UNIT_LABELS, formatDayPhrase, resolveDisplayUnit, toCanonical } from "./-utils";

// DEV_NOTE: the general case — one input per metric the manifest declares (a meal writes four
// readings, a workout set two; architecture.md §5 "entry_values"). The manifest is the field list,
// so a new multi-metric tracker needs no new component. Values the user leaves blank are omitted
// rather than sent as 0 — invariant 7, missing data is neutral.
export function FormControl({ tracker, localDate, onQuickAdd, isPending }: ControlProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [label, setLabel] = useState("");
  const [links, setLinks] = useState<Schemas.EntityLinkInput[]>([]);

  const filled = tracker.manifest.metrics.filter((key) => (values[key] ?? "") !== "");

  // DEV_NOTE: manifest.displayUnit describes the tracker's *primary* metric and nothing else — it
  // is one field, and a form writing four readings can't have four meanings for it. Every secondary
  // field keeps asking for its own canonical unit, which is what its label has always said.
  const primaryDetail = tracker.metricDetails.find(
    (metric) => metric.key === tracker.primaryMetricKey,
  );
  const primaryDisplayUnit = resolveDisplayUnit(tracker.manifest, primaryDetail?.semanticType);
  const unitFor = (metricKey: string) =>
    metricKey === tracker.primaryMetricKey ? primaryDisplayUnit : null;

  const submit = () => {
    const payloadValues = filled.map((metricKey) => ({
      metricKey,
      valueNum: toCanonical(Number(values[metricKey]), unitFor(metricKey)),
    }));
    if (payloadValues.length === 0 || payloadValues.some((value) => Number.isNaN(value.valueNum))) {
      return;
    }

    onQuickAdd({
      control: "form",
      date: localDate,
      values: payloadValues,
      entityLinks: links,
      label: label.trim() === "" ? null : label.trim(),
    });
    setValues({});
    setLabel("");
  };

  return (
    <div className="flex flex-col gap-3">
      {/* DEV_NOTE: labelled by the metric's name and canonical unit, not its key — `key` is the
          machine identifier the manifest joins on, and "money_expense_amount" is not a form label.
          Falls back to the key if a declared metric can't be resolved, which the orphan scan would
          report as the repository bug it is. */}
      {tracker.manifest.metrics.map((metricKey) => {
        const detail = tracker.metricDetails.find((metric) => metric.key === metricKey);
        // The unit the box is typed in, which is the canonical one unless this tracker overrode it.
        const typedUnit = unitFor(metricKey);
        return (
          <Field key={metricKey}>
            <FieldLabel htmlFor={`value-${metricKey}`}>
              {detail?.name ?? metricKey}
              {detail ? (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {typedUnit === null ? detail.canonicalUnit : DISPLAY_UNIT_LABELS[typedUnit]}
                </span>
              ) : null}
            </FieldLabel>
            <Input
              id={`value-${metricKey}`}
              type="number"
              step="any"
              value={values[metricKey] ?? ""}
              onChange={(event) =>
                setValues((current) => ({ ...current, [metricKey]: event.target.value }))
              }
            />
          </Field>
        );
      })}

      <Field>
        <FieldLabel htmlFor="entry-label">Label (optional)</FieldLabel>
        <Input id="entry-label" value={label} onChange={(event) => setLabel(event.target.value)} />
      </Field>

      <EntityLinkFields value={links} onChange={setLinks} />

      <div className="flex justify-end">
        <Button size="sm" disabled={isPending || filled.length === 0} onClick={submit}>
          Log entry {formatDayPhrase(localDate)}
        </Button>
      </div>
    </div>
  );
}
