import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/tanstack-react-start";
import { z } from "zod";
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
import { MetricsQueries } from "./-data";
import { CONTROL_LABELS, getTodayLocalDate } from "./-utils";

// DEV_NOTE: this form *is* the manifest engine's front door — everything Phase 0–3 hardcoded per
// domain (which control, which metric, which schedule) is a field here. Creating "another toggle
// habit" through it writes no new code anywhere, which is implementation.md Phase 6's acceptance
// test.
//
// DEV_NOTE: the form is flat and converted to the nested API shape on submit — same approach as the
// old expense form, which typed amounts in major units and converted to minor.
//
// DEV_NOTE: templates below are a presentation layer only — they pick starting values for the same
// manifest/metric fields the Advanced section edits directly. No new field exists because of a
// template; a template is just a shortcut into the fields that were already here.
const ZTrackerFormValues = z
  .object({
    name: z.string().min(1, "Name is required"),
    emoji: z.string().nullable().optional(),
    control: Schemas.ZControl,
    entryMode: z.enum(["live", "retro"]),
    scheduleType: z.enum(["daily", "days_of_week", "times_per_week"]),
    scheduleDays: z.array(z.number().min(0).max(6)),
    scheduleCount: z.number().int().min(1).max(7),
    target: z.string(),
    step: z.string(),
    compute: z.string(),
    activeFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    metricMode: z.enum(["new", "existing"]),
    metricPublicId: z.string(),
    metricName: z.string(),
    metricKey: z.string(),
    semanticType: Schemas.ZSemanticType,
    canonicalUnit: z.string(),
    defaultAgg: Schemas.ZDefaultAgg,
    direction: Schemas.ZDirection,
  })
  .superRefine((values, ctx) => {
    if (values.metricMode === "existing" && values.metricPublicId === "") {
      ctx.addIssue({ code: "custom", path: ["metricPublicId"], message: "Choose a metric" });
    }
    if (values.metricMode === "new" && values.canonicalUnit.trim() === "") {
      ctx.addIssue({ code: "custom", path: ["canonicalUnit"], message: "Unit is required" });
    }
    if (values.scheduleType === "days_of_week" && values.scheduleDays.length === 0) {
      ctx.addIssue({ code: "custom", path: ["scheduleDays"], message: "Pick at least one day" });
    }
  });
type TrackerFormValues = z.infer<typeof ZTrackerFormValues>;

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const NO_COMPUTE = "none";

interface Template {
  key: string;
  label: string;
  description: string;
  icon: string;
  control: Schemas.Control;
  semanticType: Schemas.SemanticType;
  canonicalUnit: string;
  defaultAgg: Schemas.DefaultAgg;
  direction: Schemas.Direction;
  showUnit: boolean;
  unitLabel: string;
  unitPlaceholder: string;
  showTarget: boolean;
  targetLabel: string;
}

// DEV_NOTE: one preset per manifest.control shape a user is likely to reach for by intent rather
// than by mechanism — "measure" defaults to semanticType "count" rather than picking among
// mass_grams/volume_ml/distance_m, since the right one differs per instance (weight vs water vs
// distance) and forcing a sub-choice here would just re-add the field this screen exists to hide.
// Advanced still edits the real semanticType for whoever needs it correct.
const TEMPLATES: Template[] = [
  {
    key: "did_it",
    label: "Did it or didn't",
    description: "Meditate, take a bath",
    icon: "✓",
    control: "toggle",
    semanticType: "boolean",
    canonicalUnit: "boolean",
    defaultAgg: "sum",
    direction: "higher_better",
    showUnit: false,
    unitLabel: "Unit",
    unitPlaceholder: "",
    showTarget: false,
    targetLabel: "Daily goal",
  },
  {
    key: "count",
    label: "Count something",
    description: "Pushups, pages, glasses",
    icon: "#",
    control: "increment",
    semanticType: "count",
    canonicalUnit: "",
    defaultAgg: "sum",
    direction: "higher_better",
    showUnit: true,
    unitLabel: "Unit",
    unitPlaceholder: "reps",
    showTarget: true,
    targetLabel: "Daily goal",
  },
  {
    key: "time",
    label: "Time something",
    description: "Deep work, running",
    icon: "⏱",
    control: "timer",
    semanticType: "duration_seconds",
    canonicalUnit: "seconds",
    defaultAgg: "sum",
    direction: "higher_better",
    showUnit: false,
    unitLabel: "Unit",
    unitPlaceholder: "",
    showTarget: false,
    targetLabel: "Daily goal",
  },
  {
    key: "measure",
    label: "Measure something",
    description: "Weight, water, distance",
    icon: "⚖",
    control: "daily_total",
    semanticType: "count",
    canonicalUnit: "",
    defaultAgg: "last",
    direction: "neutral",
    showUnit: true,
    unitLabel: "Unit",
    unitPlaceholder: "kg",
    showTarget: true,
    targetLabel: "Target",
  },
  {
    key: "money",
    label: "Money",
    description: "Spending, income",
    icon: "₹",
    control: "amount_pad",
    semanticType: "currency_minor",
    canonicalUnit: "",
    defaultAgg: "sum",
    direction: "lower_better",
    showUnit: true,
    unitLabel: "Currency",
    unitPlaceholder: "INR",
    showTarget: true,
    targetLabel: "Daily budget",
  },
  {
    key: "cut_down",
    label: "Cut something down",
    description: "Screen time, unlocks",
    icon: "↘",
    control: "increment",
    semanticType: "count",
    canonicalUnit: "",
    defaultAgg: "sum",
    direction: "lower_better",
    showUnit: true,
    unitLabel: "Unit",
    unitPlaceholder: "times",
    showTarget: true,
    targetLabel: "Daily limit",
  },
];

interface TrackerFormProps {
  onSubmit: (value: Schemas.CreateTrackerApiRequest) => Promise<void>;
  onCancel: () => void;
  submitLabel?: string;
}

export function TrackerForm({ onSubmit, onCancel, submitLabel = "Save" }: TrackerFormProps) {
  const { getToken } = useAuth();
  const metricsQuery = useQuery(MetricsQueries.list(getToken));
  const metrics = metricsQuery.data?.metrics ?? [];

  const [templateKey, setTemplateKey] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const activeTemplate = TEMPLATES.find((template) => template.key === templateKey) ?? null;

  const defaultValues: TrackerFormValues = {
    name: "",
    emoji: "",
    control: "toggle",
    entryMode: "retro",
    scheduleType: "daily",
    scheduleDays: [],
    scheduleCount: 3,
    target: "",
    step: "",
    compute: NO_COMPUTE,
    activeFrom: getTodayLocalDate(),
    metricMode: "new",
    metricPublicId: "",
    metricName: "",
    metricKey: "",
    semanticType: "boolean",
    canonicalUnit: "boolean",
    defaultAgg: "sum",
    direction: "higher_better",
  };

  const form = useForm({
    defaultValues,
    validators: { onSubmit: ZTrackerFormValues },
    onSubmit: async ({ value }) => {
      const schedule: Schemas.TrackerSchedule =
        value.scheduleType === "daily"
          ? { type: "daily" }
          : value.scheduleType === "days_of_week"
            ? { type: "days_of_week", days: value.scheduleDays }
            : { type: "times_per_week", count: value.scheduleCount };

      const metric: Schemas.TrackerMetricSpec =
        value.metricMode === "existing"
          ? { mode: "existing", metricPublicId: value.metricPublicId }
          : {
              mode: "new",
              metric: {
                key: value.metricKey.trim() === "" ? undefined : value.metricKey.trim(),
                name: value.metricName.trim() === "" ? value.name : value.metricName,
                semanticType: value.semanticType,
                canonicalUnit: value.canonicalUnit,
                defaultAgg: value.defaultAgg,
                direction: value.direction,
                dateAttribution: "start",
              },
            };

      await onSubmit({
        tracker: {
          name: value.name,
          emoji: value.emoji?.trim() === "" ? null : value.emoji,
          manifest: {
            control: value.control,
            // DEV_NOTE: the primary metric's key is added server-side — the Repo owns that
            // invariant so it holds for every caller, not just this form.
            metrics: [],
            target: value.target.trim() === "" ? null : Number(value.target),
            step: value.step.trim() === "" ? null : Number(value.step),
            entryMode: value.entryMode,
            schedule,
            compute: value.compute === NO_COMPUTE ? null : Schemas.ZComputeKey.parse(value.compute),
          },
          activeFrom: value.activeFrom,
        },
        metric,
      });
    },
  });

  function applyTemplate(template: Template) {
    setTemplateKey(template.key);
    form.setFieldValue("control", template.control);
    form.setFieldValue("semanticType", template.semanticType);
    form.setFieldValue("canonicalUnit", template.canonicalUnit);
    form.setFieldValue("defaultAgg", template.defaultAgg);
    form.setFieldValue("direction", template.direction);
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        form.handleSubmit();
      }}
      className="flex flex-col gap-4"
    >
      <Field>
        <FieldLabel>What do you want to track?</FieldLabel>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {TEMPLATES.map((template) => (
            <button
              key={template.key}
              type="button"
              onClick={() => applyTemplate(template)}
              className={`flex flex-col items-start gap-1 rounded-md border p-3 text-left transition-colors hover:bg-accent ${
                templateKey === template.key ? "border-primary bg-accent" : "border-input"
              }`}
            >
              <span className="text-sm font-medium">
                {template.icon} {template.label}
              </span>
              <span className="text-xs text-muted-foreground">{template.description}</span>
            </button>
          ))}
        </div>
      </Field>

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

      <form.Subscribe selector={(state) => state.values.metricMode}>
        {(metricMode) =>
          activeTemplate?.showUnit && metricMode === "new" ? (
            <form.Field name="canonicalUnit">
              {(field) => {
                const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
                return (
                  <Field data-invalid={isInvalid}>
                    <FieldLabel htmlFor={field.name}>{activeTemplate.unitLabel}</FieldLabel>
                    <Input
                      id={field.name}
                      value={field.state.value}
                      placeholder={activeTemplate.unitPlaceholder}
                      onChange={(event) => field.handleChange(event.target.value)}
                      onBlur={field.handleBlur}
                      aria-invalid={isInvalid}
                    />
                    <FieldError errors={field.state.meta.errors} />
                  </Field>
                );
              }}
            </form.Field>
          ) : null
        }
      </form.Subscribe>

      {activeTemplate?.showTarget ? (
        <form.Field name="target">
          {(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>{activeTemplate.targetLabel}</FieldLabel>
              <Input
                id={field.name}
                type="number"
                step="any"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
              />
            </Field>
          )}
        </form.Field>
      ) : null}

      <form.Field name="scheduleType">
        {(field) => (
          <Field>
            <FieldLabel htmlFor={field.name}>How often</FieldLabel>
            <Select
              value={field.state.value}
              onValueChange={(value) =>
                field.handleChange(value as TrackerFormValues["scheduleType"])
              }
            >
              <SelectTrigger id={field.name} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="daily">Every day</SelectItem>
                  <SelectItem value="days_of_week">Specific days</SelectItem>
                  <SelectItem value="times_per_week">A number of times per week</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        )}
      </form.Field>

      <form.Subscribe selector={(state) => state.values.scheduleType}>
        {(scheduleType) =>
          scheduleType === "days_of_week" ? (
            <form.Field name="scheduleDays">
              {(field) => {
                const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
                return (
                  <Field data-invalid={isInvalid}>
                    <FieldLabel htmlFor={field.name}>Days</FieldLabel>
                    <div className="flex flex-wrap gap-2">
                      {DAY_NAMES.map((dayName, day) => {
                        const selected = field.state.value.includes(day);
                        return (
                          <Button
                            key={dayName}
                            type="button"
                            size="sm"
                            variant={selected ? "default" : "outline"}
                            onClick={() =>
                              field.handleChange(
                                selected
                                  ? field.state.value.filter((value) => value !== day)
                                  : [...field.state.value, day],
                              )
                            }
                          >
                            {dayName}
                          </Button>
                        );
                      })}
                    </div>
                    <FieldError errors={field.state.meta.errors} />
                  </Field>
                );
              }}
            </form.Field>
          ) : scheduleType === "times_per_week" ? (
            <form.Field name="scheduleCount">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor={field.name}>Times per week</FieldLabel>
                  <Input
                    id={field.name}
                    type="number"
                    min="1"
                    max="7"
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.valueAsNumber)}
                    onBlur={field.handleBlur}
                  />
                </Field>
              )}
            </form.Field>
          ) : null
        }
      </form.Subscribe>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="self-start"
        onClick={() => setAdvancedOpen((open) => !open)}
      >
        {advancedOpen ? "▾ Advanced" : "▸ Advanced"}
      </Button>

      {advancedOpen ? (
        <div className="flex flex-col gap-4 rounded-md border p-4">
          <form.Field name="emoji">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>Emoji (optional)</FieldLabel>
                <Input
                  id={field.name}
                  value={field.state.value ?? ""}
                  maxLength={4}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                />
              </Field>
            )}
          </form.Field>

          <form.Field name="control">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>Control</FieldLabel>
                <Select
                  value={field.state.value}
                  onValueChange={(value) => field.handleChange(value as Schemas.Control)}
                >
                  <SelectTrigger id={field.name} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {(Object.keys(CONTROL_LABELS) as Schemas.Control[]).map((control) => (
                        <SelectItem key={control} value={control}>
                          {CONTROL_LABELS[control]}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            )}
          </form.Field>

          <form.Field name="entryMode">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>Entry mode</FieldLabel>
                <Select
                  value={field.state.value}
                  onValueChange={(value) => field.handleChange(value as "live" | "retro")}
                >
                  <SelectTrigger id={field.name} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="live">Live — today only</SelectItem>
                      <SelectItem value="retro">Retro — any date</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            )}
          </form.Field>

          <form.Field name="step">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>Step (optional)</FieldLabel>
                <Input
                  id={field.name}
                  type="number"
                  step="any"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                />
              </Field>
            )}
          </form.Field>

          <form.Field name="compute">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>Compute module</FieldLabel>
                <Select value={field.state.value} onValueChange={field.handleChange}>
                  <SelectTrigger id={field.name} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value={NO_COMPUTE}>None</SelectItem>
                      {Schemas.ZComputeKey.options.map((key) => (
                        <SelectItem key={key} value={key}>
                          {key}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            )}
          </form.Field>

          <form.Field name="activeFrom">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>Active from</FieldLabel>
                <Input
                  id={field.name}
                  type="date"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                />
              </Field>
            )}
          </form.Field>

          <form.Field name="metricMode">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>Metric</FieldLabel>
                <Select
                  value={field.state.value}
                  onValueChange={(value) => field.handleChange(value as "new" | "existing")}
                >
                  <SelectTrigger id={field.name} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="new">Declare a new metric</SelectItem>
                      <SelectItem value="existing">Reuse an existing metric</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            )}
          </form.Field>

          <form.Subscribe selector={(state) => state.values.metricMode}>
            {(metricMode) =>
              metricMode === "existing" ? (
                <form.Field name="metricPublicId">
                  {(field) => {
                    const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
                    return (
                      <Field data-invalid={isInvalid}>
                        <FieldLabel htmlFor={field.name}>Existing metric</FieldLabel>
                        {metricsQuery.isPending ? (
                          <p className="text-sm text-muted-foreground">Loading metrics...</p>
                        ) : metricsQuery.isError ? (
                          <p className="text-sm text-destructive">Failed to load metrics.</p>
                        ) : metrics.length === 0 ? (
                          <p className="text-sm text-muted-foreground">
                            No metrics yet — declare a new one instead.
                          </p>
                        ) : (
                          <Select value={field.state.value} onValueChange={field.handleChange}>
                            <SelectTrigger
                              id={field.name}
                              aria-invalid={isInvalid}
                              className="w-full"
                            >
                              <SelectValue placeholder="Choose a metric" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                {metrics.map((metric) => (
                                  <SelectItem key={metric.publicId} value={metric.publicId}>
                                    {metric.name} ({metric.key})
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        )}
                        <FieldError errors={field.state.meta.errors} />
                      </Field>
                    );
                  }}
                </form.Field>
              ) : (
                <div className="flex flex-col gap-4">
                  <form.Field name="metricName">
                    {(field) => (
                      <Field>
                        <FieldLabel htmlFor={field.name}>Metric name (optional)</FieldLabel>
                        <Input
                          id={field.name}
                          value={field.state.value}
                          placeholder="Same as tracker name if left blank"
                          onChange={(event) => field.handleChange(event.target.value)}
                          onBlur={field.handleBlur}
                        />
                      </Field>
                    )}
                  </form.Field>

                  <form.Field name="metricKey">
                    {(field) => (
                      <Field>
                        <FieldLabel htmlFor={field.name}>Metric key (optional)</FieldLabel>
                        <Input
                          id={field.name}
                          value={field.state.value}
                          placeholder="Generated if left blank"
                          onChange={(event) => field.handleChange(event.target.value)}
                          onBlur={field.handleBlur}
                        />
                      </Field>
                    )}
                  </form.Field>

                  <form.Field name="semanticType">
                    {(field) => (
                      <Field>
                        <FieldLabel htmlFor={field.name}>Semantic type</FieldLabel>
                        <Select
                          value={field.state.value}
                          onValueChange={(value) =>
                            field.handleChange(value as Schemas.SemanticType)
                          }
                        >
                          <SelectTrigger id={field.name} className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              {Schemas.ZSemanticType.options.map((option) => (
                                <SelectItem key={option} value={option}>
                                  {option}
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
                            onChange={(event) => field.handleChange(event.target.value)}
                            onBlur={field.handleBlur}
                            aria-invalid={isInvalid}
                          />
                          <FieldError errors={field.state.meta.errors} />
                        </Field>
                      );
                    }}
                  </form.Field>

                  <div className="flex gap-4">
                    <form.Field name="defaultAgg">
                      {(field) => (
                        <Field>
                          <FieldLabel htmlFor={field.name}>Aggregation</FieldLabel>
                          <Select
                            value={field.state.value}
                            onValueChange={(value) =>
                              field.handleChange(value as Schemas.DefaultAgg)
                            }
                          >
                            <SelectTrigger id={field.name} className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                {Schemas.ZDefaultAgg.options.map((option) => (
                                  <SelectItem key={option} value={option}>
                                    {option}
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
                            onValueChange={(value) =>
                              field.handleChange(value as Schemas.Direction)
                            }
                          >
                            <SelectTrigger id={field.name} className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                {Schemas.ZDirection.options.map((option) => (
                                  <SelectItem key={option} value={option}>
                                    {option}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        </Field>
                      )}
                    </form.Field>
                  </div>
                </div>
              )
            }
          </form.Subscribe>
        </div>
      ) : null}

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
