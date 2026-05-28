import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import {
  Suspense,
  lazy,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type FormEvent,
  useReducer,
  type SetStateAction,
} from "react";
import { Activity, ClipboardList, LoaderCircle, Pencil, Plus, RefreshCw, Search, Wallet } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { AdminInlineMetric, AdminSheetScaffold, SheetFormFooter } from "@/components/admin-page-patterns";
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
  Section,
  checkboxClass,
  inputClass as shellInputClassName,
  selectClass as shellSelectClassName,
  textareaClass as shellTextareaClassName,
} from "@/components/ui-shell";
import { apiFetch, clearApiCache } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  formatEnumLabelFromKeys,
  useLang,
  type Lang,
  type Translations,
  type TranslationKey,
} from "@/lib/i18n";
import { useDebouncedRealtimeSubscription } from "@/lib/realtime";
import { cn } from "@/lib/utils";
import {
  providerOptionLabel,
} from "@/pages/appointments/model/provider-taxonomy";
import { toDateTimeLocalInput } from "@/pages/appointments/model/date-time";
import { toRfc3339 } from "@/pages/appointments/model/workflow-helpers";
import {
  conciergeServiceStatusTone,
  formatPortalCurrency,
  formatPortalDateTime,
} from "@/pages/patients/model/portal-shared";
import { fetchProviderDetail, fetchProviderTaxonomy } from "@/pages/providers/data/provider-api";
import type { ProviderTaxonomyNode, ServiceItem } from "@/pages/providers/model/types";
import { ProviderSelectWithTaxonomyFilter } from "@/pages/providers/ui/provider-select-with-taxonomy-filter";
import { ProviderTaxonomyCascadeSelect } from "@/pages/providers/ui/provider-taxonomy-cascade-select";

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
  provider_service_id: string | null;
  provider_service_name: string | null;
  taxonomy_node_id: string | null;
  taxonomy_node_code: string | null;
  taxonomy_node_name_de: string | null;
  taxonomy_node_name_ru: string | null;
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
  quantity: string;
  unit_price: string | null;
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
  address_city?: string | null;
  taxonomy_node_id?: string | null;
  taxonomy_node_code?: string | null;
  taxonomy_node_name_de?: string | null;
  taxonomy_node_name_ru?: string | null;
  taxonomy_node?: ProviderTaxonomyNode | null;
  taxonomy_path?: ProviderTaxonomyNode[];
  taxonomy_node_ids?: string[];
};

type StaffOption = {
  id: string;
  name: string;
  role: string;
};

type CreateServiceFormState = {
  patientId: string;
  providerId: string;
  providerServiceId: string;
  taxonomyNodeId: string;
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
  quantity: string;
  currency: string;
  serviceNotes: string;
  billingNotes: string;
};

type EditServiceFormState = CreateServiceFormState & {
  status: string;
  billingStatus: string;
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
const providerPickerContainerClassName =
  "sm:grid-cols-[minmax(180px,0.85fr)_minmax(220px,1.15fr)]";
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

const SERVICE_STATUS_LABEL_KEYS = {
  planned: "operations_status_planned",
  booked: "operations_status_booked",
  confirmed: "operations_status_confirmed",
  in_service: "operations_status_in_service",
  completed: "staff_services_status_completed",
  cancelled: "staff_services_status_cancelled",
} satisfies Partial<Record<string, TranslationKey>>;

const SERVICE_BILLING_STATUS_LABEL_KEYS = {
  draft: "staff_services_billing_status_draft",
  ready: "staff_services_billing_status_ready",
  billed: "staff_services_billing_status_billed",
  settled: "staff_services_billing_status_settled",
  waived: "appointment_billing_status_waived",
} satisfies Partial<Record<string, TranslationKey>>;

const SERVICE_KIND_LABEL_KEYS = {
  hotel: "staff_services_kind_hotel",
  transfer: "staff_services_kind_transfer",
  vip_terminal: "staff_services_kind_vip_terminal",
  flight: "staff_services_kind_flight",
  chauffeur: "staff_services_kind_chauffeur",
  translation_support: "staff_services_kind_translation_support",
  other: "staff_services_kind_other",
} satisfies Partial<Record<string, TranslationKey>>;

const SERVICE_SOURCE_LABEL_KEYS = {
  patient_portal: "staff_services_source_patient_portal",
  appointment_bootstrap: "staff_services_source_appointment_bootstrap",
  care_team: "staff_services_source_care_team",
  staff: "staff_services_source_care_team",
} satisfies Partial<Record<string, TranslationKey>>;

function blankCreateServiceForm(defaultConciergeId = ""): CreateServiceFormState {
  return {
    patientId: "",
    providerId: "",
    providerServiceId: "",
    taxonomyNodeId: "",
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
    quantity: "1",
    currency: "EUR",
    serviceNotes: "",
    billingNotes: "",
  };
}

function buildEditServiceForm(service: StaffConciergeService): EditServiceFormState {
  return {
    patientId: service.patient_id,
    providerId: service.provider_id ?? "",
    providerServiceId: service.provider_service_id ?? "",
    taxonomyNodeId: service.taxonomy_node_id ?? "",
    assignedConciergeId: service.assigned_concierge_id ?? "",
    serviceKind: service.service_kind,
    title: service.title,
    bookingReference: service.booking_reference ?? "",
    vendorName: service.vendor_name ?? "",
    vendorContact: service.vendor_contact ?? "",
    startsAt: toDateTimeLocalInput(service.starts_at),
    endsAt: toDateTimeLocalInput(service.ends_at),
    costEstimate: service.cost_estimate ?? "",
    actualCost: service.actual_cost ?? "",
    quantity: service.quantity || "1",
    currency: service.currency || "EUR",
    serviceNotes: service.service_notes ?? "",
    billingNotes: service.billing_notes ?? "",
    status: service.status,
    billingStatus: service.billing_status,
  };
}

function patientOptionLabel(patient: PatientOption) {
  const name = [patient.first_name, patient.last_name].filter(Boolean).join(" ");
  return name ? `${patient.patient_id} | ${name}` : patient.patient_id;
}

function optionalMoney(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function integerInputValue(value: string) {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return Number.NaN;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : Number.NaN;
}

function formatMoneyInput(value: number) {
  if (!Number.isFinite(value)) return "";
  return value.toFixed(2).replace(/\.00$/, "");
}

function providerServiceUnitPrice(service: ServiceItem | null | undefined) {
  if (!service || service.price_type === "on_request") return null;
  const candidates =
    service.price_type === "range"
      ? [service.price_from, service.price, service.price_to]
      : [service.price, service.price_from, service.price_to];
  for (const value of candidates) {
    if (value === null || value === undefined || String(value).trim() === "") continue;
    const parsed = Number(String(value).replace(",", "."));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function providerServiceOptionLabel(service: ServiceItem) {
  const unitPrice = providerServiceUnitPrice(service);
  return unitPrice === null
    ? service.service_name
    : `${service.service_name} | ${formatPortalCurrency(unitPrice)}`;
}

function calculatedServiceTotal(service: ServiceItem | null | undefined, quantityInput: string) {
  const unitPrice = providerServiceUnitPrice(service);
  const quantity = integerInputValue(quantityInput);
  if (unitPrice === null || !Number.isFinite(quantity) || quantity <= 0) return null;
  return unitPrice * quantity;
}

function buildServicesPath(filters: { search: string; mineOnly: boolean; taxonomyNodeId: string }) {
  const params = new URLSearchParams();
  const search = filters.search.trim();
  if (search) params.set("search", search);
  if (filters.mineOnly) params.set("mine_only", "true");
  if (filters.taxonomyNodeId) params.set("taxonomy_node_id", filters.taxonomyNodeId);
  const query = params.toString();
  return query ? `/concierge-services?${query}` : "/concierge-services";
}

function billingStatusTone(status: string) {
  if (status === "settled") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "billed" || status === "ready") {
    return "border-sky-200 bg-sky-50 text-sky-700";
  }
  return "border-neutral-200 bg-neutral-100 text-neutral-700";
}

function serviceStatusLabel(value: string, t: Translations) {
  return formatEnumLabelFromKeys(value, SERVICE_STATUS_LABEL_KEYS, t);
}

function billingStatusLabel(value: string, t: Translations) {
  return formatEnumLabelFromKeys(value, SERVICE_BILLING_STATUS_LABEL_KEYS, t);
}

function serviceKindLabel(value: string, t: Translations) {
  return formatEnumLabelFromKeys(value, SERVICE_KIND_LABEL_KEYS, t);
}

function serviceSourceLabel(value: string, t: Translations) {
  return formatEnumLabelFromKeys(value, SERVICE_SOURCE_LABEL_KEYS, t);
}

function serviceTaxonomyLabel(service: StaffConciergeService, lang: Lang, fallback = "") {
  if (lang === "ru") {
    return (
      service.taxonomy_node_name_ru ||
      service.taxonomy_node_name_de ||
      service.taxonomy_node_code ||
      fallback
    );
  }
  return (
    service.taxonomy_node_name_de ||
    service.taxonomy_node_name_ru ||
    service.taxonomy_node_code ||
    fallback
  );
}

function ServiceTaxonomyBadge({
  label,
  fallback,
}: {
  label?: string | null;
  fallback: string;
}) {
  return (
    <Badge variant="outline" className="max-w-full rounded-full border-border/80 bg-muted/30">
      <span className="truncate">{label?.trim() || fallback}</span>
    </Badge>
  );
}

function ServiceDetailField({
  label,
  value,
  multiline = false,
}: {
  label: string;
  value?: string | null;
  multiline?: boolean;
}) {
  const displayValue = value?.trim() || "-";

  return (
    <ServiceSummaryLine label={label} value={displayValue} multiline={multiline} />
  );
}

function serviceDetailValue(value?: ReactNode) {
  if (typeof value === "string") return value.trim() || "-";
  if (value === null || value === undefined || value === false) return "-";
  return value;
}

function ServiceMiniMetric({
  label,
  value,
}: {
  label: string;
  value?: ReactNode;
}) {
  const displayValue = serviceDetailValue(value);

  return (
    <div className="flex min-w-[210px] flex-1 items-center justify-between gap-3 rounded-full border border-border bg-muted/20 px-4 py-2">
      <span className="min-w-0 truncate text-xs font-medium text-muted-foreground">
        {label}
      </span>
      <span className="flex min-w-0 max-w-[58%] justify-end text-right text-sm font-semibold leading-none text-foreground">
        {displayValue}
      </span>
    </div>
  );
}

function ServiceSummaryLine({
  label,
  value,
  multiline = false,
}: {
  label: string;
  value?: ReactNode;
  multiline?: boolean;
}) {
  const displayValue = serviceDetailValue(value);

  if (multiline) {
    return (
      <div className="rounded-lg px-2 py-1.5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="min-w-0 shrink-0 truncate text-xs font-medium text-muted-foreground">
            {label}
          </span>
          <span className="h-px min-w-6 flex-1 bg-border/70" />
        </div>
        <div className="mt-1.5 whitespace-pre-wrap break-words text-sm font-medium leading-6 text-foreground">
          {displayValue}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-3 rounded-lg px-2 py-1.5">
      <span className="min-w-0 shrink-0 truncate text-xs font-medium text-muted-foreground">
        {label}
      </span>
      <span className="h-px min-w-6 flex-1 bg-border/70" />
      <span
        className={cn(
          "min-w-0 max-w-[58%] truncate text-right text-sm font-semibold leading-none text-foreground",
          typeof displayValue === "string" ? undefined : "flex justify-end",
        )}
      >
        {displayValue}
      </span>
    </div>
  );
}

function buildServiceColumns(t: Translations, lang: Lang): ColumnDef<StaffConciergeService>[] {
  return [
    {
      id: "title",
      label: t.staff_services_column_service,
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
      label: t.staff_services_column_status,
      accessor: (row) => row.status,
      filterType: "enum",
      filterOptions: ["planned", "booked", "confirmed", "in_service", "completed", "cancelled"].map(
        (value) => ({ value, label: serviceStatusLabel(value, t) }),
      ),
      width: 130,
      sortable: true,
      render: (row) => (
        <Badge variant="outline" className={cn("rounded-full", conciergeServiceStatusTone(row.status))}>
          {serviceStatusLabel(row.status, t)}
        </Badge>
      ),
    },
    {
      id: "billing_status",
      label: t.staff_services_column_billing,
      accessor: (row) => row.billing_status,
      filterType: "enum",
      filterOptions: ["draft", "ready", "billed", "settled"].map((value) => ({
        value,
        label: billingStatusLabel(value, t),
      })),
      width: 110,
      sortable: true,
      render: (row) => (
        <Badge variant="outline" className={cn("rounded-full", billingStatusTone(row.billing_status))}>
          {billingStatusLabel(row.billing_status, t)}
        </Badge>
      ),
    },
    {
      id: "patient",
      label: t.staff_services_column_patient,
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
      label: t.staff_services_column_kind,
      accessor: (row) => row.service_kind,
      filterType: "enum",
      filterOptions: ["hotel", "transfer", "vip_terminal", "flight", "chauffeur", "translation_support"].map(
        (value) => ({ value, label: serviceKindLabel(value, t) }),
      ),
      width: 140,
      sortable: true,
      render: (row) => (
        <Badge variant="outline" className="rounded-full">
          {serviceKindLabel(row.service_kind, t)}
        </Badge>
      ),
    },
    {
      id: "taxonomy",
      label: t.services_category,
      accessor: (row) => serviceTaxonomyLabel(row, lang, t.common_not_set),
      filterType: "text",
      width: 180,
      sortable: true,
      render: (row) => (
        <ServiceTaxonomyBadge
          label={serviceTaxonomyLabel(row, lang)}
          fallback={t.common_not_set}
        />
      ),
    },
    {
      id: "request_source",
      label: t.staff_services_column_source,
      accessor: (row) => row.request_source,
      filterType: "enum",
      filterOptions: ["patient_portal", "appointment_bootstrap", "care_team"].map((value) => ({
        value,
        label: serviceSourceLabel(value, t),
      })),
      width: 160,
      sortable: true,
      render: (row) => (
        <Badge variant="outline" className="rounded-full">
          {serviceSourceLabel(row.request_source, t)}
        </Badge>
      ),
    },
    {
      id: "vendor",
      label: t.staff_services_column_vendor,
      accessor: (row) => row.vendor_name,
      filterType: "text",
      width: 180,
      sortable: true,
      render: (row) => (
        <span className="truncate text-xs text-muted-foreground">
          {row.vendor_name ?? t.common_not_set}
        </span>
      ),
    },
    {
      id: "booking",
      label: t.staff_services_column_booking,
      accessor: (row) => row.booking_reference,
      filterType: "text",
      width: 140,
      sortable: true,
      render: (row) => (
        <span className="truncate font-mono text-[11px] text-muted-foreground tabular-nums">
          {row.booking_reference ?? t.common_not_set}
        </span>
      ),
    },
    {
      id: "schedule",
      label: t.staff_services_column_schedule,
      accessor: (row) => row.starts_at,
      filterType: "date",
      width: 230,
      sortable: true,
      render: (row) => {
        const start = row.starts_at ? formatPortalDateTime(row.starts_at) : null;
        const end = row.ends_at ? formatPortalDateTime(row.ends_at) : null;
        const schedule = [start, end].filter(Boolean).join(" - ");
        return (
          <span className="truncate text-xs tabular-nums text-muted-foreground">
            {schedule || t.common_not_set}
          </span>
        );
      },
    },
    {
      id: "cost",
      label: t.staff_services_column_cost,
      accessor: (row) => Number(row.actual_cost ?? row.cost_estimate ?? 0),
      filterType: "number",
      width: 110,
      sortable: true,
      render: (row) => {
        const cost = row.actual_cost ?? row.cost_estimate;
        return (
          <span className="truncate text-xs tabular-nums text-foreground">
            {cost ? formatPortalCurrency(cost) : t.common_not_set}
          </span>
        );
      },
    },
    {
      id: "concierge",
      label: t.staff_services_column_concierge,
      accessor: (row) => row.assigned_concierge_name,
      filterType: "text",
      width: 170,
      sortable: true,
      render: (row) => (
        <span className="truncate text-xs text-muted-foreground">
          {row.assigned_concierge_name ?? t.common_not_set}
        </span>
      ),
    },
  ];
}

type StaffServicesPageState = {
  items: StaffConciergeService[];
  loading: boolean;
  refreshing: boolean;
  error: string;
  version: number;
  search: string;
  mineOnly: boolean;
  taxonomyNodeId: string;
  filterPredicates: FilterPredicate[];
  sortStack: SortStack;
  density: DensityLevel;
  hiddenColumns: string[];
  frozenColumns: string[];
  selectedServiceId: string | null;
  patients: PatientOption[];
  providers: ProviderOption[];
  taxonomyNodes: ProviderTaxonomyNode[];
  conciergeStaff: StaffOption[];
  lookupError: string;
  lookupsLoading: boolean;
  createOpen: boolean;
  createBusy: boolean;
  createError: string;
  createForm: CreateServiceFormState;
  editMode: boolean;
  editBusy: boolean;
  editError: string;
  editForm: EditServiceFormState | null;
};

type StaffServicesPageAction =
  | { type: "patch"; value: Partial<StaffServicesPageState> }
  | { type: "update"; updater: (state: StaffServicesPageState) => StaffServicesPageState }
  | { type: "bump-version" }
  | { type: "lookups-start" }
  | {
      type: "lookups-success";
      patients: PatientOption[];
      providers: ProviderOption[];
      taxonomyNodes: ProviderTaxonomyNode[];
      conciergeStaff: StaffOption[];
    }
  | { type: "lookups-error"; message: string }
  | { type: "services-load-start" }
  | { type: "services-load-success"; items: StaffConciergeService[] }
  | { type: "services-load-error"; message: string }
  | {
      type: "create-success";
      created: StaffConciergeService;
      defaultConciergeId: string;
    }
  | { type: "update-success"; updated: StaffConciergeService };

const STAFF_SERVICES_INITIAL_STATE: StaffServicesPageState = {
  items: [],
  loading: true,
  refreshing: false,
  error: "",
  version: 0,
  search: "",
  mineOnly: false,
  taxonomyNodeId: "",
  filterPredicates: [],
  sortStack: [{ field: "schedule", dir: "desc" }],
  density: "compact",
  hiddenColumns: [],
  frozenColumns: DEFAULT_FROZEN_COLUMNS,
  selectedServiceId: null,
  patients: [],
  providers: [],
  taxonomyNodes: [],
  conciergeStaff: [],
  lookupError: "",
  lookupsLoading: false,
  createOpen: false,
  createBusy: false,
  createError: "",
  createForm: blankCreateServiceForm(),
  editMode: false,
  editBusy: false,
  editError: "",
  editForm: null,
};

function staffServicesPageReducer(
  state: StaffServicesPageState,
  action: StaffServicesPageAction,
): StaffServicesPageState {
  switch (action.type) {
    case "patch":
      return { ...state, ...action.value };
    case "update":
      return action.updater(state);
    case "bump-version":
      return { ...state, version: state.version + 1 };
    case "lookups-start":
      return { ...state, lookupsLoading: true };
    case "lookups-success":
      return {
        ...state,
        patients: action.patients,
        providers: action.providers,
        taxonomyNodes: action.taxonomyNodes,
        conciergeStaff: action.conciergeStaff,
        lookupError: "",
        lookupsLoading: false,
      };
    case "lookups-error":
      return {
        ...state,
        lookupError: action.message,
        lookupsLoading: false,
      };
    case "services-load-start":
      return { ...state, refreshing: !state.loading };
    case "services-load-success":
      return {
        ...state,
        items: action.items,
        selectedServiceId:
          state.selectedServiceId && action.items.some((item) => item.id === state.selectedServiceId)
            ? state.selectedServiceId
            : null,
        error: "",
        loading: false,
        refreshing: false,
      };
    case "services-load-error":
      return {
        ...state,
        error: action.message,
        loading: false,
        refreshing: false,
      };
    case "create-success":
      return {
        ...state,
        items: [
          action.created,
          ...state.items.filter((item) => item.id !== action.created.id),
        ],
        createForm: blankCreateServiceForm(action.defaultConciergeId),
        createOpen: false,
        version: state.version + 1,
      };
    case "update-success":
      return {
        ...state,
        items: state.items.map((item) =>
          item.id === action.updated.id ? action.updated : item,
        ),
        selectedServiceId: action.updated.id,
        editMode: false,
        editBusy: false,
        editError: "",
        editForm: null,
        version: state.version + 1,
      };
    default:
      return state;
  }
}

function createStaffServicesFieldAction<K extends keyof StaffServicesPageState>(
  field: K,
  value: SetStateAction<StaffServicesPageState[K]>,
): StaffServicesPageAction {
  return {
    type: "update",
    updater: (state) => {
      const currentValue = state[field];
      const nextValue =
        typeof value === "function"
          ? (value as (current: StaffServicesPageState[K]) => StaffServicesPageState[K])(
              currentValue,
            )
          : value;

      if (Object.is(currentValue, nextValue)) return state;
      return { ...state, [field]: nextValue };
    },
  };
}

function useStaffServicesPageContent() {
  const { lang, t } = useLang();
  const { user } = useAuth();
  const [
    {
      items,
      loading,
      refreshing,
      error,
      version,
      search,
      mineOnly,
      taxonomyNodeId,
      filterPredicates,
      sortStack,
      density,
      hiddenColumns,
      frozenColumns,
      selectedServiceId,
      patients,
      providers,
      taxonomyNodes,
      conciergeStaff,
      lookupError,
      lookupsLoading,
      createOpen,
      createBusy,
      createError,
      createForm,
      editMode,
      editBusy,
      editError,
      editForm,
    },
    dispatchStaffServicesState,
  ] = useReducer(staffServicesPageReducer, STAFF_SERVICES_INITIAL_STATE);
  const setStaffServicesField = <K extends keyof StaffServicesPageState>(
    field: K,
    value: SetStateAction<StaffServicesPageState[K]>,
  ) => dispatchStaffServicesState(createStaffServicesFieldAction(field, value));
  const setSearch = (value: SetStateAction<string>) =>
    setStaffServicesField("search", value);
  const setMineOnly = (value: SetStateAction<boolean>) =>
    setStaffServicesField("mineOnly", value);
  const setTaxonomyNodeId = (value: SetStateAction<string>) =>
    setStaffServicesField("taxonomyNodeId", value);
  const setFilterPredicates = (value: SetStateAction<FilterPredicate[]>) =>
    setStaffServicesField("filterPredicates", value);
  const setSortStack = (value: SetStateAction<SortStack>) =>
    setStaffServicesField("sortStack", value);
  const setDensity = (value: SetStateAction<DensityLevel>) =>
    setStaffServicesField("density", value);
  const setHiddenColumns = (value: SetStateAction<string[]>) =>
    setStaffServicesField("hiddenColumns", value);
  const setFrozenColumns = (value: SetStateAction<string[]>) =>
    setStaffServicesField("frozenColumns", value);
  const setSelectedServiceId = (value: SetStateAction<string | null>) =>
    setStaffServicesField("selectedServiceId", value);
  const setCreateOpen = (value: SetStateAction<boolean>) =>
    setStaffServicesField("createOpen", value);
  const setCreateBusy = (value: SetStateAction<boolean>) =>
    setStaffServicesField("createBusy", value);
  const setCreateError = (value: SetStateAction<string>) =>
    setStaffServicesField("createError", value);
  const setCreateForm = (value: SetStateAction<CreateServiceFormState>) =>
    setStaffServicesField("createForm", value);
  const setEditMode = (value: SetStateAction<boolean>) =>
    setStaffServicesField("editMode", value);
  const setEditBusy = (value: SetStateAction<boolean>) =>
    setStaffServicesField("editBusy", value);
  const setEditError = (value: SetStateAction<string>) =>
    setStaffServicesField("editError", value);
  const setEditForm = (value: SetStateAction<EditServiceFormState | null>) =>
    setStaffServicesField("editForm", value);
  const [providerServices, setProviderServices] = useState<ServiceItem[]>([]);
  const [providerServicesLoading, setProviderServicesLoading] = useState(false);
  const [providerServicesError, setProviderServicesError] = useState("");
  const [editProviderServices, setEditProviderServices] = useState<ServiceItem[]>([]);
  const [editProviderServicesLoading, setEditProviderServicesLoading] = useState(false);
  const [editProviderServicesError, setEditProviderServicesError] = useState("");

  const canCreateService =
    user?.role === "ceo" ||
    user?.role === "patient_manager" ||
    user?.role === "concierge";
  const canEditService = canCreateService;

  useDebouncedRealtimeSubscription(STAFF_SERVICES_REALTIME_EVENTS, () => {
    clearApiCache("/concierge-services");
    dispatchStaffServicesState({ type: "bump-version" });
  }, 250);

  const baseColumns = useMemo(() => buildServiceColumns(t, lang), [lang, t]);
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
  const selectedService = useMemo(
    () => items.find((item) => item.id === selectedServiceId) ?? null,
    [items, selectedServiceId],
  );
  const selectedProviderService = useMemo(
    () =>
      providerServices.find((service) => service.id === createForm.providerServiceId) ??
      null,
    [createForm.providerServiceId, providerServices],
  );
  const selectedProviderServiceUnitPrice = useMemo(
    () => providerServiceUnitPrice(selectedProviderService),
    [selectedProviderService],
  );
  const selectedProviderServiceTotal = useMemo(
    () => calculatedServiceTotal(selectedProviderService, createForm.quantity),
    [createForm.quantity, selectedProviderService],
  );
  const selectedEditProviderService = useMemo(
    () =>
      editProviderServices.find((service) => service.id === editForm?.providerServiceId) ??
      null,
    [editForm?.providerServiceId, editProviderServices],
  );
  const selectedEditProviderServiceUnitPrice = useMemo(
    () => providerServiceUnitPrice(selectedEditProviderService),
    [selectedEditProviderService],
  );
  const selectedEditProviderServiceTotal = useMemo(
    () =>
      editForm
        ? calculatedServiceTotal(selectedEditProviderService, editForm.quantity)
        : null,
    [editForm, selectedEditProviderService],
  );

  const lastAutoTitleRef = useRef<string>("");

  const handleServiceKindChange = (nextKind: string) => {
    const nextAutoTitle = serviceKindLabel(nextKind, t);
    const previousAutoTitle = lastAutoTitleRef.current;
    setCreateForm((current) => {
      const userEditedTitle =
        current.title.trim().length > 0 && current.title !== previousAutoTitle;
      const nextTitle = userEditedTitle ? current.title : nextAutoTitle;
      return { ...current, serviceKind: nextKind, title: nextTitle };
    });
    lastAutoTitleRef.current = nextAutoTitle;
  };

  const openCreateSheet = useCallback(() => {
    setCreateError("");
    setCreateForm(blankCreateServiceForm(defaultConciergeId));
    lastAutoTitleRef.current = "";
    setCreateOpen(true);
  }, [defaultConciergeId]);

  const closeCreateSheet = useCallback(() => {
    setCreateOpen(false);
    setCreateError("");
    setCreateBusy(false);
    setCreateForm(blankCreateServiceForm(defaultConciergeId));
    lastAutoTitleRef.current = "";
  }, [defaultConciergeId]);

  const openServiceDetail = useCallback((service: StaffConciergeService) => {
    setSelectedServiceId(service.id);
    setEditMode(false);
    setEditError("");
    setEditBusy(false);
    setEditForm(null);
  }, []);

  const closeServiceDetail = useCallback(() => {
    setSelectedServiceId(null);
    setEditMode(false);
    setEditError("");
    setEditBusy(false);
    setEditForm(null);
  }, []);

  const openEditService = useCallback(() => {
    if (!selectedService) return;
    setEditError("");
    setEditForm(buildEditServiceForm(selectedService));
    setEditMode(true);
  }, [selectedService]);

  const closeEditService = useCallback(() => {
    setEditMode(false);
    setEditError("");
    setEditBusy(false);
    setEditForm(null);
  }, []);

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
    let cancelled = false;

    async function loadLookups() {
      dispatchStaffServicesState({ type: "lookups-start" });
      try {
        const [patientRows, providerRows, staffRows, taxonomy] = await Promise.all([
          canCreateService
            ? apiFetch<PatientOption[]>("/patients?active_only=true", {
                cacheTtlMs: SERVICE_LOOKUPS_CACHE_TTL_MS,
              })
            : Promise.resolve([]),
          canCreateService
            ? apiFetch<ProviderOption[]>("/providers?provider_type=non_medical&active_only=true", {
                cacheTtlMs: SERVICE_LOOKUPS_CACHE_TTL_MS,
              })
            : Promise.resolve([]),
          canCreateService
            ? apiFetch<StaffOption[]>("/appointments/meta/staff", {
                cacheTtlMs: SERVICE_LOOKUPS_CACHE_TTL_MS,
              })
            : Promise.resolve([]),
          fetchProviderTaxonomy("non_medical"),
        ]);
        if (cancelled) return;
        dispatchStaffServicesState({
          type: "lookups-success",
          patients: patientRows,
          providers: providerRows.filter((provider) => provider.provider_type === "non_medical"),
          taxonomyNodes: taxonomy.nodes.filter((node) => node.is_active),
          conciergeStaff: staffRows.filter((member) => member.role === "concierge"),
        });
      } catch (err) {
        if (cancelled) return;
        dispatchStaffServicesState({
          type: "lookups-error",
          message:
            err instanceof Error
              ? err.message
              : t.staff_services_lookup_failed,
        });
      }
    }

    void loadLookups();
    return () => {
      cancelled = true;
    };
  }, [canCreateService, t]);

  useEffect(() => {
    let cancelled = false;

    if (!createOpen || !createForm.providerId) {
      setProviderServices([]);
      setProviderServicesError("");
      setProviderServicesLoading(false);
      dispatchStaffServicesState({
        type: "update",
        updater: (state) =>
          state.createForm.providerServiceId
            ? {
                ...state,
                createForm: {
                  ...state.createForm,
                  providerServiceId: "",
                },
              }
            : state,
      });
      return () => {
        cancelled = true;
      };
    }

    setProviderServicesLoading(true);
    setProviderServicesError("");
    fetchProviderDetail(createForm.providerId)
      .then((provider) => {
        if (cancelled) return;
        setProviderServices(provider.services);
        dispatchStaffServicesState({
          type: "update",
          updater: (state) => {
            if (
              !state.createForm.providerServiceId ||
              provider.services.some((service) => service.id === state.createForm.providerServiceId)
            ) {
              return state;
            }
            return {
              ...state,
              createForm: {
                ...state.createForm,
                providerServiceId: "",
              },
            };
          },
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setProviderServices([]);
        setProviderServicesError(
          err instanceof Error ? err.message : t.staff_services_lookup_failed,
        );
      })
      .finally(() => {
        if (!cancelled) setProviderServicesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [createForm.providerId, createOpen, t.staff_services_lookup_failed]);

  useEffect(() => {
    let cancelled = false;

    if (!editMode || !editForm?.providerId) {
      setEditProviderServices([]);
      setEditProviderServicesError("");
      setEditProviderServicesLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setEditProviderServicesLoading(true);
    setEditProviderServicesError("");
    fetchProviderDetail(editForm.providerId)
      .then((provider) => {
        if (cancelled) return;
        setEditProviderServices(provider.services);
        dispatchStaffServicesState({
          type: "update",
          updater: (state) => {
            if (
              !state.editForm?.providerServiceId ||
              provider.services.some((service) => service.id === state.editForm?.providerServiceId)
            ) {
              return state;
            }
            return {
              ...state,
              editForm: {
                ...state.editForm,
                providerServiceId: "",
              },
            };
          },
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setEditProviderServices([]);
        setEditProviderServicesError(
          err instanceof Error ? err.message : t.staff_services_lookup_failed,
        );
      })
      .finally(() => {
        if (!cancelled) setEditProviderServicesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [editForm?.providerId, editMode, t.staff_services_lookup_failed]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      dispatchStaffServicesState({ type: "services-load-start" });

      try {
        const rows = await apiFetch<StaffConciergeService[]>(
          buildServicesPath({ search, mineOnly, taxonomyNodeId }),
          { cacheTtlMs: STAFF_SERVICES_CACHE_TTL_MS },
        );
        if (cancelled) return;
        startTransition(() => {
          dispatchStaffServicesState({ type: "services-load-success", items: rows });
        });
      } catch (err) {
        if (cancelled) return;
        dispatchStaffServicesState({
          type: "services-load-error",
          message:
            err instanceof Error
              ? err.message
              : t.staff_services_load_failed,
        });
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [mineOnly, search, t, taxonomyNodeId, version]);

  async function handleCreateService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateError("");

    const title = createForm.title.trim();
    if (!createForm.patientId) {
      setCreateError(t.staff_services_patient_required);
      return;
    }
    if (!title) {
      setCreateError(t.staff_services_title_required);
      return;
    }

    const quantity = integerInputValue(createForm.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setCreateError(t.staff_services_quantity_integer_required);
      return;
    }

    const calculatedCostEstimate =
      selectedProviderServiceTotal === null
        ? null
        : Number(selectedProviderServiceTotal.toFixed(2));
    const costEstimate =
      calculatedCostEstimate ?? optionalMoney(createForm.costEstimate);
    const actualCost = optionalMoney(createForm.actualCost);
    if (Number.isNaN(costEstimate) || Number.isNaN(actualCost)) {
      setCreateError(t.staff_services_cost_invalid);
      return;
    }

    const currency = createForm.currency.trim().toUpperCase() || "EUR";
    if (currency.length !== 3) {
      setCreateError(t.staff_services_currency_invalid);
      return;
    }

    setCreateBusy(true);
    try {
      const created = await apiFetch<StaffConciergeService>("/concierge-services", {
        method: "POST",
        body: JSON.stringify({
          patient_id: createForm.patientId,
          provider_id: createForm.providerId || null,
          provider_service_id: createForm.providerServiceId || null,
          taxonomy_node_id: createForm.taxonomyNodeId || null,
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
          quantity,
          unit_price: selectedProviderServiceUnitPrice,
          currency,
          service_notes: createForm.serviceNotes.trim() || null,
          billing_notes: createForm.billingNotes.trim() || null,
        }),
      });
      clearApiCache("/concierge-services");
      dispatchStaffServicesState({
        type: "create-success",
        created,
        defaultConciergeId,
      });
    } catch (err) {
      setCreateError(
        err instanceof Error
          ? err.message
          : t.staff_services_create_failed,
      );
    } finally {
      setCreateBusy(false);
    }
  }

  async function handleEditServiceSave() {
    if (!selectedService || !editForm) return;
    setEditError("");

    const title = editForm.title.trim();
    if (!title) {
      setEditError(t.staff_services_title_required);
      return;
    }

    const quantity = integerInputValue(editForm.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setEditError(t.staff_services_quantity_integer_required);
      return;
    }

    const calculatedCostEstimate =
      selectedEditProviderServiceTotal === null
        ? null
        : Number(selectedEditProviderServiceTotal.toFixed(2));
    const costEstimate =
      calculatedCostEstimate ?? optionalMoney(editForm.costEstimate);
    const actualCost = optionalMoney(editForm.actualCost);
    if (Number.isNaN(costEstimate) || Number.isNaN(actualCost)) {
      setEditError(t.staff_services_cost_invalid);
      return;
    }

    const currency = editForm.currency.trim().toUpperCase() || "EUR";
    if (currency.length !== 3) {
      setEditError(t.staff_services_currency_invalid);
      return;
    }

    setEditBusy(true);
    try {
      const updated = await apiFetch<StaffConciergeService>(
        `/concierge-services/${selectedService.id}/update`,
        {
          method: "POST",
          body: JSON.stringify({
            provider_id: editForm.providerId || null,
            provider_service_id: editForm.providerServiceId || null,
            taxonomy_node_id: editForm.taxonomyNodeId || null,
            assigned_concierge_id: editForm.assignedConciergeId || null,
            service_kind: editForm.serviceKind,
            title,
            status: editForm.status,
            billing_status: editForm.billingStatus,
            booking_reference: editForm.bookingReference.trim() || null,
            vendor_name: editForm.vendorName.trim() || null,
            vendor_contact: editForm.vendorContact.trim() || null,
            starts_at: editForm.startsAt ? toRfc3339(editForm.startsAt) : null,
            ends_at: editForm.endsAt ? toRfc3339(editForm.endsAt) : null,
            cost_estimate: costEstimate,
            actual_cost: actualCost,
            quantity,
            unit_price: selectedEditProviderServiceUnitPrice,
            currency,
            service_notes: editForm.serviceNotes.trim() || null,
            billing_notes: editForm.billingNotes.trim() || null,
          }),
        },
      );
      clearApiCache("/concierge-services");
      dispatchStaffServicesState({ type: "update-success", updated });
    } catch (err) {
      setEditError(err instanceof Error ? err.message : t.common_failed_update);
    } finally {
      setEditBusy(false);
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
    }),
    [t],
  );

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex items-center gap-3 rounded-full border border-zinc-200 bg-white px-5 py-3 text-sm text-zinc-500 shadow-sm">
          <LoaderCircle className="size-4 animate-spin" />
          {t.staff_services_loading}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t.staff_services_title}
        actions={
          canCreateService ? (
            <Button
              type="button"
              size="sm"
              onClick={openCreateSheet}
              disabled={lookupsLoading && patients.length === 0}
            >
              <Plus className="size-3.5" />
              {t.staff_services_add_service}
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

      <div className="grid grid-flow-col auto-cols-fr overflow-hidden rounded-xl border border-border px-3 pb-3 pt-4 [&>article:not(:last-child)_.admin-inline-metric-separator]:xl:block">
        <AdminInlineMetric icon={Activity} label={t.staff_services_stat_active} value={activeCount} />
        <AdminInlineMetric icon={Wallet} label={t.staff_services_stat_billing_ready} value={readyForBillingCount} />
        <AdminInlineMetric icon={ClipboardList} label={t.staff_services_stat_portal_requests} value={portalRequestCount} />
      </div>

      <div className="relative z-30 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t.staff_services_search_placeholder}
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
            {t.staff_services_mine}
          </label>

          <ProviderTaxonomyCascadeSelect
            value={taxonomyNodeId}
            nodes={taxonomyNodes}
            providerType="non_medical"
            mode="any"
            placeholder={t.services_category}
            allLabel={t.services_all_categories}
            containerClassName="shrink-0"
            selectClassName="h-8 w-auto min-w-[180px] rounded-lg bg-background text-[13px]"
            disabled={lookupsLoading && taxonomyNodes.length === 0}
            aria-label={t.services_category}
            onChange={setTaxonomyNodeId}
          />

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
              title={t.common_refresh}
              aria-label={t.common_refresh}
                onClick={() => dispatchStaffServicesState({ type: "bump-version" })}
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
              addFilter: t.table_filter,
              clearAll: t.common_clear,
              searchPlaceholder: t.table_filter_search_fields,
              noFields: t.table_filter_no_fields,
              remove: t.table_filter_remove,
              valuePlaceholder: t.common_value,
              yes: t.common_yes,
              no: t.common_no,
              operatorLabels,
            }}
          />

          <SortBuilder
            columns={columns}
            value={sortStack}
            onChange={setSortStack}
            translations={{
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
          </div>
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyCell>
          {t.staff_services_empty}
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
          activeRowId={selectedServiceId}
          onRowClick={openServiceDetail}
          className="min-h-[480px]"
        />
      )}

      <Sheet open={Boolean(selectedService)} onOpenChange={(open) => (!open ? closeServiceDetail() : undefined)}>
        <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-[720px]">
          {selectedService ? (
            <AdminSheetScaffold
              title={selectedService.title}
              description={`${selectedService.patient_name} · ${serviceKindLabel(selectedService.service_kind, t)}`}
              bodyClassName="space-y-4 px-5 py-4"
              footer={
                editMode && editForm ? (
                  <SheetFormFooter
                    cancelLabel={t.common_cancel}
                    submitLabel={t.common_save}
                    submittingLabel={t.common_save}
                    submitting={editBusy}
                    submitDisabled={editBusy || editProviderServicesLoading}
                    onCancel={closeEditService}
                    onSubmit={handleEditServiceSave}
                  />
                ) : undefined
              }
            >
              {editError ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {editError}
                </div>
              ) : null}
              {editMode && editForm ? (
                <>
                  <Section title={t.staff_services_create_section_service}>
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="space-y-1.5 text-sm">
                        <span className="text-xs font-medium text-muted-foreground">
                          {t.services_form_service_type}
                        </span>
                        <NativeComboboxSelect
                          value={editForm.serviceKind}
                          onChange={(event) =>
                            setEditForm((current) =>
                              current
                                ? { ...current, serviceKind: event.target.value }
                                : current,
                            )
                          }
                          className={formSelectClassName}
                        >
                          {SERVICE_KIND_OPTIONS.map((kind) => (
                            <option key={kind} value={kind}>
                              {serviceKindLabel(kind, t)}
                            </option>
                          ))}
                        </NativeComboboxSelect>
                      </label>
                      <label className="space-y-1.5 text-sm">
                        <span className="text-xs font-medium text-muted-foreground">
                          {t.staff_services_column_status}
                        </span>
                        <NativeComboboxSelect
                          value={editForm.status}
                          onChange={(event) =>
                            setEditForm((current) =>
                              current ? { ...current, status: event.target.value } : current,
                            )
                          }
                          className={formSelectClassName}
                        >
                          {["planned", "booked", "confirmed", "in_service", "completed", "cancelled"].map((status) => (
                            <option key={status} value={status}>
                              {serviceStatusLabel(status, t)}
                            </option>
                          ))}
                        </NativeComboboxSelect>
                      </label>
                      <label className="space-y-1.5 text-sm md:col-span-2">
                        <span className="text-xs font-medium text-muted-foreground">
                          {t.staff_services_form_title}
                        </span>
                        <Input
                          value={editForm.title}
                          onChange={(event) =>
                            setEditForm((current) =>
                              current ? { ...current, title: event.target.value } : current,
                            )
                          }
                          className={formInputClassName}
                          required
                        />
                      </label>
                    </div>
                  </Section>

                  <Section title={t.staff_services_create_section_assignment}>
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="space-y-1.5 text-sm md:col-span-2">
                        <span className="text-xs font-medium text-muted-foreground">
                          {t.staff_services_form_provider}
                        </span>
                        <ProviderSelectWithTaxonomyFilter
                          value={editForm.providerId}
                          providers={providers}
                          taxonomyNodes={taxonomyNodes}
                          providerType="non_medical"
                          taxonomyValue={editForm.taxonomyNodeId}
                          taxonomyMode="leaf"
                          providerPlaceholder={t.staff_services_optional}
                          taxonomyPlaceholder={t.services_category}
                          taxonomyAllLabel={t.services_category}
                          containerClassName={providerPickerContainerClassName}
                          taxonomySelectClassName={formSelectClassName}
                          providerSelectClassName={formSelectClassName}
                          providerLabel={(provider) => providerOptionLabel(provider, lang)}
                          onTaxonomyChange={(taxonomyNodeId) =>
                            setEditForm((current) =>
                              current ? { ...current, taxonomyNodeId } : current,
                            )
                          }
                          onChange={(providerId) =>
                            setEditForm((current) =>
                              current
                                ? { ...current, providerId, providerServiceId: "" }
                                : current,
                            )
                          }
                        />
                      </label>
                      <label className="space-y-1.5 text-sm">
                        <span className="text-xs font-medium text-muted-foreground">
                          {t.staff_services_form_concierge}
                        </span>
                        <NativeComboboxSelect
                          value={editForm.assignedConciergeId}
                          onChange={(event) =>
                            setEditForm((current) =>
                              current
                                ? { ...current, assignedConciergeId: event.target.value }
                                : current,
                            )
                          }
                          className={formSelectClassName}
                        >
                          <option value="">{t.staff_services_unassigned}</option>
                          {conciergeStaff.map((member) => (
                            <option key={member.id} value={member.id}>
                              {member.name}
                            </option>
                          ))}
                        </NativeComboboxSelect>
                      </label>
                    </div>
                  </Section>

                  <Section title={t.staff_services_create_section_schedule}>
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="space-y-1.5 text-sm">
                        <span className="text-xs font-medium text-muted-foreground">
                          {t.staff_services_form_start}
                        </span>
                        <Input
                          type="datetime-local"
                          value={editForm.startsAt}
                          onChange={(event) =>
                            setEditForm((current) =>
                              current ? { ...current, startsAt: event.target.value } : current,
                            )
                          }
                          className={formInputClassName}
                        />
                      </label>
                      <label className="space-y-1.5 text-sm">
                        <span className="text-xs font-medium text-muted-foreground">
                          {t.staff_services_form_end}
                        </span>
                        <Input
                          type="datetime-local"
                          value={editForm.endsAt}
                          onChange={(event) =>
                            setEditForm((current) =>
                              current ? { ...current, endsAt: event.target.value } : current,
                            )
                          }
                          className={formInputClassName}
                        />
                      </label>
                    </div>
                  </Section>

                  <Section title={t.staff_services_create_section_finance}>
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="space-y-1.5 text-sm md:col-span-2">
                        <span className="text-xs font-medium text-muted-foreground">
                          {t.providers_services}
                        </span>
                        <NativeComboboxSelect
                          value={editForm.providerServiceId}
                          onChange={(event) => {
                            const providerServiceId = event.target.value;
                            const service =
                              editProviderServices.find((item) => item.id === providerServiceId) ??
                              null;
                            const nextTotal = calculatedServiceTotal(
                              service,
                              editForm.quantity,
                            );
                            setEditForm((current) =>
                              current
                                ? {
                                    ...current,
                                    providerServiceId,
                                    title:
                                      !current.title.trim() && service
                                        ? service.service_name
                                        : current.title,
                                    costEstimate:
                                      nextTotal === null
                                        ? current.costEstimate
                                        : formatMoneyInput(nextTotal),
                                    currency: service?.currency ?? current.currency,
                                  }
                                : current,
                            );
                          }}
                          className={formSelectClassName}
                          disabled={!editForm.providerId || editProviderServicesLoading}
                        >
                          <option value="">
                            {editProviderServicesLoading
                              ? t.common_loading
                              : t.staff_services_optional}
                          </option>
                          {editProviderServices.map((service) => (
                            <option key={service.id} value={service.id}>
                              {providerServiceOptionLabel(service)}
                            </option>
                          ))}
                        </NativeComboboxSelect>
                      </label>
                      <label className="space-y-1.5 text-sm">
                        <span className="text-xs font-medium text-muted-foreground">
                          {t.invoices_workspace_quantity}
                        </span>
                        <Input
                          type="number"
                          min="1"
                          step="1"
                          inputMode="numeric"
                          value={editForm.quantity}
                          onChange={(event) => {
                            const quantity = event.target.value;
                            if (!/^\d*$/.test(quantity)) return;
                            const nextTotal = calculatedServiceTotal(
                              selectedEditProviderService,
                              quantity,
                            );
                            setEditForm((current) =>
                              current
                                ? {
                                    ...current,
                                    quantity,
                                    costEstimate:
                                      nextTotal === null
                                        ? current.costEstimate
                                        : formatMoneyInput(nextTotal),
                                  }
                                : current,
                            );
                          }}
                          className={formInputClassName}
                        />
                      </label>
                      <label className="space-y-1.5 text-sm">
                        <span className="text-xs font-medium text-muted-foreground">
                          {t.providers_service_price}
                        </span>
                        <Input
                          readOnly
                          value={
                            selectedEditProviderServiceUnitPrice === null
                              ? selectedService.unit_price
                                ? formatMoneyInput(Number(selectedService.unit_price))
                                : ""
                              : formatMoneyInput(selectedEditProviderServiceUnitPrice)
                          }
                          className={formInputClassName}
                        />
                      </label>
                      <label className="space-y-1.5 text-sm">
                        <span className="text-xs font-medium text-muted-foreground">
                          {t.staff_services_form_cost_estimate}
                        </span>
                        <Input
                          inputMode="decimal"
                          readOnly={selectedEditProviderServiceTotal !== null}
                          value={editForm.costEstimate}
                          onChange={(event) =>
                            setEditForm((current) =>
                              current
                                ? { ...current, costEstimate: event.target.value }
                                : current,
                            )
                          }
                          className={formInputClassName}
                        />
                      </label>
                      <label className="space-y-1.5 text-sm">
                        <span className="text-xs font-medium text-muted-foreground">
                          {t.staff_services_form_actual_cost}
                        </span>
                        <Input
                          inputMode="decimal"
                          value={editForm.actualCost}
                          onChange={(event) =>
                            setEditForm((current) =>
                              current
                                ? { ...current, actualCost: event.target.value }
                                : current,
                            )
                          }
                          className={formInputClassName}
                        />
                      </label>
                      <label className="space-y-1.5 text-sm">
                        <span className="text-xs font-medium text-muted-foreground">
                          {t.staff_services_form_currency}
                        </span>
                        <Input
                          value={editForm.currency}
                          onChange={(event) =>
                            setEditForm((current) =>
                              current ? { ...current, currency: event.target.value } : current,
                            )
                          }
                          className={formInputClassName}
                          maxLength={3}
                        />
                      </label>
                      <label className="space-y-1.5 text-sm">
                        <span className="text-xs font-medium text-muted-foreground">
                          {t.staff_services_column_billing}
                        </span>
                        <NativeComboboxSelect
                          value={editForm.billingStatus}
                          onChange={(event) =>
                            setEditForm((current) =>
                              current
                                ? { ...current, billingStatus: event.target.value }
                                : current,
                            )
                          }
                          className={formSelectClassName}
                        >
                          {["draft", "ready", "billed", "settled", "waived"].map((status) => (
                            <option key={status} value={status}>
                              {billingStatusLabel(status, t)}
                            </option>
                          ))}
                        </NativeComboboxSelect>
                      </label>
                    </div>
                    {editProviderServicesError ? (
                      <p className="mt-2 text-xs text-rose-600">{editProviderServicesError}</p>
                    ) : null}
                  </Section>

                  <Section title={t.staff_services_create_section_vendor_notes}>
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="space-y-1.5 text-sm">
                        <span className="text-xs font-medium text-muted-foreground">
                          {t.staff_services_form_booking_reference}
                        </span>
                        <Input
                          value={editForm.bookingReference}
                          onChange={(event) =>
                            setEditForm((current) =>
                              current
                                ? { ...current, bookingReference: event.target.value }
                                : current,
                            )
                          }
                          className={formInputClassName}
                        />
                      </label>
                      <label className="space-y-1.5 text-sm">
                        <span className="text-xs font-medium text-muted-foreground">
                          {t.staff_services_form_vendor}
                        </span>
                        <Input
                          value={editForm.vendorName}
                          onChange={(event) =>
                            setEditForm((current) =>
                              current ? { ...current, vendorName: event.target.value } : current,
                            )
                          }
                          className={formInputClassName}
                        />
                      </label>
                      <label className="space-y-1.5 text-sm md:col-span-2">
                        <span className="text-xs font-medium text-muted-foreground">
                          {t.staff_services_form_vendor_contact}
                        </span>
                        <Input
                          value={editForm.vendorContact}
                          onChange={(event) =>
                            setEditForm((current) =>
                              current
                                ? { ...current, vendorContact: event.target.value }
                                : current,
                            )
                          }
                          className={formInputClassName}
                        />
                      </label>
                      <label className="space-y-1.5 text-sm">
                        <span className="text-xs font-medium text-muted-foreground">
                          {t.staff_services_form_service_notes}
                        </span>
                        <textarea
                          value={editForm.serviceNotes}
                          onChange={(event) =>
                            setEditForm((current) =>
                              current
                                ? { ...current, serviceNotes: event.target.value }
                                : current,
                            )
                          }
                          className={formTextareaClassName}
                          rows={4}
                        />
                      </label>
                      <label className="space-y-1.5 text-sm">
                        <span className="text-xs font-medium text-muted-foreground">
                          {t.staff_services_form_billing_notes}
                        </span>
                        <textarea
                          value={editForm.billingNotes}
                          onChange={(event) =>
                            setEditForm((current) =>
                              current
                                ? { ...current, billingNotes: event.target.value }
                                : current,
                            )
                          }
                          className={formTextareaClassName}
                          rows={4}
                        />
                      </label>
                    </div>
                  </Section>
                </>
              ) : (
                <>
                  {canEditService ? (
                    <div className="flex justify-end">
                      <Button type="button" size="sm" variant="outline" onClick={openEditService}>
                        <Pencil className="size-3.5" />
                        {t.common_edit}
                      </Button>
                    </div>
                  ) : null}
                  <Section title={t.staff_services_create_section_service}>
                    <div className="grid gap-2 md:grid-cols-2">
                      <ServiceMiniMetric label={t.staff_services_column_status} value={serviceStatusLabel(selectedService.status, t)} />
                      <ServiceMiniMetric label={t.staff_services_column_billing} value={billingStatusLabel(selectedService.billing_status, t)} />
                      <ServiceMiniMetric label={t.staff_services_column_patient} value={`${selectedService.patient_name} (${selectedService.patient_pid})`} />
                      <ServiceMiniMetric label={t.staff_services_column_source} value={serviceSourceLabel(selectedService.request_source, t)} />
                      <ServiceMiniMetric
                        label={t.services_category}
                        value={
                          <ServiceTaxonomyBadge
                            label={serviceTaxonomyLabel(selectedService, lang)}
                            fallback={t.common_not_set}
                          />
                        }
                      />
                    </div>
                  </Section>

                  <Section title={t.staff_services_create_section_schedule}>
                    <div className="grid gap-1.5">
                      <ServiceDetailField label={t.staff_services_form_start} value={selectedService.starts_at ? formatPortalDateTime(selectedService.starts_at) : null} />
                      <ServiceDetailField label={t.staff_services_form_end} value={selectedService.ends_at ? formatPortalDateTime(selectedService.ends_at) : null} />
                    </div>
                  </Section>

                  <Section title={t.staff_services_create_section_assignment}>
                    <div className="grid gap-1.5">
                      <ServiceDetailField label={t.staff_services_form_provider} value={selectedService.provider_name} />
                      <ServiceDetailField label={t.staff_services_form_concierge} value={selectedService.assigned_concierge_name} />
                    </div>
                  </Section>

                  <Section title={t.staff_services_create_section_finance}>
                    <div className="grid gap-2 md:grid-cols-3">
                      <ServiceMiniMetric label={t.providers_services} value={selectedService.provider_service_name} />
                      <ServiceMiniMetric label={t.invoices_workspace_quantity} value={selectedService.quantity} />
                      <ServiceMiniMetric label={t.providers_service_price} value={selectedService.unit_price ? formatPortalCurrency(selectedService.unit_price) : null} />
                      <ServiceMiniMetric label={t.staff_services_form_cost_estimate} value={selectedService.cost_estimate ? formatPortalCurrency(selectedService.cost_estimate) : null} />
                      <ServiceMiniMetric label={t.staff_services_form_actual_cost} value={selectedService.actual_cost ? formatPortalCurrency(selectedService.actual_cost) : null} />
                      <ServiceMiniMetric label={t.staff_services_form_currency} value={selectedService.currency} />
                    </div>
                  </Section>

                  <Section title={t.staff_services_create_section_vendor_notes}>
                    <div className="grid gap-1.5">
                      <ServiceDetailField label={t.staff_services_form_booking_reference} value={selectedService.booking_reference} />
                      <ServiceDetailField label={t.staff_services_form_vendor} value={selectedService.vendor_name} />
                      <ServiceDetailField label={t.staff_services_form_vendor_contact} value={selectedService.vendor_contact} />
                      <ServiceDetailField label={t.staff_services_form_service_notes} value={selectedService.service_notes} multiline />
                      <ServiceDetailField label={t.staff_services_form_billing_notes} value={selectedService.billing_notes} multiline />
                    </div>
                  </Section>
                </>
              )}
            </AdminSheetScaffold>
          ) : null}
        </SheetContent>
      </Sheet>

      <Sheet open={createOpen} onOpenChange={(open) => (open ? setCreateOpen(true) : closeCreateSheet())}>
        <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-[760px]">
          <form onSubmit={handleCreateService} className="flex h-full min-h-0 flex-col">
            <AdminSheetScaffold
              title={t.staff_services_create_title}
              description={
                selectedPatient
                  ? patientOptionLabel(selectedPatient)
                  : t.staff_services_create_description
              }
              bodyClassName="space-y-4 px-5 py-4"
              footer={
                <SheetFormFooter
                  cancelLabel={t.common_cancel}
                  submitLabel={t.common_save}
                  submittingLabel={t.common_save}
                  submitting={createBusy}
                  submitDisabled={createBusy || lookupsLoading}
                  onCancel={closeCreateSheet}
                />
              }
            >
              <div className="space-y-4 rounded-xl">
                {createError ? (
                  <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    {createError}
                  </div>
                ) : null}

                <Section title={t.staff_services_create_section_service}>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="space-y-1.5 text-sm">
                      <span className="text-xs font-medium text-muted-foreground">
                        {t.staff_services_form_patient}
                      </span>
                      <NativeComboboxSelect
                        required
                        value={createForm.patientId}
                        onChange={(event) =>
                          setCreateForm((current) => ({ ...current, patientId: event.target.value }))
                        }
                        className={formSelectClassName}
                      >
                        <option value="">{t.staff_services_select}</option>
                        {patients.map((patient) => (
                          <option key={patient.id} value={patient.id}>
                            {patientOptionLabel(patient)}
                          </option>
                        ))}
                      </NativeComboboxSelect>
                    </label>

                    <label className="space-y-1.5 text-sm">
                      <span className="text-xs font-medium text-muted-foreground">
                        {t.staff_services_form_kind}
                      </span>
                      <NativeComboboxSelect
                        value={createForm.serviceKind}
                        onChange={(event) => handleServiceKindChange(event.target.value)}
                        className={formSelectClassName}
                      >
                        {SERVICE_KIND_OPTIONS.map((kind) => (
                          <option key={kind} value={kind}>
                            {serviceKindLabel(kind, t)}
                          </option>
                        ))}
                      </NativeComboboxSelect>
                    </label>
                  </div>

                  <label className="block space-y-1.5 text-sm">
                    <span className="text-xs font-medium text-muted-foreground">
                      {t.staff_services_form_title}
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
                </Section>

                <Section title={t.staff_services_create_section_assignment}>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="space-y-1.5 text-sm">
                      <span className="text-xs font-medium text-muted-foreground">
                        {t.staff_services_form_concierge}
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
                        <option value="">{t.staff_services_unassigned}</option>
                        {conciergeStaff.map((member) => (
                          <option key={member.id} value={member.id}>
                            {member.name}
                          </option>
                        ))}
                      </NativeComboboxSelect>
                    </label>
                  </div>
                </Section>

                <Section title={t.staff_services_create_section_schedule}>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="space-y-1.5 text-sm">
                      <span className="text-xs font-medium text-muted-foreground">
                        {t.staff_services_form_start}
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
                        {t.staff_services_form_end}
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
                </Section>

                <Section title={t.staff_services_create_section_finance}>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <label className="space-y-1.5 text-sm sm:col-span-3">
                      <span className="text-xs font-medium text-muted-foreground">
                        {t.staff_services_form_provider}
                      </span>
                      <ProviderSelectWithTaxonomyFilter
                        value={createForm.providerId}
                        providers={providers}
                        taxonomyNodes={taxonomyNodes}
                        providerType="non_medical"
                        taxonomyValue={createForm.taxonomyNodeId}
                        taxonomyMode="leaf"
                        providerPlaceholder={t.staff_services_optional}
                        taxonomyPlaceholder={t.services_category}
                        taxonomyAllLabel={t.services_category}
                        containerClassName={providerPickerContainerClassName}
                        taxonomySelectClassName={formSelectClassName}
                        providerSelectClassName={formSelectClassName}
                        providerLabel={(provider) => providerOptionLabel(provider, lang)}
                        onTaxonomyChange={(taxonomyNodeId) =>
                          setCreateForm((current) => ({
                            ...current,
                            taxonomyNodeId,
                          }))
                        }
                        onChange={(providerId) =>
                          setCreateForm((current) => ({
                            ...current,
                            providerId,
                            providerServiceId: "",
                          }))
                        }
                      />
                    </label>

                    <label className="space-y-1.5 text-sm sm:col-span-2">
                      <span className="text-xs font-medium text-muted-foreground">
                        {t.providers_services}
                      </span>
                      <NativeComboboxSelect
                        value={createForm.providerServiceId}
                        onChange={(event) => {
                          const providerServiceId = event.target.value;
                          const service =
                            providerServices.find((item) => item.id === providerServiceId) ??
                            null;
                          const nextTotal = calculatedServiceTotal(
                            service,
                            createForm.quantity,
                          );
                          setCreateForm((current) => ({
                            ...current,
                            providerServiceId,
                            title:
                              !current.title.trim() && service
                                ? service.service_name
                                : current.title,
                            costEstimate:
                              nextTotal === null
                                ? current.costEstimate
                                : formatMoneyInput(nextTotal),
                            currency: service?.currency ?? current.currency,
                          }));
                        }}
                        className={formSelectClassName}
                        disabled={!createForm.providerId || providerServicesLoading}
                      >
                        <option value="">
                          {providerServicesLoading
                            ? t.common_loading
                            : t.staff_services_optional}
                        </option>
                        {providerServices.map((service) => (
                          <option key={service.id} value={service.id}>
                            {providerServiceOptionLabel(service)}
                          </option>
                        ))}
                      </NativeComboboxSelect>
                    </label>

                    <label className="space-y-1.5 text-sm">
                      <span className="text-xs font-medium text-muted-foreground">
                        {t.invoices_workspace_quantity}
                      </span>
                      <Input
                        type="number"
                        min="1"
                        step="1"
                        inputMode="numeric"
                        value={createForm.quantity}
                        onChange={(event) => {
                          const quantity = event.target.value;
                          if (!/^\d*$/.test(quantity)) return;
                          const nextTotal = calculatedServiceTotal(
                            selectedProviderService,
                            quantity,
                          );
                          setCreateForm((current) => ({
                            ...current,
                            quantity,
                            costEstimate:
                              nextTotal === null
                                ? current.costEstimate
                                : formatMoneyInput(nextTotal),
                          }));
                        }}
                        className={formInputClassName}
                      />
                    </label>

                    <label className="space-y-1.5 text-sm">
                      <span className="text-xs font-medium text-muted-foreground">
                        {t.providers_service_price}
                      </span>
                      <Input
                        readOnly
                        value={
                          selectedProviderServiceUnitPrice === null
                            ? ""
                            : formatMoneyInput(selectedProviderServiceUnitPrice)
                        }
                        className={formInputClassName}
                      />
                    </label>

                    <label className="space-y-1.5 text-sm">
                      <span className="text-xs font-medium text-muted-foreground">
                        {t.staff_services_form_cost_estimate}
                      </span>
                      <Input
                        inputMode="decimal"
                        readOnly={selectedProviderServiceTotal !== null}
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
                        {t.staff_services_form_actual_cost}
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
                        {t.staff_services_form_currency}
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
                    {providerServicesError ? (
                      <div className="sm:col-span-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                        {providerServicesError}
                      </div>
                    ) : null}
                  </div>
                </Section>

                <Section title={t.staff_services_create_section_vendor_notes}>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="space-y-1.5 text-sm">
                      <span className="text-xs font-medium text-muted-foreground">
                        {t.staff_services_form_booking_reference}
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
                        {t.staff_services_form_vendor}
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
                      {t.staff_services_form_vendor_contact}
                    </span>
                    <Input
                      value={createForm.vendorContact}
                      onChange={(event) =>
                        setCreateForm((current) => ({ ...current, vendorContact: event.target.value }))
                      }
                      className={formInputClassName}
                    />
                  </label>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block space-y-1.5 text-sm">
                      <span className="text-xs font-medium text-muted-foreground">
                        {t.staff_services_form_service_notes}
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
                        {t.staff_services_form_billing_notes}
                      </span>
                      <textarea
                        value={createForm.billingNotes}
                        onChange={(event) =>
                          setCreateForm((current) => ({ ...current, billingNotes: event.target.value }))
                        }
                        className={formTextareaClassName}
                        rows={4}
                      />
                    </label>
                  </div>
                </Section>
              </div>
            </AdminSheetScaffold>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function StaffServicesPage(...args: Parameters<typeof useStaffServicesPageContent>) {
  return useStaffServicesPageContent(...args);
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
