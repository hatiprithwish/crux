import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/tanstack-react-start";
import { z } from "zod";
import { Info } from "@phosphor-icons/react";
import { Button } from "@/shadcn/ui/button";
import { Input } from "@/shadcn/ui/input";
import { FieldError } from "@/shadcn/ui/field";
import { Popover, PopoverContent, PopoverTrigger } from "@/shadcn/ui/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/shadcn/ui/select";
import { cn } from "@/utils/tailwind";
import * as Schemas from "@app/schemas";
import { MetricsQueries } from "../metrics/-data";
import { IconPicker } from "./-IconPicker";
import { TrackerPreview } from "./-TrackerPreview";
import {
  AGG_HELP,
  AGG_HINTS,
  AGG_LABELS,
  CONTROL_TILES,
  DIRECTION_HELP,
  DIRECTION_HINTS,
  DIRECTION_LABELS,
  UNIT_FOR_SEMANTIC_TYPE,
  UNIT_PLACEHOLDER,
  deriveDirection,
  deriveMetricShape,
  formatStartDate,
  getTodayLocalDate,
  slugifyMetricKey,
} from "./-utils";

// DEV_NOTE: this form *is* the manifest engine's front door — everything Phase 0–3 hardcoded per
// domain (which control, which metric, which schedule) is a field here. Creating "another toggle
// habit" through it writes no new code anywhere, which is docs/archive/implementation.md Phase 6's
// acceptance test.
//
// DEV_NOTE: the form is flat and converted to the nested API shape on submit — same approach as the
// old expense form, which typed amounts in major units and converted to minor.
//
// DEV_NOTE: the metric is derived, not asked for. Two earlier versions of this form both got it
// wrong in opposite directions: minting a fresh metric per tracker made cross-tracker rollup
// impossible, and demanding the user pick one first meant a boolean habit couldn't be created
// without a detour through /metrics to answer a question about canonical units. The resolution is
// that `metricMode` has three states — derive it (default), edit the six fields, or point at an
// existing metric — and the derived key is a slug of the tracker's name, which TrackersRepo reuses
// if it already exists. So two trackers named "Pushups" roll into one number, while two unrelated
// booleans stay apart.
const ZTrackerFormValues = z
  .object({
    name: z.string().min(1, "Name is required"),
    icon: z.string().nullable(),
    tileKey: z.string(),
    entryMode: z.enum(["live", "retro"]),
    scheduleType: z.enum(["daily", "days_of_week", "times_per_week"]),
    scheduleDays: z.array(z.number().min(0).max(6)),
    scheduleCount: z.number().int().min(1).max(7),
    target: z.string(),
    step: z.string(),
    activeFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    metricMode: z.enum(["derived", "custom", "existing"]),
    metricPublicId: z.string(),
    metricKey: z.string(),
    metricName: z.string(),
    semanticType: Schemas.ZSemanticType,
    canonicalUnit: z.string(),
    defaultAgg: Schemas.ZDefaultAgg,
    direction: Schemas.ZDirection,
    dateAttribution: Schemas.ZDateAttribution,
  })
  .superRefine((values, ctx) => {
    if (values.scheduleType === "days_of_week" && values.scheduleDays.length === 0) {
      ctx.addIssue({ code: "custom", path: ["scheduleDays"], message: "Pick at least one day" });
    }
    if (values.metricMode === "existing" && values.metricPublicId === "") {
      ctx.addIssue({ code: "custom", path: ["metricPublicId"], message: "Choose a metric" });
    }
    if (values.metricMode === "custom") {
      if (values.metricKey.trim() === "") {
        ctx.addIssue({ code: "custom", path: ["metricKey"], message: "Key is required" });
      }
      if (values.metricName.trim() === "") {
        ctx.addIssue({ code: "custom", path: ["metricName"], message: "Name is required" });
      }
      if (values.canonicalUnit.trim() === "") {
        ctx.addIssue({ code: "custom", path: ["canonicalUnit"], message: "Unit is required" });
      }
    }
    if (values.target.trim() !== "" && Number.isNaN(Number(values.target))) {
      ctx.addIssue({ code: "custom", path: ["target"], message: "Target must be a number" });
    }
    if (values.step.trim() !== "" && Number.isNaN(Number(values.step))) {
      ctx.addIssue({ code: "custom", path: ["step"], message: "Step must be a number" });
    }
  });
type TrackerFormValues = z.infer<typeof ZTrackerFormValues>;

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const SCHEDULE_OPTIONS: { value: TrackerFormValues["scheduleType"]; label: string }[] = [
  { value: "daily", label: "Every day" },
  { value: "days_of_week", label: "Some days" },
  { value: "times_per_week", label: "N per week" },
];

// DEV_NOTE: a metric derived from an unnamed tracker still needs an addressable key — metrics are
// unique per (user_id, key) and "" is unaddressable from a manifest (MetricsCommon.ts). The form
// can't submit while the name is empty, so this only ever shows in the preview.
const UNNAMED_METRIC_KEY = "untitled_tracker";

// DEV_NOTE: no `direction` — that moved onto the manifest (ZTrackerManifest), because the same
// metric points different ways for different trackers. It's a form field of its own now, sitting
// beside the target it's scored against rather than inside the metric panel.
interface EffectiveMetric {
  key: string;
  name: string;
  semanticType: Schemas.SemanticType;
  canonicalUnit: string;
  defaultAgg: Schemas.DefaultAgg;
  dateAttribution: Schemas.DateAttribution;
}

// DEV_NOTE: one function, used by both the preview and the submit handler, so what the sidebar
// promises and what the API receives cannot drift apart.
function resolveMetric(
  values: TrackerFormValues,
  control: Schemas.Control,
  metrics: Schemas.MetricWithUsageApiShape[],
): { metric: EffectiveMetric; isExisting: boolean } {
  if (values.metricMode === "existing") {
    const chosen = metrics.find((metric) => metric.publicId === values.metricPublicId);
    if (chosen) {
      return {
        isExisting: true,
        metric: {
          key: chosen.key,
          name: chosen.name,
          semanticType: chosen.semanticType,
          canonicalUnit: chosen.canonicalUnit,
          defaultAgg: chosen.defaultAgg,
          dateAttribution: chosen.dateAttribution,
        },
      };
    }
  }

  if (values.metricMode === "custom") {
    return {
      isExisting: false,
      metric: {
        key: values.metricKey.trim() === "" ? UNNAMED_METRIC_KEY : values.metricKey.trim(),
        name: values.metricName.trim() === "" ? values.name : values.metricName.trim(),
        semanticType: values.semanticType,
        canonicalUnit: values.canonicalUnit,
        defaultAgg: values.defaultAgg,
        dateAttribution: values.dateAttribution,
      },
    };
  }

  const slug = slugifyMetricKey(values.name);
  return {
    isExisting: false,
    metric: {
      key: slug === "" ? UNNAMED_METRIC_KEY : slug,
      name: values.name.trim() === "" ? "Untitled tracker" : values.name.trim(),
      ...deriveMetricShape(control),
    },
  };
}

function buildSchedule(values: TrackerFormValues): Schemas.TrackerSchedule {
  if (values.scheduleType === "days_of_week") {
    return { type: "days_of_week", days: [...values.scheduleDays].sort((a, b) => a - b) };
  }
  if (values.scheduleType === "times_per_week") {
    return { type: "times_per_week", count: values.scheduleCount };
  }
  return { type: "daily" };
}

// DEV_NOTE: the inverse of the submit handler — a stored tracker read back into the flat field
// shape. metricMode is always "existing" here because editing can't repoint the metric
// (ZUpdateTrackerApiRequest omits it): the tracker's entries already point at that metric, so the
// panel shows which one it writes rather than offering to change it.
function valuesFromTracker(tracker: Schemas.TrackerApiShape): TrackerFormValues {
  const { manifest } = tracker;
  const tile =
    CONTROL_TILES.find(
      (option) => option.control === manifest.control && option.compute === manifest.compute,
    ) ?? CONTROL_TILES[0];
  const primary = tracker.metricDetails.find((detail) => detail.key === tracker.primaryMetricKey);

  return {
    name: tracker.name,
    icon: tracker.icon ?? null,
    tileKey: tile.key,
    entryMode: manifest.entryMode,
    scheduleType: manifest.schedule.type,
    scheduleDays: manifest.schedule.type === "days_of_week" ? manifest.schedule.days : [],
    scheduleCount: manifest.schedule.type === "times_per_week" ? manifest.schedule.count : 3,
    target: manifest.target === null ? "" : String(manifest.target),
    step: manifest.step === null ? "" : String(manifest.step),
    // DEV_NOTE: a stored manifest always carries a resolved direction (the Repo resolves null to
    // the metric's default on write). The fallback covers a manifest written before the field
    // existed, in the window before migration 0004 has run against the row.
    direction: manifest.direction ?? primary?.defaultDirection ?? "higher_better",
    activeFrom: tracker.activeFrom,
    metricMode: "existing",
    metricPublicId: tracker.primaryMetricPublicId,
    metricKey: tracker.primaryMetricKey,
    metricName: primary?.name ?? tracker.name,
    // DEV_NOTE: the derived shape is a fallback only — resolveMetric reads the real six fields off
    // the fetched /metrics row for mode "existing", and these are what the preview renders in the
    // moment before that request lands.
    ...deriveMetricShape(manifest.control),
    ...(primary
      ? { semanticType: primary.semanticType, canonicalUnit: primary.canonicalUnit }
      : {}),
  };
}

interface TrackerFormProps {
  onSubmit: (value: Schemas.CreateTrackerApiRequest) => Promise<void>;
  onCancel: () => void;
  submitLabel?: string;
  // DEV_NOTE: present = edit an existing tracker. The form still emits a full
  // CreateTrackerApiRequest either way and the edit screen narrows it to the patchable fields —
  // one submit shape, so the preview and the payload can't drift apart between the two modes.
  tracker?: Schemas.TrackerApiShape;
}

export function TrackerForm({
  onSubmit,
  onCancel,
  submitLabel = "Save",
  tracker,
}: TrackerFormProps) {
  const { getToken } = useAuth();
  const metricsQuery = useQuery(MetricsQueries.list(getToken));
  const metrics = metricsQuery.data?.metrics ?? [];

  const isEditing = tracker !== undefined;
  const [metricPanelOpen, setMetricPanelOpen] = useState(false);
  const [computePanelOpen, setComputePanelOpen] = useState(false);

  const defaultValues: TrackerFormValues = tracker
    ? valuesFromTracker(tracker)
    : {
        name: "",
        icon: null,
        tileKey: "toggle",
        entryMode: "retro",
        scheduleType: "daily",
        scheduleDays: [],
        scheduleCount: 3,
        target: "",
        step: "",
        direction: deriveDirection("toggle"),
        activeFrom: getTodayLocalDate(),
        metricMode: "derived",
        metricPublicId: "",
        metricKey: "",
        metricName: "",
        ...deriveMetricShape("toggle"),
      };

  const form = useForm({
    defaultValues,
    validators: { onSubmit: ZTrackerFormValues },
    onSubmit: async ({ value }) => {
      const tile = CONTROL_TILES.find((option) => option.key === value.tileKey) ?? CONTROL_TILES[0];
      const { metric, isExisting } = resolveMetric(value, tile.control, metrics);

      const metricSpec: Schemas.TrackerMetricSpec = isExisting
        ? { mode: "existing", metricPublicId: value.metricPublicId }
        : // DEV_NOTE: a newly declared metric is always born higher_better. The direction this
          // tracker scores by lives in its manifest below; the metric's copy is only what a
          // *future* tracker inherits, and "more is better" is the honest default for a measure
          // nobody has yet said anything about.
          { mode: "new", metric: { ...metric, defaultDirection: "higher_better" } };

      await onSubmit({
        tracker: {
          name: value.name.trim(),
          icon: value.icon,
          manifest: {
            control: tile.control,
            // DEV_NOTE: the primary metric's key is added server-side — the Repo owns that
            // invariant so it holds for every caller, not just this form.
            metrics: [],
            target: value.target.trim() === "" ? null : Number(value.target),
            step: value.step.trim() === "" ? null : Number(value.step),
            direction: value.direction,
            entryMode: value.entryMode,
            schedule: buildSchedule(value),
            compute: tile.compute,
          },
          activeFrom: value.activeFrom,
        },
        metric: metricSpec,
      });
    },
  });

  // DEV_NOTE: picking a tile rewrites the derived metric fields, because they are the control's
  // consequence rather than a parallel choice. It deliberately leaves a custom or existing metric
  // alone — a user who opened Change and typed a unit has overridden the derivation on purpose.
  function applyTile(tileKey: string) {
    const tile = CONTROL_TILES.find((option) => option.key === tileKey);
    if (!tile) return;

    const previous = CONTROL_TILES.find((option) => option.key === form.getFieldValue("tileKey"));
    form.setFieldValue("tileKey", tileKey);

    // DEV_NOTE: direction follows the tile only while it still holds the previous tile's suggestion
    // — an amount pad starts as a cap and a timer as a floor. Once the user has answered the
    // question themselves, switching tiles must not silently un-answer it.
    if (previous && form.getFieldValue("direction") === deriveDirection(previous.control)) {
      form.setFieldValue("direction", deriveDirection(tile.control));
    }

    if (form.getFieldValue("metricMode") === "derived") {
      const shape = deriveMetricShape(tile.control);
      form.setFieldValue("semanticType", shape.semanticType);
      form.setFieldValue("canonicalUnit", shape.canonicalUnit);
      form.setFieldValue("defaultAgg", shape.defaultAgg);
      form.setFieldValue("dateAttribution", shape.dateAttribution);
    }
  }

  // DEV_NOTE: pointing at an existing metric seeds the direction from that metric's default, which
  // is the whole reason the default survived on the metric — "money_expense_amount" already knows
  // it's usually a cap, so a second spending tracker doesn't have to be told again.
  function applyExistingMetric(metricPublicId: string) {
    form.setFieldValue("metricPublicId", metricPublicId);
    const chosen = metrics.find((metric) => metric.publicId === metricPublicId);
    if (chosen) form.setFieldValue("direction", chosen.defaultDirection);
  }

  // DEV_NOTE: five semantic types name their own unit (UNIT_FOR_SEMANTIC_TYPE) — picking one writes
  // it and the unit field goes read-only. Without this the form happily stored a
  // `duration_seconds` metric whose canonical unit was "count", which is a value nothing downstream
  // can interpret.
  function applySemanticType(semanticType: Schemas.SemanticType) {
    form.setFieldValue("semanticType", semanticType);
    const implied = UNIT_FOR_SEMANTIC_TYPE[semanticType];
    form.setFieldValue("canonicalUnit", implied ?? "");
  }

  // DEV_NOTE: opening Change seeds the editable fields from whatever the derivation produced, so
  // the panel starts as a description of the current state rather than an empty form the user has
  // to fill in from scratch to change one field.
  function openMetricPanel() {
    const values = form.state.values;
    const tile = CONTROL_TILES.find((option) => option.key === values.tileKey) ?? CONTROL_TILES[0];

    if (values.metricMode === "derived") {
      const { metric } = resolveMetric(values, tile.control, metrics);
      form.setFieldValue("metricMode", "custom");
      form.setFieldValue("metricKey", metric.key);
      form.setFieldValue("metricName", metric.name);
    }
    setMetricPanelOpen(true);
  }

  function resetMetricToDerived() {
    const values = form.state.values;
    const tile = CONTROL_TILES.find((option) => option.key === values.tileKey) ?? CONTROL_TILES[0];
    const shape = deriveMetricShape(tile.control);

    form.setFieldValue("metricMode", "derived");
    form.setFieldValue("metricPublicId", "");
    form.setFieldValue("metricKey", "");
    form.setFieldValue("metricName", "");
    form.setFieldValue("semanticType", shape.semanticType);
    form.setFieldValue("canonicalUnit", shape.canonicalUnit);
    form.setFieldValue("defaultAgg", shape.defaultAgg);
    form.setFieldValue("dateAttribution", shape.dateAttribution);
    setMetricPanelOpen(false);
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        form.handleSubmit();
      }}
      className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px]"
    >
      <div className="flex flex-col border-border lg:border-r">
        <header className="px-6 py-8">
          <h1 className="font-heading text-3xl font-semibold">
            {isEditing ? "Edit tracker" : "New tracker"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isEditing
              ? "Rename it, retarget it, reschedule it. The control and metric stay fixed — everything already logged was written through them."
              : "Name it and pick how you’ll log it. Everything else has a sane default."}
          </p>
        </header>

        {/* 1 — what is it */}
        <SectionHeading index={1} title="What is it" />
        <div className="grid grid-cols-1 border-b border-border sm:grid-cols-[minmax(0,1fr)_160px]">
          <form.Field name="name">
            {(field) => {
              const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <div className="flex flex-col gap-2 px-6 py-5 sm:border-r sm:border-border">
                  <FieldLabelText htmlFor={field.name}>Name</FieldLabelText>
                  <Input
                    id={field.name}
                    autoFocus
                    placeholder="Take a bath"
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    onBlur={field.handleBlur}
                    aria-invalid={isInvalid}
                    className={UNDERLINE_INPUT}
                  />
                  <FieldError errors={field.state.meta.errors} />
                </div>
              );
            }}
          </form.Field>

          <form.Field name="icon">
            {(field) => (
              <div className="flex flex-col gap-2 px-6 py-5">
                <FieldLabelText>Icon</FieldLabelText>
                <IconPicker value={field.state.value} onChange={field.handleChange} />
              </div>
            )}
          </form.Field>
        </div>

        {/* 2 — how you log it */}
        <SectionHeading index={2} title="How you log it" />
        <div className="border-b border-border px-6 py-5">
          <FieldLabelText>Control</FieldLabelText>
          <form.Subscribe selector={(state) => state.values.tileKey}>
            {(tileKey) => (
              <div className="mt-3 grid grid-cols-2 border-t border-l border-border sm:grid-cols-4">
                {CONTROL_TILES.map((tile) => {
                  const selected = tileKey === tile.key;
                  return (
                    <button
                      key={tile.key}
                      type="button"
                      aria-pressed={selected}
                      disabled={isEditing}
                      onClick={() => applyTile(tile.key)}
                      className={cn(
                        "flex flex-col items-start gap-1 border-r border-b border-border px-4 py-3 text-left transition-colors",
                        selected
                          ? "bg-primary text-primary-foreground"
                          : "hover:bg-accent hover:text-accent-foreground",
                        // DEV_NOTE: the unselected tiles fade out rather than the whole grid — the
                        // control a tracker already has is still worth reading at full contrast.
                        isEditing &&
                          !selected &&
                          "opacity-40 hover:bg-transparent hover:text-inherit",
                      )}
                    >
                      <span className="text-sm font-medium">{tile.label}</span>
                      <span
                        className={cn(
                          "text-xs",
                          selected ? "text-primary-foreground/80" : "text-muted-foreground",
                        )}
                      >
                        {tile.hint}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </form.Subscribe>
          {isEditing ? (
            <p className="mt-3 text-xs text-muted-foreground">
              The control is fixed after creation. Every entry this tracker holds was written
              through it — a timer&rsquo;s seconds would be read as a count under any other one.
            </p>
          ) : null}
        </div>

        {/* 3 — how often */}
        <SectionHeading index={3} title="How often" />
        <div className="grid grid-cols-1 border-b border-border sm:grid-cols-[minmax(0,1fr)_240px]">
          <div className="flex flex-col gap-3 px-6 py-5 sm:border-r sm:border-border">
            <FieldLabelText>Schedule</FieldLabelText>
            <form.Field name="scheduleType">
              {(field) => (
                <div className="flex w-fit border border-border">
                  {SCHEDULE_OPTIONS.map((option) => {
                    const selected = field.state.value === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => field.handleChange(option.value)}
                        className={cn(
                          "border-r border-border px-4 py-1.5 text-sm transition-colors last:border-r-0",
                          selected
                            ? "bg-foreground font-medium text-background"
                            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                        )}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </form.Field>

            <form.Subscribe selector={(state) => state.values.scheduleType}>
              {(scheduleType) =>
                scheduleType === "days_of_week" ? (
                  <form.Field name="scheduleDays">
                    {(field) => (
                      <div className="flex flex-col gap-2">
                        <div className="flex flex-wrap gap-1">
                          {DAY_NAMES.map((dayName, day) => {
                            const selected = field.state.value.includes(day);
                            return (
                              <button
                                key={dayName}
                                type="button"
                                aria-pressed={selected}
                                onClick={() =>
                                  field.handleChange(
                                    selected
                                      ? field.state.value.filter((value) => value !== day)
                                      : [...field.state.value, day],
                                  )
                                }
                                className={cn(
                                  "border px-2.5 py-1 text-xs transition-colors",
                                  selected
                                    ? "border-primary bg-primary text-primary-foreground"
                                    : "border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                                )}
                              >
                                {dayName}
                              </button>
                            );
                          })}
                        </div>
                        <FieldError errors={field.state.meta.errors} />
                      </div>
                    )}
                  </form.Field>
                ) : scheduleType === "times_per_week" ? (
                  <form.Field name="scheduleCount">
                    {(field) => (
                      <Input
                        type="number"
                        min="1"
                        max="7"
                        aria-label="Times per week"
                        value={field.state.value}
                        onChange={(event) => field.handleChange(event.target.valueAsNumber)}
                        onBlur={field.handleBlur}
                        className={cn(UNDERLINE_INPUT, "w-24")}
                      />
                    )}
                  </form.Field>
                ) : null
              }
            </form.Subscribe>
          </div>

          <form.Field name="activeFrom">
            {(field) => (
              <div className="flex flex-col gap-2 px-6 py-5">
                <FieldLabelText htmlFor={field.name}>Starts</FieldLabelText>
                {/* DEV_NOTE: the date input renders the raw YYYY-MM-DD, so the human reading of it
                    ("Today · 4 Sep 2026") sits underneath rather than replacing the control. */}
                <Input
                  id={field.name}
                  type="date"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                  className={UNDERLINE_INPUT}
                />
                <span className="text-xs text-muted-foreground">
                  {formatStartDate(field.state.value)}
                </span>
              </div>
            )}
          </form.Field>
        </div>

        {/* 4 — optional */}
        <SectionHeading index={4} title="Optional" />
        <div className="grid grid-cols-1 border-b border-border sm:grid-cols-2 lg:grid-cols-4">
          <form.Field name="target">
            {(field) => (
              <div className="flex flex-col gap-2 px-6 py-5 sm:border-r sm:border-border">
                <FieldLabelText htmlFor={field.name}>Target</FieldLabelText>
                <Input
                  id={field.name}
                  type="number"
                  step="any"
                  placeholder="Not set"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                  className={UNDERLINE_INPUT}
                />
                <FieldError errors={field.state.meta.errors} />
              </div>
            )}
          </form.Field>

          {/* DEV_NOTE: next to Target on purpose — the two are one question ("is this number a
              floor or a ceiling?"), and the backend scores a day by reading them together. */}
          <form.Field name="direction">
            {(field) => (
              <div className="flex flex-col gap-2 px-6 py-5 lg:border-r lg:border-border">
                <div className="flex items-center gap-1.5">
                  <FieldLabelText htmlFor={field.name}>Direction</FieldLabelText>
                  <InfoHint label="Why direction is set per tracker">{DIRECTION_HELP}</InfoHint>
                </div>
                <Select
                  value={field.state.value}
                  onValueChange={(value) => field.handleChange(value as Schemas.Direction)}
                >
                  <SelectTrigger id={field.name} className={UNDERLINE_TRIGGER}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {Schemas.ZDirection.options.map((option) => (
                        <SelectItem key={option} value={option}>
                          {DIRECTION_LABELS[option]}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <span className="text-xs text-muted-foreground">
                  {DIRECTION_HINTS[field.state.value]}
                </span>
              </div>
            )}
          </form.Field>

          <form.Field name="step">
            {(field) => (
              <div className="flex flex-col gap-2 px-6 py-5 sm:border-r sm:border-border">
                <FieldLabelText htmlFor={field.name}>Step</FieldLabelText>
                <Input
                  id={field.name}
                  type="number"
                  step="any"
                  placeholder="Not set"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                  className={UNDERLINE_INPUT}
                />
                <FieldError errors={field.state.meta.errors} />
              </div>
            )}
          </form.Field>

          <form.Field name="entryMode">
            {(field) => (
              <div className="flex flex-col gap-2 px-6 py-5">
                <FieldLabelText htmlFor={field.name}>Entry mode</FieldLabelText>
                <Select
                  value={field.state.value}
                  onValueChange={(value) => field.handleChange(value as "live" | "retro")}
                >
                  <SelectTrigger id={field.name} className={UNDERLINE_TRIGGER}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="retro">Any date</SelectItem>
                      <SelectItem value="live">Today only</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            )}
          </form.Field>
        </div>

        {/* Metric & units — derived, with every field one press away */}
        <form.Subscribe selector={(state) => state.values}>
          {(values) => {
            const tile =
              CONTROL_TILES.find((option) => option.key === values.tileKey) ?? CONTROL_TILES[0];
            const { metric, isExisting } = resolveMetric(values, tile.control, metrics);

            return (
              <div className="border-b border-border">
                <div className="flex items-center justify-between gap-4 px-6 py-5">
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-medium">Metric &amp; units</span>
                    <span className="text-xs text-muted-foreground">
                      {metric.semanticType} · {metric.canonicalUnit} · {metric.defaultAgg} —{" "}
                      {isEditing
                        ? `writes into ${metric.key}, fixed after creation`
                        : isExisting
                          ? `writes into ${metric.key}`
                          : "declared automatically from the control"}
                    </span>
                  </div>
                  {/* DEV_NOTE: no Change in edit mode — repointing the metric would detach every
                      entry already written from this tracker's heatmap and streak, so the API
                      doesn't accept it (ZUpdateTrackerApiRequest) and the form doesn't offer it.
                      A metric's own six fields are still editable on the /metrics screen. */}
                  {isEditing ? null : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0 tracking-wider uppercase"
                      onClick={() =>
                        metricPanelOpen ? setMetricPanelOpen(false) : openMetricPanel()
                      }
                    >
                      {metricPanelOpen ? "Done" : "Change"}
                    </Button>
                  )}
                </div>

                {metricPanelOpen ? (
                  <div className="flex flex-col gap-5 border-t border-border bg-muted/30 px-6 py-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <ModeButton
                        selected={values.metricMode === "custom"}
                        onClick={() => form.setFieldValue("metricMode", "custom")}
                      >
                        Declare a new metric
                      </ModeButton>
                      <ModeButton
                        selected={values.metricMode === "existing"}
                        onClick={() => form.setFieldValue("metricMode", "existing")}
                      >
                        Point at an existing one
                      </ModeButton>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={resetMetricToDerived}
                        className="text-muted-foreground"
                      >
                        Reset to derived
                      </Button>
                    </div>

                    {values.metricMode === "existing" ? (
                      <form.Field name="metricPublicId">
                        {(field) => {
                          const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
                          return (
                            <div className="flex flex-col gap-2">
                              <FieldLabelText htmlFor={field.name}>Existing metric</FieldLabelText>
                              {metricsQuery.isPending ? (
                                <p className="text-sm text-muted-foreground">Loading metrics...</p>
                              ) : metricsQuery.isError ? (
                                <p className="text-sm text-destructive">Failed to load metrics.</p>
                              ) : metrics.length === 0 ? (
                                <p className="text-sm text-muted-foreground">
                                  No metrics defined yet — this tracker will have to declare one.
                                </p>
                              ) : (
                                <Select
                                  value={field.state.value}
                                  onValueChange={applyExistingMetric}
                                >
                                  <SelectTrigger
                                    id={field.name}
                                    aria-invalid={isInvalid}
                                    className="w-full"
                                  >
                                    <SelectValue placeholder="Choose a metric" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectGroup>
                                      <SelectLabel>Your metrics</SelectLabel>
                                      {metrics.map((option) => (
                                        <SelectItem key={option.publicId} value={option.publicId}>
                                          {option.name} · {option.canonicalUnit}
                                        </SelectItem>
                                      ))}
                                    </SelectGroup>
                                  </SelectContent>
                                </Select>
                              )}
                              <p className="text-xs text-muted-foreground">
                                Two trackers on one metric roll into a single number.
                              </p>
                              <FieldError errors={field.state.meta.errors} />
                            </div>
                          );
                        }}
                      </form.Field>
                    ) : (
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <form.Field name="metricKey">
                          {(field) => (
                            <div className="flex flex-col gap-2">
                              <FieldLabelText htmlFor={field.name}>Metric key</FieldLabelText>
                              <Input
                                id={field.name}
                                value={field.state.value}
                                onChange={(event) =>
                                  field.handleChange(slugifyMetricKey(event.target.value))
                                }
                                onBlur={field.handleBlur}
                                className="font-mono"
                              />
                              <p className="text-xs text-muted-foreground">
                                A key you already own is reused, not duplicated.
                              </p>
                              <FieldError errors={field.state.meta.errors} />
                            </div>
                          )}
                        </form.Field>

                        <form.Field name="metricName">
                          {(field) => (
                            <div className="flex flex-col gap-2">
                              <FieldLabelText htmlFor={field.name}>Metric name</FieldLabelText>
                              <Input
                                id={field.name}
                                value={field.state.value}
                                onChange={(event) => field.handleChange(event.target.value)}
                                onBlur={field.handleBlur}
                              />
                              <FieldError errors={field.state.meta.errors} />
                            </div>
                          )}
                        </form.Field>

                        <form.Field name="semanticType">
                          {(field) => (
                            <div className="flex flex-col gap-2">
                              <FieldLabelText htmlFor={field.name}>Semantic type</FieldLabelText>
                              <Select
                                value={field.state.value}
                                onValueChange={(value) =>
                                  applySemanticType(value as Schemas.SemanticType)
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
                            </div>
                          )}
                        </form.Field>

                        <form.Field name="canonicalUnit">
                          {(field) => {
                            const implied = UNIT_FOR_SEMANTIC_TYPE[values.semanticType];
                            return (
                              <div className="flex flex-col gap-2">
                                <FieldLabelText htmlFor={field.name}>Canonical unit</FieldLabelText>
                                <Input
                                  id={field.name}
                                  value={field.state.value}
                                  disabled={implied !== undefined}
                                  placeholder={UNIT_PLACEHOLDER[values.semanticType]}
                                  onChange={(event) => field.handleChange(event.target.value)}
                                  onBlur={field.handleBlur}
                                />
                                <p className="text-xs text-muted-foreground">
                                  {implied
                                    ? `${values.semanticType} is always measured in ${implied}.`
                                    : "What one unit of this metric is. Stored as typed — display units are converted on the way out."}
                                </p>
                                <FieldError errors={field.state.meta.errors} />
                              </div>
                            );
                          }}
                        </form.Field>

                        <form.Field name="defaultAgg">
                          {(field) => (
                            <div className="flex flex-col gap-2">
                              <div className="flex items-center gap-1.5">
                                <FieldLabelText htmlFor={field.name}>Aggregation</FieldLabelText>
                                <InfoHint label="Why aggregation belongs to the metric">
                                  {AGG_HELP}
                                </InfoHint>
                              </div>
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
                                        {AGG_LABELS[option]}
                                      </SelectItem>
                                    ))}
                                  </SelectGroup>
                                </SelectContent>
                              </Select>
                              <p className="text-xs text-muted-foreground">
                                {AGG_HINTS[field.state.value]}
                              </p>
                            </div>
                          )}
                        </form.Field>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            );
          }}
        </form.Subscribe>

        {/* Compute module — read-only, because the tile decides it */}
        <form.Subscribe selector={(state) => state.values.tileKey}>
          {(tileKey) => {
            const tile = CONTROL_TILES.find((option) => option.key === tileKey) ?? CONTROL_TILES[0];
            return (
              <div className="border-b border-border">
                <div className="flex items-center justify-between gap-4 px-6 py-5">
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-medium">Compute module</span>
                    <span className="text-xs text-muted-foreground">
                      {tile.compute
                        ? `${tile.compute} — the transfer tile brings its own.`
                        : "None. Only money transfers need one today."}
                    </span>
                  </div>
                  {/* DEV_NOTE: the panel's only content is "pick the Transfer tile", and the tiles
                      are locked in edit mode — so there is nothing here to open. */}
                  {isEditing ? null : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0 tracking-wider uppercase"
                      onClick={() => setComputePanelOpen((open) => !open)}
                    >
                      {computePanelOpen ? "Done" : "Change"}
                    </Button>
                  )}
                </div>

                {computePanelOpen ? (
                  // DEV_NOTE: not a picker. A compute module is bound to the shape it computes —
                  // money.transfer.v1 writes two signed entries sharing a transfer_group_id, which
                  // only makes sense under an amount pad. Picking one independently of the control
                  // would let a user build a tracker the backend rejects at create time
                  // (validateComputeManifest), so the tile is the only way in and this panel just
                  // says so.
                  <div className="border-t border-border bg-muted/30 px-6 py-5">
                    <p className="text-sm text-muted-foreground">
                      Compute modules follow the control. Pick the{" "}
                      <button
                        type="button"
                        onClick={() => {
                          applyTile("transfer");
                          setComputePanelOpen(false);
                        }}
                        className="text-foreground underline underline-offset-2"
                      >
                        Transfer
                      </button>{" "}
                      tile above to get money.transfer.v1 — the one thing the eight controls
                      can&rsquo;t express on their own. Every other tracker needs none.
                    </p>
                  </div>
                ) : null}
              </div>
            );
          }}
        </form.Subscribe>

        <div className="flex justify-end gap-2 px-6 py-5">
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
      </div>

      <aside className="border-t border-border lg:sticky lg:top-0 lg:h-fit lg:border-t-0">
        <form.Subscribe selector={(state) => state.values}>
          {(values) => {
            const tile =
              CONTROL_TILES.find((option) => option.key === values.tileKey) ?? CONTROL_TILES[0];
            const { metric, isExisting } = resolveMetric(values, tile.control, metrics);

            return (
              <TrackerPreview
                name={values.name}
                icon={values.icon}
                control={tile.control}
                schedule={buildSchedule(values)}
                direction={values.direction}
                metric={metric}
                isExistingMetric={isExisting}
              />
            );
          }}
        </form.Subscribe>
      </aside>
    </form>
  );
}

// DEV_NOTE: shadcn's Input is used as-is and reshaped through className (never edited in
// src/shadcn/ui/) — the design's fields are a single rule under the text rather than a boxed input.
const UNDERLINE_INPUT =
  "rounded-none border-0 border-b border-border bg-transparent px-0 shadow-none focus-visible:border-primary focus-visible:ring-0 dark:bg-transparent";

const UNDERLINE_TRIGGER =
  "w-full rounded-none border-0 border-b border-border bg-transparent px-0 shadow-none focus-visible:border-primary focus-visible:ring-0 dark:bg-transparent dark:hover:bg-transparent";

function SectionHeading({ index, title }: { index: number; title: string }) {
  return (
    <div className="border-b border-border px-6 py-2.5">
      <p className="text-[10px] font-medium tracking-widest text-muted-foreground uppercase">
        {index} · {title}
      </p>
    </div>
  );
}

// DEV_NOTE: a popover rather than a tooltip — this explains a modelling decision in two sentences,
// and a hover-only tooltip would be both unreadable at that length and unreachable on touch. The
// trigger is a real button so it's keyboard-reachable, and `aria-label` carries what the icon means.
function InfoHint({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground"
        >
          <Info size={14} weight="bold" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-w-xs text-xs leading-relaxed">
        {children}
      </PopoverContent>
    </Popover>
  );
}

function FieldLabelText({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return (
    <label
      htmlFor={htmlFor}
      className="text-[10px] font-medium tracking-widest text-muted-foreground uppercase"
    >
      {children}
    </label>
  );
}

function ModeButton({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "border px-3 py-1.5 text-xs transition-colors",
        selected
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      {children}
    </button>
  );
}
