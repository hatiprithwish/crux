import { useMemo, useState } from "react";
import { ArrowUp, PencilSimple, Plus, Trash } from "@phosphor-icons/react";
import * as Schemas from "@app/schemas";
import { Button } from "@/shadcn/ui/button";
import { cn } from "@/utils/tailwind";
import {
  useCreateTrackerPlan,
  useDeleteTrackerMoment,
  useDeleteTrackerPlan,
  useReorderTrackerPlans,
  useUpdateTrackerPlan,
} from "./-data";
import { TrackerPlanForm } from "./-TrackerPlanForm";
import { momentOutcomeWords, resolveTrackerDirection } from "./-utils";

interface TrackerTriggersTabProps {
  tracker: Schemas.TrackerApiShape;
  plans: Schemas.TrackerPlanApiShape[];
  plansPending: boolean;
  plansError: boolean;
  moments: Schemas.TrackerMomentApiShape[];
  momentsPending: boolean;
  momentsError: boolean;
  windowDays: number;
}

type TriggerTally = { held: number; slipped: number };

const NO_TRIGGER_KEY = "__none__";

function SectionHeading({ title, meta }: { title: string; meta?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border px-6 py-2.5">
      <p className="text-[10px] font-medium tracking-widest text-muted-foreground uppercase">
        {title}
      </p>
      {meta ? <p className="text-xs text-muted-foreground tabular-nums">{meta}</p> : null}
    </div>
  );
}

function formatMomentTime(occurredAt: Date): string {
  return new Date(occurredAt).toLocaleString([], {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// DEV_NOTE: plan management and the moment log live here — the if-then itself (what triggers this,
// what to do about it), how often each trigger actually fires, and past moments. Capturing a NEW
// moment is deliberately not a button on this tab: it lives in the page header, only on History, so
// this tab stays about reviewing and editing triggers rather than also being an entry point into a
// different screen's action.
export function TrackerTriggersTab({
  tracker,
  plans,
  plansPending,
  plansError,
  moments,
  momentsPending,
  momentsError,
  windowDays,
}: TrackerTriggersTabProps) {
  const createPlan = useCreateTrackerPlan();
  const updatePlan = useUpdateTrackerPlan();
  const deletePlan = useDeleteTrackerPlan();
  const reorderPlans = useReorderTrackerPlans();
  const deleteMoment = useDeleteTrackerMoment();
  const [editingPublicId, setEditingPublicId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  const words = momentOutcomeWords(resolveTrackerDirection(tracker));

  const tallies = useMemo(() => {
    const byKey = new Map<string, TriggerTally>();
    for (const moment of moments) {
      const key = moment.plan?.publicId ?? NO_TRIGGER_KEY;
      const tally = byKey.get(key) ?? { held: 0, slipped: 0 };
      if (moment.momentOutcome === Schemas.TrackerMomentOutcomeIntEnum.Held) tally.held++;
      else tally.slipped++;
      byKey.set(key, tally);
    }
    return byKey;
  }, [moments]);

  const noTrigger = tallies.get(NO_TRIGGER_KEY);

  function moveToTop(planPublicId: string) {
    reorderPlans.mutate({
      publicId: tracker.publicId,
      planPublicIds: [
        planPublicId,
        ...plans.map((plan) => plan.publicId).filter((publicId) => publicId !== planPublicId),
      ],
    });
  }

  function renderTally(tally: TriggerTally | undefined) {
    if (!tally) return <span className="text-muted-foreground">No moments</span>;
    return (
      <>
        <span>
          {tally.held} {words.held.toLowerCase()}
        </span>
        <span className="text-muted-foreground"> · </span>
        <span>
          {tally.slipped} {words.slipped.toLowerCase()}
        </span>
      </>
    );
  }

  return (
    <div className="flex flex-col">
      <section>
        <div className="flex items-baseline justify-between gap-4 border-b border-border px-6 py-2.5">
          <p className="text-[10px] font-medium tracking-widest text-muted-foreground uppercase">
            Triggers{plans.length > 0 ? ` · ${plans.length}` : ""}
          </p>
          <p className="text-xs text-muted-foreground tabular-nums">last {windowDays} days</p>
        </div>

        {plansPending || momentsPending ? (
          <p className="px-6 py-5 text-sm text-muted-foreground">Loading triggers…</p>
        ) : plansError || momentsError ? (
          <p className="px-6 py-5 text-sm text-destructive">Failed to load triggers.</p>
        ) : (
          <>
            {plans.length === 0 && !noTrigger ? (
              <p className="border-b border-border px-6 py-5 text-sm text-muted-foreground">
                What usually sets this off? Name the trigger and decide now what you&apos;ll do when
                it shows up — then the moment itself needs no willpower.
              </p>
            ) : (
              <ul className="flex flex-col">
                {plans.map((plan, index) => (
                  <li key={plan.publicId} className="border-b border-border px-6 py-4">
                    {editingPublicId === plan.publicId ? (
                      <TrackerPlanForm
                        initial={{ cue: plan.cue, response: plan.response }}
                        submitLabel="Save"
                        autoFocus
                        isPending={updatePlan.isPending}
                        onCancel={() => setEditingPublicId(null)}
                        onSubmit={async (next) => {
                          await updatePlan.mutateAsync({
                            publicId: tracker.publicId,
                            planPublicId: plan.publicId,
                            plan: next,
                          });
                          setEditingPublicId(null);
                        }}
                      />
                    ) : (
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex min-w-0 flex-col gap-1">
                          <p className="text-sm">
                            <span className="text-muted-foreground">If </span>
                            <span className="font-medium">{plan.cue}</span>
                            <span className="text-primary"> → </span>
                            {plan.response ?? (
                              <span className="text-muted-foreground italic">no plan yet</span>
                            )}
                          </p>
                          <p className="text-xs tabular-nums">
                            {renderTally(tallies.get(plan.publicId))}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center">
                          {index > 0 ? (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Show "${plan.cue}" first`}
                              disabled={reorderPlans.isPending}
                              onClick={() => moveToTop(plan.publicId)}
                            >
                              <ArrowUp />
                            </Button>
                          ) : null}
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Edit "${plan.cue}"`}
                            onClick={() => setEditingPublicId(plan.publicId)}
                          >
                            <PencilSimple />
                          </Button>
                          {/* DEV_NOTE: soft delete, and past moments keep the cue — so no confirm. */}
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Remove "${plan.cue}"`}
                            disabled={deletePlan.isPending}
                            onClick={() =>
                              deletePlan.mutate({
                                publicId: tracker.publicId,
                                planPublicId: plan.publicId,
                              })
                            }
                          >
                            <Trash />
                          </Button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
                {noTrigger ? (
                  <li className="flex flex-col gap-1 border-b border-border px-6 py-4">
                    <p className="text-sm text-muted-foreground italic">Not sure what set it off</p>
                    <p className="text-xs tabular-nums">{renderTally(noTrigger)}</p>
                  </li>
                ) : null}
              </ul>
            )}

            <div className="px-6 py-4">
              {isAdding ? (
                <TrackerPlanForm
                  submitLabel="Add plan"
                  isPending={createPlan.isPending}
                  autoFocus
                  onCancel={() => setIsAdding(false)}
                  onSubmit={async (plan) => {
                    await createPlan.mutateAsync({ publicId: tracker.publicId, plan });
                    setIsAdding(false);
                  }}
                />
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="-ml-3"
                  onClick={() => setIsAdding(true)}
                >
                  <Plus />
                  Add a plan
                </Button>
              )}
            </div>
          </>
        )}
      </section>

      <section>
        <SectionHeading
          title="Moments"
          meta={momentsPending || momentsError ? undefined : String(moments.length)}
        />
        {momentsPending ? (
          <p className="px-6 py-5 text-sm text-muted-foreground">Loading moments…</p>
        ) : momentsError ? (
          <p className="px-6 py-5 text-sm text-destructive">Failed to load moments.</p>
        ) : moments.length === 0 ? (
          <p className="px-6 py-5 text-sm text-muted-foreground">
            Nothing captured in this window.
          </p>
        ) : (
          <ul className="flex flex-col">
            {moments.map((moment) => {
              const isHeld = moment.momentOutcome === Schemas.TrackerMomentOutcomeIntEnum.Held;
              return (
                <li
                  key={moment.publicId}
                  className="flex items-start justify-between gap-4 border-b border-border px-6 py-3"
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <p className="text-sm">
                      <span
                        className={cn(
                          "mr-2 inline-block rounded-full px-2 py-0.5 text-xs",
                          isHeld ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                        )}
                      >
                        {isHeld ? words.held : words.slipped}
                      </span>
                      {moment.plan?.cue ?? (
                        <span className="text-muted-foreground italic">Not sure</span>
                      )}
                    </p>
                    {moment.note ? (
                      <p className="text-xs text-muted-foreground">{moment.note}</p>
                    ) : null}
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {formatMomentTime(moment.occurredAt)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Remove this moment"
                    disabled={deleteMoment.isPending}
                    onClick={() =>
                      deleteMoment.mutate({
                        publicId: tracker.publicId,
                        momentPublicId: moment.publicId,
                      })
                    }
                  >
                    <Trash />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
