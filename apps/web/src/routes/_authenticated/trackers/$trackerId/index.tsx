import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/tanstack-react-start";
import { Button } from "@/shadcn/ui/button";
import { TrackersQueries, useArchiveTracker, useRunCompute } from "../-data";
import TrackerHeatmap from "../-TrackerHeatmap";
import { TrackerBackfillPanel } from "../-TrackerBackfillPanel";
import { TrackerDailyBars } from "../-TrackerDailyBars";
import { TrackerEntryList } from "../-TrackerEntryList";
import { deriveTrackerStats, TrackerStatStrip } from "../-TrackerStatStrip";
import { TransferForm } from "../-TransferForm";
import {
  addDaysToLocalDate,
  describeSchedule,
  formatDuration,
  formatMetricValue,
  getTodayLocalDate,
} from "../-utils";

// DEV_NOTE: one detail page for every tracker — the heatmap, streak, entry log and breakdown are
// all generic reads now. What used to be three domain pages differs here only in which sections
// apply: an interval tracker gets the breakdown, a compute tracker gets its module's form.
//
// DEV_NOTE: full-bleed, matching -TrackerForm.tsx — a centred max-w column left two empty margins
// the width of the content itself on a desktop window, and the panels here (a year of history, a
// log) are exactly the kind that get better with the space. Sections are separated by full-width
// rules with px-6 py-5 cells inside them, which is the form's rhythm, so the two screens read as
// one app rather than two.
export const Route = createFileRoute("/_authenticated/trackers/$trackerId/")({
  component: TrackerDetailPage,
});

// DEV_NOTE: 52 weeks, not the mockup's 17 — the mockup is a phone. A year's grid fills the width a
// desktop actually has, and it's what makes "best streak" and the completion rate worth printing:
// over four months both are mostly a statement about how recently the tracker was created.
const HEATMAP_WINDOW_DAYS = 364;
const BREAKDOWN_WINDOW_DAYS = 30;

// The point at which the heatmap has enough marks on it to show a pattern rather than a receipt.
const PATTERN_THRESHOLD_DAYS = 21;

function formatActiveFrom(localDate: string): string {
  return new Date(`${localDate}T00:00:00.000Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

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

function TrackerDetailPage() {
  const { trackerId } = Route.useParams();
  const { getToken } = useAuth();
  const navigate = useNavigate();
  const runCompute = useRunCompute();
  const archiveTracker = useArchiveTracker();

  const today = getTodayLocalDate();
  const heatmapFrom = addDaysToLocalDate(today, -(HEATMAP_WINDOW_DAYS - 1));
  const breakdownFrom = addDaysToLocalDate(today, -(BREAKDOWN_WINDOW_DAYS - 1));

  // The heatmap cell the user opened for logging — null until one is clicked.
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const trackerQuery = useQuery(TrackersQueries.detail(trackerId, getToken));
  const heatmapQuery = useQuery(TrackersQueries.heatmap(trackerId, heatmapFrom, today, getToken));
  const entriesQuery = useQuery(TrackersQueries.entries(trackerId, breakdownFrom, today, getToken));
  const tracker = trackerQuery.data?.tracker;
  const isInterval = tracker?.manifest.control === "timer";
  // DEV_NOTE: a one-day slice rather than a filter over the 30-day log above — the backfill panel
  // reaches a year back, well past that window, and a day it can't see is a day whose control would
  // render against an empty count.
  const selectedDayQuery = useQuery({
    ...TrackersQueries.entries(trackerId, selectedDate ?? today, selectedDate ?? today, getToken),
    enabled: selectedDate !== null,
  });
  const breakdownQuery = useQuery({
    ...TrackersQueries.breakdown(trackerId, breakdownFrom, today, "project", getToken),
    enabled: isInterval,
  });

  if (trackerQuery.isPending) {
    return <div className="px-6 py-8 text-muted-foreground">Loading tracker…</div>;
  }
  if (trackerQuery.isError || !tracker) {
    return <div className="px-6 py-8 text-destructive">Failed to load tracker.</div>;
  }

  const entries = entriesQuery.data?.entries ?? [];
  const days = heatmapQuery.data?.days ?? [];
  const stats = deriveTrackerStats(days);
  const primaryMetric =
    tracker.metricDetails.find((detail) => detail.key === tracker.primaryMetricKey) ?? null;

  // DEV_NOTE: the % and best-streak cells claim "since active" only when the window actually
  // reaches back past the day the tracker started — otherwise they are a slice, and say so.
  const coversStart = heatmapFrom <= tracker.activeFrom;

  // DEV_NOTE: the two cases the engine refuses a past date, checked here so the grid never offers a
  // click whose write would come back a 400: a "live" tracker accepts today only (ControlHandlers'
  // entryMode gate), and a timer's session is always stamped with the server's own clock.
  const canBackfill = tracker.manifest.entryMode === "retro" && !isInterval;
  const selectedDay = selectedDate
    ? (days.find((day) => day.localDate === selectedDate) ?? null)
    : null;

  // Two facts about the grid, both worth saying under it: which days it couldn't cover, and
  // whether the ones it did are clickable.
  const heatmapNote = [
    coversStart
      ? `Tracker started ${formatActiveFrom(tracker.activeFrom)} — earlier days are not scheduled.`
      : null,
    canBackfill ? "Click a day to log it." : "This tracker only accepts entries for today.",
  ]
    .filter(Boolean)
    .join(" ");

  const eyebrow = [
    tracker.manifest.control.replace("_", " "),
    describeSchedule(tracker.manifest.schedule),
    tracker.manifest.target !== null && primaryMetric
      ? `target ${formatMetricValue(
          tracker.manifest.target,
          primaryMetric.semanticType,
          primaryMetric.canonicalUnit,
        )}`
      : null,
    `active from ${formatActiveFrom(tracker.activeFrom)}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-6 py-8">
        <div className="flex min-w-0 items-start gap-3">
          {tracker.icon ? (
            <span className="flex size-9 shrink-0 items-center justify-center rounded-sm border border-border text-lg">
              {tracker.icon}
            </span>
          ) : null}
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
              {eyebrow}
            </p>
            <h1 className="font-heading truncate text-3xl font-semibold">{tracker.name}</h1>
          </div>
        </div>

        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate({ to: "/trackers" })}>
            Back
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link to="/trackers/$trackerId/edit" params={{ trackerId }}>
              Edit
            </Link>
          </Button>
          {/* DEV_NOTE: archiving is reversible from /archived, so it asks for no confirmation —
              but it does leave the page, since the thing this page is about is no longer in the
              list the user came from. */}
          <Button
            variant="destructive"
            size="sm"
            disabled={archiveTracker.isPending}
            onClick={() =>
              archiveTracker.mutate(tracker.publicId, {
                onSuccess: () => navigate({ to: "/trackers" }),
              })
            }
          >
            Archive
          </Button>
        </div>
      </header>

      {heatmapQuery.isError ? (
        <p className="border-b border-border px-6 py-5 text-sm text-destructive">
          Failed to load history.
        </p>
      ) : (
        <TrackerStatStrip
          stats={stats}
          streak={heatmapQuery.data?.streak ?? 0}
          windowDays={HEATMAP_WINDOW_DAYS}
          coversStart={coversStart}
          isPending={heatmapQuery.isPending}
        />
      )}

      {/* DEV_NOTE: the two columns run to the bottom of the viewport (flex-1 on the grid) so the
          rule between them is a full-height division of the page rather than a line that stops
          wherever the shorter column ran out of content. */}
      <div className="grid flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col border-border lg:border-r">
          <section>
            {heatmapQuery.isPending ? (
              <p className="px-6 py-5 text-sm text-muted-foreground">Loading history…</p>
            ) : heatmapQuery.isError ? (
              <p className="px-6 py-5 text-sm text-destructive">Failed to load history.</p>
            ) : (
              <TrackerHeatmap
                days={days}
                note={heatmapNote}
                onSelectDay={canBackfill ? setSelectedDate : undefined}
                selectedDate={selectedDate}
              />
            )}
          </section>

          {selectedDay ? (
            <TrackerBackfillPanel
              tracker={tracker}
              day={selectedDay}
              entries={selectedDayQuery.data?.entries ?? []}
              isPending={selectedDayQuery.isPending}
              isError={selectedDayQuery.isError}
              onClose={() => setSelectedDate(null)}
            />
          ) : null}

          {heatmapQuery.isSuccess && tracker.manifest.control !== "toggle" ? (
            <TrackerDailyBars days={days} metric={primaryMetric} target={tracker.manifest.target} />
          ) : null}

          {tracker.manifest.compute === "money.transfer.v1" ? (
            <section>
              <SectionHeading title="Transfer between accounts" />
              <div className="border-b border-border px-6 py-5">
                <TransferForm
                  onSubmit={async (payload) => {
                    await runCompute.mutateAsync({
                      publicId: tracker.publicId,
                      compute: { key: "money.transfer.v1", payload },
                    });
                  }}
                />
              </div>
            </section>
          ) : null}

          {isInterval ? (
            <section>
              <SectionHeading title="Breakdown" meta={`last ${BREAKDOWN_WINDOW_DAYS} days`} />
              {breakdownQuery.isPending ? (
                <p className="px-6 py-5 text-sm text-muted-foreground">Loading breakdown…</p>
              ) : breakdownQuery.isError ? (
                <p className="px-6 py-5 text-sm text-destructive">Failed to load breakdown.</p>
              ) : (breakdownQuery.data?.rows ?? []).length === 0 ? (
                <p className="px-6 py-5 text-sm text-muted-foreground">
                  Nothing logged in this window.
                </p>
              ) : (
                <div className="flex flex-col">
                  {(breakdownQuery.data?.rows ?? []).map((row) => (
                    <div
                      key={`${row.label ?? "unlabelled"}-${row.entityPublicId ?? "none"}`}
                      className="flex items-center justify-between gap-4 border-b border-border px-6 py-3 text-sm"
                    >
                      <span className="truncate">{row.label ?? "Unlabelled"}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {row.entryCount}× · {formatDuration(row.total)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          ) : null}
        </div>

        {/* DEV_NOTE: the log is a column beside the history on wide screens and a section under it
            on narrow ones — the two answer different questions about the same days, and reading
            one while the other is off-screen is what the old stacked-card layout forced. */}
        <aside className="flex flex-col">
          <SectionHeading
            title={`Entries · last ${BREAKDOWN_WINDOW_DAYS} days`}
            meta={entriesQuery.isSuccess ? String(entries.length) : undefined}
          />

          {entriesQuery.isPending ? (
            <p className="px-6 py-5 text-sm text-muted-foreground">Loading entries…</p>
          ) : entriesQuery.isError ? (
            <p className="px-6 py-5 text-sm text-destructive">Failed to load entries.</p>
          ) : entries.length === 0 ? (
            <p className="px-6 py-5 text-sm text-muted-foreground">
              Nothing logged in this window.
            </p>
          ) : (
            <TrackerEntryList entries={entries} tracker={tracker} />
          )}

          {/* DEV_NOTE: shown only until the history is long enough to read — it explains why the
              grid beside it looks empty, which is the question a three-day-old tracker provokes. */}
          {heatmapQuery.isSuccess && stats.daysLogged < PATTERN_THRESHOLD_DAYS ? (
            <p className="px-6 py-5 text-sm leading-relaxed text-muted-foreground">
              A three-week record is where the heatmap starts telling you something. Until then
              it&apos;s a receipt.
            </p>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
