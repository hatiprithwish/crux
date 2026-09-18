import type * as Schemas from "@app/schemas";
import { DIRECTION_LABELS, describeSchedule } from "./-utils";

// DEV_NOTE: a static mirror of TrackerRow, deliberately not TrackerRow itself. The real row is wired
// to useQuickAdd and an archive mutation — rendering it here would mean a half-built tracker with no
// publicId holding live mutation handles. What the reader needs is the shape, and the shape is all
// this draws.
//
// DEV_NOTE: the second panel is the honest half. Creating a tracker silently mints or reuses a
// metric, which is user-global and permanent (architecture.md §5) — the one side effect in this form
// a user cannot see or undo from the Today screen afterwards. Showing the six fields as they will be
// written is what makes "declared automatically from the control" a statement rather than a promise.

// DEV_NOTE: no `direction` — it is a manifest field now, not a metric one, so it belongs with the
// schedule and the control in the first panel rather than in the list of what a metric row will
// hold. Keeping it here would have gone on telling the reader it was part of the permanent,
// user-global side effect this panel exists to disclose.
interface PreviewMetric {
  key: string;
  semanticType: Schemas.SemanticType;
  canonicalUnit: string;
  defaultAgg: Schemas.DefaultAgg;
}

interface TrackerPreviewProps {
  name: string;
  icon: string | null;
  control: Schemas.Control;
  schedule: Schemas.TrackerSchedule;
  direction: Schemas.Direction;
  metric: PreviewMetric;
  isExistingMetric: boolean;
}

const ACTION_LABELS: Record<Schemas.Control, string> = {
  toggle: "Mark done",
  increment: "+1",
  stepper: "+ / −",
  daily_total: "Set total",
  timer: "Start",
  amount_pad: "Add amount",
  form: "Log",
};

export function TrackerPreview({
  name,
  icon,
  control,
  schedule,
  direction,
  metric,
  isExistingMetric,
}: TrackerPreviewProps) {
  const rows: [string, string][] = [
    ["metric key", metric.key],
    ["semantic type", metric.semanticType],
    ["canonical unit", metric.canonicalUnit],
    ["aggregation", metric.defaultAgg],
    // DEV_NOTE: constant, not derived — daily_facts is keyed on (user_id, metric_id, local_date),
    // so every metric this form can declare is written at exactly this grain.
    ["grain", "user_id, local_date"],
  ];

  return (
    <div className="flex flex-col">
      <section className="border-b border-border px-6 py-5">
        <h2 className="text-2xs font-medium tracking-widest text-muted-foreground uppercase">
          How it will look on Today
        </h2>

        <div className="mt-4 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            {/* DEV_NOTE: the icon lives *in* the square rather than beside it — the square is the
                tracker's mark on the row, and an icon sitting next to an empty box reads as two
                separate things when it is one. Empty when no icon is picked, so the name column
                starts at the same x whether a row has one or not. */}
            <div className="flex size-8 shrink-0 items-center justify-center rounded-sm border border-border text-base">
              {icon}
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-base font-medium">
                {name.trim() === "" ? (
                  <span className="text-muted-foreground">Untitled tracker</span>
                ) : (
                  name
                )}
              </span>
              <span className="text-xs text-muted-foreground">
                {describeSchedule(schedule).toLowerCase()} · {control} ·{" "}
                {DIRECTION_LABELS[direction]}
              </span>
            </div>
          </div>
          <span className="text-xs font-medium tracking-wider text-primary uppercase">
            {ACTION_LABELS[control]}
          </span>
        </div>
      </section>

      <section className="border-b border-border px-6 py-5">
        <h2 className="text-2xs font-medium tracking-widest text-muted-foreground uppercase">
          {isExistingMetric ? "What it writes into" : "What gets written"}
        </h2>

        <dl className="mt-4 flex flex-col gap-2">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-baseline justify-between gap-4">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="text-right font-mono text-xs">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <p className="px-6 py-5 text-sm leading-relaxed text-muted-foreground">
        {isExistingMetric
          ? "This tracker points at a metric you already defined, so its readings roll into the same number every other tracker on that metric contributes to."
          : "Every field is still reachable — the six metric fields just derive from the control you picked, and only appear if you press Change. A boolean habit shouldn't ask you about canonical units."}
      </p>
    </div>
  );
}
