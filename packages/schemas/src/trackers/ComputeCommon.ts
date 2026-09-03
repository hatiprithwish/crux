import { z } from "zod";

// DEV_NOTE: architecture.md §5 — `manifest.compute` is the escape hatch for "logic config can't
// express". It is deliberately NOT free text: every value must resolve to a module registered in
// apps/backend/src/manifest/ComputeRegistry.ts, and an unknown key is rejected when the tracker is
// created rather than failing at write time. One member today — Money's transfer, the only thing
// the seven controls demonstrably could not express (two entries sharing one transfer_group_id,
// with signed values so each account's daily_facts moves in the right direction).
export const ZComputeKey = z.enum(["money.transfer.v1"]);
export type ComputeKey = z.infer<typeof ZComputeKey>;

// DEV_NOTE: v1 assumes same-currency transfers between the user's own accounts — no cross-currency
// conversion (fxRate is 1 on both sides). Carried over verbatim from the Phase 2 scope decision.
export const ZMoneyTransferComputeInput = z.object({
  fromAccountPublicId: z.string(),
  toAccountPublicId: z.string(),
  amountMinor: z.number().int().positive(),
  currency: z.string().length(3),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().nullable().optional(),
});
export type MoneyTransferComputeInput = z.infer<typeof ZMoneyTransferComputeInput>;

// DEV_NOTE: discriminated on `key` so adding a second compute module is a new member here plus a
// new module in the registry — the route and Repo dispatch stay untouched.
export const ZComputeInput = z.discriminatedUnion("key", [
  z.object({ key: z.literal("money.transfer.v1"), payload: ZMoneyTransferComputeInput }),
]);
export type ComputeInput = z.infer<typeof ZComputeInput>;

// API response shape — both sides of a transfer share one transferGroupId, and the two entries are
// returned as ordinary tracker entries (publicId-only, like every other entry shape).
export interface MoneyTransferComputeResult {
  transferGroupId: string;
  fromAccountPublicId: string;
  toAccountPublicId: string;
  amountMinor: number;
  currency: string;
  localDate: string;
  occurredAt: Date;
  createdAt: Date;
}
