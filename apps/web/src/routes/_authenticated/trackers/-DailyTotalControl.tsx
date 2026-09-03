import { useState } from "react";
import { Button } from "@/shadcn/ui/button";
import { Input } from "@/shadcn/ui/input";
import type * as Schemas from "@app/schemas";
import type { ControlProps } from "./-TrackerRow";
import { EntityLinkFields } from "./-EntityLinkFields";
import { getTodayLocalDate } from "./-utils";

// DEV_NOTE: sets the day rather than adding to it — a weight reading replaces yesterday's typo, it
// doesn't stack on it. The server plans "replace_day" for exactly this reason.
export function DailyTotalControl({ tracker, today, onQuickAdd, isPending }: ControlProps) {
  const [value, setValue] = useState<string>("");
  const [links, setLinks] = useState<Schemas.EntityLinkInput[]>([]);

  const submit = () => {
    const total = Number(value);
    if (value === "" || Number.isNaN(total)) return;
    onQuickAdd({ control: "daily_total", date: getTodayLocalDate(), total, entityLinks: links });
    setValue("");
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="text-sm tabular-nums text-muted-foreground">{today?.todaySum ?? "—"}</span>
        <Input
          type="number"
          step="any"
          value={value}
          placeholder="Today's total"
          className="w-32"
          aria-label={`Today's total for ${tracker.name}`}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
        />
        <Button size="sm" disabled={isPending || value === ""} onClick={submit}>
          Save
        </Button>
      </div>

      <EntityLinkFields value={links} onChange={setLinks} />
    </div>
  );
}
