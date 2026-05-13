import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useParams, useSearchParams } from "react-router-dom";
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
import { formatUiText, useLang } from "@/lib/i18n";
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

function EmptyPanel({
  title,
  text,
}: {
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-[1.5rem] border border-dashed border-zinc-200 bg-zinc-50/90 px-5 py-6">
      <p className="text-sm font-medium text-zinc-900">{title}</p>
      <p className="mt-2 text-sm leading-6 text-zinc-600">{text}</p>
    </div>
  );
}

type ProvidersPageProps = {
  detailRouteId?: string;
};

type ProvidersPageState = {
  filterPredicates: FilterPredicate[];
  sortStack: SortStack;
  providers: ProviderSummary[];
  listBusy: boolean;
  listError: string;
  listVersion: number;
  createOpen: boolean;
  createBusy: boolean;
  createError: string;
  createForm: ProviderFormState;
  detailOpen: boolean;
  selectedId: string;
  detail: ProviderDetail | null;
  detailBusy: boolean;
  detailError: string;
  detailVersion: number;
  providerForm: ProviderFormState;
  providerBusy: boolean;
  providerError: string;
  providerActionBusy: string | null;
  doctorForm: DoctorFormState;
  doctorDialogOpen: boolean;
  doctorBusy: boolean;
  doctorError: string;
  serviceForm: ServiceFormState;
  serviceDialogOpen: boolean;
  serviceBusy: boolean;
  serviceError: string;
};

type ProvidersPagePatch =
  | Partial<ProvidersPageState>
  | ((current: ProvidersPageState) => Partial<ProvidersPageState>);

function providersPageReducer(
  state: ProvidersPageState,
  patch: ProvidersPagePatch,
): ProvidersPageState {
  return {
    ...state,
    ...(typeof patch === "function" ? patch(state) : patch),
  };
}

function createProvidersPageFieldPatch<K extends keyof ProvidersPageState>(
  field: K,
  value: SetStateAction<ProvidersPageState[K]>,
): ProvidersPagePatch {
  return (current) => {
    const nextValue =
      typeof value === "function"
        ? (value as (previous: ProvidersPageState[K]) => ProvidersPageState[K])(current[field])
        : value;
    return { [field]: nextValue } as Partial<ProvidersPageState>;
  };
}

function useProvidersPageContent({ detailRouteId = "" }: ProvidersPageProps = {}) {
  const { user } = useAuth();
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const l = (key: string) => t.uiText[key] ?? key;
  const detailPageMode = Boolean(detailRouteId);
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
  const [pageState, dispatchPageState] = useReducer(
    providersPageReducer,
    undefined,
    (): ProvidersPageState => {
      const tableState =
        typeof window === "undefined"
          ? null
          : readDataTableState(new URLSearchParams(window.location.search));
      return {
        filterPredicates: tableState?.filters ?? [],
        sortStack: tableState?.sort?.length ? tableState.sort : DEFAULT_PROVIDER_SORT,
        providers: [],
        listBusy: false,
        listError: "",
        listVersion: 0,
        createOpen: false,
        createBusy: false,
        createError: "",
        createForm: blankProviderForm(permissions.forceNonMedical ? "non_medical" : "medical"),
        detailOpen: false,
        selectedId: "",
        detail: null,
        detailBusy: false,
        detailError: "",
        detailVersion: 0,
        providerForm: blankProviderForm(),
        providerBusy: false,
        providerError: "",
        providerActionBusy: null,
        doctorForm: blankDoctorForm(),
        doctorDialogOpen: false,
        doctorBusy: false,
        doctorError: "",
        serviceForm: blankServiceForm(),
        serviceDialogOpen: false,
        serviceBusy: false,
        serviceError: "",
      };
    },
  );
  const {
    filterPredicates,
    sortStack,
    providers,
    listBusy,
    listError,
    listVersion,
    createOpen,
    createBusy,
    createError,
    createForm,
    detailOpen,
    selectedId,
    detail,
    detailBusy,
    detailError,
    detailVersion,
    providerForm,
    providerBusy,
    providerError,
    providerActionBusy,
    doctorForm,
    doctorDialogOpen,
    doctorBusy,
    doctorError,
    serviceForm,
    serviceDialogOpen,
    serviceBusy,
    serviceError,
  } = pageState;
  const setProvidersPageField = <K extends keyof ProvidersPageState>(
    field: K,
    value: SetStateAction<ProvidersPageState[K]>,
  ) => dispatchPageState(createProvidersPageFieldPatch(field, value));
  const setFilterPredicatesState = (value: SetStateAction<FilterPredicate[]>) =>
    setProvidersPageField("filterPredicates", value);
  const setSortStackState = (value: SetStateAction<SortStack>) =>
    setProvidersPageField("sortStack", value);
  const setProviders = (value: SetStateAction<ProviderSummary[]>) =>
    setProvidersPageField("providers", value);
  const setListBusy = (value: SetStateAction<boolean>) =>
    setProvidersPageField("listBusy", value);
  const setListError = (value: SetStateAction<string>) =>
    setProvidersPageField("listError", value);
  const setListVersion = (value: SetStateAction<number>) =>
    setProvidersPageField("listVersion", value);
  const setCreateOpen = (value: SetStateAction<boolean>) =>
    setProvidersPageField("createOpen", value);
  const setCreateBusy = (value: SetStateAction<boolean>) =>
    setProvidersPageField("createBusy", value);
  const setCreateError = (value: SetStateAction<string>) =>
    setProvidersPageField("createError", value);
  const setCreateForm = (value: SetStateAction<ProviderFormState>) =>
    setProvidersPageField("createForm", value);
  const setDetailOpen = (value: SetStateAction<boolean>) =>
    setProvidersPageField("detailOpen", value);
  const setSelectedId = (value: SetStateAction<string>) =>
    setProvidersPageField("selectedId", value);
  const setDetail = (value: SetStateAction<ProviderDetail | null>) =>
    setProvidersPageField("detail", value);
  const setDetailBusy = (value: SetStateAction<boolean>) =>
    setProvidersPageField("detailBusy", value);
  const setDetailError = (value: SetStateAction<string>) =>
    setProvidersPageField("detailError", value);
  const setDetailVersion = (value: SetStateAction<number>) =>
    setProvidersPageField("detailVersion", value);
  const setProviderForm = (value: SetStateAction<ProviderFormState>) =>
    setProvidersPageField("providerForm", value);
  const setProviderBusy = (value: SetStateAction<boolean>) =>
    setProvidersPageField("providerBusy", value);
  const setProviderError = (value: SetStateAction<string>) =>
    setProvidersPageField("providerError", value);
  const setProviderActionBusy = (value: SetStateAction<string | null>) =>
    setProvidersPageField("providerActionBusy", value);
  const setDoctorForm = (value: SetStateAction<DoctorFormState>) =>
    setProvidersPageField("doctorForm", value);
  const setDoctorDialogOpen = (value: SetStateAction<boolean>) =>
    setProvidersPageField("doctorDialogOpen", value);
  const setDoctorBusy = (value: SetStateAction<boolean>) =>
    setProvidersPageField("doctorBusy", value);
  const setDoctorError = (value: SetStateAction<string>) =>
    setProvidersPageField("doctorError", value);
  const setServiceForm = (value: SetStateAction<ServiceFormState>) =>
    setProvidersPageField("serviceForm", value);
  const setServiceDialogOpen = (value: SetStateAction<boolean>) =>
    setProvidersPageField("serviceDialogOpen", value);
  const setServiceBusy = (value: SetStateAction<boolean>) =>
    setProvidersPageField("serviceBusy", value);
  const setServiceError = (value: SetStateAction<string>) =>
    setProvidersPageField("serviceError", value);

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

  const applyDetailRouteState = useCallback((providerId: string) => {
    setSelectedId(providerId);
    setDetailOpen(Boolean(providerId));
    setDetail(null);
  }, []);

  const openProviderFromQuery = useCallback((providerId: string) => {
    setSelectedId(providerId);
    setDetailOpen(true);
  }, []);

  const clearProviderList = useCallback(() => {
    setProviders([]);
  }, []);

  const startProviderListLoad = useCallback(() => {
    setListBusy(true);
    setListError("");
  }, []);

  const applyProviderList = useCallback((items: ProviderSummary[]) => {
    setProviders(items);
  }, []);

  const applyProviderListError = useCallback((error: unknown) => {
    setListError(error instanceof Error ? error.message : t.common_failed_load);
  }, [t.common_failed_load]);

  const finishProviderListLoad = useCallback(() => {
    setListBusy(false);
  }, []);

  const startProviderDetailLoad = useCallback(() => {
    setDetailBusy(true);
    setDetailError("");
    setProviderError("");
    setDoctorError("");
    setServiceError("");
  }, []);

  const applyProviderDetail = useCallback((item: ProviderDetail) => {
    setDetail(item);
    setProviderForm(providerToForm(item));
  }, []);

  const applyProviderDetailError = useCallback((error: unknown) => {
    setDetailError(error instanceof Error ? error.message : t.common_failed_load);
  }, [t.common_failed_load]);

  const finishProviderDetailLoad = useCallback(() => {
    setDetailBusy(false);
  }, []);

  useEffect(() => {
    if (!detailPageMode) return;
    applyDetailRouteState(detailRouteId);
  }, [applyDetailRouteState, detailPageMode, detailRouteId]);

  useEffect(() => {
    if (detailPageMode) return;
    const providerParam = searchParams.get("provider") ?? "";
    if (providerParam && providerParam !== selectedId) {
      openProviderFromQuery(providerParam);
    }
  }, [detailPageMode, openProviderFromQuery, searchParams, selectedId]);

  useEffect(() => {
    if (!permissions.canViewPage || detailPageMode) {
      startTransition(() => clearProviderList());
      return;
    }

    let cancelled = false;
    startProviderListLoad();

    void fetchProviders(providersPath)
      .then((items) => {
        if (cancelled) return;
        startTransition(() => applyProviderList(items));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        applyProviderListError(error);
      })
      .finally(() => {
        if (!cancelled) {
          finishProviderListLoad();
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    applyProviderList,
    applyProviderListError,
    clearProviderList,
    detailPageMode,
    finishProviderListLoad,
    permissions.canViewPage,
    providersPath,
    listVersion,
    startProviderListLoad,
  ]);

  useEffect(() => {
    const shouldLoadDetail = detailOpen || detailPageMode;
    if (!shouldLoadDetail || !selectedId) return;

    let cancelled = false;
    startProviderDetailLoad();

    void fetchProviderDetail(selectedId)
      .then((item) => {
        if (cancelled) return;
        startTransition(() => {
          applyProviderDetail(item);
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        applyProviderDetailError(error);
      })
      .finally(() => {
        if (!cancelled) {
          finishProviderDetailLoad();
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    applyProviderDetail,
    applyProviderDetailError,
    detailOpen,
    detailPageMode,
    detailVersion,
    finishProviderDetailLoad,
    selectedId,
    startProviderDetailLoad,
  ]);

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
          : t.common_failed_update
      );
    } finally {
      setProviderActionBusy(null);
    }
  }

  async function handleDeleteProvider() {
    if (!detail) return;
    if (
      !window.confirm(
        formatUiText(t.providers_delete_provider_confirm, { name: detail.name }),
      )
    ) {
      return;
    }

    setProviderActionBusy("delete");
    setProviderError("");

    try {
      await deleteProvider(detail.id);
      setDetailOpen(false);
      setSelectedId("");
      setDetail(null);
      if (detailPageMode) {
        staffGo("/providers");
      } else {
        refreshList();
      }
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
    if (
      !window.confirm(
        formatUiText(t.providers_delete_doctor_confirm, { name: doctorName }),
      )
    ) {
      return;
    }

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
      refreshList();
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
    if (
      !window.confirm(
        formatUiText(t.providers_delete_service_confirm, { name: serviceName }),
      )
    ) {
      return;
    }

    setServiceBusy(true);
    setServiceError("");

    try {
      await deleteProviderService(detail.id, serviceId);
      if (serviceForm.id === serviceId) {
        setServiceForm(blankServiceForm());
      }
      refreshList();
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
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-950">
            {t.providers_no_access_title}
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-zinc-600">
            {t.providers_no_access_body}
          </p>
        </section>
      </div>
    );
  }

  if (detailPageMode) {
    return (
      <>
        <div className="w-full space-y-4">
          {detailBusy ? (
            <div className="flex min-h-[520px] items-center justify-center text-sm text-muted-foreground">
              <LoaderCircle className="mr-2 size-4 animate-spin" />
              {l("providers_loading_provider")}
            </div>
          ) : detail ? (
            <div className="flex min-h-0 flex-col">
              <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <h1 className="truncate text-xl font-semibold text-foreground">
                    {detail.name || t.providers_detail}
                  </h1>
                  <p className="mt-1 text-sm text-muted-foreground">{t.providers_subtitle}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 rounded-lg"
                    onClick={() => staffGo("/providers")}
                  >
                    {l("providers_back_to_list")}
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
                </div>
              </div>
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
            </div>
          ) : detailError ? (
            <div className="p-4">
              <Banner tone="error">{detailError}</Banner>
            </div>
          ) : (
            <div className="flex min-h-[520px] items-center justify-center text-sm text-muted-foreground">
              {t.providers_select_to_open_workspace}
            </div>
          )}
        </div>

        {detail ? (
          <ProviderDoctorFormSheet
            open={doctorDialogOpen}
            onOpenChange={handleDoctorDialogOpenChange}
            form={doctorForm}
            busy={doctorBusy}
            error={doctorError}
            onSubmit={handleDoctorSubmit}
            onChange={(field, value) =>
              setDoctorForm((current) => ({ ...current, [field]: value }))
            }
          />
        ) : null}

        {detail ? (
          <ProviderServiceFormSheet
            open={serviceDialogOpen}
            onOpenChange={handleServiceDialogOpenChange}
            form={serviceForm}
            busy={serviceBusy}
            error={serviceError}
            onSubmit={handleServiceSubmit}
            onChange={(field, value) =>
              setServiceForm((current) => ({ ...current, [field]: value }))
            }
          />
        ) : null}
      </>
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
            label={permissions.forceNonMedical ? l("appointments_services") : t.providers_doctors}
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
            label={permissions.forceNonMedical ? l("providers_open_requests") : t.providers_appointments}
            value={permissions.forceNonMedical ? metrics.openConciergeRequests : metrics.appointments}
            tone="slate"
          />
        </div>

        <div className="relative z-30 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="relative min-w-[240px] flex-1 sm:max-w-sm">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -tranzinc-y-1/2 text-muted-foreground" />
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
                title={t.common_refresh}
                aria-label={t.common_refresh}
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
                title={t.common_export}
                aria-label={t.common_export}
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
                addFilter: t.table_filter,
                clearAll: t.table_sort_clear,
                searchPlaceholder: t.table_filter_search_fields,
                noFields: t.table_filter_no_fields,
                remove: t.table_filter_remove,
                valuePlaceholder: t.table_filter_value,
                yes: t.common_yes,
                no: t.common_no,
                operatorLabels: {
                  contains: t.filter_op_contains,
                  does_not_contain: t.filter_op_does_not_contain,
                  is_empty: t.filter_op_is_empty,
                  is_not_empty: t.filter_op_is_not_empty,
                  is: t.filter_op_is,
                  is_not: t.filter_op_is_not,
                  is_any_of: t.filter_op_is_any_of,
                  is_none_of: t.filter_op_is_none_of,
                  has_any: t.filter_op_has_any,
                  has_all: t.filter_op_has_all,
                  has_none: t.filter_op_has_none,
                  before: t.filter_op_before,
                  after: t.filter_op_after,
                  between: t.filter_op_between,
                  last_n_days: t.filter_op_last_n_days,
                  equals: t.filter_op_equals,
                },
              }}
            />
            <SortBuilder
              columns={columns}
              value={sortStack}
              onChange={setSortStack}
              translations={{
                buttonLabel: t.common_sort,
                addSort: t.table_sort_add,
                clearAll: t.table_sort_clear,
                ascending: t.table_sort_ascending,
                descending: t.table_sort_descending,
                emptyHint: t.common_sort,
                moveUp: t.table_sort_move_up,
                moveDown: t.table_sort_move_down,
                remove: t.table_sort_remove,
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
              buttonLabel={t.table_columns}
              searchPlaceholder={t.table_columns_search}
              resetLabel={t.common_reset}
              showAllLabel={t.table_columns_show_all}
              hideAllLabel={t.table_columns_hide_all}
              noMatchLabel={t.common_no_results}
              requiredNoteLabel={t.table_columns_required}
              freezeLabel={t.table_columns_freeze}
              unfreezeLabel={t.table_columns_unfreeze}
              frozenNoteLabel={t.table_columns_frozen}
            />
            <DensityToggle
              value={density}
              onChange={setDensity}
              ariaLabel={t.table_density}
              labels={{
                comfortable: t.table_density_comfortable,
                compact: t.table_density_compact,
                condensed: t.table_density_condensed,
              }}
            />
            {anyFilterActive ? (
              <Button type="button" variant="ghost" size="sm" onClick={resetFilters}>
                <X className="size-3.5" />
                {l("providers_reset")}
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
            column: tr.table_columns,
            freeze: tr.table_columns_freeze,
            unfreeze: tr.table_columns_unfreeze,
            frozen: tr.table_columns_frozen,
            freezeLimitReached: tr.table_columns_freeze_limit,
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
              {l("providers_loading_provider")}
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
        <ProviderDoctorFormSheet
          open={doctorDialogOpen}
          onOpenChange={handleDoctorDialogOpenChange}
          form={doctorForm}
          busy={doctorBusy}
          error={doctorError}
          onSubmit={handleDoctorSubmit}
          onChange={(field, value) =>
            setDoctorForm((current) => ({ ...current, [field]: value }))
          }
        />
      ) : null}

      {detail ? (
        <ProviderServiceFormSheet
          open={serviceDialogOpen}
          onOpenChange={handleServiceDialogOpenChange}
          form={serviceForm}
          busy={serviceBusy}
          error={serviceError}
          onSubmit={handleServiceSubmit}
          onChange={(field, value) =>
            setServiceForm((current) => ({ ...current, [field]: value }))
          }
        />
      ) : null}
    </>
  );
}

function ProviderDoctorFormSheet({
  open,
  onOpenChange,
  form,
  busy,
  error,
  onSubmit,
  onChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: DoctorFormState;
  busy: boolean;
  error: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onChange: (field: keyof DoctorFormState, value: string) => void;
}) {
  const { t } = useLang();
  const submitLabel = form.id ? t.common_save : t.providers_doctor_new;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-2xl">
        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <AdminSheetScaffold
            title={form.id ? t.providers_doctor_detail : t.providers_doctor_new}
            footer={
              <SheetFormFooter
                cancelLabel={t.common_cancel}
                submitLabel={submitLabel}
                submittingLabel={submitLabel}
                submitting={busy}
                onCancel={() => onOpenChange(false)}
              />
            }
          >
            <div className="space-y-3 rounded-xl p-4">
              {error ? <Banner tone="error">{error}</Banner> : null}
              <DoctorFormFields form={form} onChange={onChange} />
            </div>
          </AdminSheetScaffold>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function ProviderServiceFormSheet({
  open,
  onOpenChange,
  form,
  busy,
  error,
  onSubmit,
  onChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: ServiceFormState;
  busy: boolean;
  error: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onChange: (field: keyof ServiceFormState, value: string) => void;
}) {
  const { t } = useLang();
  const submitLabel = form.id ? t.common_save : t.providers_service_new;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-2xl">
        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <AdminSheetScaffold
            title={form.id ? t.providers_service_detail : t.providers_service_new}
            footer={
              <SheetFormFooter
                cancelLabel={t.common_cancel}
                submitLabel={submitLabel}
                submittingLabel={submitLabel}
                submitting={busy}
                onCancel={() => onOpenChange(false)}
              />
            }
          >
            <div className="space-y-3 rounded-xl p-4">
              {error ? <Banner tone="error">{error}</Banner> : null}
              <ServiceFormFields form={form} onChange={onChange} />
            </div>
          </AdminSheetScaffold>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function ProvidersPage(...args: Parameters<typeof useProvidersPageContent>) {
  return useProvidersPageContent(...args);
}

function ProviderOverviewSection({
  detail,
  onOpenPatients,
  onOpenAppointments,
}: {
  detail: ProviderDetail;
  onOpenPatients: () => void;
  onOpenAppointments: () => void;
}) {
  const { t } = useLang();
  const l = (key: string) => t.uiText[key] ?? key;

  const overviewRows = [
    {
      label:
        detail.provider_type === "non_medical"
          ? l("providers_contacts")
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
      label: l("providers_activity_items"),
      value: detail.interactions.length,
    },
  ];

  return (
    <section className="space-y-5 rounded-xl border border-border/50 bg-card/40 p-4">
      <h3 className="text-sm font-semibold text-foreground">
        {titleWithDot(l("providers_provider_overview"))}
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
            className="group relative h-full min-h-0 overflow-hidden rounded-xl border border-border/70 bg-muted/20 p-4 pr-14 text-left transition-all duration-200 hover:-tranzinc-y-0.5 hover:border-orange-200 hover:bg-orange-50/30"
            onClick={onOpenPatients}
          >
            <span className="block text-sm font-semibold text-foreground">
              {l("providers_patient_links")}
            </span>
            <span className="mt-2 block text-xs leading-snug text-muted-foreground">
              {l("providers_open_patients_linked_to_this_provider")}
            </span>
            <span className="absolute bottom-0 right-0 flex size-12 items-center justify-center rounded-br-xl rounded-tl-[1.75rem] bg-orange-100 text-orange-700 transition-all duration-200 group-hover:size-14 group-hover:bg-orange-200 group-hover:text-orange-800">
              <ArrowUpRight className="size-4 transition-transform duration-200 group-hover:-tranzinc-y-0.5 group-hover:tranzinc-x-0.5" />
            </span>
          </button>
          <button
            type="button"
            className="group relative h-full min-h-0 overflow-hidden rounded-xl border border-border/70 bg-muted/20 p-4 pr-14 text-left transition-all duration-200 hover:-tranzinc-y-0.5 hover:border-orange-200 hover:bg-orange-50/30"
            onClick={onOpenAppointments}
          >
            <span className="block text-sm font-semibold text-foreground">
              {l("providers_appointments")}
            </span>
            <span className="mt-2 block text-xs leading-snug text-muted-foreground">
              {l("providers_open_appointments_for_this_provider")}
            </span>
            <span className="absolute bottom-0 right-0 flex size-12 items-center justify-center rounded-br-xl rounded-tl-[1.75rem] bg-orange-100 text-orange-700 transition-all duration-200 group-hover:size-14 group-hover:bg-orange-200 group-hover:text-orange-800">
              <ArrowUpRight className="size-4 transition-transform duration-200 group-hover:-tranzinc-y-0.5 group-hover:tranzinc-x-0.5" />
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
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const l = (key: string) => t.uiText[key] ?? key;
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
          detail.is_active ? "bg-emerald-500" : "bg-zinc-300",
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
                  : "border-zinc-200 bg-zinc-50 text-zinc-600",
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
            {l("providers_actions")}
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
                {l("providers_activate")}
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
                {l("providers_deactivate")}
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
                {l("patients_delete")}
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
  const { t } = useLang();
  const l = (key: string) => t.uiText[key] ?? key;

  return (
    <section className="space-y-3 rounded-xl border border-border/70 bg-card p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="size-2 shrink-0 rounded-full bg-[var(--brand)]" />
          <h3 className="truncate text-sm font-semibold text-foreground">
            {detail.provider_type === "non_medical"
              ? l("providers_contacts")
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
                        {l("patients_edit")}
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
                        {l("patients_delete")}
                      </Button>
                    </>
                  ) : null}
                </div>
              </summary>

              <div className="grid border-t border-border bg-muted/10 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_0.5fr_0.5fr]">
                <div className="border-b border-border px-4 py-3 sm:border-r lg:border-b-0">
                  <p className="text-xs text-muted-foreground">{l("providers_license")}</p>
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
                  <p className="text-xs text-muted-foreground">{l("providers_valid_until")}</p>
                  <p className="mt-1 text-sm font-semibold text-foreground">
                    {compactDate(doctor.licensing_valid_until, t.common_not_set)}
                  </p>
                </div>
                <div className="border-b border-border px-4 py-3 sm:border-b-0 sm:border-r">
                  <p className="text-xs text-muted-foreground">{l("providers_patients")}</p>
                  <p className="mt-1 text-sm font-semibold text-foreground">{doctor.patient_count}</p>
                </div>
                <div className="px-4 py-3">
                  <p className="text-xs text-muted-foreground">{l("providers_slots")}</p>
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
  const { t } = useLang();
  const l = (key: string) => t.uiText[key] ?? key;
  return (
    <section className="space-y-3 rounded-xl border border-border/70 bg-card p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="size-2 shrink-0 rounded-full bg-[var(--brand)]" />
          <h3 className="truncate text-sm font-semibold text-foreground">
            {l("providers_service_catalog")}
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
                  <span className="text-xs text-muted-foreground">{l("providers_price")}</span>
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
                      {l("patients_edit")}
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
                      {l("patients_delete")}
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
function LinkedPatientsSection({
  detail,
}: {
  detail: ProviderDetail;
  onOpenPatient?: (patientId: string) => void;
  onOpenAppointments?: (patientId: string) => void;
}) {
  const { t } = useLang();
  const l = (key: string) => t.uiText[key] ?? key;
  return (
    <section className="space-y-3 rounded-xl border border-border/70 bg-card p-3.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="size-2 shrink-0 rounded-full bg-[var(--brand)]" />
          <h3 className="truncate text-sm font-semibold text-foreground">
            {l("providers_linked_patients")}
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
                    {l("providers_last_interaction")}: {compactDateTime(patient.last_interaction_at, t.common_not_set)}
                  </p>
                </div>

                <div className="grid grid-cols-3 overflow-hidden rounded-xl border border-border/70">
                  <div className="border-r border-border px-3 py-2">
                    <p className="text-xs text-muted-foreground">{l("providers_appointments")}</p>
                    <p className="mt-1 text-lg font-semibold leading-none text-foreground">{patient.appointment_count}</p>
                  </div>
                  <div className="border-r border-border px-3 py-2">
                    <p className="text-xs text-muted-foreground">{l("appointments_services")}</p>
                    <p className="mt-1 text-lg font-semibold leading-none text-foreground">{patient.leistung_count}</p>
                  </div>
                  <div className="px-3 py-2">
                    <p className="text-xs text-muted-foreground">{t.appointments_linked_concierge}</p>
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
                    {l("patients_open_patient")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 w-full justify-center rounded-lg bg-muted/20"
                    onClick={() => window.open(`/appointments?patient=${patient.id}`, "_blank", "noopener,noreferrer")}
                  >
                    {l("providers_appointments")}
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>      )}
    </section>
  );
}

function InteractionHistorySection({
  detail,
}: {
  detail: ProviderDetail;
  onOpenPatient?: (patientId: string) => void;
  onOpenAppointments?: (patientId: string) => void;
  onOpenAppointment?: (appointmentId: string) => void;
  onOpenOrder?: (orderId: string) => void;
}) {
  const { t } = useLang();
  const l = (key: string) => t.uiText[key] ?? key;
  return (
    <section className="space-y-3 rounded-xl border border-border/70 bg-card p-3.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="size-2 shrink-0 rounded-full bg-[var(--brand)]" />
          <h3 className="truncate text-sm font-semibold text-foreground">
            {l("providers_interaction_history")}
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
                  {compactDateTime(item.occurred_at, t.common_not_set)}
                </span>
              </div>
              <div className="rounded-[1.4rem] border border-zinc-200 p-4">
                <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_160px]">
                  <div className="min-w-0 space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="rounded-full border-zinc-200 text-zinc-700">
                        {humanizeCode(item.kind)}
                      </Badge>
                      <Badge variant="outline" className="rounded-full border-zinc-200 text-zinc-700">
                        {humanizeCode(item.status)}
                      </Badge>
                      {item.appointment_type ? (
                        <Badge variant="outline" className="rounded-full border-zinc-200 text-zinc-700">
                          {humanizeCode(item.appointment_type)}
                        </Badge>
                      ) : null}
                    </div>

                    <div className="grid gap-3 text-sm md:grid-cols-2">
                      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                        <span className="text-xs text-muted-foreground">{l("orders_patient")}</span>
                        <span className="font-medium text-foreground">{item.patient_name}</span>
                        <span className="text-xs text-muted-foreground">ID</span>
                        <span className="font-medium text-foreground">{item.patient_id}</span>
                      </div>
                      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                        <span className="text-xs text-muted-foreground">{l("providers_doctor")}</span>
                        <span className="font-medium text-foreground">{item.doctor_name || t.common_not_set}</span>
                        <span className="text-xs text-muted-foreground">{l("providers_location")}</span>
                        <span className="font-medium text-foreground">{item.location || t.common_not_set}</span>
                      </div>
                    </div>

                    {item.notes ? (
                      <div className="rounded-xl border border-border/60 px-3 py-2 text-sm leading-6 text-zinc-700">
                        <span className="mb-1 block text-xs text-muted-foreground">{l("patients_note")}</span>
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
                      {l("orders_patient")}
                    </Button>
                    {item.kind === "appointment" ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 w-full justify-center rounded-lg bg-muted/20"
                        onClick={() => window.open(`/appointments?appointment=${item.id}`, "_blank", "noopener,noreferrer")}
                      >
                        {l("providers_appointment")}
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
                        {l("providers_appointments")}
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
                        {l("patients_order")}
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
  const { t } = useLang();
  const l = (key: string) => t.uiText[key] ?? key;

  const profileFields = (
    <>
      <div className="grid gap-4 md:grid-cols-3">
        <Field label={l("patients_display_name")}>
          <Input
            value={form.name}
            onChange={(event) => onChange("name", event.target.value)}
            className={shellInputClassName}
            placeholder={t.providers_title}
            required
            disabled={disabled}
          />
        </Field>

        <Field label={l("providers_legal_name")}>
          <Input
            value={form.legalName}
            onChange={(event) => onChange("legalName", event.target.value)}
            className={shellInputClassName}
            placeholder={l("providers_legal_entity_contract_name")}
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
        <Field label={l("providers_tax_id")}>
          <Input
            value={form.taxId}
            onChange={(event) => onChange("taxId", event.target.value)}
            className={shellInputClassName}
            placeholder={l("providers_vat_tax_id")}
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
            placeholder={l("providers_https")}
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
          placeholder={l("providers_plain_text_becomes_summary_automatically_json_is_accepte")}
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
        <Section title={l("providers_provider_profile")}>
          {profileFields}
        </Section>
        <Section title={l("patients_address")}>
          {addressFields}
        </Section>
        <Section title={l("patients_contact")}>
          {contactFields}
        </Section>
        <Section title={l("providers_contract_and_notes")}>
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
  const { t } = useLang();
  const l = (key: string) => t.uiText[key] ?? key;

  return (
    <div className="space-y-3">
      <Section title={l("providers_doctor_profile")}>
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
          <Field label={l("providers_languages")}>
            <Input
              value={form.languages}
              onChange={(event) => onChange("languages", event.target.value)}
              className={shellInputClassName}
              placeholder={l("providers_de_en_uk")}
            />
          </Field>
        </div>
      </Section>

      <Section title={l("providers_contacts")}>
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

      <Section title={l("providers_license")}>
        <div className="grid gap-4 md:grid-cols-3">
          <Field label={l("providers_license_number")}>
            <Input
              value={form.licenseNumber}
              onChange={(event) => onChange("licenseNumber", event.target.value)}
              className={shellInputClassName}
            />
          </Field>
          <Field label={l("providers_licensing_country")}>
            <Input
              value={form.licensingCountry}
              onChange={(event) => onChange("licensingCountry", event.target.value)}
              className={shellInputClassName}
            />
          </Field>
          <Field label={l("providers_license_valid_until")}>
            <Input
              type="date"
              value={form.licensingValidUntil}
              onChange={(event) => onChange("licensingValidUntil", event.target.value)}
              className={shellInputClassName}
            />
          </Field>
        </div>
      </Section>

      <Section title={l("appointments_notes")}>
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
  const { t } = useLang();
  const l = (key: string) => t.uiText[key] ?? key;
  return (
    <div className="space-y-3">
      <Section title={l("providers_service")}>
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

      <Section title={l("providers_cost")}>
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

      <Section title={l("providers_validity")}>
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
function ProviderDetailPage() {
  const { id } = useParams<{ id: string }>();
  return <ProvidersPage detailRouteId={id ?? ""} />;
}

export { ProviderDetailPage, ProvidersPage };
