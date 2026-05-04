import { useMemo } from "react";

import { DataTableSurface } from "@/components/data-table/data-table-surface";
import type { ColumnDef, DensityLevel } from "@/components/data-table/types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

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
  rowHeightOverrides?: Partial<Record<DensityLevel, number>>;
};

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
            <span>v{item.version_number}</span>
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
