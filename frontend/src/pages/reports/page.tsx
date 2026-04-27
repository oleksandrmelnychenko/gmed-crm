import { useEffect, useMemo, useState } from "react";
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
  AdminInlineMetric,
  AdminTableCard,
  AdminToolbar,
} from "@/components/admin-page-patterns";
import { DataTable } from "@/components/data-table/data-table";
import type { ColumnDef } from "@/components/data-table/types";
import { StaffLink } from "@/components/staff-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Banner as ShellBanner, PageHeader, StatusBadge, tokens } from "@/components/ui-shell";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { fetchReportsExport, fetchReportsWorkspace } from "./data/reports-api";
import {
  formatChange,
  formatDays,
  formatHours,
  formatMoney,
  formatMoneyMetric,
  formatPercent,
  formatRating,
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
  return cn("rounded-xl border border-border bg-card", extra);
}

function titleWithDot(title: string) {
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden className="size-1.5 rounded-full bg-primary/70" />
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

function metricCard(label: string, value: string | number, icon: LucideIcon) {
  const Icon = icon;
  return (
    <article className={card("p-4")}>
      <AdminInlineMetric icon={Icon} label={label} value={value} tone="slate" />
    </article>
  );
}

export function ReportsPage() {
  const { user } = useAuth();
  const { lang } = useLang();
  const locale = lang === "de" ? "de-DE" : "ru-RU";
  const text = useMemo(
    () => (lang === "de"
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
          location: "Standort",
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
          location: "Локация",
          conciergeRequests90d: "Concierge-запросы / 90 дн.",
          openRequests: "Открытые запросы",
          completed90d: "Завершено / 90 дн.",
          conciergeScore: "Оценка concierge",
          feedbackVendors: (feedback: number, vendors: number) =>
            `${feedback} отзывов / ${vendors} поставщиков`,
        },
      }),
    [lang],
  );
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
  const [detail, setDetail] = useState<ReportDetailState>(null);

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
        const { payload, forecastPayload } =
          await fetchReportsWorkspace<ReportsWorkspacePayload, ForecastingPayload>();
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
        render: (row) => <span className="text-xs text-foreground">{row.provider_type}</span>,
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
    [locale, text],
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
            {serviceTypeLabel(row.service_type, text.serviceTypes)}
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
    [locale, text],
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
            {row.last_activity_at
              ? new Date(row.last_activity_at).toLocaleDateString(locale)
              : text.noRecentActivity}
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
    [locale, text],
  );
  const providerCostColumns = useMemo<ColumnDef<ProviderCostRow>[]>(
    () => [
      {
        id: "service",
        label: text.providerCosts.title,
        accessor: (row) => row.service_label,
        width: 220,
        pinned: "left",
        sortable: true,
        render: (row) => <span className="text-sm font-medium text-foreground">{row.service_label}</span>,
      },
      {
        id: "provider",
        label: text.medicalProviders.title,
        accessor: (row) => row.provider_name,
        width: 220,
        render: (row) => <span className="text-xs text-foreground">{row.provider_name}</span>,
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
            {row.first_recorded_at ? new Date(row.first_recorded_at).toLocaleDateString(locale) : text.unknown}
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
            {row.last_recorded_at ? new Date(row.last_recorded_at).toLocaleDateString(locale) : text.unknown}
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
    [locale, text],
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
    [locale, text],
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
    [locale, text],
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
        accessor: (row) => row.fachbereich ?? "",
        width: 160,
        render: (row) => <span className="text-xs text-foreground">{row.fachbereich || text.unknown}</span>,
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
    [locale, text],
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
    [locale, text],
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
    setExportingSection(section);
    setError("");

    try {
      const { blob, filename } = await fetchReportsExport(
        section,
        selectedClinicId,
        text.exportError,
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
      setError(err instanceof Error ? err.message : text.exportError);
    } finally {
      setExportingSection("");
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

  return (
    <div className="space-y-4">
      <PageHeader
        title={titleWithDot(text.workspaceTitle)}
        description={text.workspaceDescription}
        actions={
          <Button
            variant="outline"
            className="h-9 rounded-lg"
            onClick={() => setVersion((value) => value + 1)}
          >
            {refreshing ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            {text.refresh}
          </Button>
        }
      />

      {error ? (
        <ShellBanner tone="error">{error}</ShellBanner>
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
                  <h2 className={tokens.text.sectionTitle}>{titleWithDot(text.billing.title)}</h2>
                  <p className={cn("mt-1", tokens.text.muted)}>
                    {text.billing.description}
                  </p>
                </div>
                <Badge variant="secondary">
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
                <article className={cn("rounded-xl px-4 py-4", tokens.surface.mutedCard)}>
                  <p className={tokens.text.eyebrow}>{text.billing.averageInvoiceGross}</p>
                  <p className={cn("mt-2", tokens.text.body)}>{formatMoneyMetric(data.billing_kpis.avg_invoice_gross, locale)}</p>
                </article>
                <article className={cn("rounded-xl px-4 py-4", tokens.surface.mutedCard)}>
                  <p className={tokens.text.eyebrow}>{text.billing.overdueInvoices}</p>
                  <p className={cn("mt-2", tokens.text.body)}>{data.billing_kpis.overdue_invoice_count}</p>
                </article>
                <article className={cn("rounded-xl px-4 py-4", tokens.surface.mutedCard)}>
                  <p className={tokens.text.eyebrow}>{text.billing.costPassthroughShare}</p>
                  <p className={cn("mt-2", tokens.text.body)}>{formatPercent(data.billing_kpis.cost_passthrough_share_pct, text.noBaseline)}</p>
                </article>
              </div>
            </section>
          ) : null}

          {allowedSections.has("sales_kpis") && data.sales_kpis ? (
            <section className={card("p-6")}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className={tokens.text.sectionTitle}>{titleWithDot(text.sales.title)}</h2>
                  <p className={cn("mt-1", tokens.text.muted)}>
                    {text.sales.description}
                  </p>
                </div>
                <Badge variant="secondary">
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
                <article className={cn("rounded-xl px-4 py-4", tokens.surface.mutedCard)}>
                  <p className={tokens.text.eyebrow}>{text.sales.newPartnerClinicsQuarter}</p>
                  <p className={cn("mt-2", tokens.text.body)}>{data.sales_kpis.new_partner_clinics_90d}</p>
                </article>
                <article className={cn("rounded-xl px-4 py-4", tokens.surface.mutedCard)}>
                  <div className="flex items-center justify-between gap-3">
                    <p className={tokens.text.eyebrow}>{text.sales.topLeadCountries90d}</p>
                    <Badge variant="outline">{data.sales_kpis.top_countries.length}</Badge>
                  </div>
                  <div className="mt-3 space-y-2">
                    {data.sales_kpis.top_countries.length > 0 ? data.sales_kpis.top_countries.map((item) => (
                      <div key={item.country} className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-muted-foreground">{item.country}</span>
                        <span className="font-semibold text-foreground">{item.lead_count}</span>
                      </div>
                    )) : (
                      <p className="text-sm text-muted-foreground">{text.sales.noLeadGeographyYet}</p>
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
                        <h2 className={tokens.text.sectionTitle}>{titleWithDot(text.forecast.pipelineTitle)}</h2>
                        <p className={cn("mt-1", tokens.text.muted)}>
                          {text.forecast.pipelineDescription}
                        </p>
                      </div>
                      <Badge variant="secondary">
                        {text.forecast.quotes(forecasting.quote_pipeline.open_quotes)}
                      </Badge>
                    </div>
                    <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      <div className={cn("rounded-xl px-3 py-3", tokens.surface.mutedCard)}>
                        <p className={tokens.text.eyebrow}>{text.forecast.expiring14d}</p>
                        <p className={cn("mt-2", tokens.text.body)}>{forecasting.quote_pipeline.expiring_next_14d}</p>
                      </div>
                      <div className={cn("rounded-xl px-3 py-3", tokens.surface.mutedCard)}>
                        <p className={tokens.text.eyebrow}>{text.forecast.grossPipeline}</p>
                        <p className={cn("mt-2", tokens.text.body)}>
                          {forecasting.quote_pipeline.gross_total ? formatMoney(forecasting.quote_pipeline.gross_total, locale) : text.countsOnly}
                        </p>
                      </div>
                      <div className={cn("rounded-xl px-3 py-3", tokens.surface.mutedCard)}>
                        <p className={tokens.text.eyebrow}>{text.forecast.weighted}</p>
                        <p className={cn("mt-2", tokens.text.body)}>
                          {forecasting.quote_pipeline.weighted_gross ? formatMoney(forecasting.quote_pipeline.weighted_gross, locale) : text.countsOnly}
                        </p>
                      </div>
                      <div className={cn("rounded-xl px-3 py-3", tokens.surface.mutedCard)}>
                        <p className={tokens.text.eyebrow}>{text.forecast.readModel}</p>
                        <p className={cn("mt-2", tokens.text.body)}>{text.forecast.readModelLegend}</p>
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

                <div className="space-y-6">
                  {forecastSections.has("collections") && forecasting.collections ? (
                    <section className={card("p-6")}>
                      <h2 className={tokens.text.sectionTitle}>{titleWithDot(text.forecast.collectionsTitle)}</h2>
                      <p className={cn("mt-1", tokens.text.muted)}>
                        {text.forecast.collectionsDescription}
                      </p>
                      <div className="mt-5 grid gap-3 sm:grid-cols-2">
                        <div className={cn("rounded-xl px-3 py-3", tokens.surface.mutedCard)}>
                          <p className={tokens.text.eyebrow}>{text.forecast.due14d}</p>
                          <p className={cn("mt-2", tokens.text.body)}>
                            {forecasting.collections.due_next_14d_count} / {forecasting.collections.due_next_14d_total ? formatMoney(forecasting.collections.due_next_14d_total, locale) : text.countsOnly}
                          </p>
                        </div>
                        <div className={cn("rounded-xl px-3 py-3", tokens.surface.mutedCard)}>
                          <p className={tokens.text.eyebrow}>{text.forecast.overdue}</p>
                          <p className={cn("mt-2", tokens.text.body)}>
                            {forecasting.collections.overdue_invoice_count} / {forecasting.collections.overdue_open_total ? formatMoney(forecasting.collections.overdue_open_total, locale) : text.countsOnly}
                          </p>
                        </div>
                        <div className={cn("rounded-xl px-3 py-3", tokens.surface.mutedCard)}>
                          <p className={tokens.text.eyebrow}>{text.forecast.debtWorkflows}</p>
                          <p className={cn("mt-2", tokens.text.body)}>
                            {text.forecast.workflowOpenReview(forecasting.collections.workflow_open_count, forecasting.collections.reviews_due_7d)}
                          </p>
                        </div>
                        <div className={cn("rounded-xl px-3 py-3", tokens.surface.mutedCard)}>
                          <p className={tokens.text.eyebrow}>{text.forecast.escalationSplit}</p>
                          <p className={cn("mt-2", tokens.text.body)}>
                            {text.forecast.escalationSplitValue(forecasting.collections.payment_plan_count, forecasting.collections.escalated_count)}
                          </p>
                        </div>
                      </div>
                    </section>
                  ) : null}

                  {forecastSections.has("followup") && forecasting.followup ? (
                    <section className={card("p-6")}>
                      <h2 className={tokens.text.sectionTitle}>{titleWithDot(text.forecast.followupTitle)}</h2>
                      <p className={cn("mt-1", tokens.text.muted)}>
                        {text.forecast.followupDescription}
                      </p>
                      <div className="mt-5 grid gap-3 sm:grid-cols-2">
                        <div className={cn("rounded-xl px-3 py-3", tokens.surface.mutedCard)}>
                          <p className={tokens.text.eyebrow}>{text.forecast.activeFollowupOrders}</p>
                          <p className={cn("mt-2", tokens.text.body)}>{forecasting.followup.active_orders}</p>
                        </div>
                        <div className={cn("rounded-xl px-3 py-3", tokens.surface.mutedCard)}>
                          <p className={tokens.text.eyebrow}>{text.forecast.milestones30d}</p>
                          <p className={cn("mt-2", tokens.text.body)}>{forecasting.followup.milestones_due_next_30d}</p>
                        </div>
                        <div className={cn("rounded-xl px-3 py-3", tokens.surface.mutedCard)}>
                          <p className={tokens.text.eyebrow}>{text.forecast.oneWeekOneMonthSixMonth}</p>
                          <p className={cn("mt-2", tokens.text.body)}>
                            {forecasting.followup.followup_1w_due_next_30d} / {forecasting.followup.followup_1m_due_next_30d} / {forecasting.followup.followup_6m_due_next_30d}
                          </p>
                        </div>
                        <div className={cn("rounded-xl px-3 py-3", tokens.surface.mutedCard)}>
                          <p className={tokens.text.eyebrow}>{text.forecast.doctorPackageResults}</p>
                          <p className={cn("mt-2", tokens.text.body)}>
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
                  <AdminToolbar>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={exportingSection === "clinics"}
                      onClick={() => void exportSection("clinics")}
                    >
                      {exportingSection === "clinics" ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
                      {text.exportCsv}
                    </Button>
                  </AdminToolbar>
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
                        <StaffLink to={`/providers?provider=${row.provider_id}`}>
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
                  <AdminToolbar>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={exportingSection === "service_types"}
                      onClick={() => void exportSection("service_types")}
                    >
                      {exportingSection === "service_types" ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
                      {text.exportCsv}
                    </Button>
                  </AdminToolbar>
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
                  <AdminToolbar>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={exportingSection === "medical_providers"}
                      onClick={() => void exportSection("medical_providers")}
                    >
                      {exportingSection === "medical_providers" ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
                      {text.exportCsv}
                    </Button>
                  </AdminToolbar>
                }
              >
                <div className="p-3">
                  <DataTable
                    rows={data.medical_providers}
                    columns={medicalProviderColumns}
                    rowId={(row) => row.provider_id}
                    rowActions={(row) => (
                      <StaffLink to={`/providers?provider=${row.provider_id}`}>
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
                    <AdminToolbar>
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
                  </AdminToolbar>
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
                      <StaffLink to={`/providers?provider=${row.provider_id}`}>
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
                  <AdminToolbar>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={exportingSection === "non_medical_providers"}
                      onClick={() => void exportSection("non_medical_providers")}
                    >
                      {exportingSection === "non_medical_providers" ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
                      {text.exportCsv}
                    </Button>
                  </AdminToolbar>
                }
              >
                <div className="p-3">
                  <DataTable
                    rows={data.non_medical_providers}
                    columns={nonMedicalProviderColumns}
                    rowId={(row) => row.provider_id}
                    rowActions={(row) => (
                      <StaffLink to={`/providers?provider=${row.provider_id}`}>
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
                  <AdminToolbar>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={exportingSection === "countries"}
                      onClick={() => void exportSection("countries")}
                    >
                      {exportingSection === "countries" ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
                      {text.exportCsv}
                    </Button>
                  </AdminToolbar>
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
                    <AdminToolbar>
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
                  </AdminToolbar>
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
                      <StaffLink to={`/providers?provider=${row.provider_id}`}>
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
            <SheetContent side="right" className="w-full p-0 sm:max-w-2xl">
              {detail ? (
                <AdminSheetScaffold
                  title={titleWithDot(
                    detail.kind === "clinic"
                      ? detail.row.name
                      : detail.kind === "doctor"
                        ? [detail.row.title, detail.row.name].filter(Boolean).join(" ")
                        : detail.row.service_label,
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
                        <div className="grid gap-3 p-3 sm:grid-cols-2">
                          <div className={card("p-3")}>
                            <p className="text-xs text-muted-foreground">{text.common.services}</p>
                            <p className="mt-1 text-sm font-medium text-foreground">{detail.row.provider_type}</p>
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
                        <StaffLink to={`/providers?provider=${detail.row.provider_id}`}>
                          <Button variant="outline">{text.openProvider}</Button>
                        </StaffLink>
                      </div>
                    </>
                  ) : null}

                  {detail.kind === "doctor" ? (
                    <>
                      <AdminTableCard title={titleWithDot(text.doctors.title)}>
                        <div className="grid gap-3 p-3 sm:grid-cols-2">
                          <div className={card("p-3")}>
                            <p className="text-xs text-muted-foreground">{text.medicalProviders.title}</p>
                            <p className="mt-1 text-sm font-medium text-foreground">{detail.row.provider_name}</p>
                          </div>
                          <div className={card("p-3")}>
                            <p className="text-xs text-muted-foreground">{text.common.specialties}</p>
                            <p className="mt-1 text-sm font-medium text-foreground">{detail.row.fachbereich || text.unknown}</p>
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
                      <StaffLink to={`/providers?provider=${detail.row.provider_id}`}>
                        <Button variant="outline">{text.openProvider}</Button>
                      </StaffLink>
                    </>
                  ) : null}

                  {detail.kind === "provider_cost" ? (
                    <>
                      <AdminTableCard title={titleWithDot(text.providerCosts.title)}>
                        <div className="grid gap-3 p-3 sm:grid-cols-2">
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
                              {detail.row.first_recorded_at ? new Date(detail.row.first_recorded_at).toLocaleDateString(locale) : text.unknown}
                            </p>
                          </div>
                          <div className={card("p-3")}>
                            <p className="text-xs text-muted-foreground">{text.common.latest}</p>
                            <p className="mt-1 text-sm font-medium text-foreground">
                              {detail.row.last_recorded_at ? new Date(detail.row.last_recorded_at).toLocaleDateString(locale) : text.unknown}
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
                      <StaffLink to={`/providers?provider=${detail.row.provider_id}`}>
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
