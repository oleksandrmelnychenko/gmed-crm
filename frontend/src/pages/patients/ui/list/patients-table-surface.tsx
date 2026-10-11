import { lazy, Suspense, type ReactNode } from "react";

import { DataTable } from "@/components/data-table/data-table";
import { SplitView } from "@/components/data-table/split-view";
import type {
  ColumnDef,
  DensityLevel,
  SortStack,
  ViewMode,
} from "@/components/data-table/types";
import { formatPluralCount, type Lang } from "@/lib/i18n";

import type { PatientSummary } from "../../model/list-model";
import type { PatientDetailSheetProps } from "../sheets/patient-list-detail-sheet";

const loadPatientListDetailSheet = () => import("../sheets/patient-list-detail-sheet");

const LazyPatientDetailSheet = lazy(async () => {
  const mod = await loadPatientListDetailSheet();
  return { default: mod.MemoizedPatientDetailSheet };
});

type PatientsTableSurfaceProps = {
  columns: ColumnDef<PatientSummary>[];
  density: DensityLevel;
  detailPaneProps: PatientDetailSheetProps;
  detailOpen: boolean;
  filteredCount: number;
  emptyLabel: string;
  frozenColumns: string[];
  hiddenColumns: string[];
  lang: Lang;
  loading: boolean;
  maxFrozenColumns: number;
  onCloseDetail: () => void;
  onFrozenColumnsChange: (value: string[]) => void;
  onOpenPatient: (patientId: string) => void;
  onSortChange: (value: SortStack) => void;
  rows: PatientSummary[];
  /** The expanded login row of a patient, if open. */
  renderRowDetail?: (row: PatientSummary) => ReactNode | null;
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
  lang,
  loading,
  maxFrozenColumns,
  onCloseDetail,
  onFrozenColumnsChange,
  onOpenPatient,
  onSortChange,
  rows,
  renderRowDetail,
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
        rowId={(patient) => patient.id}
        renderRowDetail={renderRowDetail}
        activeRowId={selectedId}
        onRowClick={(patient) => onOpenPatient(patient.id)}
        loading={loading}
        emptyState={<span className="text-sm text-muted-foreground">{emptyLabel}</span>}
        className="min-h-[400px] rounded-none border-0 shadow-none"
        footer={
          <div className="flex items-center justify-between">
            <span className="tabular-nums">
              {/* "1 пациент", "3 пациента", "12 / 40 пациентов": the noun follows the last number. */}
              {formatPluralCount(lang, totalCount, {
                one: t.patients_list_count_one,
                few: t.patients_list_count_few,
                many: t.patients_list_count_many,
              }, {
                count: filteredCount === totalCount ? `${totalCount}` : `${filteredCount} / ${totalCount}`,
              })}
            </span>
          </div>
        }
      />
    </SplitView>
  );
}
