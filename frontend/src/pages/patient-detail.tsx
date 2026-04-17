import {
  useDeferredValue,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
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
  Field as FormField,
  FormSection,
  FunctionalLabelChips,
  formInputClassName,
  humanizeFunctionalLabel,
  parseFunctionalLabels,
  textareaClassName as formTextareaClassName,
} from "@/components/patient-form-primitives";
import { StatusActionPill } from "@/components/status-action-pill";
import { Input } from "@/components/ui/input";
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

function canAssignTarget(managerRole: string | undefined, targetRole: string) {
  switch (managerRole) {
    case "ceo": return ["patient_manager", "teamlead_interpreter", "interpreter", "concierge"].includes(targetRole);
    case "patient_manager": return ["teamlead_interpreter", "interpreter", "concierge"].includes(targetRole);
    case "teamlead_interpreter": return targetRole === "interpreter";
    default: return false;
  }
}

function card(extra?: string) {
  return cn("rounded-[1.75rem] border border-border/70 bg-card shadow-[0_20px_60px_rgba(15,23,42,0.05)]", extra);
}

const selectClassName =
  "h-10 w-full rounded-xl border border-input bg-slate-50 px-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100";
const textareaClassName =
  "min-h-[104px] w-full rounded-xl border border-input bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100";

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
        <button type="button" onClick={onEdit} className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg p-1 hover:bg-slate-100">
          <Pencil className="size-3 text-slate-400" />
        </button>
      )}
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
  const [notice, setNotice] = useState("");
  const [tabActionError, setTabActionError] = useState("");
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const [profileEditorBusy, setProfileEditorBusy] = useState(false);
  const [profileEditForm, setProfileEditForm] = useState<PatientEditFormState | null>(null);
  const [vitalsBusy, setVitalsBusy] = useState(false);
  const [vitalsForm, setVitalsForm] = useState<PatientVitalFormState>(blankPatientVitalForm);
  const [cardEntriesBusy, setCardEntriesBusy] = useState(false);
  const [cardEntryForm, setCardEntryForm] = useState<PatientCardEntryFormState>(blankPatientCardEntryForm);
  const [medicalOrdersBusy, setMedicalOrdersBusy] = useState(false);
  const [medicalOrderActionId, setMedicalOrderActionId] = useState("");
  const [medicalOrderForm, setMedicalOrderForm] = useState<PatientMedicalOrderFormState>(blankPatientMedicalOrderForm);
  const [riskScoresBusy, setRiskScoresBusy] = useState(false);
  const [riskScoreForm, setRiskScoreForm] = useState<PatientRiskScoreFormState>(blankPatientRiskScoreForm);

  const [relationEditorOpen, setRelationEditorOpen] = useState(false);
  const [editingRelation, setEditingRelation] = useState<RelationItem | null>(null);
  const [relationForm, setRelationForm] = useState<RelationFormState>(blankRelationForm);
  const [relationBusy, setRelationBusy] = useState(false);
  const [relationPatientOptions, setRelationPatientOptions] = useState<PatientLookupItem[]>([]);
  const [relationPatientSearch, setRelationPatientSearch] = useState("");
  const [relationPatientOptionsLoading, setRelationPatientOptionsLoading] = useState(false);

  const [documentUploadOpen, setDocumentUploadOpen] = useState(false);
  const [documentUploadForm, setDocumentUploadForm] = useState<DocumentUploadFormState>(blankDocumentUploadForm);
  const [documentUploadBusy, setDocumentUploadBusy] = useState(false);

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
  const [timelineEntityFilter, setTimelineEntityFilter] = useState("all");
  const [timelineCategoryFilter, setTimelineCategoryFilter] = useState("all");
  const [timelineSourceFilter, setTimelineSourceFilter] = useState("all");
  const [timelineRangeFilter, setTimelineRangeFilter] = useState<PatientTimelineRangeFilter>("all");
  const [timelineSearch, setTimelineSearch] = useState("");
  const [timelineTotal, setTimelineTotal] = useState(0);
  const [timelineOffset, setTimelineOffset] = useState(0);
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
          key: "timeline",
          label: t.patients_timeline,
        }
      : null,
  ].filter((item): item is { key: string; label: string } => Boolean(item));
  const deferredRelationPatientSearch = useDeferredValue(relationPatientSearch);
  const deferredTimelineSearch = useDeferredValue(timelineSearch);
  const activeWorkflowAssignees = useMemo(
    () =>
      assignments.filter(
        (item) => !item.revoked_at && item.user_active
      ),
    [assignments]
  );

  const relationPatientOptionsFiltered = useMemo(() => {
    const normalizedSearch = deferredRelationPatientSearch.trim().toLowerCase();

    return relationPatientOptions.filter((option) => {
      if (option.id === id) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      return formatRelatedPatientOption(option).toLowerCase().includes(normalizedSearch);
    });
  }, [deferredRelationPatientSearch, id, relationPatientOptions]);

  const selectedRelatedPatient = useMemo(
    () =>
      relationPatientOptions.find((option) => option.id === relationForm.relatedPatientId) ?? null,
    [relationForm.relatedPatientId, relationPatientOptions]
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
      label: workflowChecklistLabel(key),
      items: groupItems,
    }));
  }, [workflowChecklist]);
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
  const hasTimelineFilters =
    timelineEntityFilter !== "all" ||
    timelineCategoryFilter !== "all" ||
    timelineSourceFilter !== "all" ||
    timelineRangeFilter !== "all" ||
    deferredTimelineSearch.trim().length > 0;
  const latestVitalMeasurement = vitalsHistory[0] ?? null;
  const bmiPreview = useMemo(
    () => computeVitalBmi(vitalsForm.weightKg, vitalsForm.heightCm),
    [vitalsForm.heightCm, vitalsForm.weightKg]
  );

  useEffect(() => {
    setTimelineOffset(0);
  }, [
    timelineEntityFilter,
    timelineCategoryFilter,
    timelineSourceFilter,
    timelineRangeFilter,
    deferredTimelineSearch,
  ]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const reloadTab = useCallback(() => setTabVersion((v) => v + 1), []);

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
    setNotice("");
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

  useEffect(() => {
    if (!relationEditorOpen || !canManageRelations) {
      return;
    }

    let cancelled = false;
    setRelationPatientOptionsLoading(true);

    apiFetch<PatientLookupItem[]>("/patients?active_only=true")
      .then((items) => {
        if (cancelled) {
          return;
        }
        setRelationPatientOptions(items);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setRelationPatientOptions([]);
      })
      .finally(() => {
        if (!cancelled) {
          setRelationPatientOptionsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [canManageRelations, relationEditorOpen]);

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
      setNotice(t.common_active);
      setWorkflowForm((current) => ({
        ...blankWorkflowChecklistForm(),
        ownerUserId: current.ownerUserId,
      }));
      reloadTab();
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
      setNotice(t.common_active);
      reloadTab();
    } catch (error) {
      setTabActionError(error instanceof Error ? error.message : t.common_failed_update);
    } finally {
      setWorkflowBusy(false);
    }
  }

  function openCreateRelation() {
    setEditingRelation(null);
    setRelationForm(blankRelationForm());
    setRelationPatientSearch("");
    setRelationEditorOpen(true);
  }

  function openEditRelation(relation: RelationItem) {
    setEditingRelation(relation);
    setRelationForm(relationToForm(relation));
    setRelationPatientSearch(relation.related_display_name || relation.related_name);
    setRelationEditorOpen(true);
  }

  function handleDocumentFileChange(event: ChangeEvent<HTMLInputElement>) {
    setDocumentUploadForm((current) => ({
      ...current,
      file: event.target.files?.[0] ?? null,
    }));
  }

  async function handleSaveRelation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!id || (!relationForm.relatedPatientId && !relationForm.relatedName.trim())) {
      setTabActionError(t.common_failed_create);
      return;
    }
    setRelationBusy(true);
    setTabActionError("");
    try {
      const selectedPatientName = selectedRelatedPatient
        ? formatRelatedPatientName(selectedRelatedPatient)
        : null;
      const payload = {
        related_patient_id: relationForm.relatedPatientId || undefined,
        related_name: (selectedPatientName ?? relationForm.relatedName).trim(),
        relation_type: relationForm.relationType,
        is_emergency_contact: relationForm.isEmergencyContact,
        phone: toOptional(relationForm.phone),
        notes: toOptional(relationForm.notes),
      };
      if (editingRelation) {
        await apiFetch(`/patients/${id}/relations/${editingRelation.id}/update`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setNotice(t.common_active);
      } else {
        await apiFetch(`/patients/${id}/relations`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setNotice(t.common_active);
      }
      setRelationEditorOpen(false);
      setEditingRelation(null);
      setRelationForm(blankRelationForm());
      setRelationPatientSearch("");
      reloadTab();
    } catch (error) {
      setTabActionError(error instanceof Error ? error.message : t.common_failed_update);
    } finally {
      setRelationBusy(false);
    }
  }

  async function handleDeleteRelation(relationId: string) {
    if (!id || !window.confirm(t.common_delete)) return;
    setTabActionError("");
    try {
      await apiFetch(`/patients/${id}/relations/${relationId}/delete`, {
        method: "POST",
      });
      setNotice(t.common_active);
      reloadTab();
    } catch (error) {
      setTabActionError(error instanceof Error ? error.message : t.common_failed_update);
    }
  }

  async function handleUploadDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!id || !documentUploadForm.file || !documentUploadForm.art.trim()) {
      setTabActionError(t.common_failed_create);
      return;
    }
    setDocumentUploadBusy(true);
    setTabActionError("");
    try {
      const formData = new FormData();
      formData.append("file", documentUploadForm.file);
      formData.append("patient_id", id);
      if (documentUploadForm.orderId) formData.append("order_id", documentUploadForm.orderId);
      if (documentUploadForm.appointmentId) formData.append("appointment_id", documentUploadForm.appointmentId);
      if (documentUploadForm.autoName.trim()) formData.append("auto_name", documentUploadForm.autoName.trim());
      formData.append("art", documentUploadForm.art.trim());
      if (documentUploadForm.category.trim()) formData.append("category", documentUploadForm.category.trim());
      formData.append("status", documentUploadForm.status);
      formData.append("visibility", documentUploadForm.visibility);
      if (documentUploadForm.isMedical) formData.append("is_medical", "true");
      if (documentUploadForm.notes.trim()) formData.append("notes", documentUploadForm.notes.trim());
      await apiFetch("/documents/upload", {
        method: "POST",
        body: formData,
      });
      setNotice(t.common_active);
      setDocumentUploadOpen(false);
      setDocumentUploadForm(blankDocumentUploadForm());
      reloadTab();
    } catch (error) {
      setTabActionError(error instanceof Error ? error.message : t.common_failed_create);
    } finally {
      setDocumentUploadBusy(false);
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
      setNotice(t.common_active);
      setContractCreateOpen(false);
      setContractCreateForm(blankContractForm());
      reloadTab();
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
      setNotice(t.common_active);
      setContractStatusId("");
      setContractStatusForm(blankContractForm());
      reloadTab();
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
      setNotice(t.common_active);
      reloadTab();
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
      setNotice(t.common_active);
      reloadTab();
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
      setNotice(
        l(
          "DSGVO-Export wurde heruntergeladen.",
          "Экспорт DSGVO загружен.",
          "DSGVO export downloaded.",
        ),
      );
    } catch (error) {
      setTabActionError(
        error instanceof Error ? error.message : t.common_failed_create
      );
    } finally {
      setComplianceExportBusy(false);
    }
  }

  async function handlePrintPatientLabel() {
    if (!id) return;

    const printWindow = window.open("", "_blank", "noopener,noreferrer");
    if (!printWindow) {
      setTabActionError("Allow pop-ups to print the patient label.");
      return;
    }

    setPatientLabelBusy(true);
    setTabActionError("");

    try {
      const payload = await apiFetch<PatientLabelPayload>(
        `/patients/${id}/label?format=${encodeURIComponent(patientLabelFormat)}`
      );
      printWindow.document.open();
      printWindow.document.write(buildPatientLabelPrintHtml(payload));
      printWindow.document.close();
      setNotice("Patient label opened for print.");
    } catch (error) {
      printWindow.close();
      setTabActionError(
        error instanceof Error ? error.message : t.common_failed_create
      );
    } finally {
      setPatientLabelBusy(false);
    }
  }

  function openProfileEditor() {
    if (!detail) return;
    setProfileEditForm(patientToEditForm(detail));
    setProfileEditorOpen(true);
  }

  async function handleSavePatientProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!id || !profileEditForm) return;
    setProfileEditorBusy(true);
    setTabActionError("");
    try {
      await apiFetch(`/patients/${id}/update`, {
        method: "POST",
        body: JSON.stringify({
          title: profileEditForm.title,
          first_name: profileEditForm.firstName,
          last_name: profileEditForm.lastName,
          phone_primary: profileEditForm.phonePrimary,
          phone_secondary: profileEditForm.phoneSecondary,
          email: profileEditForm.email,
          nationality: profileEditForm.nationality,
          residence_country: profileEditForm.residenceCountry,
          languages: profileEditForm.languages
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
          functional_labels: parseFunctionalLabels(profileEditForm.functionalLabels),
          address_street: profileEditForm.addressStreet,
          address_city: profileEditForm.addressCity,
          address_zip: profileEditForm.addressZip,
          address_country: profileEditForm.addressCountry,
          insurance_provider: profileEditForm.insuranceProvider,
          insurance_number: profileEditForm.insuranceNumber,
          insurance_type: profileEditForm.insuranceType,
          emergency_contact_name: profileEditForm.emergencyContactName,
          emergency_contact_phone: profileEditForm.emergencyContactPhone,
          emergency_contact_relation: profileEditForm.emergencyContactRelation,
          legal_status: serializePatientLegalStatus(profileEditForm.legalStatus),
          clinical_warnings: profileEditForm.clinicalWarnings,
          notes: profileEditForm.notes,
        }),
      });
      setNotice(t.common_active);
      setProfileEditorOpen(false);
      reload();
    } catch (error) {
      setTabActionError(error instanceof Error ? error.message : t.common_failed_update);
    } finally {
      setProfileEditorBusy(false);
    }
  }

  async function handleCreateVitalMeasurement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!id) return;

    let payload: Record<string, unknown>;
    try {
      const measuredAt = new Date(vitalsForm.measuredAt);
      if (Number.isNaN(measuredAt.getTime())) {
        throw new Error("Select a valid measurement timestamp");
      }
      const bmiValue =
        parseOptionalNumberInput(vitalsForm.bmi) ??
        computeVitalBmi(vitalsForm.weightKg, vitalsForm.heightCm) ??
        undefined;

      payload = {
        measured_at: measuredAt.toISOString(),
        bp_systolic: parseOptionalNumberInput(vitalsForm.bpSystolic),
        bp_diastolic: parseOptionalNumberInput(vitalsForm.bpDiastolic),
        heart_rate: parseOptionalIntegerInput(vitalsForm.heartRate),
        weight_kg: parseOptionalNumberInput(vitalsForm.weightKg),
        height_cm: parseOptionalNumberInput(vitalsForm.heightCm),
        bmi: bmiValue,
        notes: toOptional(vitalsForm.notes),
      };
    } catch (error) {
      setTabActionError(error instanceof Error ? error.message : t.common_failed_create);
      return;
    }

    setVitalsBusy(true);
    setTabActionError("");
    try {
      await apiFetch(`/patients/${id}/vitals`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const result = await apiFetch<{ items: PatientVitalMeasurement[] }>(`/patients/${id}/vitals`);
      setVitalsHistory(result.items ?? []);
      setVitalsForm(blankPatientVitalForm());
      setNotice("Vital measurement saved.");
      reload();
    } catch (error) {
      setTabActionError(error instanceof Error ? error.message : t.common_failed_create);
    } finally {
      setVitalsBusy(false);
    }
  }

  async function handleCreatePatientCardEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!id) return;

    let payload: Record<string, unknown>;
    try {
      const entryDate = new Date(cardEntryForm.entryDate);
      if (Number.isNaN(entryDate.getTime())) {
        throw new Error("Select a valid entry timestamp");
      }
      if (!cardEntryForm.content.trim()) {
        throw new Error("Clinical entry content is required");
      }

      payload = {
        entry_date: entryDate.toISOString(),
        category: cardEntryForm.category,
        source: toOptional(cardEntryForm.source),
        content: cardEntryForm.content.trim(),
      };
    } catch (error) {
      setTabActionError(error instanceof Error ? error.message : t.common_failed_create);
      return;
    }

    setCardEntriesBusy(true);
    setTabActionError("");
    try {
      await apiFetch(`/patients/${id}/card-entries`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const result = await apiFetch<{ items: PatientCardEntry[] }>(`/patients/${id}/card-entries`);
      setCardEntries(result.items ?? []);
      setCardEntryForm(blankPatientCardEntryForm());
      setNotice("Clinical card entry saved.");
      reloadTab();
    } catch (error) {
      setTabActionError(error instanceof Error ? error.message : t.common_failed_create);
    } finally {
      setCardEntriesBusy(false);
    }
  }

  async function handleCreatePatientMedicalOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!id) return;

    let payload: Record<string, unknown>;
    try {
      const orderDate = new Date(medicalOrderForm.orderDate);
      if (Number.isNaN(orderDate.getTime())) {
        throw new Error("Select a valid medical order timestamp");
      }
      if (!medicalOrderForm.title.trim()) {
        throw new Error("Medical order title is required");
      }
      if (!medicalOrderForm.instructions.trim()) {
        throw new Error("Medical order instructions are required");
      }

      payload = {
        order_date: orderDate.toISOString(),
        order_type: medicalOrderForm.orderType,
        title: medicalOrderForm.title.trim(),
        instructions: medicalOrderForm.instructions.trim(),
        due_date: toOptional(medicalOrderForm.dueDate),
        source: toOptional(medicalOrderForm.source),
      };
    } catch (error) {
      setTabActionError(error instanceof Error ? error.message : t.common_failed_create);
      return;
    }

    setMedicalOrdersBusy(true);
    setTabActionError("");
    try {
      await apiFetch(`/patients/${id}/medical-orders`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const result = await apiFetch<{ items: PatientMedicalOrder[] }>(`/patients/${id}/medical-orders`);
      setMedicalOrders(result.items ?? []);
      setMedicalOrderForm(blankPatientMedicalOrderForm());
      setNotice("Medical order saved.");
      reloadTab();
    } catch (error) {
      setTabActionError(error instanceof Error ? error.message : t.common_failed_create);
    } finally {
      setMedicalOrdersBusy(false);
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
      setNotice(status === "completed" ? "Medical order completed." : "Medical order cancelled.");
      reloadTab();
    } catch (error) {
      setTabActionError(error instanceof Error ? error.message : t.common_failed_update);
    } finally {
      setMedicalOrderActionId("");
    }
  }

  async function handleCreatePatientRiskScore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!id) return;

    let payload: Record<string, unknown>;
    try {
      const computedAt = new Date(riskScoreForm.computedAt);
      if (Number.isNaN(computedAt.getTime())) {
        throw new Error("Select a valid risk score timestamp");
      }
      const scoreValue = parseOptionalNumberInput(riskScoreForm.scoreValue);
      if (scoreValue == null) {
        throw new Error("Risk score value is required");
      }
      const scaleMax = parseOptionalNumberInput(riskScoreForm.scaleMax);
      let inputs: Record<string, unknown> | undefined;
      if (riskScoreForm.inputsJson.trim()) {
        const parsed = JSON.parse(riskScoreForm.inputsJson);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error(
            l(
              "Strukturierte Eingaben müssen ein JSON-Objekt sein",
              "Структурированные входные данные должны быть JSON-объектом",
              "Structured inputs must be a JSON object",
            ),
          );
        }
        inputs = parsed as Record<string, unknown>;
      }

      payload = {
        computed_at: computedAt.toISOString(),
        score_type: riskScoreForm.scoreType,
        score_value: scoreValue,
        scale_max: scaleMax,
        interpretation: toOptional(riskScoreForm.interpretation),
        source: toOptional(riskScoreForm.source),
        inputs,
      };
    } catch (error) {
      setTabActionError(error instanceof Error ? error.message : t.common_failed_create);
      return;
    }

    setRiskScoresBusy(true);
    setTabActionError("");
    try {
      await apiFetch(`/patients/${id}/risk-scores`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const result = await apiFetch<{ items: PatientRiskScore[] }>(`/patients/${id}/risk-scores`);
      setRiskScores(result.items ?? []);
      setRiskScoreForm(blankPatientRiskScoreForm());
      setNotice("Risk score saved.");
      reloadTab();
    } catch (error) {
      setTabActionError(error instanceof Error ? error.message : t.common_failed_create);
    } finally {
      setRiskScoresBusy(false);
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

      {/* Quick action row */}
      <div className="flex flex-wrap items-center gap-1.5">
        {canPrintPatientLabel ? (
          <div className="flex items-center gap-1.5 ml-auto">
            <ShadSelect
              value={patientLabelFormat}
              onValueChange={(value) =>
                setPatientLabelFormat(
                  (value as PatientLabelFormatId) ?? DEFAULT_PATIENT_LABEL_FORMAT_ID
                )
              }
            >
              <SelectTrigger className="h-10 w-[280px] rounded-lg bg-card text-[13px]">
                <SelectValue placeholder={l("Etikettenformat", "Формат наклейки", "Label format")} />
              </SelectTrigger>
              <SelectContent>
                {PATIENT_LABEL_FORMAT_OPTIONS.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </ShadSelect>
            <Button
              type="button"
              variant="outline"
              className="h-10 rounded-lg gap-1.5"
              disabled={patientLabelBusy}
              onClick={() => void handlePrintPatientLabel()}
            >
              {patientLabelBusy ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <Printer className="size-3.5" />
              )}
              {l("Etikett drucken", "Печать наклейки", "Print sticker")}
            </Button>
          </div>
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

        {notice ? (
          <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {notice}
          </div>
        ) : null}

        {tabActionError ? (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {tabActionError}
          </div>
        ) : null}

        {/* Profile tab */}
        <TabsContent value="profile" className="space-y-6 mt-4 min-h-[400px]">
          {/* Contact & Demographics */}
          <FormSection title={t.patients_profile}>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <InfoRow label={t.patients_birth_date} value={fmtDate(detail.birth_date, t.common_not_set)} />
              <InfoRow label={t.patients_gender} value={genderLbl(detail.gender, tr)} />
              <InfoRow label={t.patients_nationality} value={fieldVal(detail.nationality, t.common_not_set)} onEdit={canEditPatientProfile ? openProfileEditor : undefined} />
              <InfoRow label={t.patients_residence_country} value={fieldVal(detail.residence_country, t.common_not_set)} onEdit={canEditPatientProfile ? openProfileEditor : undefined} />
              <InfoRow label={t.patients_phone_primary} value={fieldVal(detail.phone_primary, t.common_not_set)} onEdit={canEditPatientProfile ? openProfileEditor : undefined} />
              <InfoRow label={t.patients_phone_secondary} value={fieldVal(detail.phone_secondary, t.common_not_set)} onEdit={canEditPatientProfile ? openProfileEditor : undefined} />
              <InfoRow label={t.patients_email} value={fieldVal(detail.email, t.common_not_set)} onEdit={canEditPatientProfile ? openProfileEditor : undefined} />
              <InfoRow label={t.patients_languages} value={fieldVal(detail.languages, t.common_not_set)} onEdit={canEditPatientProfile ? openProfileEditor : undefined} />
              <InfoRow label={l("Funktionale Labels", "Функциональные метки", "Functional labels")} value={fieldVal(detail.functional_labels, t.common_not_set)} onEdit={canEditPatientProfile ? openProfileEditor : undefined} />
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

          <FormSection
            title={t.patients_legal_status}
            accessory={
              <div className="flex items-center gap-2">
                <LegalStatusPill status={legalStatus} />
                {canEditPatientProfile ? (
                  <Button type="button" variant="outline" size="sm" className="h-9 rounded-lg gap-1.5" onClick={openProfileEditor}>
                    <Pencil className="size-3.5" />
                    {l("Status aktualisieren", "Обновить статус", "Update status")}
                  </Button>
                ) : null}
              </div>
            }
          >
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
              <div className="rounded-xl border border-border/50 bg-muted/25 px-4 py-3 xl:col-span-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">
                  {l("Vertragsstatus", "Статус договора", "Contract status")}
                </p>
                <p className="mt-3 text-lg font-semibold text-foreground">
                  {patientDetailStatusLabel(legalStatus.contractStatus)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {legalStatusCompletion.completed}/{legalStatusCompletion.total} {l("erledigt", "выполнено", "done")}
                </p>
              </div>
              {legalStatusChecklist.map((item) => (
                <div key={item.key} className="rounded-xl border border-border/50 bg-card px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">
                    {item.label}
                  </p>
                  <Badge
                    variant="outline"
                    className={cn(
                      "mt-3 rounded-full text-[10px]",
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
              <div className="rounded-xl border border-border/50 bg-muted/25 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">
                  {l("Notizen", "Заметки", "Notes")}
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{legalStatus.notes}</p>
              </div>
            ) : null}

            <div className="grid gap-3 lg:grid-cols-[1.5fr_1fr]">
              <div className="rounded-xl border border-border/50 bg-muted/25 px-4 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">
                  {l("Compliance-Handoff", "Передача compliance", "Compliance handoff")}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {l(
                    "Nutzen Sie das Patientenprofil als operative Quelle für die DSGVO-Bereitschaft und führen Sie Einwilligungen, Löschungen und Einschränkungen anschließend im dedizierten Compliance-Bereich weiter.",
                    "Используйте профиль пациента как операционный источник для готовности по DSGVO, а согласия, удаление и ограничения продолжайте в отдельном разделе compliance.",
                    "Use the patient profile as the operational source for DSGVO readiness, then continue consent, erasure and restriction handling in the dedicated compliance workspace.",
                  )}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {canExportPatientCompliance ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9 rounded-lg"
                      disabled={complianceExportBusy}
                      onClick={() => void handleExportPatientCompliance()}
                    >
                      {complianceExportBusy ? (
                        <LoaderCircle className="mr-2 size-4 animate-spin" />
                      ) : null}
                      {l("DSGVO-Export", "Экспорт DSGVO", "DSGVO export")}
                    </Button>
                  ) : null}
                  {canOpenComplianceWorkspace ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9 rounded-lg"
                      onClick={() => staffGo(`/admin/compliance?patient=${id}`)}
                    >
                      {l("DSGVO-Bereich öffnen", "Открыть раздел DSGVO", "Open DSGVO workspace")}
                    </Button>
                  ) : null}
                  {canOpenDocumentsWorkspace ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9 rounded-lg"
                      onClick={() => staffGo(`/documents?patient=${id}`)}
                    >
                      {l("Dokumente öffnen", "Открыть документы", "Open documents")}
                    </Button>
                  ) : null}
                  {canViewContracts ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9 rounded-lg"
                      onClick={() => staffGo(`/contracts?patient=${id}`)}
                    >
                      {l("Verträge öffnen", "Открыть договоры", "Open contracts")}
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="rounded-xl border border-border/50 bg-card px-4 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">
                  {l("Operative Grenze", "Операционная граница", "Operational boundary")}
                </p>
                <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                  <li>{l("Die rechtliche Freigabe ist hier patientengebunden.", "Юридическая готовность здесь привязана к пациенту.", "Legal readiness is patient-bound here.")}</li>
                  <li>{l("Das Einwilligungsregister bleibt im DSGVO-Adminbereich.", "Реестр согласий по-прежнему находится в админ-разделе DSGVO.", "Consent register still lives in the DSGVO admin workspace.")}</li>
                  <li>{l("Die Ausführung sollte erst nach abgeschlossener Compliance starten.", "Исполнение не должно начинаться до завершения compliance.", "Execution should not start before compliance is complete.")}</li>
                </ul>
              </div>
            </div>
          </FormSection>

          {(canManagePatientVitals || detail.clinical_warnings || vitalsHistory.length > 0) ? (
            <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
              <FormSection
                title={l("CAVE-Hinweise", "Заметки CAVE", "Cave notes")}
                accessory={
                  canEditPatientProfile ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9 rounded-lg border-rose-200 bg-white text-rose-700 hover:bg-rose-50"
                      onClick={openProfileEditor}
                    >
                      <Pencil className="mr-2 size-3.5" />
                      {l("Aktualisieren", "Обновить", "Update")}
                    </Button>
                  ) : null
                }
              >
                <p className="text-sm text-muted-foreground">
                  {l(
                    "Dauerhafte klinische Warnhinweise, die vor Beginn von Koordination oder Behandlung sichtbar bleiben sollen.",
                    "Постоянные клинические предупреждения, которые должны оставаться видимыми до начала координации или лечения.",
                    "Persistent clinical warnings that should stay visible before coordination or treatment starts.",
                  )}
                </p>
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
                  <Badge variant="outline" className="rounded-full border-border/60 bg-muted/25 text-foreground">
                    {l(`${vitalsHistory.length} Einträge`, `${vitalsHistory.length} записей`, `${vitalsHistory.length} entries`)}
                  </Badge>
                }
              >
                <p className="text-sm text-muted-foreground">
                  {l(
                    "Blutdruck-, Herzfrequenz- und Gewichtsstände mit zeitgestempeltem klinischem Kontext.",
                    "Снимки давления, пульса и веса с клиническим контекстом по времени.",
                    "Blood pressure, heart rate and weight snapshots with timestamped clinical context.",
                  )}
                </p>

                {latestVitalMeasurement ? (
                  <div className="rounded-xl border border-border/50 bg-muted/25 px-4 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">
                          {l("Letzte Messung", "Последнее измерение", "Latest measurement")}
                        </p>
                        <p className="mt-2 text-sm font-medium text-foreground">
                          {fmtDateTime(latestVitalMeasurement.measured_at, t.common_not_set)}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                        {latestVitalMeasurement.bp_systolic != null && latestVitalMeasurement.bp_diastolic != null ? (
                          <Badge variant="outline" className="rounded-full bg-card">
                            RR {formatVitalNumber(latestVitalMeasurement.bp_systolic, { maximumFractionDigits: 0 })}/
                            {formatVitalNumber(latestVitalMeasurement.bp_diastolic, { maximumFractionDigits: 0 })} mmHg
                          </Badge>
                        ) : null}
                        {latestVitalMeasurement.heart_rate != null ? (
                          <Badge variant="outline" className="rounded-full bg-card">
                            HF {formatVitalNumber(latestVitalMeasurement.heart_rate, { maximumFractionDigits: 0 })} bpm
                          </Badge>
                        ) : null}
                        {latestVitalMeasurement.weight_kg != null ? (
                          <Badge variant="outline" className="rounded-full bg-card">
                            {l("Gewicht", "Вес", "Weight")} {formatVitalNumber(latestVitalMeasurement.weight_kg)} kg
                          </Badge>
                        ) : null}
                        {latestVitalMeasurement.bmi != null ? (
                          <Badge variant="outline" className="rounded-full bg-card">
                            BMI {formatVitalNumber(latestVitalMeasurement.bmi)}
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                    {latestVitalMeasurement.notes ? (
                      <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">
                        {latestVitalMeasurement.notes}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-border/60 bg-muted/25 px-4 py-6 text-sm text-muted-foreground">
                    {l("Noch keine Vitalwerte erfasst.", "Показатели пока не зафиксированы.", "No vital measurements recorded yet.")}
                  </div>
                )}

                {vitalsHistory.length > 0 ? (
                  <div className="space-y-3">
                    {vitalsHistory.slice(0, 6).map((item) => (
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
                          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
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

          {canManagePatientVitals ? (
            <form onSubmit={handleCreateVitalMeasurement}>
              <FormSection
                title={l("Vitalwert hinzufügen", "Добавить показатель", "Add vital measurement")}
                accessory={
                  bmiPreview != null ? (
                    <Badge variant="outline" className="rounded-full border-sky-200 bg-sky-50 text-sky-700">
                      {l("BMI-Vorschau", "Предпросмотр BMI", "BMI preview")} {formatVitalNumber(bmiPreview)}
                    </Badge>
                  ) : null
                }
              >
                <p className="text-sm text-muted-foreground">
                  {l(
                    "Erfassen Sie Vitalwerte des Patienten mit einem konkreten Messzeitpunkt.",
                    "Фиксируйте показатели пациента с точным временем измерения.",
                    "Capture patient vitals with a concrete measurement timestamp.",
                  )}
                </p>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div className="space-y-2 xl:col-span-2">
                  <Label htmlFor="patient-vitals-measured-at">{l("Gemessen am", "Измерено", "Measured at")}</Label>
                  <Input
                    id="patient-vitals-measured-at"
                    type="datetime-local"
                    className={formInputClassName}
                    value={vitalsForm.measuredAt}
                    onChange={(event) =>
                      setVitalsForm((current) => ({ ...current, measuredAt: event.target.value }))
                    }
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="patient-vitals-bp-systolic">{l("RR systolisch", "Систолическое АД", "BP systolic")}</Label>
                  <Input
                    id="patient-vitals-bp-systolic"
                    inputMode="decimal"
                    className={formInputClassName}
                    value={vitalsForm.bpSystolic}
                    onChange={(event) =>
                      setVitalsForm((current) => ({ ...current, bpSystolic: event.target.value }))
                    }
                    placeholder="120"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="patient-vitals-bp-diastolic">{l("RR diastolisch", "Диастолическое АД", "BP diastolic")}</Label>
                  <Input
                    id="patient-vitals-bp-diastolic"
                    inputMode="decimal"
                    className={formInputClassName}
                    value={vitalsForm.bpDiastolic}
                    onChange={(event) =>
                      setVitalsForm((current) => ({ ...current, bpDiastolic: event.target.value }))
                    }
                    placeholder="80"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="patient-vitals-heart-rate">{l("Herzfrequenz", "Пульс", "Heart rate")}</Label>
                  <Input
                    id="patient-vitals-heart-rate"
                    inputMode="numeric"
                    className={formInputClassName}
                    value={vitalsForm.heartRate}
                    onChange={(event) =>
                      setVitalsForm((current) => ({ ...current, heartRate: event.target.value }))
                    }
                    placeholder="72"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="patient-vitals-weight">{l("Gewicht (kg)", "Вес (кг)", "Weight (kg)")}</Label>
                  <Input
                    id="patient-vitals-weight"
                    inputMode="decimal"
                    className={formInputClassName}
                    value={vitalsForm.weightKg}
                    onChange={(event) =>
                      setVitalsForm((current) => ({ ...current, weightKg: event.target.value }))
                    }
                    placeholder="70.5"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="patient-vitals-height">{l("Größe (cm)", "Рост (см)", "Height (cm)")}</Label>
                  <Input
                    id="patient-vitals-height"
                    inputMode="decimal"
                    className={formInputClassName}
                    value={vitalsForm.heightCm}
                    onChange={(event) =>
                      setVitalsForm((current) => ({ ...current, heightCm: event.target.value }))
                    }
                    placeholder="172"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="patient-vitals-bmi">BMI</Label>
                  <Input
                    id="patient-vitals-bmi"
                    inputMode="decimal"
                    className={formInputClassName}
                    value={vitalsForm.bmi}
                    onChange={(event) =>
                      setVitalsForm((current) => ({ ...current, bmi: event.target.value }))
                    }
                    placeholder={bmiPreview != null ? `${bmiPreview}` : l("auto", "авто", "auto")}
                  />
                </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="patient-vitals-notes">{l("Messnotizen", "Заметки к измерению", "Measurement notes")}</Label>
                  <textarea
                    id="patient-vitals-notes"
                    className={textareaClassName}
                    value={vitalsForm.notes}
                    onChange={(event) =>
                      setVitalsForm((current) => ({ ...current, notes: event.target.value }))
                    }
                    placeholder={l(
                      "Kontext, Symptome oder Messbedingungen",
                      "Контекст, симптомы или условия измерения",
                      "Context, symptoms or measurement conditions",
                    )}
                  />
                </div>
                <div className="flex justify-end">
                  <Button
                    type="submit"
                    className="h-9 rounded-lg bg-slate-950 text-white hover:bg-slate-800"
                    disabled={vitalsBusy}
                  >
                    {vitalsBusy ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
                    {l("Vitalwert speichern", "Сохранить показатель", "Save vital measurement")}
                  </Button>
                </div>
              </FormSection>
            </form>
          ) : null}

          {(canManagePatientCardEntries || cardEntries.length > 0) ? (
            <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
              <div className={card("p-6")}>
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-950">{l("Klinisches Kartenprotokoll", "Журнал клинической карты", "Clinical card log")}</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {l(
                        "Kategorisierte Längsverlaufseinträge außerhalb strukturierter Anamneseblöcke.",
                        "Категоризированные продольные записи вне структурированных разделов анамнеза.",
                        "Categorized longitudinal entries outside structured anamnesis sections.",
                      )}
                    </p>
                  </div>
                  <Badge variant="outline" className="rounded-full border-slate-200 bg-slate-50 text-slate-700">
                    {l(`${cardEntries.length} Einträge`, `${cardEntries.length} записей`, `${cardEntries.length} entries`)}
                  </Badge>
                </div>

                {cardEntries.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                    {l("Noch keine Einträge in der klinischen Karte.", "Записей в клинической карте пока нет.", "No clinical card entries recorded yet.")}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {cardEntries.slice(0, 6).map((entry) => (
                      <div key={entry.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-slate-950">
                              {fmtDateTime(entry.entry_date, t.common_not_set)}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              {entry.author_name ?? t.common_unknown}
                              {entry.source ? ` · ${entry.source}` : ""}
                            </p>
                          </div>
                          <Badge variant="outline" className="rounded-full">
                            {patientCardEntryCategoryLabel(entry.category)}
                          </Badge>
                        </div>
                        <p className="mt-3 whitespace-pre-wrap text-sm text-slate-600">{entry.content}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {canManagePatientCardEntries ? (
                <form className={card("p-6")} onSubmit={handleCreatePatientCardEntry}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold text-slate-950">{l("Karteneintrag hinzufügen", "Добавить запись в карту", "Add card entry")}</h2>
                      <p className="mt-1 text-sm text-slate-500">
                        {l(
                          "Dokumentieren Sie medizinische Updates, Patientenmeldungen und Nachverfolgung der Klinik außerhalb des strukturierten Fallschemas.",
                          "Фиксируйте медицинские обновления, сообщения пациента и follow-up от провайдера вне структурированной схемы кейса.",
                          "Log medical updates, patient reports and provider follow-up outside the structured case schema.",
                        )}
                      </p>
                    </div>
                    <Badge variant="outline" className="rounded-full border-slate-200 bg-slate-50 text-slate-700">
                      {l("Längsverlauf", "Продольная запись", "Longitudinal record")}
                    </Badge>
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="patient-card-entry-date">{l("Eintragsdatum", "Дата записи", "Entry date")}</Label>
                      <Input
                        id="patient-card-entry-date"
                        type="datetime-local"
                        value={cardEntryForm.entryDate}
                        onChange={(event) =>
                          setCardEntryForm((current) => ({ ...current, entryDate: event.target.value }))
                        }
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="patient-card-entry-category">{l("Kategorie", "Категория", "Category")}</Label>
                      <ShadSelect
                        value={cardEntryForm.category}
                        onValueChange={(value) =>
                          setCardEntryForm((current) => ({
                            ...current,
                            category: value ?? PATIENT_CARD_ENTRY_CATEGORY_OPTIONS[0].value,
                          }))
                        }
                      >
                        <SelectTrigger id="patient-card-entry-category" className="w-full">
                          <SelectValue placeholder={l("Kategorie wählen", "Выберите категорию", "Select category")} />
                        </SelectTrigger>
                        <SelectContent>
                          {PATIENT_CARD_ENTRY_CATEGORY_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {patientCardEntryCategoryLabel(option.value)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </ShadSelect>
                    </div>
                  </div>

                  <div className="mt-4 space-y-2">
                    <Label htmlFor="patient-card-entry-source">{l("Quelle", "Источник", "Source")}</Label>
                    <Input
                      id="patient-card-entry-source"
                      value={cardEntryForm.source}
                      onChange={(event) =>
                        setCardEntryForm((current) => ({ ...current, source: event.target.value }))
                      }
                      placeholder={l(
                        "Patient, Klinik, Arzt, telefonische Nachverfolgung",
                        "Пациент, клиника, врач, follow-up по телефону",
                        "Patient, clinic, doctor, phone follow-up",
                      )}
                    />
                  </div>

                  <div className="mt-4 space-y-2">
                    <Label htmlFor="patient-card-entry-content">{l("Inhalt", "Содержание", "Entry content")}</Label>
                    <textarea
                      id="patient-card-entry-content"
                      className={textareaClassName}
                      value={cardEntryForm.content}
                      onChange={(event) =>
                        setCardEntryForm((current) => ({ ...current, content: event.target.value }))
                      }
                      placeholder={l(
                        "Neue medizinische Informationen, patientenberichtete Änderungen oder Nachverfolgung der Klinik dokumentieren",
                        "Опишите новую медицинскую информацию, изменения со слов пациента или follow-up провайдера",
                        "Document new medical information, patient-reported changes or provider follow-up",
                      )}
                      required
                    />
                  </div>

                  <div className="mt-4 flex justify-end">
                    <Button
                      type="submit"
                      className="rounded-xl bg-slate-950 text-white hover:bg-slate-800"
                      disabled={cardEntriesBusy}
                    >
                      {cardEntriesBusy ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
                      {l("Eintrag speichern", "Сохранить запись", "Save card entry")}
                    </Button>
                  </div>
                </form>
              ) : null}
            </div>
          ) : null}

          {(canManagePatientMedicalOrders || medicalOrders.length > 0) ? (
            <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
              <div className={card("p-6")}>
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-950">{l("Medizinische Anordnungen", "Медицинские назначения", "Medical orders")}</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {l(
                        "Strukturierte ärztliche oder therapeutische Anordnungen, die über das Fallformular hinaus sichtbar bleiben sollen.",
                        "Структурированные врачебные или терапевтические назначения, которые должны оставаться видимыми вне формы кейса.",
                        "Structured physician or therapeutic orders that should stay visible beyond the case form.",
                      )}
                    </p>
                  </div>
                  <Badge variant="outline" className="rounded-full border-slate-200 bg-slate-50 text-slate-700">
                    {l(`${medicalOrders.length} назначений`, `${medicalOrders.length} назначений`, `${medicalOrders.length} orders`)}
                  </Badge>
                </div>

                {medicalOrders.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                    {l("Noch keine medizinischen Anordnungen erfasst.", "Медицинские назначения пока не зафиксированы.", "No medical orders recorded yet.")}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {medicalOrders.slice(0, 6).map((order) => (
                      <div key={order.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-slate-950">{order.title}</p>
                            <p className="mt-1 text-xs text-slate-500">
                              {fmtDateTime(order.order_date, t.common_not_set)} · {patientMedicalOrderTypeLabel(order.order_type)}
                              {order.source ? ` · ${order.source}` : ""}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              {l("Angeordnet von", "Назначил", "Ordered by")} {order.ordered_by_name ?? t.common_unknown}
                              {order.due_date ? ` · ${l("Срок", "Срок", "Due")} ${order.due_date}` : ""}
                            </p>
                          </div>
                          <Badge
                            variant="outline"
                            className={cn(
                              "rounded-full",
                              STATUS_BADGE_CLASSES[order.status] ?? "border-slate-200 bg-slate-50 text-slate-700"
                            )}
                          >
                            {patientDetailStatusLabel(order.status)}
                          </Badge>
                        </div>
                        <p className="mt-3 whitespace-pre-wrap text-sm text-slate-600">{order.instructions}</p>
                        {canManagePatientMedicalOrders && order.status === "active" ? (
                          <div className="mt-4 flex flex-wrap justify-end gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              className="rounded-xl"
                              disabled={medicalOrderActionId === order.id}
                              onClick={() => void handleUpdatePatientMedicalOrderStatus(order.id, "completed")}
                            >
                              {medicalOrderActionId === order.id ? (
                                <LoaderCircle className="mr-2 size-4 animate-spin" />
                              ) : null}
                              {l("Als abgeschlossen markieren", "Отметить как завершённое", "Mark completed")}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              className="rounded-xl border-rose-200 text-rose-700 hover:bg-rose-50"
                              disabled={medicalOrderActionId === order.id}
                              onClick={() => void handleUpdatePatientMedicalOrderStatus(order.id, "cancelled")}
                            >
                              {medicalOrderActionId === order.id ? (
                                <LoaderCircle className="mr-2 size-4 animate-spin" />
                              ) : null}
                              {l("Stornieren", "Отменить", "Cancel")}
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {canManagePatientMedicalOrders ? (
                <form className={card("p-6")} onSubmit={handleCreatePatientMedicalOrder}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold text-slate-950">{l("Medizinische Anordnung hinzufügen", "Добавить медицинское назначение", "Add medical order")}</h2>
                      <p className="mt-1 text-sm text-slate-500">
                        {l(
                          "Therapiepläne, Nachkontrollen und Behandlungsanweisungen strukturiert erfassen.",
                          "Структурированно фиксируйте планы терапии, повторные проверки и инструкции по лечению.",
                          "Register therapy plans, rechecks and treatment instructions in a structured way.",
                        )}
                      </p>
                    </div>
                    <Badge variant="outline" className="rounded-full border-slate-200 bg-slate-50 text-slate-700">
                      {l("Strukturierte Anordnung", "Структурированное назначение", "Structured order")}
                    </Badge>
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="patient-medical-order-date">{l("Anordnungsdatum", "Дата назначения", "Order date")}</Label>
                      <Input
                        id="patient-medical-order-date"
                        type="datetime-local"
                        value={medicalOrderForm.orderDate}
                        onChange={(event) =>
                          setMedicalOrderForm((current) => ({ ...current, orderDate: event.target.value }))
                        }
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="patient-medical-order-type">{l("Anordnungstyp", "Тип назначения", "Order type")}</Label>
                      <ShadSelect
                        value={medicalOrderForm.orderType}
                        onValueChange={(value) =>
                          setMedicalOrderForm((current) => ({
                            ...current,
                            orderType: value ?? PATIENT_MEDICAL_ORDER_TYPE_OPTIONS[0].value,
                          }))
                        }
                      >
                        <SelectTrigger id="patient-medical-order-type" className="w-full">
                          <SelectValue placeholder={l("Typ wählen", "Выберите тип", "Select order type")} />
                        </SelectTrigger>
                        <SelectContent>
                          {PATIENT_MEDICAL_ORDER_TYPE_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {patientMedicalOrderTypeLabel(option.value)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </ShadSelect>
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label htmlFor="patient-medical-order-title">{l("Titel", "Название", "Title")}</Label>
                      <Input
                        id="patient-medical-order-title"
                        value={medicalOrderForm.title}
                        onChange={(event) =>
                          setMedicalOrderForm((current) => ({ ...current, title: event.target.value }))
                        }
                        placeholder={l("Physiotherapie 2x pro Woche", "Физиотерапия 2 раза в неделю", "Physiotherapy 2x per week")}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="patient-medical-order-due-date">{l("Fälligkeitsdatum", "Срок", "Due date")}</Label>
                      <Input
                        id="patient-medical-order-due-date"
                        type="date"
                        value={medicalOrderForm.dueDate}
                        onChange={(event) =>
                          setMedicalOrderForm((current) => ({ ...current, dueDate: event.target.value }))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="patient-medical-order-source">{l("Quelle", "Источник", "Source")}</Label>
                      <Input
                        id="patient-medical-order-source"
                        value={medicalOrderForm.source}
                        onChange={(event) =>
                          setMedicalOrderForm((current) => ({ ...current, source: event.target.value }))
                        }
                        placeholder={l("Arzt, Klinik, Entlassungsbericht", "Врач, клиника, выписка", "Doctor, clinic, discharge note")}
                      />
                    </div>
                  </div>

                  <div className="mt-4 space-y-2">
                    <Label htmlFor="patient-medical-order-instructions">{l("Anweisungen", "Инструкции", "Instructions")}</Label>
                    <textarea
                      id="patient-medical-order-instructions"
                      className={textareaClassName}
                      value={medicalOrderForm.instructions}
                      onChange={(event) =>
                        setMedicalOrderForm((current) => ({ ...current, instructions: event.target.value }))
                      }
                      placeholder={l(
                        "Therapieanordnung, Taktung, Nachkontrolle oder Vorbereitungsdetails erläutern",
                        "Опишите назначение, частоту, follow-up или детали подготовки",
                        "Explain the therapeutic order, cadence, follow-up or preparation details",
                      )}
                      required
                    />
                  </div>

                  <div className="mt-4 flex justify-end">
                    <Button
                      type="submit"
                      className="rounded-xl bg-slate-950 text-white hover:bg-slate-800"
                      disabled={medicalOrdersBusy}
                    >
                      {medicalOrdersBusy ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
                      {l("Anordnung speichern", "Сохранить назначение", "Save medical order")}
                    </Button>
                  </div>
                </form>
              ) : null}
            </div>
          ) : null}

          {(canManagePatientRiskScores || riskScores.length > 0) ? (
            <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
              <div className={card("p-6")}>
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-950">{l("Risikoscores", "Риск-скоры", "Risk scores")}</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {l(
                        "Strukturierter Verlauf patientenbezogener Risikoscores jenseits fachbereichsspezifischer Warnzeichen.",
                        "Структурированная история риск-скоров на уровне пациента вне узкоспециальных красных флагов.",
                        "Patient-level structured risk score history beyond specialty-specific red flags.",
                      )}
                    </p>
                  </div>
                  <Badge variant="outline" className="rounded-full border-slate-200 bg-slate-50 text-slate-700">
                    {l(`${riskScores.length} Scores`, `${riskScores.length} скоров`, `${riskScores.length} scores`)}
                  </Badge>
                </div>

                {riskScores.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                    {l("Noch keine Risikoscores erfasst.", "Риск-скоры пока не зафиксированы.", "No risk scores recorded yet.")}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {riskScores.slice(0, 6).map((score) => (
                      <div key={score.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-slate-950">
                              {patientRiskScoreTypeLabel(score.score_type)}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              {fmtDateTime(score.computed_at, t.common_not_set)}
                              {score.source ? ` · ${score.source}` : ""}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              {l("Erfasst von", "Записал", "Recorded by")} {score.recorded_by_name ?? t.common_unknown}
                            </p>
                          </div>
                          <Badge variant="outline" className="rounded-full">
                            {formatVitalNumber(score.score_value)}
                            {score.scale_max != null ? ` / ${formatVitalNumber(score.scale_max)}` : ""}
                          </Badge>
                        </div>
                        {score.interpretation ? (
                          <p className="mt-3 whitespace-pre-wrap text-sm text-slate-600">
                            {score.interpretation}
                          </p>
                        ) : null}
                        {score.inputs ? (
                          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600">
                            <p className="font-medium text-slate-700">{l("Strukturierte Eingaben", "Структурированные входные данные", "Structured inputs")}</p>
                            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap">
                              {JSON.stringify(score.inputs, null, 2)}
                            </pre>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {canManagePatientRiskScores ? (
                <form className={card("p-6")} onSubmit={handleCreatePatientRiskScore}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold text-slate-950">{l("Risikoscore hinzufügen", "Добавить риск-скор", "Add risk score")}</h2>
                      <p className="mt-1 text-sm text-slate-500">
                        {l(
                          "Strukturiertes Risikoscoring auf Patientenebene mit optionalen JSON-Eingaben erfassen.",
                          "Фиксируйте структурированные риск-скоры на уровне пациента с опциональными JSON-входами.",
                          "Capture structured patient-level risk scoring with optional JSON inputs.",
                        )}
                      </p>
                    </div>
                    <Badge variant="outline" className="rounded-full border-slate-200 bg-slate-50 text-slate-700">
                      {l("Nur ergänzender Verlauf", "История только на добавление", "Append-only history")}
                    </Badge>
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="patient-risk-score-computed-at">{l("Berechnet am", "Рассчитано", "Computed at")}</Label>
                      <Input
                        id="patient-risk-score-computed-at"
                        type="datetime-local"
                        value={riskScoreForm.computedAt}
                        onChange={(event) =>
                          setRiskScoreForm((current) => ({ ...current, computedAt: event.target.value }))
                        }
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="patient-risk-score-type">{l("Score-Typ", "Тип скора", "Score type")}</Label>
                      <ShadSelect
                        value={riskScoreForm.scoreType}
                        onValueChange={(value) =>
                          setRiskScoreForm((current) => ({
                            ...current,
                            scoreType: value ?? PATIENT_RISK_SCORE_TYPE_OPTIONS[0].value,
                          }))
                        }
                      >
                        <SelectTrigger id="patient-risk-score-type" className="w-full">
                          <SelectValue placeholder={l("Тип wählen", "Выберите тип", "Select score type")} />
                        </SelectTrigger>
                        <SelectContent>
                          {PATIENT_RISK_SCORE_TYPE_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {patientRiskScoreTypeLabel(option.value)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </ShadSelect>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="patient-risk-score-value">{l("Wert", "Значение", "Score value")}</Label>
                      <Input
                        id="patient-risk-score-value"
                        inputMode="decimal"
                        value={riskScoreForm.scoreValue}
                        onChange={(event) =>
                          setRiskScoreForm((current) => ({ ...current, scoreValue: event.target.value }))
                        }
                        placeholder="4"
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="patient-risk-score-scale">{l("Skalenmaximum", "Максимум шкалы", "Scale max")}</Label>
                      <Input
                        id="patient-risk-score-scale"
                        inputMode="decimal"
                        value={riskScoreForm.scaleMax}
                        onChange={(event) =>
                          setRiskScoreForm((current) => ({ ...current, scaleMax: event.target.value }))
                        }
                        placeholder="9"
                      />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label htmlFor="patient-risk-score-source">{l("Quelle", "Источник", "Source")}</Label>
                      <Input
                        id="patient-risk-score-source"
                        value={riskScoreForm.source}
                        onChange={(event) =>
                          setRiskScoreForm((current) => ({ ...current, source: event.target.value }))
                        }
                        placeholder={l(
                          "Ärztliche Einschätzung, Entlassungsbericht, Intake-Prüfung",
                          "Оценка врача, выписка, проверка intake",
                          "Doctor assessment, discharge note, intake review",
                        )}
                      />
                    </div>
                  </div>

                  <div className="mt-4 space-y-2">
                    <Label htmlFor="patient-risk-score-interpretation">{l("Interpretation", "Интерпретация", "Interpretation")}</Label>
                    <textarea
                      id="patient-risk-score-interpretation"
                      className={textareaClassName}
                      value={riskScoreForm.interpretation}
                      onChange={(event) =>
                        setRiskScoreForm((current) => ({ ...current, interpretation: event.target.value }))
                      }
                      placeholder={l(
                        "Klinische Bedeutung, Eskalationsschwelle oder Nachverfolgungsimplikation erläutern",
                        "Опишите клиническое значение, порог эскалации или влияние на follow-up",
                        "Explain clinical meaning, escalation threshold or follow-up implication",
                      )}
                    />
                  </div>

                  <div className="mt-4 space-y-2">
                    <Label htmlFor="patient-risk-score-inputs">{l("Strukturierte Eingaben (JSON-Objekt)", "Структурированные входные данные (JSON-объект)", "Structured inputs (JSON object)")}</Label>
                    <textarea
                      id="patient-risk-score-inputs"
                      className={textareaClassName}
                      value={riskScoreForm.inputsJson}
                      onChange={(event) =>
                        setRiskScoreForm((current) => ({ ...current, inputsJson: event.target.value }))
                      }
                      placeholder='{"age": 68, "hypertension": true, "prior_stroke": false}'
                    />
                  </div>

                  <div className="mt-4 flex justify-end">
                    <Button
                      type="submit"
                      className="rounded-xl bg-slate-950 text-white hover:bg-slate-800"
                      disabled={riskScoresBusy}
                    >
                      {riskScoresBusy ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
                      {l("Risikoscore speichern", "Сохранить риск-скор", "Save risk score")}
                    </Button>
                  </div>
                </form>
              ) : null}
            </div>
          ) : null}

          {/* Notes */}
          {detail.notes && (
            <FormSection
              title={t.patients_notes}
              accessory={
                canEditPatientProfile ? (
                  <Button type="button" variant="outline" size="sm" className="h-9 rounded-lg gap-1.5" onClick={openProfileEditor}>
                    <Pencil className="size-3.5" />
                    {l("Bearbeiten", "Редактировать", "Edit")}
                  </Button>
                ) : null
              }
            >
              <div className="rounded-xl border border-border/50 bg-muted/25 px-4 py-4">
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{detail.notes}</p>
              </div>
            </FormSection>
          )}

          {/* Assignments */}
          <div className={card("p-6")}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-slate-950">{t.patients_assign_owner}</h2>
              <span className="text-xs text-slate-400">{assignments.length} {t.patients_records}</span>
            </div>

            {assignments.length === 0 ? (
              <p className="text-sm text-slate-500 py-4 text-center">{t.patients_no_assignments}</p>
            ) : (
              <div className="space-y-3">
                {assignments.map((item) => (
                  <div key={`${item.user_id}-${item.assigned_at}`} className="flex items-center gap-4 rounded-xl border border-slate-100 bg-white p-4">
                    <div className="flex items-center justify-center size-10 shrink-0 rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600">
                      {item.user_name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("")}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-900">{item.user_name}</span>
                        <Badge className={cn("text-[10px]", ROLE_COLORS[item.user_role] ?? "bg-slate-100 text-slate-700")}>
                          {roleLbl(item.user_role, tr)}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                        <span>{fmtDateTime(item.assigned_at)}</span>
                        <span>{t.patients_assigned_by} {item.assigned_by_name || t.common_unknown}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="outline" className={cn("rounded-full", item.revoked_at ? "border-red-200 bg-red-50 text-red-600" : "border-emerald-200 bg-emerald-50 text-emerald-700")}>
                        {item.revoked_at ? t.patients_revoked : t.common_active}
                      </Badge>
                      {canManage && !item.revoked_at && (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50"
                          onClick={async () => {
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
              <div className="mt-4 pt-4 border-t border-slate-100 flex gap-3">
                <ShadSelect value={selectedAssignee} onValueChange={(v) => setSelectedAssignee(v ?? "")}>
                  <SelectTrigger className="h-10 rounded-xl bg-slate-50 flex-1">
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
                <Button className="rounded-xl bg-slate-950 text-white hover:bg-slate-800 h-10 px-5" disabled={assignBusy || !selectedAssignee} onClick={handleAssign}>
                  {assignBusy ? <LoaderCircle className="size-4 animate-spin" /> : t.patients_assign_owner}
                </Button>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="relations" className="mt-4 min-h-[400px]">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{l("Patientenkette", "Цепочка пациента", "Patient chain")}</p>
              <h3 className="mt-1 text-sm font-semibold text-slate-950">{l("Beziehungen und Notfallkontakte", "Связи и экстренные контакты", "Relations and emergency contacts")}</h3>
            </div>
            {canManageRelations ? (
              <Button type="button" className="rounded-xl bg-slate-950 text-white hover:bg-slate-800" onClick={openCreateRelation}>
                <Plus className="mr-2 size-4" />
                {l("Neue Beziehung", "Новая связь", "New relation")}
              </Button>
            ) : null}
          </div>
          {tabLoading ? (
            <div className="flex items-center justify-center py-16"><LoaderCircle className="size-5 animate-spin text-slate-400" /></div>
          ) : relations.length === 0 ? (
            <div className={card("p-8 text-center")}><p className="text-sm text-slate-500">{l("Noch keine verknüpften Beziehungen.", "Связи пока не добавлены.", "No linked relations yet.")}</p></div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {relations.map((relation) => (
                <div key={relation.id} className={card("p-5")}>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-slate-950">{relation.related_display_name || relation.related_name}</p>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="rounded-full text-[10px]">{relation.relation_type}</Badge>
                      {relation.is_emergency_contact ? <Badge className="rounded-full bg-rose-100 text-rose-700">{l("Notfall", "Экстренно", "Emergency")}</Badge> : null}
                    </div>
                  </div>
                  <div className="mt-3 space-y-1 text-sm text-slate-600">
                    {relation.related_patient_pid ? <p className="font-mono text-xs text-slate-400">{relation.related_patient_pid}</p> : null}
                    {relation.phone ? <p>{relation.phone}</p> : null}
                    {relation.notes ? <p>{relation.notes}</p> : null}
                    <p className="text-xs text-slate-400">{fmtDateTime(relation.created_at)}</p>
                  </div>
                  {canManageRelations || relation.related_patient_id ? (
                    <div className="mt-4 flex gap-2">
                      {relation.related_patient_id ? (
                        <Button
                          type="button"
                          variant="outline"
                          className="rounded-xl"
                          onClick={() => staffGo(`/patients/${relation.related_patient_id}`)}
                        >
                          {l("Patient öffnen", "Открыть пациента", "Open patient")}
                        </Button>
                      ) : null}
                      {canManageRelations ? (
                        <>
                          <Button type="button" variant="outline" className="rounded-xl" onClick={() => openEditRelation(relation)}>
                            {l("Bearbeiten", "Редактировать", "Edit")}
                          </Button>
                          <Button type="button" variant="outline" className="rounded-xl border-rose-200 text-rose-700 hover:bg-rose-50" onClick={() => void handleDeleteRelation(relation.id)}>
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
        </TabsContent>

        {/* Cases tab */}
        <TabsContent value="cases" className="mt-4 min-h-[400px]">
          {tabLoading ? (
            <div className="flex items-center justify-center py-16"><LoaderCircle className="size-5 animate-spin text-slate-400" /></div>
          ) : cases.length === 0 ? (
            <div className={card("p-8 text-center")}><p className="text-sm text-slate-500">{t.cases_no_match}</p></div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {cases.map((c) => (
                <button key={c.id} type="button" onClick={() => staffGo(`/cases?case=${c.id}`)} className={card("p-5 text-left hover:-translate-y-0.5 hover:shadow-lg transition")}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-slate-400">{c.case_id}</span>
                    <Badge variant="outline" className={cn("rounded-full text-[10px]", STATUS_COLORS[c.status] ?? "")}>{tr[`cases_${c.status}`] ?? c.status}</Badge>
                  </div>
                  <p className="mt-2 text-sm font-medium text-slate-900">{c.hauptanfragegrund || t.common_not_set}</p>
                  <p className="mt-1 text-xs text-slate-400">{fmtDate(c.created_at)}</p>
                </button>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Orders tab */}
        <TabsContent value="orders" className="mt-4 min-h-[400px]">
          {tabLoading ? (
            <div className="flex items-center justify-center py-16"><LoaderCircle className="size-5 animate-spin text-slate-400" /></div>
          ) : orders.length === 0 ? (
            <div className={card("p-8 text-center")}><p className="text-sm text-slate-500">{t.common_not_set}</p></div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {orders.map((o) => (
                <button key={o.id} type="button" onClick={() => staffGo(`/orders?order=${o.id}`)} className={card("p-5 text-left hover:-translate-y-0.5 hover:shadow-lg transition")}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-slate-400">{o.order_number}</span>
                    <Badge variant="outline" className={cn("rounded-full text-[10px]", STATUS_COLORS[o.status] ?? "")}>{o.status}</Badge>
                  </div>
                  <p className="mt-2 text-sm font-medium text-slate-900">{o.needs_description || o.order_number}</p>
                  <div className="flex gap-2 mt-1 text-xs text-slate-400">
                    <span>{o.phase}</span>
                    <span>{fmtDate(o.created_at)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Appointments tab */}
        <TabsContent value="appointments" className="mt-4 min-h-[400px]">
          {tabLoading ? (
            <div className="flex items-center justify-center py-16"><LoaderCircle className="size-5 animate-spin text-slate-400" /></div>
          ) : appointments.length === 0 ? (
            <div className={card("p-8 text-center")}><p className="text-sm text-slate-500">{t.common_not_set}</p></div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {appointments.map((a) => (
                <button key={a.id} type="button" onClick={() => staffGo(`/appointments?appointment=${a.id}`)} className={card("p-5 text-left hover:-translate-y-0.5 hover:shadow-lg transition")}>
                  <div className="flex items-center justify-between">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-slate-400">{a.apt_type}</span>
                      <Badge variant="outline" className="rounded-full text-[10px] border-violet-200 bg-violet-50 text-violet-700">
                        {appointmentCarePathKindLabel(a.care_path_kind)}
                      </Badge>
                    </div>
                    <Badge variant="outline" className={cn("rounded-full text-[10px]", STATUS_COLORS[a.status] ?? "")}>{a.status}</Badge>
                  </div>
                  <p className="mt-2 text-sm font-medium text-slate-900">{a.title}</p>
                  <div className="flex gap-2 mt-1 text-xs text-slate-400">
                    <span>{fmtDate(a.date)}</span>
                    {a.time_start && <span>{a.time_start}</span>}
                    {a.provider_name && <span>· {a.provider_name}</span>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Documents tab */}
        <TabsContent value="documents" className="mt-4 min-h-[400px]">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{l("Patientenakten", "Файлы пациента", "Patient files")}</p>
              <h3 className="mt-1 text-sm font-semibold text-slate-950">{l("Dokumente zu diesem Patienten", "Документы этого пациента", "Documents linked to this patient")}</h3>
            </div>
            <div className="flex flex-wrap gap-2">
              {canOpenDocumentsWorkspace ? (
                <Button type="button" variant="outline" className="rounded-xl" onClick={() => staffGo(`/documents?patient=${id}`)}>
                  {l("Bereich öffnen", "Открыть раздел", "Open workspace")}
                </Button>
              ) : null}
              {canManageDocuments ? (
                <Button type="button" className="rounded-xl bg-slate-950 text-white hover:bg-slate-800" onClick={() => setDocumentUploadOpen(true)}>
                  <Plus className="mr-2 size-4" />
                  {l("Dokument hochladen", "Загрузить документ", "Upload document")}
                </Button>
              ) : null}
            </div>
          </div>
          {!tabLoading && documentAlerts && documentAlerts.configured_rule_count > 0 ? (
            <div
              className={cn(
                "mb-4 rounded-[1.6rem] border px-5 py-4",
                documentAlerts.document_pack_complete
                  ? "border-emerald-200 bg-emerald-50"
                  : "border-amber-200 bg-amber-50"
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    {l("Erforderliche Dokumente", "Обязательные документы", "Required documents")}
                  </p>
                  <h4 className="mt-1 text-sm font-semibold text-slate-950">
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
                      className="rounded-full border-amber-300 bg-white text-amber-800"
                    >
                      {item.label}
                    </Badge>
                  ))}
                </div>
              ) : null}
              {documentAlerts.out_of_sync ? (
                <p className="mt-3 text-xs text-slate-600">
                  {l(
                    "Das gespeicherte Compliance-Flag für „Dokumentenpaket vollständig“ stimmt nicht mit dem aktuellen Dokumentbestand überein.",
                    "Сохранённый флаг compliance для «пакет документов собран» не совпадает с текущим составом документов.",
                    "The stored compliance flag for “Document pack complete” is not aligned with the current document inventory.",
                  )}
                </p>
              ) : null}
            </div>
          ) : null}
          {tabLoading ? (
            <div className="flex items-center justify-center py-16"><LoaderCircle className="size-5 animate-spin text-slate-400" /></div>
          ) : documents.length === 0 ? (
            <div className={card("p-8 text-center")}><p className="text-sm text-slate-500">{t.common_not_set}</p></div>
          ) : (
            <div className={card("overflow-hidden")}>
              <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-3 px-5 py-3 border-b bg-slate-900">
                {[t.documents_filename, t.appointments_type, t.users_status, t.patients_assigned_by, t.users_created].map((h) => (
                  <span key={h} className="text-[11px] font-semibold uppercase tracking-wider text-white/80">{h}</span>
                ))}
              </div>
              {documents.map((doc, idx) => (
                <div
                  key={doc.id}
                  className={cn(
                    "grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-3 items-center px-5 py-3 hover:bg-slate-50/60 transition-colors cursor-pointer",
                    idx < documents.length - 1 && "border-b border-border/30"
                  )}
                  onClick={() => window.open(buildApiUrl(`/documents/${doc.id}/download`), "_blank")}
                >
                  <span className="text-sm font-medium text-slate-900 truncate">{doc.filename}</span>
                  <span className="text-xs text-slate-500">{doc.category ?? t.common_not_set}</span>
                  <Badge variant="outline" className={cn("rounded-full text-[10px] w-fit", STATUS_COLORS[doc.status ?? ""] ?? "border-slate-200 bg-slate-50 text-slate-600")}>
                    {doc.status ? patientDetailStatusLabel(doc.status) : t.common_not_set}
                  </Badge>
                  <span className="text-xs text-slate-500">{doc.uploaded_by_name ?? t.common_unknown}</span>
                  <span className="text-xs text-slate-400">{fmtDate(doc.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {canViewContracts ? <TabsContent value="contracts" className="mt-4 min-h-[400px]">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{l("Rahmenabrechnung", "Рамочное биллинг-сопровождение", "Framework billing")}</p>
              <h3 className="mt-1 text-sm font-semibold text-slate-950">{l("Verträge dieses Patienten", "Договоры этого пациента", "Contracts for this patient")}</h3>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" className="rounded-xl" onClick={() => staffGo(`/contracts?patient=${id}`)}>
                {l("Bereich öffnen", "Открыть раздел", "Open workspace")}
              </Button>
              {canManageContracts ? (
                <Button type="button" className="rounded-xl bg-slate-950 text-white hover:bg-slate-800" onClick={() => setContractCreateOpen(true)}>
                  <Plus className="mr-2 size-4" />
                  {l("Neuer Vertrag", "Новый договор", "New contract")}
                </Button>
              ) : null}
            </div>
          </div>
          {tabLoading ? (
            <div className="flex items-center justify-center py-16"><LoaderCircle className="size-5 animate-spin text-slate-400" /></div>
          ) : contracts.length === 0 ? (
            <div className={card("p-8 text-center")}><p className="text-sm text-slate-500">{l("Noch keine Rahmenverträge.", "Рамочных договоров пока нет.", "No framework contracts yet.")}</p></div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {contracts.map((contract) => (
                <div
                  key={contract.id}
                  className={card("p-5")}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-mono text-slate-400">{contract.contract_number}</span>
                    <Badge variant="outline" className={cn("rounded-full text-[10px]", STATUS_COLORS[contract.status] ?? "")}>
                      {patientDetailStatusLabel(contract.status)}
                    </Badge>
                  </div>
                  <div className="mt-3 grid gap-2 text-sm text-slate-600">
                    <p>{l("Unterzeichnet", "Подписано", "Signed")}: {fmtDateTime(contract.signed_at, t.common_not_set)}</p>
                    <p>{l("Gültig ab", "Действует с", "Valid from")}: {fmtDate(contract.valid_from, t.common_not_set)}</p>
                    <p>{l("Gültig bis", "Действует до", "Valid to")}: {fmtDate(contract.valid_to, t.common_not_set)}</p>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button type="button" variant="outline" className="rounded-xl" onClick={() => staffGo(`/contracts?contract=${contract.id}`)}>
                      {l("Öffnen", "Открыть", "Open")}
                    </Button>
                    {canManageContracts ? (
                      <Button type="button" variant="outline" className="rounded-xl" onClick={() => openContractStatusEditor(contract)}>
                        {l("Status aktualisieren", "Обновить статус", "Update status")}
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent> : null}

        {canViewInvoices ? <TabsContent value="invoices" className="mt-4 min-h-[400px]">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{l("Patientenabrechnung", "Биллинг пациента", "Patient billing")}</p>
              <h3 className="mt-1 text-sm font-semibold text-slate-950">{l("Rechnungen und Zahlungsnachverfolgung", "Счета и контроль оплат", "Invoices and payment follow-up")}</h3>
            </div>
            <Button type="button" variant="outline" className="rounded-xl" onClick={() => staffGo(`/invoices?patient=${id}`)}>
              {l("Bereich öffnen", "Открыть раздел", "Open workspace")}
            </Button>
          </div>
          {tabLoading ? (
            <div className="flex items-center justify-center py-16"><LoaderCircle className="size-5 animate-spin text-slate-400" /></div>
          ) : invoices.length === 0 ? (
            <div className={card("p-8 text-center")}><p className="text-sm text-slate-500">{l("Noch keine Rechnungen.", "Счетов пока нет.", "No invoices yet.")}</p></div>
          ) : (
            <div className="space-y-3">
              {invoices.map((invoice) => (
                <div
                  key={invoice.id}
                  className={card("w-full p-5 text-left")}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-mono text-slate-400">{invoice.invoice_number}</span>
                      <Badge variant="outline" className={cn("rounded-full text-[10px]", STATUS_COLORS[invoice.status] ?? "")}>
                        {patientDetailStatusLabel(invoice.status)}
                      </Badge>
                    </div>
                    <p className="text-xs text-slate-400">{fmtDateTime(invoice.issued_at)}</p>
                  </div>
                  <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4 text-sm text-slate-600">
                    <p>{l("Typ", "Тип", "Type")}: {invoice.invoice_type}</p>
                    <p>{l("Gesamt", "Итого", "Total")}: {fmtMoney(invoice.total_gross)}</p>
                    <p>{l("Bezahlt", "Оплачено", "Paid")}: {fmtMoney(invoice.paid_amount)}</p>
                    <p>{l("Offen", "Остаток", "Open")}: {fmtMoney(invoice.balance_due)}</p>
                    <p>{l("Fällig", "Срок", "Due")}: {fmtDate(invoice.due_date, t.common_not_set)}</p>
                    <p>{l("Auftrag", "Заказ", "Order")}: {invoice.order_number ?? t.common_not_set}</p>
                    <p>{l("Angebot", "Смета", "Quote")}: {invoice.quote_number ?? t.common_not_set}</p>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button type="button" variant="outline" className="rounded-xl" onClick={() => staffGo(`/invoices?invoice=${invoice.id}`)}>
                      {l("Öffnen", "Открыть", "Open")}
                    </Button>
                    {canManageInvoices ? (
                      <Button type="button" variant="outline" className="rounded-xl" onClick={() => openInvoiceManager(invoice)}>
                        {l("Billing verwalten", "Управлять биллингом", "Manage billing")}
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent> : null}

        <TabsContent value="workflow" className="mt-4 min-h-[400px]">
          {tabLoading ? (
            <div className="flex items-center justify-center py-16">
              <LoaderCircle className="size-5 animate-spin text-slate-400" />
            </div>
          ) : !workflowChecklist || workflowChecklist.items.length === 0 ? (
            <div className={card("p-8 text-center")}>
              <p className="text-sm text-slate-500">
                No patient workflow checklist yet.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <div className={card("p-4")}>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Open items
                  </p>
                  <p className="mt-3 text-2xl font-semibold text-slate-950">
                    {workflowChecklist.open_count}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Live patient-bound workflow tasks.
                  </p>
                </div>
                <div className={card("p-4")}>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Completed
                  </p>
                  <p className="mt-3 text-2xl font-semibold text-slate-950">
                    {workflowChecklist.completed_count}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Checklist steps already closed.
                  </p>
                </div>
                <div className={card("p-4")}>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Groups
                  </p>
                  <p className="mt-3 text-2xl font-semibold text-slate-950">
                    {workflowChecklistGroups.length}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Patient intake plus custom workstreams.
                  </p>
                </div>
              </div>

              {workflowChecklistGroups.map((group) => (
                <div key={group.key} className={card("p-5")}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                        {group.label}
                      </p>
                      <h3 className="mt-1 text-sm font-semibold text-slate-950">
                        {group.items.filter((item) => !item.is_completed).length} open /{" "}
                        {group.items.length} total
                      </h3>
                    </div>
                    <Badge variant="outline" className="rounded-full border-slate-200 bg-slate-50 text-slate-700">
                      {group.items.length} items
                    </Badge>
                  </div>
                  <div className="mt-4 space-y-3">
                    {group.items.map((item) => (
                      <div
                        key={item.id}
                        className={cn(
                          "rounded-2xl border px-4 py-4",
                          item.is_completed
                            ? "border-emerald-200 bg-emerald-50/60"
                            : "border-slate-200 bg-white"
                        )}
                      >
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-medium text-slate-950">
                                {item.item_text}
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
                                        "border-slate-200 bg-slate-50 text-slate-600"
                                )}
                              >
                                {item.is_completed
                                  ? patientDetailStatusLabel("completed")
                                  : patientDetailStatusLabel(item.linked_task_status ?? "open")}
                              </Badge>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
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
                              className="rounded-xl"
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
                </div>
              ))}
            </div>
          )}

          {canManageWorkflowChecklist ? (
            <form onSubmit={handleAddWorkflowItem} className={cn(card("mt-4 p-5"), "space-y-4")}>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  {l("Workflow-Element hinzufügen", "Добавить элемент workflow", "Add workflow item")}
                </p>
                <h3 className="mt-1 text-sm font-semibold text-slate-950">
                  {l(
                    "Erweitern Sie die Checkliste des Patienten, ohne das Profil zu verlassen.",
                    "Расширяйте чеклист пациента, не покидая профиль.",
                    "Extend the patient checklist without leaving the profile.",
                  )}
                </h3>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="patient-workflow-item-text">{l("Checklistenpunkt", "Пункт чеклиста", "Checklist item")}</Label>
                  <Input
                    id="patient-workflow-item-text"
                    value={workflowForm.itemText}
                    onChange={(event) =>
                      setWorkflowForm((current) => ({
                        ...current,
                        itemText: event.target.value,
                      }))
                    }
                    className="h-10 rounded-xl bg-slate-50"
                    placeholder={l(
                      "Nachverfolgung, PM-Anruf, Concierge-Handoff dokumentieren...",
                      "Документируйте follow-up, звонок PM, передачу concierge...",
                      "Document follow-up, PM call, concierge handoff...",
                    )}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="patient-workflow-owner">{l("Verantwortlich", "Ответственный", "Owner")}</Label>
                  <select
                    id="patient-workflow-owner"
                    className={selectClassName}
                    value={workflowForm.ownerUserId}
                    onChange={(event) =>
                      setWorkflowForm((current) => ({
                        ...current,
                        ownerUserId: event.target.value,
                      }))
                    }
                  >
                    <option value="">{l("Aktueller Benutzer", "Текущий пользователь", "Current user")}</option>
                    {activeWorkflowAssignees.map((item) => (
                      <option key={item.user_id} value={item.user_id}>
                        {item.user_name} · {roleLbl(item.user_role, tr)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="patient-workflow-priority">{l("Priorität", "Приоритет", "Priority")}</Label>
                  <select
                    id="patient-workflow-priority"
                    className={selectClassName}
                    value={workflowForm.priority}
                    onChange={(event) =>
                      setWorkflowForm((current) => ({
                        ...current,
                        priority: event.target.value,
                      }))
                    }
                  >
                    {["low", "normal", "high", "urgent"].map((priority) => (
                      <option key={priority} value={priority}>
                        {priorityLabel(priority)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="patient-workflow-due">{l("Fällig am", "Срок до", "Due at")}</Label>
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
                    className="h-10 rounded-xl bg-slate-50"
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <Button
                  type="submit"
                  className="rounded-xl bg-slate-950 text-white hover:bg-slate-800"
                  disabled={workflowBusy || !workflowForm.itemText.trim()}
                >
                  {workflowBusy ? (
                    <LoaderCircle className="mr-2 size-4 animate-spin" />
                  ) : null}
                  {l("Workflow-Element hinzufügen", "Добавить элемент workflow", "Add workflow item")}
                </Button>
              </div>
            </form>
          ) : null}
        </TabsContent>

        <TabsContent value="timeline" className="mt-4 min-h-[400px]">
          {tabLoading ? (
            <div className="flex items-center justify-center py-16"><LoaderCircle className="size-5 animate-spin text-slate-400" /></div>
          ) : timeline.length === 0 ? (
            <div className={card("p-8 text-center")}><p className="text-sm text-slate-500">{l("Noch keine Zeitachsen-Ereignisse.", "Событий таймлайна пока нет.", "No timeline events yet.")}</p></div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className={card("p-4")}>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{l("Ereignisse gesamt", "Всего событий", "Total events")}</p>
                  <p className="mt-3 text-2xl font-semibold text-slate-950">{timelineSummary.total}</p>
                  <p className="mt-1 text-xs text-slate-500">{l("Alle erfassten Touchpoints im Patienten-Workflow.", "Все зафиксированные точки касания в workflow пациента.", "All recorded patient workflow touchpoints.")}</p>
                </div>
                <div className={card("p-4")}>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{l("Offene Punkte", "Открытые пункты", "Open items")}</p>
                  <p className="mt-3 text-2xl font-semibold text-slate-950">{timelineSummary.open}</p>
                  <p className="mt-1 text-xs text-slate-500">{l("Ereignisse, die noch operative Nachverfolgung erfordern.", "События, которые всё ещё требуют операционного follow-up.", "Events that still require operational follow-through.")}</p>
                </div>
                <div className={card("p-4")}>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{l("Letzte 30 Tage", "Последние 30 дней", "Last 30 days")}</p>
                  <p className="mt-3 text-2xl font-semibold text-slate-950">{timelineSummary.recent}</p>
                  <p className="mt-1 text-xs text-slate-500">{l("Aktuelle Bewegung über Behandlung, Billing und Dokumente.", "Недавняя активность по лечению, billing и документам.", "Recent movement across care, billing and documents.")}</p>
                </div>
                <div className={card("p-4")}>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{l("Aktive Bereiche", "Активные домены", "Domains active")}</p>
                  <p className="mt-3 text-2xl font-semibold text-slate-950">{timelineSummary.entityCounts.length}</p>
                  <p className="mt-1 text-xs text-slate-500">{l("Eindeutige Workstreams, die diesen Patienten bereits berühren.", "Уникальные потоки работы, которые уже затрагивают этого пациента.", "Unique workstreams already touching this patient.")}</p>
                </div>
              </div>

              <div className={card("p-4")}>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant={timelineEntityFilter === "all" ? "default" : "outline"}
                    className={cn(
                      "rounded-full",
                      timelineEntityFilter === "all"
                        ? "bg-slate-950 text-white hover:bg-slate-800"
                        : ""
                    )}
                    onClick={() => setTimelineEntityFilter("all")}
                  >
                    {l("Alle", "Все", "All")} · {timelineTotal}
                  </Button>
                  {timelineSummary.entityCounts.map((entry) => (
                    <Button
                      key={entry.entityType}
                      type="button"
                      variant={timelineEntityFilter === entry.entityType ? "default" : "outline"}
                      className={cn(
                        "rounded-full",
                        timelineEntityFilter === entry.entityType
                          ? "bg-slate-950 text-white hover:bg-slate-800"
                          : ""
                      )}
                      onClick={() => setTimelineEntityFilter(entry.entityType)}
                    >
                      {entry.entityType} · {entry.count}
                    </Button>
                  ))}
                </div>
                <div className="mt-4 grid gap-3 lg:grid-cols-[180px_220px_240px_minmax(0,1fr)_auto]">
                  <ShadSelect value={timelineRangeFilter} onValueChange={(value) => setTimelineRangeFilter((value as PatientTimelineRangeFilter) ?? "all")}>
                    <SelectTrigger className="h-10 rounded-xl bg-slate-50">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {localizedTimelineRangeOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </ShadSelect>
                  <ShadSelect value={timelineCategoryFilter} onValueChange={(value) => setTimelineCategoryFilter(value ?? "all")}>
                    <SelectTrigger className="h-10 rounded-xl bg-slate-50">
                      <SelectValue placeholder={t.providers_all} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{l("Alle Kategorien", "Все категории", "All categories")}</SelectItem>
                      {timelineCategoryOptions.map((category) => (
                        <SelectItem key={category} value={category}>
                          {category}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </ShadSelect>
                  <ShadSelect value={timelineSourceFilter} onValueChange={(value) => setTimelineSourceFilter(value ?? "all")}>
                    <SelectTrigger className="h-10 rounded-xl bg-slate-50">
                      <SelectValue placeholder={t.providers_all} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{l("Alle Quellen", "Все источники", "All sources")}</SelectItem>
                      {timelineSourceOptions.map((source) => (
                        <SelectItem key={source} value={source}>
                          {source}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </ShadSelect>
                  <Input
                    value={timelineSearch}
                    onChange={(event) => setTimelineSearch(event.target.value)}
                    placeholder={t.common_search}
                    className="w-full"
                  />
                  {hasTimelineFilters ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-xl"
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
              </div>

              {filteredTimeline.length === 0 ? (
                <div className={card("p-8 text-center")}>
                  <p className="text-sm text-slate-500">{l("Keine Zeitachsen-Ereignisse entsprechen den aktuellen Filtern.", "Текущим фильтрам не соответствует ни одно событие таймлайна.", "No timeline events match the current filters.")}</p>
                </div>
              ) : (
                <div className="space-y-3">
              <div className={card("flex items-center justify-between gap-3 p-4")}>
                <p className="text-sm text-slate-500">
                  {l("Angezeigt", "Показаны", "Showing")} {timelineTotal === 0 ? 0 : timelineOffset + 1}-
                  {timelineTotal === 0
                    ? 0
                    : Math.min(timelineOffset + timeline.length, timelineTotal)}{" "}
                  {l("von", "из", "of")} {timelineTotal}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-xl"
                    disabled={timelineOffset === 0}
                    onClick={() => setTimelineOffset((current) => Math.max(0, current - timelineLimit))}
                  >
                    {l("Zurück", "Назад", "Previous")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-xl"
                    disabled={!timelineHasNextPage}
                    onClick={() => setTimelineOffset((current) => current + timelineLimit)}
                  >
                    {l("Weiter", "Далее", "Next")}
                  </Button>
                </div>
              </div>
              {filteredTimeline.map((item) => {
                const route = resolvePatientTimelineRoute(item, {
                  canOpenDocumentsWorkspace,
                  canViewContracts,
                  canViewInvoices,
                  canOpenComplianceWorkspace,
                });

                return (
                  <button
                    key={`${item.entity_type}-${item.entity_id}`}
                    type="button"
                    onClick={() => {
                      if (route) {
                        staffGo(route);
                      }
                    }}
                    className={card(
                      cn(
                        "w-full p-5 text-left transition",
                        route ? "hover:-translate-y-0.5 hover:shadow-lg" : ""
                      )
                    )}
                  >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="rounded-full text-[10px]">{item.entity_type}</Badge>
                      <Badge variant="outline" className={cn("rounded-full text-[10px]", STATUS_COLORS[item.status] ?? "")}>{patientDetailStatusLabel(item.status)}</Badge>
                    </div>
                    <p className="text-xs text-slate-400">{fmtDateTime(item.happened_at)}</p>
                  </div>
                  <p className="mt-3 text-sm font-semibold text-slate-950">{item.title}</p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                    <span>{item.category}</span>
                    {item.source_label ? <span>· {item.source_label}</span> : null}
                  </div>
                  </button>
                );
              })}
                </div>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Sheet open={profileEditorOpen} onOpenChange={setProfileEditorOpen}>
        <SheetContent side="right" className="w-full sm:max-w-[860px]">
          {profileEditForm ? (
            <form className="flex flex-col flex-1 min-h-0" onSubmit={handleSavePatientProfile}>
              <SheetHeader className="shrink-0 px-4 pt-3 pb-1">
                <SheetTitle>{l("Patientenprofil bearbeiten", "Редактировать профиль пациента", "Edit patient profile")}</SheetTitle>
              </SheetHeader>

              <div className="flex-1 overflow-y-auto px-4 py-2 space-y-3">
                <FormSection title={l("Persönliche Daten", "Личные данные", "Personal data")}>
                  <div className="grid gap-3 md:grid-cols-3">
                    <FormField label={l("Titel", "Обращение", "Title")}>
                      <Input value={profileEditForm.title} onChange={(event) => setProfileEditForm((current) => current ? { ...current, title: event.target.value } : current)} className={formInputClassName} />
                    </FormField>
                    <FormField label={l("Vorname", "Имя", "First name")}>
                      <Input value={profileEditForm.firstName} onChange={(event) => setProfileEditForm((current) => current ? { ...current, firstName: event.target.value } : current)} required className={formInputClassName} />
                    </FormField>
                    <FormField label={l("Nachname", "Фамилия", "Last name")}>
                      <Input value={profileEditForm.lastName} onChange={(event) => setProfileEditForm((current) => current ? { ...current, lastName: event.target.value } : current)} required className={formInputClassName} />
                    </FormField>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <FormField label={l("Nationalität", "Гражданство", "Nationality")}>
                      <Input value={profileEditForm.nationality} onChange={(event) => setProfileEditForm((current) => current ? { ...current, nationality: event.target.value } : current)} className={formInputClassName} />
                    </FormField>
                    <FormField label={l("Wohnsitzland", "Страна проживания", "Residence country")}>
                      <Input value={profileEditForm.residenceCountry} onChange={(event) => setProfileEditForm((current) => current ? { ...current, residenceCountry: event.target.value } : current)} className={formInputClassName} />
                    </FormField>
                  </div>
                  <FormField label={l("Sprachen", "Языки", "Languages")}>
                    <Input value={profileEditForm.languages} onChange={(event) => setProfileEditForm((current) => current ? { ...current, languages: event.target.value } : current)} placeholder="de, uk, en" className={formInputClassName} />
                  </FormField>
                  <FormField label={l("Funktionale Labels", "Функциональные метки", "Functional labels")}>
                    <FunctionalLabelChips
                      value={profileEditForm.functionalLabels}
                      onChange={(next) => setProfileEditForm((current) => current ? { ...current, functionalLabels: next } : current)}
                    />
                  </FormField>
                </FormSection>

                <FormSection title={l("Kontakt", "Контакты", "Contact")}>
                  <div className="grid gap-3 md:grid-cols-3">
                    <FormField label={l("Primäre Telefonnummer", "Основной телефон", "Primary phone")}>
                      <Input value={profileEditForm.phonePrimary} onChange={(event) => setProfileEditForm((current) => current ? { ...current, phonePrimary: event.target.value } : current)} className={formInputClassName} />
                    </FormField>
                    <FormField label={l("Sekundäre Telefonnummer", "Доп. телефон", "Secondary phone")}>
                      <Input value={profileEditForm.phoneSecondary} onChange={(event) => setProfileEditForm((current) => current ? { ...current, phoneSecondary: event.target.value } : current)} className={formInputClassName} />
                    </FormField>
                    <FormField label={l("E-Mail", "Эл. почта", "Email")}>
                      <Input type="email" value={profileEditForm.email} onChange={(event) => setProfileEditForm((current) => current ? { ...current, email: event.target.value } : current)} className={formInputClassName} />
                    </FormField>
                  </div>
                </FormSection>

                <FormSection title={l("Adresse", "Адрес", "Address")}>
                  <FormField label={l("Straße", "Улица", "Street")}>
                    <Input value={profileEditForm.addressStreet} onChange={(event) => setProfileEditForm((current) => current ? { ...current, addressStreet: event.target.value } : current)} className={formInputClassName} />
                  </FormField>
                  <div className="grid gap-3 md:grid-cols-3">
                    <FormField label={l("Stadt", "Город", "City")}>
                      <Input value={profileEditForm.addressCity} onChange={(event) => setProfileEditForm((current) => current ? { ...current, addressCity: event.target.value } : current)} className={formInputClassName} />
                    </FormField>
                    <FormField label={l("PLZ", "Индекс", "ZIP")}>
                      <Input value={profileEditForm.addressZip} onChange={(event) => setProfileEditForm((current) => current ? { ...current, addressZip: event.target.value } : current)} className={formInputClassName} />
                    </FormField>
                    <FormField label={l("Adressland", "Страна адреса", "Address country")}>
                      <Input value={profileEditForm.addressCountry} onChange={(event) => setProfileEditForm((current) => current ? { ...current, addressCountry: event.target.value } : current)} className={formInputClassName} />
                    </FormField>
                  </div>
                </FormSection>

                <FormSection title={l("Versicherung", "Страхование", "Insurance")}>
                  <div className="grid gap-3 md:grid-cols-3">
                    <FormField label={l("Versicherer", "Страховая компания", "Insurance provider")}>
                      <Input value={profileEditForm.insuranceProvider} onChange={(event) => setProfileEditForm((current) => current ? { ...current, insuranceProvider: event.target.value } : current)} className={formInputClassName} />
                    </FormField>
                    <FormField label={l("Versicherungsnummer", "Номер полиса", "Insurance number")}>
                      <Input value={profileEditForm.insuranceNumber} onChange={(event) => setProfileEditForm((current) => current ? { ...current, insuranceNumber: event.target.value } : current)} className={formInputClassName} />
                    </FormField>
                    <FormField label={l("Versicherungstyp", "Тип страхования", "Insurance type")}>
                      <ShadSelect value={profileEditForm.insuranceType} onValueChange={(v) => setProfileEditForm((current) => current ? { ...current, insuranceType: v ?? "" } : current)}>
                        <SelectTrigger className={cn("w-full", formInputClassName)}>
                          <SelectValue>
                            {(() => {
                              switch (profileEditForm.insuranceType) {
                                case "private": return l("Privat", "Частная", "Private");
                                case "public": return l("Gesetzlich", "Государственная", "Public");
                                case "self_pay": return l("Selbstzahler", "Самооплата", "Self pay");
                                case "foreign": return l("Ausland", "Иностранная", "Foreign");
                                default: return t.common_not_set;
                              }
                            })()}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">{t.common_not_set}</SelectItem>
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
                      <Input value={profileEditForm.emergencyContactName} onChange={(event) => setProfileEditForm((current) => current ? { ...current, emergencyContactName: event.target.value } : current)} className={formInputClassName} />
                    </FormField>
                    <FormField label={l("Notfalltelefon", "Телефон", "Phone")}>
                      <Input value={profileEditForm.emergencyContactPhone} onChange={(event) => setProfileEditForm((current) => current ? { ...current, emergencyContactPhone: event.target.value } : current)} className={formInputClassName} />
                    </FormField>
                    <FormField label={l("Beziehung", "Связь", "Relation")}>
                      <Input value={profileEditForm.emergencyContactRelation} onChange={(event) => setProfileEditForm((current) => current ? { ...current, emergencyContactRelation: event.target.value } : current)} className={formInputClassName} />
                    </FormField>
                  </div>
                </FormSection>

                <FormSection
                  title={t.patients_legal_status}
                  accessory={<LegalStatusPill status={profileEditForm.legalStatus} />}
                >
                  <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                    {[
                      { key: "dsgvoSigned", label: l("DSGVO unterschrieben", "DSGVO подписано", "DSGVO signed") },
                      { key: "confidentialityReleaseSigned", label: l("Schweigepflicht freigegeben", "Снятие врачебной тайны", "Confidentiality released") },
                      { key: "identityVerified", label: l("Identität bestätigt", "Личность подтверждена", "Identity verified") },
                      { key: "documentPackComplete", label: l("Dokumentenpaket vollständig", "Пакет документов собран", "Document pack complete") },
                      { key: "complianceCompleted", label: l("Bereit bestätigt", "Готовность подтверждена", "Readiness confirmed") },
                    ].map((item) => {
                      const k = item.key as keyof typeof profileEditForm.legalStatus;
                      const checked = Boolean(profileEditForm.legalStatus[k]);
                      return (
                        <label
                          key={item.key}
                          className="flex items-center gap-2 rounded-lg border border-border/50 bg-card px-2.5 py-2 text-[12.5px] text-foreground cursor-pointer hover:bg-muted/40 transition-colors"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) =>
                              setProfileEditForm((current) =>
                                current
                                  ? {
                                      ...current,
                                      legalStatus: { ...current.legalStatus, [item.key]: event.target.checked },
                                    }
                                  : current
                              )
                            }
                            className="size-3.5 accent-[var(--brand)] cursor-pointer"
                          />
                          {item.label}
                        </label>
                      );
                    })}
                  </div>
                  <FormField label={l("Vertragsstatus", "Статус договора", "Contract status")}>
                    <ShadSelect
                      value={profileEditForm.legalStatus.contractStatus}
                      onValueChange={(v) =>
                        setProfileEditForm((current) =>
                          current
                            ? { ...current, legalStatus: { ...current.legalStatus, contractStatus: v ?? "" } }
                            : current
                        )
                      }
                    >
                      <SelectTrigger className={cn("w-full", formInputClassName)}>
                        <SelectValue>
                          {patientDetailStatusLabel(profileEditForm.legalStatus.contractStatus)}
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
                      value={profileEditForm.legalStatus.notes}
                      onChange={(event) =>
                        setProfileEditForm((current) =>
                          current
                            ? { ...current, legalStatus: { ...current.legalStatus, notes: event.target.value } }
                            : current
                        )
                      }
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
                    value={profileEditForm.clinicalWarnings}
                    onChange={(event) =>
                      setProfileEditForm((current) =>
                        current ? { ...current, clinicalWarnings: event.target.value } : current
                      )
                    }
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
                    value={profileEditForm.notes}
                    onChange={(event) =>
                      setProfileEditForm((current) =>
                        current ? { ...current, notes: event.target.value } : current
                      )
                    }
                  />
                </FormSection>
              </div>

              <div className="shrink-0 flex justify-end gap-2 px-4 py-3 bg-popover">
                <Button type="button" variant="outline" className="h-9 rounded-lg" onClick={() => setProfileEditorOpen(false)}>
                  {l("Abbrechen", "Отмена", "Cancel")}
                </Button>
                <Button type="submit" className="h-9 rounded-lg gap-1.5 px-3.5" disabled={profileEditorBusy}>
                  {profileEditorBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                  {l("Patient speichern", "Сохранить пациента", "Save patient")}
                </Button>
              </div>
            </form>
          ) : null}
        </SheetContent>
      </Sheet>

      <Dialog open={relationEditorOpen} onOpenChange={setRelationEditorOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingRelation ? l("Beziehung bearbeiten", "Редактировать связь", "Edit relation") : l("Beziehung hinzufügen", "Добавить связь", "Add relation")}</DialogTitle>
            <DialogDescription>
              {l(
                "Hinterlegen Sie Angehörige, Betreuungspersonen und Notfallkontakte direkt im Patientenprofil.",
                "Храните родственников, опекунов и экстренные контакты прямо в профиле пациента.",
                "Keep relatives, caregivers and emergency contacts directly on the patient profile.",
              )}
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleSaveRelation}>
            <div className={card("p-4")}>
              <div className="grid gap-4 md:grid-cols-[1.2fr_1.8fr]">
                <div className="space-y-2">
                  <Label htmlFor="relation-patient-search">{l("Bestehenden Patienten suchen", "Поиск существующего пациента", "Search existing patient")}</Label>
                  <Input
                    id="relation-patient-search"
                    value={relationPatientSearch}
                    onChange={(event) => setRelationPatientSearch(event.target.value)}
                    placeholder={l("PID oder Patientenname", "PID или имя пациента", "PID or patient name")}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="relation-linked-patient">{l("Patient im System verknüpfen", "Связать пациента в системе", "Link patient in system")}</Label>
                  <select
                    id="relation-linked-patient"
                    className={selectClassName}
                    value={relationForm.relatedPatientId}
                    onChange={(event) => {
                      const nextPatientId = event.target.value;
                      const selectedPatient =
                        relationPatientOptions.find((option) => option.id === nextPatientId) ?? null;
                      setRelationPatientSearch(
                        selectedPatient ? formatRelatedPatientOption(selectedPatient) : ""
                      );
                      setRelationForm((current) => ({
                        ...current,
                        relatedPatientId: nextPatientId,
                        relatedName: selectedPatient
                          ? formatRelatedPatientName(selectedPatient)
                          : current.relatedName,
                      }));
                    }}
                    disabled={relationPatientOptionsLoading}
                  >
                    <option value="">Standalone contact</option>
                    {relationPatientOptionsFiltered.map((option) => (
                      <option key={option.id} value={option.id}>
                        {formatRelatedPatientOption(option)}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-slate-500">
                    {relationPatientOptionsLoading
                      ? "Loading patient directory..."
                      : selectedRelatedPatient
                        ? "Linked relations stay synced to an existing patient record."
                        : "Keep this empty for relatives or caregivers who are not patients in the system."}
                  </p>
                </div>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="relation-name">Name</Label>
                <Input
                  id="relation-name"
                  value={relationForm.relatedName}
                  onChange={(event) => setRelationForm((current) => ({ ...current, relatedName: event.target.value }))}
                  placeholder="Relative or caregiver name"
                  disabled={Boolean(relationForm.relatedPatientId)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="relation-type">Relation type</Label>
                <select
                  id="relation-type"
                  className={selectClassName}
                  value={relationForm.relationType}
                  onChange={(event) => setRelationForm((current) => ({ ...current, relationType: event.target.value }))}
                >
                  {RELATION_TYPE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="relation-phone">Phone</Label>
                <Input
                  id="relation-phone"
                  value={relationForm.phone}
                  onChange={(event) => setRelationForm((current) => ({ ...current, phone: event.target.value }))}
                  placeholder="+49 ..."
                />
              </div>
              <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={relationForm.isEmergencyContact}
                  onChange={(event) =>
                    setRelationForm((current) => ({
                      ...current,
                      isEmergencyContact: event.target.checked,
                    }))
                  }
                />
                {l("Notfallkontakt", "Экстренный контакт", "Emergency contact")}
              </label>
            </div>
            <div className="space-y-2">
              <Label htmlFor="relation-notes">{l("Notizen", "Заметки", "Notes")}</Label>
              <textarea
                id="relation-notes"
                className={textareaClassName}
                value={relationForm.notes}
                onChange={(event) => setRelationForm((current) => ({ ...current, notes: event.target.value }))}
                placeholder={l(
                  "Erreichbarkeit, Kontakthinweise oder besondere Anweisungen",
                  "Доступность, заметки по контакту или особые инструкции",
                  "Availability, contact notes or special instructions",
                )}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" className="rounded-xl" onClick={() => setRelationEditorOpen(false)}>
                {l("Abbrechen", "Отмена", "Cancel")}
              </Button>
              <Button type="submit" className="rounded-xl bg-slate-950 text-white hover:bg-slate-800" disabled={relationBusy}>
                {relationBusy ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
                {editingRelation ? t.common_save : t.common_save}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={documentUploadOpen} onOpenChange={setDocumentUploadOpen}>
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
          <form className="space-y-4" onSubmit={handleUploadDocument}>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="document-file">{l("Datei", "Файл", "File")}</Label>
                <Input id="document-file" type="file" onChange={handleDocumentFileChange} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="document-name">{l("Anzeigename", "Отображаемое имя", "Display name")}</Label>
                <Input
                  id="document-name"
                  value={documentUploadForm.autoName}
                  onChange={(event) => setDocumentUploadForm((current) => ({ ...current, autoName: event.target.value }))}
                  placeholder={l("Optionaler sichtbarer Name für den Patienten", "Необязательное имя для отображения пациенту", "Optional patient-facing name")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="document-art">{l("Typ", "Тип", "Type")}</Label>
                <Input
                  id="document-art"
                  value={documentUploadForm.art}
                  onChange={(event) => setDocumentUploadForm((current) => ({ ...current, art: event.target.value }))}
                  placeholder="report"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="document-category">{l("Kategorie", "Категория", "Category")}</Label>
                <Input
                  id="document-category"
                  value={documentUploadForm.category}
                  onChange={(event) => setDocumentUploadForm((current) => ({ ...current, category: event.target.value }))}
                  placeholder="medical"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="document-status">{l("Status", "Статус", "Status")}</Label>
                <select
                  id="document-status"
                  className={selectClassName}
                  value={documentUploadForm.status}
                  onChange={(event) =>
                    setDocumentUploadForm((current) => ({
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
                  value={documentUploadForm.visibility}
                  onChange={(event) =>
                    setDocumentUploadForm((current) => ({
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
                  value={documentUploadForm.orderId}
                  onChange={(event) => setDocumentUploadForm((current) => ({ ...current, orderId: event.target.value }))}
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
                  value={documentUploadForm.appointmentId}
                  onChange={(event) =>
                    setDocumentUploadForm((current) => ({
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
                  checked={documentUploadForm.isMedical}
                  onChange={(event) =>
                    setDocumentUploadForm((current) => ({
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
                value={documentUploadForm.notes}
                onChange={(event) => setDocumentUploadForm((current) => ({ ...current, notes: event.target.value }))}
                placeholder={l("Optionale Verarbeitungs- oder Sichtbarkeitsnotizen", "Необязательные заметки по обработке или видимости", "Optional processing or visibility notes")}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" className="rounded-xl" onClick={() => setDocumentUploadOpen(false)}>
                {l("Abbrechen", "Отмена", "Cancel")}
              </Button>
              <Button type="submit" className="rounded-xl bg-slate-950 text-white hover:bg-slate-800" disabled={documentUploadBusy}>
                {documentUploadBusy ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
                {l("Dokument hochladen", "Загрузить документ", "Upload document")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={contractCreateOpen} onOpenChange={setContractCreateOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{l("Rahmenvertrag erstellen", "Создать рамочный договор", "Create framework contract")}</DialogTitle>
            <DialogDescription>
              {l(
                "Starten Sie einen patientengebundenen Vertrag direkt aus dem Profil, ohne den Patientenkontext zu verlassen.",
                "Создайте договор, привязанный к пациенту, прямо из профиля, не выходя из контура пациента.",
                "Start a patient-bound contract directly from the profile without leaving the patient loop.",
              )}
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleCreateContract}>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="contract-status">{l("Status", "Статус", "Status")}</Label>
                <select
                  id="contract-status"
                  className={selectClassName}
                  value={contractCreateForm.status}
                  onChange={(event) =>
                    setContractCreateForm((current) => ({
                      ...current,
                      status: event.target.value as ContractStatus,
                    }))
                  }
                >
                  {CONTRACT_STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {patientDetailStatusLabel(status)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="contract-signed-at">{l("Unterzeichnet am", "Подписано", "Signed at")}</Label>
                <Input
                  id="contract-signed-at"
                  type="datetime-local"
                  value={contractCreateForm.signedAt}
                  onChange={(event) => setContractCreateForm((current) => ({ ...current, signedAt: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contract-valid-from">{l("Gültig ab", "Действует с", "Valid from")}</Label>
                <Input
                  id="contract-valid-from"
                  type="date"
                  value={contractCreateForm.validFrom}
                  onChange={(event) => setContractCreateForm((current) => ({ ...current, validFrom: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contract-valid-to">{l("Gültig bis", "Действует до", "Valid to")}</Label>
                <Input
                  id="contract-valid-to"
                  type="date"
                  value={contractCreateForm.validTo}
                  onChange={(event) => setContractCreateForm((current) => ({ ...current, validTo: event.target.value }))}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" className="rounded-xl" onClick={() => setContractCreateOpen(false)}>
                {l("Abbrechen", "Отмена", "Cancel")}
              </Button>
              <Button type="submit" className="rounded-xl bg-slate-950 text-white hover:bg-slate-800" disabled={contractBusy}>
                {contractBusy ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
                {l("Vertrag erstellen", "Создать договор", "Create contract")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

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
                <select
                  id="contract-status-edit"
                  className={selectClassName}
                  value={contractStatusForm.status}
                  onChange={(event) =>
                    setContractStatusForm((current) => ({
                      ...current,
                      status: event.target.value as ContractStatus,
                    }))
                  }
                >
                  {CONTRACT_STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {patientDetailStatusLabel(status)}
                    </option>
                  ))}
                </select>
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
                  <select
                    id="invoice-status-edit"
                    className={selectClassName}
                    value={invoiceStatusForm.status}
                    onChange={(event) =>
                      setInvoiceStatusForm((current) => ({
                        ...current,
                        status: event.target.value as InvoiceStatus,
                      }))
                    }
                  >
                    {INVOICE_STATUS_OPTIONS.map((status) => (
                      <option key={status} value={status}>
                        {patientDetailStatusLabel(status)}
                      </option>
                    ))}
                  </select>
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
                  <p className="text-sm text-slate-500">{l("Noch keine Mahnereignisse.", "Событий напоминаний пока нет.", "No dunning events yet.")}</p>
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
