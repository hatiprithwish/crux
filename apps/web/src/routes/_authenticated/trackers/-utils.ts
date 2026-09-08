import type * as Schemas from "@app/schemas";

// DEV_NOTE: no per-user timezone preference exists anywhere in the app yet — dates are UTC-based
// end to end (frontend and backend both), consistent with how the backend computes localDate.
export function getTodayLocalDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDaysToLocalDate(localDate: string, delta: number): string {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

// 0 = Sunday ... 6 = Saturday, matching the GitHub-style heatmap grid's week layout.
export function dayOfWeek(localDate: string): number {
  return new Date(`${localDate}T00:00:00.000Z`).getUTCDay();
}

export function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

// DEV_NOTE: currency_minor metrics store minor units (paise/cents) — display divides by 100, the
// inverse of what the amount pad does on submit. Canonical units are stored, never display units
// (invariant 2).
export function formatMinorAmount(amountMinor: number, currency?: string | null): string {
  const major = (amountMinor / 100).toFixed(2);
  return currency ? `${currency} ${major}` : major;
}

export const CONTROL_LABELS: Record<Schemas.Control, string> = {
  toggle: "Toggle — done / not done",
  increment: "Increment — one tap adds a step",
  stepper: "Stepper — add or subtract steps",
  daily_total: "Daily total — set the day's number",
  timer: "Timer — start and stop a session",
  amount_pad: "Amount pad — money-style amount entry",
  form: "Form — several readings at once",
};

// DEV_NOTE: the tile grid is not a list of controls — it is a list of *shapes a tracker can take*,
// and "Transfer" is the one shape that isn't a control at all. A transfer is amount_pad plus the
// money.transfer.v1 compute module (ComputeCommon.ts: the only thing the seven controls
// demonstrably could not express). Making it a tile rather than an eighth ZControl member keeps
// that fact in the presentation layer, where it belongs, instead of forking the write path.
export interface ControlTile {
  key: string;
  label: string;
  hint: string;
  control: Schemas.Control;
  compute: Schemas.ComputeKey | null;
}

export const CONTROL_TILES: ControlTile[] = [
  { key: "toggle", label: "Toggle", hint: "done / not done", control: "toggle", compute: null },
  {
    key: "increment",
    label: "Increment",
    hint: "tap to add one",
    control: "increment",
    compute: null,
  },
  { key: "stepper", label: "Stepper", hint: "+ / − a count", control: "stepper", compute: null },
  {
    key: "daily_total",
    label: "Daily total",
    hint: "one number a day",
    control: "daily_total",
    compute: null,
  },
  { key: "timer", label: "Timer", hint: "start / stop a session", control: "timer", compute: null },
  {
    key: "amount_pad",
    label: "Amount",
    hint: "money keypad",
    control: "amount_pad",
    compute: null,
  },
  { key: "form", label: "Form", hint: "several fields", control: "form", compute: null },
  {
    key: "transfer",
    label: "Transfer",
    hint: "between accounts",
    control: "amount_pad",
    compute: "money.transfer.v1",
  },
];

// DEV_NOTE: a metric's six fields are not six independent decisions — five of them follow from the
// control the moment it's picked. A toggle writes a boolean summed per day; a timer writes seconds.
// Deriving them is what lets the form ask for a name and a control and nothing else, while the
// Change panel keeps every field reachable for the cases the derivation guesses wrong (a daily_total
// tracking body weight wants mass_grams, not count).
//
// DEV_NOTE: units match what the backend already stores for each shape — see the domain tests
// (money.test.ts "currency_minor", time.test.ts "seconds", trackers.test.ts "boolean" / "count").
// Canonical units are stored, never display units (invariant 2).
// DEV_NOTE: `direction` is not derived here any more — it moved onto the tracker's manifest, and
// the form asks for it directly next to the target it is scored against (see DIRECTION_HINT).
// What's left is the shape of the *quantity*, which really is the control's consequence.
export type DerivedMetricShape = Pick<
  Schemas.MetricBase,
  "semanticType" | "canonicalUnit" | "defaultAgg" | "dateAttribution"
>;

export function deriveMetricShape(control: Schemas.Control): DerivedMetricShape {
  const base = { defaultAgg: "sum", dateAttribution: "start" } as const;

  switch (control) {
    case "toggle":
      return { ...base, semanticType: "boolean", canonicalUnit: "boolean" };
    case "timer":
      return { ...base, semanticType: "duration_seconds", canonicalUnit: "seconds" };
    case "amount_pad":
      return { ...base, semanticType: "currency_minor", canonicalUnit: "currency_minor" };
    case "increment":
    case "stepper":
    case "daily_total":
    case "form":
      return { ...base, semanticType: "count", canonicalUnit: "count" };
  }
}

// DEV_NOTE: a control implies which way a tracker usually points, but only as a starting value the
// user can overrule — an amount pad is spending far more often than income, and a timer is time
// spent on something wanted far more often than time to be capped. Separate from
// deriveMetricShape because this seeds a *manifest* field, not a metric one.
export function deriveDirection(control: Schemas.Control): Schemas.Direction {
  return control === "amount_pad" ? "lower_better" : "higher_better";
}

// DEV_NOTE: five of the eleven semantic types name their own unit, and asking for it twice is how
// the form ended up able to store `duration_seconds` measured in "count". A type in this map locks
// the unit field; everything else still needs the answer, because `count` of what (reps, pages,
// cups) and which currency are real questions the type can't answer.
export const UNIT_FOR_SEMANTIC_TYPE: Partial<Record<Schemas.SemanticType, string>> = {
  duration_seconds: "seconds",
  mass_grams: "grams",
  volume_ml: "ml",
  energy_kcal: "kcal",
  distance_m: "metres",
  rating_1_5: "rating",
  boolean: "boolean",
};

export const UNIT_PLACEHOLDER: Partial<Record<Schemas.SemanticType, string>> = {
  count: "reps",
  currency_minor: "INR",
};

// DEV_NOTE: metrics are unique per (user_id, key), and TrackersRepo.createTracker reuses an existing
// metric whose key matches rather than rejecting it. Slugging the tracker's name into the key is
// what makes that reuse land on the right rows: two trackers both called "Pushups" roll into one
// number, while "Take a bath" and "Meditate" stay apart despite both being booleans. Matching on
// semanticType instead would merge every boolean habit a user has, which is data corruption wearing
// a convenience hat.
export function slugifyMetricKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export const SEMANTIC_TYPE_LABELS: Record<Schemas.SemanticType, string> = {
  duration_seconds: "duration_seconds",
  count: "count",
  currency_minor: "currency_minor",
  mass_grams: "mass_grams",
  volume_ml: "volume_ml",
  energy_kcal: "energy_kcal",
  distance_m: "distance_m",
  rating_1_5: "rating_1_5",
  boolean: "boolean",
  text: "text",
  json: "json",
};

// DEV_NOTE: labelled by what the target *is* rather than by the enum member's own wording — the
// question a user is answering here is "is this number a floor or a ceiling?", and "neutral" only
// makes sense once it's said as the third answer to that question: neither.
export const DIRECTION_LABELS: Record<Schemas.Direction, string> = {
  higher_better: "more is better",
  lower_better: "less is better",
  neutral: "just tracking",
};

export const DIRECTION_HINTS: Record<Schemas.Direction, string> = {
  higher_better: "The target is a floor. A day at or above it counts, and streaks build on it.",
  lower_better: "The target is a ceiling. A day at or below it counts — a cap, not a goal.",
  neutral: "No good or bad side. Days are recorded, never scored, and no streak runs.",
};

// Shown under the Info icon beside the Direction field.
export const DIRECTION_HELP =
  "Direction is how a day gets scored against its target — and whether a change is read as progress. " +
  "It sits on the tracker, not the metric, because the same measure points different ways for " +
  "different habits: minutes of meditation are worth raising, minutes of doomscrolling are worth " +
  "cutting, and both can share one “minutes” metric so their totals still roll up together.";

export const AGG_LABELS: Record<Schemas.DefaultAgg, string> = {
  sum: "summed per day",
  avg: "averaged per day",
  last: "last value of the day",
  max: "highest of the day",
  min: "lowest of the day",
};

// DEV_NOTE: "Today · 4 Sep 2026" in the design — the word matters more than the date, so the label
// says which of the two it is rather than making the reader compare a date against their own idea
// of today.
export function formatStartDate(localDate: string): string {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  const formatted = date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  return localDate === getTodayLocalDate() ? `Today · ${formatted}` : formatted;
}

// DEV_NOTE: entry_role and entity_kind share five names (architecture.md §3) — an entity of kind
// "project" links through role "project". "goal" entities have no role, so they're not linkable.
export const LINKABLE_KINDS: Schemas.EntryRole[] = ["project", "person", "place", "account", "tag"];

export function describeSchedule(schedule: Schemas.TrackerSchedule): string {
  if (schedule.type === "daily") return "Every day";
  if (schedule.type === "times_per_week") return `${schedule.count}× per week`;
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return schedule.days.map((day) => names[day]).join(", ");
}
