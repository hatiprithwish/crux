import { useState } from "react";
import { Button } from "@/shadcn/ui/button";
import { Input } from "@/shadcn/ui/input";
import { Field, FieldLabel } from "@/shadcn/ui/field";
import type * as Schemas from "@app/schemas";
import type { ControlProps } from "./-TrackerRow";
import { EntityLinkFields } from "./-EntityLinkFields";
import { getTodayLocalDate } from "./-utils";

// DEV_NOTE: the general case — one input per metric the manifest declares (a meal writes four
// readings, a workout set two; architecture.md §5 "entry_values"). The manifest is the field list,
// so a new multi-metric tracker needs no new component. Values the user leaves blank are omitted
// rather than sent as 0 — invariant 7, missing data is neutral.
export function FormControl({ tracker, onQuickAdd, isPending }: ControlProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [label, setLabel] = useState("");
  const [links, setLinks] = useState<Schemas.EntityLinkInput[]>([]);

  const filled = tracker.manifest.metrics.filter((key) => (values[key] ?? "") !== "");

  const submit = () => {
    const payloadValues = filled.map((metricKey) => ({
      metricKey,
      valueNum: Number(values[metricKey]),
    }));
    if (payloadValues.length === 0 || payloadValues.some((value) => Number.isNaN(value.valueNum))) {
      return;
    }

    onQuickAdd({
      control: "form",
      date: getTodayLocalDate(),
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
        return (
          <Field key={metricKey}>
            <FieldLabel htmlFor={`value-${metricKey}`}>
              {detail?.name ?? metricKey}
              {detail ? (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {detail.canonicalUnit}
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
          Log entry
        </Button>
      </div>
    </div>
  );
}
