import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useSearchParams } from "react-router-dom";
import {
  Plus,
} from "lucide-react";

import { exportCsv } from "@/components/data-table/csv-export";
import { applyFilters } from "@/components/data-table/filter-logic";
import { formatRelativeTime } from "@/components/data-table/relative-time";
import { buildSearchIndex, searchWithIndex } from "@/components/data-table/search";
import { applySort } from "@/components/data-table/sort-logic";
import type { DensityLevel, FilterPredicate, SortStack } from "@/components/data-table/types";
import { useLocalStorage, useVersionedLocalStorage } from "@/components/data-table/use-local-storage";
import { useResponsiveViewMode } from "@/components/data-table/use-responsive-view-mode";
import { readDataTableState, writeDataTableState } from "@/components/data-table/url-state";
import {
  DEFAULT_PATIENT_HIDDEN_COLUMNS,
  PATIENT_COLUMN_GROUPS,
  buildPatientColumns,
} from "./ui/patients-columns";

import { Button } from "@/components/ui/button";
import { Banner, tokens } from "@/components/ui-shell";
import { useAuth } from "@/lib/auth";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import {
  canAssignTarget,
  DEFAULT_PATIENT_FILTERS as DEFAULT_FILTERS,
  patientPermissions,
  type PatientFilters,
  type PatientSummary,
} from "./model/list-model";
import { usePatientDetailSheetData } from "./data/use-patient-detail-sheet-data";
import { usePatientsListData } from "./data/use-patients-list-data";
import {
  assignPatient,
  togglePatientActivation,
} from "./data/patient-mutations";
import { PatientsListToolbar } from "./ui/list/patients-list-toolbar";
import { PatientsShortcutsDialog } from "./ui/list/patients-shortcuts-dialog";
import { PatientsTableSurface } from "./ui/list/patients-table-surface";
import { MemoizedCreatePatientSheet } from "./ui/sheets/create-patient-sheet";


export function PatientsPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const { staffGo } = useStaffNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const permissions = useMemo(() => patientPermissions(user?.role), [user?.role]);
  const [filters, setFilters] = useState<PatientFilters>(DEFAULT_FILTERS);
  const deferredSearch = useDeferredValue(filters.search);
  const [listVersion, setListVersion] = useState(0);

  const [createOpen, setCreateOpen] = useState(false);

  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [detailVersion, setDetailVersion] = useState(0);

  const [assignmentBusy, setAssignmentBusy] = useState(false);
  const [assignmentError, setAssignmentError] = useState("");
  const [selectedAssignee, setSelectedAssignee] = useState("");
  const showStats = true;
  const [helpOpen, setHelpOpen] = useState(false);
  const [, startFilterTransition] = useTransition();
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if (event.key === "/" && !isTyping) {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const [filterPredicates, setFilterPredicatesState] = useState<FilterPredicate[]>(() => {
    if (typeof window === "undefined") return [];
    return readDataTableState(new URLSearchParams(window.location.search)).filters ?? [];
  });
  const [sortStack, setSortStackState] = useState<SortStack>(() => {
    if (typeof window === "undefined") return [{ field: "created_at", dir: "desc" }];
    const url = readDataTableState(new URLSearchParams(window.location.search));
    return url.sort ?? [{ field: "created_at", dir: "desc" }];
  });
  const [hiddenColumns, setHiddenColumns] = useVersionedLocalStorage<string[]>(
    "patients.hiddenColumns",
    DEFAULT_PATIENT_HIDDEN_COLUMNS,
    1,
  );
  const [density, setDensity] = useLocalStorage<DensityLevel>("patients.density", "compact");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const viewMode = useResponsiveViewMode();

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
  const metrics = useMemo(() => {
    return patients.reduce(
      (acc, patient) => {
        acc.total += 1;
        if (patient.is_active) acc.active += 1;
        if (patient.insurance_type === "private") acc.privateCount += 1;
        if (patient.insurance_type === "self_pay") acc.selfPay += 1;
        return acc;
      },
      { total: 0, active: 0, privateCount: 0, selfPay: 0 }
    );
  }, [patients]);

  const columns = useMemo(() => buildPatientColumns(tr, patients), [tr, patients]);

  const accessors = useMemo(() => {
    const map: Record<string, (row: PatientSummary) => unknown> = {};
    for (const col of columns) {
      map[col.id] = col.accessor;
    }
    return map;
  }, [columns]);

  const searchAccessors = useMemo(() => {
    return columns.filter((c) => c.searchable).map((c) => c.accessor);
  }, [columns]);

  const searchIndex = useMemo(
    () => buildSearchIndex(patients, { fields: searchAccessors }),
    [patients, searchAccessors],
  );

  const sortedAndFilteredPatients = useMemo(() => {
    const filtered = applyFilters(patients, filterPredicates, { accessors });
    const searched = deferredSearch.trim()
      ? searchWithIndex(
          buildSearchIndex(filtered, { fields: searchAccessors }),
          deferredSearch,
        )
      : filtered;
    return applySort(searched, sortStack, { accessors });
  }, [patients, filterPredicates, sortStack, accessors, deferredSearch, searchAccessors]);
  // searchIndex is memoized for future use by the toolbar search input when
  // we switch to non-deferred live-search in commit 14.
  void searchIndex;

  const setFilterPredicates = (next: FilterPredicate[]) => {
    startFilterTransition(() => {
      setFilterPredicatesState(next);
    });
    const params = writeDataTableState(new URLSearchParams(searchParams), { filters: next });
    setSearchParams(params, { replace: true });
  };

  const setSortStack = (next: SortStack) => {
    startFilterTransition(() => {
      setSortStackState(next);
    });
    const params = writeDataTableState(new URLSearchParams(searchParams), { sort: next });
    setSearchParams(params, { replace: true });
  };

  function syncQuery(next: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams);
    Object.entries(next).forEach(([key, value]) => {
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    });
    setSearchParams(params, { replace: true });
  }

  useEffect(() => {
    const patientParam = searchParams.get("patient") ?? "";
    const providerParam = searchParams.get("provider") ?? "";
    const doctorParam = searchParams.get("doctor") ?? "";

    setFilters((current) => {
      if (
        current.providerId === providerParam &&
        current.doctorId === doctorParam
      ) {
        return current;
      }
      return {
        ...current,
        providerId: providerParam,
        doctorId: doctorParam,
      };
    });

    if (patientParam && patientParam !== selectedId) {
      setSelectedId(patientParam);
      setDetailOpen(true);
    }
  }, [searchParams, selectedId]);

  useEffect(() => {
    if (!filters.providerId) {
      if (filters.doctorId) {
        setFilters((current) => ({ ...current, doctorId: "" }));
      }
      return;
    }
  }, [filters.doctorId, filters.providerId]);

  useEffect(() => {
    if (!detailOpen || !selectedId) {
      setSelectedAssignee("");
      setAssignmentError("");
      return;
    }

    setAssignmentError("");
  }, [detailOpen, selectedId]);

  function refreshList() {
    setListVersion((current) => current + 1);
  }

  function refreshDetail() {
    setDetailVersion((current) => current + 1);
  }

  function handleCreateOpenChange(open: boolean) {
    setCreateOpen(open);
  }

  function handleDetailOpenChange(open: boolean) {
    setDetailOpen(open);
    if (!open) {
      setSelectedId("");
      setSelectedAssignee("");
      syncQuery({ patient: null });
    }
  }

  function handlePatientCreated(patientId: string) {
    staffGo(`/patients/${patientId}`);
  }

  function handleDetailSaved() {
    refreshList();
    refreshDetail();
  }

  function openPatient(patientId: string) {
    setSelectedId(patientId);
    setDetailOpen(true);
    syncQuery({ patient: patientId });
  }

  async function handleToggleArchive(patient: PatientSummary) {
    const nextActive = !patient.is_active;

    setPatients((current) =>
      current.map((p) => (p.id === patient.id ? { ...p, is_active: nextActive } : p)),
    );

    try {
      await togglePatientActivation(patient.id, patient.is_active);
    } catch (error) {
      setPatients((current) =>
        current.map((p) => (p.id === patient.id ? { ...p, is_active: !nextActive } : p)),
      );
      setListError(error instanceof Error ? error.message : "Failed to update patient status");
    }
  }

  async function handleAssignPatient() {
    if (!detail || !selectedAssignee) return;

    setAssignmentBusy(true);
    setAssignmentError("");

    try {
      await assignPatient(detail.id, selectedAssignee);
      setSelectedAssignee("");
      refreshDetail();
    } catch (error) {
      setAssignmentError(error instanceof Error ? error.message : t.common_failed_assign);
    } finally {
      setAssignmentBusy(false);
    }
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
                onClick={() => setCreateOpen(true)}
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
          onClearAll={() => {
            setFilters(DEFAULT_FILTERS);
            setFilterPredicates([]);
            syncQuery({ provider: null, doctor: null, patient: null });
          }}
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
          onShortcutsOpen={() => setHelpOpen((current) => !current)}
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
          onOpenPatient={openPatient}
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

      <MemoizedCreatePatientSheet
        open={createOpen}
        dictionary={tr}
        onOpenChange={handleCreateOpenChange}
        onCreated={handlePatientCreated}
      />

      <PatientsShortcutsDialog
        open={helpOpen}
        closeLabel={t.common_close ?? "Close"}
        onClose={() => setHelpOpen(false)}
      />
    </>
  );
}
