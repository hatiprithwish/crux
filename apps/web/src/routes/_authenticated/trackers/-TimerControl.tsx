import { useEffect, useState } from "react";
import { Button } from "@/shadcn/ui/button";
import { Input } from "@/shadcn/ui/input";
import type { ControlProps } from "./-TrackerRow";
import { formatDuration } from "./-utils";

// DEV_NOTE: start and stop are two members of one quick-add payload, not two endpoints — the open
// session comes back on the tracker's today row, so this widget needs no query of its own. Elapsed
// time ticks client-side; the authoritative duration is written server-side on stop.
export function TimerControl({ tracker, today, onQuickAdd, isPending }: ControlProps) {
  const openSession = today?.openSession ?? null;
  const [label, setLabel] = useState("");
  // DEV_NOTE: the ticking clock is state; the elapsed seconds are derived during render, so the
  // effect only ever schedules — it never sets state synchronously on mount (which would cascade a
  // render, and which the react-hooks lint rule rightly rejects).
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!openSession) return;

    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [openSession]);

  const elapsed = openSession
    ? Math.max(0, Math.round((now - new Date(openSession.occurredAt).getTime()) / 1000))
    : 0;

  if (openSession) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-sm">
          {openSession.label ?? "Running"} ·{" "}
          <span className="tabular-nums">{formatDuration(elapsed)}</span>
        </span>
        <Button
          variant="destructive"
          size="sm"
          disabled={isPending}
          onClick={() =>
            onQuickAdd({
              control: "timer",
              timer: { action: "stop", entryPublicId: openSession.publicId },
            })
          }
        >
          Stop
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        value={label}
        placeholder="What are you working on?"
        className="w-56"
        aria-label={`Session label for ${tracker.name}`}
        onChange={(event) => setLabel(event.target.value)}
      />
      <Button
        size="sm"
        disabled={isPending || label.trim() === ""}
        onClick={() => {
          onQuickAdd({
            control: "timer",
            timer: { action: "start", label: label.trim(), entityLinks: [] },
          });
          setLabel("");
        }}
      >
        Start
      </Button>
    </div>
  );
}
