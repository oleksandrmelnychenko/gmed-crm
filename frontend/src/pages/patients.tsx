import {
  memo,
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import { useSearchParams } from "react-router-dom";
import {
  CalendarClock,
  Download,
  Filter,
  Info,
  LoaderCircle,
  Mail,
  Phone,
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";

import { ColumnVisibilityMenu } from "@/components/data-table/column-visibility-menu";
import { DataTable } from "@/components/data-table/data-table";
import { DensityToggle } from "@/components/data-table/density-toggle";
import { FilterBuilder } from "@/components/data-table/filter-builder";
import { applyFilters } from "@/components/data-table/filter-logic";
import { buildSearchIndex, searchWithIndex } from "@/components/data-table/search";
import { SortBuilder } from "@/components/data-table/sort-builder";
import { applySort } from "@/components/data-table/sort-logic";
import { SplitView } from "@/components/data-table/split-view";
import type { DensityLevel, FilterPredicate, SortStack } from "@/components/data-table/types";
import { useLocalStorage, useVersionedLocalStorage } from "@/components/data-table/use-local-storage";
import { useResponsiveViewMode } from "@/components/data-table/use-responsive-view-mode";
import { readDataTableState, writeDataTableState } from "@/components/data-table/url-state";
import {
  DEFAULT_PATIENT_HIDDEN_COLUMNS,
  PATIENT_COLUMN_GROUPS,
  buildPatientColumns,
} from "./patients.columns";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Field,
  FormSection,
  FunctionalLabelChips,
  formInputClassName,
  humanizeFunctionalLabel,
  parseFunctionalLabels,
  textareaClassName,
} from "@/components/patient-form-primitives";
import { Banner, tokens } from "@/components/ui-shell";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select as ShadSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { getPatientLegalStatusSummary, normalizePatientLegalStatus } from "./patient-legal-status";
import {
  DEFAULT_PATIENT_FILTERS as DEFAULT_FILTERS,
  blankPatientForm,
  parseLanguages,
  patientPermissions,
  patientToForm,
  toOptional,
  type DoctorOption,
  type PatientAssignment,
  type PatientDetail,
  type PatientFilters,
  type PatientFormState,
  type PatientSummary,
  type PatientsDictionary,
  type ProviderOption,
  type StaffOption,
} from "./patients.helpers";

export type {
  PatientAssignment,
  PatientDetail,
  PatientsDictionary,
  StaffOption,
} from "./patients.helpers";

type CreatePatientSheetProps = {
  open: boolean;
  dictionary: PatientsDictionary;
  onOpenChange: (open: boolean) => void;
  onCreated: (patientId: string) => void;
};

function CreatePatientSheet({
  open,
  dictionary,
  onOpenChange,
  onCreated,
}: CreatePatientSheetProps) {
  const [form, setForm] = useState<PatientFormState>(blankPatientForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) {
      setForm(blankPatientForm());
      setBusy(false);
      setError("");
    }
  }, [open]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const created = await apiFetch<{ id: string }>("/patients", {
        method: "POST",
        body: JSON.stringify({
          title: toOptional(form.title),
          first_name: form.firstName.trim(),
          last_name: form.lastName.trim(),
          birth_date: form.birthDate,
          gender: form.gender,
          nationality: toOptional(form.nationality),
          residence_country: toOptional(form.residenceCountry),
          languages: parseLanguages(form.languages),
          functional_labels: parseFunctionalLabels(form.functionalLabels),
          phone_primary: toOptional(form.phonePrimary),
          phone_secondary: toOptional(form.phoneSecondary),
          email: toOptional(form.email),
          address_street: toOptional(form.addressStreet),
          address_city: toOptional(form.addressCity),
          address_zip: toOptional(form.addressZip),
          address_country: toOptional(form.addressCountry),
          insurance_provider: toOptional(form.insuranceProvider),
          insurance_number: toOptional(form.insuranceNumber),
          insurance_type: toOptional(form.insuranceType),
          emergency_contact_name: toOptional(form.emergencyContactName),
          emergency_contact_phone: toOptional(form.emergencyContactPhone),
          emergency_contact_relation: toOptional(form.emergencyContactRelation),
          notes: toOptional(form.notes),
        }),
      });
      onOpenChange(false);
      onCreated(created.id);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : dictionary.common_failed_create
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-[720px]">
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <SheetHeader className="shrink-0 px-4 pt-3 pb-1">
            <SheetTitle>{dictionary.patients_create}</SheetTitle>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-4 py-2 space-y-4">
            {error ? <Banner tone="error">{error}</Banner> : null}
            <PatientFormFields
              form={form}
              onChange={(field, value) =>
                setForm((current) => ({ ...current, [field]: value }))
              }
              includeBirthAndGender
            />
          </div>

          <div className="shrink-0 flex justify-end gap-2 px-4 py-3 bg-popover">
            <Button
              type="button"
              variant="outline"
              className="h-9 rounded-lg"
              onClick={() => onOpenChange(false)}
            >
              {dictionary.common_cancel}
            </Button>
            <Button type="submit" className="h-9 rounded-lg gap-1.5 px-3.5" disabled={busy}>
              {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}
              {busy ? dictionary.patients_creating : dictionary.common_create}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

const MemoizedCreatePatientSheet = memo(CreatePatientSheet);

type PatientDetailSheetProps = {
  open: boolean;
  detail: PatientDetail | null;
  detailBusy: boolean;
  detailError: string;
  dictionary: PatientsDictionary;
  canCreateEdit: boolean;
  canViewAssignments: boolean;
  canManageAssignments: boolean;
  assignments: PatientAssignment[];
  assignableStaff: StaffOption[];
  selectedAssignee: string;
  assignmentBusy: boolean;
  assignmentError: string;
  onAssigneeChange: (value: string) => void;
  onAssign: () => void;
  onOpenChange: (open: boolean) => void;
  onRefresh: () => void;
  onOpenCases: () => void;
  onOpenOrders: () => void;
  onOpenAppointments: () => void;
  onOpenContracts: () => void;
  onOpenDocuments: () => void;
  hideFooterActions?: boolean;
  hideWorkspaceActions?: boolean;
};

function PatientDetailSheet({
  open,
  detail,
  detailBusy,
  detailError,
  dictionary,
  canCreateEdit,
  canViewAssignments,
  canManageAssignments,
  assignments,
  assignableStaff,
  selectedAssignee,
  assignmentBusy,
  assignmentError,
  onAssigneeChange,
  onAssign,
  onOpenChange,
  onRefresh,
  onOpenCases,
  onOpenOrders,
  onOpenAppointments,
  onOpenContracts,
  onOpenDocuments,
  hideFooterActions = false,
  hideWorkspaceActions = false,
}: PatientDetailSheetProps) {
  const [form, setForm] = useState<PatientFormState>(blankPatientForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) {
      setForm(blankPatientForm());
      setBusy(false);
      setError("");
      return;
    }

    if (detail) {
      setForm(patientToForm(detail));
      setError("");
    }
  }, [detail, open]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;

    setBusy(true);
    setError("");

    try {
      await apiFetch(`/patients/${detail.id}/update`, {
        method: "POST",
        body: JSON.stringify({
          title: toOptional(form.title),
          first_name: toOptional(form.firstName),
          last_name: toOptional(form.lastName),
          phone_primary: toOptional(form.phonePrimary),
          phone_secondary: toOptional(form.phoneSecondary),
          email: toOptional(form.email),
          nationality: toOptional(form.nationality),
          residence_country: toOptional(form.residenceCountry),
          languages: parseLanguages(form.languages),
          functional_labels: parseFunctionalLabels(form.functionalLabels),
          address_street: toOptional(form.addressStreet),
          address_city: toOptional(form.addressCity),
          address_zip: toOptional(form.addressZip),
          address_country: toOptional(form.addressCountry),
          insurance_provider: toOptional(form.insuranceProvider),
          insurance_number: toOptional(form.insuranceNumber),
          insurance_type: toOptional(form.insuranceType),
          emergency_contact_name: toOptional(form.emergencyContactName),
          emergency_contact_phone: toOptional(form.emergencyContactPhone),
          emergency_contact_relation: toOptional(form.emergencyContactRelation),
          notes: toOptional(form.notes),
        }),
      });
      onRefresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : dictionary.common_failed_update
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-[860px]">
        {detailBusy ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            <LoaderCircle className="mr-2 size-4 animate-spin" />
            {dictionary.common_loading}
          </div>
        ) : detail ? (
          <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
            <SheetHeader className="shrink-0 px-4 pt-3 pb-1">
              <SheetTitle>{patientName(detail)}</SheetTitle>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto px-4 py-2 space-y-4">
              {detailError ? <Banner tone="error">{detailError}</Banner> : null}
              {error ? <Banner tone="error">{error}</Banner> : null}
              <PatientOverviewSection
                detail={detail}
                onOpenCases={onOpenCases}
                onOpenOrders={onOpenOrders}
                onOpenAppointments={onOpenAppointments}
                onOpenContracts={onOpenContracts}
                onOpenDocuments={onOpenDocuments}
                hideActions={hideWorkspaceActions}
              />
              <PatientProfileSection
                detail={detail}
                form={form}
                canEdit={canCreateEdit}
                onChange={(field, value) =>
                  setForm((current) => ({ ...current, [field]: value }))
                }
              />
              {canViewAssignments ? (
                <AssignmentsSection
                  assignments={assignments}
                  assignableStaff={assignableStaff}
                  canManage={canManageAssignments}
                  assignmentBusy={assignmentBusy}
                  assignmentError={assignmentError}
                  selectedAssignee={selectedAssignee}
                  onAssigneeChange={onAssigneeChange}
                  onAssign={onAssign}
                />
              ) : null}
            </div>

            {!hideFooterActions ? (
              <div className="shrink-0 flex justify-end gap-2 px-4 py-3 bg-popover">
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 rounded-lg"
                  onClick={() => onOpenChange(false)}
                >
                  {dictionary.common_cancel}
                </Button>
                {canCreateEdit ? (
                  <Button type="submit" className="h-9 rounded-lg gap-1.5 px-3.5" disabled={busy}>
                    {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                    {busy ? dictionary.patients_saving : dictionary.patients_save}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </form>
        ) : detailError ? (
          <div className="p-4">
            <Banner tone="error">{detailError}</Banner>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {dictionary.patients_subtitle}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export const MemoizedPatientDetailSheet = memo(PatientDetailSheet);

function buildPatientsPath(filters: PatientFilters) {
  const params = new URLSearchParams();
  if (filters.search.trim()) params.set("search", filters.search.trim());
  if (filters.activeOnly === "true") params.set("active_only", "true");
  else params.set("active_only", "false");
  if (filters.providerId) params.set("provider_id", filters.providerId);
  if (filters.doctorId) params.set("doctor_id", filters.doctorId);
  const query = params.toString();
  return query ? `/patients?${query}` : "/patients";
}

function canAssignTarget(managerRole: string | undefined, targetRole: string) {
  switch (managerRole) {
    case "ceo":
      return ["patient_manager", "teamlead_interpreter", "interpreter", "concierge"].includes(
        targetRole
      );
    case "patient_manager":
      return ["teamlead_interpreter", "interpreter", "concierge"].includes(targetRole);
    case "teamlead_interpreter":
      return targetRole === "interpreter";
    default:
      return false;
  }
}

function formatDate(value?: string | null, fallback = "Not set") {
  if (!value) return fallback;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date(`${value}T00:00:00`));
  } catch {
    return value;
  }
}

function formatDateTime(value?: string | null, fallback = "Not set") {
  if (!value) return fallback;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function genderLabel(value: string | null | undefined, tr: Record<string, string>) {
  switch (value) {
    case "male": return tr.gender_male;
    case "female": return tr.gender_female;
    case "diverse": return tr.gender_diverse;
    default: return tr.common_not_set;
  }
}

function insuranceLabel(value: string | null | undefined, tr: Record<string, string>) {
  switch (value) {
    case "private": return tr.insurance_private;
    case "public": return tr.insurance_public;
    case "self_pay": return tr.insurance_self_pay;
    case "foreign": return tr.insurance_foreign;
    default: return tr.common_not_set;
  }
}

function roleLabel(value: string | null | undefined, tr: Record<string, string>) {
  if (!value) return tr.common_unknown;
  return tr[`role_${value}`] ?? value.replaceAll("_", " ");
}

function patientName(patient: PatientSummary | PatientDetail) {
  const title = patient.title ? `${patient.title} ` : "";
  const name = [patient.first_name, patient.last_name].filter(Boolean).join(" ").trim();
  if (!name) return patient.patient_id;
  return `${title}${name}`.trim();
}

function fieldValue(value: string | string[] | null | undefined, fallback = "Not set") {
  if (Array.isArray(value)) {
    return value.length ? value.join(", ") : fallback;
  }
  return value && value.trim() ? value : fallback;
}


export function PatientsPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const { staffGo } = useStaffNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const permissions = useMemo(() => patientPermissions(user?.role), [user?.role]);
  const [filters, setFilters] = useState<PatientFilters>(DEFAULT_FILTERS);
  const deferredSearch = useDeferredValue(filters.search);
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [patients, setPatients] = useState<PatientSummary[]>([]);
  const [listBusy, setListBusy] = useState(false);
  const [listError, setListError] = useState("");
  const [listVersion, setListVersion] = useState(0);

  const [createOpen, setCreateOpen] = useState(false);

  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<PatientDetail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detailVersion, setDetailVersion] = useState(0);

  const [assignments, setAssignments] = useState<PatientAssignment[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [assignmentBusy, setAssignmentBusy] = useState(false);
  const [assignmentError, setAssignmentError] = useState("");
  const [selectedAssignee, setSelectedAssignee] = useState("");
  const showStats = true;
  const [helpOpen, setHelpOpen] = useState(false);
  const [, startFilterTransition] = useTransition();

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
  const patientsPath = useMemo(() => buildPatientsPath(effectiveFilters), [effectiveFilters]);
  const assignableStaff = useMemo(
    () => staff.filter((member) => canAssignTarget(user?.role, member.role)),
    [staff, user?.role]
  );
  const commonFailedLoad = t.common_failed_load;
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
    if (!permissions.canViewPage) return;
    let cancelled = false;

    void apiFetch<ProviderOption[]>("/providers")
      .then((items) => {
        if (!cancelled) {
          startTransition(() => setProviders(items));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProviders([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [permissions.canViewPage]);

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
      setDoctors([]);
      if (filters.doctorId) {
        setFilters((current) => ({ ...current, doctorId: "" }));
      }
      return;
    }

    let cancelled = false;
    void apiFetch<DoctorOption[]>(`/providers/${filters.providerId}/doctors`)
      .then((items) => {
        if (!cancelled) {
          startTransition(() => setDoctors(items));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDoctors([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [filters.doctorId, filters.providerId]);

  useEffect(() => {
    if (!permissions.canViewPage) return;

    let cancelled = false;
    // Only show loading spinner on first load, not on filter changes
    if (patients.length === 0) setListBusy(true);
    setListError("");

    void apiFetch<PatientSummary[]>(patientsPath)
      .then((items) => {
        if (!cancelled) {
          const filtered = filters.activeOnly === "false"
            ? items.filter((p) => !p.is_active)
            : items;
          startTransition(() => setPatients(filtered));
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setListError(error instanceof Error ? error.message : commonFailedLoad);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setListBusy(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    commonFailedLoad,
    filters.activeOnly,
    patients.length,
    patientsPath,
    permissions.canViewPage,
    listVersion,
  ]);

  useEffect(() => {
    if (!detailOpen || !selectedId) return;

    let cancelled = false;
    setDetailBusy(true);
    setDetailError("");
    setAssignmentError("");

    const detailPromise = apiFetch<PatientDetail>(`/patients/${selectedId}`);
    const assignmentsPromise = permissions.canViewAssignments
      ? apiFetch<PatientAssignment[]>(`/patients/${selectedId}/assignments`).catch(() => [])
      : Promise.resolve([] as PatientAssignment[]);
    const staffPromise = permissions.canManageAssignments
      ? apiFetch<StaffOption[]>("/appointments/meta/staff").catch(() => [])
      : Promise.resolve([] as StaffOption[]);

    void Promise.all([detailPromise, assignmentsPromise, staffPromise])
      .then(([patientDetail, assignmentItems, staffItems]) => {
        if (cancelled) return;
        startTransition(() => {
          setDetail(patientDetail);
          setAssignments(assignmentItems);
          setStaff(staffItems);
        });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setDetailError(error instanceof Error ? error.message : commonFailedLoad);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDetailBusy(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    detailOpen,
    selectedId,
    detailVersion,
    commonFailedLoad,
    permissions.canManageAssignments,
    permissions.canViewAssignments,
  ]);

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
      setDetail(null);
      setAssignments([]);
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
    staffGo(`/patients/${patientId}`);
  }

  async function handleAssignPatient() {
    if (!detail || !selectedAssignee) return;

    setAssignmentBusy(true);
    setAssignmentError("");

    try {
      await apiFetch(`/patients/${detail.id}/assign`, {
        method: "POST",
        body: JSON.stringify({ user_id: selectedAssignee }),
      });
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

        {/* Single-row toolbar */}
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              value={filters.search}
              onChange={(event) =>
                setFilters((current) => ({ ...current, search: event.target.value }))
              }
              placeholder={t.common_search}
              className="h-8 w-[280px] rounded-lg bg-card pl-8 text-[13px]"
            />
          </div>

          <FilterBuilder
            columns={columns}
            rows={patients}
            filters={filterPredicates}
            onChange={setFilterPredicates}
          />

          <SortBuilder
            columns={columns}
            value={sortStack}
            onChange={setSortStack}
          />

          <ColumnVisibilityMenu
            columns={columns}
            hiddenColumns={hiddenColumns}
            onChange={setHiddenColumns}
            defaultHidden={DEFAULT_PATIENT_HIDDEN_COLUMNS}
            groupLabels={PATIENT_COLUMN_GROUPS}
          />

          <DensityToggle value={density} onChange={setDensity} />

          {/* Legacy provider/doctor (will fold into FilterBuilder in follow-up) */}
          <ShadSelect
            value={filters.providerId}
            onValueChange={(v) => {
              const providerId = v ?? "";
              setFilters((current) => ({ ...current, providerId, doctorId: "" }));
              syncQuery({ provider: providerId || null, doctor: null });
            }}
          >
            <SelectTrigger size="sm" className="h-8 w-[220px] bg-card text-[13px]">
              <SelectValue>
                {filters.providerId
                  ? (providers.find((p) => p.id === filters.providerId)?.name ?? filters.providerId)
                  : t.common_provider}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">{t.providers_all}</SelectItem>
              {providers.map((provider) => (
                <SelectItem key={provider.id} value={provider.id}>
                  {provider.name}{provider.address_city ? ` · ${provider.address_city}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </ShadSelect>

          <ShadSelect
            value={filters.doctorId}
            onValueChange={(v) => {
              const doctorId = v ?? "";
              setFilters((current) => ({ ...current, doctorId }));
              syncQuery({ doctor: doctorId || null });
            }}
            disabled={!filters.providerId}
          >
            <SelectTrigger size="sm" className="h-8 w-[200px] bg-card text-[13px]">
              <SelectValue>
                {filters.doctorId
                  ? (doctors.find((d) => d.id === filters.doctorId)?.name ?? filters.doctorId)
                  : t.common_doctor}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">{t.providers_all}</SelectItem>
              {doctors.map((doctor) => (
                <SelectItem key={doctor.id} value={doctor.id}>
                  {doctor.title ? `${doctor.title} ` : ""}{doctor.name}
                </SelectItem>
              ))}
            </SelectContent>
          </ShadSelect>

          <ShadSelect
            value={filters.activeOnly}
            onValueChange={(v) =>
              setFilters((current) => ({ ...current, activeOnly: v ?? "" }))
            }
          >
            <SelectTrigger size="sm" className="h-8 bg-card text-[13px]">
              <Filter className="mr-1 size-3.5 text-muted-foreground" />
              <SelectValue>
                {filters.activeOnly === "true"
                  ? t.common_active
                  : filters.activeOnly === "false"
                    ? t.common_inactive
                    : t.providers_all}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">{t.providers_all}</SelectItem>
              <SelectItem value="true">{t.common_active}</SelectItem>
              <SelectItem value="false">{t.common_inactive}</SelectItem>
            </SelectContent>
          </ShadSelect>

          <div className="ml-auto flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              title={t.common_refresh ?? "Refresh"}
              aria-label={t.common_refresh ?? "Refresh"}
              onClick={refreshList}
            >
              <RefreshCw className={cn("size-3.5", listBusy && "animate-spin")} />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              title={t.common_export ?? "Export"}
              aria-label={t.common_export ?? "Export"}
            >
              <Download className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              title="Keyboard shortcuts"
              aria-label="Keyboard shortcuts"
              onClick={() => setHelpOpen((v) => !v)}
            >
              <Info className="size-3.5" />
            </Button>
            {anyTopFilterActive ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFilters(DEFAULT_FILTERS);
                  setFilterPredicates([]);
                  syncQuery({ provider: null, doctor: null, patient: null });
                }}
              >
                <X className="size-3.5" />
                {t.common_reset}
              </Button>
            ) : null}
          </div>
        </div>

        {listError ? <Banner tone="error">{listError}</Banner> : null}

        <SplitView
          active={detailOpen}
          viewMode={viewMode}
          onClose={() => handleDetailOpenChange(false)}
          pane={
            <div className="flex h-full flex-col">
              <MemoizedPatientDetailSheet
                open={detailOpen}
                detail={detail}
                detailBusy={detailBusy}
                detailError={detailError}
                dictionary={tr}
                canCreateEdit={permissions.canCreateEdit}
                canViewAssignments={permissions.canViewAssignments}
                canManageAssignments={permissions.canManageAssignments}
                assignments={assignments}
                assignableStaff={assignableStaff}
                selectedAssignee={selectedAssignee}
                assignmentBusy={assignmentBusy}
                assignmentError={assignmentError}
                onAssigneeChange={setSelectedAssignee}
                onAssign={handleAssignPatient}
                onOpenChange={handleDetailOpenChange}
                onRefresh={handleDetailSaved}
                onOpenCases={() => detail ? staffGo(`/cases?patient=${detail.id}`) : undefined}
                onOpenOrders={() => detail ? staffGo(`/orders?patient=${detail.id}`) : undefined}
                onOpenAppointments={() => detail ? staffGo(`/appointments?patient=${detail.id}`) : undefined}
                onOpenContracts={() => detail ? staffGo(`/contracts?patient=${detail.id}`) : undefined}
                onOpenDocuments={() => detail ? staffGo(`/documents?patient=${detail.id}`) : undefined}
                hideWorkspaceActions={viewMode === "split"}
              />
            </div>
          }
        >
          <DataTable
            rows={sortedAndFilteredPatients}
            columns={columns}
            hiddenColumns={hiddenColumns}
            sort={sortStack}
            onSortChange={setSortStack}
            density={density}
            rowId={(p) => p.id}
            activeRowId={selectedId}
            onRowClick={(p) => openPatient(p.id)}
            selectedIds={selectedIds}
            onSelectedIdsChange={setSelectedIds}
            selectionEnabled={permissions.canCreateEdit}
            loading={listBusy && patients.length === 0}
            emptyState={<span className="text-sm text-muted-foreground">{t.patients_no_match}</span>}
            className="min-h-[400px]"
            footer={
              <div className="flex items-center justify-between">
                <span className="tabular-nums">
                  {sortedAndFilteredPatients.length === patients.length
                    ? `${patients.length}`
                    : `${sortedAndFilteredPatients.length} / ${patients.length}`}
                  {" "}
                  {t.patients_title.toLowerCase()}
                </span>
                {selectedIds.length > 0 ? (
                  <span className="tabular-nums">{selectedIds.length} selected</span>
                ) : null}
              </div>
            }
          />
        </SplitView>
      </div>

      <MemoizedCreatePatientSheet
        open={createOpen}
        dictionary={tr}
        onOpenChange={handleCreateOpenChange}
        onCreated={handlePatientCreated}
      />

      {helpOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30"
          onClick={() => setHelpOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-lg border border-border bg-card p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-3 text-sm font-semibold">Keyboard shortcuts</h2>
            <ul className="space-y-1.5 text-xs">
              <li><kbd className="rounded border border-border px-1.5 py-0.5">/</kbd> Focus search</li>
              <li><kbd className="rounded border border-border px-1.5 py-0.5">↑</kbd> / <kbd className="rounded border border-border px-1.5 py-0.5">↓</kbd> Navigate rows</li>
              <li><kbd className="rounded border border-border px-1.5 py-0.5">Enter</kbd> Open in split pane</li>
              <li><kbd className="rounded border border-border px-1.5 py-0.5">Shift</kbd> + click header Multi-sort</li>
              <li><kbd className="rounded border border-border px-1.5 py-0.5">Esc</kbd> Close pane</li>
            </ul>
            <div className="mt-3 flex justify-end">
              <Button type="button" variant="outline" size="sm" onClick={() => setHelpOpen(false)}>
                {t.common_close ?? "Close"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function PatientOverviewSection({
  detail,
  onOpenCases,
  onOpenOrders,
  onOpenAppointments,
  onOpenContracts,
  onOpenDocuments,
  hideActions = false,
}: {
  detail: PatientDetail;
  onOpenCases: () => void;
  onOpenOrders: () => void;
  onOpenAppointments: () => void;
  onOpenContracts: () => void;
  onOpenDocuments: () => void;
  hideActions?: boolean;
}) {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;

  return (
    <section
      className={cn("rounded-xl p-3.5 space-y-3", tokens.surface.softCard)}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.1em]",
            detail.is_active
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-border bg-muted text-muted-foreground"
          )}
        >
          {detail.is_active ? t.common_active : t.common_inactive}
        </span>
        <Badge variant="outline" className="rounded-full border-border bg-card text-foreground">
          {genderLabel(detail.gender, tr)}
        </Badge>
        <Badge variant="outline" className="rounded-full border-border bg-card text-foreground">
          {insuranceLabel(detail.insurance_type, tr)}
        </Badge>
        {detail.functional_labels?.map((label) => (
          <Badge
            key={`${detail.id}-${label}`}
            variant="outline"
            className="rounded-full border-amber-200 bg-amber-50 text-amber-700"
          >
            {humanizeFunctionalLabel(label)}
          </Badge>
        ))}
      </div>

      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">{patientName(detail)}</h2>
          <p className="mt-0.5 text-[12px] text-muted-foreground">{detail.patient_id}</p>
        </div>
        <div className="grid gap-1 text-[12.5px] text-muted-foreground">
          <div className="flex items-center gap-2">
            <CalendarClock className="size-3.5 text-muted-foreground/70" />
            <span>{formatDate(detail.birth_date, t.common_not_set)}</span>
          </div>
          <div className="flex items-center gap-2">
            <Phone className="size-3.5 text-muted-foreground/70" />
            <span>{fieldValue(detail.phone_primary, t.common_not_set)}</span>
          </div>
          <div className="flex items-center gap-2">
            <Mail className="size-3.5 text-muted-foreground/70" />
            <span>{fieldValue(detail.email, t.common_not_set)}</span>
          </div>
        </div>
      </div>

      {!hideActions ? (
        <div className="flex flex-wrap gap-1.5 pt-1">
          <Button type="button" variant="outline" size="sm" className="h-8 rounded-lg" onClick={onOpenCases}>
            {t.cases_title}
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-8 rounded-lg" onClick={onOpenOrders}>
            {t.orders_title}
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-8 rounded-lg" onClick={onOpenAppointments}>
            {t.appointments_title}
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-8 rounded-lg" onClick={onOpenContracts}>
            {t.nav_contracts}
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-8 rounded-lg" onClick={onOpenDocuments}>
            {t.nav_documents}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function PatientProfileSection({
  detail,
  form,
  canEdit,
  onChange,
}: {
  detail: PatientDetail;
  form: PatientFormState;
  canEdit: boolean;
  onChange: (field: keyof PatientFormState, value: string) => void;
}) {
  const { t, lang } = useLang();
  const tr = t as unknown as Record<string, string>;
  const l = (de: string, ru: string, en: string) => (lang === "de" ? de : lang === "ru" ? ru : en);
  const legalStatusSummary = getPatientLegalStatusSummary(
    normalizePatientLegalStatus(detail.legal_status)
  );

  return (
    <div className="space-y-3">
      <FormSection title={l("Identifikation", "Идентификация", "Identification")}>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label={t.patients_birth_date}>
            <Input value={detail.birth_date ?? ""} disabled className={formInputClassName} />
          </Field>
          <Field label={t.patients_gender}>
            <Input value={genderLabel(detail.gender, tr)} disabled className={formInputClassName} />
          </Field>
          <Field label={t.patients_legal_status}>
            <Input value={legalStatusSummary} disabled className={formInputClassName} />
          </Field>
        </div>
      </FormSection>

      <PatientFormFields form={form} onChange={onChange} />

      {!canEdit ? (
        <p className="text-[12px] text-muted-foreground italic">
          {l(
            "Diese Rolle hat nur Lesezugriff auf Patientendemografie.",
            "Эта роль имеет доступ только для чтения.",
            "This role has read-only access to patient demographics."
          )}
        </p>
      ) : null}
    </div>
  );
}

function AssignmentsSection({
  assignments,
  assignableStaff,
  canManage,
  assignmentBusy,
  assignmentError,
  selectedAssignee,
  onAssigneeChange,
  onAssign,
}: {
  assignments: PatientAssignment[];
  assignableStaff: StaffOption[];
  canManage: boolean;
  assignmentBusy: boolean;
  assignmentError: string;
  selectedAssignee: string;
  onAssigneeChange: (value: string) => void;
  onAssign: () => void;
}) {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;

  return (
    <FormSection title={t.patients_assign_owner}>
      {assignmentError ? <Banner tone="error">{assignmentError}</Banner> : null}

      {assignments.length === 0 ? (
        <p className="text-[12.5px] text-muted-foreground italic">
          {t.patients_no_assignments}
        </p>
      ) : (
        <div className="space-y-2">
          {assignments.map((item) => (
            <div
              key={`${item.user_id}-${item.assigned_at}`}
              className="rounded-lg border border-border/50 bg-card/60 px-3 py-2.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-foreground truncate">{item.user_name}</p>
                  <p className="text-[12px] text-muted-foreground">{roleLabel(item.user_role, tr)}</p>
                </div>
                <Badge variant="outline" className="rounded-full border-border bg-card text-foreground shrink-0">
                  {item.revoked_at ? t.patients_revoked : t.common_active}
                </Badge>
              </div>
              <div className="mt-2 grid gap-0.5 text-[11.5px] text-muted-foreground md:grid-cols-2">
                <div>{t.patients_assigned_by} {formatDateTime(item.assigned_at, t.common_not_set)}</div>
                <div>{t.patients_assigned_by} {item.assigned_by_name || t.common_unknown}</div>
                {item.revoked_at ? <div>Revoked {formatDateTime(item.revoked_at, t.common_not_set)}</div> : null}
                <div>{item.user_active ? t.patients_user_active : t.patients_user_inactive}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {canManage ? (
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] pt-1">
          <Field label={t.patients_assign_owner}>
            <ShadSelect value={selectedAssignee} onValueChange={(v) => onAssigneeChange(v ?? "")}>
              <SelectTrigger className={cn("w-full", formInputClassName)}>
                <SelectValue>
                  {selectedAssignee
                    ? (() => { const s = assignableStaff.find((i) => i.id === selectedAssignee); return s ? `${s.name} · ${roleLabel(s.role, tr)}` : selectedAssignee; })()
                    : t.patients_assign_owner}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {assignableStaff.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name} · {roleLabel(item.role, tr)}
                  </SelectItem>
                ))}
              </SelectContent>
            </ShadSelect>
          </Field>
          <div className="flex items-end">
            <Button
              type="button"
              className="h-9 rounded-lg gap-1.5 px-3.5"
              disabled={assignmentBusy || !selectedAssignee}
              onClick={onAssign}
            >
              {assignmentBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {t.patients_assign_owner}
            </Button>
          </div>
        </div>
      ) : null}
    </FormSection>
  );
}

function PatientFormFields({
  form,
  onChange,
  includeBirthAndGender = false,
}: {
  form: PatientFormState;
  onChange: (field: keyof PatientFormState, value: string) => void;
  includeBirthAndGender?: boolean;
}) {
  const { t, lang } = useLang();
  const tr = t as unknown as Record<string, string>;
  const l = (de: string, ru: string, en: string) => (lang === "de" ? de : lang === "ru" ? ru : en);

  return (
    <div className="space-y-3">
      <FormSection title={l("Persönliche Daten", "Личные данные", "Personal data")}>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label={t.patients_title_field}>
            <Input
              value={form.title}
              onChange={(event) => onChange("title", event.target.value)}
              className={formInputClassName}
            />
          </Field>
          <Field label={t.patients_first_name}>
            <Input
              value={form.firstName}
              onChange={(event) => onChange("firstName", event.target.value)}
              className={formInputClassName}
              required
            />
          </Field>
          <Field label={t.patients_last_name}>
            <Input
              value={form.lastName}
              onChange={(event) => onChange("lastName", event.target.value)}
              className={formInputClassName}
              required
            />
          </Field>
        </div>

        {includeBirthAndGender ? (
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={t.patients_birth_date}>
              <Input
                type="date"
                value={form.birthDate}
                onChange={(event) => onChange("birthDate", event.target.value)}
                className={formInputClassName}
                required
              />
            </Field>
            <Field label={t.patients_gender}>
              <ShadSelect value={form.gender} onValueChange={(v) => onChange("gender", v ?? "male")}>
                <SelectTrigger className={cn("w-full", formInputClassName)}>
                  <SelectValue>
                    {genderLabel(form.gender, tr)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">{t.gender_male}</SelectItem>
                  <SelectItem value="female">{t.gender_female}</SelectItem>
                  <SelectItem value="diverse">{t.gender_diverse}</SelectItem>
                </SelectContent>
              </ShadSelect>
            </Field>
          </div>
        ) : null}

        <div className="grid gap-3 md:grid-cols-2">
          <Field label={t.patients_nationality}>
            <Input
              value={form.nationality}
              onChange={(event) => onChange("nationality", event.target.value)}
              className={formInputClassName}
            />
          </Field>
          <Field label={t.patients_residence_country}>
            <Input
              value={form.residenceCountry}
              onChange={(event) => onChange("residenceCountry", event.target.value)}
              className={formInputClassName}
            />
          </Field>
        </div>

        <Field label={t.patients_languages}>
          <Input
            value={form.languages}
            onChange={(event) => onChange("languages", event.target.value)}
            className={formInputClassName}
            placeholder={t.patients_languages}
          />
        </Field>

        <Field label={l("Funktionslabels", "Функциональные метки", "Functional labels")}>
          <FunctionalLabelChips
            value={form.functionalLabels}
            onChange={(next) => onChange("functionalLabels", next)}
          />
        </Field>
      </FormSection>

      <FormSection title={l("Kontakt", "Контакты", "Contact")}>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label={t.patients_phone_primary}>
            <Input
              value={form.phonePrimary}
              onChange={(event) => onChange("phonePrimary", event.target.value)}
              className={formInputClassName}
            />
          </Field>
          <Field label={t.patients_phone_secondary}>
            <Input
              value={form.phoneSecondary}
              onChange={(event) => onChange("phoneSecondary", event.target.value)}
              className={formInputClassName}
            />
          </Field>
          <Field label={t.patients_email}>
            <Input
              type="email"
              value={form.email}
              onChange={(event) => onChange("email", event.target.value)}
              className={formInputClassName}
            />
          </Field>
        </div>
      </FormSection>

      <FormSection title={l("Adresse", "Адрес", "Address")}>
        <Field label={t.patients_address_street}>
          <Input
            value={form.addressStreet}
            onChange={(event) => onChange("addressStreet", event.target.value)}
            className={formInputClassName}
          />
        </Field>

        <div className="grid gap-3 md:grid-cols-3">
          <Field label={t.patients_address_city}>
            <Input
              value={form.addressCity}
              onChange={(event) => onChange("addressCity", event.target.value)}
              className={formInputClassName}
            />
          </Field>
          <Field label={t.patients_address_zip}>
            <Input
              value={form.addressZip}
              onChange={(event) => onChange("addressZip", event.target.value)}
              className={formInputClassName}
            />
          </Field>
          <Field label={t.patients_address_country}>
            <Input
              value={form.addressCountry}
              onChange={(event) => onChange("addressCountry", event.target.value)}
              className={formInputClassName}
            />
          </Field>
        </div>
      </FormSection>

      <FormSection title={l("Versicherung", "Страхование", "Insurance")}>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label={t.patients_insurance_provider}>
            <Input
              value={form.insuranceProvider}
              onChange={(event) => onChange("insuranceProvider", event.target.value)}
              className={formInputClassName}
            />
          </Field>
          <Field label={t.patients_insurance_number}>
            <Input
              value={form.insuranceNumber}
              onChange={(event) => onChange("insuranceNumber", event.target.value)}
              className={formInputClassName}
            />
          </Field>
          <Field label={t.patients_insurance_type}>
            <ShadSelect value={form.insuranceType} onValueChange={(v) => onChange("insuranceType", v ?? "")}>
              <SelectTrigger className={cn("w-full", formInputClassName)}>
                <SelectValue>
                  {insuranceLabel(form.insuranceType, tr)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">{t.common_not_set}</SelectItem>
                <SelectItem value="private">{t.insurance_private}</SelectItem>
                <SelectItem value="public">{t.insurance_public}</SelectItem>
                <SelectItem value="self_pay">{t.insurance_self_pay}</SelectItem>
                <SelectItem value="foreign">{t.insurance_foreign}</SelectItem>
              </SelectContent>
            </ShadSelect>
          </Field>
        </div>
      </FormSection>

      <FormSection title={l("Notfallkontakt", "Экстренный контакт", "Emergency contact")}>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label={t.patients_emergency_name}>
            <Input
              value={form.emergencyContactName}
              onChange={(event) => onChange("emergencyContactName", event.target.value)}
              className={formInputClassName}
            />
          </Field>
          <Field label={t.patients_emergency_phone}>
            <Input
              value={form.emergencyContactPhone}
              onChange={(event) => onChange("emergencyContactPhone", event.target.value)}
              className={formInputClassName}
            />
          </Field>
          <Field label={t.patients_emergency_relation}>
            <Input
              value={form.emergencyContactRelation}
              onChange={(event) => onChange("emergencyContactRelation", event.target.value)}
              className={formInputClassName}
            />
          </Field>
        </div>
      </FormSection>

      <FormSection title={t.patients_notes}>
        <textarea
          value={form.notes}
          onChange={(event) => onChange("notes", event.target.value)}
          className={textareaClassName}
          rows={4}
        />
      </FormSection>
    </div>
  );
}
