import { useMemo, useState } from "react";
import { Check, MagnifyingGlass } from "@phosphor-icons/react";
import { Popover, PopoverContent, PopoverTrigger } from "@/shadcn/ui/popover";
import { Input } from "@/shadcn/ui/input";
import { cn } from "@/utils/tailwind";

// DEV_NOTE: ~30 major zones — enough to keep the picker usable on a browser that predates
// Intl.supportedValuesOf (Safari < 15.4, and any non-browser test runner). Not exhaustive: the
// point is "still works", not "still complete".
const FALLBACK_TIME_ZONES = [
  "UTC",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Karachi",
  "Asia/Dhaka",
  "Asia/Bangkok",
  "Asia/Jakarta",
  "Asia/Shanghai",
  "Asia/Hong_Kong",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Australia/Sydney",
  "Australia/Perth",
  "Pacific/Auckland",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Moscow",
  "Africa/Cairo",
  "Africa/Johannesburg",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Anchorage",
  "America/Sao_Paulo",
  "America/Mexico_City",
  "Pacific/Honolulu",
];

function listTimeZones(): string[] {
  if (typeof Intl.supportedValuesOf === "function") {
    return Intl.supportedValuesOf("timeZone");
  }
  return FALLBACK_TIME_ZONES;
}

// DEV_NOTE: "Asia/Kolkata" -> "Kolkata (Asia)" — the city is what a person recognises, the region
// is just there to disambiguate the handful of cities that repeat across zones.
function formatZoneLabel(tz: string): string {
  const [region, ...rest] = tz.split("/");
  if (rest.length === 0) return tz;
  return `${rest.join("/").replace(/_/g, " ")} (${region})`;
}

interface TimezonePickerProps {
  value: string;
  onChange: (tz: string) => void;
  disabled?: boolean;
}

export function TimezonePicker({ value, onChange, disabled }: TimezonePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const zones = useMemo(() => listTimeZones(), []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return zones;
    return zones.filter((tz) => tz.toLowerCase().includes(needle.replace(/\s+/g, "_")));
  }, [zones, query]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="flex h-9 w-full items-center justify-between rounded-3xl border border-border bg-background px-3 text-sm transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
        >
          <span>{formatZoneLabel(value)}</span>
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-80 p-0">
        <div className="relative border-b border-border p-2">
          <MagnifyingGlass className="absolute top-1/2 left-5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search timezones"
            className="pl-8"
          />
        </div>

        <div className="max-h-72 overflow-y-auto p-1.5">
          {filtered.length === 0 ? (
            <p className="px-2 py-3 text-center text-sm text-muted-foreground">No match.</p>
          ) : (
            filtered.map((tz) => (
              <button
                key={tz}
                type="button"
                onClick={() => {
                  onChange(tz);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground",
                  tz === value && "text-foreground",
                )}
              >
                <span>{formatZoneLabel(tz)}</span>
                {tz === value ? <Check className="size-4 shrink-0" /> : null}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
