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
  last: "Last value",
  max: "Maximum",
  min: "Minimum",
};

const DIRECTION_LABELS: Record<Schemas.Direction, string> = {
  higher_better: "Higher is better",
  lower_better: "Lower is better",
  neutral: "Neutral",
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
    direction: "higher_better",
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
              onValueChange={(value) => field.handleChange(value as Schemas.SemanticType)}
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

      <form.Field name="canonicalUnit">
        {(field) => {
          const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
          return (
            <Field data-invalid={isInvalid}>
              <FieldLabel htmlFor={field.name}>Canonical unit</FieldLabel>
              <Input
                id={field.name}
                value={field.state.value}
                disabled={lockImmutable}
                placeholder="reps"
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
                aria-invalid={isInvalid}
              />
              <FieldError errors={field.state.meta.errors} />
            </Field>
          );
        }}
      </form.Field>

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
          </Field>
        )}
      </form.Field>

      <form.Field name="direction">
        {(field) => (
          <Field>
            <FieldLabel htmlFor={field.name}>Direction</FieldLabel>
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
