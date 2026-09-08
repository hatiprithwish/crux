import { Link } from "@tanstack/react-router";
import { Archive, DotsThree, ArrowSquareOut } from "@phosphor-icons/react";
import { Button } from "@/shadcn/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shadcn/ui/dropdown-menu";
import { cn } from "@/utils/tailwind";
import type * as Schemas from "@app/schemas";
import { formatMetricValue } from "../trackers/-utils";
import { useArchiveEntity } from "./-data";
import { formatLastEntry, KIND_SINGULAR } from "./-utils";

interface EntityRowProps {
  entity: Schemas.EntityApiShape;
  stats: Schemas.EntityStatsApiShape | null;
}

// DEV_NOTE: mirrors trackers/-TrackerRow.tsx rather than the old entity list — the whole row links
// to the rollup and archive moved into the same DotsThree menu the tracker rows use. A red button
// repeated down every row made destroying a thing the most visually prominent action on the screen,
// which is exactly backwards for a list you mostly come to read.
export default function EntityRow({ entity, stats }: EntityRowProps) {
  const archiveEntity = useArchiveEntity();

  // DEV_NOTE: "0 entries" is a real, useful answer here (nothing points at this thing yet), unlike a
  // 0 total — that stays absent when no metric ever wrote against the entity (invariant 7).
  const subtitle = [
    KIND_SINGULAR[entity.kind],
    stats ? `${stats.entryCount} ${stats.entryCount === 1 ? "entry" : "entries"}` : null,
    stats ? formatLastEntry(stats.lastEntryDate) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex items-center gap-2 border-b border-border pr-4 pl-6">
      <Link
        to="/entities/$entityId"
        params={{ entityId: entity.publicId }}
        className="group flex min-w-0 flex-1 items-center justify-between gap-4 py-4"
      >
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-base font-medium group-hover:underline">
            {entity.name}
          </span>
          <span className="truncate text-xs text-muted-foreground">{subtitle}</span>
        </span>

        {stats?.total ? (
          <span
            className={cn(
              "shrink-0 text-lg tabular-nums",
              // A negative total is the one number in this list that means something different from
              // its magnitude — money owed rather than money held — so it is the only one coloured.
              (stats.total.value ?? 0) < 0 ? "text-primary" : "text-foreground",
            )}
          >
            {formatMetricValue(
              stats.total.value,
              stats.total.semanticType,
              stats.total.canonicalUnit,
            )}
          </span>
        ) : null}
      </Link>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`${entity.name} options`}>
            <DotsThree className="size-4" weight="bold" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link to="/entities/$entityId" params={{ entityId: entity.publicId }}>
              <ArrowSquareOut className="size-4" />
              Rollup
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            disabled={archiveEntity.isPending}
            onSelect={() => archiveEntity.mutate(entity.publicId)}
          >
            <Archive className="size-4" />
            Archive
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
