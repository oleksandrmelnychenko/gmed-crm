import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { useRef, type CSSProperties, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import { cn } from "@/lib/utils";

import { DENSITY_ROW_HEIGHT } from "./density-toggle";
import { toggleSort } from "./sort-logic";
import type { ColumnDef, DensityLevel, SortStack } from "./types";

const HEADER_HEIGHT = 36;

export type DataTableProps<T> = {
  rows: readonly T[];
  columns: readonly ColumnDef<T>[];
  hiddenColumns?: readonly string[];
  sort?: SortStack;
  onSortChange?: (next: SortStack) => void;
  density?: DensityLevel;
  rowId: (row: T) => string;
  activeRowId?: string | null;
  onRowClick?: (row: T) => void;
  onRowDoubleClick?: (row: T) => void;
  selectedIds?: readonly string[];
  onSelectedIdsChange?: (next: string[]) => void;
  selectionEnabled?: boolean;
  rowAccent?: (row: T) => string | null;
  rowActions?: (row: T) => ReactNode;
  loading?: boolean;
  emptyState?: ReactNode;
  loadingState?: ReactNode;
  footer?: ReactNode;
  className?: string;
  overscan?: number;
};

export function DataTable<T>({
  rows,
  columns,
  hiddenColumns = [],
  sort = [],
  onSortChange,
  density = "compact",
  rowId,
  activeRowId = null,
  onRowClick,
  onRowDoubleClick,
  selectedIds = [],
  onSelectedIdsChange,
  selectionEnabled = false,
  rowAccent,
  rowActions,
  loading = false,
  emptyState,
  loadingState,
  footer,
  className,
  overscan = 10,
}: DataTableProps<T>) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rowHeight = DENSITY_ROW_HEIGHT[density];

  const visibleCols = columns.filter((c) => !hiddenColumns.includes(c.id) || c.required);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan,
  });

  const virtualRows = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  const selectedSet = new Set(selectedIds);

  const toggleSelection = (id: string, event: React.MouseEvent) => {
    if (!onSelectedIdsChange) return;
    event.stopPropagation();
    if (selectedSet.has(id)) {
      onSelectedIdsChange(selectedIds.filter((sid) => sid !== id));
    } else {
      onSelectedIdsChange([...selectedIds, id]);
    }
  };

  const toggleSelectAll = () => {
    if (!onSelectedIdsChange) return;
    if (selectedIds.length === rows.length) {
      onSelectedIdsChange([]);
    } else {
      onSelectedIdsChange(rows.map(rowId));
    }
  };

  const handleSortClick = (col: ColumnDef<T>, event: React.MouseEvent) => {
    if (!col.sortable || !onSortChange) return;
    const next = toggleSort(sort, col.id, { multi: event.shiftKey });
    onSortChange(next);
  };

  const sortLookup = new Map(sort.map((s, i) => [s.field, { ...s, index: i }]));

  const gridTemplate = buildGridTemplate(visibleCols, {
    selection: selectionEnabled,
    actions: Boolean(rowActions),
  });

  const allSelected = selectionEnabled && rows.length > 0 && selectedIds.length === rows.length;
  const someSelected = selectionEnabled && selectedIds.length > 0 && !allSelected;

  const showEmpty = !loading && rows.length === 0;
  const showLoading = loading;

  return (
    <div className={cn("flex flex-col rounded-lg border border-border bg-card", className)}>
      <div
        ref={scrollRef}
        className="relative flex-1 overflow-auto"
        role="table"
        aria-rowcount={rows.length}
      >
        <div
          role="row"
          aria-rowindex={1}
          className="sticky top-0 z-20 grid items-center border-b border-border bg-muted/40 text-xs font-medium text-muted-foreground"
          style={{
            gridTemplateColumns: gridTemplate,
            height: HEADER_HEIGHT,
          }}
        >
          {selectionEnabled ? (
            <div className="sticky left-0 z-30 flex h-full items-center justify-center border-r border-border bg-muted/40 px-2">
              <SelectCheckbox
                checked={allSelected}
                indeterminate={someSelected}
                onChange={toggleSelectAll}
                ariaLabel="Select all"
              />
            </div>
          ) : null}
          {visibleCols.map((col, index) => {
            const sortState = sortLookup.get(col.id);
            const pinStyle = pinnedStyle(col, index, visibleCols, selectionEnabled);
            return (
              <button
                key={col.id}
                type="button"
                role="columnheader"
                aria-sort={
                  sortState
                    ? sortState.dir === "asc"
                      ? "ascending"
                      : "descending"
                    : "none"
                }
                onClick={(e) => handleSortClick(col, e)}
                className={cn(
                  "flex h-full items-center gap-1 border-r border-border px-2 text-left",
                  col.sortable && "cursor-pointer hover:bg-muted/80",
                  pinStyle.className,
                )}
                style={pinStyle.style}
                disabled={!col.sortable}
              >
                <span className="truncate">{col.label}</span>
                {col.sortable ? (
                  sortState ? (
                    <span className="inline-flex items-center gap-0.5 text-foreground">
                      {sortState.dir === "asc" ? (
                        <ArrowUp className="size-3" />
                      ) : (
                        <ArrowDown className="size-3" />
                      )}
                      {sort.length > 1 ? (
                        <span className="tabular-nums text-[10px] text-muted-foreground">
                          {sortState.index + 1}
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    <ChevronsUpDown className="size-3 opacity-40" />
                  )
                ) : null}
              </button>
            );
          })}
          {rowActions ? (
            <div
              className="sticky right-0 z-30 flex h-full items-center justify-end border-l border-border bg-muted/40 px-2"
              style={{ gridColumn: `${visibleCols.length + (selectionEnabled ? 2 : 1)}` }}
            />
          ) : null}
        </div>

        {showLoading ? (
          loadingState ?? <DefaultSkeleton rows={12} height={rowHeight} />
        ) : showEmpty ? (
          <div className="flex min-h-48 items-center justify-center p-8 text-sm text-muted-foreground">
            {emptyState ?? "No results"}
          </div>
        ) : (
          <div style={{ height: totalSize, position: "relative" }}>
            {virtualRows.map((vRow) => {
              const row = rows[vRow.index];
              if (!row) return null;
              const id = rowId(row);
              const isActive = activeRowId === id;
              const isSelected = selectedSet.has(id);
              const accent = rowAccent?.(row);
              return (
                <div
                  key={id}
                  role="row"
                  aria-rowindex={vRow.index + 2}
                  aria-selected={isActive}
                  data-state={isSelected ? "selected" : undefined}
                  onClick={() => onRowClick?.(row)}
                  onDoubleClick={() => onRowDoubleClick?.(row)}
                  className={cn(
                    "group/row absolute inset-x-0 grid cursor-pointer items-center border-b border-border/60 bg-background transition-colors hover:bg-muted/30",
                    isActive && "bg-muted/50 hover:bg-muted/60",
                    isSelected && "bg-primary/5 hover:bg-primary/10",
                  )}
                  style={{
                    top: vRow.start,
                    height: vRow.size,
                    gridTemplateColumns: gridTemplate,
                  }}
                >
                  {accent ? (
                    <span
                      aria-hidden="true"
                      className={cn("absolute left-0 top-0 h-full w-0.5", accent)}
                    />
                  ) : null}
                  {selectionEnabled ? (
                    <div className="sticky left-0 z-10 flex h-full items-center justify-center border-r border-border bg-[inherit] px-2">
                      <SelectCheckbox
                        checked={isSelected}
                        onChange={(e) => {
                          toggleSelection(id, e as unknown as React.MouseEvent);
                        }}
                        ariaLabel="Select row"
                      />
                    </div>
                  ) : null}
                  {visibleCols.map((col, index) => {
                    const pinStyle = pinnedStyle(col, index, visibleCols, selectionEnabled);
                    return (
                      <div
                        key={col.id}
                        role="cell"
                        className={cn(
                          "flex h-full items-center overflow-hidden border-r border-border/40 px-2 text-xs text-foreground",
                          pinStyle.className,
                        )}
                        style={pinStyle.style}
                      >
                        <div className="w-full truncate">
                          {col.render ? col.render(row) : defaultRender(col.accessor(row))}
                        </div>
                      </div>
                    );
                  })}
                  {rowActions ? (
                    <div
                      className="sticky right-0 z-10 flex h-full items-center justify-end gap-1 border-l border-border bg-[inherit] px-1 opacity-0 transition-opacity group-hover/row:opacity-100"
                      style={{ gridColumn: `${visibleCols.length + (selectionEnabled ? 2 : 1)}` }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {rowActions(row)}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {footer ? <div className="border-t border-border bg-muted/20 px-3 py-1.5 text-xs text-muted-foreground">{footer}</div> : null}
    </div>
  );
}

function defaultRender(value: unknown): ReactNode {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}

function buildGridTemplate<T>(
  cols: readonly ColumnDef<T>[],
  opts: { selection: boolean; actions: boolean },
): string {
  const parts: string[] = [];
  if (opts.selection) parts.push("32px");
  for (const col of cols) {
    const width = col.width ? `${col.width}px` : "minmax(120px, 1fr)";
    parts.push(width);
  }
  if (opts.actions) parts.push("auto");
  return parts.join(" ");
}

type PinInfo = { className?: string; style?: CSSProperties };

function pinnedStyle<T>(
  col: ColumnDef<T>,
  index: number,
  cols: readonly ColumnDef<T>[],
  selectionEnabled: boolean,
): PinInfo {
  if (col.pinned === "left") {
    let offset = selectionEnabled ? 32 : 0;
    for (let i = 0; i < index; i += 1) {
      if (cols[i].pinned === "left") offset += cols[i].width ?? 120;
    }
    return {
      className: "sticky z-10 bg-[inherit]",
      style: { left: offset },
    };
  }
  if (col.pinned === "right") {
    let offset = 0;
    for (let i = cols.length - 1; i > index; i -= 1) {
      if (cols[i].pinned === "right") offset += cols[i].width ?? 120;
    }
    return {
      className: "sticky z-10 bg-[inherit]",
      style: { right: offset },
    };
  }
  return {};
}

type SelectCheckboxProps = {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  ariaLabel: string;
};

function SelectCheckbox({ checked, indeterminate = false, onChange, ariaLabel }: SelectCheckboxProps) {
  return (
    <input
      type="checkbox"
      aria-label={ariaLabel}
      checked={checked}
      ref={(el) => {
        if (el) el.indeterminate = indeterminate;
      }}
      onChange={onChange}
      onClick={(e) => e.stopPropagation()}
      className="size-3.5 cursor-pointer rounded border-border text-primary focus-visible:ring-2 focus-visible:ring-ring/50"
    />
  );
}

type DefaultSkeletonProps = { rows: number; height: number };

function DefaultSkeleton({ rows, height }: DefaultSkeletonProps) {
  return (
    <div className="flex flex-col">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="animate-pulse border-b border-border/40 px-3"
          style={{ height }}
        >
          <div className="flex h-full items-center gap-3">
            <div className="h-3 w-24 rounded bg-muted" />
            <div className="h-3 w-40 rounded bg-muted/70" />
            <div className="h-3 w-16 rounded bg-muted/70" />
            <div className="h-3 w-24 rounded bg-muted/70" />
          </div>
        </div>
      ))}
    </div>
  );
}
