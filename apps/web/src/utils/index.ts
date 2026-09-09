export default class Utilities {
  static getInitials(name: string): string {
    return name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() ?? "")
      .join("");
  }

  // DEV_NOTE: DD-MM-YYYY is the app's one full-date format — every place that prints a complete
  // date goes through here, so the format is changed in one edit rather than seven. Sliced off the
  // "YYYY-MM-DD" string rather than parsed into a Date on purpose: a localDate is already a
  // calendar day, and re-parsing it only creates the chance of a timezone rolling it to the
  // adjacent one (the UTC-throughout note in trackers/-utils.ts).
  //
  // DEV_NOTE: partial and relative labels are deliberately NOT this — "Today", "Yesterday", a
  // weekday, a heatmap's month axis. A reader placing one day among others wants the word; a
  // reader recording when something happened wants the date.
  static formatFullDate(localDate: string): string {
    return `${localDate.slice(8, 10)}-${localDate.slice(5, 7)}-${localDate.slice(0, 4)}`;
  }

  // A stored timestamp (archivedAt, occurredAt) rendered as the calendar day it fell on. UTC, for
  // the same reason as above — the app has no per-user timezone preference yet.
  static formatTimestampDate(value: Date | string): string {
    return Utilities.formatFullDate(new Date(value).toISOString().slice(0, 10));
  }
}
