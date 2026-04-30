import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import {
  Suspense,
  lazy,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { LoaderCircle, Plus, RefreshCw, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { AdminSheetScaffold, SheetFormFooter } from "@/components/admin-page-patterns";
import { ColumnVisibilityMenu } from "@/components/data-table/column-visibility-menu";
import { DataTable } from "@/components/data-table/data-table";
import { DensityToggle } from "@/components/data-table/density-toggle";
import { FilterBuilder } from "@/components/data-table/filter-builder";
import { applyFilters } from "@/components/data-table/filter-logic";
import { SortBuilder } from "@/components/data-table/sort-builder";
import { applySort } from "@/components/data-table/sort-logic";
import type {
  ColumnDef,
  DensityLevel,
  FilterPredicate,
  SortStack,
} from "@/components/data-table/types";
import {
  EmptyCell,
  PageHeader,
  StatCard,
  checkboxClass,
  inputClass as shellInputClassName,
  selectClass as shellSelectClassName,
  textareaClass as shellTextareaClassName,
} from "@/components/ui-shell";
import { apiFetch, clearApiCache } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { useDebouncedRealtimeSubscription } from "@/lib/realtime";
import { cn } from "@/lib/utils";
import { toRfc3339 } from "@/pages/appointments/model/workflow-helpers";
import {
  conciergeServiceKindLabel,
  conciergeServiceSourceLabel,
  conciergeServiceStatusTone,
  formatPortalCurrency,
  formatPortalDateTime,
  portalStatusLabel,
} from "@/pages/patients/model/portal-shared";

const PatientServicesPage = lazy(() =>
  import("@/pages/patients/portal-services-page").then((module) => ({
    default: module.PatientServicesPage,
  })),
);

type StaffConciergeService = {
  id: string;
  patient_id: string;
  patient_name: string;
  patient_pid: string;
  appointment_id: string | null;
  appointment_title: string | null;
  provider_id: string | null;
  provider_name: string | null;
  assigned_concierge_id: string | null;
  assigned_concierge_name: string | null;
  service_kind: string;
  title: string;
  status: string;
  booking_reference: string | null;
  vendor_name: string | null;
  vendor_contact: string | null;
  starts_at: string | null;
  ends_at: string | null;
  cost_estimate: string | null;
  actual_cost: string | null;
  currency: string;
  billing_status: string;
  service_notes: string | null;
  billing_notes: string | null;
  request_source: string;
  completed_at: string | null;
  billed_at: string | null;
  created_at: string;
  updated_at: string;
};

type PatientOption = {
  id: string;
  patient_id: string;
  first_name?: string | null;
  last_name?: string | null;
};

type ProviderOption = {
  id: string;
  name: string;
  provider_type: string;
};

type StaffOption = {
  id: string;
  name: string;
  role: string;
};

type CreateServiceFormState = {
  patientId: string;
  providerId: string;
  assignedConciergeId: string;
  serviceKind: string;
  title: string;
  bookingReference: string;
  vendorName: string;
  vendorContact: string;
  startsAt: string;
  endsAt: string;
  costEstimate: string;
  actualCost: string;
  currency: string;
  serviceNotes: string;
  billingNotes: string;
};

const STAFF_SERVICES_CACHE_TTL_MS = 10_000;
const SERVICE_LOOKUPS_CACHE_TTL_MS = 30_000;
const ACTIVE_SERVICE_STATUSES = new Set(["planned", "booked", "confirmed", "in_service"]);
const BILLING_READY_STATUSES = new Set(["ready", "billed"]);
const DEFAULT_FROZEN_COLUMNS = ["title"];
const MAX_FROZEN_COLUMNS = 3;
const STAFF_SERVICES_REALTIME_EVENTS = [
  "concierge_service.created",
  "concierge_service.updated",
  "concierge_service.cancelled",
  "concierge_service.billing_ready",
] as const;
const formInputClassName = shellInputClassName;
const formSelectClassName = shellSelectClassName;
const formTextareaClassName = cn(shellTextareaClassName, "min-h-24");
const SERVICE_KIND_OPTIONS = [
  "hotel",
  "transfer",
  "vip_terminal",
  "flight",
  "chauffeur",
  "translation_support",
  "other",
];

function blankCreateServiceForm(defaultConciergeId = ""): CreateServiceFormState {
  return {
    patientId: "",
    providerId: "",
    assignedConciergeId: defaultConciergeId,
    serviceKind: "other",
    title: "",
    bookingReference: "",
    vendorName: "",
    vendorContact: "",
    startsAt: "",
    endsAt: "",
    costEstimate: "",
    actualCost: "",
    currency: "EUR",
    serviceNotes: "",
    billingNotes: "",
  };
}

function patientOptionLabel(patient: PatientOption) {
  const name = [patient.first_name, patient.last_name].filter(Boolean).join(" ");
  return name ? `${patient.patient_id} | ${name}` : patient.patient_id;
}

function optionalMoney(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function buildServicesPath(filters: { search: string; mineOnly: boolean }) {
  const params = new URLSearchParams();
  const search = filters.search.trim();
  if (search) params.set("search", search);
  if (filters.mineOnly) params.set("mine_only", "true");
  const query = params.toString();
  return query ? `/concierge-services?${query}` : "/concierge-services";
}

function billingStatusTone(status: string) {
  if (status === "settled") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "billed" || status === "ready") {
    return "border-sky-200 bg-sky-50 text-sky-700";
  }
  return "border-slate-200 bg-slate-100 text-slate-700";
}

type ServicesText = (de: string, ru: string, en: string) => string;

function buildServiceColumns(l: ServicesText): ColumnDef<StaffConciergeService>[] {
  return [
    {
      id: "title",
      label: l("Service", "РЎРµСЂРІРёСЃ", "Service"),
      accessor: (row) => row.title,
      filterType: "text",
      pinned: "left",
      width: 260,
      sortable: true,
      render: (row) => (
        <span className="truncate text-xs font-medium text-foreground">{row.title}</span>
      ),
    },
    {
      id: "status",
      label: l("Status", "РЎС‚Р°С‚СѓСЃ", "Status"),
      accessor: (row) => row.status,
      filterType: "enum",
      filterOptions: ["planned", "booked", "confirmed", "in_service", "completed", "cancelled"].map(
        (value) => ({ value, label: portalStatusLabel(value) }),
      ),
      width: 130,
      sortable: true,
      render: (row) => (
        <Badge variant="outline" className={cn("rounded-full", conciergeServiceStatusTone(row.status))}>
          {portalStatusLabel(row.status)}
        </Badge>
      ),
    },
    {
      id: "billing_status",
      label: l("Abrechnung", "Р‘РёР»Р»РёРЅРі", "Billing"),
      accessor: (row) => row.billing_status,
      filterType: "enum",
      filterOptions: ["draft", "ready", "billed", "settled"].map((value) => ({
        value,
        label: portalStatusLabel(value),
      })),
      width: 110,
      sortable: true,
      render: (row) => (
        <Badge variant="outline" className={cn("rounded-full", billingStatusTone(row.billing_status))}>
          {portalStatusLabel(row.billing_status)}
        </Badge>
      ),
    },
    {
      id: "patient",
      label: l("Patient", "РџР°С†РёРµРЅС‚", "Patient"),
      accessor: (row) => row.patient_name,
      filterType: "text",
      width: 200,
      sortable: true,
      render: (row) => (
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-xs text-foreground">{row.patient_name}</span>
          {row.patient_pid ? (
            <span className="truncate font-mono text-[10px] text-muted-foreground">
              {row.patient_pid}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      id: "service_kind",
      label: l("Art", "РўРёРї", "Kind"),
      accessor: (row) => row.service_kind,
      filterType: "enum",
      filterOptions: ["hotel", "transfer", "vip_terminal", "flight", "chauffeur", "translation_support"].map(
        (value) => ({ value, label: conciergeServiceKindLabel(value) }),
      ),
      width: 140,
      sortable: true,
      render: (row) => (
        <Badge variant="outline" className="rounded-full">
          {conciergeServiceKindLabel(row.service_kind)}
        </Badge>
      ),
    },
    {
      id: "request_source",
      label: l("Quelle", "РСЃС‚РѕС‡РЅРёРє", "Source"),
      accessor: (row) => row.request_source,
      filterType: "enum",
      filterOptions: ["patient_portal", "appointment_bootstrap", "care_team"].map((value) => ({
        value,
        label: conciergeServiceSourceLabel(value),
      })),
      width: 160,
      sortable: true,
      render: (row) => (
        <Badge variant="outline" className="rounded-full">
          {conciergeServiceSourceLabel(row.request_source)}
        </Badge>
      ),
    },
    {
      id: "vendor",
      label: l("Anbieter", "РџРѕСЃС‚Р°РІС‰РёРє", "Vendor"),
      accessor: (row) => row.vendor_name,
      filterType: "text",
      width: 180,
      sortable: true,
      render: (row) => (
        <span className="truncate text-xs text-muted-foreground">
          {row.vendor_name ?? "вЂ”"}
        </span>
      ),
    },
    {
      id: "booking",
      label: l("Buchung", "Р‘СЂРѕРЅСЊ", "Booking"),
      accessor: (row) => row.booking_reference,
      filterType: "text",
      width: 140,
      sortable: true,
      render: (row) => (
        <span className="truncate font-mono text-[11px] text-muted-foreground tabular-nums">
          {row.booking_reference ?? "вЂ”"}
        </span>
      ),
    },
    {
      id: "schedule",
      label: l("Zeitplan", "Р Р°СЃРїРёСЃР°РЅРёРµ", "Schedule"),
      accessor: (row) => row.starts_at,
      filterType: "date",
      width: 230,
      sortable: true,
      render: (row) => {
        const start = row.starts_at ? formatPortalDateTime(row.starts_at) : null;
        const end = row.ends_at ? formatPortalDateTime(row.ends_at) : null;
        const schedule = [start, end].filter(Boolean).join(" вЂ“ ");
        return (
          <span className="truncate text-xs tabular-nums text-muted-foreground">
            {schedule || "вЂ”"}
          </span>
        );
      },
    },
    {
      id: "cost",
      label: l("Kosten", "РЎС‚РѕРёРјРѕСЃС‚СЊ", "Cost"),
      accessor: (row) => Number(row.actual_cost ?? row.cost_estimate ?? 0),
      filterType: "number",
      width: 110,
      sortable: true,
      render: (row) => {
        const cost = row.actual_cost ?? row.cost_estimate;
        return (
          <span className="truncate text-xs tabular-nums text-foreground">
            {cost ? formatPortalCurrency(cost) : "вЂ”"}
          </span>
        );
      },
    },
    {
      id: "concierge",
      label: l("Concierge", "РљРѕРЅСЃСЊРµСЂР¶", "Concierge"),
      accessor: (row) => row.assigned_concierge_name,
      filterType: "text",
      width: 170,
      sortable: true,
      render: (row) => (
        <span className="truncate text-xs text-muted-foreground">
          {row.assigned_concierge_name ?? "вЂ”"}
        </span>
      ),
    },
  ];
}

function StaffServicesPage() {
  const { lang } = useLang();
  const { user } = useAuth();
  const [items, setItems] = useState<StaffConciergeService[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [search, setSearch] = useState("");
  const [mineOnly, setMineOnly] = useState(false);

  const [filterPredicates, setFilterPredicates] = useState<FilterPredicate[]>([]);
  const [sortStack, setSortStack] = useState<SortStack>([{ field: "schedule", dir: "desc" }]);
  const [density, setDensity] = useState<DensityLevel>("compact");
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([]);
  const [frozenColumns, setFrozenColumns] = useState<string[]>(DEFAULT_FROZEN_COLUMNS);
  const [patients, setPatients] = useState<PatientOption[]>([]);
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [conciergeStaff, setConciergeStaff] = useState<StaffOption[]>([]);
  const [lookupError, setLookupError] = useState("");
  const [lookupsLoading, setLookupsLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createForm, setCreateForm] = useState<CreateServiceFormState>(() =>
    blankCreateServiceForm(),
  );

  const l = useCallback(
    (de: string, ru: string, en: string) =>
      lang === "de" ? de : lang === "ru" ? ru : en,
    [lang],
  );
  const canCreateService =
    user?.role === "ceo" ||
    user?.role === "patient_manager" ||
    user?.role === "concierge";

  useDebouncedRealtimeSubscription(STAFF_SERVICES_REALTIME_EVENTS, () => {
    clearApiCache("/concierge-services");
    setVersion((value) => value + 1);
  }, 250);

  const baseColumns = useMemo(() => buildServiceColumns(l), [l]);
  const columns = useMemo<ColumnDef<StaffConciergeService>[]>(() => {
    const frozenSet = new Set(frozenColumns);
    return baseColumns.map((column) => ({
      ...column,
      pinned: frozenSet.has(column.id) ? "left" : column.pinned === "right" ? "right" : undefined,
    }));
  }, [baseColumns, frozenColumns]);

  const accessors = useMemo(() => {
    const map: Record<string, ColumnDef<StaffConciergeService>["accessor"]> = {};
    for (const column of columns) map[column.id] = column.accessor;
    return map;
  }, [columns]);

  const visibleRows = useMemo(() => {
    const filtered = applyFilters(items, filterPredicates, { accessors });
    return applySort(filtered, sortStack, { accessors });
  }, [accessors, filterPredicates, items, sortStack]);

  const defaultConciergeId = useMemo(() => {
    if (user?.role === "concierge") return user.id;
    return conciergeStaff[0]?.id ?? "";
  }, [conciergeStaff, user?.id, user?.role]);

  const selectedPatient = useMemo(
    () => patients.find((patient) => patient.id === createForm.patientId) ?? null,
    [createForm.patientId, patients],
  );

  const openCreateSheet = useCallback(() => {
    setCreateError("");
    setCreateForm(blankCreateServiceForm(defaultConciergeId));
    setCreateOpen(true);
  }, [defaultConciergeId]);

  const closeCreateSheet = useCallback(() => {
    setCreateOpen(false);
    setCreateError("");
    setCreateBusy(false);
    setCreateForm(blankCreateServiceForm(defaultConciergeId));
  }, [defaultConciergeId]);

  const handleColumnFreezeChange = useCallback((columnId: string, frozen: boolean) => {
    if (frozen) {
      setFrozenColumns((current) =>
        current.includes(columnId) || current.length >= MAX_FROZEN_COLUMNS
          ? current
          : [...current, columnId],
      );
    } else {
      setFrozenColumns((current) => current.filter((id) => id !== columnId));
    }
  }, []);

  useEffect(() => {
    if (!canCreateService) return;
    let cancelled = false;

    async function loadLookups() {
      setLookupsLoading(true);
      try {
        const [patientRows, providerRows, staffRows] = await Promise.all([
          apiFetch<PatientOption[]>("/patients?active_only=true", {
            cacheTtlMs: SERVICE_LOOKUPS_CACHE_TTL_MS,
          }),
          apiFetch<ProviderOption[]>("/providers?provider_type=non_medical&active_only=true", {
            cacheTtlMs: SERVICE_LOOKUPS_CACHE_TTL_MS,
          }),
          apiFetch<StaffOption[]>("/appointments/meta/staff", {
            cacheTtlMs: SERVICE_LOOKUPS_CACHE_TTL_MS,
          }),
        ]);
        if (cancelled) return;
        setPatients(patientRows);
        setProviders(providerRows.filter((provider) => provider.provider_type === "non_medical"));
        setConciergeStaff(staffRows.filter((member) => member.role === "concierge"));
        setLookupError("");
      } catch (err) {
        if (cancelled) return;
        setLookupError(
          err instanceof Error
            ? err.message
            : l(
                "Stammdaten konnten nicht geladen werden.",
                "РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РіСЂСѓР·РёС‚СЊ СЃРїСЂР°РІРѕС‡РЅРёРєРё.",
                "Failed to load lookup data.",
              ),
        );
      } finally {
        if (!cancelled) setLookupsLoading(false);
      }
    }

    void loadLookups();
    return () => {
      cancelled = true;
    };
  }, [canCreateService, l]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (loading) {
        setRefreshing(false);
      } else {
        setRefreshing(true);
      }

      try {
        const rows = await apiFetch<StaffConciergeService[]>(
          buildServicesPath({ search, mineOnly }),
          { cacheTtlMs: STAFF_SERVICES_CACHE_TTL_MS },
        );
        if (cancelled) return;
        startTransition(() => {
          setItems(rows);
          setError("");
        });
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error
            ? err.message
            : l(
                "Concierge-Services konnten nicht geladen werden.",
                "РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РіСЂСѓР·РёС‚СЊ concierge-СЃРµСЂРІРёСЃС‹.",
                "Failed to load concierge services.",
              ),
        );
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [l, loading, mineOnly, search, version]);

  async function handleCreateService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateError("");

    const title = createForm.title.trim();
    if (!createForm.patientId) {
      setCreateError(l("Patient ist erforderlich.", "РџР°С†РёРµРЅС‚ РѕР±СЏР·Р°С‚РµР»РµРЅ.", "Patient is required."));
      return;
    }
    if (!title) {
      setCreateError(l("Titel ist erforderlich.", "РќР°Р·РІР°РЅРёРµ РѕР±СЏР·Р°С‚РµР»СЊРЅРѕ.", "Title is required."));
      return;
    }

    const costEstimate = optionalMoney(createForm.costEstimate);
    const actualCost = optionalMoney(createForm.actualCost);
    if (Number.isNaN(costEstimate) || Number.isNaN(actualCost)) {
      setCreateError(
        l(
          "Kostenfelder mГјssen gГјltige Zahlen sein.",
          "РџРѕР»СЏ СЃС‚РѕРёРјРѕСЃС‚Рё РґРѕР»Р¶РЅС‹ Р±С‹С‚СЊ РєРѕСЂСЂРµРєС‚РЅС‹РјРё С‡РёСЃР»Р°РјРё.",
          "Cost fields must be valid numbers.",
        ),
      );
      return;
    }

    const currency = createForm.currency.trim().toUpperCase() || "EUR";
    if (currency.length !== 3) {
      setCreateError(
        l(
          "WГ¤hrung muss aus 3 Buchstaben bestehen.",
          "Р’Р°Р»СЋС‚Р° РґРѕР»Р¶РЅР° СЃРѕСЃС‚РѕСЏС‚СЊ РёР· 3 Р±СѓРєРІ.",
          "Currency must be 3 letters.",
        ),
      );
      return;
    }

    setCreateBusy(true);
    try {
      const created = await apiFetch<StaffConciergeService>("/concierge-services", {
        method: "POST",
        body: JSON.stringify({
          patient_id: createForm.patientId,
          provider_id: createForm.providerId || null,
          assigned_concierge_id: createForm.assignedConciergeId || null,
          service_kind: createForm.serviceKind,
          title,
          booking_reference: createForm.bookingReference.trim() || null,
          vendor_name: createForm.vendorName.trim() || null,
          vendor_contact: createForm.vendorContact.trim() || null,
          starts_at: createForm.startsAt ? toRfc3339(createForm.startsAt) : null,
          ends_at: createForm.endsAt ? toRfc3339(createForm.endsAt) : null,
          cost_estimate: costEstimate,
          actual_cost: actualCost,
          currency,
          service_notes: createForm.serviceNotes.trim() || null,
          billing_notes: createForm.billingNotes.trim() || null,
        }),
      });
      clearApiCache("/concierge-services");
      setItems((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      setCreateForm(blankCreateServiceForm(defaultConciergeId));
      setCreateOpen(false);
      setVersion((value) => value + 1);
    } catch (err) {
      setCreateError(
        err instanceof Error
          ? err.message
          : l(
              "Concierge-Service konnte nicht erstellt werden.",
              "РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕР·РґР°С‚СЊ concierge-СЃРµСЂРІРёСЃ.",
              "Failed to create concierge service.",
            ),
      );
    } finally {
      setCreateBusy(false);
    }
  }

  const activeCount = useMemo(
    () => items.filter((item) => ACTIVE_SERVICE_STATUSES.has(item.status)).length,
    [items],
  );
  const readyForBillingCount = useMemo(
    () => items.filter((item) => BILLING_READY_STATUSES.has(item.billing_status)).length,
    [items],
  );
  const portalRequestCount = useMemo(
    () => items.filter((item) => item.request_source === "patient_portal").length,
    [items],
  );

  const operatorLabels = useMemo(
    () => ({
      contains: l("enthГ¤lt", "СЃРѕРґРµСЂР¶РёС‚", "contains"),
      does_not_contain: l("enthГ¤lt nicht", "РЅРµ СЃРѕРґРµСЂР¶РёС‚", "does not contain"),
      is_empty: l("ist leer", "РїСѓСЃС‚Рѕ", "is empty"),
      is_not_empty: l("ist nicht leer", "РЅРµ РїСѓСЃС‚Рѕ", "is not empty"),
      is: l("ist", "СЂР°РІРЅРѕ", "is"),
      is_not: l("ist nicht", "РЅРµ СЂР°РІРЅРѕ", "is not"),
      is_any_of: l("ist eines von", "РѕРґРЅРѕ РёР·", "is any of"),
      is_none_of: l("ist keines von", "РЅРё РѕРґРЅРѕ РёР·", "is none of"),
      has_any: l("hat eines von", "РёРјРµРµС‚ Р»СЋР±РѕРµ", "has any"),
      has_all: l("hat alle", "РёРјРµРµС‚ РІСЃРµ", "has all"),
      has_none: l("hat keines", "РЅРµ РёРјРµРµС‚", "has none"),
      before: l("vor", "РґРѕ", "before"),
      after: l("nach", "РїРѕСЃР»Рµ", "after"),
      between: l("zwischen", "РјРµР¶РґСѓ", "between"),
      last_n_days: l("letzte N Tage", "Р·Р° N РґРЅРµР№", "last N days"),
      equals: l("gleich", "СЂР°РІРЅРѕ", "equals"),
    }),
    [l],
  );

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex items-center gap-3 rounded-full border border-slate-200 bg-white px-5 py-3 text-sm text-slate-500 shadow-sm">
          <LoaderCircle className="size-4 animate-spin" />
          {l("Concierge-Services werden geladen...", "Р—Р°РіСЂСѓР·РєР° concierge-СЃРµСЂРІРёСЃРѕРІ...", "Loading concierge services...")}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={l("Concierge-Services", "Concierge-СЃРµСЂРІРёСЃС‹", "Concierge services")}
        actions={
          canCreateService ? (
            <Button
              type="button"
              size="sm"
              onClick={openCreateSheet}
              disabled={lookupsLoading && patients.length === 0}
            >
              <Plus className="size-3.5" />
              {l("Service hinzufГјgen", "Р”РѕР±Р°РІРёС‚СЊ СЃРµСЂРІРёСЃ", "Add service")}
            </Button>
          ) : null
        }
      />

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}
      {lookupError ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {lookupError}
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-3">
        <StatCard label={l("Aktiv", "РђРєС‚РёРІРЅС‹Рµ", "Active")} value={activeCount} />
        <StatCard label={l("Billing-ready", "Р“РѕС‚РѕРІС‹ Рє Р±РёР»Р»РёРЅРіСѓ", "Billing-ready")} value={readyForBillingCount} />
        <StatCard label={l("Portal-Anfragen", "Р—Р°РїСЂРѕСЃС‹ РїРѕСЂС‚Р°Р»Р°", "Portal requests")} value={portalRequestCount} />
      </div>

      <div className="relative z-30 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={l("Patient, Anbieter, Buchung...", "РџР°С†РёРµРЅС‚, РїСЂРѕРІР°Р№РґРµСЂ, Р±СЂРѕРЅСЊ...", "Patient, provider, booking...")}
              className="h-8 w-full rounded-lg bg-background pl-8 text-[13px]"
            />
          </div>

          <label className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-input bg-card px-2.5 text-[13px] text-foreground">
            <input
              type="checkbox"
              checked={mineOnly}
              onChange={(event) => setMineOnly(event.target.checked)}
              className={checkboxClass}
            />
            {l("Meine", "РњРѕРё", "Mine")}
          </label>

          <div className="ml-auto flex items-center gap-1.5">
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {visibleRows.length === items.length
                ? `${items.length}`
                : `${visibleRows.length} / ${items.length}`}
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              title={l("Aktualisieren", "РћР±РЅРѕРІРёС‚СЊ", "Refresh")}
              aria-label={l("Aktualisieren", "РћР±РЅРѕРІРёС‚СЊ", "Refresh")}
              onClick={() => setVersion((value) => value + 1)}
            >
              <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 border-t border-border/70 pt-2">
          <FilterBuilder
            columns={columns}
            rows={items}
            filters={filterPredicates}
            onChange={setFilterPredicates}
            translations={{
              addFilter: l("Filter", "Р¤РёР»СЊС‚СЂ", "Filter"),
              clearAll: l("Leeren", "РћС‡РёСЃС‚РёС‚СЊ", "Clear"),
              searchPlaceholder: l("Felder suchen", "РџРѕРёСЃРє РїРѕР»РµР№", "Search fields"),
              noFields: l("Keine verfГјgbaren Felder", "РќРµС‚ РґРѕСЃС‚СѓРїРЅС‹С… РїРѕР»РµР№", "No available fields"),
              remove: l("Filter entfernen", "РЈРґР°Р»РёС‚СЊ С„РёР»СЊС‚СЂ", "Remove filter"),
              valuePlaceholder: l("Wert", "Р—РЅР°С‡РµРЅРёРµ", "Value"),
              yes: l("Ja", "Р”Р°", "Yes"),
              no: l("Nein", "РќРµС‚", "No"),
              operatorLabels,
            }}
          />

          <SortBuilder
            columns={columns}
            value={sortStack}
            onChange={setSortStack}
            translations={{
              addSort: l("Sortierung hinzufГјgen", "Р”РѕР±Р°РІРёС‚СЊ СЃРѕСЂС‚РёСЂРѕРІРєСѓ", "Add sort"),
              clearAll: l("Leeren", "РћС‡РёСЃС‚РёС‚СЊ", "Clear"),
              ascending: l("Aufsteigend", "РџРѕ РІРѕР·СЂР°СЃС‚Р°РЅРёСЋ", "Asc"),
              descending: l("Absteigend", "РџРѕ СѓР±С‹РІР°РЅРёСЋ", "Desc"),
              emptyHint: l("Sortierung", "РЎРѕСЂС‚РёСЂРѕРІРєР°", "Sort"),
              moveUp: l("Nach oben", "Р’С‹С€Рµ", "Move up"),
              moveDown: l("Nach unten", "РќРёР¶Рµ", "Move down"),
              remove: l("Sortierung entfernen", "РЈРґР°Р»РёС‚СЊ СЃРѕСЂС‚РёСЂРѕРІРєСѓ", "Remove sort"),
            }}
          />

          <div className="flex items-center gap-1">
            <ColumnVisibilityMenu
              columns={columns}
              hiddenColumns={hiddenColumns}
              onChange={setHiddenColumns}
              defaultHidden={[]}
              frozenColumns={frozenColumns}
              onFrozenColumnsChange={setFrozenColumns}
              defaultFrozen={DEFAULT_FROZEN_COLUMNS}
              maxFrozenColumns={MAX_FROZEN_COLUMNS}
              buttonLabel={l("Spalten", "РљРѕР»РѕРЅРєРё", "Columns")}
              searchPlaceholder={l("Spalten suchen", "РџРѕРёСЃРє РєРѕР»РѕРЅРѕРє", "Search columns")}
              resetLabel={l("ZurГјcksetzen", "РЎР±СЂРѕСЃРёС‚СЊ", "Reset")}
              showAllLabel={l("Alle anzeigen", "РџРѕРєР°Р·Р°С‚СЊ РІСЃРµ", "Show all")}
              hideAllLabel={l("Alle ausblenden", "РЎРєСЂС‹С‚СЊ РІСЃРµ", "Hide all")}
              noMatchLabel={l("Keine Treffer", "РќРµС‚ СЃРѕРІРїР°РґРµРЅРёР№", "No match")}
              requiredNoteLabel={l("erforderlich", "РѕР±СЏР·Р°С‚РµР»СЊРЅР°СЏ", "required")}
              freezeLabel={l("Fixieren", "Р—Р°РєСЂРµРїРёС‚СЊ", "Freeze")}
              unfreezeLabel={l("LГ¶sen", "РћС‚РєСЂРµРїРёС‚СЊ", "Unfreeze")}
              frozenNoteLabel={l("fixiert", "Р·Р°РєСЂРµРїР»РµРЅР°", "frozen")}
            />
            <DensityToggle
              value={density}
              onChange={setDensity}
              ariaLabel={l("Zeilendichte", "РџР»РѕС‚РЅРѕСЃС‚СЊ СЃС‚СЂРѕРє", "Row density")}
              labels={{
                comfortable: l("Komfortabel", "РЎРІРѕР±РѕРґРЅРѕ", "Comfortable"),
                compact: l("Kompakt", "РљРѕРјРїР°РєС‚РЅРѕ", "Compact"),
                condensed: l("Dicht", "РџР»РѕС‚РЅРѕ", "Condensed"),
              }}
            />
          </div>
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyCell>
          {l(
            "Keine Concierge-Services im aktuellen Filter.",
            "РќРµС‚ concierge-СЃРµСЂРІРёСЃРѕРІ РІ С‚РµРєСѓС‰РµРј С„РёР»СЊС‚СЂРµ.",
            "No concierge services in the current filter.",
          )}
        </EmptyCell>
      ) : (
        <DataTable
          rows={visibleRows}
          columns={columns}
          hiddenColumns={hiddenColumns}
          sort={sortStack}
          onSortChange={setSortStack}
          onColumnFreezeChange={handleColumnFreezeChange}
          isColumnFreezeDisabled={(column, nextFrozen) =>
            nextFrozen &&
            !frozenColumns.includes(column.id) &&
            frozenColumns.length >= MAX_FROZEN_COLUMNS
          }
          density={density}
          rowId={(row) => row.id}
          className="min-h-[480px]"
        />
      )}

      <Sheet open={createOpen} onOpenChange={(open) => (open ? setCreateOpen(true) : closeCreateSheet())}>
        <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-[760px]">
          <form onSubmit={handleCreateService} className="flex h-full min-h-0 flex-col">
            <AdminSheetScaffold
              title={l("Concierge-Service hinzufugen", "\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c concierge-\u0441\u0435\u0440\u0432\u0438\u0441", "Add concierge service")}
              description={
                selectedPatient
                  ? patientOptionLabel(selectedPatient)
                  : l(
                      "Patient, Serviceart und Zeitfenster festlegen.",
                      "\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u043f\u0430\u0446\u0438\u0435\u043d\u0442\u0430, \u0442\u0438\u043f \u0441\u0435\u0440\u0432\u0438\u0441\u0430 \u0438 \u0432\u0440\u0435\u043c\u0435\u043d\u043d\u043e\u0435 \u043e\u043a\u043d\u043e.",
                      "Set patient, service kind, and schedule window.",
                    )
              }
              bodyClassName="space-y-4 px-5 py-4"
              footer={
                <SheetFormFooter
                  cancelLabel={l("Abbrechen", "\u041e\u0442\u043c\u0435\u043d\u0430", "Cancel")}
                  submitLabel={l("Speichern", "\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c", "Save")}
                  submittingLabel={l("Speichern", "\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c", "Save")}
                  submitting={createBusy}
                  submitDisabled={createBusy || lookupsLoading}
                  onCancel={closeCreateSheet}
                />
              }
            >
              {createError ? (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {createError}
                </div>
              ) : null}

              <section className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1.5 text-sm">
                    <span className="text-xs font-medium text-muted-foreground">
                      {l("Patient", "РџР°С†РёРµРЅС‚", "Patient")}
                    </span>
                    <NativeComboboxSelect
                      required
                      value={createForm.patientId}
                      onChange={(event) =>
                        setCreateForm((current) => ({ ...current, patientId: event.target.value }))
                      }
                      className={formSelectClassName}
                    >
                      <option value="">{l("AuswГ¤hlen", "Р’С‹Р±СЂР°С‚СЊ", "Select")}</option>
                      {patients.map((patient) => (
                        <option key={patient.id} value={patient.id}>
                          {patientOptionLabel(patient)}
                        </option>
                      ))}
                    </NativeComboboxSelect>
                  </label>

                  <label className="space-y-1.5 text-sm">
                    <span className="text-xs font-medium text-muted-foreground">
                      {l("Serviceart", "РўРёРї СЃРµСЂРІРёСЃР°", "Service kind")}
                    </span>
                    <NativeComboboxSelect
                      value={createForm.serviceKind}
                      onChange={(event) =>
                        setCreateForm((current) => ({ ...current, serviceKind: event.target.value }))
                      }
                      className={formSelectClassName}
                    >
                      {SERVICE_KIND_OPTIONS.map((kind) => (
                        <option key={kind} value={kind}>
                          {conciergeServiceKindLabel(kind)}
                        </option>
                      ))}
                    </NativeComboboxSelect>
                  </label>
                </div>

                <label className="block space-y-1.5 text-sm">
                  <span className="text-xs font-medium text-muted-foreground">
                    {l("Titel", "РќР°Р·РІР°РЅРёРµ", "Title")}
                  </span>
                  <Input
                    required
                    value={createForm.title}
                    onChange={(event) =>
                      setCreateForm((current) => ({ ...current, title: event.target.value }))
                    }
                    className={formInputClassName}
                  />
                </label>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1.5 text-sm">
                    <span className="text-xs font-medium text-muted-foreground">
                      {l("Provider", "РџСЂРѕРІР°Р№РґРµСЂ", "Provider")}
                    </span>
                    <NativeComboboxSelect
                      value={createForm.providerId}
                      onChange={(event) =>
                        setCreateForm((current) => ({ ...current, providerId: event.target.value }))
                      }
                      className={formSelectClassName}
                    >
                      <option value="">{l("Optional", "РћРїС†РёРѕРЅР°Р»СЊРЅРѕ", "Optional")}</option>
                      {providers.map((provider) => (
                        <option key={provider.id} value={provider.id}>
                          {provider.name}
                        </option>
                      ))}
                    </NativeComboboxSelect>
                  </label>

                  <label className="space-y-1.5 text-sm">
                    <span className="text-xs font-medium text-muted-foreground">
                      {l("Concierge", "РљРѕРЅСЃСЊРµСЂР¶", "Concierge")}
                    </span>
                    <NativeComboboxSelect
                      value={createForm.assignedConciergeId}
                      onChange={(event) =>
                        setCreateForm((current) => ({
                          ...current,
                          assignedConciergeId: event.target.value,
                        }))
                      }
                      className={formSelectClassName}
                    >
                      <option value="">{l("Nicht zugewiesen", "РќРµ РЅР°Р·РЅР°С‡РµРЅ", "Unassigned")}</option>
                      {conciergeStaff.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.name}
                        </option>
                      ))}
                    </NativeComboboxSelect>
                  </label>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1.5 text-sm">
                    <span className="text-xs font-medium text-muted-foreground">
                      {l("Start", "РќР°С‡Р°Р»Рѕ", "Start")}
                    </span>
                    <Input
                      type="datetime-local"
                      value={createForm.startsAt}
                      onChange={(event) =>
                        setCreateForm((current) => ({ ...current, startsAt: event.target.value }))
                      }
                      className={formInputClassName}
                    />
                  </label>
                  <label className="space-y-1.5 text-sm">
                    <span className="text-xs font-medium text-muted-foreground">
                      {l("Ende", "РљРѕРЅРµС†", "End")}
                    </span>
                    <Input
                      type="datetime-local"
                      value={createForm.endsAt}
                      onChange={(event) =>
                        setCreateForm((current) => ({ ...current, endsAt: event.target.value }))
                      }
                      className={formInputClassName}
                    />
                  </label>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="space-y-1.5 text-sm">
                    <span className="text-xs font-medium text-muted-foreground">
                      {l("KostenschГ¤tzung", "РћС†РµРЅРєР° СЃС‚РѕРёРјРѕСЃС‚Рё", "Cost estimate")}
                    </span>
                    <Input
                      inputMode="decimal"
                      value={createForm.costEstimate}
                      onChange={(event) =>
                        setCreateForm((current) => ({
                          ...current,
                          costEstimate: event.target.value,
                        }))
                      }
                      className={formInputClassName}
                    />
                  </label>
                  <label className="space-y-1.5 text-sm">
                    <span className="text-xs font-medium text-muted-foreground">
                      {l("Ist-Kosten", "Р¤Р°РєС‚РёС‡РµСЃРєР°СЏ СЃС‚РѕРёРјРѕСЃС‚СЊ", "Actual cost")}
                    </span>
                    <Input
                      inputMode="decimal"
                      value={createForm.actualCost}
                      onChange={(event) =>
                        setCreateForm((current) => ({ ...current, actualCost: event.target.value }))
                      }
                      className={formInputClassName}
                    />
                  </label>
                  <label className="space-y-1.5 text-sm">
                    <span className="text-xs font-medium text-muted-foreground">
                      {l("WГ¤hrung", "Р’Р°Р»СЋС‚Р°", "Currency")}
                    </span>
                    <Input
                      value={createForm.currency}
                      maxLength={3}
                      onChange={(event) =>
                        setCreateForm((current) => ({ ...current, currency: event.target.value }))
                      }
                      className={cn(formInputClassName, "uppercase")}
                    />
                  </label>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1.5 text-sm">
                    <span className="text-xs font-medium text-muted-foreground">
                      {l("Buchungsreferenz", "РќРѕРјРµСЂ Р±СЂРѕРЅРё", "Booking reference")}
                    </span>
                    <Input
                      value={createForm.bookingReference}
                      onChange={(event) =>
                        setCreateForm((current) => ({
                          ...current,
                          bookingReference: event.target.value,
                        }))
                      }
                      className={formInputClassName}
                    />
                  </label>
                  <label className="space-y-1.5 text-sm">
                    <span className="text-xs font-medium text-muted-foreground">
                      {l("Vendor", "РџРѕСЃС‚Р°РІС‰РёРє", "Vendor")}
                    </span>
                    <Input
                      value={createForm.vendorName}
                      onChange={(event) =>
                        setCreateForm((current) => ({ ...current, vendorName: event.target.value }))
                      }
                      className={formInputClassName}
                    />
                  </label>
                </div>

                <label className="block space-y-1.5 text-sm">
                  <span className="text-xs font-medium text-muted-foreground">
                    {l("Vendor-Kontakt", "РљРѕРЅС‚Р°РєС‚ РїРѕСЃС‚Р°РІС‰РёРєР°", "Vendor contact")}
                  </span>
                  <Input
                    value={createForm.vendorContact}
                    onChange={(event) =>
                      setCreateForm((current) => ({ ...current, vendorContact: event.target.value }))
                    }
                    className={formInputClassName}
                  />
                </label>

                <label className="block space-y-1.5 text-sm">
                  <span className="text-xs font-medium text-muted-foreground">
                    {l("Service-Notizen", "Р—Р°РјРµС‚РєРё РїРѕ СЃРµСЂРІРёСЃСѓ", "Service notes")}
                  </span>
                  <textarea
                    value={createForm.serviceNotes}
                    onChange={(event) =>
                      setCreateForm((current) => ({ ...current, serviceNotes: event.target.value }))
                    }
                    className={formTextareaClassName}
                    rows={4}
                  />
                </label>

                <label className="block space-y-1.5 text-sm">
                  <span className="text-xs font-medium text-muted-foreground">
                    {l("Billing-Notizen", "Р—Р°РјРµС‚РєРё РїРѕ Р±РёР»Р»РёРЅРіСѓ", "Billing notes")}
                  </span>
                  <textarea
                    value={createForm.billingNotes}
                    onChange={(event) =>
                      setCreateForm((current) => ({ ...current, billingNotes: event.target.value }))
                    }
                    className={formTextareaClassName}
                    rows={3}
                  />
                </label>
              </section>
            </AdminSheetScaffold>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}

export function ServicesPage() {
  const { user } = useAuth();

  if (user?.role === "patient") {
    return (
      <Suspense fallback={<div className="min-h-[40vh]" />}>
        <PatientServicesPage />
      </Suspense>
    );
  }

  return <StaffServicesPage />;
}

