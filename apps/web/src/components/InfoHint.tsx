import { useRef, useState } from "react";
import { Info } from "@phosphor-icons/react";
import { Popover, PopoverContent, PopoverTrigger } from "@/shadcn/ui/popover";
import { cn } from "@/utils/tailwind";

interface InfoHintProps {
  label: string;
  children: React.ReactNode;
  iconClassName?: string;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
}

// DEV_NOTE: a popover driven two ways — mouse hover opens it, tap/click/keyboard toggles it — because
// a tooltip alone never opens on touch. Events stop at the trigger so the icon never fires a parent's
// action (e.g. a table header's sort or column menu, which opens on pointerdown).
export function InfoHint({
  label,
  children,
  iconClassName,
  side = "bottom",
  align = "start",
}: InfoHintProps) {
  const [open, setOpen] = useState(false);
  const pointerTypeRef = useRef<string | null>(null);

  const setOpenOnMouse = (e: React.PointerEvent, next: boolean) => {
    if (e.pointerType === "mouse") setOpen(next);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground"
          onPointerEnter={(e) => setOpenOnMouse(e, true)}
          onPointerLeave={(e) => setOpenOnMouse(e, false)}
          onPointerDown={(e) => {
            e.stopPropagation();
            pointerTypeRef.current = e.pointerType;
          }}
          onKeyDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            // Stops Radix's own toggle, so a mouse click on an already hover-opened hint keeps it open.
            e.preventDefault();
            const wasMouse = pointerTypeRef.current === "mouse";
            pointerTypeRef.current = null;
            setOpen((prev) => (wasMouse ? true : !prev));
          }}
        >
          <Info weight="bold" className={cn("size-3.5", iconClassName)} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        className="w-auto max-w-xs rounded-xl p-3 text-xs leading-relaxed"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}
