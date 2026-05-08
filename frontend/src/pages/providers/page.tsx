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
  ArrowUpRight,
  Building2,
  CalendarClock,
  ChevronDown,
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
  BadgeCheck,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  Section,
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
    "rounded-[1.75rem] border border-border/70 bg-card",
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
  const [doctorDialogOpen, setDoctorDialogOpen] = useState(false);
  const [doctorBusy, setDoctorBusy] = useState(false);
  const [doctorError, setDoctorError] = useState("");

  const [serviceForm, setServiceForm] = useState<ServiceFormState>(blankServiceForm());
  const [serviceDialogOpen, setServiceDialogOpen] = useState(false);
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
      setDoctorDialogOpen(false);
      setDoctorForm(blankDoctorForm());
      refreshList();
      refreshDetail();
    } catch (error) {
      setDoctorError(error instanceof Error ? error.message : t.common_failed_update);
    } finally {
      setDoctorBusy(false);
    }
  }

  function handleDoctorDialogOpenChange(open: boolean) {
    setDoctorDialogOpen(open);
    if (!open) {
      setDoctorError("");
      setDoctorForm(blankDoctorForm());
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
      setServiceDialogOpen(false);
      setServiceForm(blankServiceForm());
      refreshDetail();
    } catch (error) {
      setServiceError(error instanceof Error ? error.message : t.common_failed_update);
    } finally {
      setServiceBusy(false);
    }
  }

  function handleServiceDialogOpenChange(open: boolean) {
    setServiceDialogOpen(open);
    if (!open) {
      setServiceError("");
      setServiceForm(blankServiceForm());
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
              <div className="space-y-3 rounded-xl p-4">
                {createError ? <Banner tone="error">{createError}</Banner> : null}
                <ProviderFormFields
                  form={createForm}
                  onChange={(field, value) =>
                    setCreateForm((current) => ({ ...current, [field]: value }))
                  }
                  forceNonMedical={permissions.forceNonMedical}
                  grouped
                />
              </div>
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
            <div className="flex flex-1 min-h-0 flex-col">
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
                        form="provider-profile-form"
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
                <div className="space-y-3 rounded-xl p-4">
                  {detailError ? <Banner tone="error">{detailError}</Banner> : null}
                  {providerError ? <Banner tone="error">{providerError}</Banner> : null}

                  <ProviderSheetHero
                    detail={detail}
                    providerActionBusy={providerActionBusy}
                    permissions={permissions}
                    onActivate={() => handleToggleProvider(true)}
                    onDeactivate={() => handleToggleProvider(false)}
                    onDelete={handleDeleteProvider}
                  />

                  <ProviderOverviewSection
                    detail={detail}
                    onOpenPatients={() => window.open(`/patients?provider=${detail.id}`, "_blank", "noopener,noreferrer")}
                    onOpenAppointments={() => window.open(`/appointments?provider=${detail.id}`, "_blank", "noopener,noreferrer")}
                  />

                {permissions.canManageRegistry || permissions.canViewPage ? (
                  <form
                    id="provider-profile-form"
                    onSubmit={handleUpdateProvider}
                    className="space-y-3"
                  >
                    <ProviderFormFields
                      form={providerForm}
                      onChange={(field, value) =>
                        setProviderForm((current) => ({ ...current, [field]: value }))
                      }
                      forceNonMedical={permissions.forceNonMedical}
                      disabled={!permissions.canManageRegistry}
                      grouped
                    />
                    {!permissions.canManageRegistry ? (
                      <p className="text-[12px] text-muted-foreground italic">
                        {t.providers_edit_restricted_note}
                      </p>
                    ) : null}
                  </form>
                ) : null}

                <DoctorSection
                  detail={detail}
                  busy={doctorBusy}
                  canManage={permissions.canManageRegistry}
                  onNew={() => {
                    setDoctorError("");
                    setDoctorForm(blankDoctorForm());
                    setDoctorDialogOpen(true);
                  }}
                  onEdit={(doctor) => {
                    setDoctorError("");
                    setDoctorForm(doctorToForm(doctor));
                    setDoctorDialogOpen(true);
                  }}
                  onDelete={handleDeleteDoctor}
                />

                <ServiceSection
                  detail={detail}
                  busy={serviceBusy}
                  canManage={permissions.canManageRegistry}
                  onNew={() => {
                    setServiceError("");
                    setServiceForm(blankServiceForm());
                    setServiceDialogOpen(true);
                  }}
                  onEdit={(service) => {
                    setServiceError("");
                    setServiceForm(serviceToForm(service));
                    setServiceDialogOpen(true);
                  }}
                  onDelete={handleDeleteService}
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
                </div>
              </AdminSheetScaffold>
            </div>
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

      {detail ? (
        <Dialog open={doctorDialogOpen} onOpenChange={handleDoctorDialogOpenChange}>
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader className="pr-8">
              <DialogTitle>{doctorForm.id ? t.providers_doctor_detail : t.providers_doctor_new}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleDoctorSubmit} className="space-y-4">
              <div className="space-y-3 rounded-xl p-4">
                {doctorError ? <Banner tone="error">{doctorError}</Banner> : null}
                <DoctorFormFields
                  form={doctorForm}
                  onChange={(field, value) =>
                    setDoctorForm((current) => ({ ...current, [field]: value }))
                  }
                />
                  <div className="flex justify-end gap-2 pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 rounded-lg"
                    onClick={() => handleDoctorDialogOpenChange(false)}
                    disabled={doctorBusy}
                  >
                    {l("Abbrechen", "Отмена", "Cancel")}
                  </Button>
                  <Button
                    type="submit"
                    className="h-9 rounded-lg"
                    disabled={doctorBusy}
                  >
                    {doctorBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                    {doctorForm.id ? t.common_save : t.providers_doctor_new}
                  </Button>
                </div>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}

      {detail ? (
        <Dialog open={serviceDialogOpen} onOpenChange={handleServiceDialogOpenChange}>
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader className="pr-8">
              <DialogTitle>{serviceForm.id ? t.providers_service_detail : t.providers_service_new}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleServiceSubmit} className="space-y-4">
              <div className="space-y-3 rounded-xl p-4">
                {serviceError ? <Banner tone="error">{serviceError}</Banner> : null}
                <ServiceFormFields
                  form={serviceForm}
                  onChange={(field, value) =>
                    setServiceForm((current) => ({ ...current, [field]: value }))
                  }
                />
                <div className="flex justify-end gap-2 pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 rounded-lg"
                    onClick={() => handleServiceDialogOpenChange(false)}
                    disabled={serviceBusy}
                  >
                    {l("Abbrechen", "Отмена", "Cancel")}
                  </Button>
                  <Button
                    type="submit"
                    className="h-9 rounded-lg"
                    disabled={serviceBusy}
                  >
                    {serviceBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                    {serviceForm.id ? t.common_save : t.providers_service_new}
                  </Button>
                </div>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

export function ProviderOverviewSection({
  detail,
  onOpenPatients,
  onOpenAppointments,
}: {
  detail: ProviderDetail;
  onOpenPatients: () => void;
  onOpenAppointments: () => void;
}) {
  const { t, lang } = useLang();
  const l = (de: string, ru: string, en: string) =>
    lang === "de" ? de : lang === "ru" ? ru : en;

  const overviewRows = [
    {
      label:
        detail.provider_type === "non_medical"
          ? l("Kontakte", "Контакты", "Contacts")
          : t.providers_doctors,
      value: detail.doctors.length,
    },
    {
      label: t.providers_services,
      value: detail.services.length,
    },
    {
      label: t.providers_linked_patients,
      value: detail.linked_patients.length,
    },
    {
      label: l("Aktivität", "Активность", "Activity items"),
      value: detail.interactions.length,
    },
  ];

  return (
    <section className="space-y-5 rounded-xl border border-border/50 bg-card/40 p-4">
      <h3 className="text-sm font-semibold text-foreground">
        {titleWithDot(l("Providerübersicht", "Обзор провайдера", "Provider overview"))}
      </h3>
      <div className="grid items-stretch gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-8">
        <div className="space-y-4">
          {overviewRows.map((row) => (
            <div key={row.label} className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
              <span className="text-sm text-muted-foreground">{row.label}</span>
              <span className="h-px bg-border/70" />
              <span className="text-sm font-semibold text-foreground">{row.value}</span>
            </div>
          ))}
        </div>
        <div className="grid h-full gap-3 sm:grid-cols-2">
          <button
            type="button"
            className="group relative h-full min-h-0 overflow-hidden rounded-xl border border-border/70 bg-muted/20 p-4 pr-14 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-orange-200 hover:bg-orange-50/30"
            onClick={onOpenPatients}
          >
            <span className="block text-sm font-semibold text-foreground">
              {l("Patientenlinks", "Связи с пациентами", "Patient links")}
            </span>
            <span className="mt-2 block text-xs leading-snug text-muted-foreground">
              {l(
                "Patienten dieses Providers öffnen.",
                "Откройте пациентов этого провайдера.",
                "Open patients linked to this provider.",
              )}
            </span>
            <span className="absolute bottom-0 right-0 flex size-12 items-center justify-center rounded-br-xl rounded-tl-[1.75rem] bg-orange-100 text-orange-700 transition-all duration-200 group-hover:size-14 group-hover:bg-orange-200 group-hover:text-orange-800">
              <ArrowUpRight className="size-4 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </span>
          </button>
          <button
            type="button"
            className="group relative h-full min-h-0 overflow-hidden rounded-xl border border-border/70 bg-muted/20 p-4 pr-14 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-orange-200 hover:bg-orange-50/30"
            onClick={onOpenAppointments}
          >
            <span className="block text-sm font-semibold text-foreground">
              {l("Termine", "Записи", "Appointments")}
            </span>
            <span className="mt-2 block text-xs leading-snug text-muted-foreground">
              {l(
                "Termine dieses Providers öffnen.",
                "Откройте записи этого провайдера.",
                "Open appointments for this provider.",
              )}
            </span>
            <span className="absolute bottom-0 right-0 flex size-12 items-center justify-center rounded-br-xl rounded-tl-[1.75rem] bg-orange-100 text-orange-700 transition-all duration-200 group-hover:size-14 group-hover:bg-orange-200 group-hover:text-orange-800">
              <ArrowUpRight className="size-4 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </span>
          </button>
        </div>
      </div>
    </section>
  );
}function HeroInfoLine({
  icon: Icon,
  children,
}: {
  icon: typeof MapPin;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Icon className="size-3.5 shrink-0 text-muted-foreground/65" />
      <span className="min-w-0 truncate">{children}</span>
    </div>
  );
}

function ProviderSheetHero({
  detail,
  providerActionBusy,
  permissions,
  onActivate,
  onDeactivate,
  onDelete,
}: {
  detail: ProviderDetail;
  providerActionBusy: string | null;
  permissions: ProviderPermissions;
  onActivate: () => void;
  onDeactivate: () => void;
  onDelete: () => void;
}) {
  const { t, lang } = useLang();
  const tr = t as unknown as Record<string, string>;
  const l = (de: string, ru: string, en: string) =>
    lang === "de" ? de : lang === "ru" ? ru : en;
  const isMedical = detail.provider_type === "medical";
  const metaLine = [
    detail.legal_name && detail.legal_name !== detail.name ? detail.legal_name : null,
    providerMeta(detail),
  ].filter(Boolean).join(" - ");

  return (
    <section className="relative overflow-hidden rounded-xl border border-border bg-card px-7 py-4">
      <span
        className={cn(
          "absolute left-0 top-4 h-12 w-1 rounded-r-full",
          detail.is_active ? "bg-emerald-500" : "bg-slate-300",
        )}
      />
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_240px] md:items-stretch">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-3">
            <span className="h-px w-8 bg-border" />
            <Badge
              variant="outline"
              className={cn(
                "rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em]",
                detail.is_active
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-slate-200 bg-slate-50 text-slate-600",
              )}
            >
              {detail.is_active ? t.common_active : t.common_inactive}
            </Badge>
          </div>
          <h2 className="truncate text-xl font-semibold leading-tight text-foreground">
            {detail.name}
          </h2>
          <p className="mt-2 line-clamp-1 text-sm text-muted-foreground">
            {metaLine || t.common_not_set}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className={cn(
                "rounded-full px-2 py-0.5 text-xs font-medium",
                isMedical
                  ? "border-sky-200 bg-sky-50 text-sky-700"
                  : "border-violet-200 bg-violet-50 text-violet-700",
              )}
            >
              {providerTypeLabel(detail.provider_type, tr)}
            </Badge>
          </div>
          <div className="mt-4 grid gap-x-6 gap-y-2 text-xs text-muted-foreground sm:grid-cols-2">
            <HeroInfoLine icon={MapPin}>
              {providerMeta(detail) || t.common_not_set}
            </HeroInfoLine>
            <HeroInfoLine icon={Phone}>
              {detail.phone || t.common_not_set}
            </HeroInfoLine>
            <HeroInfoLine icon={Mail}>
              {detail.email || t.common_not_set}
            </HeroInfoLine>
            <HeroInfoLine icon={BadgeCheck}>
              {detail.tax_id || t.common_not_set}
            </HeroInfoLine>
            <HeroInfoLine icon={Stethoscope}>
              {detail.fachbereich || t.common_not_set}
            </HeroInfoLine>
          </div>
        </div>
        <div className="flex flex-col justify-start gap-4 border-t border-dashed border-border/70 pt-3 text-left md:border-l md:border-t-0 md:pl-5 md:pt-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            {l("Aktionen", "Действия", "Actions")}
          </p>
          {permissions.canManageRegistry ? (
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 w-full justify-center rounded-lg bg-muted/20"
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
                className="h-8 w-full justify-center rounded-lg bg-muted/20"
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
                className="h-8 w-full justify-center rounded-lg gap-1.5 border-rose-200 bg-rose-50/40 text-rose-700 hover:bg-rose-50"
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
            </div>
          ) : null}
          <p className="text-right text-sm font-semibold tabular-nums text-foreground">
            {compactDateTime(detail.updated_at, t.common_not_set)}
          </p>
        </div>
      </div>
    </section>
  );
}

function DoctorSection({
  detail,
  busy,
  canManage,
  onNew,
  onEdit,
  onDelete,
}: {
  detail: ProviderDetail;
  busy: boolean;
  canManage: boolean;
  onNew: () => void;
  onEdit: (doctor: DoctorSummary) => void;
  onDelete: (doctorId: string, doctorName: string) => void;
}) {
  const { t, lang } = useLang();
  const l = (de: string, ru: string, en: string) => (lang === "de" ? de : lang === "ru" ? ru : en);

  return (
    <section className="space-y-3 rounded-xl border border-border/70 bg-card p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="h-2 w-2 shrink-0 rounded-full bg-[var(--brand)]" />
          <h3 className="truncate text-sm font-semibold text-foreground">
            {detail.provider_type === "non_medical"
              ? l("Kontakte", "Контакты", "Contacts")
              : t.providers_doctors}
          </h3>
          <span className="shrink-0 text-xs font-medium text-muted-foreground">
            {detail.doctors.length}
          </span>
        </div>
        {canManage ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 justify-center rounded-lg bg-muted/20"
            onClick={onNew}
          >
            <Plus className="size-3.5" />
            {t.providers_doctor_new}
          </Button>
        ) : null}
      </div>

      {detail.doctors.length === 0 ? (
        <div className="mt-4">
          <EmptyPanel
            title={t.providers_doctors}
            text={t.providers_no_patients}
          />
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {detail.doctors.map((doctor) => (
            <details
              key={doctor.id}
              className="group overflow-hidden rounded-[1.4rem] border border-border bg-card"
            >
              <summary className="grid cursor-pointer list-none gap-4 p-4 transition hover:bg-muted/20 md:grid-cols-[minmax(0,1fr)_160px] [&::-webkit-details-marker]:hidden">
                <div className="flex min-w-0 gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-muted/30 text-sm font-medium text-muted-foreground">
                    <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">
                      {doctor.title ? `${doctor.title} ` : ""}
                      {doctor.name}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Badge
                        variant="outline"
                        className="rounded-full border-border bg-muted/30 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
                      >
                        {doctor.fachbereich || t.common_not_set}
                      </Badge>
                      {doctor.languages.map((language) => (
                        <Badge
                          key={`${doctor.id}-${language}`}
                          variant="outline"
                          className="rounded-full border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700"
                        >
                          {language}
                        </Badge>
                      ))}
                    </div>
                    <p className="mt-2 text-xs leading-snug text-muted-foreground">
                      {doctor.phone || t.common_not_set} · {doctor.email || t.common_not_set}
                    </p>
                  </div>
                </div>
                <div className="flex flex-col items-stretch justify-end gap-2 border-t border-dashed border-border pt-3 md:border-l md:border-t-0 md:pl-4 md:pt-0">
                  {canManage ? (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 w-full justify-center rounded-lg bg-muted/20"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          onEdit(doctor);
                        }}
                      >
                        {l("Bearbeiten", "Редактировать", "Edit")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 w-full justify-center rounded-lg gap-1.5 border-rose-200 bg-rose-50/40 text-rose-700 hover:bg-rose-50"
                        disabled={busy}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          onDelete(doctor.id, doctor.name);
                        }}
                      >
                        <Trash2 className="size-3.5" />
                        {l("Löschen", "Удалить", "Delete")}
                      </Button>
                    </>
                  ) : null}
                </div>
              </summary>

              <div className="grid border-t border-border bg-muted/10 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_0.5fr_0.5fr]">
                <div className="border-b border-border px-4 py-3 sm:border-r lg:border-b-0">
                  <p className="text-xs text-muted-foreground">{l("Lizenz", "Лицензия", "License")}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">
                      {doctor.license_number || t.common_not_set}
                    </span>
                    <Badge
                      variant="outline"
                      className="rounded-full border-border bg-muted/30 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
                    >
                      {doctor.licensing_country || t.common_not_set}
                    </Badge>
                  </div>
                </div>
                <div className="border-b border-border px-4 py-3 lg:border-b-0 lg:border-r">
                  <p className="text-xs text-muted-foreground">{l("Gültig bis", "Действует до", "Valid until")}</p>
                  <p className="mt-1 text-sm font-semibold text-foreground">
                    {compactDate(doctor.licensing_valid_until, t.common_not_set)}
                  </p>
                </div>
                <div className="border-b border-border px-4 py-3 sm:border-b-0 sm:border-r">
                  <p className="text-xs text-muted-foreground">{l("Patienten", "Пациенты", "Patients")}</p>
                  <p className="mt-1 text-sm font-semibold text-foreground">{doctor.patient_count}</p>
                </div>
                <div className="px-4 py-3">
                  <p className="text-xs text-muted-foreground">{l("Slots", "Слоты", "Slots")}</p>
                  <p className="mt-1 text-sm font-semibold text-foreground">{doctor.appointment_count}</p>
                </div>
              </div>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
function ServiceSection({
  detail,
  busy,
  canManage,
  onNew,
  onEdit,
  onDelete,
}: {
  detail: ProviderDetail;
  busy: boolean;
  canManage: boolean;
  onNew: () => void;
  onEdit: (service: ServiceItem) => void;
  onDelete: (serviceId: string, serviceName: string) => void;
}) {
  const { t, lang } = useLang();
  const l = (de: string, ru: string, en: string) => (lang === "de" ? de : lang === "ru" ? ru : en);
  return (
    <section className="space-y-3 rounded-xl border border-border/70 bg-card p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="h-2 w-2 shrink-0 rounded-full bg-[var(--brand)]" />
          <h3 className="truncate text-sm font-semibold text-foreground">
            {l("Servicekatalog", "Каталог сервисов", "Service catalog")}
          </h3>
          <span className="shrink-0 text-xs font-medium text-muted-foreground">
            {detail.services.length}
          </span>
        </div>
        {canManage ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 justify-center rounded-lg bg-muted/20"
            onClick={onNew}
          >
            <Plus className="size-3.5" />
            {t.providers_service_new}
          </Button>
        ) : null}
      </div>

      {detail.services.length === 0 ? (
        <div className="mt-4">
          <EmptyPanel
            title={t.providers_services}
            text={t.providers_no_patients}
          />
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {detail.services.map((service) => (
            <div
              key={service.id}
              className="overflow-hidden rounded-[1.4rem] border border-border bg-card"
            >
              <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_180px_160px]">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">{service.service_name}</p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {service.description || t.common_not_set}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>
                      {t.providers_service_valid_from}:{" "}
                      <span className="font-medium text-foreground">
                        {compactDate(service.valid_from, t.common_not_set)}
                      </span>
                    </span>
                    <span>
                      {t.providers_service_valid_to}:{" "}
                      <span className="font-medium text-foreground">
                        {compactDate(service.valid_to, t.common_not_set)}
                      </span>
                    </span>
                  </div>
                </div>

                <div className="flex flex-col justify-between gap-2 rounded-xl border border-border/70 px-3 py-2">
                  <span className="text-xs text-muted-foreground">{l("Preis", "Цена", "Price")}</span>
                  <span className="text-lg font-semibold leading-none text-foreground">
                    {moneyLabel(service.price, service.currency)}
                  </span>
                </div>

                {canManage ? (
                  <div className="flex flex-col justify-end gap-2 border-t border-dashed border-border pt-3 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 w-full justify-center rounded-lg bg-muted/20"
                      onClick={() => onEdit(service)}
                    >
                      {l("Bearbeiten", "Редактировать", "Edit")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 w-full justify-center rounded-lg gap-1.5 border-rose-200 bg-rose-50/40 text-rose-700 hover:bg-rose-50"
                      disabled={busy}
                      onClick={() => onDelete(service.id, service.service_name)}
                    >
                      <Trash2 className="size-3.5" />
                      {l("Löschen", "Удалить", "Delete")}
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>      )}
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
    <section className="space-y-3 rounded-xl border border-border/70 bg-card p-3.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="h-2 w-2 shrink-0 rounded-full bg-[var(--brand)]" />
          <h3 className="truncate text-sm font-semibold text-foreground">
            {l("Verknüpfte Patienten", "Связанные пациенты", "Linked patients")}
          </h3>
          <span className="shrink-0 text-xs font-medium text-muted-foreground">
            {detail.linked_patients.length}
          </span>
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
        <div className="mt-4 space-y-3">
          {detail.linked_patients.map((patient) => (
            <div
              key={patient.id}
              className="overflow-hidden rounded-[1.4rem] border border-border bg-card"
            >
              <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_270px_160px]">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">{patientLabel(patient)}</p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {l("Letzte Aktivität", "Последнее взаимодействие", "Last interaction")}: {compactDateTime(patient.last_interaction_at)}
                  </p>
                </div>

                <div className="grid grid-cols-3 overflow-hidden rounded-xl border border-border/70">
                  <div className="border-r border-border px-3 py-2">
                    <p className="text-xs text-muted-foreground">{l("Termine", "Записи", "Appointments")}</p>
                    <p className="mt-1 text-lg font-semibold leading-none text-foreground">{patient.appointment_count}</p>
                  </div>
                  <div className="border-r border-border px-3 py-2">
                    <p className="text-xs text-muted-foreground">{l("Services", "Сервисы", "Services")}</p>
                    <p className="mt-1 text-lg font-semibold leading-none text-foreground">{patient.leistung_count}</p>
                  </div>
                  <div className="px-3 py-2">
                    <p className="text-xs text-muted-foreground">{l("Concierge", "Concierge", "Concierge")}</p>
                    <p className="mt-1 text-lg font-semibold leading-none text-foreground">{patient.concierge_count}</p>
                  </div>
                </div>

                <div className="flex flex-col justify-end gap-2 border-t border-dashed border-border pt-3 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 w-full justify-center rounded-lg bg-muted/20"
                    onClick={() => window.open(`/patients?patient=${patient.id}`, "_blank", "noopener,noreferrer")}
                  >
                    {l("Patient öffnen", "Открыть пациента", "Open patient")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 w-full justify-center rounded-lg bg-muted/20"
                    onClick={() => window.open(`/appointments?patient=${patient.id}`, "_blank", "noopener,noreferrer")}
                  >
                    {l("Termine", "Записи", "Appointments")}
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>      )}
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
    <section className="space-y-3 rounded-xl border border-border/70 bg-card p-3.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="h-2 w-2 shrink-0 rounded-full bg-[var(--brand)]" />
          <h3 className="truncate text-sm font-semibold text-foreground">
            {l("Interaktionsverlauf", "История взаимодействий", "Interaction history")}
          </h3>
          <span className="shrink-0 text-xs font-medium text-muted-foreground">
            {detail.interactions.length}
          </span>
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
        <div className="mt-4 space-y-3 pl-6">
          {detail.interactions.map((item, index) => (
            <div
              key={item.id}
              className={cn(
                "relative",
                index < detail.interactions.length - 1 &&
                  "before:absolute before:-bottom-5 before:-left-4 before:top-3 before:w-px before:bg-border",
              )}
            >
              <span className="absolute -left-[1.125rem] top-1.5 z-10 size-2 rounded-full bg-muted-foreground ring-4 ring-background" />
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <div className="text-sm font-semibold text-foreground">
                  {item.title}
                </div>
                <span className="text-xs text-muted-foreground">
                  {compactDateTime(item.occurred_at)}
                </span>
              </div>
              <div className="rounded-[1.4rem] border border-slate-200 p-4">
                <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_160px]">
                  <div className="min-w-0 space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="rounded-full border-slate-200 text-slate-700">
                        {humanizeCode(item.kind)}
                      </Badge>
                      <Badge variant="outline" className="rounded-full border-slate-200 text-slate-700">
                        {humanizeCode(item.status)}
                      </Badge>
                      {item.appointment_type ? (
                        <Badge variant="outline" className="rounded-full border-slate-200 text-slate-700">
                          {humanizeCode(item.appointment_type)}
                        </Badge>
                      ) : null}
                    </div>

                    <div className="grid gap-3 text-sm md:grid-cols-2">
                      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                        <span className="text-xs text-muted-foreground">{l("Patient", "Пациент", "Patient")}</span>
                        <span className="font-medium text-foreground">{item.patient_name}</span>
                        <span className="text-xs text-muted-foreground">ID</span>
                        <span className="font-medium text-foreground">{item.patient_id}</span>
                      </div>
                      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                        <span className="text-xs text-muted-foreground">{l("Arzt", "Врач", "Doctor")}</span>
                        <span className="font-medium text-foreground">{item.doctor_name || t.common_not_set}</span>
                        <span className="text-xs text-muted-foreground">{l("Ort", "Локация", "Location")}</span>
                        <span className="font-medium text-foreground">{item.location || t.common_not_set}</span>
                      </div>
                    </div>

                    {item.notes ? (
                      <div className="rounded-xl border border-border/60 px-3 py-2 text-sm leading-6 text-slate-700">
                        <span className="mb-1 block text-xs text-muted-foreground">{l("Notiz", "Заметка", "Note")}</span>
                        {item.notes}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-col justify-end gap-2 border-t border-dashed border-border pt-3 md:border-l md:border-t-0 md:pl-4 md:pt-0">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 w-full justify-center rounded-lg bg-muted/20"
                      onClick={() => window.open(`/patients?patient=${item.patient_id}`, "_blank", "noopener,noreferrer")}
                    >
                      {l("Patient", "Пациент", "Patient")}
                    </Button>
                    {item.kind === "appointment" ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 w-full justify-center rounded-lg bg-muted/20"
                        onClick={() => window.open(`/appointments?appointment=${item.id}`, "_blank", "noopener,noreferrer")}
                      >
                        {l("Termin", "Запись", "Appointment")}
                      </Button>
                    ) : null}
                    {item.kind !== "appointment" ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 w-full justify-center rounded-lg bg-muted/20"
                        onClick={() => window.open(`/appointments?patient=${item.patient_id}`, "_blank", "noopener,noreferrer")}
                      >
                        {l("Termine", "Записи", "Appointments")}
                      </Button>
                    ) : null}
                    {item.order_id ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 w-full justify-center rounded-lg bg-muted/20"
                        onClick={() => window.open(`/orders?order=${item.order_id}`, "_blank", "noopener,noreferrer")}
                      >
                        {l("Auftrag", "Заказ", "Order")}
                      </Button>
                    ) : null}
                  </div>
                </div>
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
  grouped = false,
}: {
  form: ProviderFormState;
  onChange: (field: keyof ProviderFormState, value: string) => void;
  forceNonMedical: boolean;
  disabled?: boolean;
  grouped?: boolean;
}) {
  const { t, lang } = useLang();
  const l = (de: string, ru: string, en: string) => (lang === "de" ? de : lang === "ru" ? ru : en);

  const profileFields = (
    <>
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
    </>
  );

  const addressFields = (
    <>
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
    </>
  );

  const contactFields = (
    <>
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
    </>
  );

  const contractFields = (
    <>
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
    </>
  );

  if (grouped) {
    return (
      <div className="space-y-3">
        <Section title={l("Profil", "Профиль провайдера", "Provider profile")}>
          {profileFields}
        </Section>
        <Section title={l("Adresse", "Адрес", "Address")}>
          {addressFields}
        </Section>
        <Section title={l("Kontakt", "Контакты", "Contact")}>
          {contactFields}
        </Section>
        <Section title={l("Vertrag und Notizen", "Договор и заметки", "Contract and notes")}>
          {contractFields}
        </Section>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {profileFields}
      {addressFields}
      {contactFields}
      {contractFields}
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
    <div className="space-y-3">
      <Section title={l("Arztprofil", "Профиль врача", "Doctor profile")}>
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
        </div>
      </Section>

      <Section title={l("Kontakte", "Контакты", "Contacts")}>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t.field_phone}>
            <Input
              value={form.phone}
              onChange={(event) => onChange("phone", event.target.value)}
              className={shellInputClassName}
            />
          </Field>
          <Field label={t.field_email}>
            <Input
              type="email"
              value={form.email}
              onChange={(event) => onChange("email", event.target.value)}
              className={shellInputClassName}
            />
          </Field>
        </div>
      </Section>

      <Section title={l("Lizenz", "Лицензия", "License")}>
        <div className="grid gap-4 md:grid-cols-3">
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
          <Field label={l("Lizenz gültig bis", "Лицензия действительна до", "License valid until")}>
            <Input
              type="date"
              value={form.licensingValidUntil}
              onChange={(event) => onChange("licensingValidUntil", event.target.value)}
              className={shellInputClassName}
            />
          </Field>
        </div>
      </Section>

      <Section title={l("Notizen", "Заметки", "Notes")}>
        <Field label={t.providers_notes}>
          <textarea
            value={form.notes}
            onChange={(event) => onChange("notes", event.target.value)}
            className={textareaClassName}
            rows={3}
          />
        </Field>
      </Section>
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
  const { t, lang } = useLang();
  const l = (de: string, ru: string, en: string) => (lang === "de" ? de : lang === "ru" ? ru : en);
  return (
    <div className="space-y-3">
      <Section title={l("Service", "Сервис", "Service")}>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t.providers_service_name}>
            <Input
              value={form.serviceName}
              onChange={(event) => onChange("serviceName", event.target.value)}
              className={shellInputClassName}
              required
            />
          </Field>
          <Field label={t.providers_service_desc}>
            <textarea
              value={form.description}
              onChange={(event) => onChange("description", event.target.value)}
              className={textareaClassName}
              rows={3}
            />
          </Field>
        </div>
      </Section>

      <Section title={l("Kosten", "Стоимость", "Cost")}>
        <div className="grid gap-4 md:grid-cols-2">
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
          <Field label={t.providers_service_currency}>
            <Input
              value={form.currency}
              onChange={(event) => onChange("currency", event.target.value.toUpperCase())}
              className={shellInputClassName}
            />
          </Field>
        </div>
      </Section>

      <Section title={l("Gültigkeit", "Срок действия", "Validity")}>
        <div className="grid gap-4 md:grid-cols-2">
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
      </Section>
    </div>
  );
}
export { ProvidersPage };
