import { useState } from "react";
import { Button } from "@/shadcn/ui/button";
import type * as Schemas from "@app/schemas";
import type { ControlProps } from "./-TrackerRow";
import { EntityLinkFields } from "./-EntityLinkFields";
import { formatDayPhrase } from "./-utils";

// DEV_NOTE: the Phase-0 habit's whole UI, now driven by manifest.control === "toggle" instead of by
// a Habits-specific component. Idempotency lives on the server (ControlHandlers' ensure_day), so a
// double tap is safe.
export function ToggleControl({
  tracker,
  localDate,
  dayCount,
  onQuickAdd,
  isPending,
}: ControlProps) {
  const done = dayCount > 0;
  const dayPhrase = formatDayPhrase(localDate);
  const [links, setLinks] = useState<Schemas.EntityLinkInput[]>([]);

  return (
    <div className="flex flex-col gap-3">
      <Button
        variant={done ? "default" : "outline"}
        size="sm"
        className="self-start"
        disabled={isPending}
        onClick={() =>
          onQuickAdd({
            control: "toggle",
            date: localDate,
            completed: !done,
            entityLinks: links,
          })
        }
        aria-label={
          done ? `${tracker.name}: done ${dayPhrase}` : `${tracker.name}: mark done ${dayPhrase}`
        }
      >
        {done ? `Done ${dayPhrase}` : `Mark done ${dayPhrase}`}
      </Button>

      {/* DEV_NOTE: renders nothing until the user actually has entities, so a plain habit stays a
          single button — but attributing one to a project or goal is what feeds the entity rollup
          (architecture.md §6). */}
      <EntityLinkFields value={links} onChange={setLinks} />
    </div>
  );
}
