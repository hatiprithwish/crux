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

// DEV_NOTE: entry_role and entity_kind share five names (architecture.md §3) — an entity of kind
// "project" links through role "project". "goal" entities have no role, so they're not linkable.
export const LINKABLE_KINDS: Schemas.EntryRole[] = ["project", "person", "place", "account", "tag"];

export function describeSchedule(schedule: Schemas.TrackerSchedule): string {
  if (schedule.type === "daily") return "Every day";
  if (schedule.type === "times_per_week") return `${schedule.count}× per week`;
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return schedule.days.map((day) => names[day]).join(", ");
}
