import { useMemo, useReducer, type ReactNode, type SetStateAction } from "react";

import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { ColumnVisibilityMenu } from "./column-visibility-menu";
import { DataTable, type DataTableProps } from "./data-table";
import {
  DataTablePager,
  useDataTablePagination,
} from "./data-table-pager";
import { applyFilters } from "./filter-logic";
import { FilterBuilder } from "./filter-builder";
import { applySort } from "./sort-logic";
import { SortBuilder } from "./sort-builder";
import type {
  ColumnDef,
  DensityLevel,
  FilterPredicate,
  SortStack,
} from "./types";

type DataTableSurfaceFooterContext<T> = {
  rows: readonly T[];
  visibleRows: readonly T[];
  filteredCount: number;
  totalCount: number;
};

export type DataTableSurfaceProps<T> = Omit<
  DataTableProps<T>,
  | "columns"
  | "density"
  | "footer"
  | "hiddenColumns"
  | "isColumnFreezeDisabled"
  | "onColumnFreezeChange"
  | "onSortChange"
  | "rows"
  | "sort"
> & {
  columns: readonly ColumnDef<T>[];
  defaultDensity?: DensityLevel;
  defaultFrozenColumns?: readonly string[];
  defaultHiddenColumns?: readonly string[];
  defaultSort?: SortStack;
  dictionary?: Record<string, string>;
  /**
   * Injects synthetic child rows directly under a parent row, after
   * filtering and sorting (children are exempt from both).
   */
  expandRow?: (row: T) => readonly T[] | null;
  /** Custom controls rendered at the start of the toolbar row (before filter/sort). */
  toolbarStart?: ReactNode;
  /** Optional content rendered directly below the toolbar and above the table. */
  toolbarAfter?: ReactNode;
  footer?: ReactNode | ((context: DataTableSurfaceFooterContext<T>) => ReactNode);
  groupLabels?: Record<string, string>;
  maxFrozenColumns?: number;
  pagination?: {
    className?: string;
    pageSize?: number;
    resetKey?: string;
  };
  rows: readonly T[];
  surfaceClassName?: string;
  tableClassName?: string;
  toolbarClassName?: string;
};

const DEFAULT_MAX_FROZEN_COLUMNS = 3;
const EMPTY_STRING_ARRAY: readonly string[] = [];
const EMPTY_SORT_STACK: SortStack = [];

type DataTableSurfaceState = {
  density: DensityLevel;
  filters: FilterPredicate[];
  frozenColumns: string[];
  hiddenColumns: string[];
  sortStack: SortStack;
};

type DataTableSurfacePatch =
  | Partial<DataTableSurfaceState>
  | ((current: DataTableSurfaceState) => Partial<DataTableSurfaceState>);

function dataTableSurfaceReducer(
  state: DataTableSurfaceState,
  patch: DataTableSurfacePatch,
): DataTableSurfaceState {
  return {
    ...state,
    ...(typeof patch === "function" ? patch(state) : patch),
  };
}

function createDataTableSurfaceFieldPatch<K extends keyof DataTableSurfaceState>(
  field: K,
  value: SetStateAction<DataTableSurfaceState[K]>,
): DataTableSurfacePatch {
  return (current) => {
    const nextValue =
      typeof value === "function"
        ? (value as (previous: DataTableSurfaceState[K]) => DataTableSurfaceState[K])(current[field])
        : value;
    return { [field]: nextValue } as Partial<DataTableSurfaceState>;
  };
}

export function DataTableSurface<T>({
  columns,
  defaultDensity = "comfortable",
  defaultFrozenColumns,
  defaultHiddenColumns = EMPTY_STRING_ARRAY,
  defaultSort = EMPTY_SORT_STACK,
  dictionary,
  expandRow,
  footer,
  groupLabels,
  maxFrozenColumns = DEFAULT_MAX_FROZEN_COLUMNS,
  pagination,
  rowActionsLabel,
  rowActionsWidth,
  rows,
  surfaceClassName,
  tableClassName,
  toolbarClassName,
  toolbarAfter,
  toolbarStart,
  ...tableProps
}: DataTableSurfaceProps<T>) {
  const { t } = useLang();
  const initialFrozenColumns = useMemo(
    () => {
      if (defaultFrozenColumns) return defaultFrozenColumns;
      const pinnedColumnIds: string[] = [];
      for (const column of columns) {
        if (column.pinned === "left") {
          pinnedColumnIds.push(column.id);
        }
      }
      return pinnedColumnIds;
    },
    [columns, defaultFrozenColumns],
  );

  const [surfaceState, dispatchSurfaceState] = useReducer(
    dataTableSurfaceReducer,
    undefined,
    (): DataTableSurfaceState => ({
      density: defaultDensity,
      filters: [],
      frozenColumns: initialFrozenColumns.slice(),
      hiddenColumns: defaultHiddenColumns.slice(),
      sortStack: defaultSort.slice(),
    }),
  );
  const {
    density,
    filters,
    frozenColumns,
    hiddenColumns,
    sortStack,
  } = surfaceState;
  const setSurfaceField = <K extends keyof DataTableSurfaceState>(
    field: K,
    value: SetStateAction<DataTableSurfaceState[K]>,
  ) => dispatchSurfaceState(createDataTableSurfaceFieldPatch(field, value));
  const setFilters = (value: SetStateAction<FilterPredicate[]>) =>
    setSurfaceField("filters", value);
  const setFrozenColumns = (value: SetStateAction<string[]>) =>
    setSurfaceField("frozenColumns", value);
  const setHiddenColumns = (value: SetStateAction<string[]>) =>
    setSurfaceField("hiddenColumns", value);
  const setSortStack = (value: SetStateAction<SortStack>) =>
    setSurfaceField("sortStack", value);

  const visibleColumnIds = useMemo(
    () => new Set(columns.map((column) => column.id)),
    [columns],
  );

  const effectiveFrozenColumns = useMemo(
    () => frozenColumns.filter((id) => visibleColumnIds.has(id)),
    [frozenColumns, visibleColumnIds],
  );

  const effectiveHiddenColumns = useMemo(
    () => hiddenColumns.filter((id) => visibleColumnIds.has(id)),
    [hiddenColumns, visibleColumnIds],
  );

  const enhancedColumns = useMemo<ColumnDef<T>[]>(() => {
    const frozenSet = new Set(effectiveFrozenColumns);
    return columns.map((column) => {
      const isUtilityColumn =
        column.id === "actions" ||
        column.id === "preview" ||
        column.id.endsWith("_actions") ||
        column.id.endsWith(":actions");
      const pinned: ColumnDef<T>["pinned"] = frozenSet.has(column.id)
        ? "left"
        : column.pinned === "right"
          ? "right"
          : undefined;
      return {
        ...column,
        filterType: column.filterType ?? (isUtilityColumn ? undefined : "text"),
        pinned,
        sortable: column.sortable ?? !isUtilityColumn,
      };
    });
  }, [columns, effectiveFrozenColumns]);

  const accessors = useMemo(() => {
    const map: Record<string, ColumnDef<T>["accessor"]> = {};
    for (const column of enhancedColumns) {
      map[column.id] = column.accessor;
    }
    return map;
  }, [enhancedColumns]);

  const visibleRows = useMemo(() => {
    const filtered = applyFilters(rows, filters, { accessors });
    const sorted = applySort(filtered, sortStack, { accessors });
    // Child rows are injected after filtering/sorting so they always stay
    // attached directly under their parent row.
    return expandRow
      ? sorted.flatMap((row) => {
          const children = expandRow(row);
          return children && children.length > 0 ? [row, ...children] : [row];
        })
      : sorted;
  }, [accessors, expandRow, filters, rows, sortStack]);

  const paginationResetKey = pagination
    ? `${pagination.resetKey ?? ""}:${JSON.stringify(filters)}:${JSON.stringify(sortStack)}`
    : "";
  const paginationState = useDataTablePagination(
    visibleRows,
    paginationResetKey,
    pagination?.pageSize ?? Math.max(visibleRows.length, 1),
  );
  const renderedRows = pagination ? paginationState.pagedRows : visibleRows;

  const handleColumnFreezeChange = (columnId: string, frozen: boolean) => {
    if (frozen) {
      if (
        effectiveFrozenColumns.includes(columnId) ||
        effectiveFrozenColumns.length >= maxFrozenColumns
      ) {
        return;
      }
      setFrozenColumns([...effectiveFrozenColumns, columnId]);
      return;
    }
    setFrozenColumns(effectiveFrozenColumns.filter((id) => id !== columnId));
  };

  const footerNode =
    typeof footer === "function"
      ? footer({
          rows,
          visibleRows,
          filteredCount: visibleRows.length,
          totalCount: rows.length,
        })
      : footer ?? (
          <span className="tabular-nums">
            {visibleRows.length === rows.length
              ? `${rows.length}`
              : `${visibleRows.length} / ${rows.length}`}
          </span>
        );

  const labels = useMemo(() => ({ ...t, ...dictionary }), [dictionary, t]);

  return (
    <div
      className={cn(
        "space-y-0 overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm",
        surfaceClassName,
      )}
    >
      <div
        className={cn(
          "relative z-30 flex flex-wrap items-end gap-2 border-b border-border/70 bg-card p-2.5 sm:flex-nowrap sm:gap-1.5 sm:overflow-x-auto sm:px-3 sm:py-2 [&>button]:shrink-0",
          toolbarClassName,
        )}
      >
        {toolbarStart}
        <FilterBuilder
          columns={enhancedColumns}
          rows={rows}
          filters={filters}
          onChange={setFilters}
          translations={{
            addFilter: labels.table_filter,
            clearAll: labels.table_sort_clear,
            searchPlaceholder: labels.table_filter_search_fields,
            noFields: labels.table_filter_no_fields,
            remove: labels.table_filter_remove,
            valuePlaceholder: labels.table_filter_value,
            daysSuffix: labels.table_filter_days_suffix,
            yes: labels.common_yes,
            no: labels.common_no,
            operatorLabels: {
              contains: labels.filter_op_contains,
              does_not_contain: labels.filter_op_does_not_contain,
              is_empty: labels.filter_op_is_empty,
              is_not_empty: labels.filter_op_is_not_empty,
              is: labels.filter_op_is,
              is_not: labels.filter_op_is_not,
              is_any_of: labels.filter_op_is_any_of,
              is_none_of: labels.filter_op_is_none_of,
              has_any: labels.filter_op_has_any,
              has_all: labels.filter_op_has_all,
              has_none: labels.filter_op_has_none,
              before: labels.filter_op_before,
              after: labels.filter_op_after,
              between: labels.filter_op_between,
              last_n_days: labels.filter_op_last_n_days,
              equals: labels.filter_op_equals,
            },
          }}
        />
        <SortBuilder
          columns={enhancedColumns}
          value={sortStack}
          onChange={setSortStack}
          translations={{
            addSort: labels.table_sort_add,
            clearAll: labels.table_sort_clear,
            ascending: labels.table_sort_ascending,
            descending: labels.table_sort_descending,
            emptyHint: labels.common_sort,
            moveUp: labels.table_sort_move_up,
            moveDown: labels.table_sort_move_down,
            remove: labels.table_sort_remove,
          }}
        />
        <div className="flex items-center gap-1">
          <ColumnVisibilityMenu
            columns={enhancedColumns}
            hiddenColumns={effectiveHiddenColumns}
            onChange={setHiddenColumns}
            defaultHidden={defaultHiddenColumns}
            frozenColumns={effectiveFrozenColumns}
            onFrozenColumnsChange={setFrozenColumns}
            defaultFrozen={initialFrozenColumns}
            maxFrozenColumns={maxFrozenColumns}
            groupLabels={groupLabels}
            buttonLabel={labels.table_columns}
            searchPlaceholder={labels.table_columns_search}
            resetLabel={labels.common_reset}
            showAllLabel={labels.table_columns_show_all}
            hideAllLabel={labels.table_columns_hide_all}
            noMatchLabel={labels.common_no_results}
            requiredNoteLabel={labels.table_columns_required}
            freezeLabel={labels.table_columns_freeze}
            unfreezeLabel={labels.table_columns_unfreeze}
            frozenNoteLabel={labels.table_columns_frozen}
          />
        </div>
      </div>
      {toolbarAfter}
      {pagination ? (
        <DataTablePager
          className={pagination.className}
          pageIndex={paginationState.pageIndex}
          pageSize={paginationState.pageSize}
          totalPages={paginationState.totalPages}
          totalRows={paginationState.totalRows}
          previousLabel={labels.pagination_previous}
          nextLabel={labels.pagination_next}
          onPageChange={paginationState.onPageChange}
        />
      ) : null}
      <DataTable
        {...tableProps}
        rows={renderedRows}
        columns={enhancedColumns}
        hiddenColumns={effectiveHiddenColumns}
        sort={sortStack}
        onSortChange={setSortStack}
        onColumnFreezeChange={handleColumnFreezeChange}
        isColumnFreezeDisabled={(column, nextFrozen) =>
          nextFrozen &&
          !effectiveFrozenColumns.includes(column.id) &&
          effectiveFrozenColumns.length >= maxFrozenColumns
        }
        columnHeaderContextMenuLabels={{
          column: labels.table_columns,
          freeze: labels.table_columns_freeze,
          unfreeze: labels.table_columns_unfreeze,
          frozen: labels.table_columns_frozen,
          freezeLimitReached: labels.table_columns_freeze_limit,
        }}
        density={density}
        footer={footerNode}
        rowActionsLabel={
          rowActionsLabel ?? labels.table_actions
        }
        rowActionsWidth={rowActionsWidth}
        className={cn("rounded-none border-0 shadow-none", tableClassName)}
      />
    </div>
  );
}
