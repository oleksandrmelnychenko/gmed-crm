import {
  lazy,
  Suspense,
  useDeferredValue,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  LoaderCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  inputClass as formInputClassName,
  textareaClass as formTextareaClassName,
} from "@/components/ui-shell";
import { toast } from "@/components/ui/toast";
import {
  localizeWorkflowGroupLabel,
} from "@/lib/workflow-labels";
import { useAuth } from "@/lib/auth";
import { getLang, useLang } from "@/lib/i18n";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { cn } from "@/lib/utils";

import {
  buildPatientLabelPrintHtml,
  buildPatientTimelineSummary,
  canOpenPatientDocumentsWorkspace,
  canViewPatientContractsSurface,
  canViewPatientDocumentsSurface,
  canViewPatientInvoicesSurface,
  canViewPatientOperationalSurface,
  DEFAULT_PATIENT_LABEL_FORMAT_ID,
  filterPatientTimelineItems,
  normalizePatientDetailTab,
  type PatientLabelFormatId,
  type PatientLabelPayload,
  type PatientTimelineItem,
  type PatientTimelineRangeFilter,
} from "./model/detail-model";
import type {
  PatientAssignment,
  PatientDetail,
} from "./model/list-model";
import { usePatientDetailCoreData } from "./data/use-patient-detail-core-data";
import {
  completePatientWorkflowChecklistItem,
  createFrameworkContract,
  createInvoiceDunningEvent,
  createPatientWorkflowChecklistItem,
  deletePatientRelation,
  exportPatientComplianceArchive,
  fetchPatientLabelPayload,
  revokePatientAssignment,
  updateFrameworkContractStatus,
  updateInvoiceStatus,
  updatePatientMedicalOrderLifecycle,
} from "./data/patient-detail-mutations";
import {
  assignPatient,
  togglePatientActivation,
} from "./data/patient-mutations";
import type {
  ContractItem,
  DunningEvent,
  InvoiceItem,
  RelationItem,
  WorkflowChecklistItem,
} from "./model/detail-tab-types";
import { usePatientDetailTabData } from "./data/use-patient-detail-tab-data";
import { usePatientInvoiceDunningEvents } from "./data/use-patient-invoice-dunning-events";
import { PatientDetailWorkspaceContent } from "./ui/workspace/patient-detail-workspace-content";
import {
  getPatientLegalStatusChecklist,
  getPatientLegalStatusCompletion,
  normalizePatientLegalStatus,
} from "./model/legal-status";

const loadPatientDetailOverlayLayers = () => import("./ui/workspace/patient-detail-overlay-layers");

const LazyPatientDetailOverlayLayers = lazy(async () => {
  const mod = await loadPatientDetailOverlayLayers();
  return { default: mod.PatientDetailOverlayLayers };
});

function preloadPatientDetailOverlayLayers() {
  void loadPatientDetailOverlayLayers();
}

type PatientVitalFormState = {
  measuredAt: string;
  bpSystolic: string;
  bpDiastolic: string;
  heartRate: string;
  weightKg: string;
  heightCm: string;
  bmi: string;
  notes: string;
};

type PatientCardEntryFormState = {
  entryDate: string;
  category: string;
  source: string;
  content: string;
};

type PatientMedicalOrderFormState = {
  orderDate: string;
  orderType: string;
  title: string;
  instructions: string;
  dueDate: string;
  source: string;
};

type PatientRiskScoreFormState = {
  computedAt: string;
  scoreType: string;
  scoreValue: string;
  scaleMax: string;
  interpretation: string;
  source: string;
  inputsJson: string;
};

const PATIENT_CARD_ENTRY_CATEGORY_OPTIONS = [
  { value: "medical_update", label: "Medical update" },
  { value: "patient_report", label: "Patient report" },
  { value: "provider_report", label: "Provider report" },
  { value: "treatment_note", label: "Treatment note" },
  { value: "followup_note", label: "Follow-up note" },
  { value: "warning", label: "Warning" },
  { value: "other", label: "Other" },
] as const;

const PATIENT_MEDICAL_ORDER_TYPE_OPTIONS = [
  { value: "physiotherapy", label: "Physiotherapy" },
  { value: "diet", label: "Diet" },
  { value: "lab_recheck", label: "Lab recheck" },
  { value: "imaging", label: "Imaging" },
  { value: "medication_followup", label: "Medication follow-up" },
  { value: "procedure", label: "Procedure" },
  { value: "other", label: "Other" },
] as const;

const PATIENT_RISK_SCORE_TYPE_OPTIONS = [
  { value: "cha2ds2_vasc", label: "CHA2DS2-VASc" },
  { value: "has_bled", label: "HAS-BLED" },
  { value: "framingham", label: "Framingham" },
  { value: "fall_risk", label: "Fall risk" },
  { value: "frailty", label: "Frailty" },
  { value: "nutrition_risk", label: "Nutrition risk" },
  { value: "other", label: "Other" },
] as const;

type ContractStatus = "draft" | "sent" | "signed" | "expired" | "terminated";

type ContractFormState = {
  status: ContractStatus;
  validFrom: string;
  validTo: string;
  signedAt: string;
};

type InvoiceStatus = "draft" | "sent" | "partially_paid" | "paid" | "overdue" | "cancelled";

type InvoiceStatusFormState = {
  status: InvoiceStatus;
  dueDate: string;
  paidAmount: string;
  notes: string;
};

type DunningLevel = "first" | "second" | "collections";

type WorkflowChecklistFormState = {
  itemText: string;
  ownerUserId: string;
  priority: string;
  dueDate: string;
};

function patientName(p: PatientDetail) {
  const t = p.title ? `${p.title} ` : "";
  const n = [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
  return `${t}${n || p.patient_id}`.trim();
}

function fmtDate(v?: string | null, fb = "") {
  if (!v) return fb;
  try {
    return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(v.includes("T") ? v : `${v}T00:00:00`));
  } catch { return v; }
}

function fmtDateTime(v?: string | null, fb = "") {
  if (!v) return fb;
  try {
    return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(v));
  } catch { return v; }
}

function appointmentCarePathKindLabel(value?: string | null) {
  if (value === "preventive") return patientDetailText("Präventiv", "Профилактика", "Preventive");
  if (value === "control") return patientDetailText("Kontrolle", "Контроль", "Control");
  if (value === "followup") return patientDetailText("Nachsorge", "Наблюдение", "Follow-up");
  return patientDetailText("Regulär", "Стандартный", "Regular");
}

function fieldVal(v: string | string[] | null | undefined, fb: string) {
  if (Array.isArray(v)) return v.length ? v.join(", ") : fb;
  return v && v.trim() ? v : fb;
}

function fmtMoney(v?: string | null, currency = "EUR") {
  if (!v) return patientDetailText("Nicht festgelegt", "Не задано", "Not set");
  const numeric = Number(v);
  if (Number.isNaN(numeric)) return `${v} ${currency}`;
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(numeric);
  } catch {
    return `${v} ${currency}`;
  }
}

function patientDetailText(de: string, ru: string, en: string) {
  const lang = getLang();
  if (lang === "de") return de;
  if (lang === "ru") return ru;
  return en;
}

function toOptional(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function toDateTimeLocal(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return shifted.toISOString().slice(0, 16);
}

function formatVitalNumber(
  value: number | null | undefined,
  options: Intl.NumberFormatOptions = { maximumFractionDigits: 1 },
) {
  if (value == null || Number.isNaN(value)) return null;
  try {
    return new Intl.NumberFormat(undefined, options).format(value);
  } catch {
    return `${value}`;
  }
}

function parseOptionalNumberInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed.replace(",", "."));
  if (!Number.isFinite(parsed)) {
    throw new Error(
      patientDetailText(
        "Geben Sie eine gültige Zahl ein",
        "Введите корректное число",
        "Enter a valid number",
      ),
    );
  }
  return parsed;
}

function parseOptionalIntegerInput(value: string) {
  const parsed = parseOptionalNumberInput(value);
  if (parsed == null) return undefined;
  if (!Number.isInteger(parsed)) {
    throw new Error(
      patientDetailText(
        "Geben Sie eine ganze Zahl ein",
        "Введите целое число",
        "Enter a whole number",
      ),
    );
  }
  return parsed;
}

function computeVitalBmi(weightKg: string, heightCm: string) {
  try {
    const weight = parseOptionalNumberInput(weightKg);
    const height = parseOptionalNumberInput(heightCm);
    if (weight == null || height == null || height <= 0) return null;
    const heightM = height / 100;
    return Math.round((weight / (heightM * heightM)) * 10) / 10;
  } catch {
    return null;
  }
}

function genderLbl(v: string | null | undefined, tr: Record<string, string>) {
  switch (v) { case "male": return tr.gender_male; case "female": return tr.gender_female; case "diverse": return tr.gender_diverse; default: return tr.common_not_set; }
}

function insuranceLbl(v: string | null | undefined, tr: Record<string, string>) {
  switch (v) { case "private": return tr.insurance_private; case "public": return tr.insurance_public; case "self_pay": return tr.insurance_self_pay; case "foreign": return tr.insurance_foreign; default: return tr.common_not_set; }
}

function roleLbl(v: string | null | undefined, tr: Record<string, string>) {
  if (!v) return tr.common_unknown;
  return tr[`role_${v}`] ?? v.replaceAll("_", " ");
}

function relationTypeLabel(value: string) {
  switch (value) {
    case "spouse":
      return patientDetailText("Ehepartner", "Супруг(а)", "Spouse");
    case "parent":
      return patientDetailText("Elternteil", "Родитель", "Parent");
    case "child":
      return patientDetailText("Kind", "Ребёнок", "Child");
    case "sibling":
      return patientDetailText("Geschwister", "Брат/сестра", "Sibling");
    case "relative":
      return patientDetailText("Verwandter", "Родственник", "Relative");
    case "guardian":
      return patientDetailText("Vormund", "Опекун", "Guardian");
    case "caregiver":
      return patientDetailText("Betreuung", "Опекун/сиделка", "Caregiver");
    case "friend":
      return patientDetailText("Freund", "Друг", "Friend");
    case "other":
      return patientDetailText("Sonstiges", "Другое", "Other");
    default:
      return value.replaceAll("_", " ");
  }
}

function orderPhaseLabel(value: string) {
  switch (value) {
    case "discovery":
      return patientDetailText("Discovery", "Диагностика потребности", "Discovery");
    case "intake":
      return patientDetailText("Aufnahme", "Интейк", "Intake");
    case "execution":
      return patientDetailText("Ausführung", "Исполнение", "Execution");
    case "closure":
      return patientDetailText("Abschluss", "Закрытие", "Closure");
    case "followup":
      return patientDetailText("Nachbetreuung", "Наблюдение", "Follow-up");
    default:
      return value.replaceAll("_", " ");
  }
}

function appointmentTypeLabel(value: string) {
  switch (value) {
    case "consultation":
      return patientDetailText("Konsultation", "Консультация", "Consultation");
    case "followup":
      return patientDetailText("Nachsorgetermin", "Повторный приём", "Follow-up");
    case "diagnostics":
      return patientDetailText("Diagnostik", "Диагностика", "Diagnostics");
    case "procedure":
      return patientDetailText("Eingriff", "Процедура", "Procedure");
    default:
      return value.replaceAll("_", " ");
  }
}

function invoiceTypeLabel(value: string) {
  switch (value) {
    case "advance":
      return patientDetailText("Vorauszahlung", "Аванс", "Advance");
    case "interim":
      return patientDetailText("Zwischenrechnung", "Промежуточный счёт", "Interim");
    case "final":
      return patientDetailText("Abschlussrechnung", "Финальный счёт", "Final");
    default:
      return value.replaceAll("_", " ");
  }
}

function canAssignTarget(managerRole: string | undefined, targetRole: string) {
  switch (managerRole) {
    case "ceo": return ["patient_manager", "teamlead_interpreter", "interpreter", "concierge"].includes(targetRole);
    case "patient_manager": return ["teamlead_interpreter", "interpreter", "concierge"].includes(targetRole);
    case "teamlead_interpreter": return targetRole === "interpreter";
    default: return false;
  }
}

const spaciousTextareaClassName = cn(
  formTextareaClassName,
  "min-h-[104px]",
);

const CONTRACT_STATUS_OPTIONS: ContractStatus[] = [
  "draft",
  "sent",
  "signed",
  "expired",
  "terminated",
];
const INVOICE_STATUS_OPTIONS: InvoiceStatus[] = [
  "draft",
  "sent",
  "partially_paid",
  "paid",
  "overdue",
  "cancelled",
];
function blankContractForm(): ContractFormState {
  return {
    status: "draft",
    validFrom: "",
    validTo: "",
    signedAt: "",
  };
}

function contractToForm(contract: ContractItem): ContractFormState {
  return {
    status: (contract.status as ContractStatus) ?? "draft",
    validFrom: contract.valid_from ?? "",
    validTo: contract.valid_to ?? "",
    signedAt: toDateTimeLocal(contract.signed_at),
  };
}

function invoiceToStatusForm(invoice: InvoiceItem): InvoiceStatusFormState {
  return {
    status: (invoice.status as InvoiceStatus) ?? "draft",
    dueDate: invoice.due_date ?? "",
    paidAmount: invoice.paid_amount ?? "",
    notes: "",
  };
}

function blankWorkflowChecklistForm(): WorkflowChecklistFormState {
  return {
    itemText: "",
    ownerUserId: "",
    priority: "normal",
    dueDate: "",
  };
}

function blankPatientVitalForm(): PatientVitalFormState {
  return {
    measuredAt: toDateTimeLocal(new Date().toISOString()),
    bpSystolic: "",
    bpDiastolic: "",
    heartRate: "",
    weightKg: "",
    heightCm: "",
    bmi: "",
    notes: "",
  };
}

function blankPatientCardEntryForm(): PatientCardEntryFormState {
  return {
    entryDate: toDateTimeLocal(new Date().toISOString()),
    category: PATIENT_CARD_ENTRY_CATEGORY_OPTIONS[0].value,
    source: "",
    content: "",
  };
}

function patientCardEntryCategoryLabel(category: string) {
  switch (category) {
    case "medical_update":
      return patientDetailText("Medizinisches Update", "Медицинское обновление", "Medical update");
    case "patient_report":
      return patientDetailText("Bericht des Patienten", "Сообщение пациента", "Patient report");
    case "provider_report":
      return patientDetailText("Bericht der Klinik", "Отчёт провайдера", "Provider report");
    case "treatment_note":
      return patientDetailText("Behandlungsnotiz", "Заметка по лечению", "Treatment note");
    case "followup_note":
      return patientDetailText("Nachsorge-Notiz", "Заметка по наблюдению", "Follow-up note");
    case "warning":
      return patientDetailText("Warnhinweis", "Предупреждение", "Warning");
    case "other":
      return patientDetailText("Sonstiges", "Другое", "Other");
    default:
      return category.replaceAll("_", " ");
  }
}

function patientCardEntryCategoryBadgeClass(category: string) {
  switch (category) {
    case "medical_update":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "patient_report":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "provider_report":
      return "border-teal-200 bg-teal-50 text-teal-700";
    case "treatment_note":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "followup_note":
      return "border-violet-200 bg-violet-50 text-violet-700";
    case "warning":
      return "border-rose-200 bg-rose-50 text-rose-700";
    default:
      return "border-slate-200 bg-slate-50 text-slate-700";
  }
}

function blankPatientMedicalOrderForm(): PatientMedicalOrderFormState {
  return {
    orderDate: toDateTimeLocal(new Date().toISOString()),
    orderType: PATIENT_MEDICAL_ORDER_TYPE_OPTIONS[0].value,
    title: "",
    instructions: "",
    dueDate: "",
    source: "",
  };
}

function patientMedicalOrderTypeLabel(orderType: string) {
  switch (orderType) {
    case "physiotherapy":
      return patientDetailText("Physiotherapie", "Физиотерапия", "Physiotherapy");
    case "diet":
      return patientDetailText("Ernährung", "Диета", "Diet");
    case "lab_recheck":
      return patientDetailText("Laborkontrolle", "Повторный анализ", "Lab recheck");
    case "imaging":
      return patientDetailText("Bildgebung", "Визуализация", "Imaging");
    case "medication_followup":
      return patientDetailText("Medikationskontrolle", "Контроль медикации", "Medication follow-up");
    case "procedure":
      return patientDetailText("Eingriff", "Процедура", "Procedure");
    case "other":
      return patientDetailText("Sonstiges", "Другое", "Other");
    default:
      return orderType.replaceAll("_", " ");
  }
}

function blankPatientRiskScoreForm(): PatientRiskScoreFormState {
  return {
    computedAt: toDateTimeLocal(new Date().toISOString()),
    scoreType: PATIENT_RISK_SCORE_TYPE_OPTIONS[0].value,
    scoreValue: "",
    scaleMax: "",
    interpretation: "",
    source: "",
    inputsJson: "",
  };
}

function patientRiskScoreTypeLabel(scoreType: string) {
  switch (scoreType) {
    case "cha2ds2_vasc":
      return "CHA2DS2-VASc";
    case "has_bled":
      return "HAS-BLED";
    case "framingham":
      return "Framingham";
    case "fall_risk":
      return patientDetailText("Sturzrisiko", "Риск падения", "Fall risk");
    case "frailty":
      return patientDetailText("Gebrechlichkeit", "Хрупкость", "Frailty");
    case "nutrition_risk":
      return patientDetailText("Ernährungsrisiko", "Риск питания", "Nutrition risk");
    case "other":
      return patientDetailText("Sonstiges", "Другое", "Other");
    default:
      return scoreType.replaceAll("_", " ");
  }
}

function workflowChecklistLabel(key: string) {
  switch (key) {
    case "patient_intake":
      return patientDetailText("Patientenaufnahme", "Приём пациента", "Patient intake");
    case "patient_custom":
      return patientDetailText("Benutzerdefiniert", "Пользовательское", "Custom");
    default:
      return key.replaceAll("_", " ");
  }
}

function patientDetailStatusLabel(status: string) {
  switch (status) {
    case "not_started":
      return patientDetailText("Nicht begonnen", "Не начат", "Not started");
    case "pending":
      return patientDetailText("Ausstehend", "В ожидании", "Pending");
    case "open":
      return patientDetailText("Offen", "Открыто", "Open");
    case "in_progress":
      return patientDetailText("In Bearbeitung", "В работе", "In progress");
    case "closed":
      return patientDetailText("Geschlossen", "Закрыто", "Closed");
    case "active":
      return patientDetailText("Aktiv", "Активно", "Active");
    case "completed":
      return patientDetailText("Abgeschlossen", "Завершено", "Completed");
    case "draft":
      return patientDetailText("Entwurf", "Черновик", "Draft");
    case "sent":
      return patientDetailText("Gesendet", "Отправлено", "Sent");
    case "signed":
      return patientDetailText("Unterzeichnet", "Подписано", "Signed");
    case "overdue":
      return patientDetailText("Überfällig", "Просрочено", "Overdue");
    case "partially_paid":
      return patientDetailText("Teilweise bezahlt", "Частично оплачено", "Partially paid");
    case "paid":
      return patientDetailText("Bezahlt", "Оплачено", "Paid");
    case "expired":
      return patientDetailText("Abgelaufen", "Истекло", "Expired");
    case "terminated":
      return patientDetailText("Beendet", "Расторгнуто", "Terminated");
    case "cancelled":
      return patientDetailText("Storniert", "Отменено", "Cancelled");
    case "planned":
      return patientDetailText("Geplant", "Запланировано", "Planned");
    case "confirmed":
      return patientDetailText("Bestätigt", "Подтверждено", "Confirmed");
    case "submitted":
      return patientDetailText("Eingereicht", "Отправлено", "Submitted");
    case "archived":
      return patientDetailText("Archiviert", "В архиве", "Archived");
    default:
      return status.replaceAll("_", " ");
  }
}

function priorityLabel(priority: string) {
  switch (priority) {
    case "low":
      return patientDetailText("Niedrig", "Низкий", "Low");
    case "normal":
      return patientDetailText("Normal", "Обычный", "Normal");
    case "high":
      return patientDetailText("Hoch", "Высокий", "High");
    case "urgent":
      return patientDetailText("Dringend", "Срочно", "Urgent");
    default:
      return priority;
  }
}

function timelineRangeOptions(
  lang: string,
): Array<{ value: PatientTimelineRangeFilter; label: string }> {
  const translate = (de: string, ru: string, en: string) => {
    if (lang === "de") return de;
    if (lang === "ru") return ru;
    return en;
  };

  return [
    { value: "all", label: translate("Gesamter Zeitraum", "Всё время", "All time") },
    { value: "30d", label: translate("Letzte 30 Tage", "Последние 30 дней", "Last 30 days") },
    { value: "90d", label: translate("Letzte 90 Tage", "Последние 90 дней", "Last 90 days") },
    { value: "180d", label: translate("Letzte 180 Tage", "Последние 180 дней", "Last 180 days") },
    { value: "365d", label: translate("Letzte 365 Tage", "Последние 365 дней", "Last 365 days") },
  ];
}

function normalizeTimelineRangeFilterValue(
  value: string | null | undefined,
): PatientTimelineRangeFilter {
  switch (value) {
    case "30d":
    case "90d":
    case "180d":
    case "365d":
      return value;
    default:
      return "all";
  }
}

function normalizeTimelineQueryValue(value: string | null | undefined) {
  const normalized = (value ?? "").trim();
  return normalized || "all";
}

function normalizeTimelineSearchValue(value: string | null | undefined) {
  return (value ?? "").trim();
}

function normalizeTimelineOffsetValue(value: string | null | undefined) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.floor(numeric);
}

function moneyValueNumber(value?: string | null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function isContractExpiringSoon(
  contract: Pick<ContractItem, "valid_to" | "status">,
  now = new Date(),
) {
  if (!contract.valid_to) return false;
  if (contract.status === "expired" || contract.status === "terminated" || contract.status === "cancelled") {
    return false;
  }
  const validTo = new Date(contract.valid_to);
  if (Number.isNaN(validTo.getTime())) return false;
  const threshold = new Date(now);
  threshold.setDate(threshold.getDate() + 30);
  return validTo >= now && validTo <= threshold;
}

function priorityBadgeClass(priority: string) {
  switch (priority) {
    case "urgent":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "high":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "low":
      return "border-slate-200 bg-slate-50 text-slate-600";
    default:
      return "border-sky-200 bg-sky-50 text-sky-700";
  }
}

function timelineEntityDotClass(entityType: string) {
  switch (entityType) {
    case "case":
      return "bg-sky-500";
    case "order":
      return "bg-amber-500";
    case "appointment":
      return "bg-violet-500";
    case "document":
      return "bg-emerald-500";
    case "contract":
      return "bg-cyan-500";
    case "invoice":
      return "bg-rose-500";
    case "compliance":
      return "bg-slate-500";
    default:
      return "bg-[var(--brand)]";
  }
}

function timelineItemSurfaceClass(status: string) {
  switch (status) {
    case "open":
    case "in_progress":
    case "planned":
    case "confirmed":
      return "border-sky-200/80 bg-sky-50/40";
    case "completed":
    case "closed":
    case "paid":
    case "signed":
    case "archived":
      return "border-emerald-200/80 bg-emerald-50/35";
    case "overdue":
    case "cancelled":
    case "expired":
    case "terminated":
      return "border-rose-200/80 bg-rose-50/40";
    default:
      return "border-border/50 bg-background";
  }
}

function timelineDateGroupKey(value?: string | null) {
  if (!value) return "unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function timelineDateGroupLabel(value: string | null | undefined, lang: string) {
  const key = timelineDateGroupKey(value);
  if (key === "unknown") {
    if (lang === "de") return "Unbekanntes Datum";
    if (lang === "ru") return "Дата не указана";
    return "Unknown date";
  }

  const date = new Date(value!);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const sameDay = (left: Date, right: Date) =>
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate();

  if (sameDay(date, today)) {
    if (lang === "de") return "Heute";
    if (lang === "ru") return "Сегодня";
    return "Today";
  }

  if (sameDay(date, yesterday)) {
    if (lang === "de") return "Gestern";
    if (lang === "ru") return "Вчера";
    return "Yesterday";
  }

  return fmtDate(value, key);
}

function nextDunningLevel(events: DunningEvent[]): DunningLevel | null {
  const levels = new Set(events.map((event) => event.level));
  if (!levels.has("first")) return "first";
  if (!levels.has("second")) return "second";
  if (!levels.has("collections")) return "collections";
  return null;
}

const STATUS_COLORS: Record<string, string> = {
  open: "border-sky-200 bg-sky-50 text-sky-700",
  in_progress: "border-amber-200 bg-amber-50 text-amber-700",
  closed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  active: "border-emerald-200 bg-emerald-50 text-emerald-700",
  completed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  draft: "border-slate-200 bg-slate-50 text-slate-700",
  sent: "border-sky-200 bg-sky-50 text-sky-700",
  signed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  overdue: "border-rose-200 bg-rose-50 text-rose-700",
  partially_paid: "border-amber-200 bg-amber-50 text-amber-700",
  paid: "border-emerald-200 bg-emerald-50 text-emerald-700",
  expired: "border-slate-200 bg-slate-50 text-slate-600",
  terminated: "border-red-200 bg-red-50 text-red-700",
  cancelled: "border-red-200 bg-red-50 text-red-700",
  planned: "border-sky-200 bg-sky-50 text-sky-700",
  confirmed: "border-sky-200 bg-sky-50 text-sky-700",
};

const ROLE_COLORS: Record<string, string> = {
  ceo: "bg-purple-100 text-purple-700",
  ceo_assistant: "bg-purple-100 text-purple-700",
  patient_manager: "bg-blue-100 text-blue-700",
  teamlead_interpreter: "bg-cyan-100 text-cyan-700",
  interpreter: "bg-cyan-100 text-cyan-700",
  concierge: "bg-teal-100 text-teal-700",
  billing: "bg-amber-100 text-amber-700",
  sales: "bg-amber-100 text-amber-700",
  it_admin: "bg-slate-100 text-slate-700",
  patient: "bg-emerald-100 text-emerald-700",
};

const STATUS_BADGE_CLASSES: Record<string, string> = {
  active: "border-emerald-200 bg-emerald-50 text-emerald-700",
  completed: "border-sky-200 bg-sky-50 text-sky-700",
  cancelled: "border-rose-200 bg-rose-50 text-rose-700",
};
export function PatientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { staffGo } = useStaffNavigate();
  const { user } = useAuth();
  const { t, lang } = useLang();
  const tr = t as unknown as Record<string, string>;
  const l = (de: string, ru: string, en: string) =>
    lang === "de" ? de : lang === "ru" ? ru : en;

  const [actionErrorState, setActionErrorState] = useState<{ patientId: string; message: string }>({
    patientId: "",
    message: "",
  });
  const [selectedAssignee, setSelectedAssignee] = useState("");
  const [assignBusy, setAssignBusy] = useState(false);

  const [activeTab, setActiveTab] = useState(searchParams.get("tab") || "profile");
  const [version, setVersion] = useState(0);
  const [tabVersion, setTabVersion] = useState(0);
  const [tabActionError, setTabActionError] = useState("");
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const [cardEntrySheetOpen, setCardEntrySheetOpen] = useState(false);
  const [docsPreviewOpen, setDocsPreviewOpen] = useState(false);
  const [contractsPreviewOpen, setContractsPreviewOpen] = useState(false);
  const [invoicesPreviewOpen, setInvoicesPreviewOpen] = useState(false);
  const [legalStatusSheetOpen, setLegalStatusSheetOpen] = useState(false);
  const [vitalsSheetOpen, setVitalsSheetOpen] = useState(false);
  const [caveSheetOpen, setCaveSheetOpen] = useState(false);
  const [notesSheetOpen, setNotesSheetOpen] = useState(false);
  const [medicalOrderActionId, setMedicalOrderActionId] = useState("");
  const [medicalOrderSheetOpen, setMedicalOrderSheetOpen] = useState(false);
  const [riskScoreSheetOpen, setRiskScoreSheetOpen] = useState(false);
  const [appointmentSheetOpen, setAppointmentSheetOpen] = useState(false);

  const [relationEditorOpen, setRelationEditorOpen] = useState(false);
  const [editingRelation, setEditingRelation] = useState<RelationItem | null>(null);

  const [documentUploadOpen, setDocumentUploadOpen] = useState(false);

  const [contractCreateOpen, setContractCreateOpen] = useState(false);
  const [contractCreateForm, setContractCreateForm] = useState<ContractFormState>(blankContractForm);
  const [contractBusy, setContractBusy] = useState(false);
  const [contractStatusId, setContractStatusId] = useState("");
  const [contractStatusForm, setContractStatusForm] = useState<ContractFormState>(blankContractForm);

  const [invoiceManageId, setInvoiceManageId] = useState("");
  const [invoiceStatusForm, setInvoiceStatusForm] = useState<InvoiceStatusFormState>({
    status: "draft",
    dueDate: "",
    paidAmount: "",
    notes: "",
  });
  const [invoiceBusy, setInvoiceBusy] = useState(false);
  const [dunningBusy, setDunningBusy] = useState(false);
  const [dunningNote, setDunningNote] = useState("");
  const [complianceExportBusy, setComplianceExportBusy] = useState(false);
  const [patientLabelBusy, setPatientLabelBusy] = useState(false);
  const [patientLabelFormat, setPatientLabelFormat] =
    useState<PatientLabelFormatId>(DEFAULT_PATIENT_LABEL_FORMAT_ID);
  const [workflowBusy, setWorkflowBusy] = useState(false);
  const [workflowForm, setWorkflowForm] = useState<WorkflowChecklistFormState>(
    blankWorkflowChecklistForm
  );
  const [documentStatusFilter, setDocumentStatusFilter] = useState("all");
  const [documentCategoryFilter, setDocumentCategoryFilter] = useState("all");
  const [timelineEntityFilter, setTimelineEntityFilter] = useState(() =>
    normalizeTimelineQueryValue(searchParams.get("entity_type"))
  );
  const [timelineCategoryFilter, setTimelineCategoryFilter] = useState(() =>
    normalizeTimelineQueryValue(searchParams.get("category"))
  );
  const [timelineSourceFilter, setTimelineSourceFilter] = useState(() =>
    normalizeTimelineQueryValue(searchParams.get("source"))
  );
  const [timelineRangeFilter, setTimelineRangeFilter] = useState<PatientTimelineRangeFilter>(() =>
    normalizeTimelineRangeFilterValue(searchParams.get("range"))
  );
  const [timelineSearch, setTimelineSearch] = useState(() =>
    normalizeTimelineSearchValue(searchParams.get("search"))
  );
  const [timelineOffset, setTimelineOffset] = useState(() =>
    normalizeTimelineOffsetValue(searchParams.get("offset"))
  );
  const timelineLimit = 50;

  const canManage = user?.role === "ceo" || user?.role === "patient_manager" || user?.role === "teamlead_interpreter";
  const canManageRelations = user?.role === "ceo" || user?.role === "patient_manager";
  const canViewOperationalSurface = canViewPatientOperationalSurface(user?.role);
  const canViewDocuments = canViewPatientDocumentsSurface(user?.role);
  const canOpenDocumentsWorkspace = canOpenPatientDocumentsWorkspace(user?.role);
  const canManageDocuments = user?.role === "ceo" || user?.role === "patient_manager";
  const canViewContracts = canViewPatientContractsSurface(user?.role);
  const canManageContracts =
    user?.role === "ceo" || user?.role === "patient_manager" || user?.role === "billing";
  const canViewInvoices = canViewPatientInvoicesSurface(user?.role);
  const canManageInvoices = user?.role === "ceo" || user?.role === "billing";
  const canEditPatientProfile = user?.role === "ceo" || user?.role === "patient_manager";
  const canManagePatientVitals = canEditPatientProfile;
  const canManagePatientCardEntries = canEditPatientProfile;
  const canManagePatientMedicalOrders = canEditPatientProfile;
  const canManagePatientRiskScores = canEditPatientProfile;
  const canExportPatientCompliance = user?.role === "ceo" || user?.role === "patient_manager";
  const canOpenComplianceWorkspace = user?.role === "ceo" || user?.role === "patient_manager";
  const canPrintPatientLabel = user?.role === "ceo" || user?.role === "patient_manager";
  const canManageWorkflowChecklist =
    user?.role === "ceo" ||
    user?.role === "patient_manager" ||
    user?.role === "concierge";
  const deferredTimelineSearch = useDeferredValue(timelineSearch);
  const {
    assignments,
    cardEntries,
    coreError,
    detail,
    loading,
    medicalOrders,
    riskScores,
    staff,
    vitalsHistory,
  } = usePatientDetailCoreData({
    canManagePatientCardEntries,
    canManagePatientMedicalOrders,
    canManagePatientRiskScores,
    canManagePatientVitals,
    id,
    version,
  });
  const assignableStaff = useMemo(() => staff.filter((s) => canAssignTarget(user?.role, s.role)), [staff, user?.role]);
  const {
    appointments,
    cases,
    contracts,
    documentAlerts,
    documents,
    invoices,
    orders,
    relations,
    tabLoading,
    timeline,
    timelineTotal,
    workflowChecklist,
  } = usePatientDetailTabData({
    activeTab,
    canViewContracts,
    canViewDocuments,
    canViewInvoices,
    canViewOperationalSurface,
    deferredTimelineSearch,
    id,
    tabVersion,
    timelineCategoryFilter,
    timelineEntityFilter,
    timelineLimit,
    timelineOffset,
    timelineRangeFilter,
    timelineSourceFilter,
  });
  const { appendDunningEvent, dunningEvents } =
    usePatientInvoiceDunningEvents(invoiceManageId);
  const error =
    (actionErrorState.patientId === (id ?? "") ? actionErrorState.message : "") || coreError;
  const workspaceTabs = [
    {
      key: "profile",
      label: t.patients_profile,
    },
    canViewOperationalSurface
      ? {
          key: "relations",
          label: t.patients_relations,
        }
      : null,
    canViewOperationalSurface
      ? {
          key: "cases",
          label: t.cases_title,
        }
      : null,
    canViewOperationalSurface
      ? {
          key: "orders",
          label: t.orders_title,
        }
      : null,
    canViewOperationalSurface
      ? {
          key: "appointments",
          label: t.appointments_title,
        }
      : null,
    canViewDocuments
      ? {
          key: "documents",
          label: t.documents_title,
        }
      : null,
    canViewContracts
      ? {
          key: "contracts",
          label: t.contracts_title,
        }
      : null,
    canViewInvoices
      ? {
          key: "invoices",
          label: t.invoices_title,
        }
      : null,
    canViewOperationalSurface
      ? {
          key: "workflow",
          label: t.patients_workflow,
        }
      : null,
    canViewOperationalSurface
      ? {
          key: "curators",
          label: t.patients_assign_owner,
        }
      : null,
    canViewOperationalSurface
      ? {
          key: "timeline",
          label: t.patients_timeline,
        }
      : null,
  ].filter((item): item is { key: string; label: string } => Boolean(item));
  const activeWorkflowAssignees = useMemo(
    () =>
      assignments.filter(
        (item) => !item.revoked_at && item.user_active
      ),
    [assignments]
  );
  const isDocumentsTabActive = activeTab === "documents";
  const isContractsTabActive = activeTab === "contracts";
  const isInvoicesTabActive = activeTab === "invoices";
  const isWorkflowTabActive = activeTab === "workflow";
  const isTimelineTabActive = activeTab === "timeline";
  const timelineCategoryOptions = useMemo(
    () =>
      isTimelineTabActive
        ? [...new Set(timeline.map((item) => item.category).filter((value) => Boolean(value?.trim())))]
            .toSorted((left, right) => left.localeCompare(right))
        : [],
    [isTimelineTabActive, timeline]
  );
  const timelineSourceOptions = useMemo(
    () =>
      isTimelineTabActive
        ? [...new Set(timeline.map((item) => item.source_label ?? "").filter((value) => Boolean(value.trim())))]
            .toSorted((left, right) => left.localeCompare(right))
        : [],
    [isTimelineTabActive, timeline]
  );

  const filteredTimeline = useMemo(
    () =>
      isTimelineTabActive
        ? filterPatientTimelineItems(timeline, {
            entityFilter: timelineEntityFilter,
            categoryFilter: timelineCategoryFilter,
            sourceFilter: timelineSourceFilter === "all" ? "" : timelineSourceFilter,
            search: deferredTimelineSearch,
            rangeFilter: timelineRangeFilter,
          })
        : [],
    [
      isTimelineTabActive,
      deferredTimelineSearch,
      timeline,
      timelineCategoryFilter,
      timelineEntityFilter,
      timelineRangeFilter,
      timelineSourceFilter,
    ]
  );
  const groupedTimeline = useMemo(() => {
    const groups: Array<{
      key: string;
      label: string;
      items: PatientTimelineItem[];
    }> = [];
    let currentGroup:
      | {
          key: string;
          label: string;
          items: PatientTimelineItem[];
        }
      | null = null;

    if (!isTimelineTabActive) return groups;

    for (const item of filteredTimeline) {
      const key = timelineDateGroupKey(item.happened_at);
      const label = timelineDateGroupLabel(item.happened_at, lang);

      if (!currentGroup || currentGroup.key !== key) {
        currentGroup = { key, label, items: [item] };
        groups.push(currentGroup);
      } else {
        currentGroup.items.push(item);
      }
    }

    return groups;
  }, [filteredTimeline, isTimelineTabActive, lang]);

  const timelineSummary = useMemo(
    () => (isTimelineTabActive ? buildPatientTimelineSummary(timeline) : buildPatientTimelineSummary([])),
    [isTimelineTabActive, timeline]
  );
  const localizedTimelineRangeOptions = useMemo(
    () => (isTimelineTabActive ? timelineRangeOptions(lang) : []),
    [isTimelineTabActive, lang]
  );
  const timelineHasNextPage = isTimelineTabActive && timelineOffset + timeline.length < timelineTotal;
  const hasActiveOverlayLayer =
    profileEditorOpen ||
    relationEditorOpen ||
    documentUploadOpen ||
    contractCreateOpen ||
    Boolean(contractStatusId) ||
    Boolean(invoiceManageId);
  const workflowChecklistGroups = useMemo(() => {
    if (!isWorkflowTabActive) return [];
    const items = workflowChecklist?.items ?? [];
    const grouped = new Map<string, WorkflowChecklistItem[]>();
    for (const item of items) {
      const current = grouped.get(item.checklist_key) ?? [];
      current.push(item);
      grouped.set(item.checklist_key, current);
    }
    return Array.from(grouped.entries()).map(([key, groupItems]) => ({
      key,
      label: localizeWorkflowGroupLabel(key, workflowChecklistLabel(key), l),
      items: groupItems,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isWorkflowTabActive, workflowChecklist, lang]);
  const legalStatus = useMemo(
    () => normalizePatientLegalStatus(detail?.legal_status),
    [detail?.legal_status]
  );
  const legalStatusChecklist = useMemo(
    () => getPatientLegalStatusChecklist(legalStatus),
    [legalStatus]
  );
  const legalStatusCompletion = useMemo(
    () => getPatientLegalStatusCompletion(legalStatus),
    [legalStatus]
  );
  const documentStatusOptions = useMemo(
    () => {
      if (!isDocumentsTabActive) return [];
      return [...new Set(documents.map((item) => item.status ?? "").filter((value) => Boolean(value.trim())))]
        .toSorted((left, right) => left.localeCompare(right));
    },
    [documents, isDocumentsTabActive]
  );
  const documentCategoryOptions = useMemo(
    () => {
      if (!isDocumentsTabActive) return [];
      return [...new Set(documents.map((item) => item.category ?? "").filter((value) => Boolean(value.trim())))]
        .toSorted((left, right) => left.localeCompare(right));
    },
    [documents, isDocumentsTabActive]
  );
  const filteredDocuments = useMemo(
    () => {
      if (!isDocumentsTabActive) return [];
      return documents.filter((item) => {
        if (documentStatusFilter !== "all" && (item.status ?? "") !== documentStatusFilter) return false;
        if (documentCategoryFilter !== "all" && (item.category ?? "") !== documentCategoryFilter) return false;
        return true;
      });
    },
    [documentCategoryFilter, documentStatusFilter, documents, isDocumentsTabActive]
  );
  const hasDocumentFilters =
    isDocumentsTabActive &&
    (documentStatusFilter !== "all" || documentCategoryFilter !== "all");
  const requiredDocumentFulfilledCount =
    isDocumentsTabActive
      ? documentAlerts?.required_documents.filter((item) => item.fulfilled).length ?? 0
      : 0;
  const contractSignedCount = useMemo(
    () => (isContractsTabActive ? contracts.filter((item) => item.status === "signed" || item.status === "active").length : 0),
    [contracts, isContractsTabActive]
  );
  const contractPendingCount = useMemo(
    () => (isContractsTabActive ? contracts.filter((item) => item.status === "draft" || item.status === "sent").length : 0),
    [contracts, isContractsTabActive]
  );
  const contractExpiringSoonCount = useMemo(() => {
    if (!isContractsTabActive) return 0;
    const now = new Date();
    return contracts.filter((item) => isContractExpiringSoon(item, now)).length;
  }, [contracts, isContractsTabActive]);
  const invoiceOutstandingAmount = useMemo(
    () => (isInvoicesTabActive ? invoices.reduce((sum, item) => sum + moneyValueNumber(item.balance_due), 0) : 0),
    [invoices, isInvoicesTabActive]
  );
  const invoicePaidAmountTotal = useMemo(
    () => (isInvoicesTabActive ? invoices.reduce((sum, item) => sum + moneyValueNumber(item.paid_amount), 0) : 0),
    [invoices, isInvoicesTabActive]
  );
  const invoiceOpenCount = useMemo(
    () => (isInvoicesTabActive ? invoices.filter((item) => moneyValueNumber(item.balance_due) > 0).length : 0),
    [invoices, isInvoicesTabActive]
  );
  const invoiceOverdueCount = useMemo(() => {
    if (!isInvoicesTabActive) return 0;
    const now = new Date();
    return invoices.filter((item) => {
      if (item.status === "overdue") return true;
      if (moneyValueNumber(item.balance_due) <= 0 || !item.due_date) return false;
      const dueDate = new Date(item.due_date);
      return !Number.isNaN(dueDate.getTime()) && dueDate < now;
    }).length;
  }, [invoices, isInvoicesTabActive]);
  const hasTimelineFilters =
    isTimelineTabActive &&
    (timelineEntityFilter !== "all" ||
      timelineCategoryFilter !== "all" ||
      timelineSourceFilter !== "all" ||
      timelineRangeFilter !== "all" ||
      deferredTimelineSearch.trim().length > 0);

  const reload = useCallback(() => {
    setActionErrorState((current) =>
      current.patientId === (id ?? "") ? { patientId: id ?? "", message: "" } : current
    );
    setVersion((v) => v + 1);
    setTabVersion((v) => v + 1);
  }, [id]);
  const reloadTab = useCallback(() => setTabVersion((v) => v + 1), []);
  void reloadTab;
  void blankPatientCardEntryForm;
  void blankPatientMedicalOrderForm;
  void blankPatientRiskScoreForm;
  void blankPatientVitalForm;
  void parseOptionalIntegerInput;
  void computeVitalBmi;
  const handleTabChange = useCallback(
    (nextTab: string) => {
      setActiveTab(nextTab);
      const nextParams = new URLSearchParams(searchParams);
      if (nextTab === "profile") {
        nextParams.delete("tab");
      } else {
        nextParams.set("tab", nextTab);
      }
      setSearchParams(nextParams, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  useEffect(() => {
    if (!isTimelineTabActive) return;
    const nextEntityFilter = normalizeTimelineQueryValue(searchParams.get("entity_type"));
    const nextCategoryFilter = normalizeTimelineQueryValue(searchParams.get("category"));
    const nextSourceFilter = normalizeTimelineQueryValue(searchParams.get("source"));
    const nextRangeFilter = normalizeTimelineRangeFilterValue(searchParams.get("range"));
    const nextSearch = normalizeTimelineSearchValue(searchParams.get("search"));
    const nextOffset = normalizeTimelineOffsetValue(searchParams.get("offset"));

    if (timelineEntityFilter !== nextEntityFilter) setTimelineEntityFilter(nextEntityFilter);
    if (timelineCategoryFilter !== nextCategoryFilter) setTimelineCategoryFilter(nextCategoryFilter);
    if (timelineSourceFilter !== nextSourceFilter) setTimelineSourceFilter(nextSourceFilter);
    if (timelineRangeFilter !== nextRangeFilter) setTimelineRangeFilter(nextRangeFilter);
    if (timelineSearch !== nextSearch) setTimelineSearch(nextSearch);
    if (timelineOffset !== nextOffset) setTimelineOffset(nextOffset);
  }, [
    isTimelineTabActive,
    searchParams,
    timelineCategoryFilter,
    timelineEntityFilter,
    timelineOffset,
    timelineRangeFilter,
    timelineSearch,
    timelineSourceFilter,
  ]);

  useEffect(() => {
    if (!isTimelineTabActive) return;
    const nextParams = new URLSearchParams(searchParams);

    if (timelineEntityFilter === "all") nextParams.delete("entity_type");
    else nextParams.set("entity_type", timelineEntityFilter);

    if (timelineCategoryFilter === "all") nextParams.delete("category");
    else nextParams.set("category", timelineCategoryFilter);

    if (timelineSourceFilter === "all") nextParams.delete("source");
    else nextParams.set("source", timelineSourceFilter);

    if (timelineRangeFilter === "all") nextParams.delete("range");
    else nextParams.set("range", timelineRangeFilter);

    if (!timelineSearch.trim()) nextParams.delete("search");
    else nextParams.set("search", timelineSearch.trim());

    if (timelineOffset <= 0) nextParams.delete("offset");
    else nextParams.set("offset", String(timelineOffset));

    if (nextParams.toString() !== searchParams.toString()) {
      setSearchParams(nextParams, { replace: true });
    }
  }, [
    isTimelineTabActive,
    searchParams,
    setSearchParams,
    timelineCategoryFilter,
    timelineEntityFilter,
    timelineOffset,
    timelineRangeFilter,
    timelineSearch,
    timelineSourceFilter,
  ]);

  useEffect(() => {
    if (!isWorkflowTabActive) return;
    if (workflowForm.ownerUserId) return;
    const preferredAssignee =
      activeWorkflowAssignees.find((item) => item.user_id === user?.id)?.user_id ??
      activeWorkflowAssignees[0]?.user_id ??
      "";
    if (!preferredAssignee) return;
    setWorkflowForm((current) => ({
      ...current,
      ownerUserId: preferredAssignee,
    }));
  }, [activeWorkflowAssignees, isWorkflowTabActive, user?.id, workflowForm.ownerUserId]);

  useEffect(() => {
    const requestedTab = searchParams.get("tab");
    const normalizedTab = normalizePatientDetailTab(requestedTab, {
      canViewOperationalSurface,
      canViewDocuments,
      canViewContracts,
      canViewInvoices,
    });

    if (activeTab !== normalizedTab) {
      setActiveTab(normalizedTab);
    }

    if ((requestedTab ?? "profile") !== normalizedTab) {
      const nextParams = new URLSearchParams(searchParams);
      if (normalizedTab === "profile") {
        nextParams.delete("tab");
      } else {
        nextParams.set("tab", normalizedTab);
      }
      setSearchParams(nextParams, { replace: true });
    }
  }, [
    activeTab,
    canViewContracts,
    canViewDocuments,
    canViewInvoices,
    canViewOperationalSurface,
    searchParams,
    setSearchParams,
  ]);

  useEffect(() => {
    setTabActionError("");
  }, [activeTab]);

  const handleAssign = async () => {
    if (!id || !selectedAssignee) return;
    setAssignBusy(true);
    setActionErrorState({ patientId: id, message: "" });
    try {
      await assignPatient(id, selectedAssignee);
      setSelectedAssignee("");
      reload();
    } catch (error) {
      setActionErrorState({
        patientId: id,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally { setAssignBusy(false); }
  };

  async function handleAddWorkflowItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!id || !workflowForm.itemText.trim()) {
      setTabActionError(t.common_failed_create);
      return;
    }

    setWorkflowBusy(true);
    setTabActionError("");
    try {
      await createPatientWorkflowChecklistItem(id, {
        item_text: workflowForm.itemText.trim(),
        owner_user_id: toOptional(workflowForm.ownerUserId),
        priority: workflowForm.priority,
        due_date: workflowForm.dueDate
          ? new Date(workflowForm.dueDate).toISOString()
          : null,
      });
      toast.success(t.common_active);
      setWorkflowForm((current) => ({
        ...blankWorkflowChecklistForm(),
        ownerUserId: current.ownerUserId,
      }));
      reload();
    } catch (error) {
      setTabActionError(error instanceof Error ? error.message : t.common_failed_create);
    } finally {
      setWorkflowBusy(false);
    }
  }

  async function handleCompleteWorkflowItem(itemId: string) {
    if (!id) return;
    setWorkflowBusy(true);
    setTabActionError("");
    try {
      await completePatientWorkflowChecklistItem(id, itemId);
      toast.success(t.common_active);
      reload();
    } catch (error) {
      setTabActionError(error instanceof Error ? error.message : t.common_failed_update);
    } finally {
      setWorkflowBusy(false);
    }
  }

  const handleProfileEditorOpenChange = useCallback((open: boolean) => {
    if (open) preloadPatientDetailOverlayLayers();
    setProfileEditorOpen(open);
  }, []);

  const handleRelationEditorOpenChange = useCallback((open: boolean) => {
    if (open) preloadPatientDetailOverlayLayers();
    setRelationEditorOpen(open);
    if (!open) {
      setEditingRelation(null);
    }
  }, []);

  const handleDocumentUploadOpenChange = useCallback((open: boolean) => {
    if (open) preloadPatientDetailOverlayLayers();
    setDocumentUploadOpen(open);
  }, []);

  const openProfileEditor = useCallback(() => {
    if (!detail) return;
    preloadPatientDetailOverlayLayers();
    setProfileEditorOpen(true);
  }, [detail]);

  function openCreateRelation() {
    preloadPatientDetailOverlayLayers();
    setEditingRelation(null);
    setRelationEditorOpen(true);
  }

  function openEditRelation(relation: RelationItem) {
    preloadPatientDetailOverlayLayers();
    setEditingRelation(relation);
    setRelationEditorOpen(true);
  }

  async function handleDeleteRelation(relationId: string) {
    if (!id || !window.confirm(t.common_delete)) return;
    setTabActionError("");
    try {
      await deletePatientRelation(id, relationId);
      toast.success(t.common_active);
      reload();
    } catch (error) {
      setTabActionError(error instanceof Error ? error.message : t.common_failed_update);
    }
  }

  async function handleCreateContract(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!id) return;
    setContractBusy(true);
    setTabActionError("");
    try {
      await createFrameworkContract({
        patient_id: id,
        status: contractCreateForm.status,
        valid_from: toOptional(contractCreateForm.validFrom),
        valid_to: toOptional(contractCreateForm.validTo),
        signed_at: toOptional(contractCreateForm.signedAt)
          ? new Date(contractCreateForm.signedAt).toISOString()
          : null,
      });
      toast.success(t.common_active);
      setContractCreateOpen(false);
      setContractCreateForm(blankContractForm());
      reload();
    } catch (error) {
      setTabActionError(error instanceof Error ? error.message : t.common_failed_create);
    } finally {
      setContractBusy(false);
    }
  }

  function openContractStatusEditor(contract: ContractItem) {
    preloadPatientDetailOverlayLayers();
    setContractStatusId(contract.id);
    setContractStatusForm(contractToForm(contract));
  }

  function openCreateContract() {
    preloadPatientDetailOverlayLayers();
    setContractCreateOpen(true);
  }

  async function handleSaveContractStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!contractStatusId) return;
    setContractBusy(true);
    setTabActionError("");
    try {
      await updateFrameworkContractStatus(contractStatusId, {
        status: contractStatusForm.status,
        valid_from: toOptional(contractStatusForm.validFrom),
        valid_to: toOptional(contractStatusForm.validTo),
        signed_at: toOptional(contractStatusForm.signedAt)
          ? new Date(contractStatusForm.signedAt).toISOString()
          : null,
      });
      toast.success(t.common_active);
      setContractStatusId("");
      setContractStatusForm(blankContractForm());
      reload();
    } catch (error) {
      setTabActionError(error instanceof Error ? error.message : t.common_failed_update);
    } finally {
      setContractBusy(false);
    }
  }

  function openInvoiceManager(invoice: InvoiceItem) {
    preloadPatientDetailOverlayLayers();
    setInvoiceManageId(invoice.id);
    setInvoiceStatusForm(invoiceToStatusForm(invoice));
    setDunningNote("");
  }

  function openDocumentUpload() {
    preloadPatientDetailOverlayLayers();
    setDocumentUploadOpen(true);
  }

  function openCaseWorkspace(caseId: string) {
    staffGo(`/cases/${caseId}?patient=${id}`);
  }

  async function handleSaveInvoiceStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!invoiceManageId) return;
    setInvoiceBusy(true);
    setTabActionError("");
    try {
      await updateInvoiceStatus(invoiceManageId, {
        status: invoiceStatusForm.status,
        due_date: toOptional(invoiceStatusForm.dueDate),
        paid_amount: toOptional(invoiceStatusForm.paidAmount)
          ? Number(invoiceStatusForm.paidAmount)
          : null,
        notes: toOptional(invoiceStatusForm.notes),
      });
      toast.success(t.common_active);
      reload();
    } catch (error) {
      setTabActionError(error instanceof Error ? error.message : t.common_failed_update);
    } finally {
      setInvoiceBusy(false);
    }
  }

  async function handleCreateDunning() {
    const nextLevel = nextDunningLevel(dunningEvents);
    if (!invoiceManageId || !nextLevel) return;
    setDunningBusy(true);
    setTabActionError("");
    try {
      const created = await createInvoiceDunningEvent<DunningEvent>(invoiceManageId, {
        level: nextLevel,
        note: toOptional(dunningNote),
      });
      appendDunningEvent(created);
      setDunningNote("");
      toast.success(t.common_active);
      reload();
    } catch (error) {
      setTabActionError(error instanceof Error ? error.message : t.common_failed_create);
    } finally {
      setDunningBusy(false);
    }
  }

  async function handleExportPatientCompliance() {
    if (!id) return;
    setComplianceExportBusy(true);
    setTabActionError("");

    try {
      await exportPatientComplianceArchive(
        id,
        `${detail?.patient_id ?? "patient"}-dsgvo-export.zip`,
      );
      toast.success(l("DSGVO-Export geladen.", "Экспорт DSGVO загружен.", "DSGVO export downloaded."));
    } catch (error) {
      setTabActionError(
        error instanceof Error ? error.message : t.common_failed_create
      );
    } finally {
      setComplianceExportBusy(false);
    }
  }

  async function handlePrintPatientLabel(format?: PatientLabelFormatId) {
    if (!id) return;
    const chosenFormat = format ?? patientLabelFormat;

    const printWindow = window.open("", "_blank", "noopener,noreferrer");
    if (!printWindow) {
      setTabActionError("Allow pop-ups to print the patient label.");
      return;
    }

    setPatientLabelBusy(true);
    setTabActionError("");

    try {
      const payload = await fetchPatientLabelPayload<PatientLabelPayload>(id, chosenFormat);
      printWindow.document.open();
      printWindow.document.write(buildPatientLabelPrintHtml(payload));
      printWindow.document.close();
      toast.info(l("Etikett geöffnet.", "Наклейка открыта.", "Label opened."));
    } catch (error) {
      printWindow.close();
      setTabActionError(
        error instanceof Error ? error.message : t.common_failed_create
      );
    } finally {
      setPatientLabelBusy(false);
    }
  }

  async function handleUpdatePatientMedicalOrderStatus(
    medicalOrderId: string,
    status: "completed" | "cancelled"
  ) {
    if (!id) return;

    setMedicalOrderActionId(medicalOrderId);
    setTabActionError("");
    try {
      await updatePatientMedicalOrderLifecycle(id, medicalOrderId, status);
      toast.success(status === "completed"
        ? l("Anordnung abgeschlossen.", "Назначение завершено.", "Order completed.")
        : l("Anordnung storniert.", "Назначение отменено.", "Order cancelled."));
      reload();
    } catch (error) {
      setTabActionError(error instanceof Error ? error.message : t.common_failed_update);
    } finally {
      setMedicalOrderActionId("");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <LoaderCircle className="size-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="space-y-3">
        <Button variant="ghost" size="sm" className="gap-1.5 h-9 rounded-lg" onClick={() => staffGo("/patients")}>
          <ArrowLeft className="size-4" /> {t.patients_title}
        </Button>
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error || t.common_failed_load}
        </div>
      </div>
    );
  }

  const initials = patientName(detail).split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
  const hasClinicalSurface =
    canManagePatientVitals ||
    Boolean(detail.clinical_warnings) ||
    vitalsHistory.length > 0 ||
    cardEntries.length > 0 ||
    medicalOrders.length > 0 ||
    riskScores.length > 0;
  const clinicalSurfaceItemCount =
    vitalsHistory.length +
    cardEntries.length +
    medicalOrders.length +
    riskScores.length +
    (detail.clinical_warnings ? 1 : 0);
  const workflowItemCount = workflowChecklist?.items.length ?? 0;
  const handleTogglePatientActivation = async () => {
    try {
      await togglePatientActivation(id ?? "", detail.is_active);
    } catch (error) {
      setActionErrorState({
        patientId: id ?? "",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    reload();
  };
  const handleRevokeAssignment = (item: PatientAssignment) => {
    const confirmed = window.confirm(
      l(
        `Zuordnung für ${item.user_name} widerrufen?`,
        `Отозвать назначение для ${item.user_name}?`,
        `Revoke assignment for ${item.user_name}?`,
      ),
    );
    if (!confirmed) return;
    void revokePatientAssignment(id ?? "", item.user_id)
      .catch(() => {})
      .finally(() => {
        reload();
      });
  };
  const handlePatientLabelSelect = (format: PatientLabelFormatId) => {
    setPatientLabelFormat(format);
    void handlePrintPatientLabel(format);
  };

  return (
    <>
      <PatientDetailWorkspaceContent
        activeTab={activeTab}
        activeWorkflowAssignees={activeWorkflowAssignees}
        appointmentCarePathKindLabel={appointmentCarePathKindLabel}
        appointmentSheetOpen={appointmentSheetOpen}
        appointmentTypeLabel={appointmentTypeLabel}
        appointments={appointments}
        assignBusy={assignBusy}
        assignments={assignments}
        assignableStaff={assignableStaff}
        canEditPatientProfile={canEditPatientProfile}
        canExportPatientCompliance={canExportPatientCompliance}
        canManage={canManage}
        canManageContracts={canManageContracts}
        canManageDocuments={canManageDocuments}
        canManageInvoices={canManageInvoices}
        canManagePatientCardEntries={canManagePatientCardEntries}
        canManagePatientMedicalOrders={canManagePatientMedicalOrders}
        canManagePatientRiskScores={canManagePatientRiskScores}
        canManagePatientVitals={canManagePatientVitals}
        canManageRelations={canManageRelations}
        canManageWorkflowChecklist={canManageWorkflowChecklist}
        canOpenComplianceWorkspace={canOpenComplianceWorkspace}
        canOpenDocumentsWorkspace={canOpenDocumentsWorkspace}
        canPrintPatientLabel={canPrintPatientLabel}
        canViewContracts={canViewContracts}
        canViewDocuments={canViewDocuments}
        canViewInvoices={canViewInvoices}
        cardEntries={cardEntries}
        cardEntrySheetOpen={cardEntrySheetOpen}
        cases={cases}
        caveSheetOpen={caveSheetOpen}
        clinicalSurfaceItemCount={clinicalSurfaceItemCount}
        complianceExportBusy={complianceExportBusy}
        contractExpiringSoonCount={contractExpiringSoonCount}
        contractPendingCount={contractPendingCount}
        contractSignedCount={contractSignedCount}
        contracts={contracts}
        contractsPreviewOpen={contractsPreviewOpen}
        detail={detail}
        docsPreviewOpen={docsPreviewOpen}
        documentAlerts={documentAlerts}
        documentCategoryFilter={documentCategoryFilter}
        documentCategoryOptions={documentCategoryOptions}
        documentStatusFilter={documentStatusFilter}
        documentStatusOptions={documentStatusOptions}
        documents={documents}
        documentsFilenameLabel={t.documents_filename}
        appointmentsTypeLabel={t.appointments_type}
        usersStatusLabel={t.users_status}
        patientsAssignedByLabel={t.patients_assigned_by}
        usersCreatedLabel={t.users_created}
        emptyCasesLabel={t.cases_no_match}
        emptyOrdersLabel={l(
          "Für diesen Patienten gibt es noch keine Aufträge.",
          "Для этого пациента пока нет заказов.",
          "No orders have been recorded for this patient yet.",
        )}
        emptyAppointmentsLabel={l(
          "Für diesen Patienten sind noch keine Termine geplant.",
          "Для этого пациента пока нет приёмов.",
          "No appointments are scheduled for this patient yet.",
        )}
        fieldValue={fieldVal}
        filteredDocuments={filteredDocuments}
        filteredTimeline={filteredTimeline}
        formatDate={fmtDate}
        formatDateTime={fmtDateTime}
        formatMoney={fmtMoney}
        formatVitalNumber={formatVitalNumber}
        formInputClassName={formInputClassName}
        genderLabel={genderLbl}
        groupedTimeline={groupedTimeline}
        handleExportPatientCompliance={handleExportPatientCompliance}
        handleTabChange={handleTabChange}
        handleUpdatePatientMedicalOrderStatus={handleUpdatePatientMedicalOrderStatus}
        hasClinicalSurface={hasClinicalSurface}
        hasDocumentFilters={hasDocumentFilters}
        hasTimelineFilters={hasTimelineFilters}
        id={id}
        initials={initials}
        insuranceLabel={insuranceLbl}
        invoiceOpenCount={invoiceOpenCount}
        invoiceOutstandingAmount={invoiceOutstandingAmount}
        invoiceOverdueCount={invoiceOverdueCount}
        invoicePaidAmountTotal={invoicePaidAmountTotal}
        invoiceTypeLabel={invoiceTypeLabel}
        invoices={invoices}
        invoicesPreviewOpen={invoicesPreviewOpen}
        isContractExpiringSoon={isContractExpiringSoon}
        l={l}
        legalStatus={legalStatus}
        legalStatusChecklist={legalStatusChecklist}
        legalStatusCompletion={legalStatusCompletion}
        legalStatusSheetOpen={legalStatusSheetOpen}
        localizedTimelineRangeOptions={localizedTimelineRangeOptions}
        medicalOrderActionId={medicalOrderActionId}
        medicalOrderSheetOpen={medicalOrderSheetOpen}
        medicalOrders={medicalOrders}
        moneyValueNumber={moneyValueNumber}
        notesSheetOpen={notesSheetOpen}
        onAppointmentSheetOpenChange={setAppointmentSheetOpen}
        onAssign={handleAssign}
        onCardEntrySheetOpenChange={setCardEntrySheetOpen}
        onCaveSheetOpenChange={setCaveSheetOpen}
        onContractsPreviewOpenChange={setContractsPreviewOpen}
        onCreateContract={openCreateContract}
        onCreateRelation={openCreateRelation}
        onDeleteRelation={(relationId) => { void handleDeleteRelation(relationId); }}
        onDocsPreviewOpenChange={setDocsPreviewOpen}
        onEditContractStatus={openContractStatusEditor}
        onEditRelation={openEditRelation}
        onInvoicesPreviewOpenChange={setInvoicesPreviewOpen}
        onLegalStatusSheetOpenChange={setLegalStatusSheetOpen}
        onManageInvoice={openInvoiceManager}
        onMedicalOrderSheetOpenChange={setMedicalOrderSheetOpen}
        onNotesSheetOpenChange={setNotesSheetOpen}
        onOpenAppointment={(appointmentId) => { staffGo(`/appointments?appointment=${appointmentId}`); }}
        onOpenCase={openCaseWorkspace}
        onOpenContract={(contractId) => { staffGo(`/contracts?contract=${contractId}`); }}
        onOpenInvoice={(invoiceId) => { staffGo(`/invoices?invoice=${invoiceId}`); }}
        onOpenOrder={(orderId) => { staffGo(`/orders?order=${orderId}`); }}
        onOpenPatient={(patientId) => { staffGo(`/patients/${patientId}`); }}
        onOpenProfileEditor={openProfileEditor}
        onOpenUpload={openDocumentUpload}
        onPrintPatientLabel={handlePatientLabelSelect}
        onResetDocumentFilters={() => {
          setDocumentStatusFilter("all");
          setDocumentCategoryFilter("all");
        }}
        onResetTimelineFilters={() => {
          setTimelineEntityFilter("all");
          setTimelineCategoryFilter("all");
          setTimelineSourceFilter("all");
          setTimelineRangeFilter("all");
          setTimelineSearch("");
          setTimelineOffset(0);
        }}
        onRevokeAssignment={handleRevokeAssignment}
        onRiskScoreSheetOpenChange={setRiskScoreSheetOpen}
        onSelectedAssigneeChange={setSelectedAssignee}
        onTimelineCategoryFilterChange={(value) => {
          setTimelineCategoryFilter(value);
          setTimelineOffset(0);
        }}
        onTimelineEntityFilterChange={(value) => {
          setTimelineEntityFilter(value);
          setTimelineOffset(0);
        }}
        onTimelineOffsetChange={setTimelineOffset}
        onTimelineRangeFilterChange={(value) => {
          setTimelineRangeFilter(value);
          setTimelineOffset(0);
        }}
        onTimelineSearchChange={(value) => {
          setTimelineSearch(value);
          setTimelineOffset(0);
        }}
        onTimelineSourceFilterChange={(value) => {
          setTimelineSourceFilter(value);
          setTimelineOffset(0);
        }}
        onTogglePatientActivation={handleTogglePatientActivation}
        onVitalsSheetOpenChange={setVitalsSheetOpen}
        onWorkflowCompleteItem={handleCompleteWorkflowItem}
        onWorkflowDueDateChange={(value) => {
          setWorkflowForm((current) => ({ ...current, dueDate: value }));
        }}
        onWorkflowItemTextChange={(value) => {
          setWorkflowForm((current) => ({ ...current, itemText: value }));
        }}
        onWorkflowOwnerChange={(value) => {
          setWorkflowForm((current) => ({ ...current, ownerUserId: value }));
        }}
        onWorkflowPriorityChange={(value) => {
          setWorkflowForm((current) => ({ ...current, priority: value }));
        }}
        onWorkflowSubmit={handleAddWorkflowItem}
        orderPhaseLabel={orderPhaseLabel}
        orders={orders}
        patientCardEntryCategoryBadgeClass={patientCardEntryCategoryBadgeClass}
        patientCardEntryCategoryLabel={patientCardEntryCategoryLabel}
        patientDetailStatusLabel={patientDetailStatusLabel}
        patientLabelBusy={patientLabelBusy}
        patientMedicalOrderTypeLabel={patientMedicalOrderTypeLabel}
        patientName={patientName}
        patientRiskScoreTypeLabel={patientRiskScoreTypeLabel}
        priorityBadgeClass={priorityBadgeClass}
        priorityLabel={priorityLabel}
        relationTypeLabel={relationTypeLabel}
        relations={relations}
        reload={reload}
        requiredDocumentFulfilledCount={requiredDocumentFulfilledCount}
        riskScoreSheetOpen={riskScoreSheetOpen}
        riskScores={riskScores}
        roleColors={ROLE_COLORS}
        roleLabel={roleLbl}
        selectedAssignee={selectedAssignee}
        staffGo={staffGo}
        statusColors={STATUS_COLORS}
        statusBadgeClasses={STATUS_BADGE_CLASSES}
        t={t}
        tabActionError={tabActionError}
        tabLoading={tabLoading}
        timeline={timeline}
        timelineCategoryFilter={timelineCategoryFilter}
        timelineCategoryOptions={timelineCategoryOptions}
        timelineEntityDotClass={timelineEntityDotClass}
        timelineEntityFilter={timelineEntityFilter}
        timelineHasNextPage={timelineHasNextPage}
        timelineItemSurfaceClass={timelineItemSurfaceClass}
        timelineLimit={timelineLimit}
        timelineOffset={timelineOffset}
        timelineRangeFilter={timelineRangeFilter}
        timelineSearch={timelineSearch}
        timelineSourceFilter={timelineSourceFilter}
        timelineSourceOptions={timelineSourceOptions}
        timelineSummary={timelineSummary}
        timelineTotal={timelineTotal}
        tr={tr}
        vitalsHistory={vitalsHistory}
        vitalsSheetOpen={vitalsSheetOpen}
        workflowBusy={workflowBusy}
        workflowChecklist={workflowChecklist}
        workflowChecklistGroups={workflowChecklistGroups}
        workflowForm={workflowForm}
        workflowItemCount={workflowItemCount}
        workspaceTabs={workspaceTabs}
      />

      {hasActiveOverlayLayer ? (
        <Suspense fallback={null}>
          <LazyPatientDetailOverlayLayers
            appointments={appointments}
            canManageInvoices={canManageInvoices}
            canManageRelations={canManageRelations}
            contractBusy={contractBusy}
            contractCreateForm={contractCreateForm}
            contractCreateOpen={contractCreateOpen}
            contractStatusForm={contractStatusForm}
            contractStatusId={contractStatusId}
            contractStatusOptions={CONTRACT_STATUS_OPTIONS}
            detail={detail}
            dictionary={tr}
            documentUploadOpen={documentUploadOpen}
            dunningBusy={dunningBusy}
            dunningEvents={dunningEvents}
            dunningNote={dunningNote}
            editingRelation={editingRelation}
            formatDate={fmtDate}
            formatDateTime={fmtDateTime}
            formatMoney={fmtMoney}
            invoiceBusy={invoiceBusy}
            invoiceManageId={invoiceManageId}
            invoiceStatusForm={invoiceStatusForm}
            invoiceStatusOptions={INVOICE_STATUS_OPTIONS}
            lang={lang}
            l={l}
            nextDunningLevel={nextDunningLevel}
            onCloseContractStatus={() => setContractStatusId("")}
            onCloseInvoiceManager={() => setInvoiceManageId("")}
            onContractCreateOpenChange={setContractCreateOpen}
            onContractCreateSignedAtChange={(value) => setContractCreateForm((current) => ({ ...current, signedAt: value }))}
            onContractCreateStatusChange={(value) => setContractCreateForm((current) => ({ ...current, status: value as ContractStatus }))}
            onContractCreateSubmit={handleCreateContract}
            onContractCreateValidFromChange={(value) => setContractCreateForm((current) => ({ ...current, validFrom: value }))}
            onContractCreateValidToChange={(value) => setContractCreateForm((current) => ({ ...current, validTo: value }))}
            onContractStatusSignedAtChange={(value) => setContractStatusForm((current) => ({ ...current, signedAt: value }))}
            onContractStatusSubmit={handleSaveContractStatus}
            onContractStatusValueChange={(value) => setContractStatusForm((current) => ({ ...current, status: value as ContractStatus }))}
            onContractStatusValidFromChange={(value) => setContractStatusForm((current) => ({ ...current, validFrom: value }))}
            onContractStatusValidToChange={(value) => setContractStatusForm((current) => ({ ...current, validTo: value }))}
            onCreateDunning={handleCreateDunning}
            onDocumentUploadOpenChange={handleDocumentUploadOpenChange}
            onDunningNoteChange={setDunningNote}
            onError={setTabActionError}
            onInvoiceDueDateChange={(value) => setInvoiceStatusForm((current) => ({ ...current, dueDate: value }))}
            onInvoiceManageOpenChange={(open) => { if (!open) setInvoiceManageId(""); }}
            onInvoiceNotesChange={(value) => setInvoiceStatusForm((current) => ({ ...current, notes: value }))}
            onInvoicePaidAmountChange={(value) => setInvoiceStatusForm((current) => ({ ...current, paidAmount: value }))}
            onInvoiceStatusSubmit={handleSaveInvoiceStatus}
            onInvoiceStatusValueChange={(value) => setInvoiceStatusForm((current) => ({ ...current, status: value as InvoiceStatus }))}
            onProfileEditorOpenChange={handleProfileEditorOpenChange}
            onRelationEditorOpenChange={handleRelationEditorOpenChange}
            onSaved={reload}
            orders={orders}
            patientId={id}
            patientDetailStatusLabel={patientDetailStatusLabel}
            profileEditorOpen={profileEditorOpen}
            relationEditorOpen={relationEditorOpen}
            textareaClassName={spaciousTextareaClassName}
          />
        </Suspense>
      ) : null}

    </>
  );
}
