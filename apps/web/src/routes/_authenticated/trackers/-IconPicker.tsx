import { useState } from "react";
import {
  EmojiPicker,
  type EmojiPickerListCategoryHeaderProps,
  type EmojiPickerListEmojiProps,
  type EmojiPickerListRowProps,
} from "frimousse";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { Popover, PopoverContent, PopoverTrigger } from "@/shadcn/ui/popover";

// DEV_NOTE: frimousse is headless — it ships behaviour (virtualised list, keyboard navigation, ARIA
// roles, emoji data that updates itself) and no styling at all, so the picker is built out of the
// same tokens as the rest of the app instead of arriving with a theme of its own to fight. Every
// class below is ours; the library only decides what renders where.
//
// DEV_NOTE: no lazy import needed here, unlike the picker this replaced — frimousse has no
// module-scope `window` access, so it server-renders with the rest of the route.

// DEV_NOTE: the list is virtualised, so every row and header must keep the exact height frimousse
// measured. It hands each one an inline `height: var(--frimousse-row-height)` through props, which
// is why these spread props first and only add a className — adding padding instead would change
// the measured height and desynchronise scrolling from the rows it thinks it is drawing.
function CategoryHeader({ category, ...props }: EmojiPickerListCategoryHeaderProps) {
  return (
    <div
      {...props}
      className="flex items-end bg-popover px-3 pb-1.5 text-2xs font-medium tracking-widest text-muted-foreground uppercase"
    >
      {category.label}
    </div>
  );
}

function Row({ children, ...props }: EmojiPickerListRowProps) {
  return (
    <div {...props} className="flex items-center px-1.5">
      {children}
    </div>
  );
}

// DEV_NOTE: type="button" is not decoration — this renders inside the tracker <form>, and a button
// with no explicit type submits it.
function Emoji({ emoji, ...props }: EmojiPickerListEmojiProps) {
  return (
    <button
      {...props}
      type="button"
      className="flex size-8 items-center justify-center rounded-md text-lg data-active:bg-accent"
    >
      {emoji.emoji}
    </button>
  );
}

// DEV_NOTE: defined once at module scope rather than inline — a fresh object here would remount the
// whole virtualised list on every keystroke in the search box.
const LIST_COMPONENTS = { CategoryHeader, Row, Emoji };

interface IconPickerProps {
  value: string | null;
  onChange: (icon: string | null) => void;
}

export function IconPicker({ value, onChange }: IconPickerProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Choose an icon"
          className="flex h-10 w-full items-center border-b border-border text-2xl transition-colors hover:border-primary focus-visible:border-primary focus-visible:outline-none"
        >
          {value ?? <span className="text-sm text-muted-foreground">Pick one</span>}
        </button>
      </PopoverTrigger>

      {/* DEV_NOTE: PopoverContent renders through a Radix portal, which is load-bearing here rather
          than incidental. The picker's search box is an <input> and this component is used inside
          the tracker <form>; portalled to document.body it is not form-associated, so Enter in the
          search box can't implicitly submit the form. frimousse only calls preventDefault on Enter
          when an emoji is active, so a search with no matches would otherwise create the tracker
          mid-icon-pick. */}
      <PopoverContent align="start" className="w-auto overflow-hidden p-0">
        <EmojiPicker.Root
          columns={9}
          onEmojiSelect={(emoji) => {
            onChange(emoji.emoji);
            setOpen(false);
          }}
          className="isolate flex h-92 w-76 flex-col"
        >
          <div className="relative border-b border-border">
            <MagnifyingGlass className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <EmojiPicker.Search
              placeholder="Search icons"
              className="h-10 w-full bg-transparent pr-3 pl-9 text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>

          <EmojiPicker.Viewport className="relative flex-1 outline-hidden">
            <EmojiPicker.Loading className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
              Loading icons...
            </EmojiPicker.Loading>
            <EmojiPicker.Empty className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
              No icon found.
            </EmojiPicker.Empty>
            <EmojiPicker.List className="pb-2" components={LIST_COMPONENTS} />
          </EmojiPicker.Viewport>

          {value ? (
            <div className="border-t border-border p-1.5">
              <button
                type="button"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
                className="w-full rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                Clear icon
              </button>
            </div>
          ) : null}
        </EmojiPicker.Root>
      </PopoverContent>
    </Popover>
  );
}
