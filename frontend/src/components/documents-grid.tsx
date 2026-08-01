import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";

import { ColumnVisibilityMenu } from "@/components/data-table/column-visibility-menu";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableSurface } from "@/components/data-table/data-table-surface";
import { applyFilters } from "@/components/data-table/filter-logic";
import { FilterBuilder } from "@/components/data-table/filter-builder";
import { applySort } from "@/components/data-table/sort-logic";
import { SortBuilder } from "@/components/data-table/sort-builder";
import type {
  ColumnDef,
  DensityLevel,
  FilterPredicate,
  SortStack,
} from "@/components/data-table/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { uiText, useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  DEFAULT_DOCUMENT_PAGE_SIZE,
  DOCUMENT_PAGE_SIZE_OPTIONS,
  buildDocumentPage,
} from "@/pages/documents/model/document-pagination";

type DocumentsGridItem = {
  id: string;
  auto_name: string;
  original_filename: string | null;
  version_number: number;
  is_latest_version: boolean;
  patient_name: string | null;
  patient_pid: string | null;
  art: string;
  category: string | null;
  status: string;
  visibility: string;
  data_sensitivity: string;
  file_size: number | null;
  uploaded_by_name: string | null;
  updated_at: string;
  needs_categorization: boolean;
};

type DocumentsGridLabels = {
  selectBulkShare: string;
  filename: string;
  patient: string;
  category: string;
  status: string;
  visibility: string;
  size: string;
  uploadedBy: string;
  unclassified: string;
  current: string;
  pidFallback: string;
  notSet: string;
  unknownUploader: string;
  needsCategorization: string;
};

type DocumentsGridProps = {
  documents: DocumentsGridItem[];
  selectedDocumentIds: string[];
  selectedId: string | null;
  showSelection?: boolean;
  labels: DocumentsGridLabels;
  localizeCode: (value: string) => string;
  onSelectionChange: (ids: string[]) => void;
  onToggleSelection: (id: string, checked: boolean) => void;
  onOpenDocument: (id: string) => void;
  statusBadge: (value: string) => string;
  visibilityBadge: (value: string) => string;
  sensitivityBadge: (value: string) => string;
  formatStatusLabel: (value: string) => string;
  formatVisibilityLabel: (value: string) => string;
  formatSensitivityLabel: (value: string) => string;
  formatFileSize: (value: number | null) => string;
  formatDateTime: (value?: string | null) => string;
  paginated?: boolean;
  paginationResetKey?: string;
  rowHeightOverrides?: Partial<Record<DensityLevel, number>>;
};

type PaginatedDocumentsTableProps = {
  columns: readonly ColumnDef<DocumentsGridItem>[];
  documents: readonly DocumentsGridItem[];
  filenameLabel: string;
  onOpenDocument: (id: string) => void;
  onSelectionChange: (ids: string[]) => void;
  paginationResetKey: string;
  rowHeightOverrides?: Partial<Record<DensityLevel, number>>;
  selectedDocumentIds: string[];
  selectedId: string | null;
  showSelection: boolean;
};

function PaginatedDocumentsTable({
  columns,
  documents,
  filenameLabel,
  onOpenDocument,
  onSelectionChange,
  paginationResetKey,
  rowHeightOverrides,
  selectedDocumentIds,
  selectedId,
  showSelection,
}: PaginatedDocumentsTableProps) {
  const { t } = useLang();
  const [filters, setFilters] = useState<FilterPredicate[]>([]);
  const [sortStack, setSortStack] = useState<SortStack>([
    { field: "updated_at", dir: "desc" },
  ]);
  const [hiddenColumns, setHiddenColumns] = useState<string[]>(["updated_at"]);
  const [frozenColumns, setFrozenColumns] = useState<string[]>(["filename"]);
  const [paginationState, setPaginationState] = useState(() => ({
    pageIndex: 0,
    pageSize: DEFAULT_DOCUMENT_PAGE_SIZE,
    resetKey: paginationResetKey,
  }));
  const pageIndex =
    paginationState.resetKey === paginationResetKey
      ? paginationState.pageIndex
      : 0;
  const pageSize = paginationState.pageSize;

  function setPageIndex(nextPageIndex: number) {
    setPaginationState((current) => ({
      ...current,
      pageIndex: nextPageIndex,
      resetKey: paginationResetKey,
    }));
  }

  function setPageSize(nextPageSize: number) {
    setPaginationState({
      pageIndex: 0,
      pageSize: nextPageSize,
      resetKey: paginationResetKey,
    });
  }

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
  const enhancedColumns = useMemo<ColumnDef<DocumentsGridItem>[]>(() => {
    const frozenSet = new Set(effectiveFrozenColumns);
    return columns.map((column) => ({
      ...column,
      filterType: column.filterType ?? "text",
      pinned: frozenSet.has(column.id) ? "left" : undefined,
      sortable: column.sortable ?? true,
    }));
  }, [columns, effectiveFrozenColumns]);
  const accessors = useMemo(
    () =>
      Object.fromEntries(
        enhancedColumns.map((column) => [column.id, column.accessor]),
      ),
    [enhancedColumns],
  );
  const visibleRows = useMemo(
    () =>
      applySort(applyFilters(documents, filters, { accessors }), sortStack, {
        accessors,
      }),
    [accessors, documents, filters, sortStack],
  );
  const page = useMemo(
    () => buildDocumentPage(visibleRows, pageIndex, pageSize),
    [pageIndex, pageSize, visibleRows],
  );
  const pageIdSet = useMemo(
    () => new Set(page.rows.map((document) => document.id)),
    [page.rows],
  );
  const pageSelectedIds = useMemo(
    () => selectedDocumentIds.filter((id) => pageIdSet.has(id)),
    [pageIdSet, selectedDocumentIds],
  );

  function updateFilters(next: FilterPredicate[]) {
    setFilters(next);
    setPageIndex(0);
  }

  function updateSort(next: SortStack) {
    setSortStack(next);
    setPageIndex(0);
  }

  function updatePageSelection(nextPageIds: string[]) {
    const preservedIds = selectedDocumentIds.filter((id) => !pageIdSet.has(id));
    onSelectionChange([...preservedIds, ...nextPageIds]);
  }

  function updateColumnFreeze(columnId: string, frozen: boolean) {
    if (frozen) {
      if (
        effectiveFrozenColumns.includes(columnId) ||
        effectiveFrozenColumns.length >= 3
      ) {
        return;
      }
      setFrozenColumns([...effectiveFrozenColumns, columnId]);
      return;
    }
    setFrozenColumns(effectiveFrozenColumns.filter((id) => id !== columnId));
  }

  return (
    <div className="space-y-2">
      <div className="relative z-30 flex flex-wrap items-center gap-1.5 border-b border-border/70 px-3 py-2">
        <FilterBuilder
          columns={enhancedColumns}
          rows={documents}
          filters={filters}
          onChange={updateFilters}
        />
        <SortBuilder
          columns={enhancedColumns}
          value={sortStack}
          onChange={updateSort}
        />
        <ColumnVisibilityMenu
          columns={enhancedColumns}
          hiddenColumns={effectiveHiddenColumns}
          onChange={setHiddenColumns}
          defaultHidden={["updated_at"]}
          frozenColumns={effectiveFrozenColumns}
          onFrozenColumnsChange={setFrozenColumns}
          defaultFrozen={["filename"]}
          maxFrozenColumns={3}
        />
      </div>
      <DataTable
        rows={page.rows}
        columns={enhancedColumns}
        hiddenColumns={effectiveHiddenColumns}
        sort={sortStack}
        onSortChange={updateSort}
        onColumnFreezeChange={updateColumnFreeze}
        isColumnFreezeDisabled={(column, nextFrozen) =>
          nextFrozen &&
          !effectiveFrozenColumns.includes(column.id) &&
          effectiveFrozenColumns.length >= 3
        }
        rowId={(document) => document.id}
        activeRowId={selectedId}
        selectionEnabled={showSelection}
        selectedIds={pageSelectedIds}
        onSelectedIdsChange={updatePageSelection}
        onRowClick={(document) => onOpenDocument(document.id)}
        className="min-h-[360px] rounded-none border-0 shadow-none"
        rowHeightOverrides={rowHeightOverrides}
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="tabular-nums">
              {page.start}-{page.end} / {visibleRows.length}{" "}
              {filenameLabel.toLowerCase()}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 whitespace-nowrap">
                <span>{t.pagination_per_page}</span>
                <NativeComboboxSelect
                  value={String(pageSize)}
                  onChange={(event) => {
                    setPageSize(Number(event.target.value));
                  }}
                  className="h-7 w-[76px] rounded-lg bg-background text-xs"
                  aria-label={t.pagination_per_page}
                >
                  {DOCUMENT_PAGE_SIZE_OPTIONS.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </NativeComboboxSelect>
              </label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7"
                disabled={page.pageIndex === 0}
                onClick={() => setPageIndex(page.pageIndex - 1)}
              >
                <ChevronLeft className="size-3.5" />
                {t.pagination_previous}
              </Button>
              <span className="min-w-14 text-center tabular-nums">
                {page.pageIndex + 1} / {page.totalPages}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7"
                disabled={page.pageIndex >= page.totalPages - 1}
                onClick={() => setPageIndex(page.pageIndex + 1)}
              >
                {t.pagination_next}
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
          </div>
        }
      />
    </div>
  );
}

export function DocumentsGrid({
  documents,
  selectedDocumentIds,
  selectedId,
  showSelection = true,
  labels,
  localizeCode,
  onSelectionChange,
  onOpenDocument,
  statusBadge,
  visibilityBadge,
  sensitivityBadge,
  formatStatusLabel,
  formatVisibilityLabel,
  formatSensitivityLabel,
  formatFileSize,
  formatDateTime,
  paginated = false,
  paginationResetKey = "",
  rowHeightOverrides,
}: DocumentsGridProps) {
  const {
    filename: filenameLabel,
    patient: patientLabel,
    category: categoryLabel,
    status: statusLabel,
    visibility: visibilityLabel,
    size: sizeLabel,
    uploadedBy: uploadedByLabel,
    unclassified: unclassifiedLabel,
    current: currentVersionLabel,
    pidFallback,
    notSet,
    unknownUploader,
    needsCategorization,
  } = labels;

  const columns = useMemo<ColumnDef<DocumentsGridItem>[]>(() => [
    {
      id: "filename",
      label: filenameLabel,
      accessor: (item) => localizeCode(item.auto_name),
      sortable: true,
      searchable: true,
      required: true,
      pinned: "left",
      width: 300,
      render: (item) => (
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-medium text-foreground">
              {localizeCode(item.auto_name)}
            </span>
            {item.needs_categorization ? (
              <Badge
                variant="outline"
                className="shrink-0 rounded-full border-amber-200 bg-amber-50 text-[10px] text-amber-700"
              >
                {needsCategorization}
              </Badge>
            ) : null}
          </div>
          <div className="mt-0.5 flex items-center gap-x-1 text-[11px] text-muted-foreground">
            <span className="truncate">
              {item.original_filename ?? unclassifiedLabel}
            </span>
            <span className="text-muted-foreground/60">·</span>
            <span>{uiText("common_version_prefix")}{item.version_number}</span>
            {item.is_latest_version ? (
              <>
                <span className="text-muted-foreground/60">·</span>
                <span>{currentVersionLabel}</span>
              </>
            ) : null}
          </div>
        </div>
      ),
    },
    {
      id: "patient",
      label: patientLabel,
      accessor: (item) => item.patient_name ?? "",
      sortable: true,
      searchable: true,
      width: 210,
      render: (item) =>
        item.patient_name ? (
          <div className="min-w-0">
            <span className="font-mono text-[11px] text-muted-foreground">
              {item.patient_pid ?? pidFallback}
            </span>
            <div className="truncate text-xs text-foreground">{item.patient_name}</div>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">{notSet}</span>
        ),
    },
    {
      id: "category",
      label: categoryLabel,
      accessor: (item) => `${item.art ?? ""} ${item.category ?? ""}`.trim(),
      sortable: true,
      searchable: true,
      width: 210,
      render: (item) =>
        item.art || item.category ? (
          <div className="min-w-0">
            {item.art ? (
              <div className="truncate text-xs text-foreground">
                {localizeCode(item.art)}
              </div>
            ) : null}
            {item.category ? (
              <div className="truncate text-[11px] text-muted-foreground">
                {localizeCode(item.category)}
              </div>
            ) : null}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">{unclassifiedLabel}</span>
        ),
    },
    {
      id: "status",
      label: statusLabel,
      accessor: (item) => item.status,
      sortable: true,
      width: 140,
      render: (item) => (
        <Badge
          variant="outline"
          className={cn("rounded-full text-[10px]", statusBadge(item.status))}
        >
          {formatStatusLabel(item.status)}
        </Badge>
      ),
    },
    {
      id: "visibility",
      label: visibilityLabel,
      accessor: (item) => `${item.visibility} ${item.data_sensitivity}`,
      sortable: true,
      width: 170,
      render: (item) => (
        <div className="flex flex-col items-start gap-1">
          <Badge
            variant="outline"
            className={cn("rounded-full text-[10px]", visibilityBadge(item.visibility))}
          >
            {formatVisibilityLabel(item.visibility)}
          </Badge>
          <Badge
            variant="outline"
            className={cn(
              "rounded-full text-[10px]",
              sensitivityBadge(item.data_sensitivity),
            )}
          >
            {formatSensitivityLabel(item.data_sensitivity)}
          </Badge>
        </div>
      ),
    },
    {
      id: "size",
      label: sizeLabel,
      accessor: (item) => item.file_size,
      sortable: true,
      width: 110,
      render: (item) => (
        <span className="block text-right tabular-nums text-muted-foreground">
          {formatFileSize(item.file_size)}
        </span>
      ),
    },
    {
      id: "uploaded_by",
      label: uploadedByLabel,
      accessor: (item) => item.uploaded_by_name ?? "",
      sortable: true,
      searchable: true,
      width: 210,
      render: (item) => (
        <div className="min-w-0">
          <div className="truncate text-xs text-foreground">
            {item.uploaded_by_name || unknownUploader}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {formatDateTime(item.updated_at)}
          </div>
        </div>
      ),
    },
    {
      id: "updated_at",
      label: uploadedByLabel,
      accessor: (item) => item.updated_at,
      sortable: true,
      defaultVisible: false,
      width: 0,
    },
  ], [
    categoryLabel,
    currentVersionLabel,
    filenameLabel,
    formatDateTime,
    formatFileSize,
    formatSensitivityLabel,
    formatStatusLabel,
    formatVisibilityLabel,
    localizeCode,
    needsCategorization,
    notSet,
    patientLabel,
    pidFallback,
    sensitivityBadge,
    sizeLabel,
    statusBadge,
    statusLabel,
    unclassifiedLabel,
    unknownUploader,
    uploadedByLabel,
    visibilityBadge,
    visibilityLabel,
  ]);

  if (paginated) {
    return (
      <PaginatedDocumentsTable
        columns={columns}
        documents={documents}
        filenameLabel={filenameLabel}
        onOpenDocument={onOpenDocument}
        onSelectionChange={onSelectionChange}
        paginationResetKey={paginationResetKey}
        rowHeightOverrides={rowHeightOverrides}
        selectedDocumentIds={selectedDocumentIds}
        selectedId={selectedId}
        showSelection={showSelection}
      />
    );
  }

  return (
    <DataTableSurface
      rows={documents}
      columns={columns}
      defaultHiddenColumns={["updated_at"]}
      defaultSort={[{ field: "updated_at", dir: "desc" }]}
      rowId={(item) => item.id}
      activeRowId={selectedId}
      selectionEnabled={showSelection}
      selectedIds={selectedDocumentIds}
      onSelectedIdsChange={onSelectionChange}
      onRowClick={(item) => onOpenDocument(item.id)}
      tableClassName="min-h-[360px]"
      rowHeightOverrides={rowHeightOverrides}
      footer={({ filteredCount, totalCount }) => (
        <span className="tabular-nums">
          {filteredCount === totalCount
            ? `${totalCount}`
            : `${filteredCount} / ${totalCount}`}{" "}
          {filenameLabel.toLowerCase()}
        </span>
      )}
    />
  );
}
