import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useSearchParams } from "react-router-dom";
import {
  Building2,
  CalendarClock,
  Download,
  LoaderCircle,
  Mail,
  MapPin,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Stethoscope,
  Trash2,
  X,
  UsersRound,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import {
  AdminInlineMetric,
  AdminSheetScaffold,
  SheetActionsFooter,
  SheetFormFooter,
} from "@/components/admin-page-patterns";
import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet";
import { useLang } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { cn } from "@/lib/utils";
import { ColumnVisibilityMenu } from "@/components/data-table/column-visibility-menu";
import { DataTable } from "@/components/data-table/data-table";
import { DensityToggle } from "@/components/data-table/density-toggle";
import { exportCsv } from "@/components/data-table/csv-export";
import { FilterBuilder } from "@/components/data-table/filter-builder";
import { SortBuilder } from "@/components/data-table/sort-builder";
import type { DensityLevel, FilterPredicate, SortStack } from "@/components/data-table/types";
import { useLocalStorage, useVersionedLocalStorage } from "@/components/data-table/use-local-storage";
import { readDataTableState, writeDataTableState } from "@/components/data-table/url-state";

import {
  createProvider,
  deleteProvider,
  deleteProviderDoctor,
  deleteProviderService,
  fetchProviderDetail,
  fetchProviders,
  saveProviderDoctor,
  saveProviderService,
  setProviderActive,
  updateProvider,
} from "./data/provider-api";
import {
  DEFAULT_FILTERS,
  blankDoctorForm,
  blankProviderForm,
  blankServiceForm,
  buildProvidersQuery,
  compactDate,
  compactDateTime,
  doctorToForm,
  humanizeCode,
  moneyLabel,
  patientLabel,
  providerMeta,
  providerPermissions,
  providerToForm,
  providerTypeLabel,
  serviceToForm,
  toDoctorPayload,
  toProviderPayload,
  toServicePayload,
} from "./model/list-model";
import type {
  DoctorFormState,
  DoctorSummary,
  ProviderDetail,
  ProviderFilters,
  ProviderFormState,
  ProviderPermissions,
  ProviderSummary,
  ServiceFormState,
  ServiceItem,
} from "./model/types";
import {
  DEFAULT_PROVIDER_FROZEN_COLUMNS,
  DEFAULT_PROVIDER_HIDDEN_COLUMNS,
  MAX_PROVIDER_FROZEN_COLUMNS,
} from "./ui/providers-columns";
import { useProvidersListTableModel } from "./ui/hooks/use-providers-list-table-model";
import {
  PageHeader,
  inputClass as shellInputClassName,
  selectClass as shellSelectClassName,
  textareaClass as shellTextareaClass,
} from "@/components/ui-shell";
import { clearApiCache } from "@/lib/api";
import { useSecurePersistedState } from "@/lib/secure-persist";
import { useDebouncedRealtimeSubscription } from "@/lib/realtime";

const selectClassName = shellSelectClassName;
const textareaClassName = shellTextareaClass;
const DEFAULT_PROVIDER_SORT: SortStack = [{ field: "provider", dir: "asc" }];
const PROVIDER_REALTIME_EVENTS = [
  "provider.created",
  "provider.updated",
  "provider.deleted",
  "provider.activated",
  "provider.deactivated",
  "provider.template_created",
  "provider.template_updated",
  "provider.doctor_created",
  "provider.doctor_updated",
  "provider.doctor_deleted",
  "provider.service_created",
  "provider.service_updated",
  "provider.service_deleted",
] as const;

function cardClass(extra?: string) {
  return cn(
    "rounded-[1.75rem] border border-border/70 bg-card shadow-[0_20px_60px_rgba(15,23,42,0.05)]",
    extra
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11.5px] font-medium text-muted-foreground leading-tight">
        {label}
      </span>
      {children}
    </label>
  );
}

function titleWithDot(title: ReactNode) {
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden className="size-1.5 rounded-full bg-primary/70" />
      <span>{title}</span>
    </span>
  );
}

function Banner({ tone, children }: { tone: "error" | "warning"; children: ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-2xl border px-4 py-3 text-sm",
        tone === "error"
          ? "border-rose-200 bg-rose-50 text-rose-700"
          : "border-amber-200 bg-amber-50 text-amber-700"
      )}
    >
      {children}
    </div>
  );
}

function InlineInfo({
  icon: Icon,
  children,
}: {
  icon: typeof MapPin;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-600">
      <Icon className="size-4 text-slate-400" />
      <span>{children}</span>
    </div>
  );
}

function EmptyPanel({
  title,
  text,
}: {
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/90 px-5 py-6">
      <p className="text-sm font-medium text-slate-900">{title}</p>
      <p className="mt-2 text-sm leading-6 text-slate-600">{text}</p>
    </div>
  );
}

function ProvidersPage() {
  const { user } = useAuth();
  const { t, lang } = useLang();
  const tr = t as unknown as Record<string, string>;
  const l = (de: string, ru: string, en: string) => (lang === "de" ? de : lang === "ru" ? ru : en);
  const providerColumnGroupLabels = useMemo(
    () => ({
      identity: t.operations_column_group_identity,
      registry: t.operations_column_group_registry,
      contact: t.operations_column_group_contact,
      activity: t.operations_column_group_activity,
      audit: t.operations_column_group_audit,
    }),
    [t],
  );
  const { staffGo } = useStaffNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const permissions = useMemo(() => providerPermissions(user?.role), [user?.role]);
  type PersistedProviderFilters = Pick<
    ProviderFilters,
    "providerType" | "activeOnly" | "hasContract"
  >;
  const persistedDefaults: PersistedProviderFilters = {
    providerType: permissions.forceNonMedical ? "non_medical" : DEFAULT_FILTERS.providerType,
    activeOnly: DEFAULT_FILTERS.activeOnly,
    hasContract: DEFAULT_FILTERS.hasContract,
  };
  const [persistedProviderFilters, setPersistedProviderFilters] =
    useSecurePersistedState<PersistedProviderFilters>(
      "providers.filters",
      persistedDefaults,
      {
        schemaVersion: 1,
        validate: (value): value is PersistedProviderFilters =>
          Boolean(value) &&
          typeof value === "object" &&
          typeof (value as Record<string, unknown>).providerType === "string" &&
          typeof (value as Record<string, unknown>).activeOnly === "string" &&
          typeof (value as Record<string, unknown>).hasContract === "string",
      },
    );
  const [filters, setFiltersState] = useState<ProviderFilters>(() => {
    const base: ProviderFilters = {
      ...DEFAULT_FILTERS,
      providerType: permissions.forceNonMedical
        ? "non_medical"
        : persistedProviderFilters.providerType,
      activeOnly: persistedProviderFilters.activeOnly,
      hasContract: persistedProviderFilters.hasContract,
    };
    if (typeof window === "undefined") return base;

    const params = new URLSearchParams(window.location.search);
    const tableState = readDataTableState(params);
    const activeOnly = params.get("active");
    const providerType = params.get("provider_type");
    const hasContract = params.get("contract");

    return {
      ...base,
      search: tableState.search ?? "",
      providerType: permissions.forceNonMedical
        ? "non_medical"
        : providerType === "medical" || providerType === "non_medical"
          ? providerType
          : base.providerType,
      activeOnly:
        activeOnly === "" || activeOnly === "true" || activeOnly === "false"
          ? activeOnly
          : base.activeOnly,
      hasContract:
        hasContract === "true" || hasContract === "false" ? hasContract : base.hasContract,
    };
  });
  const setFilters: typeof setFiltersState = useCallback(
    (value) => {
      setFiltersState((prev) => {
        const next = typeof value === "function"
          ? (value as (p: ProviderFilters) => ProviderFilters)(prev)
          : value;
        setPersistedProviderFilters({
          providerType: next.providerType,
          activeOnly: next.activeOnly,
          hasContract: next.hasContract,
        });
        return next;
      });
    },
    [setPersistedProviderFilters],
  );
  const deferredSearch = useDeferredValue(filters.search);
  const [filterPredicates, setFilterPredicatesState] = useState<FilterPredicate[]>(() => {
    if (typeof window === "undefined") return [];
    return readDataTableState(new URLSearchParams(window.location.search)).filters ?? [];
  });
  const [sortStack, setSortStackState] = useState<SortStack>(() => {
    if (typeof window === "undefined") return DEFAULT_PROVIDER_SORT;
    const tableState = readDataTableState(new URLSearchParams(window.location.search));
    return tableState.sort?.length ? tableState.sort : DEFAULT_PROVIDER_SORT;
  });
  const [hiddenColumns, setHiddenColumns] = useVersionedLocalStorage<string[]>(
    "providers.hiddenColumns",
    DEFAULT_PROVIDER_HIDDEN_COLUMNS,
    1,
  );
  const [frozenColumns, setFrozenColumns] = useVersionedLocalStorage<string[]>(
    "providers.frozenColumns",
    DEFAULT_PROVIDER_FROZEN_COLUMNS,
    1,
  );
  const [density, setDensity] = useLocalStorage<DensityLevel>("providers.density", "compact");
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [listBusy, setListBusy] = useState(false);
  const [listError, setListError] = useState("");
  const [listVersion, setListVersion] = useState(0);

  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createForm, setCreateForm] = useState<ProviderFormState>(
    blankProviderForm(permissions.forceNonMedical ? "non_medical" : "medical")
  );

  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<ProviderDetail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detailVersion, setDetailVersion] = useState(0);

  const [providerForm, setProviderForm] = useState<ProviderFormState>(blankProviderForm());
  const [providerBusy, setProviderBusy] = useState(false);
  const [providerError, setProviderError] = useState("");
  const [providerActionBusy, setProviderActionBusy] = useState<string | null>(null);

  const [doctorForm, setDoctorForm] = useState<DoctorFormState>(blankDoctorForm());
  const [doctorBusy, setDoctorBusy] = useState(false);
  const [doctorError, setDoctorError] = useState("");

  const [serviceForm, setServiceForm] = useState<ServiceFormState>(blankServiceForm());
  const [serviceBusy, setServiceBusy] = useState(false);
  const [serviceError, setServiceError] = useState("");

  const effectiveFilters = useMemo<ProviderFilters>(
    () => ({ ...filters, search: deferredSearch || filters.search }),
    [deferredSearch, filters]
  );

  const providersPath = useMemo(
    () => buildProvidersQuery(effectiveFilters, permissions.forceNonMedical),
    [effectiveFilters, permissions.forceNonMedical]
  );

  const { columns, metrics, sortedAndFilteredProviders } = useProvidersListTableModel({
    deferredSearch,
    filterPredicates,
    frozenColumns,
    providers,
    sortStack,
    tr,
  });

  const anyFilterActive =
    filters.search.trim() !== "" ||
    filters.providerType !== (permissions.forceNonMedical ? "non_medical" : "") ||
    filters.activeOnly !== DEFAULT_FILTERS.activeOnly ||
    filters.hasContract !== "" ||
    filterPredicates.length > 0;

  function setFilterPredicates(next: FilterPredicate[]) {
    setFilterPredicatesState(next);
    const params = writeDataTableState(new URLSearchParams(searchParams), { filters: next });
    setSearchParams(params, { replace: true });
  }

  function setSortStack(next: SortStack) {
    setSortStackState(next);
    const params = writeDataTableState(new URLSearchParams(searchParams), { sort: next });
    setSearchParams(params, { replace: true });
  }

  function setSearch(value: string) {
    setFilters((current) => ({ ...current, search: value }));
    const params = writeDataTableState(new URLSearchParams(searchParams), { search: value });
    setSearchParams(params, { replace: true });
  }

  function setServerFilter(key: keyof ProviderFilters, value: string, queryKey: string) {
    setFilters((current) => ({ ...current, [key]: value }));
    syncQuery({ [queryKey]: value || null });
  }

  function handleColumnFreezeChange(columnId: string, frozen: boolean) {
    setFrozenColumns((current) => {
      if (frozen) {
        if (current.includes(columnId) || current.length >= MAX_PROVIDER_FROZEN_COLUMNS) {
          return current;
        }
        return [...current, columnId];
      }
      return current.filter((id) => id !== columnId);
    });
  }

  function exportProviders() {
    const visibleColumns = columns.filter((column) => !hiddenColumns.includes(column.id) || column.required);
    const stamp = new Date().toISOString().slice(0, 10);
    exportCsv(sortedAndFilteredProviders, visibleColumns, `providers-${stamp}.csv`);
  }

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
    const providerParam = searchParams.get("provider") ?? "";
    if (providerParam && providerParam !== selectedId) {
      setSelectedId(providerParam);
      setDetailOpen(true);
    }
  }, [searchParams, selectedId]);

  useEffect(() => {
    if (!permissions.canViewPage) {
      startTransition(() => setProviders([]));
      return;
    }

    let cancelled = false;
    setListBusy(true);
    setListError("");

    void fetchProviders(providersPath)
      .then((items) => {
        if (cancelled) return;
        startTransition(() => setProviders(items));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setListError(error instanceof Error ? error.message : t.common_failed_load);
      })
      .finally(() => {
        if (!cancelled) {
          setListBusy(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [permissions.canViewPage, providersPath, listVersion, t.common_failed_load]);

  useEffect(() => {
    if (!detailOpen || !selectedId) return;

    let cancelled = false;
    setDetailBusy(true);
    setDetailError("");
    setProviderError("");
    setDoctorError("");
    setServiceError("");

    void fetchProviderDetail(selectedId)
      .then((item) => {
        if (cancelled) return;
        startTransition(() => {
          setDetail(item);
          setProviderForm(providerToForm(item));
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setDetailError(error instanceof Error ? error.message : t.common_failed_load);
      })
      .finally(() => {
        if (!cancelled) {
          setDetailBusy(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [detailOpen, selectedId, detailVersion, t.common_failed_load]);

  useEffect(() => {
    setCreateForm(blankProviderForm(permissions.forceNonMedical ? "non_medical" : "medical"));
    if (permissions.forceNonMedical) {
      setFilters((current) =>
        current.providerType === "non_medical"
          ? current
          : { ...current, providerType: "non_medical" },
      );
    }
  }, [permissions.forceNonMedical, setFilters]);

  function refreshList() {
    setListVersion((current) => current + 1);
  }

  function refreshDetail() {
    setDetailVersion((current) => current + 1);
  }

  useDebouncedRealtimeSubscription(PROVIDER_REALTIME_EVENTS, (_event, events) => {
    if (!permissions.canViewPage) return;
    clearApiCache("/providers");
    const selectedWasUpdated = events.some((event) => event.entity_id === selectedId);
    for (const event of events) {
      if (event.entity_type === "provider" && event.entity_id) {
        clearApiCache(`/providers/${event.entity_id}`);
        clearApiCache(`/providers/${event.entity_id}/patients`);
        clearApiCache(`/providers/${event.entity_id}/templates`);
        clearApiCache(`/appointments?provider_id=${event.entity_id}`);
      }
    }
    if (selectedId) {
      clearApiCache(`/providers/${selectedId}`);
      clearApiCache(`/providers/${selectedId}/patients`);
      clearApiCache(`/providers/${selectedId}/templates`);
      clearApiCache(`/appointments?provider_id=${selectedId}`);
    }
    startTransition(() => {
      setListVersion((current) => current + 1);
      if (!selectedId || selectedWasUpdated) {
        setDetailVersion((current) => current + 1);
      }
    });
  }, 250);

  function openProvider(id: string) {
    staffGo(`/providers/${id}`);
    syncQuery({ provider: id });
  }

  function resetFilters() {
    setFilters({
      ...DEFAULT_FILTERS,
      providerType: permissions.forceNonMedical ? "non_medical" : "",
    });
    setFilterPredicatesState([]);
    setSortStackState(DEFAULT_PROVIDER_SORT);
    const params = writeDataTableState(new URLSearchParams(searchParams), {
      filters: [],
      sort: DEFAULT_PROVIDER_SORT,
      search: "",
    });
    params.delete("provider_type");
    params.delete("active");
    params.delete("contract");
    setSearchParams(params, { replace: true });
  }

  function openCreateSheet() {
    setCreateError("");
    setCreateForm(blankProviderForm(permissions.forceNonMedical ? "non_medical" : "medical"));
    setCreateOpen(true);
  }

  async function handleCreateProvider(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateBusy(true);
    setCreateError("");

    try {
      const payload = toProviderPayload(createForm, permissions.forceNonMedical);
      const created = await createProvider(payload);
      setCreateOpen(false);
      staffGo(`/providers/${created.id}`);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : t.common_failed_create);
    } finally {
      setCreateBusy(false);
    }
  }

  async function handleUpdateProvider(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;

    setProviderBusy(true);
    setProviderError("");

    try {
      const payload = toProviderPayload(providerForm, permissions.forceNonMedical);
      await updateProvider(detail.id, payload);
      refreshList();
      refreshDetail();
    } catch (error) {
      setProviderError(error instanceof Error ? error.message : t.common_failed_update);
    } finally {
      setProviderBusy(false);
    }
  }

  async function handleToggleProvider(active: boolean) {
    if (!detail) return;

    setProviderActionBusy(active ? "activate" : "deactivate");
    setProviderError("");

    try {
      await setProviderActive(detail.id, active);
      refreshList();
      refreshDetail();
    } catch (error) {
      setProviderError(
        error instanceof Error
          ? error.message
          : `Failed to ${active ? "activate" : "deactivate"} provider`
      );
    } finally {
      setProviderActionBusy(null);
    }
  }

  async function handleDeleteProvider() {
    if (!detail) return;
    if (!window.confirm(`Delete provider "${detail.name}"?`)) return;

    setProviderActionBusy("delete");
    setProviderError("");

    try {
      await deleteProvider(detail.id);
      setDetailOpen(false);
      setSelectedId("");
      setDetail(null);
      refreshList();
    } catch (error) {
      setProviderError(error instanceof Error ? error.message : t.common_failed_update);
    } finally {
      setProviderActionBusy(null);
    }
  }

  async function handleDoctorSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;

    setDoctorBusy(true);
    setDoctorError("");

    try {
      await saveProviderDoctor(detail.id, doctorForm.id, toDoctorPayload(doctorForm));
      setDoctorForm(blankDoctorForm());
      refreshList();
      refreshDetail();
    } catch (error) {
      setDoctorError(error instanceof Error ? error.message : t.common_failed_update);
    } finally {
      setDoctorBusy(false);
    }
  }

  async function handleDeleteDoctor(doctorId: string, doctorName: string) {
    if (!detail) return;
    if (!window.confirm(`Delete doctor "${doctorName}"?`)) return;

    setDoctorBusy(true);
    setDoctorError("");

    try {
      await deleteProviderDoctor(detail.id, doctorId);
      if (doctorForm.id === doctorId) {
        setDoctorForm(blankDoctorForm());
      }
      refreshDetail();
      refreshList();
    } catch (error) {
      setDoctorError(error instanceof Error ? error.message : t.common_failed_update);
    } finally {
      setDoctorBusy(false);
    }
  }

  async function handleServiceSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;

    setServiceBusy(true);
    setServiceError("");

    try {
      await saveProviderService(detail.id, serviceForm.id, toServicePayload(serviceForm));
      setServiceForm(blankServiceForm());
      refreshDetail();
    } catch (error) {
      setServiceError(error instanceof Error ? error.message : t.common_failed_update);
    } finally {
      setServiceBusy(false);
    }
  }

  async function handleDeleteService(serviceId: string, serviceName: string) {
    if (!detail) return;
    if (!window.confirm(`Delete service "${serviceName}"?`)) return;

    setServiceBusy(true);
    setServiceError("");

    try {
      await deleteProviderService(detail.id, serviceId);
      if (serviceForm.id === serviceId) {
        setServiceForm(blankServiceForm());
      }
      refreshDetail();
    } catch (error) {
      setServiceError(error instanceof Error ? error.message : t.common_failed_update);
    } finally {
      setServiceBusy(false);
    }
  }

  if (!permissions.canViewPage) {
    return (
      <div className="space-y-6">
        <section className={cardClass("p-8")}>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
            {t.providers_no_access_title}
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">
            {t.providers_no_access_body}
          </p>
        </section>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4">
        <PageHeader
          title={t.providers_title}
          actions={
            <>
              {permissions.canManageRegistry ? (
                <Button
                  type="button"
                  className="h-9 rounded-lg px-3.5"
                  onClick={openCreateSheet}
                >
                  <Plus className="size-4" />
                  {t.providers_new}
                </Button>
              ) : null}
            </>
          }
        />

        {/* KPI inline stats */}
        <div className="grid grid-flow-col auto-cols-fr overflow-hidden rounded-xl border border-border px-3 pb-3 pt-4 [&>article:not(:last-child)_.admin-inline-metric-separator]:xl:block">
          <AdminInlineMetric icon={Building2} label={t.providers_title} value={metrics.total} tone="sky" />
          <AdminInlineMetric
            icon={UsersRound}
            label={permissions.forceNonMedical ? l("Services", "Сервисы", "Services") : t.providers_doctors}
            value={permissions.forceNonMedical ? metrics.services : metrics.doctors}
            tone="emerald"
          />
          <AdminInlineMetric
            icon={Stethoscope}
            label={t.providers_linked_patients}
            value={metrics.patients}
            tone="amber"
          />
          <AdminInlineMetric
            icon={CalendarClock}
            label={permissions.forceNonMedical ? l("Offene Anfragen", "Открытые запросы", "Open requests") : t.providers_appointments}
            value={permissions.forceNonMedical ? metrics.openConciergeRequests : metrics.appointments}
            tone="slate"
          />
        </div>

        <div className="relative z-30 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="relative min-w-[240px] flex-1 sm:max-w-sm">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={filters.search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setSearch("");
                    (event.target as HTMLInputElement).blur();
                  }
                }}
                placeholder={t.common_search}
                className="h-8 w-full rounded-lg bg-background pl-8 text-[13px]"
              />
            </div>

            <NativeComboboxSelect
              value={filters.providerType}
              onChange={(event) => setServerFilter("providerType", event.target.value, "provider_type")}
              disabled={permissions.forceNonMedical}
              className={cn(selectClassName, "h-8 w-[170px] bg-background text-[13px]")}
            >
              <option value="">{t.providers_all}</option>
              <option value="medical">{t.providers_type_medical}</option>
              <option value="non_medical">{t.providers_type_non_medical}</option>
            </NativeComboboxSelect>

            <NativeComboboxSelect
              value={filters.activeOnly}
              onChange={(event) => setServerFilter("activeOnly", event.target.value, "active")}
              className={cn(selectClassName, "h-8 w-[140px] bg-background text-[13px]")}
            >
              <option value="">{t.providers_all}</option>
              <option value="true">{t.common_active}</option>
              <option value="false">{t.common_inactive}</option>
            </NativeComboboxSelect>

            <NativeComboboxSelect
              value={filters.hasContract}
              onChange={(event) => setServerFilter("hasContract", event.target.value, "contract")}
              className={cn(selectClassName, "h-8 w-[160px] bg-background text-[13px]")}
            >
              <option value="">{t.providers_contract}</option>
              <option value="true">{t.providers_contract_with}</option>
              <option value="false">{t.providers_contract_without}</option>
            </NativeComboboxSelect>

            <div className="ml-auto flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                title={t.common_refresh ?? "Refresh"}
                aria-label={t.common_refresh ?? "Refresh"}
                onClick={() => {
                  refreshList();
                  if (detailOpen && selectedId) {
                    refreshDetail();
                  }
                }}
              >
                <RefreshCw className={cn("size-3.5", listBusy && "animate-spin")} />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                title={t.common_export ?? "Export"}
                aria-label={t.common_export ?? "Export"}
                onClick={exportProviders}
              >
                <Download className="size-3.5" />
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <FilterBuilder
              columns={columns}
              rows={providers}
              filters={filterPredicates}
              onChange={setFilterPredicates}
              translations={{
                addFilter: tr.table_filter ?? "Filter",
                clearAll: tr.table_sort_clear ?? tr.common_reset ?? "Clear",
                searchPlaceholder: tr.table_filter_search_fields ?? tr.common_search ?? "Search",
                noFields: tr.table_filter_no_fields ?? "No available fields",
                remove: tr.table_filter_remove ?? tr.common_remove ?? "Remove",
                valuePlaceholder: tr.table_filter_value ?? "Value",
                yes: tr.common_yes ?? "Yes",
                no: tr.common_no ?? "No",
                operatorLabels: {
                  contains: tr.filter_op_contains ?? "contains",
                  does_not_contain: tr.filter_op_does_not_contain ?? "does not contain",
                  is_empty: tr.filter_op_is_empty ?? "is empty",
                  is_not_empty: tr.filter_op_is_not_empty ?? "is not empty",
                  is: tr.filter_op_is ?? "is",
                  is_not: tr.filter_op_is_not ?? "is not",
                  is_any_of: tr.filter_op_is_any_of ?? "is any of",
                  is_none_of: tr.filter_op_is_none_of ?? "is none of",
                  has_any: tr.filter_op_has_any ?? "has any of",
                  has_all: tr.filter_op_has_all ?? "has all of",
                  has_none: tr.filter_op_has_none ?? "has none of",
                  before: tr.filter_op_before ?? "before",
                  after: tr.filter_op_after ?? "after",
                  between: tr.filter_op_between ?? "between",
                  last_n_days: tr.filter_op_last_n_days ?? "last N days",
                  equals: tr.filter_op_equals ?? "equals",
                },
              }}
            />
            <SortBuilder
              columns={columns}
              value={sortStack}
              onChange={setSortStack}
              translations={{
                buttonLabel: tr.common_sort ?? "Sort",
                addSort: tr.table_sort_add ?? "Add sort",
                clearAll: tr.table_sort_clear ?? tr.common_reset ?? "Clear",
                ascending: tr.table_sort_ascending ?? "Asc",
                descending: tr.table_sort_descending ?? "Desc",
                emptyHint: tr.common_sort ?? "Sort",
                moveUp: tr.table_sort_move_up ?? "Move up",
                moveDown: tr.table_sort_move_down ?? "Move down",
                remove: tr.table_sort_remove ?? tr.common_remove ?? "Remove",
              }}
            />
            <ColumnVisibilityMenu
              columns={columns}
              hiddenColumns={hiddenColumns}
              onChange={setHiddenColumns}
              defaultHidden={DEFAULT_PROVIDER_HIDDEN_COLUMNS}
              frozenColumns={frozenColumns}
              onFrozenColumnsChange={setFrozenColumns}
              defaultFrozen={DEFAULT_PROVIDER_FROZEN_COLUMNS}
              maxFrozenColumns={MAX_PROVIDER_FROZEN_COLUMNS}
              groupLabels={providerColumnGroupLabels}
              buttonLabel={tr.table_columns ?? "Columns"}
              searchPlaceholder={tr.table_columns_search ?? "Search columns"}
              resetLabel={tr.common_reset ?? "Reset"}
              showAllLabel={tr.table_columns_show_all ?? "Show all"}
              hideAllLabel={tr.table_columns_hide_all ?? "Hide all"}
              noMatchLabel={tr.table_columns_no_match ?? "No matching columns"}
              requiredNoteLabel={tr.table_columns_required ?? "required"}
              freezeLabel={tr.table_columns_freeze ?? "Freeze"}
              unfreezeLabel={tr.table_columns_unfreeze ?? "Unfreeze"}
              frozenNoteLabel={tr.table_columns_frozen ?? "frozen"}
            />
            <DensityToggle
              value={density}
              onChange={setDensity}
              ariaLabel={tr.table_density ?? "Row density"}
              labels={{
                comfortable: tr.table_density_comfortable ?? "Comfortable",
                compact: tr.table_density_compact ?? "Compact",
                condensed: tr.table_density_condensed ?? "Condensed",
              }}
            />
            {anyFilterActive ? (
              <Button type="button" variant="ghost" size="sm" onClick={resetFilters}>
                <X className="size-3.5" />
                {l("Zurücksetzen", "Сбросить", "Reset")}
              </Button>
            ) : null}
          </div>
        </div>

        {/* Error banner */}
        {listError ? <Banner tone="error">{listError}</Banner> : null}

        <DataTable
          rows={sortedAndFilteredProviders}
          columns={columns}
          hiddenColumns={hiddenColumns}
          sort={sortStack}
          onSortChange={setSortStack}
          onColumnFreezeChange={handleColumnFreezeChange}
          isColumnFreezeDisabled={(column, nextFrozen) =>
            nextFrozen &&
            !frozenColumns.includes(column.id) &&
            frozenColumns.length >= MAX_PROVIDER_FROZEN_COLUMNS
          }
          columnHeaderContextMenuLabels={{
            column: tr.table_columns ?? "Column",
            freeze: tr.table_columns_freeze ?? "Freeze column",
            unfreeze: tr.table_columns_unfreeze ?? "Unfreeze column",
            frozen: tr.table_columns_frozen ?? "Frozen",
            freezeLimitReached: tr.table_columns_freeze_limit ?? "Freeze limit reached",
          }}
          density={density}
          rowId={(provider) => provider.id}
          activeRowId={selectedId}
          onRowClick={(provider) => openProvider(provider.id)}
          loading={listBusy && providers.length === 0}
          emptyState={<span className="text-sm text-muted-foreground">{t.patients_no_match}</span>}
          className="min-h-[460px]"
          footer={
            <div className="flex items-center justify-between">
              <span className="tabular-nums">
                {sortedAndFilteredProviders.length === providers.length
                  ? `${providers.length}`
                  : `${sortedAndFilteredProviders.length} / ${providers.length}`}{" "}
                {t.providers_title.toLowerCase()}
              </span>
              {listBusy && providers.length > 0 ? (
                <span className="inline-flex items-center gap-1">
                  <LoaderCircle className="size-3 animate-spin" />
                  {t.common_loading}
                </span>
              ) : null}
            </div>
          }
        />
      </div>

      <Sheet open={createOpen} onOpenChange={setCreateOpen}>
        <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-2xl">
          <form onSubmit={handleCreateProvider} className="flex flex-1 min-h-0 flex-col">
            <AdminSheetScaffold
              title={t.providers_new}
              description={t.providers_create_description}
              footer={(
                <SheetFormFooter
                  cancelLabel={t.common_cancel}
                  submitLabel={t.providers_new}
                  submittingLabel={t.patients_creating}
                  submitting={createBusy}
                  onCancel={() => setCreateOpen(false)}
                />
              )}
            >
              {createError ? <Banner tone="error">{createError}</Banner> : null}
              <ProviderFormFields
                form={createForm}
                onChange={(field, value) =>
                  setCreateForm((current) => ({ ...current, [field]: value }))
                }
                forceNonMedical={permissions.forceNonMedical}
              />
            </AdminSheetScaffold>
          </form>
        </SheetContent>
      </Sheet>

      <Sheet
        open={detailOpen}
        onOpenChange={(open) => {
          setDetailOpen(open);
          if (!open) {
            setSelectedId("");
            setDetail(null);
            setProviderError("");
            setDoctorError("");
            setServiceError("");
            setDoctorForm(blankDoctorForm());
            setServiceForm(blankServiceForm());
            syncQuery({ provider: null });
          }
        }}
      >
        <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-[880px]">
          {detailBusy ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <LoaderCircle className="mr-2 size-4 animate-spin" />
              {l("Anbieter wird geladen", "Загрузка провайдера", "Loading provider")}
            </div>
          ) : detail ? (
            <form onSubmit={handleUpdateProvider} className="flex flex-1 min-h-0 flex-col">
              <AdminSheetScaffold
                title={detail.name || t.providers_detail}
                description={t.providers_subtitle}
                footer={(
                  <SheetActionsFooter>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 rounded-lg"
                      onClick={() => setDetailOpen(false)}
                    >
                      {t.common_cancel}
                    </Button>
                    {permissions.canManageRegistry ? (
                      <Button
                        type="submit"
                        className="h-9 rounded-lg gap-1.5"
                        disabled={providerBusy}
                      >
                        {providerBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                        {providerBusy ? t.patients_saving : t.common_save}
                      </Button>
                    ) : null}
                  </SheetActionsFooter>
                )}
              >
                {detailError ? <Banner tone="error">{detailError}</Banner> : null}
                {providerError ? <Banner tone="error">{providerError}</Banner> : null}

                <ProviderOverviewSection
                  detail={detail}
                  providerActionBusy={providerActionBusy}
                  permissions={permissions}
                  onActivate={() => handleToggleProvider(true)}
                  onDeactivate={() => handleToggleProvider(false)}
                  onDelete={handleDeleteProvider}
                  onOpenPatients={() => staffGo(`/patients?provider=${detail.id}`)}
                  onOpenAppointments={() => staffGo(`/appointments?provider=${detail.id}`)}
                />

                {permissions.canManageRegistry || permissions.canViewPage ? (
                  <section className="rounded-xl border border-border/50 bg-card/40 p-4 space-y-3">
                    <h3 className="text-[13px] font-semibold tracking-tight text-foreground">
                      {titleWithDot(l("Anbieterprofil", "Профиль провайдера", "Provider profile"))}
                    </h3>
                    <ProviderFormFields
                      form={providerForm}
                      onChange={(field, value) =>
                        setProviderForm((current) => ({ ...current, [field]: value }))
                      }
                      forceNonMedical={permissions.forceNonMedical}
                      disabled={!permissions.canManageRegistry}
                    />
                    {!permissions.canManageRegistry ? (
                      <p className="text-[12px] text-muted-foreground italic">
                        {t.providers_edit_restricted_note}
                      </p>
                    ) : null}
                  </section>
                ) : null}

                <DoctorSection
                  detail={detail}
                  form={doctorForm}
                  busy={doctorBusy}
                  error={doctorError}
                  canManage={permissions.canManageRegistry}
                  onChange={(field, value) =>
                    setDoctorForm((current) => ({ ...current, [field]: value }))
                  }
                  onEdit={(doctor) => {
                    setDoctorError("");
                    setDoctorForm(doctorToForm(doctor));
                  }}
                  onCancelEdit={() => setDoctorForm(blankDoctorForm())}
                  onDelete={handleDeleteDoctor}
                  onSubmit={handleDoctorSubmit}
                />

                <ServiceSection
                  detail={detail}
                  form={serviceForm}
                  busy={serviceBusy}
                  error={serviceError}
                  canManage={permissions.canManageRegistry}
                  onChange={(field, value) =>
                    setServiceForm((current) => ({ ...current, [field]: value }))
                  }
                  onEdit={(service) => {
                    setServiceError("");
                    setServiceForm(serviceToForm(service));
                  }}
                  onCancelEdit={() => setServiceForm(blankServiceForm())}
                  onDelete={handleDeleteService}
                  onSubmit={handleServiceSubmit}
                />

                <LinkedPatientsSection
                  detail={detail}
                  onOpenPatient={(patientId) => staffGo(`/patients?patient=${patientId}`)}
                  onOpenAppointments={(patientId) =>
                    staffGo(`/appointments?patient=${patientId}&provider=${detail.id}`)
                  }
                />
                <InteractionHistorySection
                  detail={detail}
                  onOpenPatient={(patientId) => staffGo(`/patients?patient=${patientId}`)}
                  onOpenAppointments={(patientId) =>
                    staffGo(`/appointments?patient=${patientId}&provider=${detail.id}`)
                  }
                  onOpenAppointment={(appointmentId) =>
                    staffGo(`/appointments?appointment=${appointmentId}`)
                  }
                  onOpenOrder={(orderId) => staffGo(`/orders?order=${orderId}`)}
                />
              </AdminSheetScaffold>
            </form>
          ) : detailError ? (
            <div className="p-4">
              <Banner tone="error">{detailError}</Banner>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {t.providers_select_to_open_workspace}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

export function ProviderOverviewSection({
  detail,
  providerActionBusy,
  permissions,
  onActivate,
  onDeactivate,
  onDelete,
  onOpenPatients,
  onOpenAppointments,
}: {
  detail: ProviderDetail;
  providerActionBusy: string | null;
  permissions: ProviderPermissions;
  onActivate: () => void;
  onDeactivate: () => void;
  onDelete: () => void;
  onOpenPatients: () => void;
  onOpenAppointments: () => void;
}) {
  const { t, lang } = useLang();
  const tr = t as unknown as Record<string, string>;
  const l = (de: string, ru: string, en: string) =>
    lang === "de" ? de : lang === "ru" ? ru : en;

  return (
    <section className="rounded-xl border border-border/50 bg-card/40 p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className={cn(
                "rounded-full text-[10px]",
                detail.provider_type === "medical"
                  ? "border-sky-200 bg-sky-50 text-sky-700"
                  : "border-violet-200 bg-violet-50 text-violet-700",
              )}
            >
              {providerTypeLabel(detail.provider_type, tr)}
            </Badge>
            <Badge
              variant="outline"
              className={cn(
                "rounded-full text-[10px]",
                detail.is_active
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-border/60 bg-muted/25 text-muted-foreground",
              )}
            >
              {detail.is_active ? t.common_active : t.common_inactive}
            </Badge>
            {detail.kooperationsvertrag ? (
              <Badge variant="outline" className="rounded-full text-[10px] border-border/60 bg-muted/25 text-foreground">
                {l("Vertrag verknüpft", "Договор привязан", "Contract linked")}
              </Badge>
            ) : null}
          </div>
          <h2 className="mt-3 text-xl font-semibold text-foreground">{detail.name}</h2>
          {detail.legal_name && detail.legal_name !== detail.name ? (
            <p className="mt-1 text-sm text-muted-foreground">{detail.legal_name}</p>
          ) : null}
        </div>
      </div>

      <div className="grid gap-2 text-sm text-muted-foreground">
        <InlineInfo icon={MapPin}>{providerMeta(detail) || t.common_not_set}</InlineInfo>
        <InlineInfo icon={Phone}>{detail.phone || t.common_not_set}</InlineInfo>
        <InlineInfo icon={Mail}>{detail.email || t.common_not_set}</InlineInfo>
        {detail.tax_id ? (
          <p className="text-xs text-muted-foreground/80">
            {l("Steuer-ID", "Налоговый ID", "Tax ID")} · {detail.tax_id}
          </p>
        ) : null}
        {detail.fachbereich ? (
          <p className="text-xs text-muted-foreground/80">
            {tr.providers_fachbereich} · {detail.fachbereich}
          </p>
        ) : null}
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-border/50 bg-card px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">
            {detail.provider_type === "non_medical"
              ? l("Kontakte", "Контакты", "Contacts")
              : t.providers_doctors}
          </p>
          <p className="mt-2 text-2xl font-semibold text-foreground">{detail.doctors.length}</p>
        </div>
        <div className="rounded-xl border border-border/50 bg-card px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">
            {l("Services", "Сервисы", "Services")}
          </p>
          <p className="mt-2 text-2xl font-semibold text-foreground">{detail.services.length}</p>
        </div>
        <div className="rounded-xl border border-border/50 bg-card px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">
            {l("Verknüpfte Patienten", "Связанные пациенты", "Linked patients")}
          </p>
          <p className="mt-2 text-2xl font-semibold text-foreground">{detail.linked_patients.length}</p>
        </div>
        <div className="rounded-xl border border-border/50 bg-card px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">
            {l("Aktivität", "Активность", "Activity items")}
          </p>
          <p className="mt-2 text-2xl font-semibold text-foreground">{detail.interactions.length}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 rounded-lg"
          onClick={onOpenPatients}
        >
          {l("Patientenlinks", "Связи с пациентами", "Patient links")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 rounded-lg"
          onClick={onOpenAppointments}
        >
          {l("Termine", "Записи", "Appointments")}
        </Button>
        {permissions.canManageRegistry ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-lg gap-1.5"
              disabled={providerActionBusy === "activate" || detail.is_active}
              onClick={onActivate}
            >
              {providerActionBusy === "activate" ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : null}
              {l("Aktivieren", "Активировать", "Activate")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-lg gap-1.5"
              disabled={providerActionBusy === "deactivate" || !detail.is_active}
              onClick={onDeactivate}
            >
              {providerActionBusy === "deactivate" ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : null}
              {l("Deaktivieren", "Деактивировать", "Deactivate")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-lg gap-1.5 border-rose-200 text-rose-700 hover:bg-rose-50"
              disabled={providerActionBusy === "delete"}
              onClick={onDelete}
            >
              {providerActionBusy === "delete" ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
              {l("Löschen", "Удалить", "Delete")}
            </Button>
          </>
        ) : null}
      </div>

      <p className="text-xs text-muted-foreground/80">
        {l("Aktualisiert", "Обновлено", "Updated")}{" "}
        {compactDateTime(detail.updated_at, t.common_not_set)}
      </p>
    </section>
  );
}

function DoctorSection({
  detail,
  form,
  busy,
  error,
  canManage,
  onChange,
  onEdit,
  onCancelEdit,
  onDelete,
  onSubmit,
}: {
  detail: ProviderDetail;
  form: DoctorFormState;
  busy: boolean;
  error: string;
  canManage: boolean;
  onChange: (field: keyof DoctorFormState, value: string) => void;
  onEdit: (doctor: DoctorSummary) => void;
  onCancelEdit: () => void;
  onDelete: (doctorId: string, doctorName: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const { t, lang } = useLang();
  const l = (de: string, ru: string, en: string) => (lang === "de" ? de : lang === "ru" ? ru : en);
  return (
    <section className={cardClass("p-5")}>
      <div className="flex items-center justify-between gap-3">
        <div>
            <h3 className="text-sm font-semibold text-slate-950">
              {titleWithDot(
                detail.provider_type === "non_medical"
                  ? l("Kontakte", "Контакты", "Contacts")
                  : t.providers_doctors,
              )}
            </h3>
            <p className="mt-1 text-sm text-slate-600">
              {detail.provider_type === "non_medical"
                ? t.providers_doctors_description_non_medical
                : t.providers_doctors_description_medical}
            </p>
          </div>
          <div className="text-xs uppercase tracking-[0.12em] text-slate-500">
            {detail.doctors.length} {detail.provider_type === "non_medical" ? l("Kontakte", "контактов", "contacts") : l("Kliniker", "врачей", "clinicians")}
          </div>
        </div>

      {detail.doctors.length === 0 ? (
        <div className="mt-4">
          <EmptyPanel
            title={t.providers_doctors}
            text={t.providers_no_patients}
          />
        </div>
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {detail.doctors.map((doctor) => (
            <div
              key={doctor.id}
              className="rounded-[1.4rem] border border-slate-200 bg-slate-50/80 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-base font-semibold text-slate-950">
                    {doctor.title ? `${doctor.title} ` : ""}
                    {doctor.name}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    {doctor.fachbereich || t.common_not_set}
                  </p>
                </div>
                {canManage ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="rounded-xl"
                    onClick={() => onEdit(doctor)}
                  >
                    {l("Bearbeiten", "Редактировать", "Edit")}
                  </Button>
                ) : null}
              </div>

              <div className="mt-3 space-y-2">
                <InlineInfo icon={Phone}>{doctor.phone || t.common_not_set}</InlineInfo>
                <InlineInfo icon={Mail}>{doctor.email || t.common_not_set}</InlineInfo>
              </div>

              {doctor.languages.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {doctor.languages.map((language) => (
                    <Badge
                      key={`${doctor.id}-${language}`}
                      variant="outline"
                      className="rounded-full border-slate-200 bg-white text-slate-700"
                    >
                      {language}
                    </Badge>
                  ))}
                </div>
              ) : null}

              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-2xl bg-white px-3 py-3">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">
                    {l("Lizenz", "Лицензия", "License")}
                  </p>
                  <p className="mt-2 text-sm font-medium text-slate-900">
                    {doctor.license_number || t.common_not_set}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {doctor.licensing_country || t.common_not_set}
                  </p>
                </div>
                <div className="rounded-2xl bg-white px-3 py-3">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">
                    {l("Lizenz gültig bis", "Лицензия действительна до", "License valid until")}
                  </p>
                  <p className="mt-2 text-sm font-medium text-slate-900">
                    {compactDate(doctor.licensing_valid_until, t.common_not_set)}
                  </p>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-white px-3 py-3">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">
                    {l("Patienten", "Пациенты", "Patients")}
                  </p>
                  <p className="mt-2 text-xl font-semibold text-slate-950">
                    {doctor.patient_count}
                  </p>
                </div>
                <div className="rounded-2xl bg-white px-3 py-3">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{l("Slots", "Слоты", "Slots")}</p>
                  <p className="mt-2 text-xl font-semibold text-slate-950">
                    {doctor.appointment_count}
                  </p>
                </div>
              </div>

              {canManage ? (
                <div className="mt-4 flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-2xl border-rose-200 text-rose-700 hover:bg-rose-50"
                    disabled={busy}
                    onClick={() => onDelete(doctor.id, doctor.name)}
                  >
                    {l("Löschen", "Удалить", "Delete")}
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {canManage ? (
        <form onSubmit={onSubmit} className="mt-5 space-y-4 border-t border-border/70 pt-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold text-slate-950">
                {titleWithDot(form.id ? t.providers_doctor_detail : t.providers_doctor_new)}
              </h4>
              <p className="mt-1 text-sm text-slate-600">
                {t.providers_doctors_hint}
              </p>
            </div>
            {form.id ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="rounded-xl"
                onClick={onCancelEdit}
              >
                {l("Bearbeitung abbrechen", "Отменить редактирование", "Cancel edit")}
              </Button>
            ) : null}
          </div>

          {error ? <Banner tone="error">{error}</Banner> : null}

          <DoctorFormFields form={form} onChange={onChange} />

          <div className="flex justify-end">
            <Button
              type="submit"
              className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
              disabled={busy}
            >
              {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {form.id ? t.common_save : t.providers_doctor_new}
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

function ServiceSection({
  detail,
  form,
  busy,
  error,
  canManage,
  onChange,
  onEdit,
  onCancelEdit,
  onDelete,
  onSubmit,
}: {
  detail: ProviderDetail;
  form: ServiceFormState;
  busy: boolean;
  error: string;
  canManage: boolean;
  onChange: (field: keyof ServiceFormState, value: string) => void;
  onEdit: (service: ServiceItem) => void;
  onCancelEdit: () => void;
  onDelete: (serviceId: string, serviceName: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const { t, lang } = useLang();
  const l = (de: string, ru: string, en: string) => (lang === "de" ? de : lang === "ru" ? ru : en);
  return (
    <section className={cardClass("p-5")}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-950">
            {titleWithDot(l("Servicekatalog", "Каталог сервисов", "Service catalog"))}
          </h3>
          <p className="mt-1 text-sm text-slate-600">
            {t.providers_services_description}
          </p>
        </div>
        <div className="text-xs uppercase tracking-[0.12em] text-slate-500">
          {detail.services.length} {l("Services", "сервисов", "services")}
        </div>
      </div>

      {detail.services.length === 0 ? (
        <div className="mt-4">
          <EmptyPanel
            title={t.providers_services}
            text={t.providers_no_patients}
          />
        </div>
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {detail.services.map((service) => (
            <div
              key={service.id}
              className="rounded-[1.4rem] border border-slate-200 bg-slate-50/80 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-base font-semibold text-slate-950">{service.service_name}</p>
                  <p className="mt-1 text-sm text-slate-600">
                    {service.description || t.common_not_set}
                  </p>
                </div>
                {canManage ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="rounded-xl"
                    onClick={() => onEdit(service)}
                  >
                    {l("Bearbeiten", "Редактировать", "Edit")}
                  </Button>
                ) : null}
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl bg-white px-3 py-3">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{l("Preis", "Цена", "Price")}</p>
                  <p className="mt-2 text-lg font-semibold text-slate-950">
                    {moneyLabel(service.price, service.currency)}
                  </p>
                </div>
                <div className="rounded-2xl bg-white px-3 py-3">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">
                    {l("Gültigkeit", "Срок действия", "Validity")}
                  </p>
                  <p className="mt-2 text-sm font-medium text-slate-900">
                    {compactDate(service.valid_from, t.common_not_set)}
                    {" -> "}
                    {compactDate(service.valid_to, t.common_not_set)}
                  </p>
                </div>
              </div>

              {canManage ? (
                <div className="mt-4 flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-2xl border-rose-200 text-rose-700 hover:bg-rose-50"
                    disabled={busy}
                    onClick={() => onDelete(service.id, service.service_name)}
                  >
                    {l("Löschen", "Удалить", "Delete")}
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {canManage ? (
        <form onSubmit={onSubmit} className="mt-5 space-y-4 border-t border-border/70 pt-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold text-slate-950">
                {titleWithDot(form.id ? t.providers_service_detail : t.providers_service_new)}
              </h4>
              <p className="mt-1 text-sm text-slate-600">
                {t.providers_services_hint}
              </p>
            </div>
            {form.id ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="rounded-xl"
                onClick={onCancelEdit}
              >
                {l("Bearbeitung abbrechen", "Отменить редактирование", "Cancel edit")}
              </Button>
            ) : null}
          </div>

          {error ? <Banner tone="error">{error}</Banner> : null}

          <ServiceFormFields form={form} onChange={onChange} />

          <div className="flex justify-end">
            <Button
              type="submit"
              className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
              disabled={busy}
            >
              {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {form.id ? t.common_save : t.providers_service_new}
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

export function LinkedPatientsSection({
  detail,
  onOpenPatient,
  onOpenAppointments,
}: {
  detail: ProviderDetail;
  onOpenPatient: (patientId: string) => void;
  onOpenAppointments: (patientId: string) => void;
}) {
  const { t, lang } = useLang();
  const l = (de: string, ru: string, en: string) => (lang === "de" ? de : lang === "ru" ? ru : en);
  return (
    <section className={cardClass("p-5")}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-950">
            {titleWithDot(l("Verknüpfte Patienten", "Связанные пациенты", "Linked patients"))}
          </h3>
          <p className="mt-1 text-sm text-slate-600">
            {t.providers_linked_patients_description}
          </p>
        </div>
        <div className="text-xs uppercase tracking-[0.12em] text-slate-500">
          {detail.linked_patients.length} {l("Patienten", "пациентов", "patients")}
        </div>
      </div>

      {detail.linked_patients.length === 0 ? (
        <div className="mt-4">
          <EmptyPanel
            title={t.providers_no_patients}
            text={t.providers_no_patients}
          />
        </div>
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {detail.linked_patients.map((patient) => (
            <div
              key={patient.id}
              className="rounded-[1.4rem] border border-slate-200 bg-slate-50/80 p-4"
            >
              <p className="text-base font-semibold text-slate-950">{patientLabel(patient)}</p>
              <p className="mt-1 text-sm text-slate-600">
                {l("Letzte Aktivität", "Последнее взаимодействие", "Last interaction")} {compactDateTime(patient.last_interaction_at)}
              </p>

              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-2xl bg-white px-3 py-3">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">
                    {l("Termine", "Записи", "Appointments")}
                  </p>
                  <p className="mt-2 text-xl font-semibold text-slate-950">
                    {patient.appointment_count}
                  </p>
                </div>
                <div className="rounded-2xl bg-white px-3 py-3">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">
                    {l("Services", "Сервисы", "Services")}
                  </p>
                  <p className="mt-2 text-xl font-semibold text-slate-950">
                    {patient.leistung_count}
                  </p>
                </div>
                <div className="rounded-2xl bg-white px-3 py-3">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">
                    {l("Concierge", "Concierge", "Concierge")}
                  </p>
                  <p className="mt-2 text-xl font-semibold text-slate-950">
                    {patient.concierge_count}
                  </p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-2xl"
                  onClick={() => onOpenPatient(patient.id)}
                >
                  {l("Patient öffnen", "Открыть пациента", "Open patient")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-2xl"
                  onClick={() => onOpenAppointments(patient.id)}
                >
                  {l("Termine", "Записи", "Appointments")}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function InteractionHistorySection({
  detail,
  onOpenPatient,
  onOpenAppointments,
  onOpenAppointment,
  onOpenOrder,
}: {
  detail: ProviderDetail;
  onOpenPatient: (patientId: string) => void;
  onOpenAppointments: (patientId: string) => void;
  onOpenAppointment: (appointmentId: string) => void;
  onOpenOrder: (orderId: string) => void;
}) {
  const { t, lang } = useLang();
  const l = (de: string, ru: string, en: string) => (lang === "de" ? de : lang === "ru" ? ru : en);
  return (
    <section className={cardClass("p-5")}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-950">
            {titleWithDot(l("Interaktionsverlauf", "История взаимодействий", "Interaction history"))}
          </h3>
          <p className="mt-1 text-sm text-slate-600">
            {t.providers_interactions_description}
          </p>
        </div>
        <div className="text-xs uppercase tracking-[0.12em] text-slate-500">
          {detail.interactions.length} {l("Einträge", "записей", "items")}
        </div>
      </div>

      {detail.interactions.length === 0 ? (
        <div className="mt-4">
          <EmptyPanel
            title={t.providers_no_activity}
            text={t.providers_no_activity}
          />
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {detail.interactions.map((item) => (
            <div
              key={item.id}
              className="rounded-[1.4rem] border border-slate-200 bg-slate-50/80 p-4"
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="rounded-full border-slate-200 bg-white text-slate-700">
                      {humanizeCode(item.kind)}
                    </Badge>
                    <Badge variant="outline" className="rounded-full border-slate-200 bg-white text-slate-700">
                      {humanizeCode(item.status)}
                    </Badge>
                    {item.appointment_type ? (
                      <Badge variant="outline" className="rounded-full border-slate-200 bg-white text-slate-700">
                        {humanizeCode(item.appointment_type)}
                      </Badge>
                    ) : null}
                  </div>

                  <p className="mt-3 text-base font-semibold text-slate-950">{item.title}</p>
                  <p className="mt-1 text-sm text-slate-600">
                    {item.patient_id} · {item.patient_name}
                  </p>
                </div>

                <div className="text-sm text-slate-600">{compactDateTime(item.occurred_at)}</div>
              </div>

              <div className="mt-4 grid gap-2 text-sm text-slate-600 md:grid-cols-2">
                <InlineInfo icon={Stethoscope}>{item.doctor_name || t.common_not_set}</InlineInfo>
                <InlineInfo icon={MapPin}>{item.location || t.common_not_set}</InlineInfo>
              </div>

              {item.notes ? (
                <div className="mt-4 rounded-2xl bg-white px-4 py-3 text-sm leading-6 text-slate-700">
                  {item.notes}
                </div>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-2xl"
                  onClick={() => onOpenPatient(item.patient_id)}
                >
                  {l("Patient", "Пациент", "Patient")}
                </Button>
                {item.kind === "appointment" ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-2xl"
                    onClick={() => onOpenAppointment(item.id)}
                  >
                    {l("Termin", "Запись", "Appointment")}
                  </Button>
                ) : null}
                {item.kind !== "appointment" ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-2xl"
                    onClick={() => onOpenAppointments(item.patient_id)}
                  >
                    {l("Termine", "Записи", "Appointments")}
                  </Button>
                ) : null}
                {item.order_id ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-2xl"
                    onClick={() => onOpenOrder(item.order_id!)}
                  >
                    {l("Auftrag", "Заказ", "Order")}
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ProviderFormFields({
  form,
  onChange,
  forceNonMedical,
  disabled = false,
}: {
  form: ProviderFormState;
  onChange: (field: keyof ProviderFormState, value: string) => void;
  forceNonMedical: boolean;
  disabled?: boolean;
}) {
  const { t, lang } = useLang();
  const l = (de: string, ru: string, en: string) => (lang === "de" ? de : lang === "ru" ? ru : en);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Field label={l("Anzeigename", "Отображаемое имя", "Display name")}>
          <Input
            value={form.name}
            onChange={(event) => onChange("name", event.target.value)}
            className={shellInputClassName}
            placeholder={t.providers_title}
            required
            disabled={disabled}
          />
        </Field>

        <Field label={l("Rechtlicher Name", "Юридическое название", "Legal name")}>
          <Input
            value={form.legalName}
            onChange={(event) => onChange("legalName", event.target.value)}
            className={shellInputClassName}
            placeholder={l("Rechtsträger / Vertragsname", "Юридическое лицо / название договора", "Legal entity / contract name")}
            disabled={disabled}
          />
        </Field>

        <Field label={t.providers_type}>
          <NativeComboboxSelect
            value={forceNonMedical ? "non_medical" : form.providerType}
            onChange={(event) => onChange("providerType", event.target.value || "medical")}
            disabled={disabled || forceNonMedical}
            className={selectClassName}
          >
            <option value="medical">{t.providers_type_medical}</option>
            <option value="non_medical">{t.providers_type_non_medical}</option>
          </NativeComboboxSelect>
        </Field>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Field label={l("Steuer-ID", "Налоговый ID", "Tax ID")}>
          <Input
            value={form.taxId}
            onChange={(event) => onChange("taxId", event.target.value)}
            className={shellInputClassName}
            placeholder={l("USt-IdNr. / Steuer-ID", "VAT / налоговый ID", "VAT / tax ID")}
            disabled={disabled}
          />
        </Field>

        <Field label={t.providers_fachbereich}>
          <Input
            value={form.fachbereich}
            onChange={(event) => onChange("fachbereich", event.target.value)}
            className={shellInputClassName}
            placeholder={t.providers_fachbereich}
            disabled={disabled}
          />
        </Field>

        <Field label={t.providers_website}>
          <Input
            value={form.website}
            onChange={(event) => onChange("website", event.target.value)}
            className={shellInputClassName}
            placeholder={l("https://...", "https://...", "https://...")}
            disabled={disabled}
          />
        </Field>
      </div>

      <Field label={t.providers_street}>
        <Input
          value={form.addressStreet}
          onChange={(event) => onChange("addressStreet", event.target.value)}
          className={shellInputClassName}
          disabled={disabled}
        />
      </Field>

      <div className="grid gap-4 md:grid-cols-3">
        <Field label={t.providers_city}>
          <Input
            value={form.addressCity}
            onChange={(event) => onChange("addressCity", event.target.value)}
            className={shellInputClassName}
            disabled={disabled}
          />
        </Field>
        <Field label={t.providers_zip}>
          <Input
            value={form.addressZip}
            onChange={(event) => onChange("addressZip", event.target.value)}
            className={shellInputClassName}
            disabled={disabled}
          />
        </Field>
        <Field label={t.providers_country}>
          <Input
            value={form.addressCountry}
            onChange={(event) => onChange("addressCountry", event.target.value)}
            className={shellInputClassName}
            disabled={disabled}
          />
        </Field>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Field label={t.field_phone}>
          <Input
            value={form.phone}
            onChange={(event) => onChange("phone", event.target.value)}
            className={shellInputClassName}
            disabled={disabled}
          />
        </Field>
        <Field label={t.field_email}>
          <Input
            type="email"
            value={form.email}
            onChange={(event) => onChange("email", event.target.value)}
            className={shellInputClassName}
            disabled={disabled}
          />
        </Field>
      </div>

      <Field label={t.providers_contract}>
        <textarea
          value={form.contractText}
          onChange={(event) => onChange("contractText", event.target.value)}
          className={textareaClassName}
          rows={4}
          placeholder={l('Klartext wird automatisch zu {"summary": "..."} umgewandelt. JSON ist ebenfalls erlaubt.', 'Обычный текст автоматически станет {"summary": "..."}; JSON тоже допустим.', 'Plain text becomes {"summary": "..."} automatically. JSON is accepted too.')}
          disabled={disabled}
        />
      </Field>

      <Field label={t.providers_notes}>
        <textarea
          value={form.notes}
          onChange={(event) => onChange("notes", event.target.value)}
          className={textareaClassName}
          rows={4}
          placeholder={t.providers_notes}
          disabled={disabled}
        />
      </Field>
    </div>
  );
}

function DoctorFormFields({
  form,
  onChange,
}: {
  form: DoctorFormState;
  onChange: (field: keyof DoctorFormState, value: string) => void;
}) {
  const { t, lang } = useLang();
  const l = (de: string, ru: string, en: string) => (lang === "de" ? de : lang === "ru" ? ru : en);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={t.providers_doctors}>
          <Input
            value={form.name}
            onChange={(event) => onChange("name", event.target.value)}
            className={shellInputClassName}
            required
          />
        </Field>
        <Field label={t.providers_doctor_title}>
          <Input
            value={form.title}
            onChange={(event) => onChange("title", event.target.value)}
            className={shellInputClassName}
            placeholder={t.providers_doctor_title}
          />
        </Field>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Field label={t.providers_fachbereich}>
          <Input
            value={form.fachbereich}
            onChange={(event) => onChange("fachbereich", event.target.value)}
            className={shellInputClassName}
          />
        </Field>
        <Field label={l("Sprachen", "Языки", "Languages")}>
          <Input
            value={form.languages}
            onChange={(event) => onChange("languages", event.target.value)}
            className={shellInputClassName}
            placeholder={l("de, en, uk", "de, en, uk", "de, en, uk")}
          />
        </Field>
        <Field label={t.field_phone}>
          <Input
            value={form.phone}
            onChange={(event) => onChange("phone", event.target.value)}
            className={shellInputClassName}
          />
        </Field>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Field label={t.field_email}>
          <Input
            type="email"
            value={form.email}
            onChange={(event) => onChange("email", event.target.value)}
            className={shellInputClassName}
          />
        </Field>
        <Field label={l("Lizenznummer", "Номер лицензии", "License number")}>
          <Input
            value={form.licenseNumber}
            onChange={(event) => onChange("licenseNumber", event.target.value)}
            className={shellInputClassName}
          />
        </Field>
        <Field label={l("Lizenzland", "Страна лицензии", "Licensing country")}>
          <Input
            value={form.licensingCountry}
            onChange={(event) => onChange("licensingCountry", event.target.value)}
            className={shellInputClassName}
          />
        </Field>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Field label={l("Lizenz gültig bis", "Лицензия действительна до", "License valid until")}>
          <Input
            type="date"
            value={form.licensingValidUntil}
            onChange={(event) => onChange("licensingValidUntil", event.target.value)}
            className={shellInputClassName}
          />
        </Field>
        <Field label={t.providers_notes}>
          <textarea
            value={form.notes}
            onChange={(event) => onChange("notes", event.target.value)}
            className={textareaClassName}
            rows={3}
          />
        </Field>
      </div>
    </div>
  );
}

function ServiceFormFields({
  form,
  onChange,
}: {
  form: ServiceFormState;
  onChange: (field: keyof ServiceFormState, value: string) => void;
}) {
  const { t } = useLang();
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={t.providers_service_name}>
          <Input
            value={form.serviceName}
            onChange={(event) => onChange("serviceName", event.target.value)}
            className={shellInputClassName}
            required
          />
        </Field>
        <Field label={t.providers_service_price}>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={form.price}
            onChange={(event) => onChange("price", event.target.value)}
            className={shellInputClassName}
            required
          />
        </Field>
      </div>

      <Field label={t.providers_service_desc}>
        <textarea
          value={form.description}
          onChange={(event) => onChange("description", event.target.value)}
          className={textareaClassName}
          rows={3}
        />
      </Field>

      <div className="grid gap-4 md:grid-cols-3">
        <Field label={t.providers_service_currency}>
          <Input
            value={form.currency}
            onChange={(event) => onChange("currency", event.target.value.toUpperCase())}
            className={shellInputClassName}
          />
        </Field>
        <Field label={t.providers_service_valid_from}>
          <Input
            type="date"
            value={form.validFrom}
            onChange={(event) => onChange("validFrom", event.target.value)}
            className={shellInputClassName}
          />
        </Field>
        <Field label={t.providers_service_valid_to}>
          <Input
            type="date"
            value={form.validTo}
            onChange={(event) => onChange("validTo", event.target.value)}
            className={shellInputClassName}
          />
        </Field>
      </div>
    </div>
  );
}

export { ProvidersPage };
