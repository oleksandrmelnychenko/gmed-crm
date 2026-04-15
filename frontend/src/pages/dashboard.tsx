import { startTransition, useEffect, useMemo, useState, type ElementType } from "react";
import {
  ArrowRight,
  Bell,
  BriefcaseMedical,
  Building2,
  CalendarDays,
  FileText,
  LoaderCircle,
  RefreshCw,
  TrendingUp,
  UserPlus,
  Users,
} from "lucide-react";

import { StaffLink } from "@/components/staff-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { PatientDashboardPage } from "@/pages/patient-dashboard";
import { npsBandLabel, type PortalFeedbackSummary } from "@/pages/patient-portal.shared";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { cn } from "@/lib/utils";

type OverviewStats = { patients: number; leads: number; orders: number; appointments: number; cases: number; users: number };
type LeadsStats = { total_this_month: number; growth_pct: number; qualified_this_month: number; converted_this_month: number; total_all: number };
type MonthlyEntry = { month: string; count: number };
type OrderPhaseEntry = { phase: string; count: number };
type UpcomingAppointment = { id: string; title: string; date: string; time_start?: string | null; type?: string | null; status: string; location?: string | null; patient_name: string };
type TaskItem = { id: string; title: string; description?: string | null; patient_id?: string | null; order_id?: string | null; appointment_id?: string | null; due_date?: string | null; priority: string; status: string };
type NotificationItem = { id: string; title: string; body?: string | null; entity_type?: string | null; entity_id?: string | null; is_read: boolean; created_at: string };
type CeoSummary = {
  invoiced_this_month: string;
  collected_this_month: string;
  invoiced_this_quarter: string;
  outstanding_receivables: string;
  average_revenue_per_patient: string;
  on_time_payment_rate_pct: number;
  new_patients_this_month: number;
  active_patients_total: number;
  active_patients_under_care: number;
  returning_patients: number;
  patients_with_orders: number;
  retention_rate_pct: number;
  retention_definition: string;
};
type CeoCountryEntry = { country: string; patient_count: number };
type CeoServiceMixEntry = { service_type: string; item_count: number; gross_total: string };
type CeoPatientManagerKpi = {
  user_id: string;
  name: string;
  active_patients: number;
  active_orders: number;
  open_tasks: number;
  overdue_tasks: number;
  checklist_total: number;
  checklist_completed: number;
  checklist_completion_rate_pct: number;
  avg_feedback_score?: number | null;
};
type CeoInterpreterKpi = {
  user_id: string;
  name: string;
  approved_hours_30d: string;
  booked_hours_30d: string;
  upcoming_hours_30d: string;
  completed_appointments_30d: number;
  utilization_rate_pct: number;
  avg_feedback_score?: number | null;
};
type CeoConciergeKpi = {
  user_id: string;
  name: string;
  active_services: number;
  completed_services_30d: number;
  ready_for_billing: number;
  portal_requests_30d: number;
  avg_feedback_score?: number | null;
};
type CeoProviderKpi = {
  provider_id: string;
  name: string;
  active_patients_90d: number;
  appointments_90d: number;
  gross_service_volume: string;
  avg_feedback_score?: number | null;
};
type CeoDashboardPayload = {
  summary: CeoSummary;
  countries: CeoCountryEntry[];
  service_mix: CeoServiceMixEntry[];
  patient_manager_kpis: CeoPatientManagerKpi[];
  interpreter_kpis: CeoInterpreterKpi[];
  concierge_kpis: CeoConciergeKpi[];
  provider_kpis: CeoProviderKpi[];
};
type RiskSeverity = "medium" | "high" | "urgent";
type PatientManagerRiskSummary = {
  total_alerts: number;
  urgent_alerts: number;
  high_alerts: number;
  medium_alerts: number;
  complex_case_alerts: number;
  overdue_appointments: number;
  overdue_tasks: number;
  overdue_checklists: number;
};
type PatientManagerRiskAlert = {
  patient_id: string;
  patient_label: string;
  severity: RiskSeverity;
  title: string;
  reasons: string[];
  open_case_count: number;
  open_appointment_count: number;
  overdue_appointment_count: number;
  open_task_count: number;
  overdue_task_count: number;
  overdue_checklist_count: number;
  high_risk_label: boolean;
  fall_risk_label: boolean;
};
type BillingRiskSummary = {
  total_alerts: number;
  urgent_alerts: number;
  high_alerts: number;
  medium_alerts: number;
  overdue_invoice_count: number;
  blocked_orders: number;
  outstanding_balance_total: string;
  exposure_gap_total: string;
};
type BillingRiskAlert = {
  order_id: string;
  order_number: string;
  patient_id: string;
  patient_label: string;
  severity: RiskSeverity;
  title: string;
  reasons: string[];
  phase: string;
  billing_release_status: string;
  package_coverage_status: string;
  overdue_invoice_count: number;
  unpaid_advance_invoice_count: number;
  outstanding_balance: string;
  service_gross: string;
  invoiced_total: string;
  exposure_gap: string;
};
type RiskAnalysisPayload = {
  allowed_sections: string[];
  patient_manager: { summary: PatientManagerRiskSummary; alerts: PatientManagerRiskAlert[] } | null;
  billing: { summary: BillingRiskSummary; alerts: BillingRiskAlert[] } | null;
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
};
type MyKpiPayload =
  | { section: "patient_manager"; kpi: CeoPatientManagerKpi | null }
  | { section: "interpreter"; kpi: CeoInterpreterKpi | null }
  | { section: "concierge"; kpi: CeoConciergeKpi | null };

function card(extra?: string) {
  return cn(
    "rounded-[1.75rem] border border-border/70 bg-card shadow-[0_20px_60px_rgba(15,23,42,0.05)]",
    extra
  );
}

function metricCard(label: string, value: string | number, icon: ElementType) {
  const Icon = icon;
  return (
    <article className="rounded-[1.25rem] border border-slate-200 bg-white px-4 py-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">{label}</p>
        <span className="rounded-2xl bg-slate-100 p-2 text-slate-700">
          <Icon className="size-4" />
        </span>
      </div>
      <p className="mt-4 text-2xl font-semibold tracking-tight text-slate-950">{value}</p>
    </article>
  );
}

function roleLabel(role: string, tr: Record<string, string>) {
  return tr[`role_${role}`] ?? role.replaceAll("_", " ");
}

function formatMoney(value?: string | number | null) {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(numeric) ? numeric : 0);
}

function formatCompactNumber(value?: string | number | null, suffix = "", locale = "en-GB") {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  const safeValue = Number.isFinite(numeric) ? numeric : 0;
  if (Math.abs(safeValue) >= 1000) {
    return `${new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(safeValue)}${suffix}`;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(safeValue)}${suffix}`;
}

function formatRating(value?: number | null, emptyLabel = "-") {
  if (typeof value !== "number" || Number.isNaN(value)) return emptyLabel;
  return `${value.toFixed(1)}/5`;
}

function formatPercent(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) return "0%";
  return `${value.toFixed(1)}%`;
}

function riskTone(severity: RiskSeverity) {
  if (severity === "urgent") return "border-rose-200 bg-rose-50 text-rose-700";
  if (severity === "high") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-sky-200 bg-sky-50 text-sky-700";
}

function enumLabel(value: string, labels: Record<string, string>) {
  return labels[value] ?? value.replaceAll("_", " ");
}

function fmtDate(value?: string | null, withTime = false, locale = "en-GB", emptyLabel = "-") {
  if (!value) return emptyLabel;
  try {
    return new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "short",
      year: "numeric",
      ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function dueLabel(
  value: string | null | undefined,
  labels: {
    noDueDate: string;
    overdue: (days: number) => string;
    dueToday: string;
    dueTomorrow: string;
    dueIn: (days: number) => string;
  },
) {
  if (!value) return labels.noDueDate;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const due = new Date(value);
  due.setHours(0, 0, 0, 0);
  const diff = Math.round((due.getTime() - now.getTime()) / 86_400_000);
  if (diff < 0) return labels.overdue(Math.abs(diff));
  if (diff === 0) return labels.dueToday;
  if (diff === 1) return labels.dueTomorrow;
  return labels.dueIn(diff);
}

function notificationHref(item: NotificationItem) {
  if (!item.entity_id || !item.entity_type) return null;
  if (item.entity_type === "message_peer") return `/chat?peer=${item.entity_id}`;
  if (item.entity_type === "lead") return `/leads?lead=${item.entity_id}`;
  if (item.entity_type === "patient") return `/patients?patient=${item.entity_id}`;
  if (item.entity_type === "provider") return `/providers?provider=${item.entity_id}`;
  if (item.entity_type === "order") return `/orders?order=${item.entity_id}`;
  if (item.entity_type === "appointment") return `/appointments?appointment=${item.entity_id}`;
  if (item.entity_type === "case") return `/cases?case=${item.entity_id}`;
  return null;
}

function taskHref(item: TaskItem) {
  if (item.appointment_id) return `/appointments?appointment=${item.appointment_id}`;
  if (item.order_id) return `/orders?order=${item.order_id}`;
  if (item.patient_id) return `/patients/${item.patient_id}?tab=workflow`;
  return null;
}

export function DashboardPage() {
  const { user } = useAuth();

  if (user?.role === "patient") {
    return <PatientDashboardPage />;
  }

  return <StaffDashboardPage />;
}

function StaffDashboardPage() {
  const { user } = useAuth();
  const { t, lang } = useLang();
  const tr = t as unknown as Record<string, string>;
  const { staffGo, canStaffPath } = useStaffNavigate();
  const role = user?.role ?? "";
  const executive = role === "ceo" || role === "ceo_assistant";
  const locale = lang === "de" ? "de-DE" : "ru-RU";
  const text = lang === "de"
    ? {
        heroSubtitle: "Operatives Cockpit für {role} mit Live-Queue, Pipeline- und Terminsignalen.",
        openCalendar: "Kalender öffnen",
        patients: "Patienten",
        refresh: "Aktualisieren",
        notRated: "Noch nicht bewertet",
        noDueDate: "Kein Fälligkeitsdatum",
        dueToday: "Heute fällig",
        dueTomorrow: "Morgen fällig",
        dueIn: (days: number) => `Fällig in ${days} Tagen`,
        overdue: (days: number) => `${days} Tage überfällig`,
        noFeedbackYet: "Noch kein Feedback",
        noTimestamp: "Kein Zeitstempel",
        noTime: "Keine Uhrzeit",
        noLocation: "Kein Ort",
        monthLabel: (index: number) => new Intl.DateTimeFormat("de-DE", { month: "short" }).format(new Date(2026, index, 1)),
        npsBands: { promoter: "Promotor", passive: "Passiv", detractor: "Kritiker" },
        serviceTypes: { medical: "Medizinisch", non_medical: "Nicht medizinisch", cost_passthrough: "Durchlaufkosten" },
        severities: { urgent: "Dringend", high: "Hoch", medium: "Mittel" },
        priorities: { urgent: "Dringend", high: "Hoch", medium: "Mittel", low: "Niedrig" },
        taskStatuses: { open: "Offen", in_progress: "In Bearbeitung", completed: "Abgeschlossen", cancelled: "Abgebrochen" },
        appointmentStatuses: { confirmed: "Bestätigt", planned: "Geplant", cancelled: "Abgesagt", completed: "Abgeschlossen" },
        riskFlags: { high_risk: "Hohes Risiko", fall_risk: "Sturzrisiko" },
        executiveLabels: {
          invoicedThisMonth: "Diesen Monat fakturiert",
          outstandingReceivables: "Offene Forderungen",
          activePatientsUnderCare: "Aktiv in Betreuung",
          patientRetention: "Patientenbindung",
          averageRevenuePerPatient: "Umsatz je Patient",
          openQuotePipeline: "Offene Angebotspipeline",
          weightedPipeline: "Gewichtete Pipeline",
          collectionsDueSoon: "Bald fällige Einzüge",
          followupClinicLoad: "Follow-up- und Kliniklast",
        },
        kpis: {
          pmTitle: "Meine KPI-Karte als Patientenmanager",
          pmDescription: "Zugewiesene Patientenlast, offener operativer Druck und Checklistenqualität auf einen Blick.",
          interpreterTitle: "Meine KPI-Karte als Dolmetscher",
          interpreterDescription: "Gebuchte vs. freigegebene Stunden, aktuelle Auslastung und Patientenfeedback zu deinen Einsätzen.",
          conciergeTitle: "Meine KPI-Karte als Concierge",
          conciergeDescription: "Serviceauslastung, Abrechnungsreife und Nachfrage aus dem Patientenportal in deiner Queue.",
          activePatients: "Aktive Patienten",
          activeOrders: "Aktive Aufträge",
          openTasks: "Offene Aufgaben",
          overdueTasks: "Überfällige Aufgaben",
          checklistCompletion: "Checklistenquote",
          feedback: "Feedback",
          approvedHours30d: "Freigegebene Stunden / 30 T",
          bookedHours30d: "Gebuchte Stunden / 30 T",
          upcoming30d: "Bevorstehend / 30 T",
          completedAppointments: "Abgeschlossene Termine",
          utilization: "Auslastung",
          activeServices: "Aktive Leistungen",
          completed30d: "Abgeschlossen / 30 T",
          readyForBilling: "Bereit für Abrechnung",
          portalRequests30d: "Portal-Anfragen / 30 T",
        },
        executiveSections: {
          ceoReadModel: "CEO-Read-Model",
          ceoReadModelDescription: "Umsatz, Leistungsmix und Patientenabdeckung aus Rechnungen, Aufträgen und aktiven Registerdaten.",
          activeProfiles: "aktive Profile",
          quarterVolume: "Quartalsvolumen",
          quarterVolumeDescription: "Materialisiertes Rechnungsbrutto im aktuellen Quartal.",
          underCare: "In Betreuung",
          underCareDescription: "Patienten mit mindestens einem aktiven Auftrag.",
          retentionDefinition: "Definition der Bindung",
          retentionDefinitionDescription: "Verwendet, damit keine eigene KPI-Formel außerhalb des aktuellen Datenmodells erfunden wird.",
          serviceVolumeDescription: "Erbrachtes, freigegebenes oder fakturiertes Leistungsvolumen.",
          noServiceMix: "Noch keine Daten zum Leistungsmix vorhanden.",
          patientManagerKpis: "Patientenmanager-KPIs",
          patientManagerKpisDescription: "Zuweisungen, offene Arbeitslast und Qualität beim Schließen von Checklisten.",
          interpreterKpis: "Dolmetscher-KPIs",
          interpreterKpisDescription: "Freigegebene Reportstunden, gebuchter Umfang und Feedbacksignal.",
          conciergeKpis: "Concierge-KPIs",
          conciergeKpisDescription: "Operative Auslastung, Abrechnungsübergabe und Nachfrage aus dem Patientenportal.",
          patientGeography: "Patientengeografie",
          patientGeographyDescription: "Verteilung des aktiven Registers nach Wohnsitz oder Fallback-Land.",
          noCountryDistribution: "Noch keine Länderverteilung verfügbar.",
          patientSentiment: "Patientenstimmung",
          patientSentimentDescription: "Live-NPS und Promotorenranking aus dem Feedback-Workspace.",
          overallScore: "Gesamtwert",
          conciergeScore: "Concierge-Wert",
          topPromoters: "Top-Promotoren",
          feedbackForms: "Feedbackformulare",
          feedbackUnavailable: "Feedback-Zusammenfassung ist noch nicht verfügbar.",
          clinicVolume: "Klinikvolumen",
          clinicVolumeDescription: "Medizinische Leistungserbringer nach Servicevolumen und Besuchsaktivität.",
          noProviderData: "Noch keine KPI-Daten zu Leistungserbringern vorhanden.",
        },
        risk: {
          pmTitle: "Risikobild Patientenmanagement",
          pmDescription: "Automatische Signale über komplexe Fälle, überfällige Termine, Aufgaben und Workflow-Blocker.",
          alerts: "Warnungen",
          urgentDescription: "überfällige Termine",
          highDescription: "Warnungen zu komplexen Fällen",
          tasks: "Aufgaben",
          tasksDescription: "Überfällige PM-Aufgaben",
          checklists: "Checklisten",
          checklistsDescription: "Überfällige Workflow-Punkte",
          openCases: "offene Fälle",
          openAppointments: "offene Termine",
          openTasks: "offene Aufgaben",
          noPmSignals: "Derzeit keine Risikosignale im Patientenmanagement.",
          billingTitle: "Abrechnungsrisiken",
          billingDescription: "Automatische Sicht auf finanzielles Risiko aus überfälligen Rechnungen, blockierten Freigaben und noch nicht fakturiertem Leistungsumfang.",
          blockedOrders: "Blockierte Aufträge",
          blockedOrdersDescription: "Abrechnungsfreigabe oder Paketfreigabe offen",
          outstanding: "Offen",
          outstandingDescription: "Offene Forderungen im Risikoset",
          exposureGap: "Exposure-Lücke",
          exposureGapDescription: "Erbrachter Umfang über fakturiertem Gesamtwert",
          outstandingShort: "Offen",
          serviceShort: "Leistung",
          invoicedShort: "Fakturiert",
          noBillingSignals: "Derzeit keine Abrechnungsrisiken.",
        },
        workQueue: {
          title: "Meine Arbeitsqueue",
          description: "Persönliche Aufgaben aus der Live-Zuweisung des Backends.",
          open: "offen",
          openButton: "Öffnen",
          start: "Starten",
          complete: "Abschließen",
          empty: "Derzeit keine aktiven Aufgaben.",
        },
        leadMomentum: {
          title: "Lead-Dynamik",
          description: "Monatlicher Eingangstrend und aktuelles Qualifikationstempo.",
          growthConversions: "Wachstum / Konversionen",
          qualifiedConverted: "qualifiziert / konvertiert",
          openPipelineVolume: "Offenes Pipeline-Volumen",
          unavailable: "Lead-Analysen sind für diese Rolle nicht verfügbar.",
        },
        orderPhase: {
          title: "Verteilung der Auftragsphasen",
          description: "Verteilung aktiver Aufträge über die Ausführungsphasen.",
          unavailable: "Auftragsanalysen sind für diese Rolle nicht verfügbar.",
        },
        upcoming: {
          title: "Bevorstehende Termine",
          description: "Nächste Slots aus dem Live-Terminboard.",
          empty: "Keine bevorstehenden Termine verfügbar.",
        },
        notifications: {
          title: "Neueste Benachrichtigungen",
          description: "Ungelesene Workflowsignale aus Backend-Ereignissen.",
          new: "Neu",
          empty: "Derzeit keine ungelesenen Benachrichtigungen.",
        },
        quickLinks: {
          title: "Schnellzugriffe",
          description: "Direkt in die wichtigsten Workspaces springen.",
          patientRegistry: "Patientenregister",
          patientRegistryDescription: "Profile, Zuweisungen und Versorgungskontext",
          clinicNetwork: "Kliniknetzwerk",
          clinicNetworkDescription: "Leistungserbringer, Ärzte, Leistungen und verknüpfte Patienten",
        },
      }
    : {
        heroSubtitle: "Операционный кокпит для роли {role} с живой очередью, сигналами по пайплайну и приёмам.",
        openCalendar: "Открыть календарь",
        patients: "Пациенты",
        refresh: "Обновить",
        notRated: "Нет оценки",
        noDueDate: "Срок не задан",
        dueToday: "Срок сегодня",
        dueTomorrow: "Срок завтра",
        dueIn: (days: number) => `Срок через ${days} дн.`,
        overdue: (days: number) => `Просрочка ${days} дн.`,
        noFeedbackYet: "Пока нет отзывов",
        noTimestamp: "Нет отметки времени",
        noTime: "Нет времени",
        noLocation: "Нет места",
        monthLabel: (index: number) => new Intl.DateTimeFormat("ru-RU", { month: "short" }).format(new Date(2026, index, 1)),
        npsBands: { promoter: "Промоутер", passive: "Нейтральный", detractor: "Критик" },
        serviceTypes: { medical: "Медицинские", non_medical: "Немедицинские", cost_passthrough: "Проходные расходы" },
        severities: { urgent: "Срочно", high: "Высокий", medium: "Средний" },
        priorities: { urgent: "Срочно", high: "Высокий", medium: "Средний", low: "Низкий" },
        taskStatuses: { open: "Открыта", in_progress: "В работе", completed: "Завершена", cancelled: "Отменена" },
        appointmentStatuses: { confirmed: "Подтверждён", planned: "Запланирован", cancelled: "Отменён", completed: "Завершён" },
        riskFlags: { high_risk: "Высокий риск", fall_risk: "Риск падения" },
        executiveLabels: {
          invoicedThisMonth: "Выставлено в этом месяце",
          outstandingReceivables: "Открытая дебиторка",
          activePatientsUnderCare: "Активно в сопровождении",
          patientRetention: "Удержание пациентов",
          averageRevenuePerPatient: "Выручка на пациента",
          openQuotePipeline: "Открытый пайплайн предложений",
          weightedPipeline: "Взвешенный пайплайн",
          collectionsDueSoon: "Скоро к взысканию",
          followupClinicLoad: "Последующие шаги и загрузка клиник",
        },
        kpis: {
          pmTitle: "Моя KPI-карта пациент-менеджера",
          pmDescription: "Закреплённая нагрузка по пациентам, операционное давление и качество чек-листов в одном месте.",
          interpreterTitle: "Моя KPI-карта переводчика",
          interpreterDescription: "Забронированные и согласованные часы, текущая нагрузка и отзывы пациентов по вашим назначениям.",
          conciergeTitle: "Моя KPI-карта concierge",
          conciergeDescription: "Нагрузка по услугам, готовность к биллингу и спрос из пациентского портала в вашей очереди.",
          activePatients: "Активные пациенты",
          activeOrders: "Активные заказы",
          openTasks: "Открытые задачи",
          overdueTasks: "Просроченные задачи",
          checklistCompletion: "Выполнение чек-листов",
          feedback: "Отзывы",
          approvedHours30d: "Согласовано часов / 30 дн.",
          bookedHours30d: "Забронировано часов / 30 дн.",
          upcoming30d: "Предстоит / 30 дн.",
          completedAppointments: "Завершённые приёмы",
          utilization: "Загрузка",
          activeServices: "Активные услуги",
          completed30d: "Завершено / 30 дн.",
          readyForBilling: "Готово к биллингу",
          portalRequests30d: "Запросы портала / 30 дн.",
        },
        executiveSections: {
          ceoReadModel: "Сводка CEO",
          ceoReadModelDescription: "Выручка, микс услуг и покрытие пациентов на основе счетов, заказов и активного реестра.",
          activeProfiles: "активных профилей",
          quarterVolume: "Объём квартала",
          quarterVolumeDescription: "Материализованное брутто счетов в текущем квартале.",
          underCare: "В сопровождении",
          underCareDescription: "Пациенты как минимум с одним активным заказом.",
          retentionDefinition: "Определение удержания",
          retentionDefinitionDescription: "Используется, чтобы не выдумывать отдельную KPI-формулу вне текущей модели данных.",
          serviceVolumeDescription: "Объём оказанных, согласованных или выставленных услуг.",
          noServiceMix: "Данные по миксу услуг пока отсутствуют.",
          patientManagerKpis: "KPI пациент-менеджеров",
          patientManagerKpisDescription: "Назначения, открытая нагрузка и качество закрытия чек-листов.",
          interpreterKpis: "KPI переводчиков",
          interpreterKpisDescription: "Согласованные часы отчётов, забронированный объём и сигнал обратной связи.",
          conciergeKpis: "KPI concierge",
          conciergeKpisDescription: "Операционная нагрузка по услугам, передача в биллинг и спрос из пациентского портала.",
          patientGeography: "География пациентов",
          patientGeographyDescription: "Распределение активного реестра по стране проживания или резервным полям страны.",
          noCountryDistribution: "Распределение по странам пока недоступно.",
          patientSentiment: "Настроение пациентов",
          patientSentimentDescription: "Живой NPS и рейтинг промоутеров из пространства отзывов.",
          overallScore: "Общий балл",
          conciergeScore: "Оценка concierge",
          topPromoters: "Топ-промоутеры",
          feedbackForms: "форм обратной связи",
          feedbackUnavailable: "Сводка по отзывам пока недоступна.",
          clinicVolume: "Объём клиник",
          clinicVolumeDescription: "Медицинские провайдеры по объёму услуг и активности визитов.",
          noProviderData: "KPI по провайдерам пока недоступны.",
        },
        risk: {
          pmTitle: "Риски пациент-менеджмента",
          pmDescription: "Автоматический слой сигналов по сложным кейсам, просроченным приёмам, задачам и блокерам процесса.",
          alerts: "сигналов",
          urgentDescription: "просроченных приёмов",
          highDescription: "сигналов по сложным кейсам",
          tasks: "Задачи",
          tasksDescription: "Просроченные задачи PM",
          checklists: "Чек-листы",
          checklistsDescription: "Просроченные элементы процесса",
          openCases: "открытых кейсов",
          openAppointments: "открытых приёмов",
          openTasks: "открытых задач",
          noPmSignals: "Сигналов риска по пациент-менеджменту сейчас нет.",
          billingTitle: "Риски биллинга",
          billingDescription: "Автоматический слой финансовых рисков по просроченным счетам, заблокированным релизам и невыставленному объёму услуг.",
          blockedOrders: "Заблокированные заказы",
          blockedOrdersDescription: "Не снято ограничение по релизу биллинга или пакету",
          outstanding: "Открыто",
          outstandingDescription: "Дебиторка в риск-сете",
          exposureGap: "Разрыв покрытия",
          exposureGapDescription: "Оказанный объём выше выставленного",
          outstandingShort: "Открыто",
          serviceShort: "Услуги",
          invoicedShort: "Выставлено",
          noBillingSignals: "Сигналов риска по биллингу сейчас нет.",
        },
        workQueue: {
          title: "Моя рабочая очередь",
          description: "Личные задачи из живого слоя назначений бэкенда.",
          open: "открыто",
          openButton: "Открыть",
          start: "Начать",
          complete: "Завершить",
          empty: "Сейчас активных задач нет.",
        },
        leadMomentum: {
          title: "Динамика лидов",
          description: "Месячный тренд входящего потока и текущий темп квалификации.",
          growthConversions: "Рост / конверсия",
          qualifiedConverted: "квалифицировано / конвертировано",
          openPipelineVolume: "Объём открытого пайплайна",
          unavailable: "Аналитика лидов недоступна для этой роли.",
        },
        orderPhase: {
          title: "Распределение фаз заказа",
          description: "Распределение активных заказов по фазам исполнения.",
          unavailable: "Аналитика заказов недоступна для этой роли.",
        },
        upcoming: {
          title: "Ближайшие приёмы",
          description: "Ближайшие слоты из живой доски appointments.",
          empty: "Нет ближайших приёмов.",
        },
        notifications: {
          title: "Последние уведомления",
          description: "Непрочитанные сигналы процесса, пришедшие из событий бэкенда.",
          new: "Новое",
          empty: "Непрочитанных уведомлений сейчас нет.",
        },
        quickLinks: {
          title: "Быстрые переходы",
          description: "Переход прямо в самые ценные рабочие пространства.",
          patientRegistry: "Реестр пациентов",
          patientRegistryDescription: "Профили, назначения и контекст ведения",
          clinicNetwork: "Сеть клиник",
          clinicNetworkDescription: "Провайдеры, врачи, услуги и связанные пациенты",
        },
      };
  const severityLabel = (value: string) => enumLabel(value, text.severities);
  const priorityLabel = (value: string) => enumLabel(value, text.priorities);
  const taskStatusLabel = (value: string) => enumLabel(value, text.taskStatuses);
  const appointmentStatusLabel = (value: string) => enumLabel(value, text.appointmentStatuses);
  const serviceTypeLabel = (value: string) => enumLabel(value, text.serviceTypes);
  const riskFlagLabel = (value: "high_risk" | "fall_risk") => enumLabel(value, text.riskFlags);
  const phaseLabel = (value: string) => tr[`phase_${value}`] ?? value.replaceAll("_", " ");
  const monthLabels = useMemo(
    () => Array.from({ length: 12 }, (_, index) => text.monthLabel(index)),
    [text, lang],
  );

  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [overview, setOverview] = useState<OverviewStats | null>(null);
  const [leadsStats, setLeadsStats] = useState<LeadsStats | null>(null);
  const [monthly, setMonthly] = useState<MonthlyEntry[]>([]);
  const [orderPhases, setOrderPhases] = useState<OrderPhaseEntry[]>([]);
  const [upcoming, setUpcoming] = useState<UpcomingAppointment[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [ceoDashboard, setCeoDashboard] = useState<CeoDashboardPayload | null>(null);
  const [myKpis, setMyKpis] = useState<MyKpiPayload | null>(null);
  const [forecasting, setForecasting] = useState<ForecastingPayload | null>(null);
  const [riskAnalysis, setRiskAnalysis] = useState<RiskAnalysisPayload | null>(null);
  const [feedbackSummary, setFeedbackSummary] = useState<PortalFeedbackSummary | null>(null);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

  const canOverview = executive || role === "patient_manager" || role === "billing" || role === "sales";
  const canLeads = executive || role === "patient_manager" || role === "sales";
  const canOrders = executive || role === "patient_manager" || role === "billing";
  const canUpcoming = executive || role === "patient_manager" || role === "teamlead_interpreter";
  const canRiskAnalysis = executive || role === "patient_manager" || role === "billing";
  const canMyKpis =
    role === "patient_manager" ||
    role === "teamlead_interpreter" ||
    role === "interpreter" ||
    role === "concierge";
  const canTasks =
    role === "ceo" ||
    role === "patient_manager" ||
    role === "teamlead_interpreter" ||
    role === "interpreter" ||
    role === "concierge" ||
    role === "billing";

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    async function load() {
      if (loading) {
        setRefreshing(false);
      } else {
        setRefreshing(true);
      }
      const [ov, ls, mo, op, up, ta, no, executiveDashboard, ownKpis, executiveForecasting, riskSignals, executiveFeedback] = await Promise.all([
        canOverview ? apiFetch<OverviewStats>("/stats/overview").catch(() => null) : Promise.resolve(null),
        canLeads ? apiFetch<LeadsStats>("/stats/leads").catch(() => null) : Promise.resolve(null),
        canLeads ? apiFetch<MonthlyEntry[]>("/stats/leads/monthly").catch(() => []) : Promise.resolve([]),
        canOrders ? apiFetch<OrderPhaseEntry[]>("/stats/orders/by-phase").catch(() => []) : Promise.resolve([]),
        canUpcoming ? apiFetch<UpcomingAppointment[]>("/stats/appointments/upcoming").catch(() => []) : Promise.resolve([]),
        canTasks ? apiFetch<TaskItem[]>("/tasks?mine_only=true").catch(() => []) : Promise.resolve([]),
        apiFetch<NotificationItem[]>("/notifications").catch(() => []),
        executive ? apiFetch<CeoDashboardPayload>("/stats/ceo/dashboard").catch(() => null) : Promise.resolve(null),
        canMyKpis ? apiFetch<MyKpiPayload>("/stats/my-kpis").catch(() => null) : Promise.resolve(null),
        executive ? apiFetch<ForecastingPayload>("/stats/forecasting").catch(() => null) : Promise.resolve(null),
        canRiskAnalysis ? apiFetch<RiskAnalysisPayload>("/stats/risk-analysis").catch(() => null) : Promise.resolve(null),
        executive ? apiFetch<PortalFeedbackSummary>("/feedback/summary").catch(() => null) : Promise.resolve(null),
      ]);
      if (cancelled) return;
      startTransition(() => {
        setOverview(ov);
        setLeadsStats(ls);
        setMonthly(mo);
        setOrderPhases(op);
        setUpcoming(up);
        setTasks(ta);
        setNotifications(no);
        setCeoDashboard(executiveDashboard);
        setMyKpis(ownKpis);
        setForecasting(executiveForecasting);
        setRiskAnalysis(riskSignals);
        setFeedbackSummary(executiveFeedback);
      });
      setLoading(false);
      setRefreshing(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [canLeads, canMyKpis, canOrders, canOverview, canRiskAnalysis, canTasks, canUpcoming, executive, loading, user, version]);

  const activeTasks = useMemo(
    () => tasks.filter((item) => item.status !== "completed" && item.status !== "cancelled"),
    [tasks]
  );
  const unread = useMemo(() => notifications.filter((item) => !item.is_read).slice(0, 5), [notifications]);
  const bars = useMemo(
    () =>
      monthLabels.map((label, index) => {
        const key = String(index + 1).padStart(2, "0");
        return { label, count: monthly.find((item) => item.month.endsWith(`-${key}`))?.count ?? 0 };
      }),
    [monthly, monthLabels]
  );
  const maxBar = useMemo(() => Math.max(1, ...bars.map((item) => item.count)), [bars]);
  const metrics = useMemo(
    () =>
      overview
        ? [
            { label: t.dash_total_patients, value: overview.patients, href: "/patients", icon: Users, tone: "bg-sky-100 text-sky-700" },
            { label: t.dash_total_visitors, value: overview.leads, href: "/leads", icon: UserPlus, tone: "bg-violet-100 text-violet-700" },
            { label: t.orders_title, value: overview.orders, href: "/orders", icon: FileText, tone: "bg-amber-100 text-amber-700" },
            { label: t.dash_total_appointments, value: overview.appointments, href: "/appointments", icon: CalendarDays, tone: "bg-emerald-100 text-emerald-700" },
            { label: t.cases_title, value: overview.cases, href: "/cases", icon: BriefcaseMedical, tone: "bg-slate-100 text-slate-700" },
            { label: t.users_title, value: overview.users, href: "/admin/users", icon: Building2, tone: "bg-slate-100 text-slate-700" },
          ].filter((item) => canStaffPath(item.href))
        : [],
    [canStaffPath, overview, t]
  );
  const executiveMetrics = useMemo(
    () =>
      ceoDashboard
        ? [
            {
              label: text.executiveLabels.invoicedThisMonth,
              value: formatMoney(ceoDashboard.summary.invoiced_this_month),
              caption: lang === "de"
                ? `${formatMoney(ceoDashboard.summary.collected_this_month)} eingezogen`
                : `${formatMoney(ceoDashboard.summary.collected_this_month)} получено`,
              tone: "border-sky-200 bg-sky-50",
            },
            {
              label: text.executiveLabels.outstandingReceivables,
              value: formatMoney(ceoDashboard.summary.outstanding_receivables),
              caption: lang === "de"
                ? `${formatPercent(ceoDashboard.summary.on_time_payment_rate_pct)} pünktlich bezahlt`
                : `${formatPercent(ceoDashboard.summary.on_time_payment_rate_pct)} оплачено вовремя`,
              tone: "border-amber-200 bg-amber-50",
            },
            {
              label: text.executiveLabels.activePatientsUnderCare,
              value: String(ceoDashboard.summary.active_patients_under_care),
              caption: lang === "de"
                ? `${ceoDashboard.summary.new_patients_this_month} neu in diesem Monat`
                : `${ceoDashboard.summary.new_patients_this_month} новых в этом месяце`,
              tone: "border-emerald-200 bg-emerald-50",
            },
            {
              label: text.executiveLabels.patientRetention,
              value: formatPercent(ceoDashboard.summary.retention_rate_pct),
              caption: lang === "de"
                ? `${ceoDashboard.summary.returning_patients}/${ceoDashboard.summary.patients_with_orders} wiederkehrende Patienten`
                : `${ceoDashboard.summary.returning_patients}/${ceoDashboard.summary.patients_with_orders} вернувшихся пациентов`,
              tone: "border-violet-200 bg-violet-50",
            },
            {
              label: text.executiveLabels.averageRevenuePerPatient,
              value: formatMoney(ceoDashboard.summary.average_revenue_per_patient),
              caption: lang === "de"
                ? `${formatMoney(ceoDashboard.summary.invoiced_this_quarter)} Quartalsvolumen`
                : `${formatMoney(ceoDashboard.summary.invoiced_this_quarter)} объём квартала`,
              tone: "border-rose-200 bg-rose-50",
            },
            {
              label: "NPS",
              value: feedbackSummary ? String(feedbackSummary.nps_score) : "0",
              caption: feedbackSummary
                ? text.npsBands[npsBandLabel(feedbackSummary.nps_score).toLowerCase() as "promoter" | "passive" | "detractor"]
                : text.noFeedbackYet,
              tone: "border-slate-200 bg-slate-50",
            },
          ]
        : [],
    [ceoDashboard, feedbackSummary, lang, text]
  );
  const executiveForecastMetrics = useMemo(
    () =>
      forecasting
        ? [
            {
              label: text.executiveLabels.openQuotePipeline,
              value: String(forecasting.summary.open_quotes),
              caption: forecasting.summary.pipeline_gross_total
                ? formatMoney(forecasting.summary.pipeline_gross_total)
                : lang === "de"
                  ? `${forecasting.summary.expiring_quotes_next_14d} laufen in 14 T. ab`
                  : `${forecasting.summary.expiring_quotes_next_14d} истекают за 14 дн.`,
            },
            {
              label: text.executiveLabels.weightedPipeline,
              value: forecasting.summary.weighted_pipeline_gross
                ? formatMoney(forecasting.summary.weighted_pipeline_gross)
                : lang === "de"
                  ? "Nur Mengen"
                  : "Только количество",
              caption: lang === "de"
                ? `${forecasting.summary.expiring_quotes_next_14d} laufen innerhalb von 14 Tagen ab`
                : `${forecasting.summary.expiring_quotes_next_14d} истекают в течение 14 дней`,
            },
            {
              label: text.executiveLabels.collectionsDueSoon,
              value: forecasting.summary.due_next_14d_total
                ? formatMoney(forecasting.summary.due_next_14d_total)
                : lang === "de"
                  ? "Nicht sichtbar"
                  : "Не видно",
              caption: forecasting.summary.overdue_open_total
                ? lang === "de"
                  ? `${formatMoney(forecasting.summary.overdue_open_total)} überfällig`
                  : `${formatMoney(forecasting.summary.overdue_open_total)} просрочено`
                : lang === "de"
                  ? "Keine Finanzprognose für diese Rolle"
                  : "Для этой роли нет финансового прогноза",
            },
            {
              label: text.executiveLabels.followupClinicLoad,
              value: `${forecasting.summary.followup_milestones_next_30d}`,
              caption: lang === "de"
                ? `${forecasting.summary.appointments_next_30d} Termine in den nächsten 30 Tagen`
                : `${forecasting.summary.appointments_next_30d} приёмов в ближайшие 30 дней`,
            },
          ]
        : [],
    [forecasting, lang, text]
  );
  const patientManagerRisk = riskAnalysis?.patient_manager ?? null;
  const billingRisk = riskAnalysis?.billing ?? null;

  async function updateTask(taskId: string, status: "in_progress" | "completed") {
    setBusyTaskId(taskId);
    try {
      await apiFetch(`/tasks/${taskId}/status`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      setVersion((value) => value + 1);
    } finally {
      setBusyTaskId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex items-center gap-3 rounded-full border border-slate-200 bg-white px-5 py-3 text-sm text-slate-500 shadow-sm">
          <LoaderCircle className="size-4 animate-spin" />
          {t.common_loading}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className={card("bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.12),_transparent_32%),linear-gradient(135deg,#0f172a_0%,#111827_54%,#1e293b_100%)] px-6 py-6 text-white")}>
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-sm uppercase tracking-[0.18em] text-white/55">{t.nav_dashboard}</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">
              {t.dash_greeting}, {user?.name ?? "GMED"}
            </h1>
            <p className="mt-3 text-sm leading-7 text-white/70">
              {text.heroSubtitle.replace("{role}", roleLabel(role, tr))}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <StaffLink to="/appointments">
              <Button variant="outline" className="border-white/15 bg-white/8 text-white hover:bg-white/12 hover:text-white">{text.openCalendar}</Button>
            </StaffLink>
            <StaffLink to="/patients">
              <Button variant="outline" className="border-white/15 bg-white/8 text-white hover:bg-white/12 hover:text-white">{text.patients}</Button>
            </StaffLink>
            <Button variant="outline" className="border-white/15 bg-white/8 text-white hover:bg-white/12 hover:text-white" onClick={() => setVersion((value) => value + 1)}>
              <RefreshCw className={cn("mr-2 size-4", refreshing && "animate-spin")} />
              {text.refresh}
            </Button>
          </div>
        </div>
      </section>

      {metrics.length > 0 ? (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          {metrics.map((item) => (
            <StaffLink key={item.label} to={item.href} className="rounded-[1.5rem] border border-white/90 bg-white/88 p-4 shadow-sm backdrop-blur transition-transform duration-150 hover:-translate-y-0.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">{item.label}</span>
                <span className={cn("rounded-2xl p-2", item.tone)}><item.icon className="size-4" /></span>
              </div>
              <p className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">{item.value}</p>
            </StaffLink>
          ))}
        </section>
      ) : null}

      {canMyKpis && myKpis?.kpi ? (
        <section className={card("p-6")}>
          {myKpis.section === "patient_manager" ? (
            <>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-base font-semibold text-slate-950">{text.kpis.pmTitle}</h2>
                  <p className="mt-1 text-sm text-slate-500">{text.kpis.pmDescription}</p>
                </div>
                <Badge className="bg-sky-100 text-sky-700 hover:bg-sky-100">{lang === "de" ? `${myKpis.kpi.active_patients} Patienten` : `${myKpis.kpi.active_patients} пациентов`}</Badge>
              </div>
              <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-6">
                {metricCard(text.kpis.activePatients, myKpis.kpi.active_patients, Users)}
                {metricCard(text.kpis.activeOrders, myKpis.kpi.active_orders, FileText)}
                {metricCard(text.kpis.openTasks, myKpis.kpi.open_tasks, Bell)}
                {metricCard(text.kpis.overdueTasks, myKpis.kpi.overdue_tasks, RefreshCw)}
                {metricCard(text.kpis.checklistCompletion, formatPercent(myKpis.kpi.checklist_completion_rate_pct), TrendingUp)}
                {metricCard(text.kpis.feedback, formatRating(myKpis.kpi.avg_feedback_score, text.notRated), ArrowRight)}
              </div>
            </>
          ) : null}

          {myKpis.section === "interpreter" ? (
            <>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-base font-semibold text-slate-950">{text.kpis.interpreterTitle}</h2>
                  <p className="mt-1 text-sm text-slate-500">{text.kpis.interpreterDescription}</p>
                </div>
                <Badge className="bg-violet-100 text-violet-700 hover:bg-violet-100">{formatPercent(myKpis.kpi.utilization_rate_pct)}</Badge>
              </div>
              <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-6">
                {metricCard(text.kpis.approvedHours30d, formatCompactNumber(myKpis.kpi.approved_hours_30d, lang === "de" ? " Std." : " ч", locale), CalendarDays)}
                {metricCard(text.kpis.bookedHours30d, formatCompactNumber(myKpis.kpi.booked_hours_30d, lang === "de" ? " Std." : " ч", locale), CalendarDays)}
                {metricCard(text.kpis.upcoming30d, formatCompactNumber(myKpis.kpi.upcoming_hours_30d, lang === "de" ? " Std." : " ч", locale), TrendingUp)}
                {metricCard(text.kpis.completedAppointments, myKpis.kpi.completed_appointments_30d, BriefcaseMedical)}
                {metricCard(text.kpis.utilization, formatPercent(myKpis.kpi.utilization_rate_pct), RefreshCw)}
                {metricCard(text.kpis.feedback, formatRating(myKpis.kpi.avg_feedback_score, text.notRated), ArrowRight)}
              </div>
            </>
          ) : null}

          {myKpis.section === "concierge" ? (
            <>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-base font-semibold text-slate-950">{text.kpis.conciergeTitle}</h2>
                  <p className="mt-1 text-sm text-slate-500">{text.kpis.conciergeDescription}</p>
                </div>
                <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">{lang === "de" ? `${myKpis.kpi.active_services} aktiv` : `${myKpis.kpi.active_services} активных`}</Badge>
              </div>
              <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                {metricCard(text.kpis.activeServices, myKpis.kpi.active_services, BriefcaseMedical)}
                {metricCard(text.kpis.completed30d, myKpis.kpi.completed_services_30d, CalendarDays)}
                {metricCard(text.kpis.readyForBilling, myKpis.kpi.ready_for_billing, FileText)}
                {metricCard(text.kpis.portalRequests30d, myKpis.kpi.portal_requests_30d, UserPlus)}
                {metricCard(text.kpis.feedback, formatRating(myKpis.kpi.avg_feedback_score, text.notRated), ArrowRight)}
              </div>
            </>
          ) : null}
        </section>
      ) : null}

      {executive && ceoDashboard ? (
        <>
          {executiveMetrics.length > 0 ? (
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
              {executiveMetrics.map((item) => (
                <div key={item.label} className={cn("rounded-[1.5rem] border p-4 shadow-sm", item.tone)}>
                  <p className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">{item.label}</p>
                  <p className="mt-4 text-2xl font-semibold tracking-tight text-slate-950">{item.value}</p>
                  <p className="mt-2 text-sm text-slate-600">{item.caption}</p>
                </div>
              ))}
            </section>
          ) : null}

          {executiveForecastMetrics.length > 0 ? (
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {executiveForecastMetrics.map((item) => (
                <div key={item.label} className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">{item.label}</p>
                  <p className="mt-4 text-2xl font-semibold tracking-tight text-slate-950">{item.value}</p>
                  <p className="mt-2 text-sm text-slate-600">{item.caption}</p>
                </div>
              ))}
            </section>
          ) : null}

          <section className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
            <div className="space-y-6">
              <div className={card("p-6")}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-base font-semibold text-slate-950">{text.executiveSections.ceoReadModel}</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {text.executiveSections.ceoReadModelDescription}
                    </p>
                  </div>
                  <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100">{`${ceoDashboard.summary.active_patients_total} ${text.executiveSections.activeProfiles}`}</Badge>
                </div>
                <div className="mt-5 grid gap-4 md:grid-cols-3">
                  <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/70 px-4 py-4">
                    <p className="text-xs uppercase tracking-[0.12em] text-slate-500">{text.executiveSections.quarterVolume}</p>
                    <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">
                      {formatMoney(ceoDashboard.summary.invoiced_this_quarter)}
                    </p>
                    <p className="mt-2 text-sm text-slate-500">{text.executiveSections.quarterVolumeDescription}</p>
                  </div>
                  <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/70 px-4 py-4">
                    <p className="text-xs uppercase tracking-[0.12em] text-slate-500">{text.executiveSections.underCare}</p>
                    <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">
                      {ceoDashboard.summary.active_patients_under_care}
                    </p>
                    <p className="mt-2 text-sm text-slate-500">
                      {text.executiveSections.underCareDescription}
                    </p>
                  </div>
                  <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/70 px-4 py-4">
                    <p className="text-xs uppercase tracking-[0.12em] text-slate-500">{text.executiveSections.retentionDefinition}</p>
                    <p className="mt-3 text-sm font-semibold text-slate-950">
                      {ceoDashboard.summary.retention_definition}
                    </p>
                    <p className="mt-2 text-sm text-slate-500">
                      {text.executiveSections.retentionDefinitionDescription}
                    </p>
                  </div>
                </div>
                <div className="mt-6 grid gap-3 md:grid-cols-3">
                  {ceoDashboard.service_mix.length > 0 ? ceoDashboard.service_mix.map((item) => (
                    <div key={item.service_type} className="rounded-[1.5rem] border border-slate-200 bg-white px-4 py-4 shadow-sm">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-slate-950">{serviceTypeLabel(item.service_type)}</p>
                        <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100">{item.item_count}</Badge>
                      </div>
                        <p className="mt-3 text-lg font-semibold tracking-tight text-slate-950">
                          {formatMoney(item.gross_total)}
                        </p>
                      <p className="mt-2 text-sm text-slate-500">{text.executiveSections.serviceVolumeDescription}</p>
                    </div>
                  )) : (
                    <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-8 text-center text-sm text-slate-500 md:col-span-3">
                      {text.executiveSections.noServiceMix}
                    </div>
                  )}
                </div>
              </div>

              <div className="grid gap-6 xl:grid-cols-3">
                <div className={card("p-6")}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-base font-semibold text-slate-950">{text.executiveSections.patientManagerKpis}</h2>
                      <p className="mt-1 text-sm text-slate-500">{text.executiveSections.patientManagerKpisDescription}</p>
                    </div>
                    <Badge className="bg-sky-100 text-sky-700 hover:bg-sky-100">{ceoDashboard.patient_manager_kpis.length}</Badge>
                  </div>
                  <div className="mt-5 space-y-3">
                    {ceoDashboard.patient_manager_kpis.slice(0, 5).map((item) => (
                      <div key={item.user_id} className="rounded-[1.5rem] border border-slate-200 bg-white px-4 py-4 shadow-sm">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-semibold text-slate-950">{item.name}</p>
                          <Badge className="bg-sky-100 text-sky-700 hover:bg-sky-100">{lang === "de" ? `${item.active_patients} Patienten` : `${item.active_patients} пациентов`}</Badge>
                        </div>
                        <p className="mt-2 text-sm text-slate-600">
                          {lang === "de"
                            ? `${item.active_orders} aktive Aufträge · ${item.open_tasks} offene Aufgaben · ${item.overdue_tasks} überfällig`
                            : `${item.active_orders} активных заказов · ${item.open_tasks} открытых задач · ${item.overdue_tasks} просрочено`}
                        </p>
                        <p className="mt-2 text-xs text-slate-500">
                          {lang === "de"
                            ? `Checkliste ${formatPercent(item.checklist_completion_rate_pct)} · Feedback ${formatRating(item.avg_feedback_score, text.notRated)}`
                            : `Чек-лист ${formatPercent(item.checklist_completion_rate_pct)} · Отзывы ${formatRating(item.avg_feedback_score, text.notRated)}`}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className={card("p-6")}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-base font-semibold text-slate-950">{text.executiveSections.interpreterKpis}</h2>
                      <p className="mt-1 text-sm text-slate-500">{text.executiveSections.interpreterKpisDescription}</p>
                    </div>
                    <Badge className="bg-violet-100 text-violet-700 hover:bg-violet-100">{ceoDashboard.interpreter_kpis.length}</Badge>
                  </div>
                  <div className="mt-5 space-y-3">
                    {ceoDashboard.interpreter_kpis.slice(0, 5).map((item) => (
                      <div key={item.user_id} className="rounded-[1.5rem] border border-slate-200 bg-white px-4 py-4 shadow-sm">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-semibold text-slate-950">{item.name}</p>
                          <Badge className="bg-violet-100 text-violet-700 hover:bg-violet-100">{formatPercent(item.utilization_rate_pct)}</Badge>
                        </div>
                        <p className="mt-2 text-sm text-slate-600">
                          {lang === "de"
                            ? `${formatCompactNumber(item.approved_hours_30d, " Std.", locale)} freigegeben · ${formatCompactNumber(item.booked_hours_30d, " Std.", locale)} gebucht`
                            : `${formatCompactNumber(item.approved_hours_30d, " ч", locale)} согласовано · ${formatCompactNumber(item.booked_hours_30d, " ч", locale)} забронировано`}
                        </p>
                        <p className="mt-2 text-xs text-slate-500">
                          {lang === "de"
                            ? `${formatCompactNumber(item.upcoming_hours_30d, " Std.", locale)} bevorstehend · ${item.completed_appointments_30d} abgeschlossen · Feedback ${formatRating(item.avg_feedback_score, text.notRated)}`
                            : `${formatCompactNumber(item.upcoming_hours_30d, " ч", locale)} впереди · ${item.completed_appointments_30d} завершено · Отзывы ${formatRating(item.avg_feedback_score, text.notRated)}`}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className={card("p-6")}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-base font-semibold text-slate-950">{text.executiveSections.conciergeKpis}</h2>
                      <p className="mt-1 text-sm text-slate-500">{text.executiveSections.conciergeKpisDescription}</p>
                    </div>
                    <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">{ceoDashboard.concierge_kpis.length}</Badge>
                  </div>
                  <div className="mt-5 space-y-3">
                    {ceoDashboard.concierge_kpis.slice(0, 5).map((item) => (
                      <div key={item.user_id} className="rounded-[1.5rem] border border-slate-200 bg-white px-4 py-4 shadow-sm">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-semibold text-slate-950">{item.name}</p>
                          <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">{lang === "de" ? `${item.active_services} aktiv` : `${item.active_services} активных`}</Badge>
                        </div>
                        <p className="mt-2 text-sm text-slate-600">
                          {lang === "de"
                            ? `${item.completed_services_30d} in 30 T. abgeschlossen · ${item.ready_for_billing} abrechnungsbereit`
                            : `${item.completed_services_30d} завершено за 30 дн. · ${item.ready_for_billing} готово к биллингу`}
                        </p>
                        <p className="mt-2 text-xs text-slate-500">
                          {lang === "de"
                            ? `${item.portal_requests_30d} Portalanfragen in 30 T. · Feedback ${formatRating(item.avg_feedback_score, text.notRated)}`
                            : `${item.portal_requests_30d} запросов портала за 30 дн. · Отзывы ${formatRating(item.avg_feedback_score, text.notRated)}`}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <div className={card("p-6")}>
                <h2 className="text-base font-semibold text-slate-950">{text.executiveSections.patientGeography}</h2>
                <p className="mt-1 text-sm text-slate-500">{text.executiveSections.patientGeographyDescription}</p>
                <div className="mt-5 space-y-3">
                  {ceoDashboard.countries.length > 0 ? ceoDashboard.countries.map((item) => (
                    <div key={item.country} className="rounded-[1.5rem] border border-slate-200 bg-white px-4 py-4 shadow-sm">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-slate-950">{item.country}</p>
                        <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100">{item.patient_count}</Badge>
                      </div>
                    </div>
                  )) : (
                    <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-8 text-center text-sm text-slate-500">
                      {text.executiveSections.noCountryDistribution}
                    </div>
                  )}
                </div>
              </div>

              <div className={card("p-6")}>
                <h2 className="text-base font-semibold text-slate-950">{text.executiveSections.patientSentiment}</h2>
                <p className="mt-1 text-sm text-slate-500">{text.executiveSections.patientSentimentDescription}</p>
                {feedbackSummary ? (
                  <>
                    <div className="mt-5 grid gap-3 md:grid-cols-2">
                      <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/70 px-4 py-4">
                        <p className="text-xs uppercase tracking-[0.12em] text-slate-500">{text.executiveSections.overallScore}</p>
                        <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">
                          {formatRating(feedbackSummary.average_scores.overall, text.notRated)}
                        </p>
                        <p className="mt-2 text-sm text-slate-500">{`${feedbackSummary.total_feedback} ${text.executiveSections.feedbackForms}`}</p>
                      </div>
                      <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/70 px-4 py-4">
                        <p className="text-xs uppercase tracking-[0.12em] text-slate-500">{text.executiveSections.conciergeScore}</p>
                        <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">
                          {formatRating(feedbackSummary.average_scores.concierge, text.notRated)}
                        </p>
                        <p className="mt-2 text-sm text-slate-500">
                          {lang === "de"
                            ? `${feedbackSummary.promoters} Promotoren · ${feedbackSummary.detractors} Kritiker`
                            : `${feedbackSummary.promoters} промоутеров · ${feedbackSummary.detractors} критиков`}
                        </p>
                      </div>
                    </div>
                    <div className="mt-5 space-y-3">
                      <p className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">{text.executiveSections.topPromoters}</p>
                      {feedbackSummary.top_promoters.slice(0, 5).map((item) => (
                        <div key={item.patient_id} className="rounded-[1.5rem] border border-slate-200 bg-white px-4 py-4 shadow-sm">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-semibold text-slate-950">{item.patient_name}</p>
                            <Badge className="bg-rose-100 text-rose-700 hover:bg-rose-100">{item.average_nps.toFixed(1)}</Badge>
                          </div>
                          <p className="mt-2 text-xs text-slate-500">
                            {`${item.feedback_count} ${text.executiveSections.feedbackForms} · ${item.last_submitted_at ? fmtDate(item.last_submitted_at, true, locale, t.common_not_set) : text.noTimestamp}`}
                          </p>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="mt-5 rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-8 text-center text-sm text-slate-500">
                    {text.executiveSections.feedbackUnavailable}
                  </div>
                )}
              </div>

              <div className={card("p-6")}>
                <h2 className="text-base font-semibold text-slate-950">{text.executiveSections.clinicVolume}</h2>
                <p className="mt-1 text-sm text-slate-500">{text.executiveSections.clinicVolumeDescription}</p>
                <div className="mt-5 space-y-3">
                  {ceoDashboard.provider_kpis.length > 0 ? ceoDashboard.provider_kpis.map((item) => (
                    <div key={item.provider_id} className="rounded-[1.5rem] border border-slate-200 bg-white px-4 py-4 shadow-sm">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-slate-950">{item.name}</p>
                        <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100">{formatMoney(item.gross_service_volume)}</Badge>
                      </div>
                      <p className="mt-2 text-sm text-slate-600">
                        {lang === "de"
                          ? `${item.appointments_90d} Termine / 90 T. · ${item.active_patients_90d} Patienten`
                          : `${item.appointments_90d} приёмов / 90 дн. · ${item.active_patients_90d} пациентов`}
                      </p>
                      <p className="mt-2 text-xs text-slate-500">{`${text.kpis.feedback} ${formatRating(item.avg_feedback_score, text.notRated)}`}</p>
                    </div>
                  )) : (
                    <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-8 text-center text-sm text-slate-500">
                      {text.executiveSections.noProviderData}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        </>
      ) : null}

      {patientManagerRisk || billingRisk ? (
        <section
          className={cn(
            "grid gap-6",
            patientManagerRisk && billingRisk ? "xl:grid-cols-2" : "xl:grid-cols-1",
          )}
        >
          {patientManagerRisk ? (
            <div className={card("p-6")}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-base font-semibold text-slate-950">{text.risk.pmTitle}</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {text.risk.pmDescription}
                  </p>
                </div>
                <Badge className="bg-sky-100 text-sky-700 hover:bg-sky-100">
                  {`${patientManagerRisk.summary.total_alerts} ${text.risk.alerts}`}
                </Badge>
              </div>
              <div className="mt-5 grid gap-3 md:grid-cols-4">
                <div className="rounded-[1.5rem] border border-rose-200 bg-rose-50 px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.12em] text-rose-700">{severityLabel("urgent")}</p>
                  <p className="mt-3 text-2xl font-semibold tracking-tight text-rose-950">{patientManagerRisk.summary.urgent_alerts}</p>
                  <p className="mt-2 text-sm text-rose-700">{`${patientManagerRisk.summary.overdue_appointments} ${text.risk.urgentDescription}`}</p>
                </div>
                <div className="rounded-[1.5rem] border border-amber-200 bg-amber-50 px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.12em] text-amber-700">{severityLabel("high")}</p>
                  <p className="mt-3 text-2xl font-semibold tracking-tight text-amber-950">{patientManagerRisk.summary.high_alerts}</p>
                  <p className="mt-2 text-sm text-amber-700">{`${patientManagerRisk.summary.complex_case_alerts} ${text.risk.highDescription}`}</p>
                </div>
                <div className="rounded-[1.5rem] border border-sky-200 bg-sky-50 px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.12em] text-sky-700">{text.risk.tasks}</p>
                  <p className="mt-3 text-2xl font-semibold tracking-tight text-sky-950">{patientManagerRisk.summary.overdue_tasks}</p>
                  <p className="mt-2 text-sm text-sky-700">{text.risk.tasksDescription}</p>
                </div>
                <div className="rounded-[1.5rem] border border-violet-200 bg-violet-50 px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.12em] text-violet-700">{text.risk.checklists}</p>
                  <p className="mt-3 text-2xl font-semibold tracking-tight text-violet-950">{patientManagerRisk.summary.overdue_checklists}</p>
                  <p className="mt-2 text-sm text-violet-700">{text.risk.checklistsDescription}</p>
                </div>
              </div>
              <div className="mt-5 space-y-3">
                {patientManagerRisk.alerts.length > 0 ? patientManagerRisk.alerts.slice(0, 6).map((alert) => (
                  <button
                    key={`${alert.patient_id}-${alert.severity}`}
                    type="button"
                    onClick={() => staffGo(`/patients/${alert.patient_id}?tab=workflow`)}
                    className="w-full rounded-[1.5rem] border border-slate-200 bg-white px-4 py-4 text-left shadow-sm transition-colors hover:border-sky-200 hover:bg-sky-50/40"
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-slate-950">{alert.patient_label}</span>
                          <span className={cn("rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em]", riskTone(alert.severity))}>
                            {severityLabel(alert.severity)}
                          </span>
                          {alert.high_risk_label ? <Badge className="bg-rose-100 text-rose-700 hover:bg-rose-100">{riskFlagLabel("high_risk")}</Badge> : null}
                          {alert.fall_risk_label ? <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">{riskFlagLabel("fall_risk")}</Badge> : null}
                        </div>
                        <p className="mt-2 text-sm text-slate-600">{alert.title}</p>
                        <p className="mt-3 text-xs text-slate-500">
                          {lang === "de"
                            ? `${alert.open_case_count} ${text.risk.openCases} · ${alert.open_appointment_count} ${text.risk.openAppointments} · ${alert.open_task_count} ${text.risk.openTasks}`
                            : `${alert.open_case_count} ${text.risk.openCases} · ${alert.open_appointment_count} ${text.risk.openAppointments} · ${alert.open_task_count} ${text.risk.openTasks}`}
                        </p>
                        <ul className="mt-3 space-y-1 text-sm text-slate-600">
                          {alert.reasons.slice(0, 3).map((reason) => (
                            <li key={reason}>- {reason}</li>
                          ))}
                        </ul>
                      </div>
                      <ArrowRight className="mt-1 size-4 shrink-0 text-slate-400" />
                    </div>
                  </button>
                )) : (
                  <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-8 text-center text-sm text-slate-500">
                    {text.risk.noPmSignals}
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {billingRisk ? (
            <div className={card("p-6")}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-base font-semibold text-slate-950">{text.risk.billingTitle}</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {text.risk.billingDescription}
                  </p>
                </div>
                <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">
                  {`${billingRisk.summary.total_alerts} ${text.risk.alerts}`}
                </Badge>
              </div>
              <div className="mt-5 grid gap-3 md:grid-cols-4">
                <div className="rounded-[1.5rem] border border-rose-200 bg-rose-50 px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.12em] text-rose-700">{severityLabel("urgent")}</p>
                  <p className="mt-3 text-2xl font-semibold tracking-tight text-rose-950">{billingRisk.summary.urgent_alerts}</p>
                  <p className="mt-2 text-sm text-rose-700">{lang === "de" ? `${billingRisk.summary.overdue_invoice_count} überfällige Rechnungen` : `${billingRisk.summary.overdue_invoice_count} просроченных счетов`}</p>
                </div>
                <div className="rounded-[1.5rem] border border-amber-200 bg-amber-50 px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.12em] text-amber-700">{text.risk.blockedOrders}</p>
                  <p className="mt-3 text-2xl font-semibold tracking-tight text-amber-950">{billingRisk.summary.blocked_orders}</p>
                  <p className="mt-2 text-sm text-amber-700">{text.risk.blockedOrdersDescription}</p>
                </div>
                <div className="rounded-[1.5rem] border border-sky-200 bg-sky-50 px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.12em] text-sky-700">{text.risk.outstanding}</p>
                  <p className="mt-3 text-2xl font-semibold tracking-tight text-sky-950">{formatMoney(billingRisk.summary.outstanding_balance_total)}</p>
                  <p className="mt-2 text-sm text-sky-700">{text.risk.outstandingDescription}</p>
                </div>
                <div className="rounded-[1.5rem] border border-violet-200 bg-violet-50 px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.12em] text-violet-700">{text.risk.exposureGap}</p>
                  <p className="mt-3 text-2xl font-semibold tracking-tight text-violet-950">{formatMoney(billingRisk.summary.exposure_gap_total)}</p>
                  <p className="mt-2 text-sm text-violet-700">{text.risk.exposureGapDescription}</p>
                </div>
              </div>
              <div className="mt-5 space-y-3">
                {billingRisk.alerts.length > 0 ? billingRisk.alerts.slice(0, 6).map((alert) => (
                  <button
                    key={`${alert.order_id}-${alert.severity}`}
                    type="button"
                    onClick={() => staffGo(`/orders?order=${alert.order_id}`)}
                    className="w-full rounded-[1.5rem] border border-slate-200 bg-white px-4 py-4 text-left shadow-sm transition-colors hover:border-amber-200 hover:bg-amber-50/30"
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-slate-950">{alert.order_number}</span>
                          <span className={cn("rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em]", riskTone(alert.severity))}>
                            {severityLabel(alert.severity)}
                          </span>
                          <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100">{phaseLabel(alert.phase)}</Badge>
                        </div>
                        <p className="mt-2 text-sm text-slate-600">{alert.patient_label}</p>
                        <p className="mt-3 text-xs text-slate-500">
                          {`${text.risk.outstandingShort} ${formatMoney(alert.outstanding_balance)} · ${text.risk.serviceShort} ${formatMoney(alert.service_gross)} · ${text.risk.invoicedShort} ${formatMoney(alert.invoiced_total)}`}
                        </p>
                        <ul className="mt-3 space-y-1 text-sm text-slate-600">
                          {alert.reasons.slice(0, 3).map((reason) => (
                            <li key={reason}>- {reason}</li>
                          ))}
                        </ul>
                      </div>
                      <ArrowRight className="mt-1 size-4 shrink-0 text-slate-400" />
                    </div>
                  </button>
                )) : (
                  <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-8 text-center text-sm text-slate-500">
                    {text.risk.noBillingSignals}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <div className={card("p-6")}>
            <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-base font-semibold text-slate-950">{text.workQueue.title}</h2>
                  <p className="mt-1 text-sm text-slate-500">{text.workQueue.description}</p>
                </div>
              <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100">{`${activeTasks.length} ${text.workQueue.open}`}</Badge>
            </div>
            <div className="mt-5 space-y-3">
              {activeTasks.length > 0 ? activeTasks.slice(0, 6).map((task) => (
                <div key={task.id} className="rounded-[1.5rem] border border-slate-200 bg-white px-4 py-4 shadow-sm">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-slate-950">{task.title}</span>
                        <span className={cn("rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em]", task.priority === "urgent" ? "border-rose-200 bg-rose-50 text-rose-700" : task.priority === "high" ? "border-amber-200 bg-amber-50 text-amber-700" : "border-sky-200 bg-sky-50 text-sky-700")}>{priorityLabel(task.priority)}</span>
                        <span className={cn("rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em]", task.status === "in_progress" ? "border-blue-200 bg-blue-50 text-blue-700" : "border-amber-200 bg-amber-50 text-amber-700")}>{taskStatusLabel(task.status)}</span>
                      </div>
                      {task.description ? <p className="mt-2 text-sm leading-6 text-slate-600">{task.description}</p> : null}
                      <p className="mt-3 text-xs text-slate-500">{dueLabel(task.due_date, { noDueDate: text.noDueDate, dueToday: text.dueToday, dueTomorrow: text.dueTomorrow, dueIn: text.dueIn, overdue: text.overdue })}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {taskHref(task) ? <Button variant="outline" size="sm" onClick={() => staffGo(taskHref(task) ?? "/")}>{text.workQueue.openButton}</Button> : null}
                      {task.status === "open" ? <Button size="sm" disabled={busyTaskId === task.id} onClick={() => void updateTask(task.id, "in_progress")}>{busyTaskId === task.id ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}{text.workQueue.start}</Button> : null}
                      {task.status !== "completed" && task.status !== "cancelled" ? <Button variant="outline" size="sm" disabled={busyTaskId === task.id} onClick={() => void updateTask(task.id, "completed")}>{busyTaskId === task.id ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}{text.workQueue.complete}</Button> : null}
                    </div>
                  </div>
                </div>
              )) : <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-8 text-center text-sm text-slate-500">{text.workQueue.empty}</div>}
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className={card("p-6")}>
              <h2 className="text-base font-semibold text-slate-950">{text.leadMomentum.title}</h2>
              <p className="mt-1 text-sm text-slate-500">{text.leadMomentum.description}</p>
              {leadsStats ? (
                <>
                  <div className="mt-5 grid gap-3 md:grid-cols-2">
                    <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/70 px-4 py-4">
                      <p className="text-xs uppercase tracking-[0.12em] text-slate-500">{t.leads_total_month}</p>
                      <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{leadsStats.total_this_month}</p>
                    </div>
                    <div className="rounded-[1.5rem] border border-violet-200 bg-violet-50 px-4 py-4">
                      <p className="text-xs uppercase tracking-[0.12em] text-violet-700">{text.leadMomentum.growthConversions}</p>
                      <p className="mt-3 flex items-center gap-2 text-3xl font-semibold tracking-tight text-violet-950"><TrendingUp className="size-5" />{leadsStats.growth_pct >= 0 ? "+" : ""}{leadsStats.growth_pct}%</p>
                      <p className="mt-2 text-sm text-violet-700">{`${leadsStats.qualified_this_month}/${leadsStats.converted_this_month} ${text.leadMomentum.qualifiedConverted}`}</p>
                    </div>
                  </div>
                  <div className="mt-5 flex h-40 items-end gap-2">
                    {bars.map((item) => <div key={item.label} className="flex flex-1 flex-col items-center gap-2"><div className="flex h-32 w-full items-end"><div className="w-full rounded-t-[1rem] bg-gradient-to-t from-sky-500 to-violet-500" style={{ height: `${Math.max((item.count / maxBar) * 100, item.count > 0 ? 8 : 0)}%` }} /></div><span className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{item.label}</span></div>)}
                  </div>
                  <p className="mt-4 text-sm text-slate-500">{`${text.leadMomentum.openPipelineVolume}: ${leadsStats.total_all}`}</p>
                </>
              ) : <div className="mt-5 rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-8 text-center text-sm text-slate-500">{text.leadMomentum.unavailable}</div>}
            </div>

            <div className={card("p-6")}>
              <h2 className="text-base font-semibold text-slate-950">{text.orderPhase.title}</h2>
              <p className="mt-1 text-sm text-slate-500">{text.orderPhase.description}</p>
              {orderPhases.length > 0 ? (
                <div className="mt-5 space-y-4">
                  {orderPhases.map((item) => <div key={item.phase}><div className="flex items-center justify-between text-sm"><span className="font-medium text-slate-800">{phaseLabel(item.phase)}</span><span className="text-slate-500">{item.count}</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-500" style={{ width: `${Math.max((item.count / Math.max(orderPhases[0]?.count ?? 1, 1)) * 100, 8)}%` }} /></div></div>)}
                </div>
              ) : <div className="mt-5 rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-8 text-center text-sm text-slate-500">{text.orderPhase.unavailable}</div>}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className={card("p-6")}>
            <h2 className="text-base font-semibold text-slate-950">{text.upcoming.title}</h2>
            <p className="mt-1 text-sm text-slate-500">{text.upcoming.description}</p>
            <div className="mt-5 space-y-3">
              {upcoming.length > 0 ? upcoming.slice(0, 6).map((item) => (
                <button key={item.id} type="button" onClick={() => staffGo(`/appointments?appointment=${item.id}`)} className="w-full rounded-[1.5rem] border border-slate-200 bg-white px-4 py-4 text-left shadow-sm transition-colors hover:border-sky-200 hover:bg-sky-50/40">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-slate-950">{item.patient_name}</span>
                        <span className={cn("rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em]", item.status === "confirmed" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-blue-200 bg-blue-50 text-blue-700")}>{appointmentStatusLabel(item.status)}</span>
                      </div>
                      <p className="mt-2 text-sm text-slate-600">{item.title}</p>
                      <p className="mt-3 text-xs text-slate-500">{`${fmtDate(item.date, false, locale, t.common_not_set)} · ${(item.time_start ?? "").slice(0, 5) || text.noTime} · ${item.location || text.noLocation}`}</p>
                    </div>
                    <ArrowRight className="mt-1 size-4 shrink-0 text-slate-400" />
                  </div>
                </button>
              )) : <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-8 text-center text-sm text-slate-500">{text.upcoming.empty}</div>}
            </div>
          </div>

          <div className={card("p-6")}>
            <h2 className="text-base font-semibold text-slate-950">{text.notifications.title}</h2>
            <p className="mt-1 text-sm text-slate-500">{text.notifications.description}</p>
            <div className="mt-5 space-y-3">
              {unread.length > 0 ? unread.map((item) => (
                <button key={item.id} type="button" onClick={() => staffGo(notificationHref(item) ?? "/")} className="w-full rounded-[1.5rem] border border-slate-200 bg-white px-4 py-4 text-left shadow-sm transition-colors hover:border-violet-200 hover:bg-violet-50/40">
                  <div className="flex items-start gap-3">
                    <span className="rounded-2xl border border-violet-200 bg-violet-50 p-2 text-violet-700"><Bell className="size-4" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2"><p className="truncate text-sm font-semibold text-slate-950">{item.title}</p><Badge className="bg-violet-100 text-violet-700 hover:bg-violet-100">{text.notifications.new}</Badge></div>
                      {item.body ? <p className="mt-1 text-sm text-slate-600">{item.body}</p> : null}
                      <p className="mt-3 text-xs text-slate-500">{fmtDate(item.created_at, true, locale, t.common_not_set)}</p>
                    </div>
                  </div>
                </button>
              )) : <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-8 text-center text-sm text-slate-500">{text.notifications.empty}</div>}
            </div>
          </div>

          <div className={card("p-6")}>
            <h2 className="text-base font-semibold text-slate-950">{text.quickLinks.title}</h2>
            <p className="mt-1 text-sm text-slate-500">{text.quickLinks.description}</p>
            <div className="mt-5 grid gap-3">
              <StaffLink to="/patients" className="flex items-center justify-between rounded-[1.5rem] border border-slate-200 bg-white px-4 py-4 shadow-sm transition-colors hover:border-sky-200 hover:bg-sky-50/40"><div className="flex items-center gap-3"><span className="rounded-2xl bg-sky-100 p-2 text-sky-700"><Users className="size-4" /></span><div><p className="text-sm font-semibold text-slate-950">{text.quickLinks.patientRegistry}</p><p className="text-sm text-slate-500">{text.quickLinks.patientRegistryDescription}</p></div></div><ArrowRight className="size-4 text-slate-400" /></StaffLink>
              <StaffLink to="/providers" className="flex items-center justify-between rounded-[1.5rem] border border-slate-200 bg-white px-4 py-4 shadow-sm transition-colors hover:border-emerald-200 hover:bg-emerald-50/40"><div className="flex items-center gap-3"><span className="rounded-2xl bg-emerald-100 p-2 text-emerald-700"><Building2 className="size-4" /></span><div><p className="text-sm font-semibold text-slate-950">{text.quickLinks.clinicNetwork}</p><p className="text-sm text-slate-500">{text.quickLinks.clinicNetworkDescription}</p></div></div><ArrowRight className="size-4 text-slate-400" /></StaffLink>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
