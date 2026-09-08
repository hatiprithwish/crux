import type { DefaultAgg, SemanticType } from "../core/DomainEnums";

// DEV_NOTE: design/things-mobile.png reads "bank · 47 entries · last today" under every row, with a
// number on the right — a list of names alone doesn't say which things are actually in use. This is
// the read surface for that line: one row per entity, all-time, off the entity list request rather
// than a fetch per row (six kinds × N rows is a request storm for three facts each).
//
// DEV_NOTE: all-time on purpose, with no date range. The question the line answers is "is this thing
// live, and how much has gone through it" — an account's balance is not a 30-day figure, and a
// range would make the number depend on a control the screen doesn't show.

// DEV_NOTE: the same uniformity rule as EntityRollupCombined — a total exists only when every metric
// pointing at the entity agrees on semantic type, canonical unit AND aggregation. Reps plus metres
// is meaningless, and one metric's total plus another's average is the same error with a matching
// unit. Null is the honest answer; the client prints the entry count alone.
export interface EntityStatsTotal {
  semanticType: SemanticType;
  canonicalUnit: string;
  defaultAgg: DefaultAgg;
  value: number | null;
  sum: number;
  count: number;
}

export interface EntityStatsApiShape {
  entityPublicId: string;
  entryCount: number;
  // YYYY-MM-DD of the most recent entry linked to this entity, or null if nothing ever pointed at
  // it. Not coalesced to a date (invariant 7) — "never used" is not "used long ago".
  lastEntryDate: string | null;
  total: EntityStatsTotal | null;
}
