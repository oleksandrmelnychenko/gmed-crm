import { lazy, Suspense } from "react";
import { Archive, ArchiveRestore, Copy, Download, Edit3, X } from "lucide-react";

import { DataTable } from "@/components/data-table/data-table";
import { exportCsv } from "@/components/data-table/csv-export";
import { SplitView } from "@/components/data-table/split-view";
import type {
  ColumnDef,
  DensityLevel,
  SortStack,
  ViewMode,
} from "@/components/data-table/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { PatientSummary } from "../../model/list-model";
import type { PatientDetailSheetProps } from "../sheets/patient-list-detail-sheet";

const loadPatientListDetailSheet = () => import("../sheets/patient-list-detail-sheet");

const LazyPatientDetailSheet = lazy(async () => {
  const mod = await loadPatientListDetailSheet();
  return { default: mod.MemoizedPatientDetailSheet };
});

export function preloadPatientListDetailSheet() {
  void loadPatientListDetailSheet();
}

type PatientsTableSurfaceProps = {
  columns: ColumnDef<PatientSummary>[];
  density: DensityLevel;
  detailPaneProps: PatientDetailSheetProps;
  detailOpen: boolean;
  filteredCount: number;
  emptyLabel: string;
  frozenColumns: string[];
  hiddenColumns: string[];
  loading: boolean;
  maxFrozenColumns: number;
  onCloseDetail: () => void;
  onFrozenColumnsChange: (value: string[]) => void;
  onOpenPatient: (patientId: string) => void;
  onSelectionReset: () => void;
  onSelectedIdsChange: (value: string[]) => void;
  onSortChange: (value: SortStack) => void;
  onToggleArchive: (patient: PatientSummary) => void;
  permissionsCanCreateEdit: boolean;
  rows: PatientSummary[];
  selectedId: string;
  selectedIds: string[];
  sortStack: SortStack;
  t: Record<string, string>;
  totalCount: number;
  tr: Record<string, string>;
  viewMode: ViewMode;
};

export function PatientsTableSurface({
  columns,
  density,
  detailPaneProps,
  detailOpen,
  filteredCount,
  emptyLabel,
  frozenColumns,
  hiddenColumns,
  loading,
  maxFrozenColumns,
  onCloseDetail,
  onFrozenColumnsChange,
  onOpenPatient,
  onSelectionReset,
  onSelectedIdsChange,
  onSortChange,
  onToggleArchive,
  permissionsCanCreateEdit,
  rows,
  selectedId,
  selectedIds,
  sortStack,
  t,
  totalCount,
  tr,
  viewMode,
}: PatientsTableSurfaceProps) {
  function handleColumnFreezeChange(columnId: string, frozen: boolean) {
    if (frozen) {
      if (frozenColumns.includes(columnId) || frozenColumns.length >= maxFrozenColumns) return;
      onFrozenColumnsChange([...frozenColumns, columnId]);
      return;
    }
    onFrozenColumnsChange(frozenColumns.filter((id) => id !== columnId));
  }

  return (
    <SplitView
      active={detailOpen}
      viewMode={viewMode}
      onClose={onCloseDetail}
      pane={
        <div className="flex h-full flex-col">
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                {detailPaneProps.dictionary.common_loading}
              </div>
            }
          >
            <LazyPatientDetailSheet {...detailPaneProps} />
          </Suspense>
        </div>
      }
    >
      {selectedIds.length > 0 ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-primary/5 px-3 py-1.5 text-xs">
          <div className="flex items-center gap-2 text-foreground">
            <span className="tabular-nums font-medium">{selectedIds.length}</span>
            <span className="text-muted-foreground">selected</span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => {
                const selectedRows = rows.filter((patient) => selectedIds.includes(patient.id));
                const visibleCols = columns.filter(
                  (column) => !hiddenColumns.includes(column.id) || column.required,
                );
                const stamp = new Date().toISOString().slice(0, 10);
                exportCsv(selectedRows, visibleCols, `patients-selected-${stamp}.csv`);
              }}
            >
              <Download className="size-3" />
              {t.common_export ?? "Export"}
            </Button>
            <Button type="button" variant="ghost" size="xs" onClick={onSelectionReset}>
              <X className="size-3" />
              {t.common_reset}
            </Button>
          </div>
        </div>
      ) : null}
      <DataTable
        rows={rows}
        columns={columns}
        hiddenColumns={hiddenColumns}
        sort={sortStack}
        onSortChange={onSortChange}
        onColumnFreezeChange={handleColumnFreezeChange}
        isColumnFreezeDisabled={(column, nextFrozen) =>
          nextFrozen &&
          !frozenColumns.includes(column.id) &&
          frozenColumns.length >= maxFrozenColumns
        }
        columnHeaderContextMenuLabels={{
          column: tr.table_columns ?? "Column",
          freeze: tr.table_columns_freeze ?? "Freeze column",
          unfreeze: tr.table_columns_unfreeze ?? "Unfreeze column",
          frozen: tr.table_columns_frozen ?? "Frozen",
          freezeLimitReached: tr.table_columns_freeze_limit ?? "Freeze limit reached",
        }}
        density={density}
        rowId={(patient) => patient.id}
        activeRowId={selectedId}
        onRowClick={(patient) => onOpenPatient(patient.id)}
        rowActions={(patient) => (
          <>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(patient.patient_id);
              }}
              title="Copy ID"
              aria-label="Copy ID"
              className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Copy className="size-3" />
            </button>
            <button
              type="button"
              onClick={() => onOpenPatient(patient.id)}
              title={t.patients_edit ?? "Edit"}
              aria-label={t.patients_edit ?? "Edit"}
              className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Edit3 className="size-3" />
            </button>
            {permissionsCanCreateEdit ? (
              <button
                type="button"
                onClick={() => onToggleArchive(patient)}
                title={patient.is_active ? (tr.patients_archive ?? "Archive") : (tr.patients_reactivate ?? "Reactivate")}
                aria-label={patient.is_active ? (tr.patients_archive ?? "Archive") : (tr.patients_reactivate ?? "Reactivate")}
                className={cn(
                  "inline-flex size-6 items-center justify-center rounded-md transition-colors",
                  patient.is_active
                    ? "text-muted-foreground hover:bg-muted hover:text-amber-700"
                    : "text-muted-foreground hover:bg-muted hover:text-emerald-700",
                )}
              >
                {patient.is_active ? <Archive className="size-3" /> : <ArchiveRestore className="size-3" />}
              </button>
            ) : null}
          </>
        )}
        selectedIds={selectedIds}
        onSelectedIdsChange={onSelectedIdsChange}
        selectionEnabled={false}
        loading={loading}
        emptyState={<span className="text-sm text-muted-foreground">{emptyLabel}</span>}
        className="min-h-[400px]"
        footer={
          <div className="flex items-center justify-between">
            <span className="tabular-nums">
              {filteredCount === totalCount
                ? `${totalCount}`
                : `${filteredCount} / ${totalCount}`}{" "}
              {t.patients_title.toLowerCase()}
            </span>
            {selectedIds.length > 0 ? (
              <span className="tabular-nums">{selectedIds.length} selected</span>
            ) : null}
          </div>
        }
      />
    </SplitView>
  );
}
