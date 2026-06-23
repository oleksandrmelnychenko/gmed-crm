import { useCallback, useEffect, useMemo, useReducer, type SetStateAction } from "react";
import {
  Activity,
  BarChart3,
  Building2,
  CalendarDays,
  Download,
  Globe2,
  LoaderCircle,
  RefreshCw,
  Rows3,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import {
  AdminSheetScaffold,
  AdminTableCard,
} from "@/components/admin-page-patterns";
import { DataTable } from "@/components/data-table/data-table";
import type { ColumnDef } from "@/components/data-table/types";
import { StaffLink } from "@/components/staff-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { agencyServiceNameLabel } from "@/lib/agency-service-labels";
import { clearApiCache } from "@/lib/api";
import { Banner as ShellBanner, PageHeader, StatusBadge, selectClass as shellSelectClassName, tokens } from "@/components/ui-shell";
import { useAuth } from "@/lib/auth";
import { formatEnumLabelFromKeys, formatUnknownValue, type TranslationKey, useLang } from "@/lib/i18n";
import { getRevenueReportsText } from "@/lib/i18n/catalogs/revenue";
import { useDebouncedRealtimeSubscription } from "@/lib/realtime";
import { cn } from "@/lib/utils";
import { serviceKindLabel } from "@/pages/appointments/model/labels";
import { fetchProviderTaxonomy } from "@/pages/providers/data/provider-api";
import { specializationSummaryForItems } from "@/pages/providers/model/specialization-labels";
import type { ProviderTaxonomyNode, SpecializationItem } from "@/pages/providers/model/types";
import { ProviderTaxonomyCascadeSelect } from "@/pages/providers/ui/provider-taxonomy-cascade-select";
import { fetchReportsExport, fetchReportsWorkspace } from "./data/reports-api";
import {
  formatChange,
  formatDays,
  formatHours,
  formatMoney,
  formatMoneyMetric,
  formatPercent,
  formatRating,
  formatReportDate,
  roleCanOpenReports,
  serviceTypeLabel,
} from "./model/report-model";

type ReportSummary = {
  active_patients: number;
  active_orders: number;
  active_clinics: number;
  delivered_service_items: number;
  delivered_service_volume?: string | null;
};

type ClinicReportRow = {
  provider_id: string;
  name: string;
  address_city?: string | null;
  address_country?: string | null;
  provider_type: string;
  active_patients_90d: number;
  appointments_90d: number;
  delivered_items: number;
  doctor_count: number;
  feedback_count: number;
  gross_service_volume?: string | null;
  avg_feedback_score?: number | null;
  avg_treatment_score?: number | null;
  avg_doctor_score?: number | null;
  avg_organization_score?: number | null;
  avg_service_score?: number | null;
  avg_infrastructure_score?: number | null;
  avg_price_value_score?: number | null;
  avg_response_hours?: number | null;
  avg_findings_turnaround_hours?: number | null;
  findings_sample_count: number;
  response_sample_count: number;
  open_communication_count: number;
  treatment_success_yes_rate?: number | null;
  treatment_success_partial_rate?: number | null;
  complication_rate?: number | null;
  followup_orders_total: number;
  followup_completed_orders: number;
  followup_completion_rate?: number | null;
} & ProviderReportTaxonomyFields;

type CountryReportRow = {
  country: string;
  patient_count: number;
  active_orders: number;
  gross_invoiced?: string | null;
};

type ServiceTypeReportRow = {
  service_type: string;
  item_count: number;
  patient_count: number;
  order_count: number;
  gross_total?: string | null;
};

type ProviderReportTaxonomyFields = {
  taxonomy_node_id?: string | null;
  taxonomy_node_code?: string | null;
  taxonomy_node_name_de?: string | null;
  taxonomy_node_name_ru?: string | null;
};

type MedicalProviderReportRow = {
  provider_id: string;
  name: string;
  address_city?: string | null;
  address_country?: string | null;
  active_patients_90d: number;
  appointments_90d: number;
  active_orders: number;
  delivered_items: number;
  doctor_count: number;
  gross_service_volume?: string | null;
  doctor_specialties: string[];
  service_focus: string[];
  patient_country_mix: string[];
  last_activity_at?: string | null;
} & ProviderReportTaxonomyFields;

type TaxonomyPathNode = {
  id: string;
  code: string;
  name_de: string;
  name_ru?: string | null;
};

type ProviderCostTrendPoint = {
  month: string;
  avg_unit_gross: string | number;
  sample_count: number;
};

type ProviderCostRow = {
  provider_id: string;
  provider_name: string;
  address_city?: string | null;
  address_country?: string | null;
  service_label: string;
  sample_count: number;
  first_recorded_at?: string | null;
  last_recorded_at?: string | null;
  earliest_unit_gross?: string | null;
  latest_unit_gross?: string | null;
  avg_unit_gross?: string | null;
  min_unit_gross?: string | null;
  max_unit_gross?: string | null;
  change_pct?: number | null;
  trend_points: ProviderCostTrendPoint[];
} & ProviderReportTaxonomyFields;

type DoctorReportRow = {
  doctor_id: string;
  provider_id: string;
  name: string;
  title?: string | null;
  fachbereich?: string | null;
  specializations?: SpecializationItem[];
  provider_name: string;
  address_city?: string | null;
  address_country?: string | null;
  active_patients_90d: number;
  appointments_90d: number;
  active_orders: number;
  delivered_items: number;
  feedback_count: number;
  avg_treatment_score?: number | null;
  avg_doctor_score?: number | null;
  avg_organization_score?: number | null;
  avg_service_score?: number | null;
  avg_infrastructure_score?: number | null;
  avg_price_value_score?: number | null;
  avg_response_hours?: number | null;
  avg_findings_turnaround_hours?: number | null;
  findings_sample_count: number;
  response_sample_count: number;
  open_communication_count: number;
  treatment_success_yes_rate?: number | null;
  treatment_success_partial_rate?: number | null;
  complication_rate?: number | null;
  followup_orders_total: number;
  followup_completed_orders: number;
  followup_completion_rate?: number | null;
  gross_service_volume?: string | null;
} & ProviderReportTaxonomyFields;

type NonMedicalProviderReportRow = {
  provider_id: string;
  name: string;
  address_city?: string | null;
  address_country?: string | null;
  taxonomy_node_id?: string | null;
  taxonomy_node_code?: string | null;
  taxonomy_node_name_de?: string | null;
  taxonomy_node_name_ru?: string | null;
  taxonomy_path?: TaxonomyPathNode[];
  taxonomy_path_label?: string | null;
  taxonomy_attributes?: Record<string, unknown> | null;
  internal_rating?: number | null;
  internal_rating_note?: string | null;
  service_count: number;
  active_patients_90d: number;
  appointments_90d: number;
  concierge_requests_90d: number;
  open_concierge_requests: number;
  completed_concierge_requests_90d: number;
  delivered_items: number;
  vendor_count: number;
  service_focus: string[];
  avg_concierge_score?: number | null;
  feedback_count: number;
  gross_service_volume?: string | null;
};

type ReportsWorkspacePayload = {
  summary: ReportSummary;
  allowed_sections: string[];
  clinics: ClinicReportRow[];
  countries: CountryReportRow[];
  service_types: ServiceTypeReportRow[];
  medical_providers: MedicalProviderReportRow[];
  provider_costs: ProviderCostRow[];
  billing_kpis?: {
    invoices_30d: number;
    tracked_invoice_count: number;
    overdue_invoice_count: number;
    dunning_rate_pct?: number | null;
    avg_invoice_gross?: number | null;
    avg_service_to_invoice_days?: number | null;
    paid_within_14d_rate_pct?: number | null;
    outstanding_receivables_total?: string | null;
    self_pay_share_pct?: number | null;
    cost_passthrough_share_pct?: number | null;
  } | null;
  doctors: DoctorReportRow[];
  non_medical_providers: NonMedicalProviderReportRow[];
  sales_kpis?: {
    new_leads_30d: number;
    qualified_leads_30d: number;
    converted_leads_30d: number;
    lead_to_patient_conversion_rate_pct?: number | null;
    active_lead_country_count: number;
    new_partner_clinics_90d: number;
    top_countries: Array<{ country: string; lead_count: number }>;
  } | null;
  financial_metrics_visible: boolean;
};

function reportBackendLabel(
  value: string,
  text: ReturnType<typeof getRevenueReportsText>,
  translations: ReturnType<typeof useLang>["t"],
) {
  if (value === "provider_specialty.unknown") return text.common.unknownSpecialty;
  if (value === "order_service.unnamed") return text.common.unnamedService;
  const conciergeKind = value.match(/^concierge_service_kind\.(.+)$/)?.[1];
  if (conciergeKind) return serviceKindLabel(conciergeKind);
  return agencyServiceNameLabel(undefined, value, translations);
}

function reportTaxonomyLabel(
  row: ProviderReportTaxonomyFields & { taxonomy_path_label?: string | null },
  fallback: string,
  lang: "de" | "ru",
) {
  if (lang === "ru") {
    return row.taxonomy_node_name_ru || row.taxonomy_node_name_de || row.taxonomy_path_label || fallback;
  }
  return row.taxonomy_path_label || row.taxonomy_node_name_de || row.taxonomy_node_name_ru || fallback;
}

function reportDoctorSpecialtyLabel(
  row: Pick<DoctorReportRow, "fachbereich" | "specializations">,
  lang: "de" | "ru",
  fallback: string,
) {
  return specializationSummaryForItems(row.specializations, row.fachbereich, lang, fallback);
}

function ReportTaxonomyBadge({
  label,
  code,
}: {
  label: string;
  code?: string | null;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Badge
        variant="outline"
        className="h-auto w-fit max-w-full whitespace-normal rounded-md px-2 py-1 text-left text-[11px] leading-snug"
        title={label}
      >
        <span className="block whitespace-normal break-words">{label}</span>
      </Badge>
      {code ? (
        <span className="break-all text-[11px] leading-snug text-muted-foreground">
          {code}
        </span>
      ) : null}
    </div>
  );
}

type ForecastQuotePipelineRow = {
  status: string;
  quote_count: number;
  expiring_next_14d: number;
  gross_total?: string | null;
  weighted_gross?: string | null;
};

type ForecastCollections = {
  due_next_14d_count: number;
  due_next_14d_total?: string | null;
  overdue_invoice_count: number;
  overdue_open_total?: string | null;
  outstanding_open_total?: string | null;
  workflow_open_count: number;
  payment_plan_count: number;
  escalated_count: number;
  reviews_due_7d: number;
};

type ForecastFollowup = {
  active_orders: number;
  doctor_followup_open: number;
  followup_1w_due_next_30d: number;
  followup_1m_due_next_30d: number;
  followup_6m_due_next_30d: number;
  package_end_due_next_30d: number;
  results_handoff_pending: number;
  milestones_due_next_30d: number;
};

type ForecastClinicCapacityRow = {
  provider_id: string;
  name: string;
  address_city?: string | null;
  doctor_count: number;
  appointments_next_30d: number;
  followup_appointments_next_30d: number;
  patients_next_30d: number;
  active_orders_next_30d: number;
};

type ForecastingPayload = {
  summary: {
    open_quotes: number;
    expiring_quotes_next_14d: number;
    pipeline_gross_total?: string | null;
    weighted_pipeline_gross?: string | null;
    due_next_14d_total?: string | null;
    overdue_open_total?: string | null;
    followup_milestones_next_30d: number;
    appointments_next_30d: number;
  };
  allowed_sections: string[];
  quote_pipeline?: {
    open_quotes: number;
    expiring_next_14d: number;
    gross_total?: string | null;
    weighted_gross?: string | null;
    by_status: ForecastQuotePipelineRow[];
  } | null;
  collections?: ForecastCollections | null;
  followup?: ForecastFollowup | null;
  clinic_capacity?: {
    appointments_next_30d_total: number;
    followup_appointments_next_30d_total: number;
    active_clinics: number;
    clinics: ForecastClinicCapacityRow[];
  } | null;
};

const REPORTS_REALTIME_EVENTS = [
  "patient.created",
  "patient.updated",
  "patient.activated",
  "patient.deactivated",
  "lead.created",
  "lead.updated",
  "lead.status_changed",
  "lead.converted",
  "lead.failed_resolved",
  "appointment.created",
  "appointment.updated",
  "appointment.status_changed",
  "appointment_checklist.created",
  "appointment_checklist.completed",
  "appointment_request.created",
  "appointment_request.converted",
  "case.created",
  "case.updated",
  "order.created",
  "order.phase_changed",
  "order.debt_management_updated",
  "order.followup_flow_updated",
  "order.external_invoice_created",
  "order.external_invoice_updated",
  "order.external_invoice_overdue",
  "order.leistung_added",
  "order.leistung_approved",
  "invoice.created",
  "invoice.status_changed",
  "invoice.dunning_created",
  "invoice.overdue_marked",
  "document.uploaded",
  "document.generated",
  "document.updated",
  "document.deleted",
  "document.translation_requested",
  "document.translation_updated",
  "feedback.submitted",
  "feedback.reviewed",
  "provider.created",
  "provider.updated",
  "provider.deleted",
  "provider.activated",
  "provider.deactivated",
  "provider.doctor_created",
  "provider.doctor_updated",
  "provider.doctor_deleted",
  "provider.service_created",
  "provider.service_updated",
  "provider.service_deleted",
  "concierge_service.created",
  "concierge_service.updated",
  "concierge_service.cancelled",
  "concierge_service.billing_ready",
  "framework_contract.created",
  "framework_contract.status_changed",
  "quote.created",
  "quote.status_changed",
  "privacy_request.created",
  "privacy_request.reviewed",
  "privacy_request.executed",
  "reminder.created",
  "reminder.completed",
  "task.created",
  "task.status_changed",
  "consent.granted",
  "consent.revoked",
  "workflow_checklist_item.created",
  "workflow_checklist_item.completed",
] as const;

function clearReportsStatsCache() {
  clearApiCache("/stats");
}

function card(extra?: string) {
  return cn("rounded-xl border border-border bg-card", extra);
}

function titleWithDot(title: string) {
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden className="size-1.5 rounded-full bg-[var(--brand)]" />
      <span>{title}</span>
    </span>
  );
}

function tableEmpty(message: string) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}

type ReportDetailState =
  | { kind: "clinic"; row: ClinicReportRow }
  | { kind: "doctor"; row: DoctorReportRow }
  | { kind: "provider_cost"; row: ProviderCostRow }
  | null;

const REPORT_PROVIDER_TYPE_LABEL_KEYS = {
  medical: "providers_type_medical",
  non_medical: "providers_type_non_medical",
} satisfies Partial<Record<string, TranslationKey>>;

function reportTaxonomyLoadError(lang: "de" | "ru") {
  return lang === "ru"
    ? "Не удалось загрузить категории провайдеров."
    : "Provider-Kategorien konnten nicht geladen werden.";
}

function metricCard(
  label: string,
  value: string | number,
  icon: LucideIcon,
  options?: {
    borderless?: boolean;
    grouped?: boolean;
    groupedLast?: boolean;
    hideIcon?: boolean;
    itemKey?: string;
    connector?: boolean;
  },
) {
  const Icon = icon;
  if (!options?.borderless) {
    return (
      <article
        key={options?.itemKey}
        className={cn(
          "relative min-h-[44px] min-w-[190px] px-3 py-1",
          options?.grouped ? null : "border border-border",
        )}
      >
        {options?.grouped && !options.groupedLast ? (
          <span className="absolute right-0 top-1/2 hidden -translate-y-1/2 space-y-1 xl:block">
            <span className="block h-1.5 w-px bg-border" />
            <span className="block h-1.5 w-px bg-border" />
            <span className="block h-1.5 w-px bg-border" />
          </span>
        ) : null}
        <div className="flex items-baseline gap-2">
          <Icon className="size-4.5 shrink-0 text-muted-foreground/55" />
          <p className="text-2xl font-semibold leading-[0.75] text-foreground">
            {value}
          </p>
        </div>
        <p className="mt-0.5 break-words text-xs font-medium leading-tight text-muted-foreground">
          {label}
        </p>
      </article>
    );
  }

  return (
    <article
      key={options?.itemKey}
      className={cn(
        "flex min-w-[210px] items-center justify-between gap-3 px-3 py-1.5",
        options?.borderless ? null : "border border-border",
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        {options?.hideIcon ? null : (
          <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 max-w-full break-words text-xs font-medium text-muted-foreground">
          {label}
        </span>
      </span>
      {options?.connector ? (
        <span className="h-px min-w-6 flex-1 bg-border/70" />
      ) : null}
      <span className="shrink-0 text-base font-semibold leading-none text-foreground">
        {value}
      </span>
    </article>
  );
}

function lineMetric(label: string, value: string | number) {
  return metricCard(label, value, Activity, {
    borderless: true,
    connector: true,
    hideIcon: true,
  });
}

function capsuleMetric(label: string, value: string | number) {
  return (
    <div className="flex min-w-[210px] flex-1 items-center justify-between gap-3 rounded-full border border-border bg-muted/20 px-4 py-2">
      <span className="min-w-0 max-w-full break-words text-xs font-medium text-muted-foreground">
        {label}
      </span>
      <span className="shrink-0 text-sm font-semibold leading-none text-foreground">
        {value}
      </span>
    </div>
  );
}

type ReportsPageState = {
  data: ReportsWorkspacePayload | null;
  forecasting: ForecastingPayload | null;
  loading: boolean;
  refreshing: boolean;
  error: string;
  version: number;
  selectedClinicId: string;
  selectedTaxonomyNodeId: string;
  taxonomyNodes: ProviderTaxonomyNode[];
  taxonomyLoading: boolean;
  taxonomyError: string;
  exportingSection: string;
  detail: ReportDetailState;
};

type ReportsPageAction =
  | { type: "patch"; value: Partial<ReportsPageState> }
  | { type: "update"; updater: (state: ReportsPageState) => ReportsPageState }
  | { type: "bump-version" }
  | { type: "restricted" }
  | { type: "load-start" }
  | { type: "taxonomy-load-start" }
  | { type: "taxonomy-load-success"; nodes: ProviderTaxonomyNode[] }
  | { type: "taxonomy-load-error"; message: string }
  | { type: "set-taxonomy-filter"; value: string }
  | {
      type: "load-success";
      payload: ReportsWorkspacePayload;
      forecastPayload: ForecastingPayload | null;
    }
  | { type: "load-error"; message: string };

const REPORTS_PAGE_INITIAL_STATE: ReportsPageState = {
  data: null,
  forecasting: null,
  loading: true,
  refreshing: false,
  error: "",
  version: 0,
  selectedClinicId: "",
  selectedTaxonomyNodeId: "",
  taxonomyNodes: [],
  taxonomyLoading: false,
  taxonomyError: "",
  exportingSection: "",
  detail: null,
};

function reportsPageReducer(
  state: ReportsPageState,
  action: ReportsPageAction,
): ReportsPageState {
  switch (action.type) {
    case "patch":
      return { ...state, ...action.value };
    case "update":
      return action.updater(state);
    case "bump-version":
      return { ...state, version: state.version + 1 };
    case "restricted":
      return { ...state, loading: false, refreshing: false, taxonomyLoading: false };
    case "load-start":
      return { ...state, refreshing: !state.loading };
    case "taxonomy-load-start":
      return { ...state, taxonomyLoading: true, taxonomyError: "" };
    case "taxonomy-load-success":
      return {
        ...state,
        taxonomyNodes: action.nodes,
        taxonomyLoading: false,
        taxonomyError: "",
      };
    case "taxonomy-load-error":
      return {
        ...state,
        taxonomyNodes: [],
        taxonomyLoading: false,
        taxonomyError: action.message,
      };
    case "set-taxonomy-filter":
      if (state.selectedTaxonomyNodeId === action.value) return state;
      return {
        ...state,
        selectedTaxonomyNodeId: action.value,
        selectedClinicId: "",
        detail: null,
      };
    case "load-success":
      return {
        ...state,
        data: action.payload,
        forecasting: action.forecastPayload,
        error: "",
        loading: false,
        refreshing: false,
      };
    case "load-error":
      return {
        ...state,
        error: action.message,
        forecasting: null,
        loading: false,
        refreshing: false,
      };
    default:
      return state;
  }
}

function createReportsFieldAction<K extends keyof ReportsPageState>(
  field: K,
  value: SetStateAction<ReportsPageState[K]>,
): ReportsPageAction {
  return {
    type: "update",
    updater: (state) => {
      const currentValue = state[field];
      const nextValue =
        typeof value === "function"
          ? (value as (current: ReportsPageState[K]) => ReportsPageState[K])(currentValue)
          : value;

      if (Object.is(currentValue, nextValue)) return state;
      return { ...state, [field]: nextValue };
    },
  };
}

function useReportsPageContent() {
  const { user } = useAuth();
  const { lang, t } = useLang();
  const locale = lang === "de" ? "de-DE" : "ru-RU";
  const text = useMemo(() => getRevenueReportsText(lang), [lang]);
  const sectionLabel = (section: string) =>
    text.sectionLabels[section as keyof typeof text.sectionLabels] ??
    formatUnknownValue(section, t);
  const quoteStatusLabel = useCallback(
    (status: string) =>
      text.forecast.quoteStatuses[status as keyof typeof text.forecast.quoteStatuses] ??
      formatUnknownValue(status, t),
    [t, text],
  );
  const providerTypeLabel = useCallback(
    (providerType: string) =>
      formatEnumLabelFromKeys(providerType, REPORT_PROVIDER_TYPE_LABEL_KEYS, t),
    [t],
  );
  const [
    {
      data,
      forecasting,
      loading,
      refreshing,
      error,
      version,
      selectedClinicId,
      selectedTaxonomyNodeId,
      taxonomyNodes,
      taxonomyLoading,
      taxonomyError,
      exportingSection,
      detail,
    },
    dispatchReportsState,
  ] = useReducer(reportsPageReducer, REPORTS_PAGE_INITIAL_STATE);
  const setSelectedClinicId = useCallback(
    (value: SetStateAction<string>) =>
      dispatchReportsState(createReportsFieldAction("selectedClinicId", value)),
    [],
  );
  const setDetail = useCallback(
    (value: SetStateAction<ReportDetailState>) =>
      dispatchReportsState(createReportsFieldAction("detail", value)),
    [],
  );
  const setSelectedTaxonomyNodeId = useCallback(
    (value: string) =>
      dispatchReportsState({ type: "set-taxonomy-filter", value }),
    [],
  );

  useDebouncedRealtimeSubscription(REPORTS_REALTIME_EVENTS, () => {
    if (!roleCanOpenReports(user?.role)) return;
    clearReportsStatsCache();
    dispatchReportsState({ type: "bump-version" });
  }, 300);

  useEffect(() => {
    if (!roleCanOpenReports(user?.role)) {
      dispatchReportsState({ type: "restricted" });
      return;
    }

    let cancelled = false;

    async function load() {
      dispatchReportsState({ type: "load-start" });

      try {
        const { payload, forecastPayload } =
          await fetchReportsWorkspace<ReportsWorkspacePayload, ForecastingPayload>(
            selectedTaxonomyNodeId,
          );
        if (!cancelled) {
          dispatchReportsState({
            type: "load-success",
            payload,
            forecastPayload,
          });
        }
      } catch (err) {
        if (!cancelled) {
          dispatchReportsState({
            type: "load-error",
            message: err instanceof Error ? err.message : text.loadError,
          });
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [selectedTaxonomyNodeId, text.loadError, user?.role, version]);

  useEffect(() => {
    if (!roleCanOpenReports(user?.role)) return;

    let cancelled = false;
    dispatchReportsState({ type: "taxonomy-load-start" });

    fetchProviderTaxonomy()
      .then((taxonomy) => {
        if (!cancelled) {
          dispatchReportsState({
            type: "taxonomy-load-success",
            nodes: taxonomy.nodes,
          });
        }
      })
      .catch((err) => {
        if (!cancelled) {
          dispatchReportsState({
            type: "taxonomy-load-error",
            message: err instanceof Error ? err.message : reportTaxonomyLoadError(lang),
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [lang, user?.role]);

  const allowedSections = useMemo(
    () => new Set(data?.allowed_sections ?? []),
    [data?.allowed_sections],
  );
  const forecastSections = useMemo(
    () => new Set(forecasting?.allowed_sections ?? []),
    [forecasting?.allowed_sections],
  );
  const visibleDoctors = useMemo(() => {
    if (!data?.doctors) return [];
    if (!selectedClinicId) return data.doctors;
    return data.doctors.filter((item) => item.provider_id === selectedClinicId);
  }, [data?.doctors, selectedClinicId]);
  const selectedClinic = useMemo(
    () => data?.clinics.find((item) => item.provider_id === selectedClinicId) ?? null,
    [data?.clinics, selectedClinicId],
  );
  const visibleProviderCosts = useMemo(() => {
    if (!data?.provider_costs) return [];
    if (!selectedClinicId) return data.provider_costs;
    return data.provider_costs.filter((item) => item.provider_id === selectedClinicId);
  }, [data?.provider_costs, selectedClinicId]);
  const taxonomyFilterLabel = t.providers_category;
  const taxonomyAllLabel = t.providers_all;
  const clinicColumns = useMemo<ColumnDef<ClinicReportRow>[]>(
    () => [
      {
        id: "clinic",
        label: text.clinicReport.title,
        accessor: (row) => row.name,
        width: 240,
        pinned: "left",
        sortable: true,
        render: (row) => <span className="text-sm font-medium text-foreground">{row.name}</span>,
      },
      {
        id: "location",
        label: text.common.location,
        accessor: (row) => `${row.address_city ?? ""} ${row.address_country ?? ""}`,
        width: 220,
        render: (row) => (
          <span className="text-xs text-foreground">
            {[row.address_city, row.address_country].filter(Boolean).join(", ") || text.locationNotSet}
          </span>
        ),
      },
      {
        id: "provider_type",
        label: text.common.services,
        accessor: (row) => row.provider_type,
        width: 160,
        render: (row) => <span className="text-xs text-foreground">{providerTypeLabel(row.provider_type)}</span>,
      },
      {
        id: "taxonomy",
        label: taxonomyFilterLabel,
        accessor: (row) => reportTaxonomyLabel(row, text.unknown, lang),
        width: 320,
        sortable: true,
        render: (row) => <ReportTaxonomyBadge label={reportTaxonomyLabel(row, text.unknown, lang)} />,
      },
      {
        id: "patients",
        label: text.common.patients90d,
        accessor: (row) => row.active_patients_90d,
        width: 140,
        sortable: true,
      },
      {
        id: "appointments",
        label: text.common.appointments90d,
        accessor: (row) => row.appointments_90d,
        width: 150,
        sortable: true,
      },
      {
        id: "delivered",
        label: text.common.deliveredItems,
        accessor: (row) => row.delivered_items,
        width: 160,
        sortable: true,
      },
      {
        id: "feedback",
        label: text.common.feedback,
        accessor: (row) => row.avg_feedback_score ?? -1,
        width: 140,
        sortable: true,
        render: (row) => (
          <span className="text-xs text-foreground">
            {formatRating(row.avg_feedback_score, text.notRated)}
          </span>
        ),
      },
      {
        id: "followup",
        label: text.common.followupCompletion,
        accessor: (row) => row.followup_completion_rate ?? -1,
        width: 180,
        sortable: true,
        render: (row) => (
          <span className="text-xs text-foreground">
            {formatPercent(row.followup_completion_rate, text.noBaseline)}
          </span>
        ),
      },
      {
        id: "gross",
        label: text.summary.deliveredServiceVolume,
        accessor: (row) => row.gross_service_volume ?? "",
        width: 180,
        render: (row) => (
          <span className="text-xs text-foreground">
            {row.gross_service_volume ? formatMoney(row.gross_service_volume, locale) : text.countsOnly}
          </span>
        ),
      },
    ],
    [lang, locale, providerTypeLabel, taxonomyFilterLabel, text],
  );
  const serviceTypeColumns = useMemo<ColumnDef<ServiceTypeReportRow>[]>(
    () => [
      {
        id: "service_type",
        label: text.serviceTypeReport.title,
        accessor: (row) => row.service_type,
        width: 260,
        pinned: "left",
        render: (row) => (
          <span className="text-sm font-medium text-foreground">
            {serviceTypeLabel(row.service_type, text.serviceTypes, formatUnknownValue(row.service_type, t))}
          </span>
        ),
      },
      {
        id: "items",
        label: text.common.deliveredItems,
        accessor: (row) => row.item_count,
        width: 130,
        sortable: true,
      },
      {
        id: "orders",
        label: text.summary.activeOrders,
        accessor: (row) => row.order_count,
        width: 130,
        sortable: true,
      },
      {
        id: "patients",
        label: text.common.patients90d,
        accessor: (row) => row.patient_count,
        width: 140,
        sortable: true,
      },
      {
        id: "gross",
        label: text.summary.deliveredServiceVolume,
        accessor: (row) => row.gross_total ?? "",
        width: 180,
        render: (row) => (
          <span className="text-xs text-foreground">
            {row.gross_total ? formatMoney(row.gross_total, locale) : text.countsOnly}
          </span>
        ),
      },
    ],
    [locale, t, text],
  );
  const medicalProviderColumns = useMemo<ColumnDef<MedicalProviderReportRow>[]>(
    () => [
      {
        id: "provider",
        label: text.medicalProviders.title,
        accessor: (row) => row.name,
        width: 240,
        pinned: "left",
        sortable: true,
        render: (row) => <span className="text-sm font-medium text-foreground">{row.name}</span>,
      },
      {
        id: "location",
        label: text.common.location,
        accessor: (row) => `${row.address_city ?? ""} ${row.address_country ?? ""}`,
        width: 220,
        render: (row) => (
          <span className="text-xs text-foreground">
            {[row.address_city, row.address_country].filter(Boolean).join(", ") || text.locationNotSet}
          </span>
        ),
      },
      {
        id: "taxonomy",
        label: taxonomyFilterLabel,
        accessor: (row) => reportTaxonomyLabel(row, text.unknown, lang),
        width: 320,
        sortable: true,
        render: (row) => <ReportTaxonomyBadge label={reportTaxonomyLabel(row, text.unknown, lang)} />,
      },
      {
        id: "patients",
        label: text.common.patients90d,
        accessor: (row) => row.active_patients_90d,
        width: 140,
        sortable: true,
      },
      {
        id: "appointments",
        label: text.common.appointments90d,
        accessor: (row) => row.appointments_90d,
        width: 150,
        sortable: true,
      },
      {
        id: "active_orders",
        label: text.summary.activeOrders,
        accessor: (row) => row.active_orders,
        width: 140,
        sortable: true,
      },
      {
        id: "delivered",
        label: text.common.deliveredItems,
        accessor: (row) => row.delivered_items,
        width: 160,
        sortable: true,
      },
      {
        id: "doctors",
        label: text.common.doctors,
        accessor: (row) => row.doctor_count,
        width: 120,
        sortable: true,
      },
      {
        id: "last_activity",
        label: text.common.latest,
        accessor: (row) => row.last_activity_at ?? "",
        width: 140,
        render: (row) => (
          <span className="text-xs text-foreground">
            {formatReportDate(row.last_activity_at, locale, text.noRecentActivity)}
          </span>
        ),
      },
      {
        id: "gross",
        label: text.summary.deliveredServiceVolume,
        accessor: (row) => row.gross_service_volume ?? "",
        width: 180,
        render: (row) => (
          <span className="text-xs text-foreground">
            {formatMoney(row.gross_service_volume ?? "0", locale)}
          </span>
        ),
      },
    ],
    [lang, locale, taxonomyFilterLabel, t, text],
  );
  const providerCostColumns = useMemo<ColumnDef<ProviderCostRow>[]>(
    () => [
      {
        id: "service",
        label: text.providerCosts.title,
        accessor: (row) => reportBackendLabel(row.service_label, text, t),
        width: 220,
        pinned: "left",
        sortable: true,
        render: (row) => (
          <span className="text-sm font-medium text-foreground">
            {reportBackendLabel(row.service_label, text, t)}
          </span>
        ),
      },
      {
        id: "provider",
        label: text.medicalProviders.title,
        accessor: (row) => row.provider_name,
        width: 220,
        render: (row) => <span className="text-xs text-foreground">{row.provider_name}</span>,
      },
      {
        id: "taxonomy",
        label: taxonomyFilterLabel,
        accessor: (row) => reportTaxonomyLabel(row, text.unknown, lang),
        width: 320,
        sortable: true,
        render: (row) => <ReportTaxonomyBadge label={reportTaxonomyLabel(row, text.unknown, lang)} />,
      },
      {
        id: "location",
        label: text.common.location,
        accessor: (row) => `${row.address_city ?? ""} ${row.address_country ?? ""}`,
        width: 220,
        render: (row) => (
          <span className="text-xs text-foreground">
            {[row.address_city, row.address_country].filter(Boolean).join(", ") || text.locationNotSet}
          </span>
        ),
      },
      {
        id: "samples",
        label: text.common.samples,
        accessor: (row) => row.sample_count,
        width: 110,
        sortable: true,
      },
      {
        id: "first",
        label: text.common.min,
        accessor: (row) => row.first_recorded_at ?? "",
        width: 130,
        render: (row) => (
          <span className="text-xs text-foreground">
            {formatReportDate(row.first_recorded_at, locale, text.unknown)}
          </span>
        ),
      },
      {
        id: "last",
        label: text.common.latest,
        accessor: (row) => row.last_recorded_at ?? "",
        width: 130,
        render: (row) => (
          <span className="text-xs text-foreground">
            {formatReportDate(row.last_recorded_at, locale, text.unknown)}
          </span>
        ),
      },
      {
        id: "change",
        label: text.common.latestVsFirst,
        accessor: (row) => row.change_pct ?? -999,
        width: 160,
        render: (row) => (
          <span className="text-xs text-foreground">{formatChange(row.change_pct, text.noBaseline)}</span>
        ),
      },
      {
        id: "avg",
        label: text.common.average,
        accessor: (row) => row.avg_unit_gross ?? "",
        width: 170,
        render: (row) => (
          <span className="text-xs text-foreground">{formatMoneyMetric(row.avg_unit_gross, locale)}</span>
        ),
      },
      {
        id: "latest_value",
        label: text.common.latest,
        accessor: (row) => row.latest_unit_gross ?? "",
        width: 170,
        render: (row) => (
          <span className="text-xs text-foreground">{formatMoneyMetric(row.latest_unit_gross, locale)}</span>
        ),
      },
    ],
    [lang, locale, taxonomyFilterLabel, t, text],
  );
  const nonMedicalProviderColumns = useMemo<ColumnDef<NonMedicalProviderReportRow>[]>(
    () => [
      {
        id: "provider",
        label: text.nonMedicalProviders.title,
        accessor: (row) => row.name,
        width: 240,
        pinned: "left",
        sortable: true,
        render: (row) => <span className="text-sm font-medium text-foreground">{row.name}</span>,
      },
      {
        id: "location",
        label: text.common.location,
        accessor: (row) => `${row.address_city ?? ""} ${row.address_country ?? ""}`,
        width: 220,
        render: (row) => (
          <span className="text-xs text-foreground">
            {[row.address_city, row.address_country].filter(Boolean).join(", ") || text.locationNotSet}
          </span>
        ),
      },
      {
        id: "taxonomy",
        label: taxonomyFilterLabel,
        accessor: (row) => reportTaxonomyLabel(row, text.unknown, lang),
        width: 340,
        sortable: true,
        render: (row) => (
          <ReportTaxonomyBadge
            label={reportTaxonomyLabel(row, text.unknown, lang)}
            code={row.taxonomy_node_code}
          />
        ),
      },
      {
        id: "internal_rating",
        label: text.common.internalRating,
        accessor: (row) => row.internal_rating ?? -1,
        width: 150,
        sortable: true,
        render: (row) => (
          <span className="text-xs text-foreground">
            {formatRating(row.internal_rating, text.notRated)}
          </span>
        ),
      },
      {
        id: "services",
        label: text.common.services,
        accessor: (row) => row.service_count,
        width: 110,
        sortable: true,
      },
      {
        id: "patients",
        label: text.common.patients90d,
        accessor: (row) => row.active_patients_90d,
        width: 140,
        sortable: true,
      },
      {
        id: "appointments",
        label: text.common.appointments90d,
        accessor: (row) => row.appointments_90d,
        width: 150,
        sortable: true,
      },
      {
        id: "requests",
        label: text.common.conciergeRequests90d,
        accessor: (row) => row.concierge_requests_90d,
        width: 170,
        sortable: true,
      },
      {
        id: "open_requests",
        label: text.common.openRequests,
        accessor: (row) => row.open_concierge_requests,
        width: 140,
        sortable: true,
      },
      {
        id: "delivered",
        label: text.common.deliveredItems,
        accessor: (row) => row.delivered_items,
        width: 150,
        sortable: true,
      },
      {
        id: "gross",
        label: text.summary.deliveredServiceVolume,
        accessor: (row) => row.gross_service_volume ?? "",
        width: 180,
        render: (row) => (
          <span className="text-xs text-foreground">
            {row.gross_service_volume ? formatMoney(row.gross_service_volume, locale) : text.countsOnly}
          </span>
        ),
      },
    ],
    [lang, locale, taxonomyFilterLabel, text],
  );
  const countryColumns = useMemo<ColumnDef<CountryReportRow>[]>(
    () => [
      {
        id: "country",
        label: text.countries.title,
        accessor: (row) => row.country,
        width: 220,
        pinned: "left",
        sortable: true,
      },
      {
        id: "patients",
        label: text.common.patients90d,
        accessor: (row) => row.patient_count,
        width: 140,
        sortable: true,
      },
      {
        id: "orders",
        label: text.summary.activeOrders,
        accessor: (row) => row.active_orders,
        width: 140,
        sortable: true,
      },
      {
        id: "gross",
        label: text.summary.deliveredServiceVolume,
        accessor: (row) => row.gross_invoiced ?? "",
        width: 180,
        render: (row) => (
          <span className="text-xs text-foreground">
            {row.gross_invoiced ? formatMoney(row.gross_invoiced, locale) : text.countsOnly}
          </span>
        ),
      },
    ],
    [lang, locale, text],
  );
  const doctorColumns = useMemo<ColumnDef<DoctorReportRow>[]>(
    () => [
      {
        id: "doctor",
        label: text.doctors.title,
        accessor: (row) => row.name,
        width: 220,
        pinned: "left",
        sortable: true,
        render: (row) => (
          <span className="text-sm font-medium text-foreground">
            {[row.title, row.name].filter(Boolean).join(" ")}
          </span>
        ),
      },
      {
        id: "provider",
        label: text.medicalProviders.title,
        accessor: (row) => row.provider_name,
        width: 220,
        render: (row) => <span className="text-xs text-foreground">{row.provider_name}</span>,
      },
      {
        id: "taxonomy",
        label: taxonomyFilterLabel,
        accessor: (row) => reportTaxonomyLabel(row, text.unknown, lang),
        width: 320,
        sortable: true,
        render: (row) => <ReportTaxonomyBadge label={reportTaxonomyLabel(row, text.unknown, lang)} />,
      },
      {
        id: "location",
        label: text.common.location,
        accessor: (row) => `${row.address_city ?? ""} ${row.address_country ?? ""}`,
        width: 220,
        render: (row) => (
          <span className="text-xs text-foreground">
            {[row.address_city, row.address_country].filter(Boolean).join(", ") || text.locationNotSet}
          </span>
        ),
      },
      {
        id: "specialty",
        label: text.common.specialties,
        accessor: (row) => reportDoctorSpecialtyLabel(row, lang, ""),
        width: 160,
        render: (row) => (
          <span className="text-xs text-foreground">
            {reportDoctorSpecialtyLabel(row, lang, text.unknown)}
          </span>
        ),
      },
      {
        id: "patients",
        label: text.common.patients90d,
        accessor: (row) => row.active_patients_90d,
        width: 140,
        sortable: true,
      },
      {
        id: "appointments",
        label: text.common.appointments90d,
        accessor: (row) => row.appointments_90d,
        width: 150,
        sortable: true,
      },
      {
        id: "active_orders",
        label: text.summary.activeOrders,
        accessor: (row) => row.active_orders,
        width: 140,
        sortable: true,
      },
      {
        id: "delivered",
        label: text.common.deliveredItems,
        accessor: (row) => row.delivered_items,
        width: 150,
        sortable: true,
      },
      {
        id: "feedback_count",
        label: text.common.feedbackCount,
        accessor: (row) => row.feedback_count,
        width: 150,
        sortable: true,
      },
      {
        id: "treatment",
        label: text.common.treatmentScore,
        accessor: (row) => row.avg_treatment_score ?? -1,
        width: 140,
        sortable: true,
        render: (row) => (
          <span className="text-xs text-foreground">
            {formatRating(row.avg_treatment_score, text.notRated)}
          </span>
        ),
      },
      {
        id: "response",
        label: text.common.doctorResponseTime,
        accessor: (row) => row.avg_response_hours ?? -1,
        width: 170,
        sortable: true,
        render: (row) => (
          <span className="text-xs text-foreground">
            {formatHours(row.avg_response_hours, text.noResponses)}
          </span>
        ),
      },
      {
        id: "followup",
        label: text.common.followupCompletion,
        accessor: (row) => row.followup_completion_rate ?? -1,
        width: 180,
        sortable: true,
        render: (row) => (
          <span className="text-xs text-foreground">
            {formatPercent(row.followup_completion_rate, text.noBaseline)}
          </span>
        ),
      },
      {
        id: "gross",
        label: text.summary.deliveredServiceVolume,
        accessor: (row) => row.gross_service_volume ?? "",
        width: 180,
        render: (row) => (
          <span className="text-xs text-foreground">
            {row.gross_service_volume ? formatMoney(row.gross_service_volume, locale) : text.countsOnly}
          </span>
        ),
      },
    ],
    [lang, locale, taxonomyFilterLabel, text],
  );
  const forecastQuotePipelineColumns = useMemo<ColumnDef<ForecastQuotePipelineRow>[]>(
    () => [
      {
        id: "status",
        label: text.forecast.pipelineTitle,
        accessor: (row) => row.status,
        width: 240,
        pinned: "left",
        sortable: true,
        render: (row) => (
          <span className="text-sm font-medium text-foreground">
            {quoteStatusLabel(row.status)}
          </span>
        ),
      },
      {
        id: "quotes",
        label: text.forecast.openQuotes,
        accessor: (row) => row.quote_count,
        width: 130,
        sortable: true,
      },
      {
        id: "expiring",
        label: text.forecast.expiring14d,
        accessor: (row) => row.expiring_next_14d,
        width: 150,
        sortable: true,
      },
      {
        id: "gross",
        label: text.forecast.grossPipeline,
        accessor: (row) => row.gross_total ?? "",
        width: 180,
        render: (row) => (
          <span className="text-xs text-foreground">
            {row.gross_total ? formatMoney(row.gross_total, locale) : text.countsOnly}
          </span>
        ),
      },
      {
        id: "weighted",
        label: text.forecast.weighted,
        accessor: (row) => row.weighted_gross ?? "",
        width: 180,
        render: (row) => (
          <span className="text-xs text-foreground">
            {row.weighted_gross ? formatMoney(row.weighted_gross, locale) : text.weightedHidden}
          </span>
        ),
      },
    ],
    [locale, quoteStatusLabel, text],
  );
  const forecastClinicCapacityColumns = useMemo<ColumnDef<ForecastClinicCapacityRow>[]>(
    () => [
      {
        id: "clinic",
        label: text.forecast.clinicCapacityTitle,
        accessor: (row) => row.name,
        width: 220,
        pinned: "left",
        sortable: true,
        render: (row) => <span className="text-sm font-medium text-foreground">{row.name}</span>,
      },
      {
        id: "location",
        label: text.common.location,
        accessor: (row) => row.address_city ?? "",
        width: 200,
        render: (row) => (
          <span className="text-xs text-foreground">{row.address_city || text.locationNotSet}</span>
        ),
      },
      {
        id: "doctors",
        label: text.common.doctors,
        accessor: (row) => row.doctor_count,
        width: 120,
        sortable: true,
      },
      {
        id: "appointments",
        label: text.forecast.appointments30d,
        accessor: (row) => row.appointments_next_30d,
        width: 170,
        sortable: true,
      },
      {
        id: "followup",
        label: text.forecast.followup30d,
        accessor: (row) => row.followup_appointments_next_30d,
        width: 170,
        sortable: true,
      },
      {
        id: "patients",
        label: text.forecast.patients30d,
        accessor: (row) => row.patients_next_30d,
        width: 150,
        sortable: true,
      },
      {
        id: "orders",
        label: text.forecast.orders30d,
        accessor: (row) => row.active_orders_next_30d,
        width: 150,
        sortable: true,
      },
    ],
    [text],
  );

  async function exportSection(
    section:
      | "clinics"
      | "countries"
      | "service_types"
      | "medical_providers"
      | "provider_costs"
      | "doctors"
      | "non_medical_providers",
  ) {
      dispatchReportsState({
        type: "patch",
        value: { exportingSection: section, error: "" },
      });

    try {
      const { blob, filename } = await fetchReportsExport(
        section,
        selectedClinicId,
        text.exportError,
        selectedTaxonomyNodeId,
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      dispatchReportsState({
        type: "patch",
        value: { error: err instanceof Error ? err.message : text.exportError },
      });
    } finally {
      dispatchReportsState({ type: "patch", value: { exportingSection: "" } });
    }
  }

  if (!roleCanOpenReports(user?.role)) {
    return (
      <ShellBanner tone="warning">{text.accessDescription}</ShellBanner>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex items-center gap-3 rounded-full border border-border bg-card px-5 py-3 text-sm text-muted-foreground shadow-sm">
          <LoaderCircle className="size-4 animate-spin" />
          {text.loadingWorkspace}
        </div>
      </div>
    );
  }

  const taxonomySelectLabel = taxonomyFilterLabel;

  return (
    <div className="space-y-4">
      <PageHeader
        title={titleWithDot(text.workspaceTitle)}
        actions={
          <div className="flex flex-wrap items-end justify-end gap-2">
            <label className="flex min-w-[280px] max-w-full flex-col gap-1">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {taxonomySelectLabel}
              </span>
              <ProviderTaxonomyCascadeSelect
                value={selectedTaxonomyNodeId}
                nodes={taxonomyNodes}
                mode="any"
                placeholder={taxonomySelectLabel}
                allLabel={taxonomyAllLabel}
                disabled={taxonomyLoading || taxonomyNodes.length === 0}
                containerClassName="max-w-[calc(100vw-2rem)]"
                selectClassName={cn(
                  shellSelectClassName,
                  "h-9 min-w-[200px] bg-card text-[13px]",
                )}
                onChange={setSelectedTaxonomyNodeId}
              />
            </label>
            <Button
              variant="outline"
              className="h-9 rounded-lg"
              onClick={() => dispatchReportsState({ type: "bump-version" })}
            >
              {refreshing ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              {text.refresh}
            </Button>
          </div>
        }
      />

      {error ? (
        <ShellBanner tone="error">{error}</ShellBanner>
      ) : null}
      {taxonomyError ? (
        <ShellBanner tone="warning">{taxonomyError}</ShellBanner>
      ) : null}

      {data ? (
        <>
          {allowedSections.has("billing_kpis") && data.billing_kpis ? (
            <section className={card("p-6")}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className={tokens.text.sectionTitle}>{titleWithDot(text.billing.title)}</h2>
                </div>
                <Badge variant="secondary">
                  {text.billing.trackedInvoices(data.billing_kpis.tracked_invoice_count)}
                </Badge>
              </div>
              <div className="mt-5 grid gap-2.5 xl:grid-cols-3">
                <div className="grid gap-1.5 rounded-xl bg-card p-3">
                  {metricCard(text.billing.invoices30d, data.billing_kpis.invoices_30d, Wallet, {
                    borderless: true,
                    connector: true,
                    hideIcon: true,
                  })}
                  {metricCard(
                    text.billing.openReceivables,
                    formatMoneyMetric(data.billing_kpis.outstanding_receivables_total, locale),
                    Wallet,
                    { borderless: true, connector: true, hideIcon: true },
                  )}
                  {metricCard(
                    text.billing.paid14d,
                    formatPercent(data.billing_kpis.paid_within_14d_rate_pct, text.noBaseline),
                    Activity,
                    { borderless: true, connector: true, hideIcon: true },
                  )}
                </div>
                <div className="grid gap-1.5 rounded-xl bg-card p-3">
                  {metricCard(
                    text.billing.dunningShare,
                    formatPercent(data.billing_kpis.dunning_rate_pct, text.noBaseline),
                    BarChart3,
                    { borderless: true, connector: true, hideIcon: true },
                  )}
                  {metricCard(
                    text.billing.avgServiceToInvoice,
                    formatDays(data.billing_kpis.avg_service_to_invoice_days, text.noBaseline),
                    CalendarDays,
                    { borderless: true, connector: true, hideIcon: true },
                  )}
                  {metricCard(
                    text.billing.selfPayShare,
                    formatPercent(data.billing_kpis.self_pay_share_pct, text.noBaseline),
                    Globe2,
                    { borderless: true, connector: true, hideIcon: true },
                  )}
                </div>
                <div className="grid gap-1.5 rounded-xl bg-card p-3">
                  {metricCard(
                    text.billing.averageInvoiceGross,
                    formatMoneyMetric(data.billing_kpis.avg_invoice_gross, locale),
                    Wallet,
                    { borderless: true, connector: true, hideIcon: true },
                  )}
                  {metricCard(
                    text.billing.overdueInvoices,
                    data.billing_kpis.overdue_invoice_count,
                    CalendarDays,
                    { borderless: true, connector: true, hideIcon: true },
                  )}
                  {metricCard(
                    text.billing.costPassthroughShare,
                    formatPercent(data.billing_kpis.cost_passthrough_share_pct, text.noBaseline),
                    BarChart3,
                    { borderless: true, connector: true, hideIcon: true },
                  )}
                </div>
              </div>
            </section>
          ) : null}

          {allowedSections.has("sales_kpis") && data.sales_kpis ? (
            <section className={card("p-6")}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className={tokens.text.sectionTitle}>{titleWithDot(text.sales.title)}</h2>
                </div>
                <Badge variant="secondary">
                  {text.sales.leadCountries(data.sales_kpis.active_lead_country_count)}
                </Badge>
              </div>
              <div className="mt-5 grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(280px,0.65fr)]">
                <div className="grid gap-1 rounded-xl bg-card p-2.5">
                  {metricCard(text.sales.newLeads30d, data.sales_kpis.new_leads_30d, Activity, {
                    borderless: true,
                    connector: true,
                    hideIcon: true,
                  })}
                  {metricCard(text.sales.qualified30d, data.sales_kpis.qualified_leads_30d, Rows3, {
                    borderless: true,
                    connector: true,
                    hideIcon: true,
                  })}
                  {metricCard(text.sales.converted30d, data.sales_kpis.converted_leads_30d, Wallet, {
                    borderless: true,
                    connector: true,
                    hideIcon: true,
                  })}
                  {metricCard(
                    text.sales.leadToPatient,
                    formatPercent(data.sales_kpis.lead_to_patient_conversion_rate_pct, text.noBaseline),
                    BarChart3,
                    { borderless: true, connector: true, hideIcon: true },
                  )}
                  {metricCard(
                    text.sales.newPartnerClinicsQuarter,
                    data.sales_kpis.new_partner_clinics_90d,
                    Building2,
                    { borderless: true, connector: true, hideIcon: true },
                  )}
                </div>
                <article className="relative overflow-hidden rounded-xl px-4 py-2.5">
                  <span className="pointer-events-none absolute right-3 top-3 size-20 rounded-full bg-[var(--brand)]/10 blur-2xl" />
                  <div className="relative flex items-center justify-between gap-3">
                    <p className="min-w-0 max-w-full break-words text-sm font-semibold text-foreground">
                      {text.sales.topLeadCountries90d}
                    </p>
                    <Badge variant="outline" className="rounded-full bg-card/70">
                      {data.sales_kpis.top_countries.length}
                    </Badge>
                  </div>
                  {data.sales_kpis.top_countries.length > 0 ? (() => {
                    const maxLeadCount = Math.max(
                      ...data.sales_kpis.top_countries.map((item) => item.lead_count),
                      1,
                    );

                    return (
                      <div className="relative mt-2.5">
                        <div className="grid min-h-[148px] grid-cols-[repeat(auto-fit,minmax(34px,1fr))] items-end gap-2 pb-2">
                          {data.sales_kpis.top_countries.map((item) => (
                            <div
                              key={`${item.country || "unknown"}-${item.lead_count}`}
                              className="flex min-w-0 flex-col items-center gap-1.5"
                            >
                              <span className="text-xs font-semibold tabular-nums text-foreground">
                                {item.lead_count}
                              </span>
                              <span
                                className="w-full rounded-t-md bg-[var(--brand)]/65"
                                style={{
                                  height: `${Math.max(14, Math.round((item.lead_count / maxLeadCount) * 112))}px`,
                                }}
                              />
                              <span className="max-w-full truncate text-[11px] text-muted-foreground">
                                {item.country}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })() : (
                    <p className="relative mt-2.5 text-sm text-muted-foreground">
                      {text.sales.noLeadGeographyYet}
                    </p>
                  )}
                </article>
              </div>
            </section>
          ) : null}

          {forecasting ? (
            <>
              <section className="space-y-6">
                {forecastSections.has("quote_pipeline") && forecasting.quote_pipeline ? (
                  <section className={card("p-6")}>
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h2 className={tokens.text.sectionTitle}>{titleWithDot(text.forecast.pipelineTitle)}</h2>
                      </div>
                      <Badge variant="secondary">
                        {text.forecast.quotes(forecasting.quote_pipeline.open_quotes)}
                      </Badge>
                    </div>
                    <div className="mt-5 grid gap-1.5 md:grid-cols-3">
                      {capsuleMetric(text.forecast.expiring14d, forecasting.quote_pipeline.expiring_next_14d)}
                      {capsuleMetric(
                        text.forecast.grossPipeline,
                        forecasting.quote_pipeline.gross_total ? formatMoney(forecasting.quote_pipeline.gross_total, locale) : text.countsOnly,
                      )}
                      {capsuleMetric(
                        text.forecast.weighted,
                        forecasting.quote_pipeline.weighted_gross ? formatMoney(forecasting.quote_pipeline.weighted_gross, locale) : text.countsOnly,
                      )}
                      <div className="md:col-span-3">
                        {capsuleMetric(text.forecast.readModel, text.forecast.readModelLegend)}
                      </div>
                    </div>
                    <div className="mt-5">
                      <DataTable
                        rows={forecasting.quote_pipeline.by_status}
                        columns={forecastQuotePipelineColumns}
                        rowId={(row) => row.status}
                        emptyState={tableEmpty(text.countsOnly)}
                      />
                    </div>
                  </section>
                ) : null}

                <div className={cn("grid gap-6 p-6 xl:grid-cols-2", card())}>
                  {forecastSections.has("collections") && forecasting.collections ? (
                    <section>
                      <h2 className={tokens.text.sectionTitle}>{titleWithDot(text.forecast.collectionsTitle)}</h2>
                      <p className={cn("mt-1", tokens.text.muted)}>
                        {text.forecast.collectionsDescription}
                      </p>
                      <div className="mt-5 grid gap-1.5 rounded-xl bg-card p-3">
                        {lineMetric(
                          text.forecast.due14d,
                          `${forecasting.collections.due_next_14d_count} / ${forecasting.collections.due_next_14d_total ? formatMoney(forecasting.collections.due_next_14d_total, locale) : text.countsOnly}`,
                        )}
                        {lineMetric(
                          text.forecast.overdue,
                          `${forecasting.collections.overdue_invoice_count} / ${forecasting.collections.overdue_open_total ? formatMoney(forecasting.collections.overdue_open_total, locale) : text.countsOnly}`,
                        )}
                        {lineMetric(
                          text.forecast.debtWorkflows,
                          text.forecast.workflowOpenReview(forecasting.collections.workflow_open_count, forecasting.collections.reviews_due_7d),
                        )}
                        {lineMetric(
                          text.forecast.escalationSplit,
                          text.forecast.escalationSplitValue(forecasting.collections.payment_plan_count, forecasting.collections.escalated_count),
                        )}
                      </div>
                    </section>
                  ) : null}

                  {forecastSections.has("followup") && forecasting.followup ? (
                    <section>
                      <h2 className={tokens.text.sectionTitle}>{titleWithDot(text.forecast.followupTitle)}</h2>
                      <p className={cn("mt-1", tokens.text.muted)}>
                        {text.forecast.followupDescription}
                      </p>
                      <div className="mt-5 grid gap-1.5 rounded-xl bg-card p-3">
                        {lineMetric(text.forecast.activeFollowupOrders, forecasting.followup.active_orders)}
                        {lineMetric(text.forecast.milestones30d, forecasting.followup.milestones_due_next_30d)}
                        {lineMetric(
                          text.forecast.oneWeekOneMonthSixMonth,
                          `${forecasting.followup.followup_1w_due_next_30d} / ${forecasting.followup.followup_1m_due_next_30d} / ${forecasting.followup.followup_6m_due_next_30d}`,
                        )}
                        {lineMetric(
                          text.forecast.doctorPackageResults,
                          `${forecasting.followup.doctor_followup_open} / ${forecasting.followup.package_end_due_next_30d} / ${forecasting.followup.results_handoff_pending}`,
                        )}
                      </div>
                    </section>
                  ) : null}
                </div>
              </section>

              {forecastSections.has("clinic_capacity") && forecasting.clinic_capacity ? (
                <section className={card("p-6")}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className={tokens.text.sectionTitle}>{titleWithDot(text.forecast.clinicCapacityTitle)}</h2>
                      <p className={cn("mt-1", tokens.text.muted)}>
                        {text.forecast.clinicCapacityDescription}
                      </p>
                    </div>
                    <Badge variant="secondary">
                      {text.forecast.clinicCapacityBadge(forecasting.clinic_capacity.active_clinics, forecasting.clinic_capacity.appointments_next_30d_total)}
                    </Badge>
                  </div>
                  <div className="mt-5">
                    <DataTable
                      rows={forecasting.clinic_capacity.clinics}
                      columns={forecastClinicCapacityColumns}
                      rowId={(row) => row.provider_id}
                      emptyState={tableEmpty(text.countsOnly)}
                    />
                  </div>
                </section>
              ) : null}
            </>
          ) : null}

                    <section className="space-y-6">
            {allowedSections.has("clinics") ? (
              <AdminTableCard
                title={titleWithDot(text.clinicReport.title)}
                description={text.clinicReport.description}
                count={data.clinics.length}
                accessory={
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={exportingSection === "clinics"}
                    onClick={() => void exportSection("clinics")}
                  >
                    {exportingSection === "clinics" ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
                    {text.exportCsv}
                  </Button>
                }
              >
                <div className="p-3">
                  <DataTable
                    rows={data.clinics}
                    columns={clinicColumns}
                    rowId={(row) => row.provider_id}
                    activeRowId={detail?.kind === "clinic" ? detail.row.provider_id : null}
                    onRowClick={(row) => setDetail({ kind: "clinic", row })}
                    rowActions={(row) => (
                      <div className="flex items-center gap-2">
                        <Button
                          variant={selectedClinicId === row.provider_id ? "default" : "outline"}
                          size="sm"
                          onClick={() =>
                            setSelectedClinicId((current) =>
                              current === row.provider_id ? "" : row.provider_id,
                            )
                          }
                        >
                          {selectedClinicId === row.provider_id ? text.clearDrillDown : text.drillIntoDoctors}
                        </Button>
                        <StaffLink to={`/providers/${row.provider_id}?return_to=/reports`}>
                          <Button variant="outline" size="sm">{text.openProvider}</Button>
                        </StaffLink>
                      </div>
                    )}
                    emptyState={tableEmpty(text.clinicReport.empty)}
                  />
                </div>
              </AdminTableCard>
            ) : null}

            {allowedSections.has("service_types") ? (
              <AdminTableCard
                title={titleWithDot(text.serviceTypeReport.title)}
                description={text.serviceTypeReport.description}
                count={data.service_types.length}
                accessory={
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={exportingSection === "service_types"}
                    onClick={() => void exportSection("service_types")}
                  >
                    {exportingSection === "service_types" ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
                    {text.exportCsv}
                  </Button>
                }
              >
                <div className="p-3">
                  <DataTable
                    rows={data.service_types}
                    columns={serviceTypeColumns}
                    rowId={(row) => row.service_type}
                    emptyState={tableEmpty(text.serviceTypeReport.empty)}
                  />
                </div>
              </AdminTableCard>
            ) : null}

            {allowedSections.has("medical_providers") ? (
              <AdminTableCard
                title={titleWithDot(text.medicalProviders.title)}
                description={text.medicalProviders.description}
                count={data.medical_providers.length}
                accessory={
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={exportingSection === "medical_providers"}
                    onClick={() => void exportSection("medical_providers")}
                  >
                    {exportingSection === "medical_providers" ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
                    {text.exportCsv}
                  </Button>
                }
              >
                <div className="p-3">
                  <DataTable
                    rows={data.medical_providers}
                    columns={medicalProviderColumns}
                    rowId={(row) => row.provider_id}
                    rowActions={(row) => (
                      <StaffLink to={`/providers/${row.provider_id}?return_to=/reports`}>
                        <Button variant="outline" size="sm">{text.openProvider}</Button>
                      </StaffLink>
                    )}
                    emptyState={tableEmpty(text.medicalProviders.empty)}
                  />
                </div>
              </AdminTableCard>
            ) : null}

            {allowedSections.has("provider_costs") ? (
              <AdminTableCard
                title={titleWithDot(text.providerCosts.title)}
                description={text.providerCosts.description}
                count={visibleProviderCosts.length}
                accessory={
                  <div className="flex items-center gap-2">
                    {selectedClinic ? (
                      <Badge variant="outline">{selectedClinic.name}</Badge>
                    ) : null}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={exportingSection === "provider_costs"}
                      onClick={() => void exportSection("provider_costs")}
                    >
                      {exportingSection === "provider_costs" ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
                      {text.exportCsv}
                    </Button>
                  </div>
                }
              >
                <div className="p-3">
                  <DataTable
                    rows={visibleProviderCosts}
                    columns={providerCostColumns}
                    rowId={(row) => `${row.provider_id}-${row.service_label}`}
                    activeRowId={
                      detail?.kind === "provider_cost"
                        ? `${detail.row.provider_id}-${detail.row.service_label}`
                        : null
                    }
                    onRowClick={(row) => setDetail({ kind: "provider_cost", row })}
                    rowActions={(row) => (
                      <StaffLink to={`/providers/${row.provider_id}?return_to=/reports`}>
                        <Button variant="outline" size="sm">{text.openProvider}</Button>
                      </StaffLink>
                    )}
                    emptyState={tableEmpty(text.providerCosts.empty)}
                  />
                </div>
              </AdminTableCard>
            ) : null}

            {allowedSections.has("non_medical_providers") ? (
              <AdminTableCard
                title={titleWithDot(text.nonMedicalProviders.title)}
                description={text.nonMedicalProviders.description}
                count={data.non_medical_providers.length}
                accessory={
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={exportingSection === "non_medical_providers"}
                    onClick={() => void exportSection("non_medical_providers")}
                  >
                    {exportingSection === "non_medical_providers" ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
                    {text.exportCsv}
                  </Button>
                }
              >
                <div className="p-3">
                  <DataTable
                    rows={data.non_medical_providers}
                    columns={nonMedicalProviderColumns}
                    rowId={(row) => row.provider_id}
                    rowActions={(row) => (
                      <StaffLink to={`/providers/${row.provider_id}?return_to=/reports`}>
                        <Button variant="outline" size="sm">{text.openProvider}</Button>
                      </StaffLink>
                    )}
                    emptyState={tableEmpty(text.nonMedicalProviders.empty)}
                  />
                </div>
              </AdminTableCard>
            ) : null}

            {allowedSections.has("countries") ? (
              <AdminTableCard
                title={titleWithDot(text.countries.title)}
                description={text.countries.description}
                count={data.countries.length}
                accessory={
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={exportingSection === "countries"}
                    onClick={() => void exportSection("countries")}
                  >
                    {exportingSection === "countries" ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
                    {text.exportCsv}
                  </Button>
                }
              >
                <div className="p-3">
                  <DataTable
                    rows={data.countries}
                    columns={countryColumns}
                    rowId={(row) => row.country}
                    emptyState={tableEmpty(text.countries.empty)}
                  />
                </div>
              </AdminTableCard>
            ) : null}

            {allowedSections.has("doctors") ? (
              <AdminTableCard
                title={titleWithDot(text.doctors.title)}
                description={text.doctors.description}
                count={visibleDoctors.length}
                accessory={
                  <div className="flex items-center gap-2">
                    {selectedClinic ? (
                      <Badge variant="outline">{selectedClinic.name}</Badge>
                    ) : null}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={exportingSection === "doctors"}
                      onClick={() => void exportSection("doctors")}
                    >
                      {exportingSection === "doctors" ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
                      {text.exportCsv}
                    </Button>
                  </div>
                }
              >
                <div className="p-3">
                  <DataTable
                    rows={visibleDoctors}
                    columns={doctorColumns}
                    rowId={(row) => row.doctor_id}
                    activeRowId={detail?.kind === "doctor" ? detail.row.doctor_id : null}
                    onRowClick={(row) => setDetail({ kind: "doctor", row })}
                    rowActions={(row) => (
                      <StaffLink to={`/providers/${row.provider_id}?return_to=/reports`}>
                        <Button variant="outline" size="sm">{text.openProvider}</Button>
                      </StaffLink>
                    )}
                    emptyState={tableEmpty(text.doctors.empty)}
                  />
                </div>
              </AdminTableCard>
            ) : null}

            <AdminTableCard
              title={titleWithDot(text.visibility.title)}
              description={text.visibility.description}
            >
              <div className="flex flex-wrap gap-2 p-3">
                {data.allowed_sections.map((item) => (
                  <Badge key={item} variant="secondary">
                    {sectionLabel(item)}
                  </Badge>
                ))}
                <StatusBadge tone={data.financial_metrics_visible ? "success" : "warning"}>
                  {data.financial_metrics_visible ? text.financialMetricsVisible : text.countsOnlyMode}
                </StatusBadge>
              </div>
            </AdminTableCard>
          </section>

          <Sheet open={Boolean(detail)} onOpenChange={(open) => !open && setDetail(null)}>
            <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-2xl">
              {detail ? (
                <AdminSheetScaffold
                  title={titleWithDot(
                    detail.kind === "clinic"
                      ? detail.row.name
                      : detail.kind === "doctor"
                        ? [detail.row.title, detail.row.name].filter(Boolean).join(" ")
                        : reportBackendLabel(detail.row.service_label, text, t),
                  )}
                  description={
                    detail.kind === "clinic"
                      ? text.clinicReport.description
                      : detail.kind === "doctor"
                        ? text.doctors.description
                        : text.providerCosts.description
                  }
                >
                  {detail.kind === "clinic" ? (
                    <>
                      <AdminTableCard title={titleWithDot(text.clinicReport.title)}>
                        <div className="grid gap-2.5 p-3 sm:grid-cols-2">
                          <div className={card("p-3")}>
                            <p className="text-xs text-muted-foreground">{text.common.services}</p>
                            <p className="mt-1 text-sm font-medium text-foreground">{providerTypeLabel(detail.row.provider_type)}</p>
                          </div>
                          <div className={card("p-3")}>
                            <p className="text-xs text-muted-foreground">{text.countries.title}</p>
                            <p className="mt-1 text-sm font-medium text-foreground">
                              {[detail.row.address_city, detail.row.address_country].filter(Boolean).join(", ") || text.locationNotSet}
                            </p>
                          </div>
                          <div className={card("p-3")}>
                            <p className="text-xs text-muted-foreground">{text.common.patients90d}</p>
                            <p className="mt-1 text-sm font-medium text-foreground">{detail.row.active_patients_90d}</p>
                          </div>
                          <div className={card("p-3")}>
                            <p className="text-xs text-muted-foreground">{text.common.appointments90d}</p>
                            <p className="mt-1 text-sm font-medium text-foreground">{detail.row.appointments_90d}</p>
                          </div>
                          <div className={card("p-3")}>
                            <p className="text-xs text-muted-foreground">{text.common.deliveredItems}</p>
                            <p className="mt-1 text-sm font-medium text-foreground">{detail.row.delivered_items}</p>
                          </div>
                          <div className={card("p-3")}>
                            <p className="text-xs text-muted-foreground">{text.summary.deliveredServiceVolume}</p>
                            <p className="mt-1 text-sm font-medium text-foreground">
                              {detail.row.gross_service_volume ? formatMoney(detail.row.gross_service_volume, locale) : text.countsOnly}
                            </p>
                          </div>
                        </div>
                      </AdminTableCard>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant={selectedClinicId === detail.row.provider_id ? "default" : "outline"}
                          onClick={() =>
                            setSelectedClinicId((current) =>
                              current === detail.row.provider_id ? "" : detail.row.provider_id,
                            )
                          }
                        >
                          {selectedClinicId === detail.row.provider_id ? text.clearDrillDown : text.drillIntoDoctors}
                        </Button>
                        <StaffLink to={`/providers/${detail.row.provider_id}?return_to=/reports`}>
                          <Button variant="outline">{text.openProvider}</Button>
                        </StaffLink>
                      </div>
                    </>
                  ) : null}

                  {detail.kind === "doctor" ? (
                    <>
                      <AdminTableCard title={titleWithDot(text.doctors.title)}>
                        <div className="grid gap-2.5 p-3 sm:grid-cols-2">
                          <div className={card("p-3")}>
                            <p className="text-xs text-muted-foreground">{text.medicalProviders.title}</p>
                            <p className="mt-1 text-sm font-medium text-foreground">{detail.row.provider_name}</p>
                          </div>
                          <div className={card("p-3")}>
                            <p className="text-xs text-muted-foreground">{text.common.specialties}</p>
                            <p className="mt-1 text-sm font-medium text-foreground">
                              {reportDoctorSpecialtyLabel(detail.row, lang, text.unknown)}
                            </p>
                          </div>
                          <div className={card("p-3")}>
                            <p className="text-xs text-muted-foreground">{text.common.patients90d}</p>
                            <p className="mt-1 text-sm font-medium text-foreground">{detail.row.active_patients_90d}</p>
                          </div>
                          <div className={card("p-3")}>
                            <p className="text-xs text-muted-foreground">{text.common.appointments90d}</p>
                            <p className="mt-1 text-sm font-medium text-foreground">{detail.row.appointments_90d}</p>
                          </div>
                          <div className={card("p-3")}>
                            <p className="text-xs text-muted-foreground">{text.common.feedbackCount}</p>
                            <p className="mt-1 text-sm font-medium text-foreground">{detail.row.feedback_count}</p>
                          </div>
                          <div className={card("p-3")}>
                            <p className="text-xs text-muted-foreground">{text.common.followupCompletion}</p>
                            <p className="mt-1 text-sm font-medium text-foreground">
                              {formatPercent(detail.row.followup_completion_rate, text.noBaseline)}
                            </p>
                          </div>
                        </div>
                      </AdminTableCard>
                      <StaffLink to={`/providers/${detail.row.provider_id}?return_to=/reports`}>
                        <Button variant="outline">{text.openProvider}</Button>
                      </StaffLink>
                    </>
                  ) : null}

                  {detail.kind === "provider_cost" ? (
                    <>
                      <AdminTableCard title={titleWithDot(text.providerCosts.title)}>
                        <div className="grid gap-2.5 p-3 sm:grid-cols-2">
                          <div className={card("p-3")}>
                            <p className="text-xs text-muted-foreground">{text.medicalProviders.title}</p>
                            <p className="mt-1 text-sm font-medium text-foreground">{detail.row.provider_name}</p>
                          </div>
                          <div className={card("p-3")}>
                            <p className="text-xs text-muted-foreground">{text.common.samples}</p>
                            <p className="mt-1 text-sm font-medium text-foreground">{detail.row.sample_count}</p>
                          </div>
                          <div className={card("p-3")}>
                            <p className="text-xs text-muted-foreground">{text.common.latestVsFirst}</p>
                            <p className="mt-1 text-sm font-medium text-foreground">
                              {formatChange(detail.row.change_pct, text.noBaseline)}
                            </p>
                          </div>
                          <div className={card("p-3")}>
                            <p className="text-xs text-muted-foreground">{text.common.average}</p>
                            <p className="mt-1 text-sm font-medium text-foreground">
                              {formatMoneyMetric(detail.row.avg_unit_gross, locale)}
                            </p>
                          </div>
                          <div className={card("p-3")}>
                            <p className="text-xs text-muted-foreground">{text.common.min}</p>
                            <p className="mt-1 text-sm font-medium text-foreground">
                              {formatReportDate(detail.row.first_recorded_at, locale, text.unknown)}
                            </p>
                          </div>
                          <div className={card("p-3")}>
                            <p className="text-xs text-muted-foreground">{text.common.latest}</p>
                            <p className="mt-1 text-sm font-medium text-foreground">
                              {formatReportDate(detail.row.last_recorded_at, locale, text.unknown)}
                            </p>
                          </div>
                        </div>
                      </AdminTableCard>
                      {detail.row.trend_points.length > 0 ? (
                        <AdminTableCard title={titleWithDot(text.forecast.pipelineTitle)}>
                          <div className="flex flex-wrap gap-2 p-3">
                            {detail.row.trend_points.map((point) => (
                              <Badge key={`${detail.row.provider_id}-${detail.row.service_label}-${point.month}`} variant="secondary">
                                {point.month}: {formatMoneyMetric(point.avg_unit_gross, locale)}
                              </Badge>
                            ))}
                          </div>
                        </AdminTableCard>
                      ) : null}
                      <StaffLink to={`/providers/${detail.row.provider_id}?return_to=/reports`}>
                        <Button variant="outline">{text.openProvider}</Button>
                      </StaffLink>
                    </>
                  ) : null}
                </AdminSheetScaffold>
              ) : null}
            </SheetContent>
          </Sheet>
        </>
      ) : null}
    </div>
  );
}

export function ReportsPage(...args: Parameters<typeof useReportsPageContent>) {
  return useReportsPageContent(...args);
}
