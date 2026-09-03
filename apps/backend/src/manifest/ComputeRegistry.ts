import type EntitiesDAL from "@/data-access-layer/EntitiesDAL";
import type EntriesDAL from "@/data-access-layer/EntriesDAL";
import Utility from "@/utils/Utility";
import type * as Schemas from "@app/schemas";

// DEV_NOTE: architecture.md §5 — `compute` is the escape hatch: "a registered TypeScript module for
// logic config can't express". This is that registry. A module gets DAL instances handed to it by
// TrackersRepo (never a db client of its own, so the layering still reads
// Routes → Repo → module → DAL) and declares which metric keys the tracker's manifest must list,
// which is checked at tracker-creation time rather than discovered on the first write.
//
// Exactly one module exists, and that's the point: extracting the manifest engine showed the seven
// controls cover every write Habits/Money/Time do except one — a transfer, which is two entries
// sharing a transfer_group_id with opposite signs. Anything a control can express does not belong
// here.

export type ComputeContext = {
  userId: string;
  tracker: Schemas.Tracker;
  tz: string;
  entriesDal: EntriesDAL;
  entitiesDal: EntitiesDAL;
  metricIdByKey: Map<string, number>;
};

export type ComputeModule = {
  key: Schemas.ComputeKey;
  requiredMetricKeys: string[];
  run: (ctx: ComputeContext, input: Schemas.ComputeInput) => Promise<Schemas.RunComputeApiResponse>;
};

export const TRANSFER_METRIC_KEY = "money_transfer_amount";

// DEV_NOTE: ported verbatim from MoneyRepo.createTransfer — the signed value pair is what makes each
// account's daily_facts move in the right direction off the same writeEntry fan-out every other
// control uses, so no aggregation logic is special-cased for Money.
const moneyTransferV1: ComputeModule = {
  key: "money.transfer.v1",
  requiredMetricKeys: [TRANSFER_METRIC_KEY],

  async run(ctx, input) {
    if (input.key !== "money.transfer.v1") {
      return { isSuccess: false, message: "Unsupported compute input for money.transfer.v1" };
    }
    const payload = input.payload;

    if (payload.fromAccountPublicId === payload.toAccountPublicId) {
      return { isSuccess: false, message: "Cannot transfer an account to itself" };
    }

    const metricId = ctx.metricIdByKey.get(TRANSFER_METRIC_KEY);
    if (metricId === undefined) {
      return { isSuccess: false, message: `Metric "${TRANSFER_METRIC_KEY}" not found` };
    }

    const fromAccount = await ctx.entitiesDal.getEntity({
      userId: ctx.userId,
      publicId: payload.fromAccountPublicId,
    });
    if (!fromAccount.isSuccess || !fromAccount.entity || fromAccount.entity.kind !== "account") {
      return { isSuccess: false, message: "Source account not found" };
    }

    const toAccount = await ctx.entitiesDal.getEntity({
      userId: ctx.userId,
      publicId: payload.toAccountPublicId,
    });
    if (!toAccount.isSuccess || !toAccount.entity || toAccount.entity.kind !== "account") {
      return { isSuccess: false, message: "Destination account not found" };
    }

    const transferGroupId = Utility.generatePublicId("txf_");
    const occurredAt = new Date(`${payload.date}T00:00:00.000Z`);

    const writeSide = (entityId: number, signedAmount: number) =>
      ctx.entriesDal.writeEntry({
        userId: ctx.userId,
        trackerId: ctx.tracker.id,
        occurredAt,
        localDate: payload.date,
        tz: ctx.tz,
        note: payload.note ?? null,
        source: "manual",
        transferGroupId,
        values: [
          {
            metricId,
            valueNum: signedAmount,
            currency: payload.currency,
            valueBase: signedAmount,
            fxRate: 1,
          },
        ],
        entityLinks: [{ entityId, role: "account" }],
      });

    const debit = await writeSide(fromAccount.entity.id, -payload.amountMinor);
    if (!debit.isSuccess || !debit.entry) {
      return { isSuccess: false, message: debit.message };
    }

    const credit = await writeSide(toAccount.entity.id, payload.amountMinor);
    if (!credit.isSuccess || !credit.entry) {
      // DEV_NOTE: best-effort cleanup — the debit side already committed and entries has no
      // cross-write transaction (see EntriesDAL.recomputeDailyFacts's DEV_NOTE on why). Better to
      // leave no dangling half-transfer than to leave one uncorrected.
      await ctx.entriesDal.deleteEntry({ userId: ctx.userId, publicId: debit.entry.publicId });
      return { isSuccess: false, message: credit.message };
    }

    return {
      isSuccess: true,
      message: "Transfer created successfully",
      transfer: {
        transferGroupId,
        fromAccountPublicId: payload.fromAccountPublicId,
        toAccountPublicId: payload.toAccountPublicId,
        amountMinor: payload.amountMinor,
        currency: payload.currency,
        localDate: payload.date,
        occurredAt,
        createdAt: debit.entry.createdAt,
      },
    };
  },
};

const registry: Record<Schemas.ComputeKey, ComputeModule> = {
  "money.transfer.v1": moneyTransferV1,
};

export function getComputeModule(key: Schemas.ComputeKey): ComputeModule {
  return registry[key];
}

// DEV_NOTE: called when a tracker is created, not when it first writes — a manifest naming a module
// that doesn't exist, or one whose metrics it never declared, is rejected up front. A tracker row
// that can't be written to is worse than a failed create.
export function validateComputeManifest(manifest: Schemas.TrackerManifest): {
  isSuccess: boolean;
  message?: string;
} {
  if (manifest.compute === null) return { isSuccess: true };

  const module = registry[manifest.compute];
  if (!module) {
    return { isSuccess: false, message: `Unknown compute module "${manifest.compute}"` };
  }

  const missing = module.requiredMetricKeys.filter((key) => !manifest.metrics.includes(key));
  if (missing.length > 0) {
    return {
      isSuccess: false,
      message: `Compute module "${manifest.compute}" requires manifest metrics: ${missing.join(", ")}`,
    };
  }

  return { isSuccess: true };
}
