import { ArrowDown, ArrowUp, Check, ChevronsUpDown, Pin, PinOff } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  type ReactNode,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import { useLang, type Translations } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { DENSITY_ROW_HEIGHT } from "./density-toggle";
import { toggleSort } from "./sort-logic";
import type { ColumnDef, DensityLevel, SortStack } from "./types";
import { useOutsideClose } from "./use-outside-close";

const HEADER_HEIGHT = 36;

type DataTableRowStyle = CSSProperties & {
  "--dt-row-bg": string;
  "--dt-row-hover-bg": string;
};

export type ColumnHeaderContextMenuLabels = {
  column?: string;
  freeze?: string;
  unfreeze?: string;
  frozen?: string;
  freezeLimitReached?: string;
};

export type DataTableProps<T> = {
  rows: readonly T[];
  columns: readonly ColumnDef<T>[];
  hiddenColumns?: readonly string[];
  sort?: SortStack;
  onSortChange?: (next: SortStack) => void;
  onColumnFreezeChange?: (columnId: string, frozen: boolean) => void;
  isColumnFreezeDisabled?: (column: ColumnDef<T>, nextFrozen: boolean) => boolean;
  columnHeaderContextMenuLabels?: ColumnHeaderContextMenuLabels;
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
  rowActionsLabel?: ReactNode;
  rowActionsWidth?: number;
  rowHeightOverrides?: Partial<Record<DensityLevel, number>>;
  loading?: boolean;
  emptyState?: ReactNode;
  loadingState?: ReactNode;
  footer?: ReactNode;
  className?: string;
  overscan?: number;
  storageKey?: string;
};

const COLUMN_WIDTH_MIN = 60;
const COLUMN_WIDTH_MAX = 800;

function widthStorageKey(storageKey?: string) {
  return storageKey ? `${storageKey}:column-widths` : null;
}

function loadStoredWidths(storageKey?: string): Record<string, number> {
  const key = widthStorageKey(storageKey);
  if (!key || typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const result: Record<string, number> = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      const num = Number(value);
      if (Number.isFinite(num) && num >= COLUMN_WIDTH_MIN && num <= COLUMN_WIDTH_MAX) {
        result[id] = num;
      }
    }
    return result;
  } catch {
    return {};
  }
}

function saveStoredWidths(storageKey: string | undefined, widths: Record<string, number>) {
  const key = widthStorageKey(storageKey);
  if (!key || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(widths));
  } catch {
    // ignore quota / disabled storage
  }
}

export function DataTable<T>({
  rows,
  columns,
  hiddenColumns = [],
  sort = [],
  onSortChange,
  onColumnFreezeChange,
  isColumnFreezeDisabled,
  columnHeaderContextMenuLabels,
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
  rowActionsLabel,
  rowActionsWidth = 144,
  rowHeightOverrides,
  loading = false,
  emptyState,
  loadingState,
  footer,
  className,
  overscan = 10,
  storageKey,
}: DataTableProps<T>) {
  const { t } = useLang();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const columnMenuRef = useRef<HTMLDivElement | null>(null);
  const [columnMenu, setColumnMenu] = useState<{
    columnId: string;
    x: number;
    y: number;
  } | null>(null);
  const rowHeight = rowHeightOverrides?.[density] ?? DENSITY_ROW_HEIGHT[density];
  const resolvedRowActionsLabel = rowActionsLabel ?? t.table_actions;

  const [widthOverrides, setWidthOverrides] = useState<Record<string, number>>(
    () => loadStoredWidths(storageKey),
  );

  useEffect(() => {
    setWidthOverrides(loadStoredWidths(storageKey));
  }, [storageKey]);

  const baseVisibleCols = useMemo(
    () => orderColumnsForPinning(columns.filter((c) => !hiddenColumns.includes(c.id) || c.required)),
    [columns, hiddenColumns],
  );

  const visibleCols = useMemo<ColumnDef<T>[]>(
    () =>
      baseVisibleCols.map((col) =>
        widthOverrides[col.id]
          ? { ...col, width: widthOverrides[col.id] }
          : col,
      ),
    [baseVisibleCols, widthOverrides],
  );

  const headerCellRefs = useRef<Map<string, HTMLElement>>(new Map());

  const beginColumnResize = useCallback(
    (columnId: string, event: ReactMouseEvent<HTMLSpanElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const cellEl = headerCellRefs.current.get(columnId);
      const startX = event.clientX;
      const startWidth = cellEl?.getBoundingClientRect().width ?? 160;
      const handleMove = (moveEvent: MouseEvent) => {
        const next = Math.min(
          COLUMN_WIDTH_MAX,
          Math.max(COLUMN_WIDTH_MIN, startWidth + moveEvent.clientX - startX),
        );
        setWidthOverrides((current) => {
          if (current[columnId] === next) return current;
          return { ...current, [columnId]: next };
        });
      };
      const handleUp = () => {
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
        document.body.style.cursor = "";
        setWidthOverrides((current) => {
          saveStoredWidths(storageKey, current);
          return current;
        });
      };
      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
      document.body.style.cursor = "col-resize";
    },
    [storageKey],
  );

  // eslint-disable-next-line react-hooks/incompatible-library -- tanstack-virtual returns functions that the React compiler can't memoize; safe here because DataTable is not memoized.
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan,
  });

  const virtualRows = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  useEffect(() => {
    virtualizer.measure();
  }, [rowHeight, virtualizer]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const toggleSelection = (id: string, event: { stopPropagation: () => void }) => {
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

  const activeIndex = activeRowId
    ? rows.findIndex((row) => rowId(row) === activeRowId)
    : -1;

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!onRowClick || rows.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      const next = activeIndex < 0 ? 0 : Math.min(activeIndex + 1, rows.length - 1);
      onRowClick(rows[next]);
      virtualizer.scrollToIndex(next, { align: "auto" });
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      const next = activeIndex <= 0 ? 0 : activeIndex - 1;
      onRowClick(rows[next]);
      virtualizer.scrollToIndex(next, { align: "auto" });
    } else if (event.key === "Home") {
      event.preventDefault();
      onRowClick(rows[0]);
      virtualizer.scrollToIndex(0, { align: "start" });
    } else if (event.key === "End") {
      event.preventDefault();
      onRowClick(rows[rows.length - 1]);
      virtualizer.scrollToIndex(rows.length - 1, { align: "end" });
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      onRowClick(rows[activeIndex]);
    }
  };

  const sortLookup = useMemo(
    () => new Map(sort.map((s, i) => [s.field, { ...s, index: i }])),
    [sort],
  );

  const gridTemplate = useMemo(
    () =>
      buildGridTemplate(visibleCols, {
        selection: selectionEnabled,
        actions: Boolean(rowActions),
        actionsWidth: rowActionsWidth,
      }),
    [rowActions, rowActionsWidth, selectionEnabled, visibleCols],
  );

  const allSelected = selectionEnabled && rows.length > 0 && selectedIds.length === rows.length;
  const someSelected = selectionEnabled && selectedIds.length > 0 && !allSelected;
  const columnMenuColumn = columnMenu
    ? (visibleCols.find((column) => column.id === columnMenu.columnId) ?? null)
    : null;
  const columnMenuNextFrozen = columnMenuColumn ? columnMenuColumn.pinned !== "left" : false;
  const columnMenuFreezeDisabled =
    columnMenuColumn && isColumnFreezeDisabled
      ? isColumnFreezeDisabled(columnMenuColumn, columnMenuNextFrozen)
      : false;
  const closeColumnMenu = useCallback(() => setColumnMenu(null), []);

  const showEmpty = !loading && rows.length === 0;
  const showLoading = loading;

  useOutsideClose(columnMenuRef, closeColumnMenu, { enabled: Boolean(columnMenu) });

  useEffect(() => {
    if (!columnMenu) return;
    window.addEventListener("resize", closeColumnMenu);
    window.addEventListener("scroll", closeColumnMenu, true);
    return () => {
      window.removeEventListener("resize", closeColumnMenu);
      window.removeEventListener("scroll", closeColumnMenu, true);
    };
  }, [closeColumnMenu, columnMenu]);

  const handleColumnContextMenu = (
    col: ColumnDef<T>,
    event: ReactMouseEvent<HTMLButtonElement>,
  ) => {
    if (!onColumnFreezeChange) return;
    event.preventDefault();
    event.stopPropagation();
    const menuWidth = 224;
    const menuHeight = 116;
    setColumnMenu({
      columnId: col.id,
      x: Math.min(event.clientX, Math.max(8, window.innerWidth - menuWidth - 8)),
      y: Math.min(event.clientY, Math.max(8, window.innerHeight - menuHeight - 8)),
    });
  };

  return (
    <div className={cn("flex flex-col overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm", className)}>
      <div
        ref={scrollRef}
        className="relative flex-1 overflow-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        role="table"
        aria-rowcount={rows.length}
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        <div
          role="row"
          aria-rowindex={1}
          className="data-table-header-row sticky top-0 z-20 grid items-center border-b border-border/60 bg-card font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground/80"
          style={{
            gridTemplateColumns: gridTemplate,
            height: HEADER_HEIGHT,
          }}
        >
          {selectionEnabled ? (
            <div className="sticky left-0 z-30 flex h-full items-center justify-center border-r border-b border-border/50 bg-card px-2 shadow-[1px_0_0_color-mix(in_oklch,var(--border)_70%,transparent)]">
              <SelectCheckbox
                checked={allSelected}
                indeterminate={someSelected}
                onChange={toggleSelectAll}
                ariaLabel={t.table_select_all}
              />
            </div>
          ) : null}
          {visibleCols.map((col, index) => {
            const sortState = sortLookup.get(col.id);
            const pinStyle = pinnedStyle(col, index, visibleCols, selectionEnabled);
            const isPinned = Boolean(col.pinned);
            return (
              <button
                key={col.id}
                ref={(el) => {
                  if (el) headerCellRefs.current.set(col.id, el);
                  else headerCellRefs.current.delete(col.id);
                }}
                type="button"
                role="columnheader"
                data-column-id={col.id}
                data-pinned={col.pinned ?? undefined}
                aria-sort={
                  sortState
                    ? sortState.dir === "asc"
                      ? "ascending"
                      : "descending"
                    : "none"
                }
                onClick={(e) => handleSortClick(col, e)}
                onContextMenu={(e) => handleColumnContextMenu(col, e)}
                className={cn(
                  "data-table-header-cell relative flex h-full items-center gap-1 border-b border-border/60 bg-card px-2 text-left",
                  col.sortable && "cursor-pointer hover:bg-muted/65",
                  pinStyle.className,
                  isPinned && "bg-card shadow-[1px_0_0_color-mix(in_oklch,var(--border)_70%,transparent)]",
                )}
                style={pinStyle.style}
                aria-disabled={!col.sortable}
                aria-haspopup={onColumnFreezeChange ? "menu" : undefined}
                disabled={!col.sortable && !onColumnFreezeChange}
              >
                <span className="truncate uppercase tracking-[0.08em]">{col.label}</span>
                {isPinned ? (
                  <span
                    title={columnHeaderContextMenuLabels?.frozen ?? t.table_columns_frozen}
                    className="inline-flex shrink-0 items-center text-primary"
                  >
                    <Pin className="size-3" />
                  </span>
                ) : null}
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
                <span
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={t.table_resize_column}
                  onMouseDown={(e) => beginColumnResize(col.id, e)}
                  onClick={(e) => e.stopPropagation()}
                  onContextMenu={(e) => e.stopPropagation()}
                  className="absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize select-none bg-transparent transition-colors hover:bg-primary/40 active:bg-primary/60"
                />
              </button>
            );
          })}
          {rowActions ? (
            <div
              role="columnheader"
              data-column-id="__actions"
              className="sticky right-0 z-30 flex h-full items-center justify-end border-l border-b border-border/50 bg-card px-2 text-right shadow-[-1px_0_0_color-mix(in_oklch,var(--border)_70%,transparent)]"
              style={{ gridColumn: `${visibleCols.length + (selectionEnabled ? 2 : 1)}` }}
            >
              <span className="truncate uppercase tracking-[0.08em]">{resolvedRowActionsLabel}</span>
            </div>
          ) : null}
        </div>

        {showLoading ? (
          loadingState ?? <DefaultSkeleton rows={12} height={rowHeight} />
        ) : showEmpty ? (
          <div className="flex min-h-48 items-center justify-center p-8 text-sm text-muted-foreground">
            {emptyState ?? t.common_no_results}
          </div>
        ) : (
          <div style={{ height: totalSize, position: "relative" }}>
            {virtualRows.map((vRow) => {
              const row = rows[vRow.index];
              if (!row) return null;
              const id = rowId(row);
              const isActive = activeRowId === id;
              const isSelected = selectedSet.has(id);
              const isOdd = vRow.index % 2 === 1;
              const accent = rowAccent?.(row);
              const rowTone = rowToneStyle({ isActive, isOdd, isSelected });

              return (
                <div
                  key={id}
                  role="row"
                  aria-rowindex={vRow.index + 2}
                  aria-selected={isActive}
                  data-state={isSelected ? "selected" : undefined}
                  onClick={() => onRowClick?.(row)}
                  onDoubleClick={() => onRowDoubleClick?.(row)}
                  className="data-table-row group/row absolute inset-x-0 grid cursor-pointer items-center border-b border-border/45 transition-[background-color,box-shadow]"
                  style={{
                    top: vRow.start,
                    height: vRow.size,
                    gridTemplateColumns: gridTemplate,
                    ...rowTone,
                  }}
                >
                  {accent ? (
                    <span
                      aria-hidden="true"
                      className={cn("absolute left-0 top-0 h-full w-0.5", accent)}
                    />
                  ) : null}
                  {selectionEnabled ? (
                    <div
                      className="data-table-cell sticky left-0 z-20 flex h-full items-center justify-center border-r border-border/45 px-2 shadow-[1px_0_0_color-mix(in_oklch,var(--border)_65%,transparent)] transition-colors"
                    >
                      <SelectCheckbox
                        checked={isSelected}
                        onChange={(e) => toggleSelection(id, e)}
                        ariaLabel={t.table_select_row}
                      />
                    </div>
                  ) : null}
                  {visibleCols.map((col, index) => {
                    const pinStyle = pinnedStyle(col, index, visibleCols, selectionEnabled);
                    const isPinned = Boolean(col.pinned);
                    return (
                      <div
                        key={col.id}
                        role="cell"
                        data-column-id={col.id}
                        data-pinned={col.pinned ?? undefined}
                        data-frozen-opaque={isPinned ? "true" : undefined}
                        className={cn(
                          "data-table-cell flex h-full items-center overflow-hidden px-2 text-xs text-foreground transition-colors",
                          pinStyle.className,
                          isPinned && "z-20 shadow-[1px_0_0_color-mix(in_oklch,var(--border)_65%,transparent)]",
                        )}
                        style={pinStyle.style}
                      >
                        <div className="w-full truncate">
                          {col.render ? col.render(row) : defaultRender(col.accessor(row), t)}
                        </div>
                      </div>
                    );
                  })}
                  {rowActions ? (
                    <div
                      className="data-table-cell sticky right-0 z-20 flex h-full items-center justify-end gap-1 border-l border-border/45 px-1 opacity-0 shadow-[-1px_0_0_color-mix(in_oklch,var(--border)_65%,transparent)] transition-[opacity,background-color] group-focus-within/row:opacity-100 group-hover/row:opacity-100"
                      style={{
                        gridColumn: `${visibleCols.length + (selectionEnabled ? 2 : 1)}`,
                        width: rowActionsWidth,
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="flex items-center justify-end gap-1">
                        {rowActions(row)}
                      </span>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {columnMenu && columnMenuColumn && onColumnFreezeChange ? (
        <ColumnHeaderContextMenu
          refEl={columnMenuRef}
          column={columnMenuColumn}
          disabled={columnMenuFreezeDisabled}
          labels={{
            column: columnHeaderContextMenuLabels?.column ?? t.table_columns,
            freeze: columnHeaderContextMenuLabels?.freeze ?? t.table_columns_freeze,
            unfreeze: columnHeaderContextMenuLabels?.unfreeze ?? t.table_columns_unfreeze,
            frozen: columnHeaderContextMenuLabels?.frozen ?? t.table_columns_frozen,
            freezeLimitReached:
              columnHeaderContextMenuLabels?.freezeLimitReached ?? t.table_columns_freeze_limit,
          }}
          x={columnMenu.x}
          y={columnMenu.y}
          onClose={closeColumnMenu}
          onFreezeChange={onColumnFreezeChange}
        />
      ) : null}
      {footer ? <div className="border-t border-border/60 bg-muted/15 px-3 py-1.5 text-xs text-muted-foreground">{footer}</div> : null}
    </div>
  );
}

function defaultRender(value: unknown, translations: Translations): ReactNode {
  if (value == null) {
    return <span className="text-muted-foreground">{translations.common_not_set}</span>;
  }
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") {
    return value ? translations.common_yes : translations.common_no;
  }
  return String(value);
}

type ColumnHeaderContextMenuProps<T> = {
  column: ColumnDef<T>;
  disabled: boolean;
  labels?: ColumnHeaderContextMenuLabels;
  refEl: RefObject<HTMLDivElement | null>;
  x: number;
  y: number;
  onClose: () => void;
  onFreezeChange: (columnId: string, frozen: boolean) => void;
};

function ColumnHeaderContextMenu<T>({
  column,
  disabled,
  labels,
  refEl,
  x,
  y,
  onClose,
  onFreezeChange,
}: ColumnHeaderContextMenuProps<T>) {
  const isFrozen = column.pinned === "left";
  const actionLabel = isFrozen
    ? (labels?.unfreeze ?? "Unfreeze column")
    : (labels?.freeze ?? "Freeze column");

  return (
    <div
      ref={refEl}
      data-column-header-context-menu
      role="menu"
      aria-label={`${labels?.column ?? "Column"} ${column.label}`}
      className="fixed z-[120] w-56 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-xl"
      style={{ left: x, top: y }}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-2.5 py-2">
        <span className="min-w-0 truncate text-xs font-medium">{column.label}</span>
        {isFrozen ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase text-primary">
            <Pin className="size-3" />
            {labels?.frozen ?? "Frozen"}
          </span>
        ) : null}
      </div>
      <div className="p-1">
        <button
          type="button"
          role="menuitemcheckbox"
          aria-checked={isFrozen}
          disabled={disabled}
          onClick={() => {
            if (disabled) return;
            onFreezeChange(column.id, !isFrozen);
            onClose();
          }}
          className={cn(
            "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs transition-colors",
            "hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
            disabled && "pointer-events-none opacity-45",
          )}
        >
          {isFrozen ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
          <span className="min-w-0 flex-1 truncate">{actionLabel}</span>
          {isFrozen ? <Check className="size-3.5 text-primary" /> : null}
        </button>
        {disabled ? (
          <div className="px-2 py-1 text-[11px] leading-4 text-muted-foreground">
            {labels?.freezeLimitReached ?? "Freeze limit reached"}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function rowToneStyle(opts: {
  isActive: boolean;
  isOdd: boolean;
  isSelected: boolean;
}): DataTableRowStyle {
  if (opts.isSelected) {
    return {
      "--dt-row-bg": "color-mix(in oklch, var(--primary) 8%, var(--card))",
      "--dt-row-hover-bg": "color-mix(in oklch, var(--primary) 14%, var(--card))",
    };
  }

  if (opts.isActive) {
    return {
      "--dt-row-bg": "color-mix(in oklch, var(--muted) 72%, var(--card))",
      "--dt-row-hover-bg": "color-mix(in oklch, var(--primary) 7%, color-mix(in oklch, var(--muted) 84%, var(--card)))",
    };
  }

  if (opts.isOdd) {
    return {
      "--dt-row-bg": "color-mix(in oklch, var(--muted) 55%, var(--card))",
      "--dt-row-hover-bg": "color-mix(in oklch, var(--primary) 5%, color-mix(in oklch, var(--muted) 78%, var(--card)))",
    };
  }

  return {
    "--dt-row-bg": "var(--card)",
    "--dt-row-hover-bg": "color-mix(in oklch, var(--primary) 5%, color-mix(in oklch, var(--muted) 68%, var(--card)))",
  };
}

function buildGridTemplate<T>(
  cols: readonly ColumnDef<T>[],
  opts: { selection: boolean; actions: boolean; actionsWidth: number },
): string {
  const parts: string[] = [];
  if (opts.selection) parts.push("32px");
  for (const col of cols) {
    const width = columnWidth(col);
    parts.push(width ? `${width}px` : "minmax(120px, 1fr)");
  }
  if (opts.actions) parts.push(`${opts.actionsWidth}px`);
  return parts.join(" ");
}

function orderColumnsForPinning<T>(cols: readonly ColumnDef<T>[]): ColumnDef<T>[] {
  const left: ColumnDef<T>[] = [];
  const center: ColumnDef<T>[] = [];
  const right: ColumnDef<T>[] = [];

  for (const col of cols) {
    if (col.pinned === "left") {
      left.push(col);
    } else if (col.pinned === "right") {
      right.push(col);
    } else {
      center.push(col);
    }
  }

  return [...left, ...center, ...right];
}

type PinInfo = { className?: string; style?: CSSProperties };

function columnWidth<T>(col: ColumnDef<T>): number | null {
  if (col.width) return col.width;
  return col.pinned ? 160 : null;
}

function pinnedStyle<T>(
  col: ColumnDef<T>,
  index: number,
  cols: readonly ColumnDef<T>[],
  selectionEnabled: boolean,
): PinInfo {
  if (col.pinned === "left") {
    let offset = selectionEnabled ? 32 : 0;
    for (let i = 0; i < index; i += 1) {
      if (cols[i].pinned === "left") offset += columnWidth(cols[i]) ?? 120;
    }
    return {
      className: "sticky z-20",
      style: { left: offset },
    };
  }
  if (col.pinned === "right") {
    let offset = 0;
    for (let i = cols.length - 1; i > index; i -= 1) {
      if (cols[i].pinned === "right") offset += columnWidth(cols[i]) ?? 120;
    }
    return {
      className: "sticky z-20",
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
