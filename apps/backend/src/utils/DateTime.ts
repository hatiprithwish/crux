// DEV_NOTE: two differently-named functions on purpose — see architecture.md §4 invariant 4.
// `users.tz` decides WHEN to fire a reminder (localHourIn/localDateIn). UTC decides WHICH day's
// data a write/read lands on (utcDateString) — every entries.local_date and daily_facts.local_date
// row is keyed by a UTC day, independent of the owner's timezone. Conflating the two means a
// reminder fires at the right wall-clock hour but reads the wrong day's facts, or vice versa.

// DEV_NOTE: the day key the WRITE path uses — TrackersRepo.todayLocalDate() and every entries/
// daily_facts row. Never pass a user's tz in here; that's localDateIn.
export function utcDateString(at: Date): string {
  return at.toISOString().slice(0, 10);
}

// DEV_NOTE: hourCycle: "h23", not hour12: false — the latter yields "24" at midnight under some
// ICU builds, which is not a valid Date hour and breaks the dispatcher's bucket-by-hour join.
function partsIn(tz: string, at: Date): Record<string, string> {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  });
  return Object.fromEntries(formatter.formatToParts(at).map((part) => [part.type, part.value]));
}

// Scheduling only — never a lookup key. Returns 0-23.
export function localHourIn(tz: string, at: Date): number {
  return Number(partsIn(tz, at).hour);
}

export function localDateIn(tz: string, at: Date): string {
  const parts = partsIn(tz, at);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// DEV_NOTE: try/catch around constructing a formatter (RangeError on an unknown zone), not
// Intl.supportedValuesOf — that raises a runtime-availability question in the Worker this doesn't
// need to answer just to validate a string the client already picked from that same list.
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
