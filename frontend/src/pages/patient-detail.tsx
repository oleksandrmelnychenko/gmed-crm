import {
  memo,
  useDeferredValue,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  LoaderCircle,
  Pencil,
  Plus,
  Printer,
  SquarePen,
  UserX,
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
  FunctionalLabelChips,
  humanizeFunctionalLabel,
  parseFunctionalLabels,
} from "@/components/patient-form-primitives";
import {
  CountBadge,
  EmptyCell,
  Field as FormField,
  Section as FormSection,
  StatCard,
  TabLoader,
  inputClass as formInputClassName,
  textareaClass as formTextareaClassName,
} from "@/components/ui-shell";
import { StatusActionPill } from "@/components/status-action-pill";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { PatientCardEntrySheet } from "@/components/patient-card-entry-sheet";
import { PatientMedicalOrderSheet } from "@/components/patient-medical-order-sheet";
import { PatientRiskScoreSheet } from "@/components/patient-risk-score-sheet";
import {
  PatientDocumentsPreviewSheet,
  PatientContractsPreviewSheet,
  PatientInvoicesPreviewSheet,
} from "@/components/patient-legal-preview-sheets";
import { PatientLegalStatusSheet } from "@/components/patient-legal-status-sheet";
import { PatientVitalsSheet } from "@/components/patient-vitals-sheet";
import { PatientCaveNotesSheet } from "@/components/patient-cave-notes-sheet";
import { PatientNotesSheet } from "@/components/patient-notes-sheet";
import { PatientAppointmentSheet } from "@/components/patient-appointment-sheet";
import { PatientCasePreviewSheet } from "@/components/patient-case-preview-sheet";
import {
  localizeDocumentCode,
  localizeRequiredDocumentLabel,
} from "@/lib/required-document-labels";
import {
  localizeWorkflowGroupLabel,
  localizeWorkflowItemText,
} from "@/lib/workflow-labels";
import {
  localizeTimelineCategory,
  localizeTimelineEntityType,
  localizeTimelineSource,
  timelineEntityTypeBadgeClass,
} from "@/lib/timeline-labels";
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
import { apiFetch, buildApiUrl, downloadApiFile } from "@/lib/api";
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
  formatRelatedPatientName,
  formatRelatedPatientOption,
  normalizePatientDetailTab,
  PATIENT_LABEL_FORMAT_OPTIONS,
  resolvePatientTimelineRoute,
  type PatientLabelFormatId,
  type PatientLabelPayload,
  type PatientTimelineRangeFilter,
} from "./patient-detail.helpers";
import {
  PATIENT_CONTRACT_STATUS_OPTIONS,
  getPatientLegalStatusChecklist,
  getPatientLegalStatusCompletion,
  normalizePatientLegalStatus,
  serializePatientLegalStatus,
  type PatientLegalStatus,
} from "./patient-legal-status";

type PatientDetail = {
  id: string;
  patient_id: string;
  title?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  birth_date?: string | null;
  gender: string;
  nationality?: string | null;
  residence_country?: string | null;
  languages?: string[];
  functional_labels?: string[];
  phone_primary?: string | null;
  phone_secondary?: string | null;
  email?: string | null;
  insurance_provider?: string | null;
  insurance_type?: string | null;
  insurance_number?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
  address_street?: string | null;
  address_city?: string | null;
  address_zip?: string | null;
  address_country?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  emergency_contact_relation?: string | null;
  legal_status?: unknown;
  clinical_warnings?: string | null;
  notes?: string | null;
};

type PatientVitalMeasurement = {
  id: string;
  measured_at: string;
  bp_systolic?: number | null;
  bp_diastolic?: number | null;
  heart_rate?: number | null;
  weight_kg?: number | null;
  height_cm?: number | null;
  bmi?: number | null;
  notes?: string | null;
  recorded_by?: string | null;
  recorded_by_name?: string | null;
  created_at: string;
};

type PatientCardEntry = {
  id: string;
  entry_date: string;
  category: string;
  source?: string | null;
  content: string;
  author_id: string;
  author_name?: string | null;
  created_at: string;
  updated_at: string;
};

type PatientMedicalOrder = {
  id: string;
  order_date: string;
  order_type: string;
  title: string;
  instructions: string;
  status: string;
  due_date?: string | null;
  source?: string | null;
  ordered_by: string;
  ordered_by_name?: string | null;
  created_at: string;
  updated_at: string;
};

type PatientRiskScore = {
  id: string;
  computed_at: string;
  score_type: string;
  score_value: number;
  scale_max?: number | null;
  interpretation?: string | null;
  source?: string | null;
  inputs?: Record<string, unknown> | null;
  recorded_by: string;
  recorded_by_name?: string | null;
  created_at: string;
};

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

type PatientAssignment = {
  user_id: string;
  user_name: string;
  user_role: string;
  user_active: boolean;
  assigned_by_name: string | null;
  assigned_at: string;
  revoked_at: string | null;
};

type StaffOption = { id: string; name: string; role: string };

type PatientLookupItem = {
  id: string;
  patient_id: string;
  title?: string | null;
  first_name?: string | null;
  last_name?: string | null;
};

type CaseItem = {
  id: string;
  case_id: string;
  status: string;
  hauptanfragegrund?: string | null;
  created_at: string;
};

type OrderItem = {
  id: string;
  order_number: string;
  phase: string;
  status: string;
  needs_description?: string | null;
  created_at: string;
};

type AppointmentItem = {
  id: string;
  title: string;
  date: string;
  time_start?: string | null;
  apt_type: string;
  care_path_kind: string;
  status: string;
  provider_name?: string | null;
  doctor_name?: string | null;
};

type RelationItem = {
  id: string;
  related_patient_id?: string | null;
  related_patient_pid?: string | null;
  related_name: string;
  related_display_name?: string | null;
  relation_type: string;
  is_emergency_contact: boolean;
  phone?: string | null;
  notes?: string | null;
  created_at: string;
};

type TimelineItem = {
  entity_type: string;
  entity_id: string;
  title: string;
  category: string;
  status: string;
  happened_at: string;
  source_label?: string | null;
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

type DocumentItem = {
  id: string;
  filename: string;
  category?: string | null;
  status?: string | null;
  uploaded_by_name?: string | null;
  created_at: string;
};

type DocumentAlertRule = {
  key: string;
  label: string;
  fulfilled: boolean;
  matching_documents: Array<{
    id: string;
    filename: string;
    art: string;
    category?: string | null;
    status: string;
  }>;
};

type DocumentAlerts = {
  configured_rule_count: number;
  document_pack_complete: boolean;
  stored_document_pack_complete: boolean;
  out_of_sync: boolean;
  required_documents: DocumentAlertRule[];
  missing_documents: Array<{ key: string; label: string }>;
  missing_count: number;
};

type ContractItem = {
  id: string;
  contract_number: string;
  status: string;
  signed_at?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  created_at: string;
};

type InvoiceItem = {
  id: string;
  invoice_number: string;
  invoice_type: string;
  status: string;
  issued_at: string;
  due_date?: string | null;
  total_gross?: string | null;
  paid_amount?: string | null;
  balance_due?: string | null;
  order_number?: string | null;
  quote_number?: string | null;
};

type RelationFormState = {
  relatedPatientId: string;
  relatedName: string;
  relationType: string;
  isEmergencyContact: boolean;
  phone: string;
  notes: string;
};

type DocumentStatus = "draft" | "active" | "archived";
type DocumentVisibility =
  | "internal"
  | "released_internal"
  | "released_external"
  | "patient_visible";

type DocumentUploadFormState = {
  file: File | null;
  autoName: string;
  art: string;
  category: string;
  status: DocumentStatus;
  visibility: DocumentVisibility;
  isMedical: boolean;
  notes: string;
  orderId: string;
  appointmentId: string;
};

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

type DunningEvent = {
  id: string;
  invoice_id: string;
  level: "first" | "second" | "collections";
  note?: string | null;
  due_date_snapshot?: string | null;
  balance_due: string;
  sent_at: string;
  created_at: string;
  created_by_name: string;
  created_by_role: string;
};

type DunningLevel = "first" | "second" | "collections";

type PatientEditFormState = {
  title: string;
  firstName: string;
  lastName: string;
  phonePrimary: string;
  phoneSecondary: string;
  email: string;
  nationality: string;
  residenceCountry: string;
  languages: string;
  functionalLabels: string;
  addressStreet: string;
  addressCity: string;
  addressZip: string;
  addressCountry: string;
  insuranceProvider: string;
  insuranceNumber: string;
  insuranceType: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelation: string;
  legalStatus: PatientLegalStatus;
  clinicalWarnings: string;
  notes: string;
};

type WorkflowChecklistItem = {
  id: string;
  checklist_key: string;
  item_key: string;
  item_text: string;
  owner_role: string;
  owner_user_id?: string | null;
  owner_name?: string | null;
  owner_user_role?: string | null;
  priority: string;
  due_date?: string | null;
  linked_task_id?: string | null;
  linked_task_status?: string | null;
  is_completed: boolean;
  completed_at?: string | null;
  sort_order: number;
  created_at: string;
};

type WorkflowChecklistResponse = {
  scope_type: string;
  scope_id: string;
  open_count: number;
  completed_count: number;
  items: WorkflowChecklistItem[];
};

type WorkflowChecklistFormState = {
  itemText: string;
  ownerUserId: string;
  priority: string;
  dueDate: string;
};

const PATIENT_OPERATIONAL_TABS = new Set([
  "relations",
  "cases",
  "orders",
  "appointments",
  "workflow",
  "timeline",
]);

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

const selectClassName =
  "h-9 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30";

const textareaClassName =
  "min-h-[104px] w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30";

const RELATION_TYPE_OPTIONS = [
  "spouse",
  "parent",
  "child",
  "sibling",
  "relative",
  "guardian",
  "caregiver",
  "friend",
  "other",
] as const;
const DOCUMENT_STATUS_OPTIONS: DocumentStatus[] = ["draft", "active", "archived"];
const DOCUMENT_VISIBILITY_OPTIONS: DocumentVisibility[] = [
  "internal",
  "released_internal",
  "released_external",
  "patient_visible",
];
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
function blankRelationForm(): RelationFormState {
  return {
    relatedPatientId: "",
    relatedName: "",
    relationType: "other",
    isEmergencyContact: false,
    phone: "",
    notes: "",
  };
}

function relationToForm(relation: RelationItem): RelationFormState {
  return {
    relatedPatientId: relation.related_patient_id ?? "",
    relatedName: relation.related_name,
    relationType: relation.relation_type,
    isEmergencyContact: relation.is_emergency_contact,
    phone: relation.phone ?? "",
    notes: relation.notes ?? "",
  };
}

function blankDocumentUploadForm(): DocumentUploadFormState {
  return {
    file: null,
    autoName: "",
    art: "report",
    category: "",
    status: "active",
    visibility: "internal",
    isMedical: true,
    notes: "",
    orderId: "",
    appointmentId: "",
  };
}

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

function patientToEditForm(detail: PatientDetail): PatientEditFormState {
  return {
    title: detail.title ?? "",
    firstName: detail.first_name ?? "",
    lastName: detail.last_name ?? "",
    phonePrimary: detail.phone_primary ?? "",
    phoneSecondary: detail.phone_secondary ?? "",
    email: detail.email ?? "",
    nationality: detail.nationality ?? "",
    residenceCountry: detail.residence_country ?? "",
    languages: detail.languages?.join(", ") ?? "",
    functionalLabels: detail.functional_labels?.join(", ") ?? "",
    addressStreet: detail.address_street ?? "",
    addressCity: detail.address_city ?? "",
    addressZip: detail.address_zip ?? "",
    addressCountry: detail.address_country ?? "",
    insuranceProvider: detail.insurance_provider ?? "",
    insuranceNumber: detail.insurance_number ?? "",
    insuranceType: detail.insurance_type ?? "",
    emergencyContactName: detail.emergency_contact_name ?? "",
    emergencyContactPhone: detail.emergency_contact_phone ?? "",
    emergencyContactRelation: detail.emergency_contact_relation ?? "",
    legalStatus: normalizePatientLegalStatus(detail.legal_status),
    clinicalWarnings: detail.clinical_warnings ?? "",
    notes: detail.notes ?? "",
  };
}

function Lbl({ children }: { children: React.ReactNode }) {
  return <span className="text-[11.5px] font-medium text-muted-foreground">{children}</span>;
}

function LegalStatusPill({ status }: { status: PatientLegalStatus }) {
  const { lang } = useLang();
  const lp = (de: string, ru: string, en: string) =>
    lang === "de" ? de : lang === "ru" ? ru : en;
  const completion = getPatientLegalStatusCompletion(status);

  let kind: "complete" | "partial" | "none";
  let text: string;
  if (status.complianceCompleted) {
    kind = "complete";
    text = lp("Bereit", "Готов", "Ready");
  } else if (completion.completed === 0) {
    kind = "none";
    text = lp("Nicht begonnen", "Не начат", "Not started");
  } else {
    kind = "partial";
    text = `${completion.completed}/${completion.total} ${lp("erledigt", "выполнено", "done")}`;
  }

  const pillClass = {
    complete: "border-emerald-200 bg-emerald-50 text-emerald-700",
    partial: "border-amber-200 bg-amber-50 text-amber-700",
    none: "border-border bg-muted text-muted-foreground",
  }[kind];

  const dotClass = {
    complete: "bg-emerald-500",
    partial: "bg-amber-500",
    none: "bg-muted-foreground/60",
  }[kind];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.08em]",
        pillClass
      )}
    >
      <span className={cn("size-1.5 rounded-full", dotClass)} />
      {text}
    </span>
  );
}

function InfoRow({ label, value, onEdit }: { label: string; value: string; onEdit?: () => void }) {
  return (
    <div className="group flex flex-col gap-1 relative">
      <Lbl>{label}</Lbl>
      <span className="text-sm text-slate-900">{value}</span>
      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          aria-label={`${patientDetailText("Bearbeiten", "Редактировать", "Edit")} ${label}`}
          className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg p-1 hover:bg-slate-100"
        >
          <Pencil className="size-3 text-slate-400" />
        </button>
      )}
    </div>
  );
}

function WorkspaceSectionIntro({
  title,
  description,
  accessory,
}: {
  title: ReactNode;
  description: ReactNode;
  accessory?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-muted/20 px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <p className="max-w-3xl text-xs text-muted-foreground">{description}</p>
      </div>
      {accessory ? <div className="shrink-0">{accessory}</div> : null}
    </div>
  );
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

type PatientDetailDictionary = Record<string, string>;

type PatientProfileEditorSheetProps = {
  open: boolean;
  patientId: string | undefined;
  detail: PatientDetail | null;
  dictionary: PatientDetailDictionary;
  lang: string;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  onError: (message: string) => void;
};

function PatientProfileEditorSheet({
  open,
  patientId,
  detail,
  dictionary,
  lang,
  onOpenChange,
  onSaved,
  onError,
}: PatientProfileEditorSheetProps) {
  const [form, setForm] = useState<PatientEditFormState | null>(null);
  const [busy, setBusy] = useState(false);
  const l = (de: string, ru: string, en: string) =>
    lang === "de" ? de : lang === "ru" ? ru : en;

  useEffect(() => {
    if (!open) {
      setForm(null);
      setBusy(false);
    }
  }, [open]);

  useEffect(() => {
    if (open && detail && form === null) {
      setForm(patientToEditForm(detail));
    }
  }, [detail, form, open]);

  function updateField<K extends keyof PatientEditFormState>(
    field: K,
    value: PatientEditFormState[K]
  ) {
    setForm((current) => (current ? { ...current, [field]: value } : current));
  }

  function updateLegalStatusField<K extends keyof PatientLegalStatus>(
    field: K,
    value: PatientLegalStatus[K]
  ) {
    setForm((current) =>
      current
        ? {
            ...current,
            legalStatus: { ...current.legalStatus, [field]: value },
          }
        : current
    );
  }

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!patientId || !form) return;
      setBusy(true);
      onError("");
      try {
        await apiFetch(`/patients/${patientId}/update`, {
          method: "POST",
          body: JSON.stringify({
            title: form.title,
            first_name: form.firstName,
            last_name: form.lastName,
            phone_primary: form.phonePrimary,
            phone_secondary: form.phoneSecondary,
            email: form.email,
            nationality: form.nationality,
            residence_country: form.residenceCountry,
            languages: form.languages
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean),
            functional_labels: parseFunctionalLabels(form.functionalLabels),
            address_street: form.addressStreet,
            address_city: form.addressCity,
            address_zip: form.addressZip,
            address_country: form.addressCountry,
            insurance_provider: form.insuranceProvider,
            insurance_number: form.insuranceNumber,
            insurance_type: form.insuranceType,
            emergency_contact_name: form.emergencyContactName,
            emergency_contact_phone: form.emergencyContactPhone,
            emergency_contact_relation: form.emergencyContactRelation,
            legal_status: serializePatientLegalStatus(form.legalStatus),
            clinical_warnings: form.clinicalWarnings,
            notes: form.notes,
          }),
        });
        toast.success(dictionary.common_active);
        onOpenChange(false);
        onSaved();
      } catch (error) {
        onError(
          error instanceof Error ? error.message : dictionary.common_failed_update
        );
      } finally {
        setBusy(false);
      }
    },
    [dictionary.common_active, dictionary.common_failed_update, form, onError, onOpenChange, onSaved, patientId]
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-[860px]">
        {form ? (
          <form className="flex flex-col flex-1 min-h-0" onSubmit={handleSubmit}>
            <SheetHeader className="shrink-0 px-4 pt-3 pb-1">
              <SheetTitle>{l("Patientenprofil bearbeiten", "Редактировать профиль пациента", "Edit patient profile")}</SheetTitle>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto px-4 py-2 space-y-3">
              <FormSection title={l("Persönliche Daten", "Личные данные", "Personal data")}>
                <div className="grid gap-3 md:grid-cols-3">
                  <FormField label={l("Titel", "Обращение", "Title")}>
                    <Input value={form.title} onChange={(event) => updateField("title", event.target.value)} className={formInputClassName} />
                  </FormField>
                  <FormField label={l("Vorname", "Имя", "First name")}>
                    <Input value={form.firstName} onChange={(event) => updateField("firstName", event.target.value)} required className={formInputClassName} />
                  </FormField>
                  <FormField label={l("Nachname", "Фамилия", "Last name")}>
                    <Input value={form.lastName} onChange={(event) => updateField("lastName", event.target.value)} required className={formInputClassName} />
                  </FormField>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <FormField label={l("Nationalität", "Гражданство", "Nationality")}>
                    <Input value={form.nationality} onChange={(event) => updateField("nationality", event.target.value)} className={formInputClassName} />
                  </FormField>
                  <FormField label={l("Wohnsitzland", "Страна проживания", "Residence country")}>
                    <Input value={form.residenceCountry} onChange={(event) => updateField("residenceCountry", event.target.value)} className={formInputClassName} />
                  </FormField>
                </div>
                <FormField label={l("Sprachen", "Языки", "Languages")}>
                  <Input value={form.languages} onChange={(event) => updateField("languages", event.target.value)} placeholder="de, uk, en" className={formInputClassName} />
                </FormField>
                <FormField label={l("Funktionale Labels", "Функциональные метки", "Functional labels")}>
                  <FunctionalLabelChips
                    value={form.functionalLabels}
                    onChange={(next) => updateField("functionalLabels", next)}
                  />
                </FormField>
              </FormSection>

              <FormSection title={l("Kontakt", "Контакты", "Contact")}>
                <div className="grid gap-3 md:grid-cols-3">
                  <FormField label={l("Primäre Telefonnummer", "Основной телефон", "Primary phone")}>
                    <Input value={form.phonePrimary} onChange={(event) => updateField("phonePrimary", event.target.value)} className={formInputClassName} />
                  </FormField>
                  <FormField label={l("Sekundäre Telefonnummer", "Доп. телефон", "Secondary phone")}>
                    <Input value={form.phoneSecondary} onChange={(event) => updateField("phoneSecondary", event.target.value)} className={formInputClassName} />
                  </FormField>
                  <FormField label={l("E-Mail", "Эл. почта", "Email")}>
                    <Input type="email" value={form.email} onChange={(event) => updateField("email", event.target.value)} className={formInputClassName} />
                  </FormField>
                </div>
              </FormSection>

              <FormSection title={l("Adresse", "Адрес", "Address")}>
                <FormField label={l("Straße", "Улица", "Street")}>
                  <Input value={form.addressStreet} onChange={(event) => updateField("addressStreet", event.target.value)} className={formInputClassName} />
                </FormField>
                <div className="grid gap-3 md:grid-cols-3">
                  <FormField label={l("Stadt", "Город", "City")}>
                    <Input value={form.addressCity} onChange={(event) => updateField("addressCity", event.target.value)} className={formInputClassName} />
                  </FormField>
                  <FormField label={l("PLZ", "Индекс", "ZIP")}>
                    <Input value={form.addressZip} onChange={(event) => updateField("addressZip", event.target.value)} className={formInputClassName} />
                  </FormField>
                  <FormField label={l("Adressland", "Страна адреса", "Address country")}>
                    <Input value={form.addressCountry} onChange={(event) => updateField("addressCountry", event.target.value)} className={formInputClassName} />
                  </FormField>
                </div>
              </FormSection>

              <FormSection title={l("Versicherung", "Страхование", "Insurance")}>
                <div className="grid gap-3 md:grid-cols-3">
                  <FormField label={l("Versicherer", "Страховая компания", "Insurance provider")}>
                    <Input value={form.insuranceProvider} onChange={(event) => updateField("insuranceProvider", event.target.value)} className={formInputClassName} />
                  </FormField>
                  <FormField label={l("Versicherungsnummer", "Номер полиса", "Insurance number")}>
                    <Input value={form.insuranceNumber} onChange={(event) => updateField("insuranceNumber", event.target.value)} className={formInputClassName} />
                  </FormField>
                  <FormField label={l("Versicherungstyp", "Тип страхования", "Insurance type")}>
                    <ShadSelect
                      value={form.insuranceType || "__unset__"}
                      onValueChange={(value) => updateField("insuranceType", value === "__unset__" ? "" : value ?? "")}
                    >
                      <SelectTrigger className={cn("w-full", formInputClassName)}>
                        <SelectValue>
                          {(() => {
                            switch (form.insuranceType) {
                              case "private": return l("Privat", "Частная", "Private");
                              case "public": return l("Gesetzlich", "Государственная", "Public");
                              case "self_pay": return l("Selbstzahler", "Самооплата", "Self pay");
                              case "foreign": return l("Ausland", "Иностранная", "Foreign");
                              default: return dictionary.common_not_set;
                            }
                          })()}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__unset__">{dictionary.common_not_set}</SelectItem>
                        <SelectItem value="private">{l("Privat", "Частная", "Private")}</SelectItem>
                        <SelectItem value="public">{l("Gesetzlich", "Государственная", "Public")}</SelectItem>
                        <SelectItem value="self_pay">{l("Selbstzahler", "Самооплата", "Self pay")}</SelectItem>
                        <SelectItem value="foreign">{l("Ausland", "Иностранная", "Foreign")}</SelectItem>
                      </SelectContent>
                    </ShadSelect>
                  </FormField>
                </div>
              </FormSection>

              <FormSection title={l("Notfallkontakt", "Экстренный контакт", "Emergency contact")}>
                <div className="grid gap-3 md:grid-cols-3">
                  <FormField label={l("Notfallkontakt", "Контакт", "Contact")}>
                    <Input value={form.emergencyContactName} onChange={(event) => updateField("emergencyContactName", event.target.value)} className={formInputClassName} />
                  </FormField>
                  <FormField label={l("Notfalltelefon", "Телефон", "Phone")}>
                    <Input value={form.emergencyContactPhone} onChange={(event) => updateField("emergencyContactPhone", event.target.value)} className={formInputClassName} />
                  </FormField>
                  <FormField label={l("Beziehung", "Связь", "Relation")}>
                    <Input value={form.emergencyContactRelation} onChange={(event) => updateField("emergencyContactRelation", event.target.value)} className={formInputClassName} />
                  </FormField>
                </div>
              </FormSection>

              <FormSection
                title={dictionary.patients_legal_status}
                accessory={<LegalStatusPill status={form.legalStatus} />}
              >
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {[
                    { key: "dsgvoSigned", label: l("DSGVO unterschrieben", "DSGVO подписано", "DSGVO signed") },
                    { key: "confidentialityReleaseSigned", label: l("Schweigepflicht freigegeben", "Снятие врачебной тайны", "Confidentiality released") },
                    { key: "identityVerified", label: l("Identität bestätigt", "Личность подтверждена", "Identity verified") },
                    { key: "documentPackComplete", label: l("Dokumentenpaket vollständig", "Пакет документов собран", "Document pack complete") },
                    { key: "complianceCompleted", label: l("Bereit bestätigt", "Готовность подтверждена", "Readiness confirmed") },
                  ].map((item) => {
                    const key = item.key as keyof PatientLegalStatus;
                    return (
                      <label
                        key={item.key}
                        className="flex items-center gap-2 rounded-lg border border-border/50 bg-card px-2.5 py-2 text-[12.5px] text-foreground cursor-pointer hover:bg-muted/40 transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={Boolean(form.legalStatus[key])}
                          onChange={(event) => updateLegalStatusField(key, event.target.checked as PatientLegalStatus[typeof key])}
                          className="size-3.5 accent-[var(--brand)] cursor-pointer"
                        />
                        {item.label}
                      </label>
                    );
                  })}
                </div>
                <FormField label={l("Vertragsstatus", "Статус договора", "Contract status")}>
                  <ShadSelect
                    value={form.legalStatus.contractStatus}
                    onValueChange={(value) => updateLegalStatusField("contractStatus", value ?? "")}
                  >
                    <SelectTrigger className={cn("w-full", formInputClassName)}>
                      <SelectValue>
                        {patientDetailStatusLabel(form.legalStatus.contractStatus)}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {PATIENT_CONTRACT_STATUS_OPTIONS.map((status) => (
                        <SelectItem key={status} value={status}>
                          {patientDetailStatusLabel(status)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </ShadSelect>
                </FormField>
                <FormField label={l("Notizen", "Заметки", "Notes")}>
                  <textarea
                    className={formTextareaClassName}
                    value={form.legalStatus.notes}
                    onChange={(event) => updateLegalStatusField("notes", event.target.value)}
                    placeholder={l(
                      "Ausstehende Unterschriften, fehlende IDs, offene Compliance-Fragen",
                      "Ожидающие подписи, отсутствующие ID, открытые вопросы compliance",
                      "Pending signatures, missing IDs, open compliance questions",
                    )}
                  />
                </FormField>
              </FormSection>

              <FormSection title={l("CAVE-Hinweise", "Предупреждения CAVE", "CAVE warnings")}>
                <textarea
                  className={formTextareaClassName}
                  value={form.clinicalWarnings}
                  onChange={(event) => updateField("clinicalWarnings", event.target.value)}
                  placeholder={l(
                    "Dauerhafte klinische Warnhinweise oder Sicherheitshinweise",
                    "Постоянные клинические предупреждения или сигналы безопасности",
                    "Persistent clinical warnings or safety alerts",
                  )}
                />
              </FormSection>

              <FormSection title={l("Notizen", "Заметки", "Notes")}>
                <textarea
                  className={formTextareaClassName}
                  value={form.notes}
                  onChange={(event) => updateField("notes", event.target.value)}
                />
              </FormSection>
            </div>

            <div className="shrink-0 flex justify-end gap-2 px-4 py-3 bg-popover">
              <Button type="button" variant="outline" className="h-9 rounded-lg" onClick={() => onOpenChange(false)}>
                {l("Abbrechen", "Отмена", "Cancel")}
              </Button>
              <Button type="submit" className="h-9 rounded-lg gap-1.5 px-3.5" disabled={busy}>
                {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {l("Patient speichern", "Сохранить пациента", "Save patient")}
              </Button>
            </div>
          </form>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

const MemoizedPatientProfileEditorSheet = memo(PatientProfileEditorSheet);

type PatientRelationEditorSheetProps = {
  open: boolean;
  patientId: string | undefined;
  selfPatientId: string;
  canManageRelations: boolean;
  editingRelation: RelationItem | null;
  dictionary: PatientDetailDictionary;
  lang: string;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  onError: (message: string) => void;
};

function PatientRelationEditorSheet({
  open,
  patientId,
  selfPatientId,
  canManageRelations,
  editingRelation,
  dictionary,
  lang,
  onOpenChange,
  onSaved,
  onError,
}: PatientRelationEditorSheetProps) {
  const [form, setForm] = useState<RelationFormState>(blankRelationForm);
  const [busy, setBusy] = useState(false);
  const [patientOptions, setPatientOptions] = useState<PatientLookupItem[]>([]);
  const [patientSearch, setPatientSearch] = useState("");
  const [optionsLoading, setOptionsLoading] = useState(false);
  const deferredPatientSearch = useDeferredValue(patientSearch);
  const l = (de: string, ru: string, en: string) =>
    lang === "de" ? de : lang === "ru" ? ru : en;

  useEffect(() => {
    if (!open) {
      setForm(blankRelationForm());
      setBusy(false);
      setPatientOptions([]);
      setPatientSearch("");
      setOptionsLoading(false);
      return;
    }

    setForm(editingRelation ? relationToForm(editingRelation) : blankRelationForm());
    setPatientSearch(editingRelation?.related_display_name || editingRelation?.related_name || "");
  }, [editingRelation, open]);

  useEffect(() => {
    if (!open || !canManageRelations) return;
    let cancelled = false;
    setOptionsLoading(true);

    apiFetch<PatientLookupItem[]>("/patients?active_only=true")
      .then((items) => {
        if (!cancelled) {
          setPatientOptions(items);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPatientOptions([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setOptionsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [canManageRelations, open]);

  const filteredPatientOptions = useMemo(() => {
    const normalizedSearch = deferredPatientSearch.trim().toLowerCase();

    return patientOptions.filter((option) => {
      if (option.id === selfPatientId) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      return formatRelatedPatientOption(option).toLowerCase().includes(normalizedSearch);
    });
  }, [deferredPatientSearch, patientOptions, selfPatientId]);

  const selectedRelatedPatient = useMemo(
    () => patientOptions.find((option) => option.id === form.relatedPatientId) ?? null,
    [form.relatedPatientId, patientOptions]
  );

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!patientId || (!form.relatedPatientId && !form.relatedName.trim())) {
        onError(dictionary.common_failed_create);
        return;
      }

      setBusy(true);
      onError("");
      try {
        const selectedPatientName = selectedRelatedPatient
          ? formatRelatedPatientName(selectedRelatedPatient)
          : null;
        const payload = {
          related_patient_id: form.relatedPatientId || undefined,
          related_name: (selectedPatientName ?? form.relatedName).trim(),
          relation_type: form.relationType,
          is_emergency_contact: form.isEmergencyContact,
          phone: toOptional(form.phone),
          notes: toOptional(form.notes),
        };
        if (editingRelation) {
          await apiFetch(`/patients/${patientId}/relations/${editingRelation.id}/update`, {
            method: "POST",
            body: JSON.stringify(payload),
          });
        } else {
          await apiFetch(`/patients/${patientId}/relations`, {
            method: "POST",
            body: JSON.stringify(payload),
          });
        }
        toast.success(dictionary.common_active);
        onOpenChange(false);
        onSaved();
      } catch (error) {
        onError(
          error instanceof Error ? error.message : dictionary.common_failed_update
        );
      } finally {
        setBusy(false);
      }
    },
    [
      dictionary.common_active,
      dictionary.common_failed_create,
      dictionary.common_failed_update,
      editingRelation,
      form,
      onError,
      onOpenChange,
      onSaved,
      patientId,
      selectedRelatedPatient,
    ]
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-[560px] gap-0">
        <SheetHeader className="px-4 py-3">
          <SheetTitle>
            {editingRelation
              ? l("Beziehung bearbeiten", "Редактировать связь", "Edit relation")
              : l("Beziehung hinzufügen", "Добавить связь", "Add relation")}
          </SheetTitle>
        </SheetHeader>
        <form className="flex flex-col flex-1 min-h-0" onSubmit={handleSubmit}>
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            <div className="flex flex-col gap-1.5">
              <Label
                className="text-[11.5px] font-medium text-muted-foreground leading-tight"
                htmlFor="relation-patient-search"
              >
                {l("Bestehenden Patienten suchen", "Поиск существующего пациента", "Search existing patient")}
              </Label>
              <Input
                id="relation-patient-search"
                value={patientSearch}
                onChange={(event) => setPatientSearch(event.target.value)}
                placeholder={l("PID oder Patientenname", "PID или имя пациента", "PID or patient name")}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label
                className="text-[11.5px] font-medium text-muted-foreground leading-tight"
                htmlFor="relation-linked-patient"
              >
                {l("Patient im System verknüpfen", "Связать пациента в системе", "Link patient in system")}
              </Label>
              <select
                id="relation-linked-patient"
                className={selectClassName}
                value={form.relatedPatientId}
                onChange={(event) => {
                  const nextPatientId = event.target.value;
                  const selectedPatient =
                    patientOptions.find((option) => option.id === nextPatientId) ?? null;
                  setPatientSearch(
                    selectedPatient ? formatRelatedPatientOption(selectedPatient) : ""
                  );
                  setForm((current) => ({
                    ...current,
                    relatedPatientId: nextPatientId,
                    relatedName: selectedPatient
                      ? formatRelatedPatientName(selectedPatient)
                      : current.relatedName,
                  }));
                }}
                disabled={optionsLoading}
              >
                <option value="">{l("Eigenständiger Kontakt", "Самостоятельный контакт", "Standalone contact")}</option>
                {filteredPatientOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {formatRelatedPatientOption(option)}
                  </option>
                ))}
              </select>
              <p className="text-[11.5px] text-muted-foreground leading-tight">
                {optionsLoading
                  ? l("Patientenverzeichnis wird geladen...", "Загрузка справочника пациентов...", "Loading patient directory...")
                  : selectedRelatedPatient
                    ? l("Verknüpfte Beziehungen bleiben mit einem bestehenden Patientendatensatz synchronisiert.", "Связанные отношения синхронизируются с существующим пациентом.", "Linked relations stay synced to an existing patient record.")
                    : l("Leer lassen für Angehörige oder Betreuer, die keine Patienten im System sind.", "Оставьте пустым для родственников или опекунов, которые не являются пациентами в системе.", "Keep this empty for relatives or caregivers who are not patients in the system.")}
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label
                  className="text-[11.5px] font-medium text-muted-foreground leading-tight"
                  htmlFor="relation-name"
                >
                  {l("Name", "Имя", "Name")}
                </Label>
                <Input
                  id="relation-name"
                  value={form.relatedName}
                  onChange={(event) => setForm((current) => ({ ...current, relatedName: event.target.value }))}
                  placeholder={l("Name eines Angehörigen oder Betreuers", "Имя родственника или опекуна", "Relative or caregiver name")}
                  disabled={Boolean(form.relatedPatientId)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label
                  className="text-[11.5px] font-medium text-muted-foreground leading-tight"
                  htmlFor="relation-type"
                >
                  {l("Beziehungstyp", "Тип связи", "Relation type")}
                </Label>
                <select
                  id="relation-type"
                  className={selectClassName}
                  value={form.relationType}
                  onChange={(event) => setForm((current) => ({ ...current, relationType: event.target.value }))}
                >
                  {RELATION_TYPE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label
                  className="text-[11.5px] font-medium text-muted-foreground leading-tight"
                  htmlFor="relation-phone"
                >
                  {l("Telefon", "Телефон", "Phone")}
                </Label>
                <Input
                  id="relation-phone"
                  value={form.phone}
                  onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
                  placeholder="+49 ..."
                />
              </div>
              <label className="flex items-center gap-2 rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={form.isEmergencyContact}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      isEmergencyContact: event.target.checked,
                    }))
                  }
                />
                {l("Notfallkontakt", "Экстренный контакт", "Emergency contact")}
              </label>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label
                className="text-[11.5px] font-medium text-muted-foreground leading-tight"
                htmlFor="relation-notes"
              >
                {l("Notizen", "Заметки", "Notes")}
              </Label>
              <textarea
                id="relation-notes"
                className={textareaClassName}
                value={form.notes}
                onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                placeholder={l(
                  "Erreichbarkeit, Kontakthinweise oder besondere Anweisungen",
                  "Доступность, заметки по контакту или особые инструкции",
                  "Availability, contact notes or special instructions",
                )}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 px-4 py-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-lg"
              onClick={() => onOpenChange(false)}
            >
              {dictionary.common_cancel}
            </Button>
            <Button type="submit" size="sm" className="h-8 rounded-lg gap-1.5" disabled={busy}>
              {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
              {dictionary.common_save}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

const MemoizedPatientRelationEditorSheet = memo(PatientRelationEditorSheet);

type PatientDocumentUploadDialogProps = {
  open: boolean;
  patientId: string | undefined;
  orders: OrderItem[];
  appointments: AppointmentItem[];
  dictionary: PatientDetailDictionary;
  lang: string;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  onError: (message: string) => void;
};

function PatientDocumentUploadDialog({
  open,
  patientId,
  orders,
  appointments,
  dictionary,
  lang,
  onOpenChange,
  onSaved,
  onError,
}: PatientDocumentUploadDialogProps) {
  const [form, setForm] = useState<DocumentUploadFormState>(blankDocumentUploadForm);
  const [busy, setBusy] = useState(false);
  const l = (de: string, ru: string, en: string) =>
    lang === "de" ? de : lang === "ru" ? ru : en;

  useEffect(() => {
    if (!open) {
      setForm(blankDocumentUploadForm());
      setBusy(false);
    }
  }, [open]);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    setForm((current) => ({
      ...current,
      file: event.target.files?.[0] ?? null,
    }));
  }

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!patientId || !form.file || !form.art.trim()) {
        onError(dictionary.common_failed_create);
        return;
      }

      setBusy(true);
      onError("");
      try {
        const formData = new FormData();
        formData.append("file", form.file);
        formData.append("patient_id", patientId);
        if (form.orderId) formData.append("order_id", form.orderId);
        if (form.appointmentId) formData.append("appointment_id", form.appointmentId);
        if (form.autoName.trim()) formData.append("auto_name", form.autoName.trim());
        formData.append("art", form.art.trim());
        if (form.category.trim()) formData.append("category", form.category.trim());
        formData.append("status", form.status);
        formData.append("visibility", form.visibility);
        if (form.isMedical) formData.append("is_medical", "true");
        if (form.notes.trim()) formData.append("notes", form.notes.trim());
        await apiFetch("/documents/upload", {
          method: "POST",
          body: formData,
        });
        toast.success(dictionary.common_active);
        onOpenChange(false);
        onSaved();
      } catch (error) {
        onError(
          error instanceof Error ? error.message : dictionary.common_failed_create
        );
      } finally {
        setBusy(false);
      }
    },
    [
      dictionary.common_active,
      dictionary.common_failed_create,
      form,
      onError,
      onOpenChange,
      onSaved,
      patientId,
    ]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{l("Patientendokument hochladen", "Загрузить документ пациента", "Upload patient document")}</DialogTitle>
          <DialogDescription>
            {l(
              "Hier hochgeladene Dateien werden direkt mit diesem Patienten verknüpft und können auch einem Auftrag oder Termin zugeordnet werden.",
              "Загруженные здесь файлы привязываются напрямую к пациенту и также могут быть связаны с заказом или приёмом.",
              "Files uploaded here are linked directly to this patient and can also be attached to an order or appointment.",
            )}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="document-file">{l("Datei", "Файл", "File")}</Label>
              <Input id="document-file" type="file" onChange={handleFileChange} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="document-name">{l("Anzeigename", "Отображаемое имя", "Display name")}</Label>
              <Input
                id="document-name"
                value={form.autoName}
                onChange={(event) => setForm((current) => ({ ...current, autoName: event.target.value }))}
                placeholder={l("Optionaler sichtbarer Name für den Patienten", "Необязательное имя для отображения пациенту", "Optional patient-facing name")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="document-art">{l("Typ", "Тип", "Type")}</Label>
              <Input
                id="document-art"
                value={form.art}
                onChange={(event) => setForm((current) => ({ ...current, art: event.target.value }))}
                placeholder="report"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="document-category">{l("Kategorie", "Категория", "Category")}</Label>
              <Input
                id="document-category"
                value={form.category}
                onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}
                placeholder="medical"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="document-status">{l("Status", "Статус", "Status")}</Label>
              <select
                id="document-status"
                className={selectClassName}
                value={form.status}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    status: event.target.value as DocumentStatus,
                  }))
                }
              >
                {DOCUMENT_STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {patientDetailStatusLabel(status)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="document-visibility">{l("Sichtbarkeit", "Видимость", "Visibility")}</Label>
              <select
                id="document-visibility"
                className={selectClassName}
                value={form.visibility}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    visibility: event.target.value as DocumentVisibility,
                  }))
                }
              >
                {DOCUMENT_VISIBILITY_OPTIONS.map((visibility) => (
                  <option key={visibility} value={visibility}>
                    {visibility === "internal"
                      ? l("Intern", "Внутреннее", "Internal")
                      : visibility === "released_internal"
                        ? l("Intern freigegeben", "Внутренне опубликовано", "Released internal")
                        : visibility === "released_external"
                          ? l("Extern freigegeben", "Внешне опубликовано", "Released external")
                          : l("Für Patienten sichtbar", "Видно пациенту", "Patient visible")}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="document-order">{l("Auftrag", "Заказ", "Order")}</Label>
              <select
                id="document-order"
                className={selectClassName}
                value={form.orderId}
                onChange={(event) => setForm((current) => ({ ...current, orderId: event.target.value }))}
              >
                <option value="">{l("Keine Auftragsverknüpfung", "Без привязки к заказу", "No order link")}</option>
                {orders.map((order) => (
                  <option key={order.id} value={order.id}>
                    {order.order_number}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="document-appointment">{l("Termin", "Приём", "Appointment")}</Label>
              <select
                id="document-appointment"
                className={selectClassName}
                value={form.appointmentId}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    appointmentId: event.target.value,
                  }))
                }
              >
                <option value="">{l("Keine Terminverknüpfung", "Без привязки к приёму", "No appointment link")}</option>
                {appointments.map((appointment) => (
                  <option key={appointment.id} value={appointment.id}>
                    {appointment.title} · {fmtDate(appointment.date)}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.isMedical}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    isMedical: event.target.checked,
                  }))
                }
              />
              {l("Medizinisches Dokument", "Медицинский документ", "Medical document")}
            </label>
          </div>
          <div className="space-y-2">
            <Label htmlFor="document-notes">{l("Notizen", "Заметки", "Notes")}</Label>
            <textarea
              id="document-notes"
              className={textareaClassName}
              value={form.notes}
              onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
              placeholder={l("Optionale Verarbeitungs- oder Sichtbarkeitsnotizen", "Необязательные заметки по обработке или видимости", "Optional processing or visibility notes")}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" className="rounded-xl" onClick={() => onOpenChange(false)}>
              {l("Abbrechen", "Отмена", "Cancel")}
            </Button>
            <Button type="submit" className="rounded-xl bg-slate-950 text-white hover:bg-slate-800" disabled={busy}>
              {busy ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
              {l("Dokument hochladen", "Загрузить документ", "Upload document")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const MemoizedPatientDocumentUploadDialog = memo(PatientDocumentUploadDialog);

export function PatientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { staffGo } = useStaffNavigate();
  const { user } = useAuth();
  const { t, lang } = useLang();
  const tr = t as unknown as Record<string, string>;
  const l = (de: string, ru: string, en: string) =>
    lang === "de" ? de : lang === "ru" ? ru : en;

  const [detail, setDetail] = useState<PatientDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [assignments, setAssignments] = useState<PatientAssignment[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [selectedAssignee, setSelectedAssignee] = useState("");
  const [assignBusy, setAssignBusy] = useState(false);
  const [vitalsHistory, setVitalsHistory] = useState<PatientVitalMeasurement[]>([]);
  const [cardEntries, setCardEntries] = useState<PatientCardEntry[]>([]);
  const [medicalOrders, setMedicalOrders] = useState<PatientMedicalOrder[]>([]);
  const [riskScores, setRiskScores] = useState<PatientRiskScore[]>([]);

  const [cases, setCases] = useState<CaseItem[]>([]);
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [appointments, setAppointments] = useState<AppointmentItem[]>([]);
  const [relations, setRelations] = useState<RelationItem[]>([]);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [documentAlerts, setDocumentAlerts] = useState<DocumentAlerts | null>(null);
  const [contracts, setContracts] = useState<ContractItem[]>([]);
  const [invoices, setInvoices] = useState<InvoiceItem[]>([]);
  const [workflowChecklist, setWorkflowChecklist] =
    useState<WorkflowChecklistResponse | null>(null);
  const [tabLoading, setTabLoading] = useState(false);
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
  const [casePreviewId, setCasePreviewId] = useState<string | null>(null);

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
  const [dunningEvents, setDunningEvents] = useState<DunningEvent[]>([]);
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
  const [timelineTotal, setTimelineTotal] = useState(0);
  const [timelineOffset, setTimelineOffset] = useState(() =>
    normalizeTimelineOffsetValue(searchParams.get("offset"))
  );
  const timelineLimit = 50;

  const canManage = user?.role === "ceo" || user?.role === "patient_manager" || user?.role === "teamlead_interpreter";
  const assignableStaff = useMemo(() => staff.filter((s) => canAssignTarget(user?.role, s.role)), [staff, user?.role]);
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
  const canExportPatientCompliance = user?.role === "patient_manager";
  const canOpenComplianceWorkspace = user?.role === "patient_manager";
  const canPrintPatientLabel = user?.role === "ceo" || user?.role === "patient_manager";
  const canManageWorkflowChecklist =
    user?.role === "ceo" ||
    user?.role === "patient_manager" ||
    user?.role === "concierge";
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
  const deferredTimelineSearch = useDeferredValue(timelineSearch);
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
      items: TimelineItem[];
    }> = [];
    let currentGroup:
      | {
          key: string;
          label: string;
          items: TimelineItem[];
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
    setVersion((v) => v + 1);
    setTabVersion((v) => v + 1);
  }, []);
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
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setError("");

    Promise.all([
      apiFetch<PatientDetail>(`/patients/${id}`),
      apiFetch<PatientAssignment[]>(`/patients/${id}/assignments`).catch(() => []),
      apiFetch<StaffOption[]>("/users?assignable_only=true&active_only=true").catch(() => []),
      canManagePatientVitals
        ? apiFetch<{ items: PatientVitalMeasurement[] }>(`/patients/${id}/vitals`).catch(() => ({
            items: [],
          }))
        : Promise.resolve({ items: [] as PatientVitalMeasurement[] }),
      canManagePatientCardEntries
        ? apiFetch<{ items: PatientCardEntry[] }>(`/patients/${id}/card-entries`).catch(() => ({
            items: [],
          }))
        : Promise.resolve({ items: [] as PatientCardEntry[] }),
      canManagePatientMedicalOrders
        ? apiFetch<{ items: PatientMedicalOrder[] }>(`/patients/${id}/medical-orders`).catch(() => ({
            items: [],
          }))
        : Promise.resolve({ items: [] as PatientMedicalOrder[] }),
      canManagePatientRiskScores
        ? apiFetch<{ items: PatientRiskScore[] }>(`/patients/${id}/risk-scores`).catch(() => ({
            items: [],
          }))
        : Promise.resolve({ items: [] as PatientRiskScore[] }),
    ]).then(([d, a, s, vitals, entries, medicalOrderItems, riskScoreItems]) => {
      if (cancelled) return;
      setDetail(d);
      setAssignments(a);
      setStaff(s);
      setVitalsHistory(vitals.items ?? []);
      setCardEntries(entries.items ?? []);
      setMedicalOrders(medicalOrderItems.items ?? []);
      setRiskScores(riskScoreItems.items ?? []);
      setLoading(false);
    }).catch((e) => {
      if (cancelled) return;
      setDetail(null);
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [
    canManagePatientCardEntries,
    canManagePatientMedicalOrders,
    canManagePatientRiskScores,
    canManagePatientVitals,
    id,
    version,
  ]);

  useEffect(() => {
    setTabActionError("");
  }, [activeTab]);

  useEffect(() => {
    if (
      !id ||
      activeTab === "profile" ||
      (PATIENT_OPERATIONAL_TABS.has(activeTab) && !canViewOperationalSurface) ||
      (activeTab === "documents" && !canViewDocuments) ||
      (activeTab === "contracts" && !canViewContracts) ||
      (activeTab === "invoices" && !canViewInvoices)
    ) return;
    let cancelled = false;
    setTabLoading(true);

    async function loadTabData() {
      try {
        switch (activeTab) {
          case "relations": {
            const result = await apiFetch<RelationItem[]>(`/patients/${id}/relations`);
            if (!cancelled) setRelations(result);
            break;
          }
          case "cases": {
            const result = await apiFetch<CaseItem[]>(`/patients/${id}/cases`);
            if (!cancelled) setCases(result);
            break;
          }
          case "orders": {
            const result = await apiFetch<OrderItem[]>(`/patients/${id}/orders`);
            if (!cancelled) setOrders(result);
            break;
          }
          case "appointments": {
            const result = await apiFetch<AppointmentItem[]>(`/patients/${id}/appointments`);
            if (!cancelled) setAppointments(result);
            break;
          }
          case "documents": {
            const [result, patientOrders, patientAppointments, alerts] = await Promise.all([
              apiFetch<DocumentItem[]>(`/patients/${id}/documents`),
              apiFetch<OrderItem[]>(`/patients/${id}/orders`).catch(() => []),
              apiFetch<AppointmentItem[]>(`/patients/${id}/appointments`).catch(() => []),
              apiFetch<DocumentAlerts>(`/patients/${id}/document-alerts`).catch(() => null),
            ]);
            if (!cancelled) {
              setDocuments(result);
              setOrders(patientOrders);
              setAppointments(patientAppointments);
              setDocumentAlerts(alerts);
            }
            break;
          }
          case "contracts": {
            const result = await apiFetch<ContractItem[]>(`/patients/${id}/framework-contracts`);
            if (!cancelled) setContracts(result);
            break;
          }
          case "invoices": {
            const result = await apiFetch<InvoiceItem[]>(`/patients/${id}/invoices`);
            if (!cancelled) setInvoices(result);
            break;
          }
          case "workflow": {
            const result = await apiFetch<WorkflowChecklistResponse>(
              `/patients/${id}/workflow-checklist`
            );
            if (!cancelled) setWorkflowChecklist(result);
            break;
          }
          case "timeline": {
            const params = new URLSearchParams();
            if (timelineEntityFilter !== "all") params.set("entity_type", timelineEntityFilter);
            if (timelineCategoryFilter !== "all") params.set("category", timelineCategoryFilter);
            if (timelineSourceFilter !== "all") params.set("source", timelineSourceFilter);
            if (timelineRangeFilter !== "all") params.set("range", timelineRangeFilter);
            if (deferredTimelineSearch.trim()) params.set("search", deferredTimelineSearch.trim());
            params.set("limit", String(timelineLimit));
            params.set("offset", String(timelineOffset));
            const result = await apiFetch<{
              items: TimelineItem[];
              total: number;
              limit: number;
              offset: number;
              has_more: boolean;
            }>(`/patients/${id}/timeline?${params.toString()}`);
            if (!cancelled) {
              setTimeline(result.items ?? []);
              setTimelineTotal(result.total ?? 0);
            }
            break;
          }
          default:
            break;
        }
      } catch {
        if (cancelled) return;
        if (activeTab === "relations") setRelations([]);
        if (activeTab === "cases") setCases([]);
        if (activeTab === "orders") setOrders([]);
        if (activeTab === "appointments") setAppointments([]);
        if (activeTab === "documents") {
          setDocuments([]);
          setDocumentAlerts(null);
        }
        if (activeTab === "contracts") setContracts([]);
        if (activeTab === "invoices") setInvoices([]);
        if (activeTab === "workflow") setWorkflowChecklist(null);
        if (activeTab === "timeline") {
          setTimeline([]);
          setTimelineTotal(0);
        }
      } finally {
        if (!cancelled) setTabLoading(false);
      }
    }

    void loadTabData();

    return () => { cancelled = true; };
  }, [
    id,
    activeTab,
    tabVersion,
    deferredTimelineSearch,
    timelineCategoryFilter,
    timelineEntityFilter,
    timelineLimit,
    timelineOffset,
    timelineRangeFilter,
    timelineSourceFilter,
    canViewDocuments,
    canViewContracts,
    canViewInvoices,
    canViewOperationalSurface,
  ]);

  useEffect(() => {
    if (!invoiceManageId) {
      setDunningEvents([]);
      return;
    }
    let cancelled = false;
    apiFetch<DunningEvent[]>(`/invoices/${invoiceManageId}/dunning`)
      .then((items) => {
        if (!cancelled) setDunningEvents(items);
      })
      .catch(() => {
        if (!cancelled) setDunningEvents([]);
      });
    return () => {
      cancelled = true;
    };
  }, [invoiceManageId]);

  const handleAssign = async () => {
    if (!id || !selectedAssignee) return;
    setAssignBusy(true);
    try {
      await apiFetch(`/patients/${id}/assign`, { method: "POST", body: JSON.stringify({ user_id: selectedAssignee }) });
      setSelectedAssignee("");
      reload();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
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
      await apiFetch(`/patients/${id}/workflow-checklist`, {
        method: "POST",
        body: JSON.stringify({
          item_text: workflowForm.itemText.trim(),
          owner_user_id: toOptional(workflowForm.ownerUserId),
          priority: workflowForm.priority,
          due_date: workflowForm.dueDate
            ? new Date(workflowForm.dueDate).toISOString()
            : null,
        }),
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
      await apiFetch(`/patients/${id}/workflow-checklist/${itemId}/complete`, {
        method: "POST",
      });
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
      await apiFetch(`/patients/${id}/relations/${relationId}/delete`, {
        method: "POST",
      });
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
      await apiFetch("/framework-contracts", {
        method: "POST",
        body: JSON.stringify({
          patient_id: id,
          status: contractCreateForm.status,
          valid_from: toOptional(contractCreateForm.validFrom),
          valid_to: toOptional(contractCreateForm.validTo),
          signed_at: toOptional(contractCreateForm.signedAt)
            ? new Date(contractCreateForm.signedAt).toISOString()
            : null,
        }),
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
      await apiFetch(`/framework-contracts/${contractStatusId}/status`, {
        method: "POST",
        body: JSON.stringify({
          status: contractStatusForm.status,
          valid_from: toOptional(contractStatusForm.validFrom),
          valid_to: toOptional(contractStatusForm.validTo),
          signed_at: toOptional(contractStatusForm.signedAt)
            ? new Date(contractStatusForm.signedAt).toISOString()
            : null,
        }),
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
      await apiFetch(`/invoices/${invoiceManageId}/status`, {
        method: "POST",
        body: JSON.stringify({
          status: invoiceStatusForm.status,
          due_date: toOptional(invoiceStatusForm.dueDate),
          paid_amount: toOptional(invoiceStatusForm.paidAmount)
            ? Number(invoiceStatusForm.paidAmount)
            : null,
          notes: toOptional(invoiceStatusForm.notes),
        }),
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
      const created = await apiFetch<DunningEvent>(`/invoices/${invoiceManageId}/dunning`, {
        method: "POST",
        body: JSON.stringify({
          level: nextLevel,
          note: toOptional(dunningNote),
        }),
      });
      setDunningEvents((current) => [...current, created]);
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
      await downloadApiFile(
        `/admin/compliance/patient/${id}/export?format=zip`,
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
      const payload = await apiFetch<PatientLabelPayload>(
        `/patients/${id}/label?format=${encodeURIComponent(chosenFormat)}`
      );
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
      await apiFetch(`/patients/${id}/medical-orders/${medicalOrderId}/update`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      const result = await apiFetch<{ items: PatientMedicalOrder[] }>(`/patients/${id}/medical-orders`);
      setMedicalOrders(result.items ?? []);
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
                const path = detail.is_active ? `/patients/${id}/deactivate` : `/patients/${id}/activate`;
                try {
                  await apiFetch(path, { method: "POST" });
                } catch (error) {
                  setError(error instanceof Error ? error.message : String(error));
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
                <InfoRow label={t.patients_nationality} value={fieldVal(detail.nationality, t.common_not_set)} onEdit={canEditPatientProfile ? openProfileEditor : undefined} />
                <InfoRow label={t.patients_residence_country} value={fieldVal(detail.residence_country, t.common_not_set)} onEdit={canEditPatientProfile ? openProfileEditor : undefined} />
                <InfoRow label={t.patients_languages} value={fieldVal(detail.languages, t.common_not_set)} onEdit={canEditPatientProfile ? openProfileEditor : undefined} />
                <InfoRow label={l("Funktionale Labels", "Функциональные метки", "Functional labels")} value={fieldVal(detail.functional_labels, t.common_not_set)} onEdit={canEditPatientProfile ? openProfileEditor : undefined} />
              </div>
            </FormSection>

            <FormSection title={l("Kontakt", "Контакты", "Contact")}>
              <div className="grid gap-4 md:grid-cols-2">
                <InfoRow label={t.patients_phone_primary} value={fieldVal(detail.phone_primary, t.common_not_set)} onEdit={canEditPatientProfile ? openProfileEditor : undefined} />
                <InfoRow label={t.patients_phone_secondary} value={fieldVal(detail.phone_secondary, t.common_not_set)} onEdit={canEditPatientProfile ? openProfileEditor : undefined} />
                <InfoRow label={t.patients_email} value={fieldVal(detail.email, t.common_not_set)} onEdit={canEditPatientProfile ? openProfileEditor : undefined} />
              </div>
            </FormSection>

            <FormSection title={l("Versicherung und Kostenträger", "Страхование и плательщик", "Insurance and payer")}>
              <div className="grid gap-4 md:grid-cols-2">
                <InfoRow label={t.patients_insurance_type} value={insuranceLbl(detail.insurance_type, tr)} onEdit={canEditPatientProfile ? openProfileEditor : undefined} />
                <InfoRow label={t.patients_insurance_provider} value={fieldVal(detail.insurance_provider, t.common_not_set)} onEdit={canEditPatientProfile ? openProfileEditor : undefined} />
                <InfoRow label={t.patients_insurance_number} value={fieldVal(detail.insurance_number, t.common_not_set)} onEdit={canEditPatientProfile ? openProfileEditor : undefined} />
              </div>
            </FormSection>

          {/* Address */}
          <FormSection title={l("Adresse", "Адрес", "Address")}>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <InfoRow label={t.patients_address_street} value={fieldVal(detail.address_street, t.common_not_set)} onEdit={canEditPatientProfile ? openProfileEditor : undefined} />
              <InfoRow label={t.patients_address_city} value={fieldVal(detail.address_city, t.common_not_set)} onEdit={canEditPatientProfile ? openProfileEditor : undefined} />
              <InfoRow label={t.patients_address_zip} value={fieldVal(detail.address_zip, t.common_not_set)} onEdit={canEditPatientProfile ? openProfileEditor : undefined} />
              <InfoRow label={t.patients_address_country} value={fieldVal(detail.address_country, t.common_not_set)} onEdit={canEditPatientProfile ? openProfileEditor : undefined} />
            </div>
          </FormSection>

          {/* Emergency */}
          <FormSection title={l("Notfallkontakt", "Экстренный контакт", "Emergency contact")}>
            <div className="grid gap-4 md:grid-cols-3">
              <InfoRow label={t.patients_emergency_name} value={fieldVal(detail.emergency_contact_name, t.common_not_set)} onEdit={canEditPatientProfile ? openProfileEditor : undefined} />
              <InfoRow label={t.patients_emergency_phone} value={fieldVal(detail.emergency_contact_phone, t.common_not_set)} onEdit={canEditPatientProfile ? openProfileEditor : undefined} />
              <InfoRow label={t.patients_emergency_relation} value={fieldVal(detail.emergency_contact_relation, t.common_not_set)} onEdit={canEditPatientProfile ? openProfileEditor : undefined} />
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

        <TabsContent value="curators" className="space-y-4 mt-4 min-h-[400px]">
          <FormSection
            title={t.patients_assign_owner}
            accessory={<CountBadge>{assignments.length} {t.patients_records}</CountBadge>}
          >
            {assignments.length === 0 ? (
              <EmptyCell>{t.patients_no_assignments}</EmptyCell>
            ) : (
              <div className="space-y-2">
                {assignments.map((item) => (
                  <div
                    key={`${item.user_id}-${item.assigned_at}`}
                    className="flex items-center gap-4 rounded-xl border border-border/50 bg-card px-4 py-3"
                  >
                    <div className="flex items-center justify-center size-10 shrink-0 rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
                      {item.user_name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("")}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{item.user_name}</span>
                        <Badge className={cn("text-[10px]", ROLE_COLORS[item.user_role] ?? "bg-muted text-muted-foreground")}>
                          {roleLbl(item.user_role, tr)}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <span>{fmtDateTime(item.assigned_at)}</span>
                        <span>{t.patients_assigned_by} {item.assigned_by_name || t.common_unknown}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge
                        variant="outline"
                        className={cn(
                          "rounded-full",
                          item.revoked_at
                            ? "border-rose-200 bg-rose-50 text-rose-700"
                            : "border-emerald-200 bg-emerald-50 text-emerald-700"
                        )}
                      >
                        {item.revoked_at ? t.patients_revoked : t.common_active}
                      </Badge>
                      {canManage && !item.revoked_at && (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label={l("Zuordnung widerrufen", "Отозвать назначение", "Revoke assignment")}
                          className="rounded-lg text-muted-foreground hover:text-rose-600 hover:bg-rose-50"
                          onClick={async () => {
                            const confirmed = window.confirm(
                              l(
                                `Zuordnung für ${item.user_name} widerrufen?`,
                                `Отозвать назначение для ${item.user_name}?`,
                                `Revoke assignment for ${item.user_name}?`,
                              )
                            );
                            if (!confirmed) return;
                            await apiFetch(`/patients/${id}/revoke`, {
                              method: "POST",
                              body: JSON.stringify({ user_id: item.user_id }),
                            }).catch(() => {});
                            reload();
                          }}
                        >
                          <UserX className="size-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {canManage && (
              <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                <div className="space-y-1.5">
                  <Label
                    htmlFor="patient-curator-assign"
                    className="text-[11.5px] font-medium text-muted-foreground leading-tight"
                  >
                    {l("Verantwortliche Person", "Ответственный сотрудник", "Assigned staff member")}
                  </Label>
                  <ShadSelect value={selectedAssignee} onValueChange={(v) => setSelectedAssignee(v ?? "")}>
                    <SelectTrigger id="patient-curator-assign" className={cn("w-full", formInputClassName)}>
                      <SelectValue>
                        {selectedAssignee
                          ? (() => { const s = assignableStaff.find((i) => i.id === selectedAssignee); return s ? `${s.name} · ${roleLbl(s.role, tr)}` : selectedAssignee; })()
                          : t.patients_assign_owner}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {assignableStaff.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name} · {roleLbl(s.role, tr)}</SelectItem>
                      ))}
                    </SelectContent>
                  </ShadSelect>
                </div>
                <div className="flex items-end">
                  <Button
                    size="sm"
                    className="h-9 rounded-lg gap-1.5"
                    disabled={assignBusy || !selectedAssignee}
                    onClick={handleAssign}
                  >
                    {assignBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                    {t.patients_assign_owner}
                  </Button>
                </div>
              </div>
            )}
          </FormSection>
        </TabsContent>

        <TabsContent value="relations" className="mt-4 min-h-[400px]">
          <FormSection
            title={l("Beziehungen und Notfallkontakte", "Связи и экстренные контакты", "Relations and emergency contacts")}
            accessory={
              canManageRelations ? (
                <Button
                  type="button"
                  size="sm"
                  className="h-8 rounded-lg gap-1.5"
                  onClick={openCreateRelation}
                >
                  <Plus className="size-3.5" />
                  {l("Neue Beziehung", "Новая связь", "New relation")}
                </Button>
              ) : null
            }
          >
            {tabLoading ? (
              <TabLoader />
            ) : relations.length === 0 ? (
              <EmptyCell>{l("Noch nicht erfasst.", "Не зафиксировано.", "Not recorded yet.")}</EmptyCell>
            ) : (
              <div className="grid gap-2 md:grid-cols-2">
                {relations.map((relation) => (
                  <div key={relation.id} className="rounded-xl border border-border/50 bg-card px-4 py-3 space-y-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-foreground">{relation.related_display_name || relation.related_name}</p>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="rounded-full text-[10px]">{relationTypeLabel(relation.relation_type)}</Badge>
                        {relation.is_emergency_contact ? (
                          <Badge variant="outline" className="rounded-full bg-rose-50 border-rose-200 text-rose-700 text-[10px]">
                            {l("Notfall", "Экстренно", "Emergency")}
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                    <div className="space-y-0.5 text-sm text-muted-foreground">
                      {relation.related_patient_pid ? <p className="font-mono text-xs text-muted-foreground/80">{relation.related_patient_pid}</p> : null}
                      {relation.phone ? <p>{relation.phone}</p> : null}
                      {relation.notes ? <p className="text-foreground">{relation.notes}</p> : null}
                      <p className="text-xs text-muted-foreground/80">{fmtDateTime(relation.created_at)}</p>
                    </div>
                    {canManageRelations || relation.related_patient_id ? (
                      <div className="flex flex-wrap gap-2 pt-1">
                        {relation.related_patient_id ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 rounded-lg"
                            onClick={() => staffGo(`/patients/${relation.related_patient_id}`)}
                          >
                            {l("Patient öffnen", "Открыть пациента", "Open patient")}
                          </Button>
                        ) : null}
                        {canManageRelations ? (
                          <>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8 rounded-lg"
                              onClick={() => openEditRelation(relation)}
                            >
                              {l("Bearbeiten", "Редактировать", "Edit")}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8 rounded-lg border-rose-200 text-rose-700 hover:bg-rose-50"
                              onClick={() => void handleDeleteRelation(relation.id)}
                            >
                              {l("Löschen", "Удалить", "Delete")}
                            </Button>
                          </>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </FormSection>
        </TabsContent>

        {/* Cases tab */}
        <TabsContent value="cases" className="space-y-4 mt-4 min-h-[400px]">
          <FormSection
            title={l("Fälle", "Кейсы", "Cases")}
            accessory={<CountBadge>{cases.length}</CountBadge>}
          >
            {tabLoading ? (
              <TabLoader />
            ) : cases.length === 0 ? (
              <EmptyCell>{t.cases_no_match}</EmptyCell>
            ) : (
              <div className="grid gap-2 md:grid-cols-2">
                {cases.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCasePreviewId(c.id)}
                    className="rounded-xl border border-border/50 bg-card px-4 py-3 text-left transition-colors hover:border-border hover:bg-muted/30"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-xs text-muted-foreground">{c.case_id}</span>
                      <Badge variant="outline" className={cn("rounded-full text-[10px]", STATUS_COLORS[c.status] ?? "")}>
                        {tr[`cases_${c.status}`] ?? c.status}
                      </Badge>
                    </div>
                    <p className="mt-2 text-sm font-medium text-foreground">{c.hauptanfragegrund || t.common_not_set}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{fmtDate(c.created_at)}</p>
                  </button>
                ))}
              </div>
            )}
          </FormSection>
          <PatientCasePreviewSheet
            caseId={casePreviewId}
            open={Boolean(casePreviewId)}
            onOpenChange={(value) => { if (!value) setCasePreviewId(null); }}
          />
        </TabsContent>

        {/* Orders tab */}
        <TabsContent value="orders" className="space-y-4 mt-4 min-h-[400px]">
          <FormSection
            title={l("Aufträge", "Заказы", "Orders")}
            accessory={<CountBadge>{orders.length}</CountBadge>}
          >
            {tabLoading ? (
              <TabLoader />
            ) : orders.length === 0 ? (
              <EmptyCell>
                {l("Für diesen Patienten gibt es noch keine Aufträge.", "Для этого пациента пока нет заказов.", "No orders have been recorded for this patient yet.")}
              </EmptyCell>
            ) : (
              <div className="grid gap-2 md:grid-cols-2">
                {orders.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => staffGo(`/orders?order=${o.id}`)}
                    className="rounded-xl border border-border/50 bg-card px-4 py-3 text-left transition-colors hover:border-border hover:bg-muted/30"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-xs text-muted-foreground">{o.order_number}</span>
                      <Badge variant="outline" className={cn("rounded-full text-[10px]", STATUS_COLORS[o.status] ?? "")}>
                        {patientDetailStatusLabel(o.status)}
                      </Badge>
                    </div>
                    <p className="mt-2 text-sm font-medium text-foreground">{o.needs_description || o.order_number}</p>
                    <div className="mt-1 flex gap-2 text-xs text-muted-foreground">
                      <span>{orderPhaseLabel(o.phase)}</span>
                      <span>{fmtDate(o.created_at)}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </FormSection>
        </TabsContent>

        {/* Appointments tab */}
        <TabsContent value="appointments" className="space-y-4 mt-4 min-h-[400px]">
          <FormSection
            title={l("Termine", "Приёмы", "Appointments")}
            accessory={
              <div className="flex flex-wrap items-center gap-2">
                <CountBadge>{appointments.length}</CountBadge>
                {canManage ? (
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 rounded-lg gap-1.5"
                    onClick={() => setAppointmentSheetOpen(true)}
                  >
                    <Plus className="size-3.5" />
                    {t.appointments_new}
                  </Button>
                ) : null}
              </div>
            }
          >
            {tabLoading ? (
              <TabLoader />
            ) : appointments.length === 0 ? (
              <EmptyCell>
                {l("Für diesen Patienten sind noch keine Termine geplant.", "Для этого пациента пока нет приёмов.", "No appointments are scheduled for this patient yet.")}
              </EmptyCell>
            ) : (
              <div className="grid gap-2 md:grid-cols-2">
                {appointments.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => staffGo(`/appointments?appointment=${a.id}`)}
                    className="rounded-xl border border-border/50 bg-card px-4 py-3 text-left transition-colors hover:border-border hover:bg-muted/30"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-muted-foreground">{appointmentTypeLabel(a.apt_type)}</span>
                        <Badge variant="outline" className="rounded-full text-[10px] border-violet-200 bg-violet-50 text-violet-700">
                          {appointmentCarePathKindLabel(a.care_path_kind)}
                        </Badge>
                      </div>
                      <Badge variant="outline" className={cn("rounded-full text-[10px]", STATUS_COLORS[a.status] ?? "")}>
                        {patientDetailStatusLabel(a.status)}
                      </Badge>
                    </div>
                    <p className="mt-2 text-sm font-medium text-foreground">{a.title}</p>
                    <div className="mt-1 flex gap-2 text-xs text-muted-foreground">
                      <span>{fmtDate(a.date)}</span>
                      {a.time_start && <span>{a.time_start}</span>}
                      {a.provider_name && <span>· {a.provider_name}</span>}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </FormSection>
          {id && canManage ? (
            <PatientAppointmentSheet
              patientId={id}
              open={appointmentSheetOpen}
              onOpenChange={setAppointmentSheetOpen}
              onSaved={reload}
            />
          ) : null}
        </TabsContent>

        {/* Documents tab */}
        <TabsContent value="documents" className="space-y-4 mt-4 min-h-[400px]">
          <WorkspaceSectionIntro
            title={l("Dokumenten-Cockpit", "Панель документов", "Documents cockpit")}
            description={l(
              "Pflichtdokumente, Uploads und Sichtbarkeit für diesen Patienten in einer eigenen Dokumentenzone.",
              "Обязательные документы, загрузки и видимость по этому пациенту в отдельной зоне документов.",
              "Required documents, uploads and visibility for this patient in a dedicated document zone.",
            )}
            accessory={<CountBadge>{filteredDocuments.length}</CountBadge>}
          />

          <FormSection
            title={l("Überblick", "Обзор", "Overview")}
            accessory={<CountBadge>{documents.length} {l("Dateien", "файлов", "files")}</CountBadge>}
          >
            <div className="grid gap-3 md:grid-cols-3">
              <StatCard
                label={l("Dokumente gesamt", "Всего документов", "Total documents")}
                value={documents.length}
                description={l(
                  "Alle Dateien, die direkt mit diesem Patienten verknüpft sind.",
                  "Все файлы, напрямую связанные с этим пациентом.",
                  "All files linked directly to this patient.",
                )}
              />
              <StatCard
                label={l("Pflichtdokumente erfüllt", "Обязательные документы выполнены", "Required docs fulfilled")}
                value={
                  documentAlerts?.configured_rule_count
                    ? `${requiredDocumentFulfilledCount}/${documentAlerts.configured_rule_count}`
                    : requiredDocumentFulfilledCount
                }
                description={l(
                  "Abdeckung des minimalen Dokumentenpakets für Aufnahme und Compliance.",
                  "Покрытие минимального пакета документов для intake и compliance.",
                  "Coverage of the minimum document pack for intake and compliance.",
                )}
              />
              <StatCard
                label={l("Dokumentarten", "Типы документов", "Document types")}
                value={documentCategoryOptions.length}
                description={l(
                  "Wie viele Kategorien aktuell im Profil dieses Patienten vorkommen.",
                  "Сколько категорий документов сейчас присутствует в профиле пациента.",
                  "How many document categories currently appear in this patient profile.",
                )}
              />
            </div>
          </FormSection>

          {!tabLoading && documentAlerts && documentAlerts.configured_rule_count > 0 ? (
            <div
              className={cn(
                "rounded-xl border px-4 py-3",
                documentAlerts.document_pack_complete
                  ? "border-emerald-200 bg-emerald-50/70"
                  : "border-amber-200 bg-amber-50/70"
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h4 className="text-sm font-semibold text-foreground">
                    {documentAlerts.document_pack_complete
                      ? l("Das minimale Dokumentenpaket ist vollständig", "Минимальный пакет документов собран", "Minimum document pack is complete")
                      : l(
                          `${documentAlerts.missing_count} erforderliche Dokument${documentAlerts.missing_count === 1 ? "" : "e"} fehlen`,
                          `Не хватает обязательных документов: ${documentAlerts.missing_count}`,
                          `${documentAlerts.missing_count} required document${documentAlerts.missing_count === 1 ? "" : "s"} missing`,
                        )}
                  </h4>
                </div>
                <Badge
                  variant="outline"
                  className={cn(
                    "rounded-full text-[10px]",
                    documentAlerts.document_pack_complete
                      ? "border-emerald-200 bg-emerald-100 text-emerald-800"
                      : "border-amber-200 bg-amber-100 text-amber-800"
                  )}
                >
                  {documentAlerts.required_documents.filter((item) => item.fulfilled).length}/
                  {documentAlerts.configured_rule_count} {l("erfüllt", "выполнено", "fulfilled")}
                </Badge>
              </div>
              {documentAlerts.missing_count > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {documentAlerts.missing_documents.map((item) => (
                    <Badge
                      key={item.key}
                      variant="outline"
                      className="rounded-full border-amber-300 bg-card text-amber-800"
                    >
                      {localizeRequiredDocumentLabel(item.key, item.label, l)}
                    </Badge>
                  ))}
                </div>
              ) : null}
              {documentAlerts.out_of_sync ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  {l(
                    "Das gespeicherte Compliance-Flag für „Dokumentenpaket vollständig“ stimmt nicht mit dem aktuellen Dokumentbestand überein.",
                    "Сохранённый флаг compliance для «пакет документов собран» не совпадает с текущим составом документов.",
                    "The stored compliance flag for “Document pack complete” is not aligned with the current document inventory.",
                  )}
                </p>
              ) : null}
            </div>
          ) : null}

          <FormSection
            title={l("Dokumente zu diesem Patienten", "Документы этого пациента", "Documents linked to this patient")}
            accessory={
              <div className="flex flex-wrap items-center gap-2">
                <CountBadge>{documents.length}</CountBadge>
                {canManageDocuments ? (
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 rounded-lg gap-1.5"
                    onClick={() => setDocumentUploadOpen(true)}
                  >
                    <Plus className="size-3.5" />
                    {l("Dokument hochladen", "Загрузить документ", "Upload document")}
                  </Button>
                ) : null}
              </div>
            }
          >
            {documents.length > 0 ? (
              <FormSection
                title={l("Filter", "Фильтры", "Filters")}
                accessory={
                  hasDocumentFilters ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 rounded-lg"
                      onClick={() => {
                        setDocumentStatusFilter("all");
                        setDocumentCategoryFilter("all");
                      }}
                    >
                      {l("Filter zurücksetzen", "Сбросить фильтры", "Reset filters")}
                    </Button>
                  ) : null
                }
              >
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={documentStatusFilter === "all" ? "default" : "outline"}
                    className="h-8 rounded-full"
                    onClick={() => setDocumentStatusFilter("all")}
                  >
                    {l("Alle Status", "Все статусы", "All statuses")} · {documents.length}
                  </Button>
                  {documentStatusOptions.map((status) => {
                    const count = documents.filter((item) => (item.status ?? "") === status).length;
                    return (
                      <Button
                        key={status}
                        type="button"
                        size="sm"
                        variant={documentStatusFilter === status ? "default" : "outline"}
                        className="h-8 rounded-full"
                        onClick={() => setDocumentStatusFilter(status)}
                      >
                        {patientDetailStatusLabel(status)} · {count}
                      </Button>
                    );
                  })}
                </div>
                <div className="grid gap-3 md:grid-cols-[minmax(0,260px)_auto]">
                  <ShadSelect value={documentCategoryFilter} onValueChange={(value) => setDocumentCategoryFilter(value ?? "all")}>
                    <SelectTrigger className={cn("w-full", formInputClassName)}>
                      <SelectValue>
                        {documentCategoryFilter === "all"
                          ? l("Alle Dokumentarten", "Все типы документов", "All document types")
                          : localizeDocumentCode(documentCategoryFilter, l)}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{l("Alle Dokumentarten", "Все типы документов", "All document types")}</SelectItem>
                      {documentCategoryOptions.map((category) => (
                        <SelectItem key={category} value={category}>
                          {localizeDocumentCode(category, l)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </ShadSelect>
                  <div className="flex items-center text-xs text-muted-foreground">
                    {l("Angezeigt", "Показано", "Showing")} {filteredDocuments.length} {l("von", "из", "of")} {documents.length}
                  </div>
                </div>
              </FormSection>
            ) : null}

            {tabLoading ? (
              <TabLoader />
            ) : documents.length === 0 ? (
              <EmptyCell>
                {l("Zu diesem Patienten wurden noch keine Dokumente hochgeladen.", "Для этого пациента пока не загружены документы.", "No documents have been uploaded for this patient yet.")}
              </EmptyCell>
            ) : filteredDocuments.length === 0 ? (
              <EmptyCell>
                {l("Kein Dokument entspricht den aktuellen Filtern.", "Текущим фильтрам не соответствует ни один документ.", "No document matches the current filters.")}
              </EmptyCell>
            ) : (
              <>
                <div className="space-y-2 md:hidden">
                  {filteredDocuments.map((doc) => (
                    <a
                      key={doc.id}
                      href={buildApiUrl(`/documents/${doc.id}/download`)}
                      target="_blank"
                      rel="noreferrer"
                      className="block rounded-xl border border-border/50 bg-card px-4 py-3 transition-colors hover:border-border hover:bg-muted/30"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">{doc.filename}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{doc.category ? localizeDocumentCode(doc.category, l) : t.common_not_set}</p>
                        </div>
                        <Badge variant="outline" className={cn("shrink-0 rounded-full text-[10px]", STATUS_COLORS[doc.status ?? ""] ?? "border-border/60 bg-muted/25 text-muted-foreground")}>
                          {doc.status ? patientDetailStatusLabel(doc.status) : t.common_not_set}
                        </Badge>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <span>{doc.uploaded_by_name ?? t.common_unknown}</span>
                        <span>· {fmtDate(doc.created_at)}</span>
                      </div>
                    </a>
                  ))}
                </div>
                <div className="hidden overflow-hidden rounded-xl border border-border/50 bg-card md:block">
                  <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-3 border-b border-border/60 bg-muted/40 px-4 py-2.5">
                    {[t.documents_filename, t.appointments_type, t.users_status, t.patients_assigned_by, t.users_created].map((h) => (
                      <span key={h} className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{h}</span>
                    ))}
                  </div>
                  {filteredDocuments.map((doc, idx) => (
                    <a
                      key={doc.id}
                      href={buildApiUrl(`/documents/${doc.id}/download`)}
                      target="_blank"
                      rel="noreferrer"
                      className={cn(
                        "grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-3 items-center px-4 py-2.5 transition-colors hover:bg-muted/40",
                        idx < filteredDocuments.length - 1 && "border-b border-border/40"
                      )}
                    >
                      <span className="min-w-0 truncate text-sm font-medium text-foreground">{doc.filename}</span>
                      <span className="text-xs text-muted-foreground">{doc.category ? localizeDocumentCode(doc.category, l) : t.common_not_set}</span>
                      <Badge variant="outline" className={cn("rounded-full text-[10px] w-fit", STATUS_COLORS[doc.status ?? ""] ?? "border-border/60 bg-muted/25 text-muted-foreground")}>
                        {doc.status ? patientDetailStatusLabel(doc.status) : t.common_not_set}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{doc.uploaded_by_name ?? t.common_unknown}</span>
                      <span className="text-xs text-muted-foreground/80">{fmtDate(doc.created_at)}</span>
                    </a>
                  ))}
                </div>
              </>
            )}
          </FormSection>
        </TabsContent>

        {canViewContracts ? <TabsContent value="contracts" className="space-y-4 mt-4 min-h-[400px]">
          <WorkspaceSectionIntro
            title={l("Vertrags-Cockpit", "Панель договоров", "Contracts cockpit")}
            description={l(
              "Lifecycle, Gültigkeit und unmittelbare Pflege von Verträgen, ohne das Patientenprofil zu verlassen.",
              "Жизненный цикл, сроки действия и быстрое управление договорами без выхода из профиля пациента.",
              "Lifecycle, validity and direct contract management without leaving the patient profile.",
            )}
            accessory={<CountBadge>{contracts.length}</CountBadge>}
          />

          <FormSection
            title={l("Portfolio-Überblick", "Обзор портфеля", "Portfolio overview")}
            accessory={<CountBadge>{contracts.length} {l("Verträge", "договоров", "contracts")}</CountBadge>}
          >
            <div className="grid gap-3 md:grid-cols-3">
              <StatCard
                label={l("Aktiv oder unterzeichnet", "Активные или подписанные", "Active or signed")}
                value={contractSignedCount}
                description={l(
                  "Verträge, die bereits wirksam sind oder unterzeichnet wurden.",
                  "Договоры, которые уже вступили в силу или были подписаны.",
                  "Contracts that are already effective or have been signed.",
                )}
              />
              <StatCard
                label={l("In Vorbereitung", "В подготовке", "In preparation")}
                value={contractPendingCount}
                description={l(
                  "Entwürfe oder versandte Verträge, die noch nicht finalisiert wurden.",
                  "Черновики или отправленные договоры, которые ещё не финализированы.",
                  "Draft or sent contracts that still need to be finalized.",
                )}
              />
              <StatCard
                label={l("Laufen bald ab", "Скоро истекают", "Expiring soon")}
                value={contractExpiringSoonCount}
                description={l(
                  "Verträge mit Enddatum innerhalb der nächsten 30 Tage.",
                  "Договоры, у которых срок действия заканчивается в ближайшие 30 дней.",
                  "Contracts with an end date in the next 30 days.",
                )}
              />
            </div>
          </FormSection>

          <FormSection
            title={l("Verträge dieses Patienten", "Договоры этого пациента", "Contracts for this patient")}
            accessory={
              <div className="flex flex-wrap items-center gap-2">
                <CountBadge>{contracts.length}</CountBadge>
                {canManageContracts ? (
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 rounded-lg gap-1.5"
                    onClick={() => setContractCreateOpen(true)}
                  >
                    <Plus className="size-3.5" />
                    {l("Neuer Vertrag", "Новый договор", "New contract")}
                  </Button>
                ) : null}
              </div>
            }
          >
            {tabLoading ? (
              <TabLoader />
            ) : contracts.length === 0 ? (
              <EmptyCell>{l("Für diesen Patienten wurde noch kein Vertrag angelegt.", "Для этого пациента пока не создано ни одного договора.", "No contract has been created for this patient yet.")}</EmptyCell>
            ) : (
              <div className="grid gap-2 md:grid-cols-2">
                {contracts.map((contract) => (
                  <div
                    key={contract.id}
                    className="rounded-xl border border-border/50 bg-card px-4 py-3 space-y-2.5"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-xs text-muted-foreground">{contract.contract_number}</span>
                      <Badge variant="outline" className={cn("rounded-full text-[10px]", STATUS_COLORS[contract.status] ?? "")}>
                        {patientDetailStatusLabel(contract.status)}
                      </Badge>
                    </div>
                    <div className="grid gap-1 text-sm text-muted-foreground">
                      <p>{l("Unterzeichnet", "Подписано", "Signed")}: {fmtDateTime(contract.signed_at, t.common_not_set)}</p>
                      <p>{l("Gültig ab", "Действует с", "Valid from")}: {fmtDate(contract.valid_from, t.common_not_set)}</p>
                      <p>{l("Gültig bis", "Действует до", "Valid to")}: {fmtDate(contract.valid_to, t.common_not_set)}</p>
                    </div>
                    {contract.valid_to ? (
                      <Badge
                        variant="outline"
                        className={cn(
                          "rounded-full text-[10px] w-fit",
                          isContractExpiringSoon(contract)
                            ? "border-amber-200 bg-amber-50 text-amber-700"
                            : "border-border/60 bg-muted/25 text-muted-foreground"
                        )}
                      >
                        {isContractExpiringSoon(contract)
                          ? l("Läuft bald ab", "Скоро истекает", "Expiring soon")
                          : l("Gültigkeitsfenster gesetzt", "Срок действия задан", "Validity window set")}
                      </Badge>
                    ) : null}
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-lg"
                        onClick={() => staffGo(`/contracts?contract=${contract.id}`)}
                      >
                        {l("Öffnen", "Открыть", "Open")}
                      </Button>
                      {canManageContracts ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 rounded-lg"
                          onClick={() => openContractStatusEditor(contract)}
                        >
                          {l("Status aktualisieren", "Обновить статус", "Update status")}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </FormSection>
        </TabsContent> : null}

        {canViewInvoices ? <TabsContent value="invoices" className="space-y-4 mt-4 min-h-[400px]">
          <WorkspaceSectionIntro
            title={l("Billing-Cockpit", "Панель биллинга", "Billing cockpit")}
            description={l(
              "Zahlungsstatus, offene Beträge und Eskalation direkt im Kontext des Patienten.",
              "Статусы оплат, открытые суммы и эскалация прямо в контексте пациента.",
              "Payment status, outstanding balances and escalation directly in patient context.",
            )}
            accessory={<CountBadge>{invoices.length}</CountBadge>}
          />

          <FormSection
            title={l("Finanzüberblick", "Финансовый обзор", "Financial overview")}
            accessory={<CountBadge>{invoices.length} {l("Rechnungen", "счетов", "invoices")}</CountBadge>}
          >
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label={l("Offene Rechnungen", "Открытые счета", "Open invoices")}
                value={invoiceOpenCount}
                description={l(
                  "Rechnungen mit verbleibendem Saldo.",
                  "Счета, по которым ещё остаётся остаток.",
                  "Invoices with a remaining balance.",
                )}
              />
              <StatCard
                label={l("Überfällig", "Просрочено", "Overdue")}
                value={invoiceOverdueCount}
                description={l(
                  "Rechnungen, die sofortige Nachverfolgung erfordern.",
                  "Счета, требующие немедленного follow-up.",
                  "Invoices that require immediate follow-up.",
                )}
              />
              <StatCard
                label={l("Offener Betrag", "Открытая сумма", "Outstanding amount")}
                value={fmtMoney(String(invoiceOutstandingAmount))}
                description={l(
                  "Noch nicht bezahlte Gesamtsumme in diesem Patientenprofil.",
                  "Общая сумма, которая ещё не оплачена по этому профилю пациента.",
                  "Total amount still unpaid in this patient profile.",
                )}
              />
              <StatCard
                label={l("Bezahlt", "Оплачено", "Paid")}
                value={fmtMoney(String(invoicePaidAmountTotal))}
                description={l(
                  "Bereits vereinnahmter Betrag über alle Rechnungen.",
                  "Сумма, уже оплаченная по всем счетам.",
                  "Amount already collected across all invoices.",
                )}
              />
            </div>
          </FormSection>

          <FormSection
            title={l("Rechnungen und Zahlungsnachverfolgung", "Счета и контроль оплат", "Invoices and payment follow-up")}
            accessory={<CountBadge>{invoices.length}</CountBadge>}
          >
            {tabLoading ? (
              <TabLoader />
            ) : invoices.length === 0 ? (
              <EmptyCell>
                {l("Für diesen Patienten wurden noch keine Rechnungen erstellt.", "Для этого пациента пока не создано ни одного счёта.", "No invoices have been issued for this patient yet.")}
              </EmptyCell>
            ) : (
              <div className="space-y-2">
                {invoices.map((invoice) => (
                  <div
                    key={invoice.id}
                    className="rounded-xl border border-border/50 bg-card px-4 py-3 space-y-2.5"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">{invoice.invoice_number}</span>
                        <Badge variant="outline" className={cn("rounded-full text-[10px]", STATUS_COLORS[invoice.status] ?? "")}>
                          {patientDetailStatusLabel(invoice.status)}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground/80">{fmtDateTime(invoice.issued_at)}</p>
                    </div>
                    <div className="grid gap-1 md:grid-cols-2 xl:grid-cols-4 text-sm text-muted-foreground">
                      <p>{l("Typ", "Тип", "Type")}: {invoiceTypeLabel(invoice.invoice_type)}</p>
                      <p>{l("Gesamt", "Итого", "Total")}: {fmtMoney(invoice.total_gross)}</p>
                      <p>{l("Bezahlt", "Оплачено", "Paid")}: {fmtMoney(invoice.paid_amount)}</p>
                      <p>{l("Offen", "Остаток", "Open")}: {fmtMoney(invoice.balance_due)}</p>
                      <p>{l("Fällig", "Срок", "Due")}: {fmtDate(invoice.due_date, t.common_not_set)}</p>
                      <p>{l("Auftrag", "Заказ", "Order")}: {invoice.order_number ?? t.common_not_set}</p>
                      <p>{l("Angebot", "Смета", "Quote")}: {invoice.quote_number ?? t.common_not_set}</p>
                    </div>
                    {moneyValueNumber(invoice.balance_due) > 0 ? (
                      <Badge
                        variant="outline"
                        className={cn(
                          "rounded-full text-[10px] w-fit",
                          invoice.status === "overdue"
                            ? "border-rose-200 bg-rose-50 text-rose-700"
                            : "border-amber-200 bg-amber-50 text-amber-700"
                        )}
                      >
                        {invoice.status === "overdue"
                          ? l("Sofort nachverfolgen", "Требует срочного follow-up", "Needs urgent follow-up")
                          : l("Saldo offen", "Есть остаток", "Balance outstanding")}
                      </Badge>
                    ) : null}
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-lg"
                        onClick={() => staffGo(`/invoices?invoice=${invoice.id}`)}
                      >
                        {l("Öffnen", "Открыть", "Open")}
                      </Button>
                      {canManageInvoices ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 rounded-lg"
                          onClick={() => openInvoiceManager(invoice)}
                        >
                          {l("Billing verwalten", "Управлять биллингом", "Manage billing")}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </FormSection>
        </TabsContent> : null}

        <TabsContent value="workflow" className="space-y-6 mt-4 min-h-[400px]">
          {tabLoading ? (
            <TabLoader />
          ) : (
            <>
              <WorkspaceSectionIntro
                title={l("Workflow-Cockpit", "Панель workflow", "Workflow cockpit")}
                description={l(
                  "Operative Nachverfolgung, Eigentümerschaft und patientenbezogene To-dos in einer eigenen Oberfläche.",
                  "Операционное сопровождение, зоны ответственности и задачи по пациенту в отдельной рабочей зоне.",
                  "Operational follow-through, ownership and patient-bound tasks in a dedicated workspace.",
                )}
                accessory={<CountBadge>{workflowItemCount}</CountBadge>}
              />

              {!workflowChecklist || workflowChecklist.items.length === 0 ? (
                <EmptyCell>{l("Noch keine Workflow-Checkliste für diesen Patienten.", "Чек-лист workflow для этого пациента ещё пуст.", "No patient workflow checklist yet.")}</EmptyCell>
              ) : (
                <>
                  <FormSection
                    title={l("Operativer Überblick", "Операционный обзор", "Operational overview")}
                    accessory={<CountBadge>{workflowChecklistGroups.length} {l("Gruppen", "групп", "groups")}</CountBadge>}
                  >
                    <div className="grid gap-3 md:grid-cols-3">
                      <StatCard
                        label={l("Offene Punkte", "Открытые пункты", "Open items")}
                        value={workflowChecklist.open_count}
                        description={l("Aktive patientenbezogene Workflow-Aufgaben.", "Активные рабочие задачи по пациенту.", "Live patient-bound workflow tasks.")}
                      />
                      <StatCard
                        label={l("Abgeschlossen", "Завершено", "Completed")}
                        value={workflowChecklist.completed_count}
                        description={l("Bereits erledigte Checklistenpunkte.", "Уже закрытые пункты чек-листа.", "Checklist steps already closed.")}
                      />
                      <StatCard
                        label={l("Gruppen", "Группы", "Groups")}
                        value={workflowChecklistGroups.length}
                        description={l("Patientenaufnahme plus eigene Workstreams.", "Приём пациента плюс пользовательские workstreams.", "Patient intake plus custom workstreams.")}
                      />
                    </div>
                  </FormSection>

                  <WorkspaceSectionIntro
                    title={l("Live-Checkliste", "Живой чек-лист", "Live checklist")}
                    description={l(
                      "Alle aktiven und erledigten Punkte, gruppiert nach Intake- und operativen Workstreams.",
                      "Все активные и завершённые пункты, сгруппированные по этапу intake и операционным потокам.",
                      "All active and completed items grouped by intake and operational streams.",
                    )}
                  />

                  {workflowChecklistGroups.map((group) => (
                    <FormSection
                      key={group.key}
                      title={
                        <span>
                          {group.label}
                          <span className="ml-2 text-muted-foreground font-normal">
                            · {group.items.filter((item) => !item.is_completed).length} {l("offen", "открыто", "open")} / {group.items.length} {l("gesamt", "всего", "total")}
                          </span>
                        </span>
                      }
                      accessory={<CountBadge>{group.items.length} {l("Einträge", "записей", "items")}</CountBadge>}
                    >
                      <div className="space-y-2">
                        {group.items.map((item) => (
                          <div
                            key={item.id}
                            className={cn(
                              "rounded-xl border px-4 py-3",
                              item.is_completed
                                ? "border-emerald-200 bg-emerald-50/60"
                                : "border-border/50 bg-card"
                            )}
                          >
                            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="text-sm font-medium text-foreground">
                                    {localizeWorkflowItemText(item.item_key, item.item_text, l)}
                                  </p>
                                  <Badge
                                    variant="outline"
                                    className={cn(
                                      "rounded-full text-[10px]",
                                      priorityBadgeClass(item.priority)
                                    )}
                                  >
                                    {priorityLabel(item.priority)}
                                  </Badge>
                                  <Badge
                                    variant="outline"
                                    className={cn(
                                      "rounded-full text-[10px]",
                                      item.is_completed
                                        ? "border-emerald-200 bg-emerald-100 text-emerald-800"
                                        : STATUS_COLORS[item.linked_task_status ?? "open"] ??
                                            "border-border/60 bg-muted/25 text-muted-foreground"
                                    )}
                                  >
                                    {item.is_completed
                                      ? patientDetailStatusLabel("completed")
                                      : patientDetailStatusLabel(item.linked_task_status ?? "open")}
                                  </Badge>
                                </div>
                                <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                                  <span>
                                    {l("Verantwortlich", "Ответственный", "Owner")}:{" "}
                                    {item.owner_name
                                      ? `${item.owner_name} · ${roleLbl(
                                          item.owner_user_role ?? item.owner_role,
                                          tr
                                        )}`
                                      : roleLbl(item.owner_role, tr)}
                                  </span>
                                  <span>
                                    {l("Fällig", "Срок", "Due")}: {fmtDateTime(item.due_date, t.common_not_set)}
                                  </span>
                                  <span>
                                    {l("Erstellt", "Создано", "Created")}: {fmtDateTime(item.created_at, t.common_not_set)}
                                  </span>
                                  {item.completed_at ? (
                                    <span>
                                      {l("Abgeschlossen", "Завершено", "Completed")}: {fmtDateTime(item.completed_at, t.common_not_set)}
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                              {!item.is_completed ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-8 rounded-lg"
                                  disabled={workflowBusy}
                                  onClick={() => void handleCompleteWorkflowItem(item.id)}
                                >
                                  {l("Abschließen", "Завершить", "Complete")}
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    </FormSection>
                  ))}
                </>
              )}

              {canManageWorkflowChecklist ? (
                <>
                  <WorkspaceSectionIntro
                    title={l("Manuelles Workflow-Element", "Ручной элемент workflow", "Manual workflow item")}
                    description={l(
                      "Ergänze einen operativen Schritt, wenn der Standard-Workflow für diesen Patienten nicht ausreicht.",
                      "Добавь ручной операционный шаг, если стандартного workflow для этого пациента недостаточно.",
                      "Add an operational step when the default workflow is not enough for this patient.",
                    )}
                  />

                  <form onSubmit={handleAddWorkflowItem}>
                    <FormSection
                      title={l("Workflow-Element hinzufügen", "Добавить элемент процесса", "Add workflow item")}
                    >
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-1.5 md:col-span-2">
                          <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight" htmlFor="patient-workflow-item-text">{l("Checklistenpunkt", "Пункт чеклиста", "Checklist item")}</Label>
                          <Input
                            id="patient-workflow-item-text"
                            value={workflowForm.itemText}
                            onChange={(event) =>
                              setWorkflowForm((current) => ({
                                ...current,
                                itemText: event.target.value,
                              }))
                            }
                            className={formInputClassName}
                            placeholder={l(
                              "Nachverfolgung, PM-Anruf, Concierge-Handoff dokumentieren...",
                              "Документируйте follow-up, звонок PM, передачу concierge...",
                              "Document follow-up, PM call, concierge handoff...",
                            )}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight" htmlFor="patient-workflow-owner">{l("Verantwortlich", "Ответственный", "Owner")}</Label>
                          <ShadSelect
                            value={workflowForm.ownerUserId}
                            onValueChange={(v) =>
                              setWorkflowForm((current) => ({
                                ...current,
                                ownerUserId: v ?? "",
                              }))
                            }
                          >
                            <SelectTrigger id="patient-workflow-owner" className={cn("w-full", formInputClassName)}>
                              <SelectValue>
                                {workflowForm.ownerUserId
                                  ? (() => {
                                      const owner = activeWorkflowAssignees.find((it) => it.user_id === workflowForm.ownerUserId);
                                      return owner ? `${owner.user_name} · ${roleLbl(owner.user_role, tr)}` : workflowForm.ownerUserId;
                                    })()
                                  : l("Aktueller Benutzer", "Текущий пользователь", "Current user")}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="">{l("Aktueller Benutzer", "Текущий пользователь", "Current user")}</SelectItem>
                              {activeWorkflowAssignees.map((item) => (
                                <SelectItem key={item.user_id} value={item.user_id}>
                                  {item.user_name} · {roleLbl(item.user_role, tr)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </ShadSelect>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight" htmlFor="patient-workflow-priority">{l("Priorität", "Приоритет", "Priority")}</Label>
                          <ShadSelect
                            value={workflowForm.priority}
                            onValueChange={(v) =>
                              setWorkflowForm((current) => ({
                                ...current,
                                priority: v ?? current.priority,
                              }))
                            }
                          >
                            <SelectTrigger id="patient-workflow-priority" className={cn("w-full", formInputClassName)}>
                              <SelectValue>{priorityLabel(workflowForm.priority)}</SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {["low", "normal", "high", "urgent"].map((priority) => (
                                <SelectItem key={priority} value={priority}>
                                  {priorityLabel(priority)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </ShadSelect>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight" htmlFor="patient-workflow-due">{l("Fällig am", "Срок до", "Due at")}</Label>
                          <Input
                            id="patient-workflow-due"
                            type="datetime-local"
                            value={workflowForm.dueDate}
                            onChange={(event) =>
                              setWorkflowForm((current) => ({
                                ...current,
                                dueDate: event.target.value,
                              }))
                            }
                            className={formInputClassName}
                          />
                        </div>
                      </div>
                      <div className="flex justify-end">
                        <Button
                          type="submit"
                          size="sm"
                          className="h-9 rounded-lg gap-1.5"
                          disabled={workflowBusy || !workflowForm.itemText.trim()}
                        >
                          {workflowBusy ? (
                            <LoaderCircle className="size-4 animate-spin" />
                          ) : null}
                          {l("Workflow-Element hinzufügen", "Добавить элемент процесса", "Add workflow item")}
                        </Button>
                      </div>
                    </FormSection>
                  </form>
                </>
              ) : null}
            </>
          )}
        </TabsContent>

        <TabsContent value="timeline" className="space-y-4 mt-4 min-h-[400px]">
          {tabLoading ? (
            <TabLoader />
          ) : timeline.length === 0 ? (
            <EmptyCell>
              {l("Für diesen Patienten wurden noch keine Timeline-Ereignisse erfasst.", "Для этого пациента пока не зарегистрировано событий таймлайна.", "No timeline events have been recorded for this patient yet.")}
            </EmptyCell>
          ) : (
            <>
              <WorkspaceSectionIntro
                title={l("Timeline-Cockpit", "Панель таймлайна", "Timeline cockpit")}
                description={l(
                  "Alle patientenbezogenen Ereignisse mit URL-synchronisierten Filtern für Navigation, Back/Forward und Deep Links.",
                  "Все события по пациенту с фильтрами, синхронизированными с URL, для навигации, back/forward и deep-link.",
                  "All patient events with URL-synced filters for navigation, back/forward and deep links.",
                )}
                accessory={<CountBadge>{filteredTimeline.length}</CountBadge>}
              />

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  label={l("Ereignisse gesamt", "Всего событий", "Total events")}
                  value={timelineSummary.total}
                  description={l("Alle erfassten Touchpoints im Patienten-Workflow.", "Все зафиксированные точки касания в процессе ведения пациента.", "All recorded patient workflow touchpoints.")}
                />
                <StatCard
                  label={l("Offene Punkte", "Открытые пункты", "Open items")}
                  value={timelineSummary.open}
                  description={l("Ereignisse, die noch operative Nachverfolgung erfordern.", "События, которые ещё требуют операционного сопровождения.", "Events that still require operational follow-through.")}
                />
                <StatCard
                  label={l("Letzte 30 Tage", "Последние 30 дней", "Last 30 days")}
                  value={timelineSummary.recent}
                  description={l("Aktuelle Bewegung über Behandlung, Billing und Dokumente.", "Недавняя активность по лечению, счетам и документам.", "Recent movement across care, billing and documents.")}
                />
                <StatCard
                  label={l("Aktive Bereiche", "Активные направления", "Domains active")}
                  value={timelineSummary.entityCounts.length}
                  description={l("Eindeutige Workstreams, die diesen Patienten bereits berühren.", "Уникальные направления работы, уже затрагивающие этого пациента.", "Unique workstreams already touching this patient.")}
                />
              </div>

              <FormSection
                title={l("Timeline-Filter", "Фильтры таймлайна", "Timeline filters")}
                accessory={<CountBadge>{filteredTimeline.length} {l("Treffer", "совпадений", "matches")}</CountBadge>}
              >
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant={timelineEntityFilter === "all" ? "default" : "outline"}
                    className="h-6 rounded-full px-2.5 text-[11px]"
                    onClick={() => {
                      setTimelineEntityFilter("all");
                      setTimelineOffset(0);
                    }}
                  >
                    {l("Alle", "Все", "All")}
                    <span className="text-muted-foreground/60 text-[6px] leading-none align-middle">●</span>
                    {timelineTotal}
                  </Button>
                  {timelineSummary.entityCounts.map((entry) => (
                    <Button
                      key={entry.entityType}
                      type="button"
                      size="sm"
                      variant={timelineEntityFilter === entry.entityType ? "default" : "outline"}
                      className="h-6 rounded-full px-2.5 text-[11px]"
                      onClick={() => {
                        setTimelineEntityFilter(entry.entityType);
                        setTimelineOffset(0);
                      }}
                    >
                      {localizeTimelineEntityType(entry.entityType, l)}
                      <span className="text-muted-foreground/60 text-[6px] leading-none align-middle">●</span>
                      {entry.count}
                    </Button>
                  ))}
                </div>
                <div className="grid gap-3 lg:grid-cols-[180px_220px_240px_minmax(0,1fr)_auto]">
                  <ShadSelect value={timelineRangeFilter} onValueChange={(value) => {
                    setTimelineRangeFilter((value as PatientTimelineRangeFilter) ?? "all");
                    setTimelineOffset(0);
                  }}>
                    <SelectTrigger className={cn("w-full", formInputClassName)}>
                      <SelectValue>
                        {localizedTimelineRangeOptions.find((o) => o.value === timelineRangeFilter)?.label ?? ""}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {localizedTimelineRangeOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </ShadSelect>
                  <ShadSelect value={timelineCategoryFilter} onValueChange={(value) => {
                    setTimelineCategoryFilter(value ?? "all");
                    setTimelineOffset(0);
                  }}>
                    <SelectTrigger className={cn("w-full", formInputClassName)}>
                      <SelectValue>
                        {timelineCategoryFilter === "all"
                          ? l("Alle Kategorien", "Все категории", "All categories")
                          : localizeTimelineCategory(timelineCategoryFilter, l)}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{l("Alle Kategorien", "Все категории", "All categories")}</SelectItem>
                      {timelineCategoryOptions.map((category) => (
                        <SelectItem key={category} value={category}>
                          {localizeTimelineCategory(category, l)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </ShadSelect>
                  <ShadSelect value={timelineSourceFilter} onValueChange={(value) => {
                    setTimelineSourceFilter(value ?? "all");
                    setTimelineOffset(0);
                  }}>
                    <SelectTrigger className={cn("w-full", formInputClassName)}>
                      <SelectValue>
                        {timelineSourceFilter === "all"
                          ? l("Alle Quellen", "Все источники", "All sources")
                          : localizeTimelineSource(timelineSourceFilter, l)}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{l("Alle Quellen", "Все источники", "All sources")}</SelectItem>
                      {timelineSourceOptions.map((source) => (
                        <SelectItem key={source} value={source}>
                          {localizeTimelineSource(source, l)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </ShadSelect>
                  <Input
                    value={timelineSearch}
                    onChange={(event) => {
                      setTimelineSearch(event.target.value);
                      setTimelineOffset(0);
                    }}
                    placeholder={t.common_search}
                    className={formInputClassName}
                  />
                  {hasTimelineFilters ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9 rounded-lg"
                      onClick={() => {
                        setTimelineEntityFilter("all");
                        setTimelineCategoryFilter("all");
                        setTimelineSourceFilter("all");
                        setTimelineRangeFilter("all");
                        setTimelineSearch("");
                        setTimelineOffset(0);
                      }}
                    >
                      {l("Filter zurücksetzen", "Сбросить фильтры", "Reset filters")}
                    </Button>
                  ) : null}
                </div>
              </FormSection>

              {filteredTimeline.length === 0 ? (
                <EmptyCell>{l("Keine Zeitachsen-Ereignisse entsprechen den aktuellen Filtern.", "Текущим фильтрам не соответствует ни одно событие таймлайна.", "No timeline events match the current filters.")}</EmptyCell>
              ) : (
                <FormSection
                  title={l("Ereignisse", "События", "Events")}
                  accessory={
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {l("Angezeigt", "Показаны", "Showing")} {timelineTotal === 0 ? 0 : timelineOffset + 1}-
                        {timelineTotal === 0
                          ? 0
                          : Math.min(timelineOffset + timeline.length, timelineTotal)}{" "}
                        {l("von", "из", "of")} {timelineTotal}
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-lg"
                        disabled={timelineOffset === 0}
                        onClick={() => setTimelineOffset((current) => Math.max(0, current - timelineLimit))}
                      >
                        {l("Zurück", "Назад", "Previous")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-lg"
                        disabled={!timelineHasNextPage}
                        onClick={() => setTimelineOffset((current) => current + timelineLimit)}
                      >
                        {l("Weiter", "Далее", "Next")}
                      </Button>
                    </div>
                  }
                >
                  <div className="rounded-2xl border border-border/50 bg-card px-4 py-3 sm:px-5">
                    <div className="space-y-5">
                      {groupedTimeline.map((group) => (
                        <div key={group.key} className="space-y-3">
                          <div className="flex items-center gap-2">
                            <span className="shrink-0 rounded-full border border-border/60 bg-muted/35 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                              {group.label}
                            </span>
                            <span className="h-px flex-1 bg-border/60" />
                          </div>

                          <div className="space-y-0">
                            {group.items.map((item, idx) => {
                              const route = resolvePatientTimelineRoute(item, {
                                canOpenDocumentsWorkspace,
                                canViewContracts,
                                canViewInvoices,
                                canOpenComplianceWorkspace,
                              });

                              return (
                                <div
                                  key={`${item.entity_type}-${item.entity_id}`}
                                  className={cn(
                                    "grid grid-cols-[16px_minmax(0,1fr)] gap-3",
                                    idx < group.items.length - 1 && "pb-3"
                                  )}
                                >
                                  <div className="relative flex justify-center">
                                    {idx < group.items.length - 1 ? (
                                      <span className="absolute top-3 bottom-[-0.75rem] w-px bg-gradient-to-b from-border/90 via-border/60 to-transparent" />
                                    ) : null}
                                    <span
                                      className={cn(
                                        "relative mt-1.5 size-2 rounded-full border border-card shadow-[0_0_0_2px_rgba(255,255,255,0.92)]",
                                        timelineEntityDotClass(item.entity_type)
                                      )}
                                    />
                                  </div>

                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (route) {
                                        staffGo(route);
                                      }
                                    }}
                                    className={cn(
                                      "rounded-2xl border px-4 py-3 text-left transition-colors",
                                      timelineItemSurfaceClass(item.status),
                                      route
                                        ? "hover:border-border hover:bg-muted/30 cursor-pointer"
                                        : "cursor-default"
                                    )}
                                  >
                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                      <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <Badge
                                            variant="outline"
                                            className={cn("rounded-full text-[10px]", timelineEntityTypeBadgeClass(item.entity_type))}
                                          >
                                            {localizeTimelineEntityType(item.entity_type, l)}
                                          </Badge>
                                          <Badge
                                            variant="outline"
                                            className={cn(
                                              "rounded-full text-[10px]",
                                              STATUS_COLORS[item.status] ?? "border-border/60 bg-muted/25 text-muted-foreground"
                                            )}
                                          >
                                            {patientDetailStatusLabel(item.status)}
                                          </Badge>
                                          <span className="text-xs text-muted-foreground">
                                            {localizeTimelineCategory(item.category, l)}
                                          </span>
                                          {item.source_label ? (
                                            <span className="text-xs text-muted-foreground/80">
                                              · {localizeTimelineSource(item.source_label, l)}
                                            </span>
                                          ) : null}
                                        </div>
                                        <p className="mt-2 text-sm font-semibold text-foreground">{item.title}</p>
                                      </div>

                                      <div className="shrink-0">
                                        <p className="text-xs font-medium text-muted-foreground/80">
                                          {fmtDateTime(item.happened_at)}
                                        </p>
                                      </div>
                                    </div>
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </FormSection>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>

      <MemoizedPatientProfileEditorSheet
        open={profileEditorOpen}
        patientId={id}
        detail={detail}
        dictionary={tr}
        lang={lang}
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
                  className={textareaClassName}
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
                  className={textareaClassName}
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
