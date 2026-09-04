import { useMemo, useState } from "react";

import { ColumnVisibilityMenu } from "@/components/data-table/column-visibility-menu";
import { DataTablePager } from "@/components/data-table/data-table-pager";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableSurface } from "@/components/data-table/data-table-surface";
import { createDocumentPreviewColumn } from "@/components/data-table/document-preview-column";
import { applyFilters } from "@/components/data-table/filter-logic";
import { FilterBuilder } from "@/components/data-table/filter-builder";
import { applySort } from "@/components/data-table/sort-logic";
import { SortBuilder } from "@/components/data-table/sort-builder";
import type {
  ColumnDef,
  FilterPredicate,
  SortStack,
} from "@/components/data-table/types";
import { Badge } from "@/components/ui/badge";
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
  preview?: string;
  filename: string;
  patient: string;
  category: string;
  status: string;
  visibility: string;
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
  onPreviewDocument?: (id: string, title: string) => void;
  statusBadge: (value: string) => string;
  visibilityBadge: (value: string) => string;
  sensitivityBadge: (value: string) => string;
  formatStatusLabel: (value: string) => string;
  formatVisibilityLabel: (value: string) => string;
  formatSensitivityLabel: (value: string) => string;
  formatDateTime: (value?: string | null) => string;
  paginated?: boolean;
  paginationResetKey?: string;
};

type PaginatedDocumentsTableProps = {
  columns: readonly ColumnDef<DocumentsGridItem>[];
  documents: readonly DocumentsGridItem[];
  filenameLabel: string;
  onOpenDocument: (id: string) => void;
  onSelectionChange: (ids: string[]) => void;
  paginationResetKey: string;
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
  const defaultFrozenColumns = useMemo(
    () =>
      columns.some((column) => column.id === "preview")
        ? ["preview", "filename"]
        : ["filename"],
    [columns],
  );
  const [frozenColumns, setFrozenColumns] = useState<string[]>(
    defaultFrozenColumns,
  );
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
      filterType:
        column.id === "preview" ? undefined : (column.filterType ?? "text"),
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
    <div className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm">
      <div className="relative z-30 flex flex-wrap items-center gap-2 border-b border-border/70 bg-card p-2.5 sm:flex-nowrap sm:gap-1.5 sm:overflow-x-auto sm:px-3 sm:py-2">
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
          defaultFrozen={defaultFrozenColumns}
          maxFrozenColumns={3}
        />
      </div>
      <DataTablePager
        pageIndex={page.pageIndex}
        pageSize={pageSize}
        totalPages={page.totalPages}
        totalRows={visibleRows.length}
        previousLabel={t.pagination_previous}
        nextLabel={t.pagination_next}
        onPageChange={setPageIndex}
        controlsStart={
          <label className="mr-1 flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
            <span>{t.pagination_per_page}</span>
            <NativeComboboxSelect
              value={String(pageSize)}
              onChange={(event) => setPageSize(Number(event.target.value))}
              className="h-7 w-[76px] rounded-md bg-field text-xs"
              aria-label={t.pagination_per_page}
            >
              {DOCUMENT_PAGE_SIZE_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </NativeComboboxSelect>
          </label>
        }
      />
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
        footer={`${visibleRows.length} ${filenameLabel.toLowerCase()}`}
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
  onPreviewDocument,
  statusBadge,
  visibilityBadge,
  sensitivityBadge,
  formatStatusLabel,
  formatVisibilityLabel,
  formatSensitivityLabel,
  formatDateTime,
  paginated = false,
  paginationResetKey = "",
}: DocumentsGridProps) {
  const {
    preview: previewLabel,
    filename: filenameLabel,
    patient: patientLabel,
    category: categoryLabel,
    status: statusLabel,
    visibility: visibilityLabel,
    uploadedBy: uploadedByLabel,
    unclassified: unclassifiedLabel,
    current: currentVersionLabel,
    pidFallback,
    notSet,
    unknownUploader,
    needsCategorization,
  } = labels;

  const columns = useMemo<ColumnDef<DocumentsGridItem>[]>(() => [
    ...(onPreviewDocument && previewLabel
      ? [
          createDocumentPreviewColumn<DocumentsGridItem>({
            getId: (item) => item.id,
            getTitle: (item) =>
              item.original_filename ?? localizeCode(item.auto_name),
            label: previewLabel,
            onPreview: (item) =>
              onPreviewDocument(
                item.id,
                item.original_filename ?? localizeCode(item.auto_name),
              ),
          }),
        ]
      : []),
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
        <div
          className="flex min-w-0 items-center gap-2"
          title={`${item.original_filename ?? unclassifiedLabel} · ${uiText("common_version_prefix")}${item.version_number}${item.is_latest_version ? ` · ${currentVersionLabel}` : ""}`}
        >
          <span className="truncate text-xs font-medium text-foreground">
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
          <span
            className="block truncate font-mono text-xs text-foreground"
            title={item.patient_pid ?? undefined}
          >
            {item.patient_name}
          </span>
        ) : (
          <span className="text-xs text-foreground">{notSet}</span>
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
          <span
            className="inline-flex max-w-full truncate rounded-md border border-sky-200 bg-sky-50 px-1.5 py-0.5 font-mono text-[11px] font-medium text-sky-700"
            title={item.category ? localizeCode(item.category) : undefined}
          >
            {localizeCode(item.art ?? item.category ?? "")}
          </span>
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
        <div className="flex min-w-0 items-center gap-1">
          <Badge
            variant="outline"
            className={cn("shrink-0 rounded-full text-[10px]", visibilityBadge(item.visibility))}
          >
            {formatVisibilityLabel(item.visibility)}
          </Badge>
          <Badge
            variant="outline"
            className={cn(
              "shrink-0 rounded-full text-[10px]",
              sensitivityBadge(item.data_sensitivity),
            )}
          >
            {formatSensitivityLabel(item.data_sensitivity)}
          </Badge>
        </div>
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
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-xs text-foreground">
            {item.uploaded_by_name || unknownUploader}
          </span>
          <span className="shrink-0 font-mono text-xs tabular-nums text-foreground">
            {formatDateTime(item.updated_at)}
          </span>
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
    formatSensitivityLabel,
    formatStatusLabel,
    formatVisibilityLabel,
    localizeCode,
    needsCategorization,
    notSet,
    onPreviewDocument,
    patientLabel,
    pidFallback,
    previewLabel,
    sensitivityBadge,
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
