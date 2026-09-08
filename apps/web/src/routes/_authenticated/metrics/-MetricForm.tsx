import { useForm } from "@tanstack/react-form";
import { Button } from "@/shadcn/ui/button";
import { Input } from "@/shadcn/ui/input";
import { Field, FieldLabel, FieldError } from "@/shadcn/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shadcn/ui/select";
import * as Schemas from "@app/schemas";
import { AGG_HINTS, UNIT_FOR_SEMANTIC_TYPE, UNIT_PLACEHOLDER } from "../trackers/-utils";

// DEV_NOTE: one form for both paths, with `lockImmutable` deciding which half is editable. On the
// edit path key/semanticType/canonicalUnit/dateAttribution render disabled rather than hidden —
// they're the fields that explain what the metric *is*, and hiding them would make an edit screen
// that can't answer "which metric am I looking at". See ZUpdateMetricApiRequest for why they can't
// change once readings exist.
interface MetricFormProps {
  initialValue?: Schemas.MetricBase;
  lockImmutable?: boolean;
  onSubmit: (value: Schemas.MetricBase) => Promise<void>;
  onCancel: () => void;
  submitLabel?: string;
}

const SEMANTIC_TYPE_LABELS: Record<Schemas.SemanticType, string> = {
  duration_seconds: "Duration (seconds)",
  count: "Count",
  currency_minor: "Money (minor units)",
  mass_grams: "Mass (grams)",
  volume_ml: "Volume (ml)",
  energy_kcal: "Energy (kcal)",
  distance_m: "Distance (metres)",
  rating_1_5: "Rating (1–5)",
  boolean: "Yes / no",
  text: "Text",
  json: "JSON",
};

const DEFAULT_AGG_LABELS: Record<Schemas.DefaultAgg, string> = {
  sum: "Sum",
  avg: "Average",
  max: "Maximum",
  min: "Minimum",
};

const DIRECTION_LABELS: Record<Schemas.Direction, string> = {
  higher_better: "More is better",
  lower_better: "Less is better",
  neutral: "Just tracking",
};

const DATE_ATTRIBUTION_LABELS: Record<Schemas.DateAttribution, string> = {
  start: "Day it started",
  end: "Day it ended",
  split: "Split across days",
};

export function MetricForm({
  initialValue,
  lockImmutable = false,
  onSubmit,
  onCancel,
  submitLabel = "Save",
}: MetricFormProps) {
  const defaultValues: Schemas.MetricBase = initialValue ?? {
    key: "",
    name: "",
    semanticType: "count",
    canonicalUnit: "",
    defaultAgg: "sum",
    defaultDirection: "higher_better",
    dateAttribution: "start",
  };

  const form = useForm({
    defaultValues,
    // DEV_NOTE: ZMetricValues, not ZMetricBase — same fields, but without the server-side defaults,
    // which would make the validator's input type disagree with the form's own values.
    validators: { onSubmit: Schemas.ZMetricValues },
    onSubmit: async ({ value }) => {
      await onSubmit(value);
    },
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        form.handleSubmit();
      }}
      className="flex flex-col gap-4"
    >
      <form.Field name="name">
        {(field) => {
          const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
          return (
            <Field data-invalid={isInvalid}>
              <FieldLabel htmlFor={field.name}>Name</FieldLabel>
              <Input
                id={field.name}
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
                aria-invalid={isInvalid}
              />
              <FieldError errors={field.state.meta.errors} />
            </Field>
          );
        }}
      </form.Field>

      <form.Field name="key">
        {(field) => {
          const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
          return (
            <Field data-invalid={isInvalid}>
              <FieldLabel htmlFor={field.name}>Key</FieldLabel>
              <Input
                id={field.name}
                value={field.state.value}
                disabled={lockImmutable}
                placeholder="pushups"
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
                aria-invalid={isInvalid}
              />
              {lockImmutable ? (
                <span className="text-xs text-muted-foreground">
                  The key can&apos;t change — every tracker manifest refers to this metric by key,
                  not by id, so renaming it would detach them all.
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">
                  How trackers refer to this metric. Unique, and permanent once saved.
                </span>
              )}
              <FieldError errors={field.state.meta.errors} />
            </Field>
          );
        }}
      </form.Field>

      <form.Field name="semanticType">
        {(field) => (
          <Field>
            <FieldLabel htmlFor={field.name}>Semantic type</FieldLabel>
            <Select
              value={field.state.value}
              disabled={lockImmutable}
              // DEV_NOTE: picking a type writes the unit it implies (UNIT_FOR_SEMANTIC_TYPE) and
              // the unit field locks. Asking for both independently is how a `duration_seconds`
              // metric could end up declaring its canonical unit as "count" — a pair nothing
              // downstream can read, and one no validation caught because each half was valid.
              onValueChange={(value) => {
                const semanticType = value as Schemas.SemanticType;
                field.handleChange(semanticType);
                form.setFieldValue("canonicalUnit", UNIT_FOR_SEMANTIC_TYPE[semanticType] ?? "");
              }}
            >
              <SelectTrigger id={field.name} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {(Object.keys(SEMANTIC_TYPE_LABELS) as Schemas.SemanticType[]).map((option) => (
                    <SelectItem key={option} value={option}>
                      {SEMANTIC_TYPE_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        )}
      </form.Field>

      <form.Subscribe selector={(state) => state.values.semanticType}>
        {(semanticType) => (
          <form.Field name="canonicalUnit">
            {(field) => {
              const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
              const implied = UNIT_FOR_SEMANTIC_TYPE[semanticType];
              return (
                <Field data-invalid={isInvalid}>
                  <FieldLabel htmlFor={field.name}>Canonical unit</FieldLabel>
                  <Input
                    id={field.name}
                    value={field.state.value}
                    disabled={lockImmutable || implied !== undefined}
                    placeholder={UNIT_PLACEHOLDER[semanticType]}
                    onChange={(event) => field.handleChange(event.target.value)}
                    onBlur={field.handleBlur}
                    aria-invalid={isInvalid}
                  />
                  <span className="text-xs text-muted-foreground">
                    {implied
                      ? `${SEMANTIC_TYPE_LABELS[semanticType]} is always measured in ${implied}.`
                      : "What one unit of this metric is — reps, pages, INR. Values are stored in it."}
                  </span>
                  <FieldError errors={field.state.meta.errors} />
                </Field>
              );
            }}
          </form.Field>
        )}
      </form.Subscribe>

      <form.Field name="defaultAgg">
        {(field) => (
          <Field>
            <FieldLabel htmlFor={field.name}>Aggregation</FieldLabel>
            <Select
              value={field.state.value}
              onValueChange={(value) => field.handleChange(value as Schemas.DefaultAgg)}
            >
              <SelectTrigger id={field.name} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {(Object.keys(DEFAULT_AGG_LABELS) as Schemas.DefaultAgg[]).map((option) => (
                    <SelectItem key={option} value={option}>
                      {DEFAULT_AGG_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {/* DEV_NOTE: unlike direction, this one really is the metric's to own — every tracker
                writing it has to agree or their numbers can't roll into a single figure. */}
            <span className="text-xs text-muted-foreground">
              {AGG_HINTS[field.state.value]} Shared by every tracker on this metric.
            </span>
          </Field>
        )}
      </form.Field>

      <form.Field name="defaultDirection">
        {(field) => (
          <Field>
            <FieldLabel htmlFor={field.name}>Default direction</FieldLabel>
            <Select
              value={field.state.value}
              onValueChange={(value) => field.handleChange(value as Schemas.Direction)}
            >
              <SelectTrigger id={field.name} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {(Object.keys(DIRECTION_LABELS) as Schemas.Direction[]).map((option) => (
                    <SelectItem key={option} value={option}>
                      {DIRECTION_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {/* DEV_NOTE: the wording carries the whole model — a tracker scores its own days by its
                own direction, and this only seeds a new one and colours the cross-tracker rollup,
                where there is no single tracker to ask. */}
            <span className="text-xs text-muted-foreground">
              What a new tracker on this metric starts with, and how it&apos;s read in a
              cross-tracker rollup. Each tracker sets its own direction and can disagree — the same
              minutes are worth raising for one habit and cutting for another.
            </span>
          </Field>
        )}
      </form.Field>

      <form.Field name="dateAttribution">
        {(field) => (
          <Field>
            <FieldLabel htmlFor={field.name}>Date attribution</FieldLabel>
            <Select
              value={field.state.value}
              disabled={lockImmutable}
              onValueChange={(value) => field.handleChange(value as Schemas.DateAttribution)}
            >
              <SelectTrigger id={field.name} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {(Object.keys(DATE_ATTRIBUTION_LABELS) as Schemas.DateAttribution[]).map(
                    (option) => (
                      <SelectItem key={option} value={option}>
                        {DATE_ATTRIBUTION_LABELS[option]}
                      </SelectItem>
                    ),
                  )}
                </SelectGroup>
              </SelectContent>
            </Select>
            {lockImmutable ? (
              <span className="text-xs text-muted-foreground">
                Which day an entry counts towards. Fixed after creation — changing it would leave
                already-recorded days disagreeing with new ones.
              </span>
            ) : null}
          </Field>
        )}
      </form.Field>

      <div className="flex gap-2 justify-end">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            form.reset();
            onCancel();
          }}
        >
          Cancel
        </Button>
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(isSubmitting) => (
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving..." : submitLabel}
            </Button>
          )}
        </form.Subscribe>
      </div>
    </form>
  );
}
