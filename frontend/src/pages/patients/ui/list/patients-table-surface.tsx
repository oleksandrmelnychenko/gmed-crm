import { lazy, Suspense } from "react";

import { DataTable } from "@/components/data-table/data-table";
import { SplitView } from "@/components/data-table/split-view";
import type {
  ColumnDef,
  DensityLevel,
  SortStack,
  ViewMode,
} from "@/components/data-table/types";

import type { PatientSummary } from "../../model/list-model";
import type { PatientDetailSheetProps } from "../sheets/patient-list-detail-sheet";

const loadPatientListDetailSheet = () => import("../sheets/patient-list-detail-sheet");

const LazyPatientDetailSheet = lazy(async () => {
  const mod = await loadPatientListDetailSheet();
  return { default: mod.MemoizedPatientDetailSheet };
});

const PATIENT_TABLE_ROW_HEIGHTS: Partial<Record<DensityLevel, number>> = {
  comfortable: 56,
  compact: 48,
  condensed: 40,
};

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
  onSortChange: (value: SortStack) => void;
  rows: PatientSummary[];
  selectedId: string;
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
  onSortChange,
  rows,
  selectedId,
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
          column: tr.table_columns,
          freeze: tr.table_columns_freeze,
          unfreeze: tr.table_columns_unfreeze,
          frozen: tr.table_columns_frozen,
          freezeLimitReached: tr.table_columns_freeze_limit,
        }}
        density={density}
        rowHeightOverrides={PATIENT_TABLE_ROW_HEIGHTS}
        rowId={(patient) => patient.id}
        activeRowId={selectedId}
        onRowClick={(patient) => onOpenPatient(patient.id)}
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
          </div>
        }
      />
    </SplitView>
  );
}
