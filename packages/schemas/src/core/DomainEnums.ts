import { z } from "zod";

// DEV_NOTE: these mirror architecture.md §3 verbatim — text columns in the DB, not the int+label
// Status Enum Pattern. The doc is explicit these are `text not null` SQL columns, so the DB and the
// wire format use the same string, no int mapping to maintain.

export const ZSemanticType = z.enum([
  "duration_seconds",
  "count",
  "currency_minor",
  "mass_grams",
  "volume_ml",
  "energy_kcal",
  "distance_m",
  "rating_1_5",
  "boolean",
  "text",
  "json",
]);
export type SemanticType = z.infer<typeof ZSemanticType>;

export const ZDefaultAgg = z.enum(["sum", "avg", "last", "max", "min"]);
export type DefaultAgg = z.infer<typeof ZDefaultAgg>;

export const ZDirection = z.enum(["higher_better", "lower_better", "neutral"]);
export type Direction = z.infer<typeof ZDirection>;

export const ZDateAttribution = z.enum(["start", "end", "split"]);
export type DateAttribution = z.infer<typeof ZDateAttribution>;

export const ZEntryKind = z.enum(["point", "interval"]);
export type EntryKind = z.infer<typeof ZEntryKind>;

export const ZEntityKind = z.enum(["project", "person", "place", "goal", "account", "tag"]);
export type EntityKind = z.infer<typeof ZEntityKind>;

// DEV_NOTE: one entity per role per entry — enforced by entry_entities' (entry_id, role) primary key.
// "tag" added for Money's expense categories (architecture.md §7 Phase 2) — categories are
// entities of kind "tag" linked via this role, not free-text on entries.label.
export const ZEntryRole = z.enum(["project", "person", "place", "account", "tag"]);
export type EntryRole = z.infer<typeof ZEntryRole>;

export const ZEntityStatus = z.enum(["active", "paused", "done"]);
export type EntityStatus = z.infer<typeof ZEntityStatus>;

export const ZControl = z.enum([
  "toggle",
  "stepper",
  "increment",
  "timer",
  "daily_total",
  "amount_pad",
  "form",
]);
export type Control = z.infer<typeof ZControl>;
