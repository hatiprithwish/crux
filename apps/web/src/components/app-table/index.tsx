"use client";

import { useState } from "react";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import type { AppTableProps } from "./AppTable.types";
import { AppTableHeader } from "./AppTableHeader";
import { AppTableBody } from "./AppTableBody";
import { AppTableFooter } from "./AppTableFooter";
import { AppTableVisibilityPanel } from "./AppTableVisibilityPanel";
import { cn } from "@/lib/utils";
import { TABLE_WRAPPER_CLASS } from "./utils";
import { Table } from "@/shadcn/ui/table";

export function AppTable<TRow>({
  columns,
  data,
  keyExtractor,
  isLoading,
  skeletonRows,
  emptyState,
  errorMsg,
  sortBy,
  sortOrder,
  onSort,
  onRowClick,
  getRowClassName,
  stickyHeader,
  showFooter,
}: AppTableProps<TRow>) {
  const allColumns = columns.filter((c) => !c.hidden);

  const [columnOrder, setColumnOrder] = useState<string[]>(() => allColumns.map((c) => c.key));

  // true = visible, false = hidden
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(allColumns.map((c) => [c.key, true])),
  );

  // DEV_NOTE: an `alwaysVisible` column ignores columnVisibility entirely rather than being pinned
  // to true in the map — "Hide all" writes false across every key it knows about, and a column
  // whose visibility is derived can't be turned off by a write it doesn't read.
  const isColumnVisible = (key: string) =>
    allColumns.some((c) => c.key === key && c.alwaysVisible) || !!columnVisibility[key];

  const visibleColumns = allColumns.filter((c) => isColumnVisible(c.key));

  // The visibility panel only offers what the user is allowed to turn off.
  const hideableColumns = allColumns.filter((c) => !c.alwaysVisible);

  // DEV_NOTE: header, body and footer are all driven by this, not by columnOrder directly — an
  // ordered list filtered on columnVisibility alone would drop an alwaysVisible column out of the
  // render even while visibleColumns still contained it.
  const visibleColumnOrder = columnOrder.filter(isColumnVisible);

  const handleHideColumn = (key: string) => {
    setColumnVisibility((prev) => ({ ...prev, [key]: false }));
  };

  const handleToggleColumn = (key: string) => {
    setColumnVisibility((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleHideAll = () => {
    setColumnVisibility((prev) => Object.fromEntries(Object.keys(prev).map((k) => [k, false])));
  };

  const handleShowAll = () => {
    setColumnVisibility((prev) => Object.fromEntries(Object.keys(prev).map((k) => [k, true])));
  };

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 5 },
    }),
    useSensor(KeyboardSensor),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIdx = columnOrder.indexOf(active.id as string);
      const newIdx = columnOrder.indexOf(over.id as string);
      setColumnOrder(arrayMove(columnOrder, oldIdx, newIdx));
    }
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <div className={TABLE_WRAPPER_CLASS}>
        {/* ─── Toolbar ──────────────────────────────────────────────────── */}
        <div className="flex items-center justify-end border-b border-border px-3 py-1.5">
          <AppTableVisibilityPanel
            columns={hideableColumns}
            columnVisibility={columnVisibility}
            onToggle={handleToggleColumn}
            onHideAll={handleHideAll}
            onShowAll={handleShowAll}
          />
        </div>

        <div className={cn("overflow-x-auto", stickyHeader && "overflow-y-auto max-h-[600px]")}>
          <Table>
            <AppTableHeader
              columns={visibleColumns}
              columnOrder={visibleColumnOrder}
              sortBy={sortBy}
              sortOrder={sortOrder}
              onSort={onSort}
              stickyHeader={stickyHeader}
              onHideColumn={handleHideColumn}
            />

            <AppTableBody
              columns={visibleColumns}
              columnOrder={visibleColumnOrder}
              data={data}
              keyExtractor={keyExtractor}
              isLoading={isLoading}
              skeletonRows={skeletonRows}
              emptyState={emptyState}
              errorMsg={errorMsg}
              onRowClick={onRowClick}
              getRowClassName={getRowClassName}
            />

            {showFooter && (
              <AppTableFooter
                columns={visibleColumns}
                columnOrder={visibleColumnOrder}
                data={data}
              />
            )}
          </Table>
        </div>
      </div>
    </DndContext>
  );
}

export { AppTablePagination } from "./AppTablePagination";
export type {
  AppTableColumn,
  AppTableProps,
  AppTableSortDirection,
  AppTablePaginationProps,
} from "./AppTable.types";
