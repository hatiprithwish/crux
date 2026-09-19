// DEV_NOTE: the owner's users.tz, pushed in as soon as /users/me resolves (see UsersQueries). Null
// means "not known yet" and falls back to the device's own zone, which is right for anyone whose
// saved zone matches where they actually are. The backend resolves entries.local_date from the same
// users.tz, so "today" agrees on both sides.
let activeTimeZone: string | null = null;

export function setActiveTimeZone(tz: string | null): void {
  activeTimeZone = tz;
}

export function getLocalDateOf(instant: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: activeTimeZone ?? undefined,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}
