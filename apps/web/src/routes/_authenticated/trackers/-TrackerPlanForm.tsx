import { useId } from "react";
import { useForm } from "@tanstack/react-form";
import * as Schemas from "@app/schemas";
import { Button } from "@/shadcn/ui/button";
import { Input } from "@/shadcn/ui/input";
import { FieldError } from "@/shadcn/ui/field";

interface TrackerPlanFormProps {
  initial?: Schemas.TrackerPlanBase;
  submitLabel: string;
  isPending: boolean;
  onSubmit: (plan: Schemas.TrackerPlanBase) => Promise<unknown>;
  onCancel?: () => void;
  autoFocus?: boolean;
}

// DEV_NOTE: shared by "add" and "edit" — the two differ only in their starting values. A bordered
// box, same weight as the composer at the bottom of -TrackerTargetHistory.tsx, so it reads as one
// small form rather than two inputs floating loose on the page.
export function TrackerPlanForm({
  initial,
  submitLabel,
  isPending,
  onSubmit,
  onCancel,
  autoFocus,
}: TrackerPlanFormProps) {
  const idPrefix = useId();
  const form = useForm({
    defaultValues: { cue: initial?.cue ?? "", response: initial?.response ?? "" },
    validators: { onSubmit: Schemas.ZTrackerPlanFormValues },
    onSubmit: async ({ value, formApi }) => {
      const response = value.response.trim();
      await onSubmit({ cue: value.cue.trim(), response: response === "" ? null : response });
      formApi.reset();
    },
  });

  return (
    <form
      className="flex flex-col gap-4 rounded-lg border border-border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <form.Field name="cue">
          {(field) => (
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor={`${idPrefix}-${field.name}`}
                className="text-2xs font-medium tracking-widest text-muted-foreground uppercase"
              >
                If
              </label>
              <Input
                id={`${idPrefix}-${field.name}`}
                autoFocus={autoFocus}
                maxLength={200}
                placeholder="I'm bored after dinner"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
              />
              <FieldError errors={field.state.meta.errors} />
            </div>
          )}
        </form.Field>

        <form.Field name="response">
          {(field) => (
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor={`${idPrefix}-${field.name}`}
                className="text-2xs font-medium tracking-widest text-muted-foreground uppercase"
              >
                Then
              </label>
              <Input
                id={`${idPrefix}-${field.name}`}
                maxLength={200}
                placeholder="I walk for 10 minutes"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
              />
              <FieldError errors={field.state.meta.errors} />
            </div>
          )}
        </form.Field>
      </div>

      <div className="flex justify-end gap-2">
        {onCancel ? (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
