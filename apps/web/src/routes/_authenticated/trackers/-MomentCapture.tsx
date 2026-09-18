import { useState } from "react";
import { Lightning, Plus } from "@phosphor-icons/react";
import * as Schemas from "@app/schemas";
import { Button } from "@/shadcn/ui/button";
import { Input } from "@/shadcn/ui/input";
import { Label } from "@/shadcn/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/shadcn/ui/sheet";
import { cn } from "@/utils/tailwind";
import { useCreateTrackerMoment } from "./-data";
import { momentOutcomeWords, resolveTrackerDirection, useIsMobile } from "./-utils";

interface MomentCaptureProps {
  tracker: Schemas.TrackerApiShape;
  plans: Schemas.TrackerPlanApiShape[];
  // "icon" for dense rows, "button" where there's room for the label.
  variant?: "icon" | "button";
}

type TriggerChoice = { kind: "none" } | { kind: "plan"; publicId: string } | { kind: "new" };

// DEV_NOTE: captured mid-urge, so the common path is two taps — pick the trigger, tap the outcome —
// and the outcome buttons are the submit. A moment is purely reflective (see TrackerMoment's
// DEV_NOTE): it never writes a tracker entry, on either direction. Logging what actually happened is
// a separate, deliberate act on the tracker's own control — mixing the two here would make a
// "held/slipped" record silently decide the tracker's score behind the user's back.
export function MomentCapture({ tracker, plans, variant = "icon" }: MomentCaptureProps) {
  const createMoment = useCreateTrackerMoment();
  const isMobile = useIsMobile();

  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<TriggerChoice>(
    plans[0] ? { kind: "plan", publicId: plans[0].publicId } : { kind: "none" },
  );
  const [newCue, setNewCue] = useState("");
  const [note, setNote] = useState("");

  const direction = resolveTrackerDirection(tracker);
  const words = momentOutcomeWords(direction);
  const selectedPlan =
    choice.kind === "plan"
      ? (plans.find((plan) => plan.publicId === choice.publicId) ?? null)
      : null;
  const isSaving = createMoment.isPending;
  const needsCue = choice.kind === "new" && newCue.trim() === "";

  function reset() {
    setChoice(plans[0] ? { kind: "plan", publicId: plans[0].publicId } : { kind: "none" });
    setNewCue("");
    setNote("");
  }

  async function save(outcome: Schemas.TrackerMomentOutcomeIntEnum) {
    const response = await createMoment.mutateAsync({
      publicId: tracker.publicId,
      moment: {
        momentOutcome: outcome,
        planPublicId: choice.kind === "plan" ? choice.publicId : undefined,
        newCue: choice.kind === "new" ? newCue.trim() : undefined,
        note: note.trim() === "" ? null : note.trim(),
      },
    });
    if (!response.isSuccess) return;

    setOpen(false);
    reset();
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <SheetTrigger asChild>
        {variant === "icon" ? (
          <Button variant="ghost" size="icon-sm" aria-label={`Log a trigger for ${tracker.name}`}>
            <Lightning weight="fill" className="text-primary" />
          </Button>
        ) : (
          <Button variant="outline" size="sm">
            <Lightning weight="fill" className="text-primary" />
            Log a moment
          </Button>
        )}
      </SheetTrigger>

      {/* DEV_NOTE: side picked in JS, not by a `sm:` class override — Radix bakes each side's
          positioning into `data-[side=x]:*` rules, which carry an attribute selector and beat a
          plain `sm:*` class on specificity regardless of viewport width. Reposition via `sm:` and
          the base bottom-sheet rules still win, which is how this rendered half off-screen before.
          Picking the side itself sidesteps the fight — each side's built-in styles are already
          correct on their own. */}
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={cn(
          "overflow-y-auto",
          isMobile && "max-h-[90dvh] rounded-t-2xl pb-[env(safe-area-inset-bottom)]",
        )}
      >
        <SheetHeader className="pb-2">
          <SheetTitle>{tracker.name}</SheetTitle>
          <SheetDescription>What set it off?</SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-5 px-6 pb-6">
          <div className="flex flex-wrap gap-2">
            {plans.map((plan) => (
              <ChoiceChip
                key={plan.publicId}
                selected={choice.kind === "plan" && choice.publicId === plan.publicId}
                onClick={() => setChoice({ kind: "plan", publicId: plan.publicId })}
              >
                {plan.cue}
              </ChoiceChip>
            ))}
            <ChoiceChip selected={choice.kind === "new"} onClick={() => setChoice({ kind: "new" })}>
              <Plus className="size-3.5" />
              Something new
            </ChoiceChip>
            <ChoiceChip
              selected={choice.kind === "none"}
              onClick={() => setChoice({ kind: "none" })}
            >
              Not sure
            </ChoiceChip>
          </div>

          {choice.kind === "new" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`new-cue-${tracker.publicId}`}>If…</Label>
              <Input
                id={`new-cue-${tracker.publicId}`}
                autoFocus
                maxLength={200}
                value={newCue}
                onChange={(event) => setNewCue(event.target.value)}
                placeholder="e.g. bored after dinner"
              />
            </div>
          ) : null}

          {/* DEV_NOTE: the plan is shown at the moment it matters most — while the urge is live. */}
          {selectedPlan ? (
            <div className="rounded-lg border border-border px-4 py-3 text-sm">
              <p className="text-2xs font-medium tracking-widest text-muted-foreground uppercase">
                Your plan
              </p>
              <p className="mt-1">
                <span className="text-muted-foreground">If</span> {selectedPlan.cue}
                <span className="text-muted-foreground">, then </span>
                {selectedPlan.response ?? (
                  <span className="text-muted-foreground italic">no plan yet</span>
                )}
              </p>
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`moment-note-${tracker.publicId}`}>Note (optional)</Label>
            <Input
              id={`moment-note-${tracker.publicId}`}
              maxLength={1000}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Where, who, how it felt"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Button
              size="lg"
              disabled={isSaving || needsCue}
              onClick={() => save(Schemas.TrackerMomentOutcomeIntEnum.Held)}
            >
              {words.held}
            </Button>
            <Button
              size="lg"
              variant="outline"
              disabled={isSaving || needsCue}
              onClick={() => save(Schemas.TrackerMomentOutcomeIntEnum.Slipped)}
            >
              {words.slipped}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ChoiceChip({
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
        "inline-flex min-h-9 items-center gap-1 rounded-full border px-3 py-1.5 text-sm transition-colors",
        selected
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border text-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}
