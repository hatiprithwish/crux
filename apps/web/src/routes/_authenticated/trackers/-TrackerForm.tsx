import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
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
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/shadcn/ui/select";
import * as Schemas from "@app/schemas";
import { MetricsQueries } from "../metrics/-data";
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
// manifest fields the Advanced section edits directly. No new field exists because of a template; a
// template is just a shortcut into the fields that were already here.
//
// DEV_NOTE: this form no longer declares metrics. A metric is user-global and permanent
// (architecture.md §5) — minting one as a side effect of creating a tracker meant every tracker got
// its own, which is precisely what stops two trackers rolling into one number. It picks an existing
// metric now; /metrics is where they're defined. ZTrackerMetricSpec keeps its "new" branch for API
// callers, but nothing in the UI reaches it.
const ZTrackerFormValues = z
  .object({
    name: z.string().min(1, "Name is required"),
    control: Schemas.ZControl,
    entryMode: z.enum(["live", "retro"]),
    scheduleType: z.enum(["daily", "days_of_week", "times_per_week"]),
    scheduleDays: z.array(z.number().min(0).max(6)),
    scheduleCount: z.number().int().min(1).max(7),
    target: z.string(),
    step: z.string(),
    compute: z.string(),
    activeFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    metricPublicId: z.string().min(1, "Choose a metric"),
  })
  .superRefine((values, ctx) => {
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
  // DEV_NOTE: no longer used to *build* a metric — it groups the metric picker instead, so choosing
  // "Time something" floats the duration metrics to the top without hiding the rest. A template
  // that guessed wrong used to mint a bad metric; now the worst it does is sort a list.
  suggestedSemanticTypes: Schemas.SemanticType[];
  showTarget: boolean;
  targetLabel: string;
}

// DEV_NOTE: one preset per manifest.control shape a user is likely to reach for by intent rather
// than by mechanism — "measure" suggests several semantic types rather than picking one, since the
// right one differs per instance (weight vs water vs distance).
const TEMPLATES: Template[] = [
  {
    key: "did_it",
    label: "Did it or didn't",
    description: "Meditate, take a bath",
    icon: "✓",
    control: "toggle",
    suggestedSemanticTypes: ["boolean"],
    showTarget: false,
    targetLabel: "Daily goal",
  },
  {
    key: "count",
    label: "Count something",
    description: "Pushups, pages, glasses",
    icon: "#",
    control: "increment",
    suggestedSemanticTypes: ["count"],
    showTarget: true,
    targetLabel: "Daily goal",
  },
  {
    key: "time",
    label: "Time something",
    description: "Deep work, running",
    icon: "⏱",
    control: "timer",
    suggestedSemanticTypes: ["duration_seconds"],
    showTarget: false,
    targetLabel: "Daily goal",
  },
  {
    key: "measure",
    label: "Measure something",
    description: "Weight, water, distance",
    icon: "⚖",
    control: "daily_total",
    suggestedSemanticTypes: ["mass_grams", "volume_ml", "distance_m", "energy_kcal", "count"],
    showTarget: true,
    targetLabel: "Target",
  },
  {
    key: "money",
    label: "Money",
    description: "Spending, income",
    icon: "₹",
    control: "amount_pad",
    suggestedSemanticTypes: ["currency_minor"],
    showTarget: true,
    targetLabel: "Daily budget",
  },
  {
    key: "cut_down",
    label: "Cut something down",
    description: "Screen time, unlocks",
    icon: "↘",
    control: "increment",
    suggestedSemanticTypes: ["count", "duration_seconds"],
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

  // DEV_NOTE: grouping, not filtering — a template is a guess about intent, and a metric it didn't
  // anticipate is still a legitimate choice. With no template picked everything lands in "Others",
  // which renders as one ungrouped list.
  const suggested = activeTemplate?.suggestedSemanticTypes ?? [];
  const suggestedMetrics = metrics.filter((metric) => suggested.includes(metric.semanticType));
  const otherMetrics = metrics.filter((metric) => !suggested.includes(metric.semanticType));

  const defaultValues: TrackerFormValues = {
    name: "",
    control: "toggle",
    entryMode: "retro",
    scheduleType: "daily",
    scheduleDays: [],
    scheduleCount: 3,
    target: "",
    step: "",
    compute: NO_COMPUTE,
    activeFrom: getTodayLocalDate(),
    metricPublicId: "",
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

      const metric: Schemas.TrackerMetricSpec = {
        mode: "existing",
        metricPublicId: value.metricPublicId,
      };

      await onSubmit({
        tracker: {
          name: value.name,
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

      {/* DEV_NOTE: promoted out of Advanced and made required. Picking the metric is the choice that
          decides whether this tracker rolls up with anything else, so it belongs on the main path
          rather than behind a disclosure most people never open. */}
      <form.Field name="metricPublicId">
        {(field) => {
          const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
          return (
            <Field data-invalid={isInvalid}>
              <FieldLabel htmlFor={field.name}>What it measures</FieldLabel>
              {metricsQuery.isPending ? (
                <p className="text-sm text-muted-foreground">Loading metrics...</p>
              ) : metricsQuery.isError ? (
                <p className="text-sm text-destructive">Failed to load metrics.</p>
              ) : metrics.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No metrics yet. Trackers measure a metric, so{" "}
                  <Link to="/metrics" className="underline">
                    define one first
                  </Link>
                  .
                </p>
              ) : (
                <Select value={field.state.value} onValueChange={field.handleChange}>
                  <SelectTrigger id={field.name} aria-invalid={isInvalid} className="w-full">
                    <SelectValue placeholder="Choose a metric" />
                  </SelectTrigger>
                  <SelectContent>
                    {suggestedMetrics.length > 0 ? (
                      <SelectGroup>
                        <SelectLabel>Suggested</SelectLabel>
                        {suggestedMetrics.map((metric) => (
                          <SelectItem key={metric.publicId} value={metric.publicId}>
                            {metric.name} · {metric.canonicalUnit}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ) : null}
                    {otherMetrics.length > 0 ? (
                      <SelectGroup>
                        {suggestedMetrics.length > 0 ? <SelectLabel>Others</SelectLabel> : null}
                        {otherMetrics.map((metric) => (
                          <SelectItem key={metric.publicId} value={metric.publicId}>
                            {metric.name} · {metric.canonicalUnit}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ) : null}
                  </SelectContent>
                </Select>
              )}
              <FieldError errors={field.state.meta.errors} />
            </Field>
          );
        }}
      </form.Field>

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
            // DEV_NOTE: a tracker can't be created without a metric to point at, so with none
            // defined the button is disabled rather than left to fail validation on click.
            <Button type="submit" disabled={isSubmitting || metrics.length === 0}>
              {isSubmitting ? "Saving..." : submitLabel}
            </Button>
          )}
        </form.Subscribe>
      </div>
    </form>
  );
}
