import type * as Schemas from "@app/schemas";

// DEV_NOTE: metrics.default_agg answers "what does one day of this quantity mean" — and until now
// nothing asked. daily_facts computes sum/count/min/max/avg on every write (EntriesDAL's
// recomputeDailyFacts), but every read path took `.sum` regardless, so a metric declared as
// "averaged per day" was silently totalled instead. Three weigh-ins produced three times a body
// weight. This module is the missing selector: one place that turns a fact row into the number the
// metric says it is.
//
// DEV_NOTE: aggregation belongs to the metric, unlike direction (which moved onto the manifest in
// ZTrackerManifest). Whether a quantity is additive is a property of the quantity — two trackers
// sharing `weight_kg` must both average or their numbers cannot roll into one, which is the point
// of a global metric.

// DEV_NOTE: null, not 0 — invariant 7. min/max/avg are nullable on a fact row, and a metric whose
// aggregate was never computed has no value for the day rather than a zero one. Callers drop the
// day instead of scoring it as an empty one.
export function factValue(fact: Schemas.DailyFact, agg: Schemas.DefaultAgg): number | null {
  switch (agg) {
    case "sum":
      return fact.sum;
    case "avg":
      return fact.avg;
    case "max":
      return fact.max;
    case "min":
      return fact.min;
  }
}

// DEV_NOTE: the same selection over a *range* of days rather than one of them, for rollups. sum,
// min and max compose straight out of the per-day columns; avg deliberately does not use the
// average of the daily averages, which would weight a day with one reading the same as a day with
// twenty. SUM(sum)/SUM(count) is the true mean over the range and is only computable because the
// fact row carries `count` next to `sum`.
export interface RangeAggregates {
  sum: number;
  count: number;
  min: number | null;
  max: number | null;
}

export function rangeValue(range: RangeAggregates, agg: Schemas.DefaultAgg): number | null {
  switch (agg) {
    case "sum":
      return range.sum;
    case "avg":
      return range.count === 0 ? null : range.sum / range.count;
    case "max":
      return range.max;
    case "min":
      return range.min;
  }
}
