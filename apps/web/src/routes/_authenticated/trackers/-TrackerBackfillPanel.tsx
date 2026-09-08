import { X } from "@phosphor-icons/react";
import { Button } from "@/shadcn/ui/button";
import type * as Schemas from "@app/schemas";
import { useQuickAdd } from "./-data";
import { renderControl } from "./-TrackerRow";
import { TrackerEntryList } from "./-TrackerEntryList";
import { formatDayLabel, formatMetricValue } from "./-utils";

// DEV_NOTE: the write half of the heatmap. A cell used to be a fact you could only read; clicking
// one now opens the same seven controls the Today screen renders, pointed at that day instead of
// this one — which is the whole of "log a habit for a past date". The engine already accepted any
// date (ControlHandlers' entryMode gate is the only rule), so nothing here is a new write path: it
// is the existing quick-add with a different `date`.
//
// DEV_NOTE: deliberately not a modal — there is no dialog primitive in src/shadcn/ui, and a day's
// entries are worth reading *beside* the grid they came from rather than on top of it. It renders
// as one more full-width section, in the page's own px-6 py-5 rhythm.
interface TrackerBackfillPanelProps {
  tracker: Schemas.TrackerApiShape;
  // The clicked day, straight off the heatmap — `sum` is the server's own figure for it, computed
  // with the metric's aggregation, so the control shows the same number the cell was scored on.
  day: Schemas.TrackerHeatmapDay;
  entries: Schemas.TrackerEntryApiShape[];
  isPending: boolean;
  isError: boolean;
  onClose: () => void;
}

export function TrackerBackfillPanel({
  tracker,
  day,
  entries,
  isPending,
  isError,
  onClose,
}: TrackerBackfillPanelProps) {
  const quickAdd = useQuickAdd();
  const primaryMetric =
    tracker.metricDetails.find((detail) => detail.key === tracker.primaryMetricKey) ?? null;

  return (
    <section className="border-b border-border">
      <div className="flex items-center justify-between gap-4 border-b border-border px-6 py-2.5">
        <p className="text-[10px] font-medium tracking-widest text-muted-foreground uppercase">
          Log · {formatDayLabel(day.localDate)}
        </p>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground tabular-nums">
            {primaryMetric
              ? formatMetricValue(day.sum, primaryMetric.semanticType, primaryMetric.canonicalUnit)
              : (day.sum ?? "—")}
            {day.target !== null ? ` / ${day.target}` : ""}
          </span>
          <Button variant="ghost" size="icon-sm" aria-label="Close day" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>
      </div>

      {/* DEV_NOTE: the control waits for the day's entries rather than rendering against a guess.
          A toggle's button reads "Done" or "Mark done" off the day's entry count, and showing the
          wrong one for the length of a request is worse than showing nothing: the first tap on a
          mislabelled button clears a day the user meant to fill. */}
      {isPending ? (
        <p className="px-6 py-5 text-sm text-muted-foreground">Loading this day…</p>
      ) : isError ? (
        <p className="px-6 py-5 text-sm text-destructive">Failed to load this day.</p>
      ) : (
        <>
          <div className="px-6 py-5">
            {renderControl(tracker.manifest.control, {
              tracker,
              localDate: day.localDate,
              daySum: day.sum,
              dayCount: entries.length,
              // A running session belongs to the present, never to a day being filled in later.
              openSession: null,
              isPending: quickAdd.isPending,
              onQuickAdd: (payload) => quickAdd.mutate({ publicId: tracker.publicId, payload }),
            })}
          </div>

          {entries.length === 0 ? (
            <p className="border-t border-border px-6 py-5 text-sm text-muted-foreground">
              Nothing logged this day.
            </p>
          ) : (
            <div className="border-t border-border">
              <TrackerEntryList entries={entries} tracker={tracker} />
            </div>
          )}
        </>
      )}
    </section>
  );
}
