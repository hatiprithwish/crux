import { useState } from "react";
import { Button } from "@/shadcn/ui/button";
import { Input } from "@/shadcn/ui/input";
import type * as Schemas from "@app/schemas";
import type { ControlProps } from "./-TrackerRow";
import { EntityLinkFields } from "./-EntityLinkFields";
import { formatMinorAmount, getTodayLocalDate } from "./-utils";

// DEV_NOTE: the expense entry Money used to own. Amount is typed in major units and converted to
// minor on submit — canonical units are what's stored (invariant 2). fxRate is always sent (1 for
// home currency), and value_base is computed server-side at write time, never recomputed later
// (invariant 3).
export function AmountPadControl({ tracker, today, onQuickAdd, isPending }: ControlProps) {
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [fxRate, setFxRate] = useState("1");
  const [links, setLinks] = useState<Schemas.EntityLinkInput[]>([]);

  const submit = () => {
    const major = Number(amount);
    const rate = Number(fxRate);
    if (!Number.isFinite(major) || major <= 0 || !Number.isFinite(rate) || rate <= 0) return;

    onQuickAdd({
      control: "amount_pad",
      date: getTodayLocalDate(),
      amountMinor: Math.round(major * 100),
      currency: currency.toUpperCase(),
      fxRate: rate,
      entityLinks: links,
    });
    setAmount("");
  };

  return (
    <div className="flex flex-col gap-3">
      <span className="text-sm text-muted-foreground">
        Today: {today?.todaySum != null ? formatMinorAmount(today.todaySum) : "—"}
      </span>

      <div className="flex items-center gap-2">
        <Input
          type="number"
          step="0.01"
          min="0"
          value={amount}
          placeholder="Amount"
          className="w-32"
          aria-label={`Amount for ${tracker.name}`}
          onChange={(event) => setAmount(event.target.value)}
        />
        <Input
          value={currency}
          maxLength={3}
          className="w-20"
          aria-label="Currency"
          onChange={(event) => setCurrency(event.target.value.toUpperCase())}
        />
        <Input
          type="number"
          step="any"
          min="0"
          value={fxRate}
          className="w-24"
          aria-label="FX rate to home currency"
          onChange={(event) => setFxRate(event.target.value)}
        />
        <Button size="sm" disabled={isPending || amount === ""} onClick={submit}>
          Log
        </Button>
      </div>

      <EntityLinkFields value={links} onChange={setLinks} />
    </div>
  );
}
