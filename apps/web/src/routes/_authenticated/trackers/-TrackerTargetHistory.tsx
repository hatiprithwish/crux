import { useForm } from "@tanstack/react-form";
import { z } from "zod";
import { Trash } from "@phosphor-icons/react";
import type * as Schemas from "@app/schemas";
import { Button } from "@/shadcn/ui/button";
import { Input } from "@/shadcn/ui/input";
import { FieldError } from "@/shadcn/ui/field";
import { cn } from "@/utils/tailwind";
import { useCreateTrackerTarget, useDeleteTrackerTarget } from "./-data";
import {
  DISPLAY_UNIT_SUFFIXES,
  formatMetricValue,
  getTodayLocalDate,
  resolveDisplayUnit,
  toCanonical,
} from "./-utils";

// DEV_NOTE: the screen that makes the target-history table usable by the person who owns the
// history. The backend can seed an era at the tracker's start and open a new one whenever the goal
// changes, but it cannot know the one thing this panel exists for: that a tracker logged for a
// fortnight with no goal had its target added on the 9th, not on the day it started. Nobody
// recorded that, so nobody but the user can say it — and until they do, the migration's honest
// default has today's goal reaching all the way back.
//
// DEV_NOTE: eras, not rows. A target row is a boundary; what a reader wants is the span it opened
// and the span it ended, so each row prints its own start and the day before the next one starts.
// The newest era has no end and says so.
const UNDERLINE_INPUT =
  "rounded-none border-0 border-b border-border bg-transparent px-0 shadow-none focus-visible:border-primary focus-visible:ring-0 dark:bg-transparent";

const ZTargetFormValues = z
  .object({
    effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
    target: z.string(),
  })
  .superRefine((values, ctx) => {
    if (values.target.trim() !== "" && Number.isNaN(Number(values.target))) {
      ctx.addIssue({ code: "custom", path: ["target"], message: "Target must be a number" });
    }
  });

interface TrackerTargetHistoryProps {
  tracker: Schemas.TrackerApiShape;
  metric: Schemas.TrackerMetricDetail | null;
  targets: Schemas.TrackerTargetApiShape[];
  isPending: boolean;
  isError: boolean;
}

function formatEraDate(localDate: string): string {
  return new Date(`${localDate}T00:00:00.000Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function dayBefore(localDate: string): string {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function TrackerTargetHistory({
  tracker,
  metric,
  targets,
  isPending,
  isError,
}: TrackerTargetHistoryProps) {
  const createTarget = useCreateTrackerTarget();
  const deleteTarget = useDeleteTrackerTarget();

  // DEV_NOTE: the same unit the target field in the edit form is typed in — a user who thinks in
  // minutes must not have to type 14400 here because the column stores seconds (invariant 2).
  const displayUnit = resolveDisplayUnit(tracker.manifest, metric?.semanticType);
  const suffix = displayUnit ? DISPLAY_UNIT_SUFFIXES[displayUnit] : null;

  const form = useForm({
    defaultValues: { effectiveFrom: getTodayLocalDate(), target: "" },
    validators: { onSubmit: ZTargetFormValues },
    onSubmit: async ({ value, formApi }) => {
      await createTarget.mutateAsync({
        publicId: tracker.publicId,
        target: {
          effectiveFrom: value.effectiveFrom,
          // Empty is not zero — it is "no target from this day", the row that makes an era with no
          // goal a recorded fact rather than a gap (invariant 7).
          target:
            value.target.trim() === "" ? null : toCanonical(Number(value.target), displayUnit),
        },
      });
      formApi.reset();
    },
  });

  const describeTarget = (target: number | null) => {
    if (target === null) return "No target";
    if (!metric) return String(target);
    return formatMetricValue(target, metric.semanticType, metric.canonicalUnit);
  };

  return (
    <section className="flex flex-col border-b border-border">
      <div className="flex items-baseline justify-between gap-4 border-b border-border px-6 py-2.5">
        <p className="text-2xs font-medium tracking-widest text-muted-foreground uppercase">
          Target history
        </p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {isPending ? "—" : `${targets.length} ${targets.length === 1 ? "era" : "eras"}`}
        </p>
      </div>

      <p className="border-b border-border px-6 py-3 text-xs leading-relaxed text-muted-foreground">
        Every day is scored against the target that was in force on that day, so raising your goal
        today leaves what you already did alone. Add a row here to say when a target actually
        started.
      </p>

      {isPending ? (
        <p className="px-6 py-5 text-sm text-muted-foreground">Loading target history…</p>
      ) : isError ? (
        <p className="px-6 py-5 text-sm text-destructive">Failed to load target history.</p>
      ) : targets.length === 0 ? (
        <p className="px-6 py-5 text-sm text-muted-foreground">
          No targets recorded — every logged day counts as met.
        </p>
      ) : (
        <ul className="flex flex-col">
          {targets.map((target, index) => {
            const next = targets[index + 1];
            const isCurrent = next === undefined;

            return (
              <li
                key={target.publicId}
                className="flex items-center justify-between gap-4 border-b border-border px-6 py-3"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span
                    className={cn(
                      "text-sm tabular-nums",
                      target.target === null && "text-muted-foreground",
                    )}
                  >
                    {describeTarget(target.target)}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {formatEraDate(target.effectiveFrom)}
                    {isCurrent ? " — now" : ` — ${formatEraDate(dayBefore(next.effectiveFrom))}`}
                  </span>
                </div>

                {/* DEV_NOTE: removing an era is removing a boundary — the days it covered fall back
                    to the era before it. Reversible by adding the row again, so it asks nothing. */}
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove the target starting ${formatEraDate(target.effectiveFrom)}`}
                  disabled={deleteTarget.isPending}
                  onClick={() =>
                    deleteTarget.mutate({
                      publicId: tracker.publicId,
                      targetPublicId: target.publicId,
                    })
                  }
                >
                  <Trash size={16} />
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <form
        className="flex flex-wrap items-end gap-4 px-6 py-5"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void form.handleSubmit();
        }}
      >
        <form.Field name="effectiveFrom">
          {(field) => (
            <div className="flex min-w-40 flex-col gap-2">
              <label
                htmlFor={field.name}
                className="text-2xs font-medium tracking-widest text-muted-foreground uppercase"
              >
                In force from
              </label>
              <Input
                id={field.name}
                type="date"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
                className={UNDERLINE_INPUT}
              />
              <FieldError errors={field.state.meta.errors} />
            </div>
          )}
        </form.Field>

        <form.Field name="target">
          {(field) => (
            <div className="flex min-w-32 flex-col gap-2">
              <label
                htmlFor={field.name}
                className="text-2xs font-medium tracking-widest text-muted-foreground uppercase"
              >
                Target{suffix ? ` · ${suffix}` : ""}
              </label>
              <Input
                id={field.name}
                type="number"
                step="any"
                placeholder="No target"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
                className={UNDERLINE_INPUT}
              />
              <FieldError errors={field.state.meta.errors} />
            </div>
          )}
        </form.Field>

        <Button type="submit" variant="outline" size="sm" disabled={createTarget.isPending}>
          {createTarget.isPending ? "Saving…" : "Add era"}
        </Button>

        <p className="w-full text-xs text-muted-foreground">
          Leave the target empty to record a stretch with no goal. Saving a date the history already
          covers replaces that era rather than adding a second one.
          {tracker.manifest.target !== null && metric ? (
            <>
              {" "}
              Today&apos;s target is{" "}
              <span className="tabular-nums">{describeTarget(tracker.manifest.target)}</span>.
            </>
          ) : null}
        </p>
      </form>
    </section>
  );
}
