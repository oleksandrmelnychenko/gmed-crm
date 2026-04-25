import { useEffect, useMemo, useState, type ElementType } from "react";
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

import { StaffLink } from "@/components/staff-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiFetch, buildApiUrl, getAccessToken } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
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

function formatMoney(value?: string | null, locale = "de-DE") {
  const numeric = Number(value ?? 0);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(numeric) ? numeric : 0);
}

function formatMoneyMetric(value?: string | number | null, locale = "de-DE") {
  const numeric =
    typeof value === "number" ? value : Number(value ?? 0);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(numeric) ? numeric : 0);
}

function formatRating(value?: number | null, emptyLabel = "-") {
  if (typeof value !== "number" || Number.isNaN(value)) return emptyLabel;
  return `${value.toFixed(1)}/5`;
}

function formatPercent(value?: number | null, emptyLabel = "-") {
  if (typeof value !== "number" || Number.isNaN(value)) return emptyLabel;
  return `${value.toFixed(1)}%`;
}

function formatHours(value?: number | null, emptyLabel = "-") {
  if (typeof value !== "number" || Number.isNaN(value)) return emptyLabel;
  return `${value.toFixed(1)} h`;
}

function formatDays(value?: number | null, emptyLabel = "-") {
  if (typeof value !== "number" || Number.isNaN(value)) return emptyLabel;
  return `${value.toFixed(1)} d`;
}

function formatChange(value?: number | null, emptyLabel = "-") {
  if (typeof value !== "number" || Number.isNaN(value)) return emptyLabel;
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(1)}%`;
}

function serviceTypeLabel(value: string, labels?: Record<string, string>) {
  if (labels?.[value]) return labels[value];
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
  const { lang } = useLang();
  const locale = lang === "de" ? "de-DE" : "ru-RU";
  const text = lang === "de"
    ? {
        accessTitle: "Berichte",
        accessDescription:
          "Dieser Arbeitsbereich steht nur für Geschäftsleitung, Assistenz, Patientenmanagement, Abrechnung und Sales zur Verfügung.",
        loadingWorkspace: "Berichtsarbeitsbereich wird geladen...",
        analytics: "Analytik",
        workspaceTitle: "Berichtsarbeitsbereich",
        workspaceDescription:
          "Strukturierte Auswertungen nach Kliniken, Ärzten, Patientengeografien und Leistungsarten mit rollenabhängiger Finanzsicht und CSV-Export.",
        refresh: "Aktualisieren",
        loadError: "Berichtsarbeitsbereich konnte nicht geladen werden.",
        exportError: "Bericht konnte nicht exportiert werden.",
        exportCsv: "Als CSV exportieren",
        countsOnly: "Nur Mengen",
        roleScoped: "Rollenabhängig",
        notRated: "Noch nicht bewertet",
        noBaseline: "Keine Vergleichsbasis",
        noResponses: "Keine Antworten",
        locationNotSet: "Ort nicht angegeben",
        noRecentActivity: "Keine aktuelle Aktivität",
        unknown: "Unbekannt",
        weightedHidden: "Gewichtung ausgeblendet",
        clearDrillDown: "Drill-down zurücksetzen",
        drillIntoDoctors: "Zu Ärzten drillen",
        openProvider: "Anbieter öffnen",
        financialMetricsVisible: "Finanzkennzahlen sichtbar",
        countsOnlyMode: "Nur Mengenmodus",
        sectionLabels: {
          clinics: "Klinikbericht",
          countries: "Länderbericht",
          service_types: "Bericht nach Leistungsarten",
          medical_providers: "Medizinische Leistungserbringer",
          provider_costs: "Kostenentwicklung Anbieter",
          billing_kpis: "Abrechnungs-KPIs",
          doctors: "Arzt-Drill-down",
          non_medical_providers: "Nicht-medizinische Anbieter",
          sales_kpis: "Vertriebs-KPIs",
        },
        serviceTypes: {
          medical: "Medizinisch",
          non_medical: "Nicht medizinisch",
          cost_passthrough: "Durchlaufkosten",
        },
        summary: {
          activePatients: "Aktive Patienten",
          activeOrders: "Aktive Aufträge",
          activeClinics: "Aktive Kliniken",
          deliveredServiceItems: "Erbrachte Leistungspositionen",
          deliveredServiceVolume: "Erbrachtes Leistungsvolumen",
        },
        billing: {
          title: "Abrechnungs-KPI-Scorecard",
          description:
            "Rechnungsdurchsatz, Inkassodisziplin und Zahlerstruktur aus dem aktuellen Billing-Modell.",
          trackedInvoices: (count: number) => `${count} erfasste Rechnungen`,
          invoices30d: "Rechnungen / 30 T.",
          openReceivables: "Offene Forderungen",
          paid14d: "Bezahlt innerhalb von 14 T.",
          dunningShare: "Mahnquote",
          avgServiceToInvoice: "Ø Leistung bis Rechnung",
          selfPayShare: "Selbstzahleranteil",
          averageInvoiceGross: "Ø Rechnungsbrutto",
          overdueInvoices: "Überfällige Rechnungen",
          costPassthroughShare: "Anteil Durchlaufkosten",
        },
        sales: {
          title: "Vertriebs-KPI-Ubersicht",
          description:
            "Lead-Dynamik, Konversionsdruck und Wachstum neuer Kliniken aus der CRM-Schicht.",
          leadCountries: (count: number) => `${count} Lead-Länder`,
          newLeads30d: "Neue Leads / 30 T.",
          qualified30d: "Qualifiziert / 30 T.",
          converted30d: "Konvertiert / 30 T.",
          leadToPatient: "Lead -> Patient",
          newPartnerClinicsQuarter: "Neue Partnerkliniken / Quartal",
          topLeadCountries90d: "Top-Lead-Länder / 90 T.",
          noLeadGeographyYet: "Noch keine Lead-Geografie vorhanden.",
        },
        forecast: {
          openQuotes: "Offene Angebote",
          pipelineGross: "Pipeline brutto",
          milestones30d: "Meilensteine / 30 T.",
          appointments30d: "Termine / 30 T.",
          pipelineTitle: "Prognose-Pipeline",
          pipelineDescription:
            "Offenes Angebotsvolumen mit einfacher Gewichtung nach Reifegrad und nahem Ablaufdruck.",
          quotes: (count: number) => `${count} Angebote`,
          expiring14d: "Läuft aus / 14 T.",
          grossPipeline: "Pipeline brutto",
          weighted: "Gewichtet",
          readModel: "Statusgewichtung",
          readModelLegend: "Entwurf 25 % / Gesendet 60 % / Angenommen 100 %",
          statusSummary: (quotes: number, expiring: number) =>
            `${quotes} Angebote · ${expiring} laufen in 14 Tagen aus`,
          weightedValue: (value: string) => `${value} gewichtet`,
          collectionsTitle: "Forderungsprognose",
          collectionsDescription:
            "Was bald fällig ist, bereits überfällig ist oder noch im Debt-Management festhängt.",
          due14d: "Fällig / 14 T.",
          overdue: "Überfällig",
          debtWorkflows: "Debt-Workflows",
          escalationSplit: "Eskaltionsmix",
          workflowOpenReview: (open: number, review: number) =>
            `${open} offen / ${review} Review innerhalb von 7 T.`,
          escalationSplitValue: (plans: number, escalated: number) =>
            `${plans} Zahlungspläne / ${escalated} eskaliert`,
          followupTitle: "Nachsorge-Prognose",
          followupDescription:
            "Meilensteine, die in den nächsten 30 Tagen auf Basis des aktuellen Follow-up-Status fällig werden.",
          activeFollowupOrders: "Aktive Nachsorge-Aufträge",
          oneWeekOneMonthSixMonth: "1W / 1M / 6M",
          doctorPackageResults: "Arzt / Paketende / Ergebnisse",
          clinicCapacityTitle: "Klinikauslastung nächste 30 Tage",
          clinicCapacityDescription:
            "Vorausschauende Kliniklast aus geplanten/bestätigten Terminen und Follow-up-Bedarf.",
          clinicCapacityBadge: (clinics: number, appointments: number) =>
            `${clinics} Kliniken / ${appointments} Termine`,
          doctors: (count: number) => `${count} Ärzte`,
          followup30d: "Nachsorge / 30 T.",
          patients30d: "Patienten / 30 T.",
          orders30d: "Aufträge / 30 T.",
        },
        clinicReport: {
          title: "Klinikbericht",
          description:
            "Medizinische Partnerkliniken nach jüngster Aktivität, erbrachten Leistungen, Antwortgeschwindigkeit und Qualitätsindikatoren aus Feedback und Follow-up-Abschluss.",
          empty: "Noch keine Daten für den Klinikbericht verfügbar.",
        },
        serviceTypeReport: {
          title: "Bericht nach Leistungsarten",
          description:
            "Erbrachtes medizinisches, nicht-medizinisches und durchlaufendes Leistungsvolumen nach Serviceklasse.",
          empty: "Noch keine Daten zum Bericht nach Leistungsarten verfügbar.",
        },
        medicalProviders: {
          title: "Leistung medizinischer Anbieter",
          description:
            "Partnerorientierte Klinikaktivität und Umsatzsicht für Leistungsmix, Patientengeografie und Sales-Vergleiche ohne Patientendetail.",
          empty: "Noch keine Daten zur Leistung medizinischer Anbieter verfügbar.",
        },
        providerCosts: {
          title: "Kostenentwicklung Anbieter",
          description:
            "Historische Entwicklung der Stückkosten nach Klinik und erbrachter Leistung zur Unterstützung von Kalkulationen und Marktvergleichen.",
          empty: "Noch keine Daten zur Kostenentwicklung verfügbar.",
        },
        nonMedicalProviders: {
          title: "Bericht nicht-medizinische Anbieter",
          description:
            "Concierge-orientiertes Partnervolumen über Serviceportfolio, aktuelle Anfragelast, Patientenreichweite und Feedback.",
          empty: "Noch keine Daten zu nicht-medizinischen Anbietern verfügbar.",
        },
        countries: {
          title: "Länderbericht",
          description:
            "Patientengeografie gruppiert nach aktiven Profilen und aktueller Auftragsnachfrage.",
          empty: "Noch keine Daten für den Länderbericht verfügbar.",
          summary: (patients: number, orders: number) =>
            `${patients} aktive Patienten · ${orders} aktive Aufträge`,
        },
        doctors: {
          title: "Arzt-Drill-down",
          description:
            "Arztbezogene Aktivität, Patientenreichweite, Antwortgeschwindigkeit und Qualitätssignale aus direktem Feedback und Follow-up-Ausführung. Klinik-Drill-down grenzt auf einen Anbieter ein.",
          empty: "Für den gewählten Scope sind noch keine Arzt-Drill-down-Daten verfügbar.",
        },
        visibility: {
          title: "Sichtbarkeit",
          description:
            "Bereiche und Finanzkennzahlen werden nach aktueller Rolle beschnitten. Diese Seite nutzt bewusst das Backend-Read-Model statt rein clientseitiger Filterung.",
        },
        common: {
          appointments90d: "Termine / 90 T.",
          patients90d: "Patienten / 90 T.",
          deliveredItems: "Erbrachte Positionen",
          doctors: "Ärzte",
          feedback: "Feedback",
          feedbackCount: "Anzahl Feedbacks",
          treatmentScore: "Behandlungsscore",
          doctorCommunication: "Arztkommunikation",
          clinicResponseTime: "Klinik-Reaktionszeit",
          doctorResponseTime: "Arzt-Reaktionszeit",
          writtenFindings: "Schriftliche Befunde",
          followupCompletion: "Follow-up-Abschluss",
          clinicalOutcome: "Klinisches Ergebnis",
          experienceBundle: "Erlebnisbündel",
          answeredOpen: (answered: number, open: number) =>
            `${answered} beantwortet · ${open} offen`,
          linkedArztbrief: (count: number) => `${count} verknüpfte Arztbriefe`,
          followupOrders: (done: number, total: number) => `${done}/${total} Aufträge`,
          yes: "ja",
          partial: "teilweise",
          complications: "Komplikationen",
          org: "Organisation",
          service: "Service",
          ambience: "Umfeld",
          value: "Preis-Leistung",
          itemsOrdersPatients: (items: number, orders: number, patients: number) =>
            `${items} Positionen · ${orders} Aufträge · ${patients} Patienten`,
          ordersDelivered: "Aufträge / erbracht",
          doctorNetwork: "Ärztenetzwerk",
          lastActivity: (date: string) => `Letzte Aktivität ${date}`,
          specialties: "Fachgebiete",
          serviceMix: "Leistungsmix",
          patientCountryMix: "Patientenländer",
          noSpecialtyData: "Keine Fachgebietsdaten",
          noDeliveredServicesYet: "Noch keine erbrachten Leistungen",
          noCountryData: "Keine Länderdaten",
          samples: "Stichproben",
          latestVsFirst: "Aktuell vs. zuerst",
          average: "Durchschnitt",
          observedRange: "Beobachtungszeitraum",
          latest: "zuletzt",
          min: "Min.",
          max: "Max.",
          services: "Leistungen",
          conciergeRequests90d: "Concierge-Anfragen / 90 T.",
          openRequests: "Offene Anfragen",
          completed90d: "Abgeschlossen / 90 T.",
          conciergeScore: "Concierge-Score",
          feedbackVendors: (feedback: number, vendors: number) =>
            `${feedback} Feedbacks / ${vendors} Anbieter`,
        },
      }
    : {
        accessTitle: "Отчёты",
        accessDescription:
          "Это рабочее пространство доступно только руководству, ассистенту CEO, пациент-менеджерам, биллингу и sales.",
        loadingWorkspace: "Загрузка рабочего пространства отчётов...",
        analytics: "Аналитика",
        workspaceTitle: "Рабочее пространство отчётов",
        workspaceDescription:
          "Структурированные отчёты по клиникам, врачам, географии пациентов и типам услуг с ролевой видимостью финансов и экспортом CSV.",
        refresh: "Обновить",
        loadError: "Не удалось загрузить рабочее пространство отчётов.",
        exportError: "Не удалось экспортировать отчёт.",
        exportCsv: "Экспорт в CSV",
        countsOnly: "Только количества",
        roleScoped: "По роли",
        notRated: "Пока без оценки",
        noBaseline: "Нет базы сравнения",
        noResponses: "Нет ответов",
        locationNotSet: "Локация не указана",
        noRecentActivity: "Недавней активности нет",
        unknown: "Неизвестно",
        weightedHidden: "Взвешенная сумма скрыта",
        clearDrillDown: "Сбросить drill-down",
        drillIntoDoctors: "Провалиться к врачам",
        openProvider: "Открыть провайдера",
        financialMetricsVisible: "Финансовые метрики видимы",
        countsOnlyMode: "Режим только количеств",
        sectionLabels: {
          clinics: "Отчёт по клиникам",
          countries: "Отчёт по странам",
          service_types: "Отчёт по типам услуг",
          medical_providers: "Медицинские провайдеры",
          provider_costs: "Динамика стоимости провайдеров",
          billing_kpis: "KPI биллинга",
          doctors: "Drill-down по врачам",
          non_medical_providers: "Немедицинские провайдеры",
          sales_kpis: "KPI продаж",
        },
        serviceTypes: {
          medical: "Медицинские",
          non_medical: "Немедицинские",
          cost_passthrough: "Проходные расходы",
        },
        summary: {
          activePatients: "Активные пациенты",
          activeOrders: "Активные заказы",
          activeClinics: "Активные клиники",
          deliveredServiceItems: "Оказанные позиции услуг",
          deliveredServiceVolume: "Объём оказанных услуг",
        },
        billing: {
          title: "Сводка KPI биллинга",
          description:
            "Пропускная способность счетов, платёжная дисциплина и структура плательщиков из текущей billing-модели.",
          trackedInvoices: (count: number) => `${count} отслеживаемых счетов`,
          invoices30d: "Счета / 30 дн.",
          openReceivables: "Открытая дебиторка",
          paid14d: "Оплачено за 14 дн.",
          dunningShare: "Доля претензий",
          avgServiceToInvoice: "Среднее от услуги до счёта",
          selfPayShare: "Доля self-pay",
          averageInvoiceGross: "Средний счёт брутто",
          overdueInvoices: "Просроченные счета",
          costPassthroughShare: "Доля проходных расходов",
        },
        sales: {
          title: "Сводка KPI продаж",
          description:
            "Динамика лидов, давление по конверсии и рост новых клиник из CRM-слоя.",
          leadCountries: (count: number) => `${count} стран по лидам`,
          newLeads30d: "Новые лиды / 30 дн.",
          qualified30d: "Квалифицировано / 30 дн.",
          converted30d: "Конвертировано / 30 дн.",
          leadToPatient: "Лид -> пациент",
          newPartnerClinicsQuarter: "Новые партнёрские клиники / квартал",
          topLeadCountries90d: "Топ стран по лидам / 90 дн.",
          noLeadGeographyYet: "География лидов пока отсутствует.",
        },
        forecast: {
          openQuotes: "Открытые предложения",
          pipelineGross: "Pipeline брутто",
          milestones30d: "Вехи / 30 дн.",
          appointments30d: "Приёмы / 30 дн.",
          pipelineTitle: "Прогноз воронки",
          pipelineDescription:
            "Объём открытых предложений с простой взвешенной оценкой по зрелости и ближайшему сроку истечения.",
          quotes: (count: number) => `${count} предложений`,
          expiring14d: "Истекает / 14 дн.",
          grossPipeline: "Pipeline брутто",
          weighted: "Взвешено",
          readModel: "Вес по статусу",
          readModelLegend: "Черновик 25 % / Отправлено 60 % / Принято 100 %",
          statusSummary: (quotes: number, expiring: number) =>
            `${quotes} предложений · ${expiring} истекают в ближайшие 14 дней`,
          weightedValue: (value: string) => `${value} взвешено`,
          collectionsTitle: "Прогноз по взысканиям",
          collectionsDescription:
            "Что скоро станет к оплате, уже просрочено или всё ещё находится в debt-management.",
          due14d: "К оплате / 14 дн.",
          overdue: "Просрочено",
          debtWorkflows: "Сценарии взыскания",
          escalationSplit: "Структура эскалаций",
          workflowOpenReview: (open: number, review: number) =>
            `${open} открыто / ${review} review в течение 7 дн.`,
          escalationSplitValue: (plans: number, escalated: number) =>
            `${plans} платёжных планов / ${escalated} эскалировано`,
          followupTitle: "Прогноз сопровождения",
          followupDescription:
            "Вехи, которые должны наступить в ближайшие 30 дней на основе текущего состояния follow-up по заказам.",
          activeFollowupOrders: "Активные заказы сопровождения",
          oneWeekOneMonthSixMonth: "1н / 1м / 6м",
          doctorPackageResults: "Врач / окончание пакета / результаты",
          clinicCapacityTitle: "Загрузка клиник на ближайшие 30 дней",
          clinicCapacityDescription:
            "Прогноз нагрузки на клиники по запланированным/подтверждённым приёмам и follow-up спросу.",
          clinicCapacityBadge: (clinics: number, appointments: number) =>
            `${clinics} клиник / ${appointments} приёмов`,
          doctors: (count: number) => `${count} врачей`,
          followup30d: "Сопровождение / 30 дн.",
          patients30d: "Пациенты / 30 дн.",
          orders30d: "Заказы / 30 дн.",
        },
        clinicReport: {
          title: "Отчёт по клиникам",
          description:
            "Медицинские партнёрские клиники, ранжированные по недавней активности, оказанным позициям, скорости ответа и качественным сигналам из feedback и завершения follow-up.",
          empty: "Данных для отчёта по клиникам пока нет.",
        },
        serviceTypeReport: {
          title: "Отчёт по типам услуг",
          description:
            "Объём оказанных медицинских, немедицинских и проходных услуг по классам сервисов.",
          empty: "Данных для отчёта по типам услуг пока нет.",
        },
        medicalProviders: {
          title: "Эффективность медицинских провайдеров",
          description:
            "Партнёрский обзор активности клиник и выручки для service mix, географии пациентов и sales-сравнений без детализации по пациентам.",
          empty: "Данных по медицинским провайдерам пока нет.",
        },
        providerCosts: {
          title: "Динамика стоимости провайдеров",
          description:
            "Историческое движение стоимости за единицу по клиникам и оказанным услугам для оценки цен и рыночных сравнений.",
          empty: "Данных по динамике стоимости пока нет.",
        },
        nonMedicalProviders: {
          title: "Отчёт по немедицинским провайдерам",
          description:
            "Concierge-ориентированный объём партнёров по портфелю услуг, текущей нагрузке запросов, охвату пациентов и feedback.",
          empty: "Данных по немедицинским провайдерам пока нет.",
        },
        countries: {
          title: "Отчёт по странам",
          description:
            "География пациентов, сгруппированная по активным профилям и текущему спросу на заказы.",
          empty: "Данных для отчёта по странам пока нет.",
          summary: (patients: number, orders: number) =>
            `${patients} активных пациентов · ${orders} активных заказов`,
        },
        doctors: {
          title: "Drill-down по врачам",
          description:
            "Активность врачей, охват пациентов, скорость ответа и качественные сигналы на основе прямого feedback и выполнения follow-up. Drill-down по клинике сужает выборку до одного провайдера.",
          empty: "Для выбранного scope данных по врачам пока нет.",
        },
        visibility: {
          title: "Видимость",
          description:
            "Разделы и финансовые метрики урезаются текущей ролью. Эта страница намеренно использует backend read model, а не только клиентскую фильтрацию.",
        },
        common: {
          appointments90d: "Приёмы / 90 дн.",
          patients90d: "Пациенты / 90 дн.",
          deliveredItems: "Оказанные позиции",
          doctors: "Врачи",
          feedback: "Отзывы",
          feedbackCount: "Количество отзывов",
          treatmentScore: "Оценка лечения",
          doctorCommunication: "Коммуникация врача",
          clinicResponseTime: "Скорость ответа клиники",
          doctorResponseTime: "Скорость ответа врача",
          writtenFindings: "Письменные заключения",
          followupCompletion: "Завершение follow-up",
          clinicalOutcome: "Клинический результат",
          experienceBundle: "Комплекс впечатлений",
          answeredOpen: (answered: number, open: number) =>
            `${answered} отвечено · ${open} открыто`,
          linkedArztbrief: (count: number) => `${count} связанных Arztbrief`,
          followupOrders: (done: number, total: number) => `${done}/${total} заказов`,
          yes: "да",
          partial: "частично",
          complications: "осложнения",
          org: "Организация",
          service: "Сервис",
          ambience: "Атмосфера",
          value: "Цена-качество",
          itemsOrdersPatients: (items: number, orders: number, patients: number) =>
            `${items} позиций · ${orders} заказов · ${patients} пациентов`,
          ordersDelivered: "Заказы / оказано",
          doctorNetwork: "Сеть врачей",
          lastActivity: (date: string) => `Последняя активность ${date}`,
          specialties: "Специализации",
          serviceMix: "Микс услуг",
          patientCountryMix: "Страны пациентов",
          noSpecialtyData: "Нет данных по специализациям",
          noDeliveredServicesYet: "Оказанных услуг пока нет",
          noCountryData: "Нет данных по странам",
          samples: "Выборки",
          latestVsFirst: "Последнее vs первое",
          average: "Среднее",
          observedRange: "Период наблюдения",
          latest: "последнее",
          min: "Мин.",
          max: "Макс.",
          services: "Услуги",
          conciergeRequests90d: "Concierge-запросы / 90 дн.",
          openRequests: "Открытые запросы",
          completed90d: "Завершено / 90 дн.",
          conciergeScore: "Оценка concierge",
          feedbackVendors: (feedback: number, vendors: number) =>
            `${feedback} отзывов / ${vendors} поставщиков`,
        },
      };
  const sectionLabel = (section: string) =>
    text.sectionLabels[section as keyof typeof text.sectionLabels] ??
    section.replaceAll("_", " ");
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
          setError(err instanceof Error ? err.message : text.loadError);
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
  }, [loading, text.loadError, user?.role, version]);

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

      const response = await fetch(buildApiUrl(`/stats/reports/export?${params.toString()}`), {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!response.ok) {
        throw new Error((await response.text()) || text.exportError);
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
      setError(err instanceof Error ? err.message : text.exportError);
    } finally {
      setExportingSection("");
    }
  }

  if (!roleCanOpenReports(user?.role)) {
    return (
      <div className="space-y-6">
        <section className={card("px-6 py-10 text-center")}>
          <h1 className="text-2xl font-semibold text-slate-950">{text.accessTitle}</h1>
          <p className="mt-3 text-sm text-slate-500">
            {text.accessDescription}
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
          {text.loadingWorkspace}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className={card("bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.14),_transparent_34%),linear-gradient(135deg,#0f172a_0%,#111827_54%,#14532d_100%)] px-6 py-6 text-white")}>
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-sm uppercase tracking-[0.18em] text-white/60">{text.analytics}</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">{text.workspaceTitle}</h1>
            <p className="mt-3 text-sm leading-7 text-white/75">
              {text.workspaceDescription}
            </p>
          </div>
          <Button
            variant="outline"
            className="border-white/15 bg-white/8 text-white hover:bg-white/12 hover:text-white"
            onClick={() => setVersion((value) => value + 1)}
          >
            {refreshing ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            {text.refresh}
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
            {metricCard(text.summary.activePatients, data.summary.active_patients, Globe2)}
            {metricCard(text.summary.activeOrders, data.summary.active_orders, Rows3)}
            {metricCard(text.summary.activeClinics, data.summary.active_clinics, Building2)}
            {metricCard(text.summary.deliveredServiceItems, data.summary.delivered_service_items, BarChart3)}
            {metricCard(
              text.summary.deliveredServiceVolume,
              data.summary.delivered_service_volume ? formatMoney(data.summary.delivered_service_volume, locale) : text.roleScoped,
              BarChart3,
            )}
          </section>

          {allowedSections.has("billing_kpis") && data.billing_kpis ? (
            <section className={card("p-6")}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-base font-semibold text-slate-950">{text.billing.title}</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {text.billing.description}
                  </p>
                </div>
                <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100">
                  {text.billing.trackedInvoices(data.billing_kpis.tracked_invoice_count)}
                </Badge>
              </div>
              <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {metricCard(text.billing.invoices30d, data.billing_kpis.invoices_30d, Wallet)}
                {metricCard(
                  text.billing.openReceivables,
                  formatMoneyMetric(data.billing_kpis.outstanding_receivables_total, locale),
                  Wallet,
                )}
                {metricCard(
                  text.billing.paid14d,
                  formatPercent(data.billing_kpis.paid_within_14d_rate_pct, text.noBaseline),
                  Activity,
                )}
                {metricCard(
                  text.billing.dunningShare,
                  formatPercent(data.billing_kpis.dunning_rate_pct, text.noBaseline),
                  BarChart3,
                )}
                {metricCard(
                  text.billing.avgServiceToInvoice,
                  formatDays(data.billing_kpis.avg_service_to_invoice_days, text.noBaseline),
                  CalendarDays,
                )}
                {metricCard(
                  text.billing.selfPayShare,
                  formatPercent(data.billing_kpis.self_pay_share_pct, text.noBaseline),
                  Globe2,
                )}
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <article className="rounded-[1.25rem] border border-slate-200 bg-slate-50 px-4 py-4">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.billing.averageInvoiceGross}</p>
                  <p className="mt-2 text-sm font-semibold text-slate-950">{formatMoneyMetric(data.billing_kpis.avg_invoice_gross, locale)}</p>
                </article>
                <article className="rounded-[1.25rem] border border-slate-200 bg-slate-50 px-4 py-4">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.billing.overdueInvoices}</p>
                  <p className="mt-2 text-sm font-semibold text-slate-950">{data.billing_kpis.overdue_invoice_count}</p>
                </article>
                <article className="rounded-[1.25rem] border border-slate-200 bg-slate-50 px-4 py-4">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.billing.costPassthroughShare}</p>
                  <p className="mt-2 text-sm font-semibold text-slate-950">{formatPercent(data.billing_kpis.cost_passthrough_share_pct, text.noBaseline)}</p>
                </article>
              </div>
            </section>
          ) : null}

          {allowedSections.has("sales_kpis") && data.sales_kpis ? (
            <section className={card("p-6")}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-base font-semibold text-slate-950">{text.sales.title}</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {text.sales.description}
                  </p>
                </div>
                <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100">
                  {text.sales.leadCountries(data.sales_kpis.active_lead_country_count)}
                </Badge>
              </div>
              <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {metricCard(text.sales.newLeads30d, data.sales_kpis.new_leads_30d, Activity)}
                {metricCard(text.sales.qualified30d, data.sales_kpis.qualified_leads_30d, Rows3)}
                {metricCard(text.sales.converted30d, data.sales_kpis.converted_leads_30d, Wallet)}
                {metricCard(
                  text.sales.leadToPatient,
                  formatPercent(data.sales_kpis.lead_to_patient_conversion_rate_pct, text.noBaseline),
                  BarChart3,
                )}
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-[0.8fr_1.2fr]">
                <article className="rounded-[1.25rem] border border-slate-200 bg-slate-50 px-4 py-4">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.sales.newPartnerClinicsQuarter}</p>
                  <p className="mt-2 text-sm font-semibold text-slate-950">{data.sales_kpis.new_partner_clinics_90d}</p>
                </article>
                <article className="rounded-[1.25rem] border border-slate-200 bg-slate-50 px-4 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.sales.topLeadCountries90d}</p>
                    <Badge className="bg-white text-slate-700 hover:bg-white">{data.sales_kpis.top_countries.length}</Badge>
                  </div>
                  <div className="mt-3 space-y-2">
                    {data.sales_kpis.top_countries.length > 0 ? data.sales_kpis.top_countries.map((item) => (
                      <div key={item.country} className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-slate-600">{item.country}</span>
                        <span className="font-semibold text-slate-950">{item.lead_count}</span>
                      </div>
                    )) : (
                      <p className="text-sm text-slate-500">{text.sales.noLeadGeographyYet}</p>
                    )}
                  </div>
                </article>
              </div>
            </section>
          ) : null}

          {forecasting ? (
            <>
              <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {metricCard(text.forecast.openQuotes, forecasting.summary.open_quotes, Activity)}
                {metricCard(
                  text.forecast.pipelineGross,
                  forecasting.summary.pipeline_gross_total
                    ? formatMoney(forecasting.summary.pipeline_gross_total, locale)
                    : text.countsOnly,
                  Wallet,
                )}
                {metricCard(
                  text.forecast.milestones30d,
                  forecasting.summary.followup_milestones_next_30d,
                  CalendarDays,
                )}
                {metricCard(
                  text.forecast.appointments30d,
                  forecasting.summary.appointments_next_30d,
                  BarChart3,
                )}
              </section>

              <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
                {forecastSections.has("quote_pipeline") && forecasting.quote_pipeline ? (
                  <section className={card("p-6")}>
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h2 className="text-base font-semibold text-slate-950">{text.forecast.pipelineTitle}</h2>
                        <p className="mt-1 text-sm text-slate-500">
                          {text.forecast.pipelineDescription}
                        </p>
                      </div>
                      <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100">
                        {text.forecast.quotes(forecasting.quote_pipeline.open_quotes)}
                      </Badge>
                    </div>
                    <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                        <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.forecast.expiring14d}</p>
                        <p className="mt-2 text-sm font-semibold text-slate-950">{forecasting.quote_pipeline.expiring_next_14d}</p>
                      </div>
                      <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                        <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.forecast.grossPipeline}</p>
                        <p className="mt-2 text-sm font-semibold text-slate-950">
                          {forecasting.quote_pipeline.gross_total ? formatMoney(forecasting.quote_pipeline.gross_total, locale) : text.countsOnly}
                        </p>
                      </div>
                      <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                        <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.forecast.weighted}</p>
                        <p className="mt-2 text-sm font-semibold text-slate-950">
                          {forecasting.quote_pipeline.weighted_gross ? formatMoney(forecasting.quote_pipeline.weighted_gross, locale) : text.countsOnly}
                        </p>
                      </div>
                      <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                        <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.forecast.readModel}</p>
                        <p className="mt-2 text-sm font-semibold text-slate-950">{text.forecast.readModelLegend}</p>
                      </div>
                    </div>
                    <div className="mt-5 space-y-3">
                      {forecasting.quote_pipeline.by_status.map((item) => (
                        <article key={item.status} className="rounded-[1.25rem] border border-slate-200 bg-white px-4 py-4 shadow-sm">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-slate-950">{item.status}</p>
                              <p className="mt-1 text-sm text-slate-500">{text.forecast.statusSummary(item.quote_count, item.expiring_next_14d)}</p>
                            </div>
                            <div className="text-right text-sm text-slate-600">
                              <div>{item.gross_total ? formatMoney(item.gross_total, locale) : text.countsOnly}</div>
                              <div className="mt-1">{item.weighted_gross ? text.forecast.weightedValue(formatMoney(item.weighted_gross, locale)) : text.weightedHidden}</div>
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
                      <h2 className="text-base font-semibold text-slate-950">{text.forecast.collectionsTitle}</h2>
                      <p className="mt-1 text-sm text-slate-500">
                        {text.forecast.collectionsDescription}
                      </p>
                      <div className="mt-5 grid gap-3 sm:grid-cols-2">
                        <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                          <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.forecast.due14d}</p>
                          <p className="mt-2 text-sm font-semibold text-slate-950">
                            {forecasting.collections.due_next_14d_count} / {forecasting.collections.due_next_14d_total ? formatMoney(forecasting.collections.due_next_14d_total, locale) : text.countsOnly}
                          </p>
                        </div>
                        <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                          <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.forecast.overdue}</p>
                          <p className="mt-2 text-sm font-semibold text-slate-950">
                            {forecasting.collections.overdue_invoice_count} / {forecasting.collections.overdue_open_total ? formatMoney(forecasting.collections.overdue_open_total, locale) : text.countsOnly}
                          </p>
                        </div>
                        <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                          <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.forecast.debtWorkflows}</p>
                          <p className="mt-2 text-sm font-semibold text-slate-950">
                            {text.forecast.workflowOpenReview(forecasting.collections.workflow_open_count, forecasting.collections.reviews_due_7d)}
                          </p>
                        </div>
                        <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                          <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.forecast.escalationSplit}</p>
                          <p className="mt-2 text-sm font-semibold text-slate-950">
                            {text.forecast.escalationSplitValue(forecasting.collections.payment_plan_count, forecasting.collections.escalated_count)}
                          </p>
                        </div>
                      </div>
                    </section>
                  ) : null}

                  {forecastSections.has("followup") && forecasting.followup ? (
                    <section className={card("p-6")}>
                      <h2 className="text-base font-semibold text-slate-950">{text.forecast.followupTitle}</h2>
                      <p className="mt-1 text-sm text-slate-500">
                        {text.forecast.followupDescription}
                      </p>
                      <div className="mt-5 grid gap-3 sm:grid-cols-2">
                        <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                          <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.forecast.activeFollowupOrders}</p>
                          <p className="mt-2 text-sm font-semibold text-slate-950">{forecasting.followup.active_orders}</p>
                        </div>
                        <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                          <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.forecast.milestones30d}</p>
                          <p className="mt-2 text-sm font-semibold text-slate-950">{forecasting.followup.milestones_due_next_30d}</p>
                        </div>
                        <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                          <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.forecast.oneWeekOneMonthSixMonth}</p>
                          <p className="mt-2 text-sm font-semibold text-slate-950">
                            {forecasting.followup.followup_1w_due_next_30d} / {forecasting.followup.followup_1m_due_next_30d} / {forecasting.followup.followup_6m_due_next_30d}
                          </p>
                        </div>
                        <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                          <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.forecast.doctorPackageResults}</p>
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
                      <h2 className="text-base font-semibold text-slate-950">{text.forecast.clinicCapacityTitle}</h2>
                      <p className="mt-1 text-sm text-slate-500">
                        {text.forecast.clinicCapacityDescription}
                      </p>
                    </div>
                    <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100">
                      {text.forecast.clinicCapacityBadge(forecasting.clinic_capacity.active_clinics, forecasting.clinic_capacity.appointments_next_30d_total)}
                    </Badge>
                  </div>
                  <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {forecasting.clinic_capacity.clinics.map((item) => (
                      <article key={item.provider_id} className="rounded-[1.25rem] border border-slate-200 bg-white px-4 py-4 shadow-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-slate-950">{item.name}</p>
                            <p className="mt-1 text-sm text-slate-500">{item.address_city || text.locationNotSet}</p>
                          </div>
                          <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100">
                            {text.forecast.doctors(item.doctor_count)}
                          </Badge>
                        </div>
                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                            <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.forecast.appointments30d}</p>
                            <p className="mt-2 text-sm font-semibold text-slate-950">{item.appointments_next_30d}</p>
                          </div>
                          <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                            <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.forecast.followup30d}</p>
                            <p className="mt-2 text-sm font-semibold text-slate-950">{item.followup_appointments_next_30d}</p>
                          </div>
                          <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                            <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.forecast.patients30d}</p>
                            <p className="mt-2 text-sm font-semibold text-slate-950">{item.patients_next_30d}</p>
                          </div>
                          <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                            <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.forecast.orders30d}</p>
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
                      <h2 className="text-base font-semibold text-slate-950">{text.clinicReport.title}</h2>
                      <p className="mt-1 text-sm text-slate-500">
                        {text.clinicReport.description}
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
                        {text.exportCsv}
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
                                {[item.address_city, item.address_country].filter(Boolean).join(", ") || text.locationNotSet}
                              </p>
                            </div>
                            {item.gross_service_volume ? (
                              <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                                {formatMoney(item.gross_service_volume, locale)}
                              </Badge>
                            ) : (
                              <Badge className="bg-slate-100 text-slate-600 hover:bg-slate-100">
                                {text.countsOnly}
                              </Badge>
                            )}
                          </div>
                          <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-4">
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.common.patients90d}</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{item.active_patients_90d}</p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.common.appointments90d}</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{item.appointments_90d}</p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.common.deliveredItems}</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{item.delivered_items}</p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.common.doctors}</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{item.doctor_count}</p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.common.feedback}</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{formatRating(item.avg_feedback_score, text.notRated)}</p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.common.feedbackCount}</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{item.feedback_count}</p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.common.treatmentScore}</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{formatRating(item.avg_treatment_score, text.notRated)}</p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.common.doctorCommunication}</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{formatRating(item.avg_doctor_score, text.notRated)}</p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.common.clinicResponseTime}</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{formatHours(item.avg_response_hours, text.noResponses)}</p>
                              <p className="mt-1 text-[11px] text-slate-500">
                                {text.common.answeredOpen(item.response_sample_count, item.open_communication_count)}
                              </p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.common.writtenFindings}</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{formatHours(item.avg_findings_turnaround_hours, text.noResponses)}</p>
                              <p className="mt-1 text-[11px] text-slate-500">
                                {text.common.linkedArztbrief(item.findings_sample_count)}
                              </p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.common.followupCompletion}</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">
                                {formatPercent(item.followup_completion_rate, text.noBaseline)}
                              </p>
                              <p className="mt-1 text-[11px] text-slate-500">
                                {text.common.followupOrders(item.followup_completed_orders, item.followup_orders_total)}
                              </p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.common.clinicalOutcome}</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">
                                {formatPercent(item.treatment_success_yes_rate, text.noBaseline)} {text.common.yes}
                              </p>
                              <p className="mt-1 text-[11px] text-slate-500">
                                {formatPercent(item.treatment_success_partial_rate, text.noBaseline)} {text.common.partial} · {formatPercent(item.complication_rate, text.noBaseline)} {text.common.complications}
                              </p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3 md:col-span-2 xl:col-span-2">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.common.experienceBundle}</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">
                                {text.common.org} {formatRating(item.avg_organization_score, text.notRated)} · {text.common.service} {formatRating(item.avg_service_score, text.notRated)}
                              </p>
                              <p className="mt-1 text-[11px] text-slate-500">
                                {text.common.ambience} {formatRating(item.avg_infrastructure_score, text.notRated)} · {text.common.value} {formatRating(item.avg_price_value_score, text.notRated)}
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
                              {selectedClinicId === item.provider_id ? text.clearDrillDown : text.drillIntoDoctors}
                            </Button>
                            <StaffLink to={`/providers?provider=${item.provider_id}`}>
                              <Button variant="outline" size="sm">{text.openProvider}</Button>
                            </StaffLink>
                          </div>
                        </article>
                      ))
                    ) : (
                      <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-8 text-center text-sm text-slate-500">
                        {text.clinicReport.empty}
                      </div>
                    )}
                  </div>
                </section>
              ) : null}

              {allowedSections.has("service_types") ? (
                <section className={card("p-6")}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-base font-semibold text-slate-950">{text.serviceTypeReport.title}</h2>
                      <p className="mt-1 text-sm text-slate-500">
                        {text.serviceTypeReport.description}
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
                        {text.exportCsv}
                      </Button>
                    </div>
                  </div>
                  <div className="mt-5 space-y-3">
                    {data.service_types.length > 0 ? (
                      data.service_types.map((item) => (
                        <article key={item.service_type} className="rounded-[1.5rem] border border-slate-200 bg-white px-4 py-4 shadow-sm">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-slate-950">{serviceTypeLabel(item.service_type, text.serviceTypes)}</p>
                              <p className="mt-2 text-sm text-slate-500">
                                {text.common.itemsOrdersPatients(item.item_count, item.order_count, item.patient_count)}
                              </p>
                            </div>
                            {item.gross_total ? (
                              <Badge className="bg-sky-100 text-sky-700 hover:bg-sky-100">
                                {formatMoney(item.gross_total, locale)}
                              </Badge>
                            ) : (
                              <Badge className="bg-slate-100 text-slate-600 hover:bg-slate-100">
                                {text.countsOnly}
                              </Badge>
                            )}
                          </div>
                        </article>
                      ))
                    ) : (
                      <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-8 text-center text-sm text-slate-500">
                        {text.serviceTypeReport.empty}
                      </div>
                    )}
                  </div>
                </section>
              ) : null}

              {allowedSections.has("medical_providers") ? (
                <section className={card("p-6")}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-base font-semibold text-slate-950">{text.medicalProviders.title}</h2>
                      <p className="mt-1 text-sm text-slate-500">
                        {text.medicalProviders.description}
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
                        {text.exportCsv}
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
                                {[item.address_city, item.address_country].filter(Boolean).join(", ") || text.locationNotSet}
                              </p>
                            </div>
                            <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                              {formatMoney(item.gross_service_volume ?? "0", locale)}
                            </Badge>
                          </div>
                          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.common.patients90d}</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{item.active_patients_90d}</p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.common.appointments90d}</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{item.appointments_90d}</p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.common.ordersDelivered}</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{item.active_orders} / {item.delivered_items}</p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.common.doctorNetwork}</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{item.doctor_count}</p>
                              <p className="mt-1 text-[11px] text-slate-500">
                                {item.last_activity_at ? text.common.lastActivity(new Date(item.last_activity_at).toLocaleDateString(locale)) : text.noRecentActivity}
                              </p>
                            </div>
                          </div>
                          <div className="mt-4 space-y-3">
                            <div>
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.common.specialties}</p>
                              <div className="mt-2 flex flex-wrap gap-2">
                                {item.doctor_specialties.length > 0 ? (
                                  item.doctor_specialties.map((specialty) => (
                                    <Badge key={`${item.provider_id}-${specialty}`} className="bg-slate-100 text-slate-700 hover:bg-slate-100">
                                      {specialty}
                                    </Badge>
                                  ))
                                ) : (
                                  <Badge className="bg-slate-100 text-slate-600 hover:bg-slate-100">{text.common.noSpecialtyData}</Badge>
                                )}
                              </div>
                            </div>
                            <div>
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.common.serviceMix}</p>
                              <div className="mt-2 flex flex-wrap gap-2">
                                {item.service_focus.length > 0 ? (
                                  item.service_focus.map((service) => (
                                    <Badge key={`${item.provider_id}-${service}`} className="bg-slate-100 text-slate-700 hover:bg-slate-100">
                                      {service}
                                    </Badge>
                                  ))
                                ) : (
                                  <Badge className="bg-slate-100 text-slate-600 hover:bg-slate-100">{text.common.noDeliveredServicesYet}</Badge>
                                )}
                              </div>
                            </div>
                            <div>
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.common.patientCountryMix}</p>
                              <div className="mt-2 flex flex-wrap gap-2">
                                {item.patient_country_mix.length > 0 ? (
                                  item.patient_country_mix.map((country) => (
                                    <Badge key={`${item.provider_id}-${country}`} className="bg-sky-100 text-sky-700 hover:bg-sky-100">
                                      {country}
                                    </Badge>
                                  ))
                                ) : (
                                  <Badge className="bg-slate-100 text-slate-600 hover:bg-slate-100">{text.common.noCountryData}</Badge>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="mt-4 flex flex-wrap gap-2">
                            <StaffLink to={`/providers?provider=${item.provider_id}`}>
                              <Button variant="outline" size="sm">{text.openProvider}</Button>
                            </StaffLink>
                          </div>
                        </article>
                      ))
                    ) : (
                      <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-8 text-center text-sm text-slate-500">
                        {text.medicalProviders.empty}
                      </div>
                    )}
                  </div>
                </section>
              ) : null}

              {allowedSections.has("provider_costs") ? (
                <section className={card("p-6")}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-base font-semibold text-slate-950">{text.providerCosts.title}</h2>
                      <p className="mt-1 text-sm text-slate-500">
                        {text.providerCosts.description}
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
                        {text.exportCsv}
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
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.common.samples}</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{item.sample_count}</p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.common.latestVsFirst}</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{formatChange(item.change_pct, text.noBaseline)}</p>
                              <p className="mt-1 text-[11px] text-slate-500">
                                {formatMoneyMetric(item.earliest_unit_gross, locale)} → {formatMoneyMetric(item.latest_unit_gross, locale)}
                              </p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.common.average}</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{formatMoneyMetric(item.avg_unit_gross, locale)}</p>
                              <p className="mt-1 text-[11px] text-slate-500">
                                {text.common.min} {formatMoneyMetric(item.min_unit_gross, locale)} · {text.common.max} {formatMoneyMetric(item.max_unit_gross, locale)}
                              </p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.common.observedRange}</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">
                                {item.first_recorded_at ? new Date(item.first_recorded_at).toLocaleDateString(locale) : text.unknown}
                              </p>
                              <p className="mt-1 text-[11px] text-slate-500">
                                {text.common.latest} {item.last_recorded_at ? new Date(item.last_recorded_at).toLocaleDateString(locale) : text.unknown}
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
                                  {point.month}: {formatMoneyMetric(point.avg_unit_gross, locale)}
                                </Badge>
                              ))}
                            </div>
                          ) : null}
                        </article>
                      ))
                    ) : (
                      <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-8 text-center text-sm text-slate-500">
                        {text.providerCosts.empty}
                      </div>
                    )}
                  </div>
                </section>
              ) : null}

              {allowedSections.has("non_medical_providers") ? (
                <section className={card("p-6")}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-base font-semibold text-slate-950">{text.nonMedicalProviders.title}</h2>
                      <p className="mt-1 text-sm text-slate-500">
                        {text.nonMedicalProviders.description}
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
                        {text.exportCsv}
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
                                {[item.address_city, item.address_country].filter(Boolean).join(", ") || text.locationNotSet}
                              </p>
                            </div>
                            {item.gross_service_volume ? (
                              <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                                {formatMoney(item.gross_service_volume, locale)}
                              </Badge>
                            ) : (
                              <Badge className="bg-slate-100 text-slate-600 hover:bg-slate-100">
                                {text.countsOnly}
                              </Badge>
                            )}
                          </div>
                          <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-4">
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.common.services}</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{item.service_count}</p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.common.patients90d}</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{item.active_patients_90d}</p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.common.appointments90d}</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{item.appointments_90d}</p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.common.conciergeRequests90d}</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{item.concierge_requests_90d}</p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.common.openRequests}</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{item.open_concierge_requests}</p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.common.completed90d}</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{item.completed_concierge_requests_90d}</p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.common.deliveredItems}</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{item.delivered_items}</p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.common.conciergeScore}</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{formatRating(item.avg_concierge_score, text.notRated)}</p>
                              <p className="mt-1 text-[11px] text-slate-500">{text.common.feedbackVendors(item.feedback_count, item.vendor_count)}</p>
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
                            <StaffLink to={`/providers?provider=${item.provider_id}`}>
                              <Button variant="outline" size="sm">{text.openProvider}</Button>
                            </StaffLink>
                          </div>
                        </article>
                      ))
                    ) : (
                      <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-8 text-center text-sm text-slate-500">
                        {text.nonMedicalProviders.empty}
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
                      <h2 className="text-base font-semibold text-slate-950">{text.countries.title}</h2>
                      <p className="mt-1 text-sm text-slate-500">
                        {text.countries.description}
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
                        {text.exportCsv}
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
                                {text.countries.summary(item.patient_count, item.active_orders)}
                              </p>
                            </div>
                            {item.gross_invoiced ? (
                              <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                                {formatMoney(item.gross_invoiced, locale)}
                              </Badge>
                            ) : (
                              <Badge className="bg-slate-100 text-slate-600 hover:bg-slate-100">
                                {text.countsOnly}
                              </Badge>
                            )}
                          </div>
                        </article>
                      ))
                    ) : (
                      <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-8 text-center text-sm text-slate-500">
                        {text.countries.empty}
                      </div>
                    )}
                  </div>
                </section>
              ) : null}

              {allowedSections.has("doctors") ? (
                <section className={card("p-6")}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-base font-semibold text-slate-950">{text.doctors.title}</h2>
                      <p className="mt-1 text-sm text-slate-500">
                        {text.doctors.description}
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
                        {text.exportCsv}
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
                                {formatMoney(item.gross_service_volume, locale)}
                              </Badge>
                            ) : (
                              <Badge className="bg-slate-100 text-slate-600 hover:bg-slate-100">
                                {text.countsOnly}
                              </Badge>
                            )}
                          </div>
                          <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-4">
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.common.patients90d}</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{item.active_patients_90d}</p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.common.appointments90d}</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{item.appointments_90d}</p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.summary.activeOrders}</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{item.active_orders}</p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.common.deliveredItems}</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{item.delivered_items}</p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.common.feedbackCount}</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{item.feedback_count}</p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.common.treatmentScore}</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{formatRating(item.avg_treatment_score, text.notRated)}</p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.common.doctorCommunication}</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{formatRating(item.avg_doctor_score, text.notRated)}</p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.common.doctorResponseTime}</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{formatHours(item.avg_response_hours, text.noResponses)}</p>
                              <p className="mt-1 text-[11px] text-slate-500">
                                {text.common.answeredOpen(item.response_sample_count, item.open_communication_count)}
                              </p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.common.writtenFindings}</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">{formatHours(item.avg_findings_turnaround_hours, text.noResponses)}</p>
                              <p className="mt-1 text-[11px] text-slate-500">
                                {text.common.linkedArztbrief(item.findings_sample_count)}
                              </p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.common.followupCompletion}</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">
                                {formatPercent(item.followup_completion_rate, text.noBaseline)}
                              </p>
                              <p className="mt-1 text-[11px] text-slate-500">
                                {text.common.followupOrders(item.followup_completed_orders, item.followup_orders_total)}
                              </p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.common.clinicalOutcome}</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">
                                {formatPercent(item.treatment_success_yes_rate, text.noBaseline)} {text.common.yes}
                              </p>
                              <p className="mt-1 text-[11px] text-slate-500">
                                {formatPercent(item.treatment_success_partial_rate, text.noBaseline)} {text.common.partial} · {formatPercent(item.complication_rate, text.noBaseline)} {text.common.complications}
                              </p>
                            </div>
                            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3 md:col-span-2 xl:col-span-2">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{text.common.experienceBundle}</p>
                              <p className="mt-2 text-sm font-semibold text-slate-950">
                                {text.common.org} {formatRating(item.avg_organization_score, text.notRated)} · {text.common.service} {formatRating(item.avg_service_score, text.notRated)}
                              </p>
                              <p className="mt-1 text-[11px] text-slate-500">
                                {text.common.ambience} {formatRating(item.avg_infrastructure_score, text.notRated)} · {text.common.value} {formatRating(item.avg_price_value_score, text.notRated)}
                              </p>
                            </div>
                          </div>
                        </article>
                      ))
                    ) : (
                      <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-8 text-center text-sm text-slate-500">
                        {text.doctors.empty}
                      </div>
                    )}
                  </div>
                </section>
              ) : null}

              <section className={card("p-6")}>
                <h2 className="text-base font-semibold text-slate-950">{text.visibility.title}</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {text.visibility.description}
                </p>
                <div className="mt-5 flex flex-wrap gap-2">
                  {data.allowed_sections.map((item) => (
                    <Badge key={item} className="bg-slate-100 text-slate-700 hover:bg-slate-100">
                      {sectionLabel(item)}
                    </Badge>
                  ))}
                  <Badge
                    className={
                      data.financial_metrics_visible
                        ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100"
                        : "bg-amber-100 text-amber-700 hover:bg-amber-100"
                    }
                  >
                    {data.financial_metrics_visible ? text.financialMetricsVisible : text.countsOnlyMode}
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
