import { z } from "zod";
import { ZEntryKind, ZEntryRole, ZSemanticType } from "./DomainEnums";

// DEV_NOTE: thinking.md Decision 2 — the observation log is the only authority, and nothing owns an
// observation except the user. An `event` is the grouping row (what used to be `entries`): one tap,
// one meal, one closed timer session. Each reading inside it is an `observation` keyed to
// (user, local_date) on its own, so a metric's history is a flat scan that never has to walk back
// through a tracker. daily_facts is still a derived, disposable cache written only by
// ObservationsDAL and rebuildable by replaying observations.
//
// DEV_NOTE: `trackerId` on an event records which saved configuration wrote it, for "clear this
// tracker's day" and the entry list — it is provenance, not ownership. Deleting or re-planning a
// tracker never has to decide what happens to the facts.

export const ZEventBase = z.object({
  kind: ZEntryKind.default("point"),
  utcInstant: z.date(),
  endedAt: z.date().nullable().optional(), // closed intervals only — a running timer is a session
  localDate: z.string(), // YYYY-MM-DD, resolved at write time
  tz: z.string(), // IANA — stored so local_date can be recomputed after travel
  label: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  source: z.string().default("manual"), // manual | manual_retro | import | api
  transferGroupId: z.string().nullable().optional(),
});
export type EventBase = z.infer<typeof ZEventBase>;

// Whole Event Body — DB shape
// DEV_NOTE: id / trackerId are internal PKs — used by DAL/Repo for joins only, NEVER sent to a client.
export const ZEvent = ZEventBase.extend({
  id: z.number(),
  publicId: z.string(),
  userId: z.string(),
  trackerId: z.number().nullable(),
  createdAt: z.date(),
  updatedAt: z.date().nullable().optional(),
  deletedAt: z.date().nullable().optional(),
});
export type Event = z.infer<typeof ZEvent>;

// DEV_NOTE: the sparse-column invariant (thinking.md "Technical details") is enforced by a CHECK on
// the table, keyed off `valueType`. SQLite CHECK constraints cannot look up another table, so the
// metric's semantic type is copied onto the row at write time — the DAL is the only writer and
// takes it from the metric it already resolved.
//   boolean          -> valueBool only
//   text             -> valueText only
//   json             -> valueJson only
//   duration_seconds -> valueNum, plus valueStart+valueEnd together when the span is known
//   everything else  -> valueNum only
// currency/valueBase/fxRate are permitted only on currency_minor rows.
export const ZObservationValue = z.object({
  valueNum: z.number().nullable().optional(),
  valueText: z.string().nullable().optional(),
  valueBool: z.boolean().nullable().optional(),
  valueStart: z.date().nullable().optional(),
  valueEnd: z.date().nullable().optional(),
  valueJson: z.string().nullable().optional(),
  currency: z.string().nullable().optional(), // ISO 4217, currency_minor only
  valueBase: z.number().nullable().optional(), // converted to home currency at write time
  fxRate: z.number().nullable().optional(), // rate at entry time — not recoverable later
});
export type ObservationValue = z.infer<typeof ZObservationValue>;

export const ZObservation = ZObservationValue.extend({
  id: z.number(),
  publicId: z.string(),
  userId: z.string(),
  eventId: z.number().nullable(),
  metricId: z.number(),
  valueType: ZSemanticType,
  utcInstant: z.date(),
  localDate: z.string(),
  tz: z.string(),
  createdAt: z.date(),
  updatedAt: z.date().nullable().optional(),
  deletedAt: z.date().nullable().optional(),
});
export type Observation = z.infer<typeof ZObservation>;

// One event, many entities — but one per role (event_entities' (event_id, role) primary key is what
// guarantees a "slice by project" donut sums to exactly 100%).
export const ZEventEntityLink = z.object({
  eventId: z.number(),
  entityId: z.number(),
  role: ZEntryRole,
});
export type EventEntityLink = z.infer<typeof ZEventEntityLink>;

// DEV_NOTE: thinking.md Decision 8 — observations are settled facts, and a running timer is not
// one: it is an open interval, mutable until stopped. It lives here until stop, which writes one
// interval event with its duration observation and records that event on the session. Entity links
// ride along as JSON because a session has no readings to attach them to yet; they are copied onto
// event_entities at stop.
export const ZSessionEntityLink = z.object({ entityId: z.number(), role: ZEntryRole });
export type SessionEntityLink = z.infer<typeof ZSessionEntityLink>;

export const ZSession = z.object({
  id: z.number(),
  publicId: z.string(),
  userId: z.string(),
  trackerId: z.number(),
  startedAt: z.date(),
  label: z.string().nullable(),
  entityLinks: z.array(ZSessionEntityLink),
  stoppedAt: z.date().nullable().optional(),
  eventId: z.number().nullable().optional(),
  createdAt: z.date(),
  updatedAt: z.date().nullable().optional(),
  deletedAt: z.date().nullable().optional(),
});
export type Session = z.infer<typeof ZSession>;
