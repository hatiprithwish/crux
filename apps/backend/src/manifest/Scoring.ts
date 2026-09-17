import type * as Schemas from "@app/schemas";

// DEV_NOTE: extracted from TrackersRepo (PR 4) so NotificationsRepo's streak digest can score
// "is this tracker still open today" without a Repo→Repo import — the layer rule forbids Repos
// calling each other, and both need the exact same not_active/not_scheduled/no_data/partial/met
// judgement the heatmap already makes. TrackersRepo now delegates here; nothing about how a day is
// scored changed in this extraction, only where the code lives.

export function addDays(localDate: string, delta: number): string {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

function dayOfWeek(localDate: string): number {
  return new Date(`${localDate}T00:00:00.000Z`).getUTCDay();
}

function daysBetween(fromLocalDate: string, toLocalDate: string): number {
  const from = new Date(`${fromLocalDate}T00:00:00.000Z`).getTime();
  const to = new Date(`${toLocalDate}T00:00:00.000Z`).getTime();
  return Math.round((to - from) / (1000 * 60 * 60 * 24));
}

// DEV_NOTE: a "times_per_week" schedule names a count, not days — so every day is an opportunity
// and none is a miss. Returning true here is what keeps invariant 7 honest for that shape: an
// unlogged day renders as no-data, never as a failure.
//
// DEV_NOTE: `activeFrom` is "every_n_days"'s anchor (day 0), not a field on the schedule itself —
// see ZTrackerSchedule's DEV_NOTE. A date before activeFrom can go negative here; dayState already
// short-circuits to "not_active" before calling this, and the modulo of a negative still lands on
// 0 for exact multiples, so nothing downstream needs to guard against it.
export function isScheduled(
  localDate: string,
  schedule: Schemas.TrackerSchedule,
  activeFrom: string,
): boolean {
  if (schedule.type === "days_of_week") return schedule.days.includes(dayOfWeek(localDate));
  if (schedule.type === "every_n_days") {
    return daysBetween(activeFrom, localDate) % schedule.intervalDays === 0;
  }
  return true;
}

// DEV_NOTE: the fix for "raising a target rescored every day I'd already lived" — a target is a
// value *from a date*, and this resolves which one was in force on the day being scored. Rows
// arrive ascending (TrackersDAL orders them), so the last one that has started is the one in force.
// Walked backwards because the recent end is where every read lands. A day earlier than every row
// resolves to null, not the oldest row — null means "no target then", which dayState already scores
// as met for any logged day.
export function resolveTargetAt(
  targets: Schemas.TrackerTarget[],
  localDate: string,
): number | null {
  for (let index = targets.length - 1; index >= 0; index--) {
    if (targets[index].effectiveFrom <= localDate) return targets[index].target;
  }
  return null;
}

// DEV_NOTE: `target` is passed in rather than read off the manifest — it is the target that was in
// force on `localDate` (resolveTargetAt), not the one configured today. architecture.md §6's scoring
// rule, unchanged by this extraction.
export function dayState(
  localDate: string,
  sums: Map<string, number>,
  tracker: Pick<Schemas.Tracker, "activeFrom" | "manifest">,
  target: number | null,
): Schemas.TrackerDayState {
  if (localDate < tracker.activeFrom) return "not_active";
  if (!isScheduled(localDate, tracker.manifest.schedule, tracker.activeFrom))
    return "not_scheduled";
  if (!sums.has(localDate)) return "no_data";

  // DEV_NOTE: a neutral tracker states there is no better side to be on, so a logged day is met and
  // nothing is scored against the target, exactly as a tracker with no target at all. Direction is
  // read live, unlike the target — raising a goal opens a new chapter, so the old one keeps its old
  // bar, but flipping direction says the number always meant the opposite of what was stored.
  const direction = tracker.manifest.direction ?? "higher_better";
  if (target === null || direction === "neutral") return "met";

  const sum = sums.get(localDate) as number;
  const met = direction === "lower_better" ? sum <= target : sum >= target;
  return met ? "met" : "partial";
}

// DEV_NOTE: invariant 8 — streaks count through yesterday; today only extends the streak if already
// met (an unmet today doesn't break it, since the day isn't over). Unscheduled days are skipped
// rather than counted or broken on (architecture.md §6 "skip unscheduled days").
export function computeStreak(
  sums: Map<string, number>,
  tracker: Pick<Schemas.Tracker, "activeFrom" | "manifest">,
  targets: Schemas.TrackerTarget[],
  today: string,
): number {
  const stateOn = (date: string) => dayState(date, sums, tracker, resolveTargetAt(targets, date));

  let streak = stateOn(today) === "met" ? 1 : 0;
  let cursor = addDays(today, -1);

  while (cursor >= tracker.activeFrom) {
    const state = stateOn(cursor);
    if (state === "not_scheduled") {
      cursor = addDays(cursor, -1);
      continue;
    }
    if (state !== "met") break;
    streak++;
    cursor = addDays(cursor, -1);
  }

  return streak;
}
