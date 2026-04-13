import { useEffect, useMemo, useState, type ElementType } from "react";
import { Link } from "react-router-dom";
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
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiFetch, getAccessToken } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

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
};

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
};

type DoctorReportRow = {
  doctor_id: string;
  provider_id: string;
  name: string;
  title?: string | null;
  fachbereich?: string | null;
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
};

type NonMedicalProviderReportRow = {
  provider_id: string;
  name: string;
  address_city?: string | null;
  address_country?: string | null;
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
  doctors: DoctorReportRow[];
  non_medical_providers: NonMedicalProviderReportRow[];
  financial_metrics_visible: boolean;
};

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

function card(extra?: string) {
  return cn(
    "rounded-[1.75rem] border border-border/70 bg-card shadow-[0_20px_60px_rgba(15,23,42,0.05)]",
    extra,
  );
}

function metricCard(label: string, value: string | number, icon: ElementType) {
  const Icon = icon;
  return (
    <article className="rounded-[1.5rem] border border-white/90 bg-white/88 p-4 shadow-sm backdrop-blur">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">{label}</p>
        <span className="rounded-2xl bg-slate-100 p-2 text-slate-700">
          <Icon className="size-4" />
        </span>
      </div>
      <p className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
    </article>
  );
}

function formatMoney(value?: string | null) {
  const numeric = Number(value ?? 0);
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(numeric) ? numeric : 0);
}

function formatMoneyMetric(value?: string | number | null) {
  const numeric =
    typeof value === "number" ? value : Number(value ?? 0);
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(numeric) ? numeric : 0);
}

function formatRating(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) return "Not rated";
  return `${value.toFixed(1)}/5`;
}

function formatPercent(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) return "No baseline";
  return `${value.toFixed(1)}%`;
}

function formatHours(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) return "No responses";
  return `${value.toFixed(1)} h`;
}

function formatChange(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) return "No baseline";
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(1)}%`;
}

function serviceTypeLabel(value: string) {
  if (value === "medical") return "Medical";
  if (value === "non_medical") return "Non-medical";
  if (value === "cost_passthrough") return "Cost passthrough";
  return value.replaceAll("_", " ");
}

function roleCanOpenReports(role?: string) {
  return (
    role === "ceo" ||
    role === "ceo_assistant" ||
    role === "patient_manager" ||
    role === "billing" ||
    role === "sales"
  );
}

export function ReportsPage() {
  const { user } = useAuth();
  const [data, setData] = useState<ReportsWorkspacePayload | null>(null);
  const [forecasting, setForecasting] = useState<ForecastingPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [selectedClinicId, setSelectedClinicId] = useState<string>("");
  const [exportingSection, setExportingSection] = useState<string>("");

  useEffect(() => {
    if (!roleCanOpenReports(user?.role)) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function load() {
      if (loading) setRefreshing(false);
      else setRefreshing(true);

      try {
        const [payload, forecastPayload] = await Promise.all([
          apiFetch<ReportsWorkspacePayload>("/stats/reports/workspace"),
          apiFetch<ForecastingPayload>("/stats/forecasting"),
        ]);
        if (!cancelled) {
          setData(payload);
          setForecasting(forecastPayload);
          setError("");
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load reports workspace.");
          setForecasting(null);
        }
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
  }, [loading, user?.role, version]);

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
    setExportingSection(section);
    setError("");

    try {
      const token = getAccessToken();
      const params = new URLSearchParams({ section });
      if ((section === "doctors" || section === "provider_costs") && selectedClinicId) {
        params.set("provider_id", selectedClinicId);
      }

      const response = await fetch(`/api/v1/stats/reports/export?${params.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!response.ok) {
        throw new Error(await response.text() || "Failed to export report.");
      }

      const blob = await response.blob();
      const filename =
        response.headers
          .get("Content-Disposition")
          ?.match(/filename="?([^";]+)"?/)?.[1] ??
        `${section}.csv`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to export report.");
    } finally {
      setExportingSection("");
    }
  }

  if (!roleCanOpenReports(user?.role)) {
    return (
      <div className="space-y-6">
        <section className={card("px-6 py-10 text-center")}>
          <h1 className="text-2xl font-semibold text-slate-950">Reports</h1>
          <p className="mt-3 text-sm text-slate-500">
            This workspace is available for executive, patient-manager, billing and sales roles.
          </p>
        </section>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex items-center gap-3 rounded-full border border-slate-200 bg-white px-5 py-3 text-sm text-slate-500 shadow-sm">
          <LoaderCircle className="size-4 animate-spin" />
          Loading reports workspace...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className={card("bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.14),_transparent_34%),linear-gradient(135deg,#0f172a_0%,#111827_54%,#14532d_100%)] px-6 py-6 text-white")}>
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-sm uppercase tracking-[0.18em] text-white/60">Analytics</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">Reports workspace</h1>
            <p className="mt-3 text-sm leading-7 text-white/75">
              Structured reporting by clinics, doctors, patient countries and delivered service types with role-scoped financial visibility and CSV export.
            </p>
          </div>
          <Button
            variant="outline"
            className="border-white/15 bg-white/8 text-white hover:bg-white/12 hover:text-white"
            onClick={() => setVersion((value) => value + 1)}
          >
            {refreshing ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Refresh
          </Button>
        </div>
      </section>

      {error ? (
        <section className={card("border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700")}>
          {error}
        </section>
      ) : null}

      {data ? (
        <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            {metricCard("Active patients", data.summary.active_patients, Globe2)}
            {metricCard("Active orders", data.summary.active_orders, Rows3)}
            {metricCard("Active clinics", data.summary.active_clinics, Building2)}
            {metricCard("Delivered service items", data.summary.delivered_service_items, BarChart3)}
            {metricCard(
              "Delivered service volume",
              data.summary.delivered_service_volume ? formatMoney(data.summary.delivered_service_volume) : "Role-scoped",
              BarChart3,
            )}
          </section>

          {forecasting ? (
            <>
              <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {metricCard("Open quotes", forecasting.summary.open_quotes, Activity)}
                {metricCard(
                  "Pipeline gross",
                  forecasting.summary.pipeline_gross_total
                    ? formatMoney(forecasting.summary.pipeline_gross_total)
                    : "Counts only",
                  Wallet,
                )}
                {metricCard(
                  "Milestones / 30d",
                  forecasting.summary.followup_milestones_next_30d,
                  CalendarDays,
                )}
                {metricCard(
                  "Appointments / 30d",
                  forecasting.summary.appointments_next_30d,
                  BarChart3,
                )}
              </section>

              <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
                {forecastSections.has("quote_pipeline") && forecasting.quote_pipeline ? (
                  <section className={card("p-6")}>
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h2 className="text-base font-semibold text-slate-950">Forecast pipeline</h2>
                        <p className="mt-1 text-sm text-slate-500">
                          Open quote volume with simple weighting by quote maturity and near-term expiry pressure.
                        </p>
                      </div>
                      <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100">
                        {forecasting.quote_pipeline.open_quotes} quotes
                      </Badge>
                    </div>
                    <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                        <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Expiring / 14d</p>
                        <p className="mt-2 text-sm font-semibold text-slate-950">{forecasting.quote_pipeline.expiring_next_14d}</p>
                      </div>
                      <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                        <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Gross pipeline</p>
                        <p className="mt-2 text-sm font-semibold text-slate-950">
                          {forecasting.quote_pipeline.gross_total ? formatMoney(forecasting.quote_pipeline.gross_total) : "Counts only"}
                        </p>
                      </div>
                      <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                        <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Weighted</p>
                        <p className="mt-2 text-sm font-semibold text-slate-950">
                          {forecasting.quote_pipeline.weighted_gross ? formatMoney(forecasting.quote_pipeline.weighted_gross) : "Counts only"}
                        </p>
                      </div>
                      <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                        <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Read model</p>
                        <p className="mt-2 text-sm font-semibold text-slate-950">Draft 25% / Sent 60% / Accepted 100%</p>
                      </div>
                    </div>
                    <div className="mt-5 space-y-3">
                      {forecasting.quote_pipeline.by_status.map((item) => (
                        <article key={item.status} className="rounded-[1.25rem] border border-slate-200 bg-white px-4 py-4 shadow-sm">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-slate-950">{item.status}</p>
                              <p className="mt-1 text-sm text-slate-500">{item.quote_count} quote(s) / {item.expiring_next_14d} expiring within 14 days</p>
                            </div>
                            <div className="text-right text-sm text-slate-600">
                              <div>{item.gross_total ? formatMoney(item.gross_total) : "Counts only"}</div>
                              <div className="mt-1">{item.weighted_gross ? `${formatMoney(item.weighted_gross)} weighted` : "Weighted hidden"}</div>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                ) : null}

                <div className="space-y-6">
                  {forecastSections.has("collections") && forecasting.collections ? (
                    <section className={card("p-6")}>
                      <h2 className="text-base font-semibold text-slate-950">Collections forecast</h2>
                      <p className="mt-1 text-sm text-slate-500">
                        What is due soon, already overdue and still trapped in debt-management.
                      </p>
                      <div className="mt-5 grid gap-3 sm:grid-cols-2">
                        <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                          <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Due / 14d</p>
                          <p className="mt-2 text-sm font-semibold text-slate-950">
                            {forecasting.collections.due_next_14d_count} / {forecasting.collections.due_next_14d_total ? formatMoney(forecasting.collections.due_next_14d_total) : "Counts only"}
                          </p>
                        </div>
                        <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                          <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Overdue</p>
                          <p className="mt-2 text-sm font-semibold text-slate-950">
                            {forecasting.collections.overdue_invoice_count} / {forecasting.collections.overdue_open_total ? formatMoney(forecasting.collections.overdue_open_total) : "Counts only"}
                          </p>
                        </div>
                        <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                          <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Debt workflows</p>
                          <p className="mt-2 text-sm font-semibold text-slate-950">
                            {forecasting.collections.workflow_open_count} open / {forecasting.collections.reviews_due_7d} review within 7d
                          </p>
                        </div>
                        <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                          <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Escalation split</p>
                          <p className="mt-2 text-sm font-semibold text-slate-950">
                            {forecasting.collections.payment_plan_count} payment plan / {forecasting.collections.escalated_count} escalated
                          </p>
                        </div>
                      </div>
                    </section>
                  ) : null}

                  {forecastSections.has("followup") && forecasting.followup ? (
                    <section className={card("p-6")}>
                      <h2 className="text-base font-semibold text-slate-950">Follow-up forecast</h2>
                      <p className="mt-1 text-sm text-slate-500">
                        Milestones due in the next 30 days based on current order follow-up states.
                      </p>
                      <div className="mt-5 grid gap-3 sm:grid-cols-2">
                        <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                          <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Active follow-up orders</p>
                          <p className="mt-2 text-sm font-semibold text-slate-950">{forecasting.followup.active_orders}</p>
                        </div>
                        <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                          <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Milestones / 30d</p>
                          <p className="mt-2 text-sm font-semibold text-slate-950">{forecasting.followup.milestones_due_next_30d}</p>
                        </div>
                        <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                          <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">1w / 1m / 6m</p>
                          <p className="mt-2 text-sm font-semibold text-slate-950">
                            {forecasting.followup.followup_1w_due_next_30d} / {forecasting.followup.followup_1m_due_next_30d} / {forecasting.followup.followup_6m_due_next_30d}
                          </p>
                        </div>
                        <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                          <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Doctor / package-end / results</p>
                          <p className="mt-2 text-sm font-semibold text-slate-950">
                            {forecasting.followup.doctor_followup_open} / {forecasting.followup.package_end_due_next_30d} / {forecasting.followup.results_handoff_pending}
                          </p>
                        </div>
                      </div>
                    </section>
                  ) : null}
                </div>
              </section>

              {forecastSections.has("clinic_capacity") && forecasting.clinic_capacity ? (
                <section className={card("p-6")}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-base font-semibold text-slate-950">Clinic capacity next 30 days</h2>
                      <p className="mt-1 text-sm text-slate-500">
                        Forward-looking clinic load from planned/confirmed appointments and follow-up demand.
                      </p>
                    </div>
                    <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100">
                      {forecasting.clinic_capacity.active_clinics} clinics / {forecasting.clinic_capacity.appointments_next_30d_total} appointments
                    </Badge>
                  </div>
                  <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {forecasting.clinic_capacity.clinics.map((item) => (
                      <article key={item.provider_id} className="rounded-[1.25rem] border border-slate-200 bg-white px-4 py-4 shadow-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-slate-950">{item.name}</p>
                            <p className="mt-1 text-sm text-slate-500">{item.address_city || "Location not set"}</p>
                          </div>
                          <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100">
                            {item.doctor_count} doctors
                          </Badge>
                        </div>
                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                            <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Appointments / 30d</p>
                            <p className="mt-2 text-sm font-semibold text-slate-950">{item.appointments_next_30d}</p>
                          </div>
                          <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                            <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Follow-up / 30d</p>
                            <p className="mt-2 text-sm font-semibold text-slate-950">{item.followup_appointments_next_30d}</p>
                          </div>
                          <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                            <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Patients / 30d</p>
                            <p className="mt-2 text-sm font-semibold text-slate-950">{item.patients_next_30d}</p>
                          </div>
                          <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                            <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Orders / 30d</p>
                            <p className="mt-2 text-sm font-semibold text-slate-950">{item.active_orders_next_30d}</p>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}
            </>
          ) : null}

          <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="space-y-6">
              {allowedSections.has("clinics") ? (
                <section className={card("p-6")}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-base font-semibold text-slate-950">Clinic report</h2>
                      <p className="mt-1 text-sm text-slate-500">
                        Medical partner clinics ranked by recent activity, delivered items, communication response speed and provider-quality signals from feedback and follow-up completion.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100">
                        {data.clinics.length}
                      </Badge>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={exportingSection === "clinics"}
                        onClick={() => void exportSection("clinics")}
                      >
                        {exportingSection === "clinics" ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
                        Export CSV
                      </Button>
                    </div>
                  </div>
                  <div className="mt-5 space-y-3">
                    {data.clinics.length > 0 ? (
                      data.clinics.map((item) => (
                        <article key={item.provider_id} className="rounded-[1.5rem] border border-slate-200 bg-white px-4 py-4 shadow-sm">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-semibold text-slate-950">{item.name}</p>
                                <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100">
                                  {item.provider_type}
                                </Badge>
                              </div>
                              <p className="mt-2 text-sm text-slate-500">
                                {[item.address_city, item.address_country].filter(Boolean).join(", ") || "Location not set"}
                              </p>
                            </div>
                            {item.gross_service_volume ? (
                              <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                                {formatMoney(item.gross_service_volume)}
                              </Badge>
                            ) : (
                              <Badge className="bg-slate-100 text-slate-600 hover:bg-slate-100">
                                Counts only
                              </Badge>
                            )}
                          </div>
                          <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-4">
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Patients / 90d</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{item.active_patients_90d}</p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Appointments / 90d</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{item.appointments_90d}</p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Delivered items</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{item.delivered_items}</p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Doctors</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{item.doctor_count}</p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Feedback</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{formatRating(item.avg_feedback_score)}</p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Feedback count</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{item.feedback_count}</p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Treatment score</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{formatRating(item.avg_treatment_score)}</p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Doctor communication</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{formatRating(item.avg_doctor_score)}</p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Clinic response time</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{formatHours(item.avg_response_hours)}</p>
                              <p className="mt-1 text-[11px] text-slate-500">
                                {item.response_sample_count} answered · {item.open_communication_count} open
                              </p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Written findings</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{formatHours(item.avg_findings_turnaround_hours)}</p>
                              <p className="mt-1 text-[11px] text-slate-500">
                                {item.findings_sample_count} linked Arztbrief
                              </p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Follow-up completion</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">
                                {formatPercent(item.followup_completion_rate)}
                              </p>
                              <p className="mt-1 text-[11px] text-slate-500">
                                {item.followup_completed_orders}/{item.followup_orders_total} orders
                              </p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Clinical outcome</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">
                                {formatPercent(item.treatment_success_yes_rate)} yes
                              </p>
                              <p className="mt-1 text-[11px] text-slate-500">
                                {formatPercent(item.treatment_success_partial_rate)} partial · {formatPercent(item.complication_rate)} complications
                              </p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3 md:col-span-2 xl:col-span-2">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Experience bundle</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">
                                Org {formatRating(item.avg_organization_score)} · Service {formatRating(item.avg_service_score)}
                              </p>
                              <p className="mt-1 text-[11px] text-slate-500">
                                Ambience {formatRating(item.avg_infrastructure_score)} · Value {formatRating(item.avg_price_value_score)}
                              </p>
                            </div>
                          </div>
                          <div className="mt-4 flex flex-wrap gap-2">
                            <Button
                              variant={selectedClinicId === item.provider_id ? "default" : "outline"}
                              size="sm"
                              onClick={() =>
                                setSelectedClinicId((current) =>
                                  current === item.provider_id ? "" : item.provider_id,
                                )
                              }
                            >
                              {selectedClinicId === item.provider_id ? "Clear drill-down" : "Drill into doctors"}
                            </Button>
                            <Link to={`/providers?provider=${item.provider_id}`}>
                              <Button variant="outline" size="sm">Open provider</Button>
                            </Link>
                          </div>
                        </article>
                      ))
                    ) : (
                      <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-8 text-center text-sm text-slate-500">
                        No clinic report data available yet.
                      </div>
                    )}
                  </div>
                </section>
              ) : null}

              {allowedSections.has("service_types") ? (
                <section className={card("p-6")}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-base font-semibold text-slate-950">Service type report</h2>
                      <p className="mt-1 text-sm text-slate-500">
                        Delivered medical, non-medical and passthrough work volume by service class.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100">
                        {data.service_types.length}
                      </Badge>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={exportingSection === "service_types"}
                        onClick={() => void exportSection("service_types")}
                      >
                        {exportingSection === "service_types" ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
                        Export CSV
                      </Button>
                    </div>
                  </div>
                  <div className="mt-5 space-y-3">
                    {data.service_types.length > 0 ? (
                      data.service_types.map((item) => (
                        <article key={item.service_type} className="rounded-[1.5rem] border border-slate-200 bg-white px-4 py-4 shadow-sm">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-slate-950">{serviceTypeLabel(item.service_type)}</p>
                              <p className="mt-2 text-sm text-slate-500">
                                {item.item_count} items · {item.order_count} orders · {item.patient_count} patients
                              </p>
                            </div>
                            {item.gross_total ? (
                              <Badge className="bg-sky-100 text-sky-700 hover:bg-sky-100">
                                {formatMoney(item.gross_total)}
                              </Badge>
                            ) : (
                              <Badge className="bg-slate-100 text-slate-600 hover:bg-slate-100">
                                Counts only
                              </Badge>
                            )}
                          </div>
                        </article>
                      ))
                    ) : (
                      <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-8 text-center text-sm text-slate-500">
                        No service type report data available yet.
                      </div>
                    )}
                  </div>
                </section>
              ) : null}

              {allowedSections.has("medical_providers") ? (
                <section className={card("p-6")}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-base font-semibold text-slate-950">Medical provider performance</h2>
                      <p className="mt-1 text-sm text-slate-500">
                        Partner-facing clinic activity and revenue view for service mix, patient geography and sales comparisons without patient-level detail.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100">
                        {data.medical_providers.length}
                      </Badge>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={exportingSection === "medical_providers"}
                        onClick={() => void exportSection("medical_providers")}
                      >
                        {exportingSection === "medical_providers" ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
                        Export CSV
                      </Button>
                    </div>
                  </div>
                  <div className="mt-5 space-y-3">
                    {data.medical_providers.length > 0 ? (
                      data.medical_providers.map((item) => (
                        <article key={item.provider_id} className="rounded-[1.5rem] border border-slate-200 bg-white px-4 py-4 shadow-sm">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-slate-950">{item.name}</p>
                              <p className="mt-2 text-sm text-slate-500">
                                {[item.address_city, item.address_country].filter(Boolean).join(", ") || "Location not set"}
                              </p>
                            </div>
                            <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                              {formatMoney(item.gross_service_volume ?? "0")}
                            </Badge>
                          </div>
                          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Patients / 90d</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{item.active_patients_90d}</p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Appointments / 90d</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{item.appointments_90d}</p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Orders / delivered</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{item.active_orders} / {item.delivered_items}</p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Doctor network</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{item.doctor_count}</p>
                              <p className="mt-1 text-[11px] text-slate-500">
                                {item.last_activity_at ? `Last activity ${new Date(item.last_activity_at).toLocaleDateString("de-DE")}` : "No recent activity"}
                              </p>
                            </div>
                          </div>
                          <div className="mt-4 space-y-3">
                            <div>
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Specialties</p>
                              <div className="mt-2 flex flex-wrap gap-2">
                                {item.doctor_specialties.length > 0 ? (
                                  item.doctor_specialties.map((specialty) => (
                                    <Badge key={`${item.provider_id}-${specialty}`} className="bg-slate-100 text-slate-700 hover:bg-slate-100">
                                      {specialty}
                                    </Badge>
                                  ))
                                ) : (
                                  <Badge className="bg-slate-100 text-slate-600 hover:bg-slate-100">No specialty data</Badge>
                                )}
                              </div>
                            </div>
                            <div>
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Service mix</p>
                              <div className="mt-2 flex flex-wrap gap-2">
                                {item.service_focus.length > 0 ? (
                                  item.service_focus.map((service) => (
                                    <Badge key={`${item.provider_id}-${service}`} className="bg-slate-100 text-slate-700 hover:bg-slate-100">
                                      {service}
                                    </Badge>
                                  ))
                                ) : (
                                  <Badge className="bg-slate-100 text-slate-600 hover:bg-slate-100">No delivered services yet</Badge>
                                )}
                              </div>
                            </div>
                            <div>
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Patient country mix</p>
                              <div className="mt-2 flex flex-wrap gap-2">
                                {item.patient_country_mix.length > 0 ? (
                                  item.patient_country_mix.map((country) => (
                                    <Badge key={`${item.provider_id}-${country}`} className="bg-sky-100 text-sky-700 hover:bg-sky-100">
                                      {country}
                                    </Badge>
                                  ))
                                ) : (
                                  <Badge className="bg-slate-100 text-slate-600 hover:bg-slate-100">No country data</Badge>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="mt-4 flex flex-wrap gap-2">
                            <Link to={`/providers?provider=${item.provider_id}`}>
                              <Button variant="outline" size="sm">Open provider</Button>
                            </Link>
                          </div>
                        </article>
                      ))
                    ) : (
                      <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-8 text-center text-sm text-slate-500">
                        No medical provider report data available yet.
                      </div>
                    )}
                  </div>
                </section>
              ) : null}

              {allowedSections.has("provider_costs") ? (
                <section className={card("p-6")}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-base font-semibold text-slate-950">Provider cost intelligence</h2>
                      <p className="mt-1 text-sm text-slate-500">
                        Historical unit-cost movement by clinic and delivered service to support pricing estimates and market comparisons.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {selectedClinic ? (
                        <Badge className="bg-sky-100 text-sky-700 hover:bg-sky-100">
                          {selectedClinic.name}
                        </Badge>
                      ) : null}
                      <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100">
                        {visibleProviderCosts.length}
                      </Badge>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={exportingSection === "provider_costs"}
                        onClick={() => void exportSection("provider_costs")}
                      >
                        {exportingSection === "provider_costs" ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
                        Export CSV
                      </Button>
                    </div>
                  </div>
                  <div className="mt-5 space-y-3">
                    {visibleProviderCosts.length > 0 ? (
                      visibleProviderCosts.map((item) => (
                        <article key={`${item.provider_id}-${item.service_label}`} className="rounded-[1.5rem] border border-slate-200 bg-white px-4 py-4 shadow-sm">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-slate-950">{item.service_label}</p>
                              <p className="mt-2 text-sm text-slate-500">
                                {item.provider_name}
                                {item.address_city || item.address_country
                                  ? ` · ${[item.address_city, item.address_country].filter(Boolean).join(", ")}`
                                  : ""}
                              </p>
                            </div>
                            <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                              {formatMoneyMetric(item.latest_unit_gross)}
                            </Badge>
                          </div>
                          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Samples</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{item.sample_count}</p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Latest vs first</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{formatChange(item.change_pct)}</p>
                              <p className="mt-1 text-[11px] text-slate-500">
                                {formatMoneyMetric(item.earliest_unit_gross)} → {formatMoneyMetric(item.latest_unit_gross)}
                              </p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Average</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{formatMoneyMetric(item.avg_unit_gross)}</p>
                              <p className="mt-1 text-[11px] text-slate-500">
                                Min {formatMoneyMetric(item.min_unit_gross)} · Max {formatMoneyMetric(item.max_unit_gross)}
                              </p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Observed range</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">
                                {item.first_recorded_at ? new Date(item.first_recorded_at).toLocaleDateString("de-DE") : "Unknown"}
                              </p>
                              <p className="mt-1 text-[11px] text-slate-500">
                                latest {item.last_recorded_at ? new Date(item.last_recorded_at).toLocaleDateString("de-DE") : "Unknown"}
                              </p>
                            </div>
                          </div>
                          {item.trend_points.length > 0 ? (
                            <div className="mt-4 flex flex-wrap gap-2">
                              {item.trend_points.map((point) => (
                                <Badge
                                  key={`${item.provider_id}-${item.service_label}-${point.month}`}
                                  className="bg-slate-100 text-slate-700 hover:bg-slate-100"
                                >
                                  {point.month}: {formatMoneyMetric(point.avg_unit_gross)}
                                </Badge>
                              ))}
                            </div>
                          ) : null}
                        </article>
                      ))
                    ) : (
                      <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-8 text-center text-sm text-slate-500">
                        No provider cost intelligence data available yet.
                      </div>
                    )}
                  </div>
                </section>
              ) : null}

              {allowedSections.has("non_medical_providers") ? (
                <section className={card("p-6")}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-base font-semibold text-slate-950">Non-medical provider report</h2>
                      <p className="mt-1 text-sm text-slate-500">
                        Concierge-facing partner volume across service portfolio, live request load, patient reach and feedback.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100">
                        {data.non_medical_providers.length}
                      </Badge>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={exportingSection === "non_medical_providers"}
                        onClick={() => void exportSection("non_medical_providers")}
                      >
                        {exportingSection === "non_medical_providers" ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
                        Export CSV
                      </Button>
                    </div>
                  </div>
                  <div className="mt-5 space-y-3">
                    {data.non_medical_providers.length > 0 ? (
                      data.non_medical_providers.map((item) => (
                        <article key={item.provider_id} className="rounded-[1.5rem] border border-slate-200 bg-white px-4 py-4 shadow-sm">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-slate-950">{item.name}</p>
                              <p className="mt-2 text-sm text-slate-500">
                                {[item.address_city, item.address_country].filter(Boolean).join(", ") || "Location not set"}
                              </p>
                            </div>
                            {item.gross_service_volume ? (
                              <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                                {formatMoney(item.gross_service_volume)}
                              </Badge>
                            ) : (
                              <Badge className="bg-slate-100 text-slate-600 hover:bg-slate-100">
                                Counts only
                              </Badge>
                            )}
                          </div>
                          <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-4">
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Services</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{item.service_count}</p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Patients / 90d</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{item.active_patients_90d}</p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Appointments / 90d</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{item.appointments_90d}</p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Concierge requests / 90d</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{item.concierge_requests_90d}</p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Open requests</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{item.open_concierge_requests}</p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Completed / 90d</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{item.completed_concierge_requests_90d}</p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Delivered items</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{item.delivered_items}</p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Concierge score</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{formatRating(item.avg_concierge_score)}</p>
                              <p className="mt-1 text-[11px] text-slate-500">{item.feedback_count} feedback / {item.vendor_count} vendors</p>
                            </div>
                          </div>
                          {item.service_focus.length > 0 ? (
                            <div className="mt-4 flex flex-wrap gap-2">
                              {item.service_focus.map((service) => (
                                <Badge key={`${item.provider_id}-${service}`} className="bg-slate-100 text-slate-700 hover:bg-slate-100">
                                  {service}
                                </Badge>
                              ))}
                            </div>
                          ) : null}
                          <div className="mt-4 flex flex-wrap gap-2">
                            <Link to={`/providers?provider=${item.provider_id}`}>
                              <Button variant="outline" size="sm">Open provider</Button>
                            </Link>
                          </div>
                        </article>
                      ))
                    ) : (
                      <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-8 text-center text-sm text-slate-500">
                        No non-medical provider report data available yet.
                      </div>
                    )}
                  </div>
                </section>
              ) : null}
            </div>

            <div className="space-y-6">
              {allowedSections.has("countries") ? (
                <section className={card("p-6")}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-base font-semibold text-slate-950">Country report</h2>
                      <p className="mt-1 text-sm text-slate-500">
                        Patient geography grouped by active profiles and current order demand.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100">
                        {data.countries.length}
                      </Badge>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={exportingSection === "countries"}
                        onClick={() => void exportSection("countries")}
                      >
                        {exportingSection === "countries" ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
                        Export CSV
                      </Button>
                    </div>
                  </div>
                  <div className="mt-5 space-y-3">
                    {data.countries.length > 0 ? (
                      data.countries.map((item) => (
                        <article key={item.country} className="rounded-[1.5rem] border border-slate-200 bg-white px-4 py-4 shadow-sm">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-slate-950">{item.country}</p>
                              <p className="mt-2 text-sm text-slate-500">
                                {item.patient_count} active patients · {item.active_orders} active orders
                              </p>
                            </div>
                            {item.gross_invoiced ? (
                              <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                                {formatMoney(item.gross_invoiced)}
                              </Badge>
                            ) : (
                              <Badge className="bg-slate-100 text-slate-600 hover:bg-slate-100">
                                Counts only
                              </Badge>
                            )}
                          </div>
                        </article>
                      ))
                    ) : (
                      <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-8 text-center text-sm text-slate-500">
                        No country report data available yet.
                      </div>
                    )}
                  </div>
                </section>
              ) : null}

              {allowedSections.has("doctors") ? (
                <section className={card("p-6")}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-base font-semibold text-slate-950">Doctor drill-down</h2>
                      <p className="mt-1 text-sm text-slate-500">
                        Doctor-level activity, patient reach, response speed and quality signals based on direct feedback and follow-up execution. Use clinic drill-down to narrow to one provider.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {selectedClinic ? (
                        <Badge className="bg-sky-100 text-sky-700 hover:bg-sky-100">
                          {selectedClinic.name}
                        </Badge>
                      ) : null}
                      <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100">
                        {visibleDoctors.length}
                      </Badge>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={exportingSection === "doctors"}
                        onClick={() => void exportSection("doctors")}
                      >
                        {exportingSection === "doctors" ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
                        Export CSV
                      </Button>
                    </div>
                  </div>
                  <div className="mt-5 space-y-3">
                    {visibleDoctors.length > 0 ? (
                      visibleDoctors.map((item) => (
                        <article key={item.doctor_id} className="rounded-[1.5rem] border border-slate-200 bg-white px-4 py-4 shadow-sm">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-semibold text-slate-950">
                                  {[item.title, item.name].filter(Boolean).join(" ")}
                                </p>
                                {item.fachbereich ? (
                                  <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100">{item.fachbereich}</Badge>
                                ) : null}
                              </div>
                              <p className="mt-2 text-sm text-slate-500">
                                {item.provider_name}
                                {item.address_city || item.address_country
                                  ? ` · ${[item.address_city, item.address_country].filter(Boolean).join(", ")}`
                                  : ""}
                              </p>
                            </div>
                            {item.gross_service_volume ? (
                              <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                                {formatMoney(item.gross_service_volume)}
                              </Badge>
                            ) : (
                              <Badge className="bg-slate-100 text-slate-600 hover:bg-slate-100">
                                Counts only
                              </Badge>
                            )}
                          </div>
                          <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-4">
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Patients / 90d</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{item.active_patients_90d}</p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Appointments / 90d</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{item.appointments_90d}</p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Orders</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{item.active_orders}</p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Delivered items</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{item.delivered_items}</p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Feedback count</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{item.feedback_count}</p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Treatment score</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{formatRating(item.avg_treatment_score)}</p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Doctor communication</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{formatRating(item.avg_doctor_score)}</p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Doctor response time</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{formatHours(item.avg_response_hours)}</p>
                              <p className="mt-1 text-[11px] text-slate-500">
                                {item.response_sample_count} answered · {item.open_communication_count} open
                              </p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Written findings</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{formatHours(item.avg_findings_turnaround_hours)}</p>
                              <p className="mt-1 text-[11px] text-slate-500">
                                {item.findings_sample_count} linked Arztbrief
                              </p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Follow-up completion</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">
                                {formatPercent(item.followup_completion_rate)}
                              </p>
                              <p className="mt-1 text-[11px] text-slate-500">
                                {item.followup_completed_orders}/{item.followup_orders_total} orders
                              </p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Clinical outcome</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">
                                {formatPercent(item.treatment_success_yes_rate)} yes
                              </p>
                              <p className="mt-1 text-[11px] text-slate-500">
                                {formatPercent(item.treatment_success_partial_rate)} partial · {formatPercent(item.complication_rate)} complications
                              </p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3 md:col-span-2 xl:col-span-2">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Experience bundle</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">
                                Org {formatRating(item.avg_organization_score)} · Service {formatRating(item.avg_service_score)}
                              </p>
                              <p className="mt-1 text-[11px] text-slate-500">
                                Ambience {formatRating(item.avg_infrastructure_score)} · Value {formatRating(item.avg_price_value_score)}
                              </p>
                            </div>
                          </div>
                        </article>
                      ))
                    ) : (
                      <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-8 text-center text-sm text-slate-500">
                        No doctor drill-down data available for the selected scope.
                      </div>
                    )}
                  </div>
                </section>
              ) : null}

              <section className={card("p-6")}>
                <h2 className="text-base font-semibold text-slate-950">Visibility</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Sections and financial metrics are trimmed by the current role. This page intentionally uses the backend read-model instead of client-only filtering.
                </p>
                <div className="mt-5 flex flex-wrap gap-2">
                  {data.allowed_sections.map((item) => (
                    <Badge key={item} className="bg-slate-100 text-slate-700 hover:bg-slate-100">
                      {item.replaceAll("_", " ")}
                    </Badge>
                  ))}
                  <Badge
                    className={
                      data.financial_metrics_visible
                        ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100"
                        : "bg-amber-100 text-amber-700 hover:bg-amber-100"
                    }
                  >
                    {data.financial_metrics_visible ? "Financial metrics visible" : "Counts-only mode"}
                  </Badge>
                </div>
              </section>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
