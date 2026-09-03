import type * as Schemas from "@app/schemas";

// DEV_NOTE: architecture.md §6 — "manifest.control picks the quick-add widget. One TrackerRow
// component, five child controls." This file is the server half of that sentence: one handler per
// control, turning a quick-add payload plus the tracker's manifest into a *plan* — what entries to
// write, replace or close. It deliberately does no I/O: no DAL, no db, no clock beyond what's
// passed in. TrackersRepo executes the plan; that split is what keeps every control's write
// semantics readable in one place and unit-testable without a database.
//
// This replaces HabitsRepo.logHabit (toggle), MoneyRepo.logExpense (amount_pad) and
// TimeRepo.startTimer/stopTimer (timer) — the three write paths Phases 0–3 hardcoded per domain.

export type PlannedValue = {
  metricKey: string;
  valueNum?: number | null;
  valueText?: string | null;
  valueJson?: string | null;
  currency?: string | null;
  valueBase?: number | null;
  fxRate?: number | null;
};

export type PlannedEntry = {
  entryKind: Schemas.EntryKind;
  localDate: string;
  occurredAt: Date;
  endedAt: Date | null;
  label: string | null;
  note: string | null;
  values: PlannedValue[];
  entityLinks: Schemas.EntityLinkInput[];
};

// DEV_NOTE: four write shapes, not one — because "log this" means genuinely different things per
// control, and flattening them into a single upsert is what loses the distinction:
//   ensure_day    — idempotent: write only if the day is empty (toggle on; Habits' old behaviour)
//   clear_day     — soft-delete whatever the day holds (toggle off)
//   replace_day   — the day's value is *set*, not accumulated (daily_total)
//   append        — entries are additive, one row per tap/expense (increment/stepper/amount_pad/form)
// plus the two interval halves for timer.
export type ControlAction =
  | { kind: "ensure_day"; localDate: string; entry: PlannedEntry }
  | { kind: "clear_day"; localDate: string }
  | { kind: "replace_day"; localDate: string; entry: PlannedEntry }
  | { kind: "append"; entry: PlannedEntry }
  | { kind: "start_interval"; entry: PlannedEntry }
  | { kind: "stop_interval"; entryPublicId: string };

type PlanResult = { isSuccess: boolean; message?: string; action?: ControlAction };

function fail(message: string): PlanResult {
  return { isSuccess: false, message };
}

function dateToInstant(localDate: string): Date {
  return new Date(`${localDate}T00:00:00.000Z`);
}

// DEV_NOTE: invariant 3 — value_base is computed at write time from the caller-supplied rate and
// never recomputed later. Rounded because currency_minor values are integers.
function toValueBase(valueNum: number, fxRate: number): number {
  return Math.round(valueNum * fxRate);
}

export function planQuickAdd(params: {
  manifest: Schemas.TrackerManifest;
  payload: Schemas.QuickAddPayload;
  primaryMetricKey: string;
  todayLocalDate: string;
  now: Date;
}): PlanResult {
  const { manifest, payload, primaryMetricKey, todayLocalDate, now } = params;

  if (payload.control !== manifest.control) {
    return fail(
      `This tracker uses the "${manifest.control}" control — received a "${payload.control}" payload`,
    );
  }

  // DEV_NOTE: this is what manifest.entryMode is *for*. "live" trackers (a timer, a tap-as-it-
  // happens habit) accept today only; "retro" ones accept any date. Without this check the field
  // was decoration.
  if (
    payload.control !== "timer" &&
    manifest.entryMode === "live" &&
    payload.date !== todayLocalDate
  ) {
    return fail("This tracker only accepts entries for today");
  }

  const step = manifest.step ?? 1;

  switch (payload.control) {
    case "toggle": {
      if (!payload.completed) {
        return { isSuccess: true, action: { kind: "clear_day", localDate: payload.date } };
      }
      return {
        isSuccess: true,
        action: {
          kind: "ensure_day",
          localDate: payload.date,
          entry: {
            entryKind: "point",
            localDate: payload.date,
            occurredAt: dateToInstant(payload.date),
            endedAt: null,
            label: null,
            note: null,
            values: [{ metricKey: primaryMetricKey, valueNum: 1 }],
            entityLinks: payload.entityLinks,
          },
        },
      };
    }

    case "increment": {
      return {
        isSuccess: true,
        action: {
          kind: "append",
          entry: {
            entryKind: "point",
            localDate: payload.date,
            occurredAt: dateToInstant(payload.date),
            endedAt: null,
            label: null,
            note: payload.note ?? null,
            values: [{ metricKey: primaryMetricKey, valueNum: step }],
            entityLinks: payload.entityLinks,
          },
        },
      };
    }

    case "stepper": {
      if (payload.steps === 0) return fail("A stepper entry must move by at least one step");
      return {
        isSuccess: true,
        action: {
          kind: "append",
          entry: {
            entryKind: "point",
            localDate: payload.date,
            occurredAt: dateToInstant(payload.date),
            endedAt: null,
            label: null,
            note: null,
            values: [{ metricKey: primaryMetricKey, valueNum: payload.steps * step }],
            entityLinks: payload.entityLinks,
          },
        },
      };
    }

    case "daily_total": {
      return {
        isSuccess: true,
        action: {
          kind: "replace_day",
          localDate: payload.date,
          entry: {
            entryKind: "point",
            localDate: payload.date,
            occurredAt: dateToInstant(payload.date),
            endedAt: null,
            label: null,
            note: null,
            values: [{ metricKey: primaryMetricKey, valueNum: payload.total }],
            entityLinks: payload.entityLinks,
          },
        },
      };
    }

    case "amount_pad": {
      return {
        isSuccess: true,
        action: {
          kind: "append",
          entry: {
            entryKind: "point",
            localDate: payload.date,
            occurredAt: dateToInstant(payload.date),
            endedAt: null,
            label: null,
            note: payload.note ?? null,
            values: [
              {
                metricKey: primaryMetricKey,
                valueNum: payload.amountMinor,
                currency: payload.currency,
                valueBase: toValueBase(payload.amountMinor, payload.fxRate),
                fxRate: payload.fxRate,
              },
            ],
            entityLinks: payload.entityLinks,
          },
        },
      };
    }

    case "form": {
      // DEV_NOTE: a form may only write metrics its own manifest declares — otherwise a client
      // could scatter readings across metrics this tracker was never configured for, and every
      // aggregate keyed on manifest.metrics would silently under-report.
      const undeclared = payload.values.find(
        (value) => !manifest.metrics.includes(value.metricKey),
      );
      if (undeclared) {
        return fail(`Metric "${undeclared.metricKey}" is not declared in this tracker's manifest`);
      }

      const values: PlannedValue[] = payload.values.map((value) => ({
        metricKey: value.metricKey,
        valueNum: value.valueNum ?? null,
        valueText: value.valueText ?? null,
        valueJson: value.valueJson ?? null,
        currency: value.currency ?? null,
        fxRate: value.fxRate ?? null,
        valueBase:
          value.valueNum != null && value.fxRate != null
            ? toValueBase(value.valueNum, value.fxRate)
            : null,
      }));

      return {
        isSuccess: true,
        action: {
          kind: "append",
          entry: {
            entryKind: "point",
            localDate: payload.date,
            occurredAt: dateToInstant(payload.date),
            endedAt: null,
            label: payload.label ?? null,
            note: payload.note ?? null,
            values,
            entityLinks: payload.entityLinks,
          },
        },
      };
    }

    case "timer": {
      if (payload.timer.action === "stop") {
        return {
          isSuccess: true,
          action: { kind: "stop_interval", entryPublicId: payload.timer.entryPublicId },
        };
      }

      // DEV_NOTE: an open session carries no reading — duration isn't known until stop, and
      // inventing a 0 would be a lie the aggregates would believe (invariant 7).
      return {
        isSuccess: true,
        action: {
          kind: "start_interval",
          entry: {
            entryKind: "interval",
            localDate: todayLocalDate,
            occurredAt: now,
            endedAt: null,
            label: payload.timer.label,
            note: null,
            values: [],
            entityLinks: payload.timer.entityLinks,
          },
        },
      };
    }
  }
}
