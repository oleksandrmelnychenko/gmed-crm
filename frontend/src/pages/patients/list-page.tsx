import {
  lazy,
  Suspense,
  useMemo,
} from "react";
import {
  Plus,
} from "lucide-react";

import { exportCsv } from "@/components/data-table/csv-export";
import { formatRelativeTime } from "@/components/data-table/relative-time";
import {
  DEFAULT_PATIENT_HIDDEN_COLUMNS,
  PATIENT_COLUMN_GROUPS,
} from "./ui/patients-columns";

import { Button } from "@/components/ui/button";
import { Banner, tokens } from "@/components/ui-shell";
import { useAuth } from "@/lib/auth";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import {
  canAssignTarget,
  patientPermissions,
} from "./model/list-model";
import { usePatientDetailSheetData } from "./data/use-patient-detail-sheet-data";
import { usePatientsListActions } from "./data/use-patients-list-actions";
import { usePatientsListData } from "./data/use-patients-list-data";
import { usePatientDetailSheetSession } from "./ui/hooks/use-patient-detail-sheet-session";
import { usePatientsListTableModel } from "./ui/hooks/use-patients-list-table-model";
import { usePatientsListViewState } from "./ui/hooks/use-patients-list-view-state";
import { PatientsListToolbar } from "./ui/list/patients-list-toolbar";
import { PatientsTableSurface, preloadPatientListDetailSheet } from "./ui/list/patients-table-surface";

const loadCreatePatientSheet = () => import("./ui/sheets/create-patient-sheet");
const loadPatientsShortcutsDialog = () => import("./ui/list/patients-shortcuts-dialog");

const LazyCreatePatientSheet = lazy(async () => {
  const mod = await loadCreatePatientSheet();
  return { default: mod.MemoizedCreatePatientSheet };
});

const LazyPatientsShortcutsDialog = lazy(async () => {
  const mod = await loadPatientsShortcutsDialog();
  return { default: mod.PatientsShortcutsDialog };
});


export function PatientsPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const { staffGo } = useStaffNavigate();
  const permissions = useMemo(() => patientPermissions(user?.role), [user?.role]);
  const showStats = true;
  const {
    clearAllFilters,
    createOpen,
    deferredSearch,
    density,
    detailOpen,
    detailVersion,
    filterPredicates,
    filters,
    handleCreateOpenChange,
    handleDetailOpenChange,
    helpOpen,
    hiddenColumns,
    listVersion,
    openPatient,
    refreshDetail,
    refreshList,
    searchInputRef,
    selectedId,
    selectedIds,
    setDensity,
    setFilterPredicates,
    setFilters,
    setHelpOpen,
    setHiddenColumns,
    setSelectedIds,
    setSortStack,
    sortStack,
    syncQuery,
    viewMode,
  } = usePatientsListViewState();

  const effectiveFilters = useMemo(
    () => ({ ...filters, search: deferredSearch || filters.search }),
    [deferredSearch, filters]
  );
  const commonFailedLoad = t.common_failed_load;
  const {
    doctors,
    lastUpdated,
    listBusy,
    listError,
    patients,
    providers,
    setListError,
    setPatients,
  } = usePatientsListData({
    canViewPage: permissions.canViewPage,
    commonFailedLoad,
    filters: effectiveFilters,
    listVersion,
  });
  const {
    assignments,
    detail,
    detailBusy,
    detailError,
    staff,
  } = usePatientDetailSheetData({
    commonFailedLoad,
    detailOpen,
    detailVersion,
    permissions: {
      canManageAssignments: permissions.canManageAssignments,
      canViewAssignments: permissions.canViewAssignments,
    },
    selectedId,
  });
  const assignableStaff = useMemo(
    () => staff.filter((member) => canAssignTarget(user?.role, member.role)),
    [staff, user?.role]
  );
  const { columns, metrics, sortedAndFilteredPatients } = usePatientsListTableModel({
    deferredSearch,
    filterPredicates,
    patients,
    sortStack,
    tr,
  });
  const { handleToggleArchive } = usePatientsListActions({
    failedToggleMessage: "Failed to update patient status",
    setListError,
    setPatients,
  });
  const {
    assignmentBusy,
    assignmentError,
    handleAssignPatient,
    selectedAssignee,
    setSelectedAssignee,
  } = usePatientDetailSheetSession({
    detailId: detail?.id,
    detailOpen,
    failedAssignMessage: t.common_failed_assign,
    refreshDetail,
  });

  function handlePatientCreated(patientId: string) {
    staffGo(`/patients/${patientId}`);
  }

  function handleDetailSaved() {
    refreshList();
    refreshDetail();
  }

  if (!permissions.canViewPage) {
    return (
      <div className="space-y-6">
        <section
          className={cn("rounded-xl p-8", tokens.surface.softCard)}
        >
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
            Patient registry
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">
            This workspace is available only to staff roles with patient access.
          </p>
        </section>
      </div>
    );
  }

  const anyTopFilterActive =
    filters.activeOnly !== "true" ||
    filters.providerId !== "" ||
    filters.doctorId !== "" ||
    filterPredicates.length > 0;

  function openCreateSheet() {
    void loadCreatePatientSheet();
    handleCreateOpenChange(true);
  }

  function handleOpenPatient(patientId: string) {
    preloadPatientListDetailSheet();
    openPatient(patientId);
  }

  function openShortcutsDialog() {
    void loadPatientsShortcutsDialog();
    setHelpOpen(true);
  }

  const tallyParts: string[] = [
    `${metrics.total} ${t.patients_title.toLowerCase()}`,
    `${metrics.active} ${t.common_active.toLowerCase()}`,
  ];

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {/* Title + inline tally + primary CTA */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-baseline gap-2">
            <h1 className="text-[22px] font-semibold tracking-tight text-foreground leading-tight">
              {t.patients_title}
            </h1>
            {showStats ? (
              <span className="text-xs text-muted-foreground tabular-nums">
                · {tallyParts.join(" · ")}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-1.5">
            {permissions.canCreateEdit ? (
              <Button
                type="button"
                size="sm"
                onClick={openCreateSheet}
              >
                <Plus className="size-3.5" />
                {t.patients_new}
              </Button>
            ) : null}
          </div>
        </div>

        <PatientsListToolbar
          anyTopFilterActive={anyTopFilterActive}
          columns={columns}
          defaultHiddenColumns={DEFAULT_PATIENT_HIDDEN_COLUMNS}
          deferredSearchPlaceholder={t.common_search}
          density={density}
          doctors={doctors}
          exportLabel={t.common_export ?? "Export"}
          filterPredicates={filterPredicates}
          filters={filters}
          groupLabels={PATIENT_COLUMN_GROUPS}
          hiddenColumns={hiddenColumns}
          lastUpdatedText={lastUpdated ? formatRelativeTime(lastUpdated) : null}
          listBusy={listBusy}
          onActiveFilterChange={(value) => {
            setFilters((current) => ({ ...current, activeOnly: value }));
          }}
          onClearAll={clearAllFilters}
          onDensityChange={setDensity}
          onDoctorFilterChange={(value) => {
            setFilters((current) => ({ ...current, doctorId: value }));
            syncQuery({ doctor: value || null });
          }}
          onExport={() => {
            const visibleCols = columns.filter(
              (column) => !hiddenColumns.includes(column.id) || column.required,
            );
            const stamp = new Date().toISOString().slice(0, 10);
            exportCsv(sortedAndFilteredPatients, visibleCols, `patients-${stamp}.csv`);
          }}
          onFiltersChange={setFilterPredicates}
          onHiddenColumnsChange={setHiddenColumns}
          onProviderFilterChange={(value) => {
            setFilters((current) => ({ ...current, providerId: value, doctorId: "" }));
            syncQuery({ provider: value || null, doctor: null });
          }}
          onRefresh={refreshList}
          onSearchChange={(value) => {
            setFilters((current) => ({ ...current, search: value }));
          }}
          onSearchEscape={(input) => {
            setFilters((current) => ({ ...current, search: "" }));
            input.blur();
          }}
          onShortcutsOpen={openShortcutsDialog}
          onSortChange={setSortStack}
          providers={providers}
          refreshLabel={t.common_refresh ?? "Refresh"}
          rows={patients}
          searchInputRef={searchInputRef}
          sortStack={sortStack}
          t={tr}
        />

        {listError ? <Banner tone="error">{listError}</Banner> : null}

        <PatientsTableSurface
          columns={columns}
          density={density}
          detailOpen={detailOpen}
          detailPaneProps={{
            open: detailOpen,
            detail,
            detailBusy,
            detailError,
            dictionary: tr,
            canCreateEdit: permissions.canCreateEdit,
            canViewAssignments: permissions.canViewAssignments,
            canManageAssignments: permissions.canManageAssignments,
            assignments,
            assignableStaff,
            selectedAssignee,
            assignmentBusy,
            assignmentError,
            onAssigneeChange: setSelectedAssignee,
            onAssign: handleAssignPatient,
            onOpenChange: handleDetailOpenChange,
            onRefresh: handleDetailSaved,
            onOpenCases: () => detail ? staffGo(`/cases?patient=${detail.id}`) : undefined,
            onOpenOrders: () => detail ? staffGo(`/orders?patient=${detail.id}`) : undefined,
            onOpenAppointments: () => detail ? staffGo(`/appointments?patient=${detail.id}`) : undefined,
            onOpenContracts: () => detail ? staffGo(`/contracts?patient=${detail.id}`) : undefined,
            onOpenDocuments: () => detail ? staffGo(`/documents?patient=${detail.id}`) : undefined,
            hideWorkspaceActions: viewMode === "split",
          }}
          emptyLabel={t.patients_no_match}
          filteredCount={sortedAndFilteredPatients.length}
          hiddenColumns={hiddenColumns}
          loading={listBusy && patients.length === 0}
          onCloseDetail={() => handleDetailOpenChange(false)}
          onOpenPatient={handleOpenPatient}
          onSelectedIdsChange={setSelectedIds}
          onSelectionReset={() => setSelectedIds([])}
          onSortChange={setSortStack}
          onToggleArchive={handleToggleArchive}
          permissionsCanCreateEdit={permissions.canCreateEdit}
          rows={sortedAndFilteredPatients}
          selectedId={selectedId}
          selectedIds={selectedIds}
          sortStack={sortStack}
          t={tr}
          totalCount={patients.length}
          tr={tr}
          viewMode={viewMode}
        />
      </div>

      {createOpen ? (
        <Suspense fallback={null}>
          <LazyCreatePatientSheet
            open={createOpen}
            dictionary={tr}
            onOpenChange={handleCreateOpenChange}
            onCreated={handlePatientCreated}
          />
        </Suspense>
      ) : null}

      {helpOpen ? (
        <Suspense fallback={null}>
          <LazyPatientsShortcutsDialog
            open={helpOpen}
            closeLabel={t.common_close ?? "Close"}
            onClose={() => setHelpOpen(false)}
          />
        </Suspense>
      ) : null}
    </>
  );
}
