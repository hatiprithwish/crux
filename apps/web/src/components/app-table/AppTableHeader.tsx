"use client";

import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowsDownUp, CaretDown, CaretUp, DotsSixVertical } from "@phosphor-icons/react";
import { InfoHint } from "@/components/InfoHint";
import { TableHead, TableHeader, TableRow } from "@/shadcn/ui/table";
import type { AppTableColumn, AppTableSortDirection } from "./AppTable.types";
import { AppTableColumnMenu } from "./AppTableColumnMenu";
import { cn } from "@/lib/utils";
import {
  HEADER_ROW_CLASS,
  SORT_ICON_INACTIVE_CLASS,
  SORT_ICON_ACTIVE_CLASS,
  DRAG_HANDLE_CLASS,
} from "./utils";

export { arrayMove };

// ─── Sortable Header Cell ──────────────────────────────────────────────────

interface SortableHeaderCellProps<TRow> {
  column: AppTableColumn<TRow>;
  sortBy?: string;
  sortOrder?: AppTableSortDirection;
  onSort?: (col: string, dir: AppTableSortDirection) => void;
  stickyHeader?: boolean;
  onHideColumn: (key: string) => void;
}

function SortableHeaderCell<TRow>({
  column,
  sortBy,
  sortOrder,
  onSort,
  onHideColumn,
}: SortableHeaderCellProps<TRow>) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: column.key,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const isSortable = !!column.sortKey && !!onSort;
  const isActive = column.sortKey === sortBy;

  const handleSortClick = () => {
    if (!isSortable || !column.sortKey) return;
    if (isActive) {
      onSort!(column.sortKey, sortOrder === "asc" ? "desc" : "asc");
    } else {
      onSort!(column.sortKey, "desc");
    }
  };

  // DEV_NOTE: a plain node, not a nested component — declaring a component inside render remounts
  // it (and drops its state) on every parent render. See react-x/no-nested-component-definitions.
  let sortIcon = null;
  if (isSortable) {
    if (!isActive) {
      sortIcon = <ArrowsDownUp className={SORT_ICON_INACTIVE_CLASS} />;
    } else {
      sortIcon =
        sortOrder === "asc" ? (
          <CaretUp className={SORT_ICON_ACTIVE_CLASS} />
        ) : (
          <CaretDown className={SORT_ICON_ACTIVE_CLASS} />
        );
    }
  }

  const head = (
    <TableHead
      ref={setNodeRef}
      style={style}
      className={cn(
        "h-auto select-none whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground",
        isSortable && "cursor-pointer hover:text-foreground transition-colors",
        column.headerClassName,
      )}
      onClick={handleSortClick}
    >
      <div className="flex items-center gap-1">
        <span
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          className={DRAG_HANDLE_CLASS}
          suppressHydrationWarning
        >
          <DotsSixVertical className="h-3.5 w-3.5" />
        </span>

        {column.header}

        {sortIcon}

        {column.headerTooltip && (
          <InfoHint label={`About ${column.header}`} iconClassName="size-3">
            {column.headerTooltip}
          </InfoHint>
        )}
      </div>
    </TableHead>
  );

  // DEV_NOTE: the column menu's only item is Hide, so a column that can't be hidden gets no menu at
  // all rather than an empty one. Returned bare, which also stops an actions column's header from
  // opening a dropdown on click when there is nothing in it to choose.
  if (column.alwaysVisible) return head;

  return <AppTableColumnMenu onHide={() => onHideColumn(column.key)}>{head}</AppTableColumnMenu>;
}

// ─── AppTableHeader ─────────────────────────────────────────────────────────

interface AppTableHeaderProps<TRow> {
  columns: AppTableColumn<TRow>[];
  columnOrder: string[];
  sortBy?: string;
  sortOrder?: AppTableSortDirection;
  onSort?: (col: string, dir: AppTableSortDirection) => void;
  stickyHeader?: boolean;
  onHideColumn: (key: string) => void;
}

export function AppTableHeader<TRow>({
  columns,
  columnOrder,
  sortBy,
  sortOrder,
  onSort,
  stickyHeader,
  onHideColumn,
}: AppTableHeaderProps<TRow>) {
  const orderedColumns = columnOrder
    .map((key) => columns.find((c) => c.key === key))
    .filter(Boolean) as AppTableColumn<TRow>[];

  return (
    <SortableContext items={columnOrder} strategy={horizontalListSortingStrategy}>
      <TableHeader>
        <TableRow className={cn(HEADER_ROW_CLASS, stickyHeader && "sticky top-0 z-10")}>
          {orderedColumns.map((column) => (
            <SortableHeaderCell
              key={column.key}
              column={column}
              sortBy={sortBy}
              sortOrder={sortOrder}
              onSort={onSort}
              stickyHeader={stickyHeader}
              onHideColumn={onHideColumn}
            />
          ))}
        </TableRow>
      </TableHeader>
    </SortableContext>
  );
}
