import {
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
  Pencil,
  Plus,
  Printer,
  SquarePen,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  humanizeFunctionalLabel,
} from "./ui/shared/patient-form-primitives";
import {
  CountBadge,
  EmptyCell,
  InfoRow,
  Section as FormSection,
  TabLoader,
  inputClass as formInputClassName,
  textareaClass as formTextareaClassName,
} from "@/components/ui-shell";
import { StatusActionPill } from "@/components/status-action-pill";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { PatientCardEntrySheet } from "./ui/sheets/patient-card-entry-sheet";
import { PatientMedicalOrderSheet } from "./ui/sheets/patient-medical-order-sheet";
import { PatientRiskScoreSheet } from "./ui/sheets/patient-risk-score-sheet";
import {
  PatientDocumentsPreviewSheet,
  PatientContractsPreviewSheet,
  PatientInvoicesPreviewSheet,
} from "./ui/sheets/patient-legal-preview-sheets";
import { PatientLegalStatusSheet } from "./ui/sheets/patient-legal-status-sheet";
import { PatientVitalsSheet } from "./ui/sheets/patient-vitals-sheet";
import { PatientCaveNotesSheet } from "./ui/sheets/patient-cave-notes-sheet";
import { PatientNotesSheet } from "./ui/sheets/patient-notes-sheet";
import {
  localizeWorkflowGroupLabel,
} from "@/lib/workflow-labels";
import { Label } from "@/components/ui/label";
import {
  Select as ShadSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
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
  PATIENT_LABEL_FORMAT_OPTIONS,
  type PatientLabelFormatId,
  type PatientLabelPayload,
  type PatientTimelineItem,
  type PatientTimelineRangeFilter,
} from "./model/detail-model";
import type {
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
import { MemoizedPatientProfileEditorSheet } from "./ui/sheets/patient-profile-editor-sheet";
import { MemoizedPatientRelationEditorSheet } from "./ui/sheets/patient-relation-editor-sheet";
import { MemoizedPatientDocumentUploadDialog } from "./ui/sheets/patient-document-upload-dialog";
import { LegalStatusPill } from "./ui/shared/legal-status-pill";
import {
  PatientAppointmentsTab,
  PatientCasesTab,
  PatientCuratorsTab,
  PatientOrdersTab,
  PatientRelationsTab,
} from "./ui/sections/patient-operations-sections";
import {
  PatientContractsTab,
  PatientDocumentsTab,
  PatientInvoicesTab,
} from "./ui/sections/patient-legal-sections";
import { PatientTimelineTab } from "./ui/sections/patient-timeline-section";
import { PatientWorkflowTab } from "./ui/sections/patient-workflow-section";
import {
  getPatientLegalStatusChecklist,
  getPatientLegalStatusCompletion,
  normalizePatientLegalStatus,
} from "./model/legal-status";
import { WorkspaceSectionIntro } from "./ui/shared/workspace-primitives";

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
  const editPatientFieldLabel = (label: string) =>
    `${l("Bearbeiten", "Редактировать", "Edit")} ${label}`;
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
  const timelineCategoryOptions = useMemo(
    () =>
      [...new Set(timeline.map((item) => item.category).filter((value) => Boolean(value?.trim())))]
        .toSorted((left, right) => left.localeCompare(right)),
    [timeline]
  );
  const timelineSourceOptions = useMemo(
    () =>
      [...new Set(timeline.map((item) => item.source_label ?? "").filter((value) => Boolean(value.trim())))]
        .toSorted((left, right) => left.localeCompare(right)),
    [timeline]
  );

  const filteredTimeline = useMemo(
    () =>
      filterPatientTimelineItems(timeline, {
        entityFilter: timelineEntityFilter,
        categoryFilter: timelineCategoryFilter,
        sourceFilter: timelineSourceFilter === "all" ? "" : timelineSourceFilter,
        search: deferredTimelineSearch,
        rangeFilter: timelineRangeFilter,
      }),
    [
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
  }, [filteredTimeline, lang]);

  const timelineSummary = useMemo(() => buildPatientTimelineSummary(timeline), [timeline]);
  const localizedTimelineRangeOptions = useMemo(() => timelineRangeOptions(lang), [lang]);
  const timelineHasNextPage = timelineOffset + timeline.length < timelineTotal;
  const workflowChecklistGroups = useMemo(() => {
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
  }, [workflowChecklist, lang]);
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
    () =>
      [...new Set(documents.map((item) => item.status ?? "").filter((value) => Boolean(value.trim())))]
        .toSorted((left, right) => left.localeCompare(right)),
    [documents]
  );
  const documentCategoryOptions = useMemo(
    () =>
      [...new Set(documents.map((item) => item.category ?? "").filter((value) => Boolean(value.trim())))]
        .toSorted((left, right) => left.localeCompare(right)),
    [documents]
  );
  const filteredDocuments = useMemo(
    () =>
      documents.filter((item) => {
        if (documentStatusFilter !== "all" && (item.status ?? "") !== documentStatusFilter) return false;
        if (documentCategoryFilter !== "all" && (item.category ?? "") !== documentCategoryFilter) return false;
        return true;
      }),
    [documentCategoryFilter, documentStatusFilter, documents]
  );
  const hasDocumentFilters =
    documentStatusFilter !== "all" || documentCategoryFilter !== "all";
  const requiredDocumentFulfilledCount =
    documentAlerts?.required_documents.filter((item) => item.fulfilled).length ?? 0;
  const contractSignedCount = useMemo(
    () => contracts.filter((item) => item.status === "signed" || item.status === "active").length,
    [contracts]
  );
  const contractPendingCount = useMemo(
    () => contracts.filter((item) => item.status === "draft" || item.status === "sent").length,
    [contracts]
  );
  const contractExpiringSoonCount = useMemo(() => {
    const now = new Date();
    return contracts.filter((item) => isContractExpiringSoon(item, now)).length;
  }, [contracts]);
  const invoiceOutstandingAmount = useMemo(
    () => invoices.reduce((sum, item) => sum + moneyValueNumber(item.balance_due), 0),
    [invoices]
  );
  const invoicePaidAmountTotal = useMemo(
    () => invoices.reduce((sum, item) => sum + moneyValueNumber(item.paid_amount), 0),
    [invoices]
  );
  const invoiceOpenCount = useMemo(
    () => invoices.filter((item) => moneyValueNumber(item.balance_due) > 0).length,
    [invoices]
  );
  const invoiceOverdueCount = useMemo(() => {
    const now = new Date();
    return invoices.filter((item) => {
      if (item.status === "overdue") return true;
      if (moneyValueNumber(item.balance_due) <= 0 || !item.due_date) return false;
      const dueDate = new Date(item.due_date);
      return !Number.isNaN(dueDate.getTime()) && dueDate < now;
    }).length;
  }, [invoices]);
  const hasTimelineFilters =
    timelineEntityFilter !== "all" ||
    timelineCategoryFilter !== "all" ||
    timelineSourceFilter !== "all" ||
    timelineRangeFilter !== "all" ||
    deferredTimelineSearch.trim().length > 0;

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
  void CountBadge;
  void EmptyCell;
  void TabLoader;

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
    searchParams,
    timelineCategoryFilter,
    timelineEntityFilter,
    timelineOffset,
    timelineRangeFilter,
    timelineSearch,
    timelineSourceFilter,
  ]);

  useEffect(() => {
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
  }, [activeWorkflowAssignees, user?.id, workflowForm.ownerUserId]);

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
    setProfileEditorOpen(open);
  }, []);

  const handleRelationEditorOpenChange = useCallback((open: boolean) => {
    setRelationEditorOpen(open);
    if (!open) {
      setEditingRelation(null);
    }
  }, []);

  const handleDocumentUploadOpenChange = useCallback((open: boolean) => {
    setDocumentUploadOpen(open);
  }, []);

  const openProfileEditor = useCallback(() => {
    if (!detail) return;
    setProfileEditorOpen(true);
  }, [detail]);

  function openCreateRelation() {
    setEditingRelation(null);
    setRelationEditorOpen(true);
  }

  function openEditRelation(relation: RelationItem) {
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
    setContractStatusId(contract.id);
    setContractStatusForm(contractToForm(contract));
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
    setInvoiceManageId(invoice.id);
    setInvoiceStatusForm(invoiceToStatusForm(invoice));
    setDunningNote("");
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

  return (
    <div className="space-y-4">
      {/* Top row: identity + actions */}
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center size-10 shrink-0 rounded-full bg-[var(--brand)] text-[12px] font-semibold text-white">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-semibold tracking-tight text-foreground truncate">{patientName(detail)}</h1>
            <StatusActionPill
              isActive={detail.is_active}
              activeLabel={t.common_active}
              inactiveLabel={t.common_inactive}
              toggleActiveLabel={l("Patient deaktivieren", "Деактивировать пациента", "Deactivate patient")}
              toggleInactiveLabel={l("Patient aktivieren", "Активировать пациента", "Activate patient")}
              onToggle={async () => {
                try {
                  await togglePatientActivation(id ?? "", detail.is_active);
                } catch (error) {
                  setActionErrorState({
                    patientId: id ?? "",
                    message: error instanceof Error ? error.message : String(error),
                  });
                }
                reload();
              }}
            />
            {detail.functional_labels?.map((label) => (
              <Badge
                key={`${detail.id}-${label}`}
                variant="outline"
                className="rounded-full border-amber-200 bg-amber-50 text-amber-700 text-[10.5px]"
              >
                {humanizeFunctionalLabel(label)}
              </Badge>
            ))}
          </div>
          <p className="mt-0.5 text-[12px] font-mono text-muted-foreground">{detail.patient_id}</p>
        </div>
        {canPrintPatientLabel ? (
          <ShadSelect
            value=""
            onValueChange={(value) => {
              if (!value) return;
              const nextFormat = value as PatientLabelFormatId;
              setPatientLabelFormat(nextFormat);
              void handlePrintPatientLabel(nextFormat);
            }}
            disabled={patientLabelBusy}
          >
            <SelectTrigger className="h-9 rounded-lg bg-card text-[13px] gap-1.5 w-auto">
              {patientLabelBusy ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <Printer className="size-3.5" />
              )}
              <span>{l("Etikett drucken", "Печать наклейки", "Print sticker")}</span>
            </SelectTrigger>
            <SelectContent align="end">
              {PATIENT_LABEL_FORMAT_OPTIONS.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </ShadSelect>
        ) : null}
        {canEditPatientProfile ? (
          <Button
            size="sm"
            className="h-9 rounded-lg gap-1.5 px-3.5"
            onClick={openProfileEditor}
          >
            <SquarePen className="size-3.5" />
            {l("Profil bearbeiten", "Редактировать профиль", "Edit profile")}
          </Button>
        ) : null}
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <div className="border-b border-slate-200 lg:hidden overflow-x-auto">
          <TabsList variant="line" className="min-w-max">
            {workspaceTabs.map((tab) => (
              <TabsTrigger key={tab.key} value={tab.key} className="px-4 py-2">
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {tabActionError ? (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {tabActionError}
          </div>
        ) : null}

        {/* Profile tab */}
        <TabsContent value="profile" className="space-y-6 mt-4 min-h-[400px]">
          <WorkspaceSectionIntro
            title={l("Identität und Kommunikation", "Идентификация и коммуникация", "Identity and communication")}
            description={l(
              "Stammdaten, Kontaktkanäle, Adresse, Versicherung und Notfallkontakt sind hier als klarer Intake-Bereich gebündelt.",
              "Базовые данные, каналы связи, адрес, страхование и экстренный контакт собраны здесь в понятный intake-блок.",
              "Core identity, contact channels, address, insurance and emergency contact are grouped here as one clear intake block.",
            )}
          />
          <div className="grid gap-4 xl:grid-cols-2">
            <FormSection title={l("Persönliche Daten", "Личные данные", "Personal data")}>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <InfoRow label={t.patients_birth_date} value={fmtDate(detail.birth_date, t.common_not_set)} />
                <InfoRow label={t.patients_gender} value={genderLbl(detail.gender, tr)} />
                <InfoRow label={t.patients_nationality} value={fieldVal(detail.nationality, t.common_not_set)} onEdit={canEditPatientProfile ? openProfileEditor : undefined} editLabel={editPatientFieldLabel(t.patients_nationality)} />
                <InfoRow label={t.patients_residence_country} value={fieldVal(detail.residence_country, t.common_not_set)} onEdit={canEditPatientProfile ? openProfileEditor : undefined} editLabel={editPatientFieldLabel(t.patients_residence_country)} />
                <InfoRow label={t.patients_languages} value={fieldVal(detail.languages, t.common_not_set)} onEdit={canEditPatientProfile ? openProfileEditor : undefined} editLabel={editPatientFieldLabel(t.patients_languages)} />
                <InfoRow label={l("Funktionale Labels", "Функциональные метки", "Functional labels")} value={fieldVal(detail.functional_labels, t.common_not_set)} onEdit={canEditPatientProfile ? openProfileEditor : undefined} editLabel={editPatientFieldLabel(l("Funktionale Labels", "Функциональные метки", "Functional labels"))} />
              </div>
            </FormSection>

            <FormSection title={l("Kontakt", "Контакты", "Contact")}>
              <div className="grid gap-4 md:grid-cols-2">
                <InfoRow label={t.patients_phone_primary} value={fieldVal(detail.phone_primary, t.common_not_set)} onEdit={canEditPatientProfile ? openProfileEditor : undefined} editLabel={editPatientFieldLabel(t.patients_phone_primary)} />
                <InfoRow label={t.patients_phone_secondary} value={fieldVal(detail.phone_secondary, t.common_not_set)} onEdit={canEditPatientProfile ? openProfileEditor : undefined} editLabel={editPatientFieldLabel(t.patients_phone_secondary)} />
                <InfoRow label={t.patients_email} value={fieldVal(detail.email, t.common_not_set)} onEdit={canEditPatientProfile ? openProfileEditor : undefined} editLabel={editPatientFieldLabel(t.patients_email)} />
              </div>
            </FormSection>

            <FormSection title={l("Versicherung und Kostenträger", "Страхование и плательщик", "Insurance and payer")}>
              <div className="grid gap-4 md:grid-cols-2">
                <InfoRow label={t.patients_insurance_type} value={insuranceLbl(detail.insurance_type, tr)} onEdit={canEditPatientProfile ? openProfileEditor : undefined} editLabel={editPatientFieldLabel(t.patients_insurance_type)} />
                <InfoRow label={t.patients_insurance_provider} value={fieldVal(detail.insurance_provider, t.common_not_set)} onEdit={canEditPatientProfile ? openProfileEditor : undefined} editLabel={editPatientFieldLabel(t.patients_insurance_provider)} />
                <InfoRow label={t.patients_insurance_number} value={fieldVal(detail.insurance_number, t.common_not_set)} onEdit={canEditPatientProfile ? openProfileEditor : undefined} editLabel={editPatientFieldLabel(t.patients_insurance_number)} />
              </div>
            </FormSection>

          {/* Address */}
          <FormSection title={l("Adresse", "Адрес", "Address")}>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <InfoRow label={t.patients_address_street} value={fieldVal(detail.address_street, t.common_not_set)} onEdit={canEditPatientProfile ? openProfileEditor : undefined} editLabel={editPatientFieldLabel(t.patients_address_street)} />
              <InfoRow label={t.patients_address_city} value={fieldVal(detail.address_city, t.common_not_set)} onEdit={canEditPatientProfile ? openProfileEditor : undefined} editLabel={editPatientFieldLabel(t.patients_address_city)} />
              <InfoRow label={t.patients_address_zip} value={fieldVal(detail.address_zip, t.common_not_set)} onEdit={canEditPatientProfile ? openProfileEditor : undefined} editLabel={editPatientFieldLabel(t.patients_address_zip)} />
              <InfoRow label={t.patients_address_country} value={fieldVal(detail.address_country, t.common_not_set)} onEdit={canEditPatientProfile ? openProfileEditor : undefined} editLabel={editPatientFieldLabel(t.patients_address_country)} />
            </div>
          </FormSection>

          {/* Emergency */}
          <FormSection
            title={l("Notfallkontakt", "Экстренный контакт", "Emergency contact")}
            accessory={
              canEditPatientProfile ? (
                <Button
                  type="button"
                  size="sm"
                  className="h-8 rounded-lg gap-1.5 bg-amber-500 text-white hover:bg-amber-600"
                  onClick={openProfileEditor}
                >
                  <Pencil className="size-3.5" />
                  {l("Bearbeiten", "Редактировать", "Edit")}
                </Button>
              ) : null
            }
          >
            <div className="grid gap-4 md:grid-cols-3">
              <InfoRow label={t.patients_emergency_name} value={fieldVal(detail.emergency_contact_name, t.common_not_set)} onEdit={canEditPatientProfile ? openProfileEditor : undefined} editLabel={editPatientFieldLabel(t.patients_emergency_name)} />
              <InfoRow label={t.patients_emergency_phone} value={fieldVal(detail.emergency_contact_phone, t.common_not_set)} onEdit={canEditPatientProfile ? openProfileEditor : undefined} editLabel={editPatientFieldLabel(t.patients_emergency_phone)} />
              <InfoRow label={t.patients_emergency_relation} value={fieldVal(detail.emergency_contact_relation, t.common_not_set)} onEdit={canEditPatientProfile ? openProfileEditor : undefined} editLabel={editPatientFieldLabel(t.patients_emergency_relation)} />
            </div>
          </FormSection>
          </div>

          <WorkspaceSectionIntro
            title={l("Compliance und Rechtsstatus", "Комплаенс и правовой статус", "Compliance and legal status")}
            description={l(
              "Vertragsbereitschaft, Pflichtbestätigungen und patientenbezogene Rechtsnotizen mit direkten Verknüpfungen in die zugehörigen Bereiche.",
              "Готовность по договорам, обязательные подтверждения и правовые заметки пациента с прямыми переходами в связанные разделы.",
              "Contract readiness, required confirmations and patient legal notes with direct links into the related workspaces.",
            )}
          />
          <FormSection
            title={
              <span className="inline-flex items-center gap-2">
                {t.patients_legal_status}
                <LegalStatusPill status={legalStatus} />
              </span>
            }
            accessory={
              canEditPatientProfile ? (
                <Button type="button" size="sm" className="h-8 rounded-lg gap-1.5" onClick={() => setLegalStatusSheetOpen(true)}>
                  <Pencil className="size-3.5" />
                  {l("Status aktualisieren", "Обновить статус", "Update status")}
                </Button>
              ) : null
            }
          >
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
              <div className="flex flex-col gap-1.5 rounded-xl border border-border/50 bg-muted/25 px-4 py-3 xl:col-span-2">
                <span className="text-[11.5px] font-medium text-muted-foreground leading-tight">
                  {l("Vertragsstatus", "Статус договора", "Contract status")}
                </span>
                <p className="text-base font-semibold text-foreground">
                  {patientDetailStatusLabel(legalStatus.contractStatus)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {legalStatusCompletion.completed}/{legalStatusCompletion.total} {l("erledigt", "выполнено", "done")}
                </p>
              </div>
              {legalStatusChecklist.map((item) => (
                <div key={item.key} className="flex flex-col gap-1.5 rounded-xl border border-border/50 bg-card px-4 py-3">
                  <span className="text-[11.5px] font-medium text-muted-foreground leading-tight">
                    {item.label}
                  </span>
                  <Badge
                    variant="outline"
                    className={cn(
                      "rounded-full text-[10px] w-fit",
                      item.done
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-amber-200 bg-amber-50 text-amber-700"
                    )}
                  >
                    {item.done ? t.common_completed : t.common_pending}
                  </Badge>
                </div>
              ))}
            </div>

            {legalStatus.notes ? (
              <div className="flex flex-col gap-1.5 rounded-xl border border-border/50 bg-muted/25 px-4 py-3">
                <span className="text-[11.5px] font-medium text-muted-foreground leading-tight">
                  {l("Notizen", "Заметки", "Notes")}
                </span>
                <p className="whitespace-pre-wrap text-sm text-foreground">{legalStatus.notes}</p>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              {canExportPatientCompliance ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-lg gap-1.5"
                  disabled={complianceExportBusy}
                  onClick={() => void handleExportPatientCompliance()}
                >
                  {complianceExportBusy ? (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  ) : null}
                  {l("DSGVO-Export", "Экспорт DSGVO", "DSGVO export")}
                </Button>
              ) : null}
              {canOpenComplianceWorkspace ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-lg"
                  onClick={() => staffGo(`/admin/compliance?patient=${id}`)}
                >
                  {l("DSGVO-Bereich öffnen", "Открыть раздел DSGVO", "Open DSGVO workspace")}
                </Button>
              ) : null}
              {canViewDocuments ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-lg"
                  onClick={() => setDocsPreviewOpen(true)}
                >
                  {l("Dokumente öffnen", "Открыть документы", "Open documents")}
                </Button>
              ) : null}
              {canViewContracts ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-lg"
                  onClick={() => setContractsPreviewOpen(true)}
                >
                  {l("Verträge öffnen", "Открыть договоры", "Open contracts")}
                </Button>
              ) : null}
              {canViewInvoices ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-lg"
                  onClick={() => setInvoicesPreviewOpen(true)}
                >
                  {l("Rechnungen öffnen", "Открыть счета", "Open invoices")}
                </Button>
              ) : null}
            </div>
          </FormSection>

          {id && canViewDocuments ? (
            <PatientDocumentsPreviewSheet
              key={`documents:${id}:${docsPreviewOpen ? "open" : "closed"}`}
              patientId={id}
              open={docsPreviewOpen}
              onOpenChange={setDocsPreviewOpen}
            />
          ) : null}
          {id && canViewContracts ? (
            <PatientContractsPreviewSheet
              key={`contracts:${id}:${contractsPreviewOpen ? "open" : "closed"}`}
              patientId={id}
              open={contractsPreviewOpen}
              onOpenChange={setContractsPreviewOpen}
            />
          ) : null}
          {id && canViewInvoices ? (
            <PatientInvoicesPreviewSheet
              key={`invoices:${id}:${invoicesPreviewOpen ? "open" : "closed"}`}
              patientId={id}
              open={invoicesPreviewOpen}
              onOpenChange={setInvoicesPreviewOpen}
            />
          ) : null}
          {id && canEditPatientProfile ? (
            <PatientLegalStatusSheet
              patientId={id}
              initial={legalStatus}
              open={legalStatusSheetOpen}
              onOpenChange={setLegalStatusSheetOpen}
              onSaved={reload}
            />
          ) : null}
          {id && canManagePatientVitals ? (
            <PatientVitalsSheet
              patientId={id}
              open={vitalsSheetOpen}
              onOpenChange={setVitalsSheetOpen}
              onSaved={reload}
            />
          ) : null}
          {id && canEditPatientProfile ? (
            <PatientCaveNotesSheet
              patientId={id}
              initial={detail.clinical_warnings ?? ""}
              open={caveSheetOpen}
              onOpenChange={setCaveSheetOpen}
              onSaved={reload}
            />
          ) : null}

          {hasClinicalSurface ? (
            <WorkspaceSectionIntro
              title={l("Klinische Oberfläche", "Клинический блок", "Clinical surface")}
              description={l(
                "Warnhinweise, Vitalverlauf, Kliniklog, Anordnungen und Risikobewertungen für das operative Behandlungsteam.",
                "Предупреждения, динамика показателей, клинический журнал, назначения и риск-оценки для операционной команды.",
                "Warnings, vitals, clinical log, orders and risk assessments for the operational care team.",
              )}
              accessory={<CountBadge>{clinicalSurfaceItemCount}</CountBadge>}
            />
          ) : null}

          {(canManagePatientVitals || detail.clinical_warnings || vitalsHistory.length > 0) ? (
            <div className="space-y-6">
              <FormSection
                title={l("CAVE-Hinweise", "Заметки CAVE", "Cave notes")}
                accessory={
                  canEditPatientProfile ? (
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 rounded-lg gap-1.5"
                      onClick={() => setCaveSheetOpen(true)}
                    >
                      <Pencil className="size-3.5" />
                      {l("Aktualisieren", "Обновить", "Update")}
                    </Button>
                  ) : null
                }
              >
                <div className="rounded-xl border border-rose-200 bg-rose-50/70 px-4 py-4">
                  {detail.clinical_warnings ? (
                    <p className="whitespace-pre-wrap text-sm text-rose-900">{detail.clinical_warnings}</p>
                  ) : (
                    <p className="text-sm text-rose-700">{l("Keine aktiven CAVE-Hinweise dokumentiert.", "Активные заметки CAVE не задокументированы.", "No active cave notes documented.")}</p>
                  )}
                </div>
              </FormSection>

              <FormSection
                title={l("Vitalwerte-Verlauf", "История показателей", "Vitals history")}
                accessory={
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="rounded-full border-border/60 bg-muted/25 text-foreground">
                      {l(`${vitalsHistory.length} Einträge`, `${vitalsHistory.length} записей`, `${vitalsHistory.length} entries`)}
                    </Badge>
                    {canManagePatientVitals ? (
                      <Button size="sm" className="h-8 rounded-lg gap-1.5" onClick={() => setVitalsSheetOpen(true)}>
                        <Plus className="size-3.5" />
                        {l("Hinzufügen", "Добавить", "Add")}
                      </Button>
                    ) : null}
                  </div>
                }
              >
                {vitalsHistory.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border/60 bg-muted/25 px-4 py-6 text-sm text-muted-foreground">
                    {l("Für diesen Patienten wurden noch keine Vitalwerte dokumentiert.", "Для этого пациента пока не зафиксированы показатели.", "No vitals have been recorded for this patient yet.")}
                  </div>
                ) : null}

                {vitalsHistory.length > 0 ? (
                  <div className="space-y-3 max-h-[540px] overflow-y-auto pr-1">
                    {vitalsHistory.map((item) => (
                      <div key={item.id} className="rounded-xl border border-border/50 bg-card px-4 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-foreground">
                              {fmtDateTime(item.measured_at, t.common_not_set)}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {l("Erfasst von", "Записал", "Recorded by")} {item.recorded_by_name ?? t.common_unknown}
                            </p>
                          </div>
                          <div className="flex flex-col items-end gap-0.5 text-xs text-muted-foreground">
                            {item.bp_systolic != null && item.bp_diastolic != null ? (
                              <span>RR {formatVitalNumber(item.bp_systolic, { maximumFractionDigits: 0 })}/{formatVitalNumber(item.bp_diastolic, { maximumFractionDigits: 0 })}</span>
                            ) : null}
                            {item.heart_rate != null ? (
                              <span>HF {formatVitalNumber(item.heart_rate, { maximumFractionDigits: 0 })}</span>
                            ) : null}
                            {item.weight_kg != null ? <span>{formatVitalNumber(item.weight_kg)} kg</span> : null}
                            {item.height_cm != null ? <span>{formatVitalNumber(item.height_cm)} cm</span> : null}
                            {item.bmi != null ? <span>BMI {formatVitalNumber(item.bmi)}</span> : null}
                          </div>
                        </div>
                        {item.notes ? (
                          <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{item.notes}</p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </FormSection>
            </div>
          ) : null}


          {(canManagePatientCardEntries || cardEntries.length > 0) ? (
            <FormSection
              title={l("Klinisches Kartenprotokoll", "Журнал клинической карты", "Clinical card log")}
              accessory={
                <div className="flex items-center gap-2">
                  <CountBadge>
                    {l(`${cardEntries.length} Einträge`, `${cardEntries.length} записей`, `${cardEntries.length} entries`)}
                  </CountBadge>
                  {canManagePatientCardEntries ? (
                    <Button size="sm" className="h-8 rounded-lg gap-1.5" onClick={() => setCardEntrySheetOpen(true)}>
                      <Plus className="size-3.5" />
                      {l("Hinzufügen", "Добавить", "Add")}
                    </Button>
                  ) : null}
                </div>
              }
            >
              {cardEntries.length === 0 ? (
                <EmptyCell>{l("Für diesen Patienten wurden noch keine klinischen Karteneinträge erfasst.", "Для этого пациента пока нет записей клинической карты.", "No clinical card log entries have been recorded for this patient yet.")}</EmptyCell>
              ) : (
                <div className="space-y-2">
                  {cardEntries.slice(0, 6).map((entry) => (
                    <div key={entry.id} className="rounded-xl border border-border/50 bg-card px-4 py-3 space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-[13px] text-foreground">
                          <span className="font-medium">{fmtDateTime(entry.entry_date, t.common_not_set)}</span>
                          <span className="text-muted-foreground"> · {entry.author_name ?? t.common_unknown}</span>
                        </p>
                        <Badge variant="outline" className={cn("rounded-full", patientCardEntryCategoryBadgeClass(entry.category))}>
                          {patientCardEntryCategoryLabel(entry.category)}
                        </Badge>
                      </div>
                      {entry.source ? (
                        <div className="flex flex-col gap-1">
                          <span className="text-[11.5px] font-medium text-muted-foreground leading-tight">
                            {l("Quelle", "Источник", "Source")}
                          </span>
                          <p className="text-[13px] text-foreground">{entry.source}</p>
                        </div>
                      ) : null}
                      <div className="flex flex-col gap-1">
                        <span className="text-[11.5px] font-medium text-muted-foreground leading-tight">
                          {l("Inhalt", "Содержание", "Content")}
                        </span>
                        <p className="whitespace-pre-wrap text-[13px] text-foreground">
                          {entry.content}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </FormSection>
          ) : null}

          {canManagePatientCardEntries && id ? (
            <PatientCardEntrySheet
              patientId={id}
              open={cardEntrySheetOpen}
              onOpenChange={setCardEntrySheetOpen}
              onSaved={reload}
            />
          ) : null}

          {(canManagePatientMedicalOrders || medicalOrders.length > 0) ? (
            <FormSection
              title={l("Medizinische Anordnungen", "Медицинские назначения", "Medical orders")}
              accessory={
                <div className="flex items-center gap-2">
                  <CountBadge>
                    {l(`${medicalOrders.length} назначений`, `${medicalOrders.length} назначений`, `${medicalOrders.length} orders`)}
                  </CountBadge>
                  {canManagePatientMedicalOrders ? (
                    <Button size="sm" className="h-8 rounded-lg gap-1.5" onClick={() => setMedicalOrderSheetOpen(true)}>
                      <Plus className="size-3.5" />
                      {l("Hinzufügen", "Добавить", "Add")}
                    </Button>
                  ) : null}
                </div>
              }
            >
              {medicalOrders.length === 0 ? (
                <EmptyCell>{l("Für diesen Patienten wurden noch keine medizinischen Anordnungen erfasst.", "Для этого пациента пока нет медицинских назначений.", "No medical orders have been recorded for this patient yet.")}</EmptyCell>
              ) : (
                <div className="space-y-2">
                  {medicalOrders.map((order) => (
                    <div key={order.id} className="rounded-xl border border-border/50 bg-card px-4 py-3 space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-[13px] text-foreground">
                          <span className="font-medium">{fmtDateTime(order.order_date, t.common_not_set)}</span>
                          <span className="text-muted-foreground"> · {l("Angeordnet von", "Назначил", "Ordered by")} {order.ordered_by_name ?? t.common_unknown}</span>
                        </p>
                        <Badge
                          variant="outline"
                          className={cn(
                            "rounded-full",
                            STATUS_BADGE_CLASSES[order.status] ?? "border-border/60 bg-muted/25 text-muted-foreground"
                          )}
                        >
                          {patientDetailStatusLabel(order.status)}
                        </Badge>
                      </div>
                        <div className="flex flex-col gap-1">
                          <span className="text-[11.5px] font-medium text-muted-foreground leading-tight">
                            {l("Titel", "Название", "Title")}
                          </span>
                          <p className="text-[13px] text-foreground">{order.title}</p>
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className="text-[11.5px] font-medium text-muted-foreground leading-tight">
                            {l("Typ", "Тип", "Type")}
                          </span>
                          <p className="text-[13px] text-foreground">
                            {patientMedicalOrderTypeLabel(order.order_type)}
                            {order.due_date ? ` · ${l("Fällig", "Срок", "Due")} ${order.due_date}` : ""}
                          </p>
                        </div>
                        {order.source ? (
                          <div className="flex flex-col gap-1">
                            <span className="text-[11.5px] font-medium text-muted-foreground leading-tight">
                              {l("Quelle", "Источник", "Source")}
                            </span>
                            <p className="text-[13px] text-foreground">{order.source}</p>
                          </div>
                        ) : null}
                        <div className="flex flex-col gap-1">
                          <span className="text-[11.5px] font-medium text-muted-foreground leading-tight">
                            {l("Anweisungen", "Инструкции", "Instructions")}
                          </span>
                          <p className="whitespace-pre-wrap text-[13px] text-foreground">{order.instructions}</p>
                        </div>
                        {canManagePatientMedicalOrders && order.status === "active" ? (
                          <div className="flex flex-wrap justify-end gap-2 pt-1">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8 rounded-lg gap-1.5"
                              disabled={medicalOrderActionId === order.id}
                              onClick={() => void handleUpdatePatientMedicalOrderStatus(order.id, "completed")}
                            >
                              {medicalOrderActionId === order.id ? (
                                <LoaderCircle className="size-3.5 animate-spin" />
                              ) : null}
                              {l("Abschließen", "Завершить", "Complete")}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8 rounded-lg gap-1.5 border-rose-200 text-rose-700 hover:bg-rose-50"
                              disabled={medicalOrderActionId === order.id}
                              onClick={() => void handleUpdatePatientMedicalOrderStatus(order.id, "cancelled")}
                            >
                              {medicalOrderActionId === order.id ? (
                                <LoaderCircle className="size-3.5 animate-spin" />
                              ) : null}
                              {l("Stornieren", "Отменить", "Cancel")}
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
            </FormSection>
          ) : null}

          {canManagePatientMedicalOrders && id ? (
            <PatientMedicalOrderSheet
              patientId={id}
              open={medicalOrderSheetOpen}
              onOpenChange={setMedicalOrderSheetOpen}
              onSaved={reload}
            />
          ) : null}


          {(canManagePatientRiskScores || riskScores.length > 0) ? (
            <FormSection
              title={l("Risikoscores", "Риск-скоры", "Risk scores")}
              accessory={
                <div className="flex items-center gap-2">
                  <CountBadge>
                    {l(`${riskScores.length} Scores`, `${riskScores.length} скоров`, `${riskScores.length} scores`)}
                  </CountBadge>
                  {canManagePatientRiskScores ? (
                    <Button size="sm" className="h-8 rounded-lg gap-1.5" onClick={() => setRiskScoreSheetOpen(true)}>
                      <Plus className="size-3.5" />
                      {l("Hinzufügen", "Добавить", "Add")}
                    </Button>
                  ) : null}
                </div>
              }
            >
              {riskScores.length === 0 ? (
                <EmptyCell>{l("Für diesen Patienten wurden noch keine Risikoscores erfasst.", "Для этого пациента пока нет риск-скоров.", "No risk scores have been recorded for this patient yet.")}</EmptyCell>
              ) : (
                <div className="space-y-2">
                  {riskScores.map((score) => (
                    <div key={score.id} className="rounded-xl border border-border/50 bg-card px-4 py-3 space-y-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <p className="text-[13px] text-foreground">
                            <span className="font-medium">{fmtDateTime(score.computed_at, t.common_not_set)}</span>
                            <span className="text-muted-foreground"> · {l("Erfasst von", "Записал", "Recorded by")} {score.recorded_by_name ?? t.common_unknown}</span>
                          </p>
                          <Badge variant="outline" className="rounded-full">
                            {formatVitalNumber(score.score_value)}
                            {score.scale_max != null ? ` / ${formatVitalNumber(score.scale_max)}` : ""}
                          </Badge>
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className="text-[11.5px] font-medium text-muted-foreground leading-tight">
                            {l("Typ", "Тип", "Type")}
                          </span>
                          <p className="text-[13px] text-foreground">{patientRiskScoreTypeLabel(score.score_type)}</p>
                        </div>
                        {score.source ? (
                          <div className="flex flex-col gap-1">
                            <span className="text-[11.5px] font-medium text-muted-foreground leading-tight">
                              {l("Quelle", "Источник", "Source")}
                            </span>
                            <p className="text-[13px] text-foreground">{score.source}</p>
                          </div>
                        ) : null}
                        {score.interpretation ? (
                          <div className="flex flex-col gap-1">
                            <span className="text-[11.5px] font-medium text-muted-foreground leading-tight">
                              {l("Interpretation", "Интерпретация", "Interpretation")}
                            </span>
                            <p className="whitespace-pre-wrap text-[13px] text-foreground">{score.interpretation}</p>
                          </div>
                        ) : null}
                        {score.inputs ? (
                          <div className="flex flex-col gap-1">
                            <span className="text-[11.5px] font-medium text-muted-foreground leading-tight">
                              {l("Eingaben", "Входные данные", "Inputs")}
                            </span>
                            <pre className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-[12px] text-foreground overflow-x-auto whitespace-pre-wrap">
                              {JSON.stringify(score.inputs, null, 2)}
                            </pre>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
            </FormSection>
          ) : null}

          {canManagePatientRiskScores && id ? (
            <PatientRiskScoreSheet
              patientId={id}
              open={riskScoreSheetOpen}
              onOpenChange={setRiskScoreSheetOpen}
              onSaved={reload}
            />
          ) : null}

          <WorkspaceSectionIntro
            title={l("Notizen und Kontext", "Заметки и контекст", "Notes and context")}
            description={l(
              "Freitext für operative Hinweise, die weder in klinische Anordnungen noch in den Rechtsstatus gehören.",
              "Свободный текст для операционных заметок, которые не относятся ни к клиническим назначениям, ни к правовому статусу.",
              "Free-form context for operational notes that do not belong in clinical orders or legal status.",
            )}
          />

          <FormSection
            title={t.patients_notes}
            accessory={
              canEditPatientProfile ? (
                <Button
                  type="button"
                  size="sm"
                  className="h-8 rounded-lg gap-1.5"
                  onClick={() => setNotesSheetOpen(true)}
                >
                  {detail.notes ? <Pencil className="size-3.5" /> : <Plus className="size-3.5" />}
                  {detail.notes
                    ? l("Bearbeiten", "Редактировать", "Edit")
                    : l("Hinzufügen", "Добавить", "Add")}
                </Button>
              ) : null
            }
          >
            <div className="rounded-xl border border-border/50 bg-muted/25 px-4 py-4">
              {detail.notes ? (
                <p className="text-sm text-foreground whitespace-pre-wrap">{detail.notes}</p>
              ) : (
                <p className="text-sm text-muted-foreground italic">
                  {l("Keine Notizen erfasst.", "Заметок пока нет.", "No notes yet.")}
                </p>
              )}
            </div>
          </FormSection>
          {id && canEditPatientProfile ? (
            <PatientNotesSheet
              patientId={id}
              initial={detail.notes ?? ""}
              open={notesSheetOpen}
              onOpenChange={setNotesSheetOpen}
              onSaved={reload}
            />
          ) : null}

        </TabsContent>

        <PatientCuratorsTab
          assignments={assignments}
          assignableStaff={assignableStaff}
          assignBusy={assignBusy}
          canManage={canManage}
          formInputClassName={formInputClassName}
          l={l}
          onAssign={handleAssign}
          onRevoke={(item) => {
            const confirmed = window.confirm(
              l(
                `Zuordnung für ${item.user_name} widerrufen?`,
                `Отозвать назначение для ${item.user_name}?`,
                `Revoke assignment for ${item.user_name}?`,
              )
            );
            if (!confirmed) return;
            void revokePatientAssignment(id ?? "", item.user_id)
              .catch(() => {})
              .finally(() => {
                reload();
              });
          }}
          onSelectedAssigneeChange={setSelectedAssignee}
          roleColors={ROLE_COLORS}
          roleLabel={roleLbl}
          selectedAssignee={selectedAssignee}
          formatDateTime={fmtDateTime}
          t={t}
          tr={tr}
        />

        <PatientRelationsTab
          canManageRelations={canManageRelations}
          formatDateTime={fmtDateTime}
          l={l}
          onCreateRelation={openCreateRelation}
          onDeleteRelation={(relationId) => {
            void handleDeleteRelation(relationId);
          }}
          onEditRelation={openEditRelation}
          onOpenPatient={(patientId) => {
            staffGo(`/patients/${patientId}`);
          }}
          relationTypeLabel={relationTypeLabel}
          relations={relations}
          tabLoading={tabLoading}
        />

        <PatientCasesTab
          cases={cases}
          emptyLabel={t.cases_no_match}
          formatDate={fmtDate}
          onOpenCase={(caseId) => {
            staffGo(`/cases/${caseId}?patient=${id}`);
          }}
          statusColors={STATUS_COLORS}
          statusLabel={(status) => tr[`cases_${status}`] ?? status}
          t={t}
          tabLoading={tabLoading}
        />

        <PatientOrdersTab
          emptyLabel={l(
            "Für diesen Patienten gibt es noch keine Aufträge.",
            "Для этого пациента пока нет заказов.",
            "No orders have been recorded for this patient yet.",
          )}
          formatDate={fmtDate}
          onOpenOrder={(orderId) => {
            staffGo(`/orders?order=${orderId}`);
          }}
          orderPhaseLabel={orderPhaseLabel}
          orders={orders}
          statusColors={STATUS_COLORS}
          statusLabel={patientDetailStatusLabel}
          t={t}
          tabLoading={tabLoading}
        />

        <PatientAppointmentsTab
          appointmentCarePathKindLabel={appointmentCarePathKindLabel}
          appointmentSheetOpen={appointmentSheetOpen}
          appointmentTypeLabel={appointmentTypeLabel}
          appointments={appointments}
          canManage={canManage}
          emptyLabel={l(
            "Für diesen Patienten sind noch keine Termine geplant.",
            "Для этого пациента пока нет приёмов.",
            "No appointments are scheduled for this patient yet.",
          )}
          formatDate={fmtDate}
          onAppointmentSheetOpenChange={setAppointmentSheetOpen}
          onOpenAppointment={(appointmentId) => {
            staffGo(`/appointments?appointment=${appointmentId}`);
          }}
          patientId={id}
          reload={reload}
          statusColors={STATUS_COLORS}
          statusLabel={patientDetailStatusLabel}
          t={t}
          tabLoading={tabLoading}
        />

        <PatientDocumentsTab
          l={l}
          commonNotSet={t.common_not_set}
          commonUnknown={t.common_unknown}
          documentsFilenameLabel={t.documents_filename}
          appointmentsTypeLabel={t.appointments_type}
          usersStatusLabel={t.users_status}
          patientsAssignedByLabel={t.patients_assigned_by}
          usersCreatedLabel={t.users_created}
          tabLoading={tabLoading}
          documents={documents}
          filteredDocuments={filteredDocuments}
          documentAlerts={documentAlerts}
          requiredDocumentFulfilledCount={requiredDocumentFulfilledCount}
          documentCategoryOptions={documentCategoryOptions}
          documentStatusOptions={documentStatusOptions}
          hasDocumentFilters={hasDocumentFilters}
          documentStatusFilter={documentStatusFilter}
          documentCategoryFilter={documentCategoryFilter}
          onDocumentStatusFilterChange={setDocumentStatusFilter}
          onDocumentCategoryFilterChange={setDocumentCategoryFilter}
          onResetDocumentFilters={() => {
            setDocumentStatusFilter("all");
            setDocumentCategoryFilter("all");
          }}
          canManageDocuments={canManageDocuments}
          onOpenUpload={() => setDocumentUploadOpen(true)}
          statusColors={STATUS_COLORS}
          statusLabel={patientDetailStatusLabel}
          formatDate={fmtDate}
        />

        {canViewContracts ? (
          <PatientContractsTab
            l={l}
            commonNotSet={t.common_not_set}
            tabLoading={tabLoading}
            contracts={contracts}
            contractSignedCount={contractSignedCount}
            contractPendingCount={contractPendingCount}
            contractExpiringSoonCount={contractExpiringSoonCount}
            canManageContracts={canManageContracts}
            onCreateContract={() => setContractCreateOpen(true)}
            onEditContractStatus={openContractStatusEditor}
            onOpenContract={(contractId) => staffGo(`/contracts?contract=${contractId}`)}
            statusColors={STATUS_COLORS}
            statusLabel={patientDetailStatusLabel}
            formatDate={fmtDate}
            formatDateTime={fmtDateTime}
            isContractExpiringSoon={isContractExpiringSoon}
          />
        ) : null}

        {canViewInvoices ? (
          <PatientInvoicesTab
            l={l}
            commonNotSet={t.common_not_set}
            tabLoading={tabLoading}
            invoices={invoices}
            invoiceOpenCount={invoiceOpenCount}
            invoiceOverdueCount={invoiceOverdueCount}
            invoiceOutstandingAmount={invoiceOutstandingAmount}
            invoicePaidAmountTotal={invoicePaidAmountTotal}
            canManageInvoices={canManageInvoices}
            onOpenInvoice={(invoiceId) => staffGo(`/invoices?invoice=${invoiceId}`)}
            onManageInvoice={openInvoiceManager}
            statusColors={STATUS_COLORS}
            statusLabel={patientDetailStatusLabel}
            formatDate={fmtDate}
            formatDateTime={fmtDateTime}
            formatMoney={fmtMoney}
            moneyValueNumber={moneyValueNumber}
            invoiceTypeLabel={invoiceTypeLabel}
          />
        ) : null}

        <PatientWorkflowTab
          l={l}
          commonNotSet={t.common_not_set}
          tabLoading={tabLoading}
          workflowChecklist={workflowChecklist}
          workflowChecklistGroups={workflowChecklistGroups}
          workflowItemCount={workflowItemCount}
          workflowBusy={workflowBusy}
          workflowForm={workflowForm}
          activeWorkflowAssignees={activeWorkflowAssignees}
          canManageWorkflowChecklist={canManageWorkflowChecklist}
          statusColors={STATUS_COLORS}
          statusLabel={patientDetailStatusLabel}
          formatDateTime={fmtDateTime}
          roleLabel={(value) => roleLbl(value, tr)}
          priorityLabel={priorityLabel}
          priorityBadgeClass={priorityBadgeClass}
          onCompleteWorkflowItem={handleCompleteWorkflowItem}
          onSubmitWorkflowItem={handleAddWorkflowItem}
          onWorkflowItemTextChange={(value) =>
            setWorkflowForm((current) => ({
              ...current,
              itemText: value,
            }))
          }
          onWorkflowOwnerChange={(value) =>
            setWorkflowForm((current) => ({
              ...current,
              ownerUserId: value,
            }))
          }
          onWorkflowPriorityChange={(value) =>
            setWorkflowForm((current) => ({
              ...current,
              priority: value,
            }))
          }
          onWorkflowDueDateChange={(value) =>
            setWorkflowForm((current) => ({
              ...current,
              dueDate: value,
            }))
          }
        />

        <PatientTimelineTab
          l={l}
          commonSearch={t.common_search}
          tabLoading={tabLoading}
          timeline={timeline}
          filteredTimeline={filteredTimeline}
          groupedTimeline={groupedTimeline}
          timelineSummary={timelineSummary}
          timelineTotal={timelineTotal}
          timelineOffset={timelineOffset}
          timelineLimit={timelineLimit}
          timelineHasNextPage={timelineHasNextPage}
          timelineEntityFilter={timelineEntityFilter}
          timelineCategoryFilter={timelineCategoryFilter}
          timelineSourceFilter={timelineSourceFilter}
          timelineRangeFilter={timelineRangeFilter}
          timelineSearch={timelineSearch}
          localizedTimelineRangeOptions={localizedTimelineRangeOptions}
          timelineCategoryOptions={timelineCategoryOptions}
          timelineSourceOptions={timelineSourceOptions}
          hasTimelineFilters={hasTimelineFilters}
          statusColors={STATUS_COLORS}
          statusLabel={patientDetailStatusLabel}
          formatDateTime={fmtDateTime}
          timelineEntityDotClass={timelineEntityDotClass}
          timelineItemSurfaceClass={timelineItemSurfaceClass}
          canOpenDocumentsWorkspace={canOpenDocumentsWorkspace}
          canViewContracts={canViewContracts}
          canViewInvoices={canViewInvoices}
          canOpenComplianceWorkspace={canOpenComplianceWorkspace}
          onTimelineEntityFilterChange={(value) => {
            setTimelineEntityFilter(value);
            setTimelineOffset(0);
          }}
          onTimelineCategoryFilterChange={(value) => {
            setTimelineCategoryFilter(value);
            setTimelineOffset(0);
          }}
          onTimelineSourceFilterChange={(value) => {
            setTimelineSourceFilter(value);
            setTimelineOffset(0);
          }}
          onTimelineRangeFilterChange={(value) => {
            setTimelineRangeFilter(value);
            setTimelineOffset(0);
          }}
          onTimelineSearchChange={(value) => {
            setTimelineSearch(value);
            setTimelineOffset(0);
          }}
          onTimelineOffsetChange={setTimelineOffset}
          onResetTimelineFilters={() => {
            setTimelineEntityFilter("all");
            setTimelineCategoryFilter("all");
            setTimelineSourceFilter("all");
            setTimelineRangeFilter("all");
            setTimelineSearch("");
            setTimelineOffset(0);
          }}
          onOpenRoute={staffGo}
        />
      </Tabs>

      <MemoizedPatientProfileEditorSheet
        open={profileEditorOpen}
        patientId={id}
        detail={detail}
        dictionary={tr}
        lang={lang}
        statusLabel={patientDetailStatusLabel}
        onOpenChange={handleProfileEditorOpenChange}
        onSaved={reload}
        onError={setTabActionError}
      />

      <MemoizedPatientRelationEditorSheet
        open={relationEditorOpen}
        patientId={id}
        selfPatientId={detail.id}
        canManageRelations={canManageRelations}
        editingRelation={editingRelation}
        dictionary={tr}
        lang={lang}
        textareaClassName={spaciousTextareaClassName}
        onOpenChange={handleRelationEditorOpenChange}
        onSaved={reload}
        onError={setTabActionError}
      />

      <MemoizedPatientDocumentUploadDialog
        open={documentUploadOpen}
        patientId={id}
        orders={orders}
        appointments={appointments}
        dictionary={tr}
        lang={lang}
        textareaClassName={spaciousTextareaClassName}
        statusLabel={patientDetailStatusLabel}
        formatDate={fmtDate}
        onOpenChange={handleDocumentUploadOpenChange}
        onSaved={reload}
        onError={setTabActionError}
      />

      <Sheet open={contractCreateOpen} onOpenChange={setContractCreateOpen}>
        <SheetContent side="right" className="w-full sm:max-w-[560px] gap-0">
          <SheetHeader className="px-4 py-3">
            <SheetTitle>
              {l("Rahmenvertrag erstellen", "Создать рамочный договор", "Create framework contract")}
            </SheetTitle>
          </SheetHeader>
          <form className="flex flex-col flex-1 min-h-0" onSubmit={handleCreateContract}>
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label
                    className="text-[11.5px] font-medium text-muted-foreground leading-tight"
                    htmlFor="contract-status"
                  >
                    {l("Status", "Статус", "Status")}
                  </Label>
                  <ShadSelect
                    value={contractCreateForm.status}
                    onValueChange={(value) =>
                      setContractCreateForm((current) => ({
                        ...current,
                        status: (value ?? current.status) as ContractStatus,
                      }))
                    }
                  >
                    <SelectTrigger id="contract-status" className="w-full">
                      <SelectValue>{patientDetailStatusLabel(contractCreateForm.status)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {CONTRACT_STATUS_OPTIONS.map((status) => (
                        <SelectItem key={status} value={status}>
                          {patientDetailStatusLabel(status)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </ShadSelect>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label
                    className="text-[11.5px] font-medium text-muted-foreground leading-tight"
                    htmlFor="contract-signed-at"
                  >
                    {l("Unterzeichnet am", "Подписано", "Signed at")}
                  </Label>
                  <Input
                    id="contract-signed-at"
                    type="datetime-local"
                    value={contractCreateForm.signedAt}
                    onChange={(event) => setContractCreateForm((current) => ({ ...current, signedAt: event.target.value }))}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label
                    className="text-[11.5px] font-medium text-muted-foreground leading-tight"
                    htmlFor="contract-valid-from"
                  >
                    {l("Gültig ab", "Действует с", "Valid from")}
                  </Label>
                  <Input
                    id="contract-valid-from"
                    type="date"
                    value={contractCreateForm.validFrom}
                    onChange={(event) => setContractCreateForm((current) => ({ ...current, validFrom: event.target.value }))}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label
                    className="text-[11.5px] font-medium text-muted-foreground leading-tight"
                    htmlFor="contract-valid-to"
                  >
                    {l("Gültig bis", "Действует до", "Valid to")}
                  </Label>
                  <Input
                    id="contract-valid-to"
                    type="date"
                    value={contractCreateForm.validTo}
                    onChange={(event) => setContractCreateForm((current) => ({ ...current, validTo: event.target.value }))}
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-4 py-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 rounded-lg"
                onClick={() => setContractCreateOpen(false)}
              >
                {t.common_cancel}
              </Button>
              <Button type="submit" size="sm" className="h-8 rounded-lg gap-1.5" disabled={contractBusy}>
                {contractBusy ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
                {l("Vertrag erstellen", "Создать договор", "Create contract")}
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>

      <Dialog open={Boolean(contractStatusId)} onOpenChange={(open) => { if (!open) setContractStatusId(""); }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{l("Vertragsstatus aktualisieren", "Обновить статус договора", "Update contract status")}</DialogTitle>
            <DialogDescription>
              {l(
                "Passen Sie Lebenszyklus und Gültigkeitsdaten an, ohne das Patientenprofil zu verlassen.",
                "Обновляйте жизненный цикл и даты действия, не выходя из профиля пациента.",
                "Adjust lifecycle and validity dates without leaving the patient profile.",
              )}
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleSaveContractStatus}>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="contract-status-edit">{l("Status", "Статус", "Status")}</Label>
                <ShadSelect
                  value={contractStatusForm.status}
                  onValueChange={(value) =>
                    setContractStatusForm((current) => ({
                      ...current,
                      status: (value ?? current.status) as ContractStatus,
                    }))
                  }
                >
                  <SelectTrigger id="contract-status-edit" className="w-full">
                    <SelectValue>{patientDetailStatusLabel(contractStatusForm.status)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {CONTRACT_STATUS_OPTIONS.map((status) => (
                      <SelectItem key={status} value={status}>
                        {patientDetailStatusLabel(status)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </ShadSelect>
              </div>
              <div className="space-y-2">
                <Label htmlFor="contract-signed-at-edit">{l("Unterzeichnet am", "Подписано", "Signed at")}</Label>
                <Input
                  id="contract-signed-at-edit"
                  type="datetime-local"
                  value={contractStatusForm.signedAt}
                  onChange={(event) => setContractStatusForm((current) => ({ ...current, signedAt: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contract-valid-from-edit">{l("Gültig ab", "Действует с", "Valid from")}</Label>
                <Input
                  id="contract-valid-from-edit"
                  type="date"
                  value={contractStatusForm.validFrom}
                  onChange={(event) => setContractStatusForm((current) => ({ ...current, validFrom: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contract-valid-to-edit">{l("Gültig bis", "Действует до", "Valid to")}</Label>
                <Input
                  id="contract-valid-to-edit"
                  type="date"
                  value={contractStatusForm.validTo}
                  onChange={(event) => setContractStatusForm((current) => ({ ...current, validTo: event.target.value }))}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" className="rounded-xl" onClick={() => setContractStatusId("")}>
                {l("Abbrechen", "Отмена", "Cancel")}
              </Button>
              <Button type="submit" className="rounded-xl bg-slate-950 text-white hover:bg-slate-800" disabled={contractBusy}>
                {contractBusy ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
                {l("Status speichern", "Сохранить статус", "Save status")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(invoiceManageId)} onOpenChange={(open) => { if (!open) setInvoiceManageId(""); }}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{l("Rechnung verwalten", "Управлять счётом", "Manage invoice")}</DialogTitle>
            <DialogDescription>
              {l(
                "Aktualisieren Sie den Billing-Status und setzen Sie den Mahnprozess direkt aus dem Patientenprofil fort.",
                "Обновляйте статус billing и продолжайте процесс напоминаний прямо из профиля пациента.",
                "Update billing status and continue dunning flow directly from the patient profile.",
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5">
            <form className="space-y-4" onSubmit={handleSaveInvoiceStatus}>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="invoice-status-edit">{l("Status", "Статус", "Status")}</Label>
                  <ShadSelect
                    value={invoiceStatusForm.status}
                    onValueChange={(value) =>
                      setInvoiceStatusForm((current) => ({
                        ...current,
                        status: (value ?? current.status) as InvoiceStatus,
                      }))
                    }
                  >
                    <SelectTrigger id="invoice-status-edit" className="w-full">
                      <SelectValue>{patientDetailStatusLabel(invoiceStatusForm.status)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {INVOICE_STATUS_OPTIONS.map((status) => (
                        <SelectItem key={status} value={status}>
                          {patientDetailStatusLabel(status)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </ShadSelect>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invoice-due-date-edit">{l("Fälligkeitsdatum", "Срок", "Due date")}</Label>
                  <Input
                    id="invoice-due-date-edit"
                    type="date"
                    value={invoiceStatusForm.dueDate}
                    onChange={(event) => setInvoiceStatusForm((current) => ({ ...current, dueDate: event.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invoice-paid-amount-edit">{l("Bezahlter Betrag", "Оплаченная сумма", "Paid amount")}</Label>
                  <Input
                    id="invoice-paid-amount-edit"
                    value={invoiceStatusForm.paidAmount}
                    onChange={(event) => setInvoiceStatusForm((current) => ({ ...current, paidAmount: event.target.value }))}
                    placeholder="0.00"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="invoice-notes-edit">{l("Notizen", "Заметки", "Notes")}</Label>
                <textarea
                  id="invoice-notes-edit"
                  className={spaciousTextareaClassName}
                  value={invoiceStatusForm.notes}
                  onChange={(event) => setInvoiceStatusForm((current) => ({ ...current, notes: event.target.value }))}
                  placeholder={l("Billing-Notizen oder Details zur Zahlungsbestätigung", "Заметки по billing или детали подтверждения оплаты", "Billing notes or payment confirmation details")}
                />
              </div>
              <div className="flex justify-end">
                <Button type="submit" className="rounded-xl bg-slate-950 text-white hover:bg-slate-800" disabled={invoiceBusy}>
                  {invoiceBusy ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
                  {l("Rechnung speichern", "Сохранить счёт", "Save invoice")}
                </Button>
              </div>
            </form>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-950">Mahnwesen</p>
                  <p className="mt-1 text-xs text-slate-500">{l("Verfolgen Sie versendete Mahnungen und eskalieren Sie überfällige Rechnungen.", "Отслеживайте отправленные напоминания и эскалируйте просроченные счета.", "Track sent reminders and escalate overdue invoices.")}</p>
                </div>
                {canManageInvoices && nextDunningLevel(dunningEvents) ? (
                  <Button type="button" className="rounded-xl bg-slate-950 text-white hover:bg-slate-800" onClick={() => void handleCreateDunning()} disabled={dunningBusy}>
                    {dunningBusy ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
                    {l("Senden", "Отправить", "Send")} {nextDunningLevel(dunningEvents)}
                  </Button>
                ) : null}
              </div>
              <div className="mt-4 space-y-2">
                <Label htmlFor="dunning-note">{l("Mahnhinweis", "Заметка по напоминанию", "Reminder note")}</Label>
                <textarea
                  id="dunning-note"
                  className={spaciousTextareaClassName}
                  value={dunningNote}
                  onChange={(event) => setDunningNote(event.target.value)}
                  placeholder={l("Optionale Notiz für den Billing-Verlauf", "Необязательная заметка для trail биллинга", "Optional note for billing trail")}
                />
              </div>
              <div className="mt-4 space-y-3">
                {dunningEvents.length === 0 ? (
                  <p className="text-sm text-slate-500">{l("Noch nicht erfasst.", "Не зафиксировано.", "Not recorded yet.")}</p>
                ) : (
                  dunningEvents.map((event) => (
                    <div key={event.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <Badge variant="outline" className="rounded-full text-[10px]">
                          {event.level}
                        </Badge>
                        <span className="text-xs text-slate-400">{fmtDateTime(event.sent_at)}</span>
                      </div>
                      <div className="mt-2 space-y-1 text-sm text-slate-600">
                        <p>{l("Offener Betrag", "Сумма к оплате", "Balance due")}: {fmtMoney(event.balance_due)}</p>
                        <p>{l("Erstellt von", "Создано", "Created by")}: {event.created_by_name}</p>
                        {event.note ? <p>{event.note}</p> : null}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" className="rounded-xl" onClick={() => setInvoiceManageId("")}>
                {l("Schließen", "Закрыть", "Close")}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
