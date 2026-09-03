import { z } from "zod";

// DEV_NOTE: never addressed individually by a client (no id/publicId) — only ever fetched by range
// query, and only ever written by EntriesDAL when it writes the matching entries/entry_values row.
// min/max/avg/targetAtTime are nullable — invariant 7: missing data is neutral, never coalesced to 0.
// The entityId IS NULL row is the canonical, un-attributed total (architecture.md §5 "daily_facts").
export const ZDailyFact = z.object({
  userId: z.string(),
  localDate: z.string(),
  metricId: z.number(),
  entityId: z.number().nullable(),
  sum: z.number(),
  count: z.number(),
  min: z.number().nullable(),
  max: z.number().nullable(),
  avg: z.number().nullable(),
  targetAtTime: z.number().nullable(), // snapshot; keeps history honest when goals change
  updatedAt: z.date(),
});
export type DailyFact = z.infer<typeof ZDailyFact>;
