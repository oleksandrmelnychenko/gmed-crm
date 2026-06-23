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
  DEFAULT_PATIENT_FROZEN_COLUMNS,
  DEFAULT_PATIENT_HIDDEN_COLUMNS,
  MAX_PATIENT_FROZEN_COLUMNS,
  patientColumnGroupLabels,
} from "./ui/patients-columns";

import { Button } from "@/components/ui/button";
import { Banner, tokens } from "@/components/ui-shell";
import { clearApiCache } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useDebouncedRealtimeSubscription } from "@/lib/realtime";

import {
  canAssignTarget,
  collectPatientInsuranceOptions,
  filterPatientsByInsurance,
  patientPermissions,
} from "./model/list-model";
import { usePatientDetailSheetData } from "./data/use-patient-detail-sheet-data";
import { usePatientsListData } from "./data/use-patients-list-data";
import { usePatientDetailSheetSession } from "./ui/hooks/use-patient-detail-sheet-session";
import { usePatientsListTableModel } from "./ui/hooks/use-patients-list-table-model";
import { usePatientsListViewState } from "./ui/hooks/use-patients-list-view-state";
import { PatientsListToolbar } from "./ui/list/patients-list-toolbar";
import { PatientsTableSurface } from "./ui/list/patients-table-surface";
import { useProviderTaxonomyNodes } from "@/pages/providers/data/use-provider-taxonomy-nodes";

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

function createPatientsExportFilename() {
  const stamp = new Date().toISOString().slice(0, 10);
  return `patients-${stamp}.csv`;
}

const PATIENT_REALTIME_EVENTS = [
  "patient.created",
  "patient.updated",
  "patient.assigned",
  "patient.assignment_revoked",
  "patient.activated",
  "patient.deactivated",
] as const;

type PatientsPageHeaderProps = {
  canCreate: boolean;
  createLabel: string;
  title: string;
  onCreate: () => void;
};

function PatientsPageHeader({
  canCreate,
  createLabel,
  title,
  onCreate,
}: PatientsPageHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-baseline gap-2">
        <h1 className="text-[22px] font-semibold tracking-tight text-foreground leading-tight">
          {title}
        </h1>
      </div>
      <div className="flex items-center gap-1.5">
        {canCreate ? (
          <Button
            type="button"
            size="sm"
            onClick={onCreate}
          >
            <Plus className="size-3.5" />
            {createLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

type PatientsPageSheetsProps = {
  closeLabel: string;
  createOpen: boolean;
  dictionary: Record<string, string>;
  helpOpen: boolean;
  onCreateOpenChange: (open: boolean) => void;
  onHelpClose: () => void;
  onPatientCreated: (patientId: string) => void;
};

function PatientsPageSheets({
  closeLabel,
  createOpen,
  dictionary,
  helpOpen,
  onCreateOpenChange,
  onHelpClose,
  onPatientCreated,
}: PatientsPageSheetsProps) {
  return (
    <>
      {createOpen ? (
        <Suspense fallback={null}>
          <LazyCreatePatientSheet
            open={createOpen}
            dictionary={dictionary}
            onOpenChange={onCreateOpenChange}
            onCreated={onPatientCreated}
          />
        </Suspense>
      ) : null}

      {helpOpen ? (
        <Suspense fallback={null}>
          <LazyPatientsShortcutsDialog
            open={helpOpen}
            closeLabel={closeLabel}
            t={dictionary}
            onClose={onHelpClose}
          />
        </Suspense>
      ) : null}
    </>
  );
}

export function PatientsPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const tr = t as unknown as Record<string, string> & { uiText?: Record<string, string> };
  const { staffGo } = useStaffNavigate();
  const permissions = useMemo(() => patientPermissions(user?.role), [user?.role]);
  const groupLabels = useMemo(() => patientColumnGroupLabels(tr), [tr]);
  const taxonomyNodes = useProviderTaxonomyNodes();
  const {
    clearAllFilters,
    createOpen,
    deferredSearch,
    density,
    detailOpen,
    detailVersion,
    filterPredicates,
    filters,
    frozenColumns,
    handleCreateOpenChange,
    handleDetailOpenChange,
    helpOpen,
    hiddenColumns,
    listVersion,
    refreshDetail,
    refreshList,
    searchInputRef,
    selectedId,
    setDensity,
    setFilterPredicates,
    setFilters,
    setFrozenColumns,
    setHelpOpen,
    setHiddenColumns,
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
  const { columns, sortedAndFilteredPatients } = usePatientsListTableModel({
    deferredSearch,
    filterPredicates,
    frozenColumns,
    patients,
    sortStack,
    tr,
  });
  const insuranceOptions = useMemo(
    () => collectPatientInsuranceOptions(patients),
    [patients],
  );
  const displayedPatients = useMemo(
    () => filterPatientsByInsurance(sortedAndFilteredPatients, filters.insuranceProvider),
    [sortedAndFilteredPatients, filters.insuranceProvider],
  );
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

  useDebouncedRealtimeSubscription(PATIENT_REALTIME_EVENTS, (_event, events) => {
    clearApiCache("/patients");
    if (selectedId && events.some((event) => event.entity_id === selectedId)) {
      refreshDetail();
    }
    refreshList();
  }, 250);

  if (!permissions.canViewPage) {
    return (
      <div className="space-y-6">
        <section
          className={cn("rounded-xl p-8", tokens.surface.softCard)}
        >
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-950">
            {t.patients_no_access_title}
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-zinc-600">
            {t.patients_no_access_body}
          </p>
        </section>
      </div>
    );
  }

  const anyTopFilterActive =
    filters.search.trim() !== "" ||
    filters.activeOnly !== "true" ||
    filters.providerId !== "" ||
    filters.doctorId !== "" ||
    filters.insuranceProvider !== "" ||
    filterPredicates.length > 0;

  function openCreateSheet() {
    void loadCreatePatientSheet();
    handleCreateOpenChange(true);
  }

  function handleOpenPatient(patientId: string) {
    staffGo(`/patients/${patientId}`);
  }

  function openShortcutsDialog() {
    void loadPatientsShortcutsDialog();
    setHelpOpen(true);
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {/* Title + inline tally + primary CTA */}
        <PatientsPageHeader
          canCreate={permissions.canCreateEdit}
          createLabel={t.patients_new}
          title={t.patients_title}
          onCreate={openCreateSheet}
        />

        <PatientsListToolbar
          anyTopFilterActive={anyTopFilterActive}
          columns={columns}
          defaultFrozenColumns={DEFAULT_PATIENT_FROZEN_COLUMNS}
          defaultHiddenColumns={DEFAULT_PATIENT_HIDDEN_COLUMNS}
          deferredSearchPlaceholder={t.common_search}
          density={density}
          doctors={doctors}
          exportLabel={t.common_export}
          filterPredicates={filterPredicates}
          filters={filters}
          frozenColumns={frozenColumns}
          groupLabels={groupLabels}
          hiddenColumns={hiddenColumns}
          insuranceOptions={insuranceOptions}
          lastUpdatedText={lastUpdated ? formatRelativeTime(lastUpdated) : null}
          listBusy={listBusy}
          maxFrozenColumns={MAX_PATIENT_FROZEN_COLUMNS}
          onActiveFilterChange={(value) => {
            setFilters((current) => ({ ...current, activeOnly: value }));
            syncQuery({ active: value === "true" ? null : value || null });
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
            exportCsv(displayedPatients, visibleCols, createPatientsExportFilename());
          }}
          onFiltersChange={setFilterPredicates}
          onFrozenColumnsChange={setFrozenColumns}
          onHiddenColumnsChange={setHiddenColumns}
          onInsuranceFilterChange={(value) => {
            setFilters((current) => ({ ...current, insuranceProvider: value }));
          }}
          onProviderFilterChange={(value) => {
            setFilters((current) => ({ ...current, providerId: value, doctorId: "" }));
            syncQuery({ provider: value || null, doctor: null });
          }}
          onRefresh={refreshList}
          onSearchChange={(value) => {
            setFilters((current) => ({ ...current, search: value }));
            syncQuery({ q: value.trim() ? value : null });
          }}
          onSearchEscape={(input) => {
            setFilters((current) => ({ ...current, search: "" }));
            syncQuery({ q: null });
            input.blur();
          }}
          onShortcutsOpen={openShortcutsDialog}
          onSortChange={setSortStack}
          providers={providers}
          refreshLabel={t.common_refresh}
          rows={patients}
          searchInputRef={searchInputRef}
          sortStack={sortStack}
          taxonomyNodes={taxonomyNodes}
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
            detailControls: {
              canCreateEdit: permissions.canCreateEdit,
              canViewAssignments: permissions.canViewAssignments,
              canManageAssignments: permissions.canManageAssignments,
              hideWorkspaceActions: viewMode === "split",
            },
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
          }}
          emptyLabel={t.patients_no_match}
          filteredCount={displayedPatients.length}
          frozenColumns={frozenColumns}
          hiddenColumns={hiddenColumns}
          loading={listBusy && patients.length === 0}
          maxFrozenColumns={MAX_PATIENT_FROZEN_COLUMNS}
          onCloseDetail={() => handleDetailOpenChange(false)}
          onOpenPatient={handleOpenPatient}
          onFrozenColumnsChange={setFrozenColumns}
          onSortChange={setSortStack}
          rows={displayedPatients}
          selectedId={selectedId}
          sortStack={sortStack}
          t={tr}
          totalCount={patients.length}
          tr={tr}
          viewMode={viewMode}
        />
      </div>

      <PatientsPageSheets
        closeLabel={t.common_close}
        createOpen={createOpen}
        dictionary={tr}
        helpOpen={helpOpen}
        onCreateOpenChange={handleCreateOpenChange}
        onHelpClose={() => setHelpOpen(false)}
        onPatientCreated={handlePatientCreated}
      />
    </>
  );
}
