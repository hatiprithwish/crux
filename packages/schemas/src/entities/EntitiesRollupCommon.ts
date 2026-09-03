import { z } from "zod";
import { ZEntryRole } from "../core/DomainEnums";
import type {
  DefaultAgg,
  Direction,
  EntityKind,
  EntryRole,
  SemanticType,
} from "../core/DomainEnums";

// DEV_NOTE: architecture.md §6 "Cross-domain aggregation" — "Pushups and running roll into one
// 'Fitness' number because they point at the same entity row." This is the read surface for that:
// one entity, every metric that has ever been attributed to it, over a date range.
//
// DEV_NOTE: implementation.md Phase 4 says "one hand-written query", and that's deliberate — this is
// NOT a generic cross-domain query builder (§7 step 6: "productise only the five or six queries you
// actually re-run"). One entity, one optional role slice, sums per metric.

export const ZEntityRollupQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // DEV_NOTE: invariant 6 — aggregation over entities always filters by exactly one role. Scoping to
  // a single entity already satisfies that (there is nothing to group across), so role is optional
  // here: supply it to answer "time on this entity *as a project*", omit it for everything that ever
  // pointed at the entity in any role.
  role: ZEntryRole.optional(),
});
export type EntityRollupQuery = z.infer<typeof ZEntityRollupQuery>;

// API response shape — one row per metric attributed to the entity. Metric metadata travels with the
// number because a bare sum is unreadable without its unit and direction (is 4000 good or bad?).
export interface EntityRollupMetricRow {
  metricPublicId: string;
  metricKey: string;
  metricName: string;
  semanticType: SemanticType;
  canonicalUnit: string;
  defaultAgg: DefaultAgg;
  direction: Direction;
  sum: number;
  count: number;
}

// DEV_NOTE: `combined` is populated only when every contributing metric shares a semantic type and
// canonical unit — adding reps to metres produces a number that means nothing, and invariant 2 is
// explicit that canonical units are what's stored. Two count metrics (pushups + squats) do combine,
// which is the doc's own "Fitness number" example; a count and a distance do not, and the client
// renders the per-metric rows instead of inventing a total.
export interface EntityRollupCombined {
  semanticType: SemanticType;
  canonicalUnit: string;
  sum: number;
  count: number;
}

export interface EntityRollupApiShape {
  entityPublicId: string;
  entityName: string;
  entityKind: EntityKind;
  from: string;
  to: string;
  role: EntryRole | null;
  metrics: EntityRollupMetricRow[];
  combined: EntityRollupCombined | null;
}
