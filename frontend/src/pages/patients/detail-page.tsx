import {
  lazy,
  Suspense,
  useDeferredValue,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type FormEvent,
  type SetStateAction,
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
import { clearApiCache } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  formatEnumLabel,
  getLang,
  t as translateCatalog,
  useLang,
} from "@/lib/i18n";
import { useDebouncedRealtimeSubscription } from "@/lib/realtime";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { cn } from "@/lib/utils";

import {
  buildPatientLabelPrintHtml,
  buildPatientTimelineSummary,
  canOpenPatientDocumentsWorkspace,
  canViewPatientContractsSurface,
  canViewPatientDocumentsSurface,
  canViewPatientInvoicesSurface,
  canViewPatientClinicalProfile,
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
  { value: "medical_update" },
  { value: "patient_report" },
  { value: "provider_report" },
  { value: "treatment_note" },
  { value: "followup_note" },
  { value: "warning" },
  { value: "other" },
] as const;

const PATIENT_MEDICAL_ORDER_TYPE_OPTIONS = [
  { value: "physiotherapy" },
  { value: "diet" },
  { value: "lab_recheck" },
  { value: "imaging" },
  { value: "medication_followup" },
  { value: "procedure" },
  { value: "other" },
] as const;

const PATIENT_RISK_SCORE_TYPE_OPTIONS = [
  { value: "cha2ds2_vasc" },
  { value: "has_bled" },
  { value: "framingham" },
  { value: "fall_risk" },
  { value: "frailty" },
  { value: "nutrition_risk" },
  { value: "other" },
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

const PATIENT_DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});
const PATIENT_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const PATIENT_MONEY_FORMATTERS: Record<string, Intl.NumberFormat> = {
  EUR: new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  }),
  USD: new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }),
};

const PATIENT_VITAL_NUMBER_FORMATTERS: Record<string, Intl.NumberFormat> = {
  '{"maximumFractionDigits":0}': new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }),
  '{"maximumFractionDigits":1}': new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }),
};

function uniqueSortedNonEmpty(values: Iterable<string | null | undefined>) {
  const uniqueValues = new Set<string>();
  for (const value of values) {
    const normalized = (value ?? "").trim();
    if (normalized) {
      uniqueValues.add(normalized);
    }
  }
  return [...uniqueValues].toSorted((left, right) => left.localeCompare(right));
}

function patientName(p: PatientDetail) {
  const t = p.title ? `${p.title} ` : "";
  const n = [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
  return `${t}${n || p.patient_id}`.trim();
}

function fmtDate(v?: string | null, fb = "") {
  if (!v) return fb;
  try {
    return PATIENT_DATE_FORMATTER.format(new Date(v.includes("T") ? v : `${v}T00:00:00`));
  } catch { return v; }
}

function fmtDateTime(v?: string | null, fb = "") {
  if (!v) return fb;
  try {
    return PATIENT_DATE_TIME_FORMATTER.format(new Date(v));
  } catch { return v; }
}

function appointmentCarePathKindLabel(value?: string | null) {
  if (value === "preventive") return patientDetailText("patients_detail_preventive");
  if (value === "control") return patientDetailText("patients_detail_control");
  if (value === "followup") return patientDetailText("patients_detail_follow_up");
  return patientDetailText("patients_detail_regular");
}

function fieldVal(v: string | string[] | null | undefined, fb: string) {
  if (Array.isArray(v)) return v.length ? v.join(", ") : fb;
  return v && v.trim() ? v : fb;
}

function fmtMoney(v?: string | null, currency = "EUR") {
  if (!v) return patientDetailText("patients_detail_not_set");
  const numeric = Number(v);
  if (Number.isNaN(numeric)) return `${v} ${currency}`;
  try {
    return PATIENT_MONEY_FORMATTERS[currency]?.format(numeric) ?? `${numeric.toFixed(2)} ${currency}`;
  } catch {
    return `${v} ${currency}`;
  }
}

function patientDetailText(key: string) {
  return translateCatalog(getLang()).uiText[key] ?? key;
}

function patientDetailUnknownEnumLabel(value: string | null | undefined) {
  return formatEnumLabel(value, {}, translateCatalog(getLang()));
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
    const formatterKey = JSON.stringify(options);
    return PATIENT_VITAL_NUMBER_FORMATTERS[formatterKey]?.format(value) ?? `${value}`;
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
      patientDetailText("patients_detail_enter_a_valid_number"),
    );
  }
  return parsed;
}

function parseOptionalIntegerInput(value: string) {
  const parsed = parseOptionalNumberInput(value);
  if (parsed == null) return undefined;
  if (!Number.isInteger(parsed)) {
    throw new Error(
      patientDetailText("patients_detail_enter_a_whole_number"),
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
  return tr[`role_${v}`] ?? tr.common_unknown_value ?? tr.common_unknown;
}

function relationTypeLabel(value: string) {
  switch (value) {
    case "spouse":
      return patientDetailText("patients_detail_spouse");
    case "parent":
      return patientDetailText("patients_detail_parent");
    case "child":
      return patientDetailText("patients_detail_child");
    case "sibling":
      return patientDetailText("patients_detail_sibling");
    case "relative":
      return patientDetailText("patients_detail_relative");
    case "guardian":
      return patientDetailText("patients_detail_guardian");
    case "caregiver":
      return patientDetailText("patients_detail_caregiver");
    case "friend":
      return patientDetailText("patients_detail_friend");
    case "other":
      return patientDetailText("patients_detail_other");
    default:
      return patientDetailUnknownEnumLabel(value);
  }
}

function orderPhaseLabel(value: string) {
  switch (value) {
    case "discovery":
      return patientDetailText("patients_detail_discovery");
    case "intake":
      return patientDetailText("patients_detail_intake");
    case "execution":
      return patientDetailText("patients_detail_execution");
    case "closure":
      return patientDetailText("patients_detail_closure");
    case "followup":
      return patientDetailText("patients_detail_follow_up_2");
    default:
      return patientDetailUnknownEnumLabel(value);
  }
}

function appointmentTypeLabel(value: string) {
  switch (value) {
    case "consultation":
      return patientDetailText("patients_detail_consultation");
    case "followup":
      return patientDetailText("patients_detail_follow_up_3");
    case "diagnostics":
      return patientDetailText("patients_detail_diagnostics");
    case "procedure":
      return patientDetailText("patients_detail_procedure");
    default:
      return patientDetailUnknownEnumLabel(value);
  }
}

function invoiceTypeLabel(value: string) {
  switch (value) {
    case "advance":
      return patientDetailText("patients_detail_advance");
    case "interim":
      return patientDetailText("patients_detail_interim");
    case "final":
      return patientDetailText("patients_detail_final");
    default:
      return patientDetailUnknownEnumLabel(value);
  }
}

function canAssignTarget(managerRole: string | undefined, targetRole: string) {
  switch (managerRole) {
    case "ceo":
    case "it_admin":
      return [
        "patient_manager",
        "teamlead_interpreter",
        "interpreter",
        "concierge",
      ].includes(targetRole);
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
      return patientDetailText("patients_detail_medical_update");
    case "patient_report":
      return patientDetailText("patients_detail_patient_report");
    case "provider_report":
      return patientDetailText("patients_detail_provider_report");
    case "treatment_note":
      return patientDetailText("patients_detail_treatment_note");
    case "followup_note":
      return patientDetailText("patients_detail_follow_up_note");
    case "warning":
      return patientDetailText("patients_detail_warning");
    case "other":
      return patientDetailText("patients_detail_other_2");
    default:
      return patientDetailUnknownEnumLabel(category);
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
      return "border-zinc-200 bg-zinc-50 text-zinc-700";
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
      return patientDetailText("patients_detail_physiotherapy");
    case "diet":
      return patientDetailText("patients_detail_diet");
    case "lab_recheck":
      return patientDetailText("patients_detail_lab_recheck");
    case "imaging":
      return patientDetailText("patients_detail_imaging");
    case "medication_followup":
      return patientDetailText("patients_detail_medication_follow_up");
    case "procedure":
      return patientDetailText("patients_detail_procedure_2");
    case "other":
      return patientDetailText("patients_detail_other_3");
    default:
      return patientDetailUnknownEnumLabel(orderType);
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
      return patientDetailText("patients_label_score_cha2ds2_vasc");
    case "has_bled":
      return patientDetailText("patients_label_score_has_bled");
    case "framingham":
      return patientDetailText("patients_label_score_framingham");
    case "fall_risk":
      return patientDetailText("patients_detail_fall_risk");
    case "frailty":
      return patientDetailText("patients_detail_frailty");
    case "nutrition_risk":
      return patientDetailText("patients_detail_nutrition_risk");
    case "other":
      return patientDetailText("patients_detail_other_4");
    default:
      return patientDetailUnknownEnumLabel(scoreType);
  }
}

function workflowChecklistLabel(key: string) {
  switch (key) {
    case "patient_intake":
      return patientDetailText("patients_detail_patient_intake");
    case "patient_custom":
      return patientDetailText("patients_detail_custom");
    default:
      return patientDetailUnknownEnumLabel(key);
  }
}

function patientDetailStatusLabel(status: string) {
  switch (status) {
    case "not_started":
      return patientDetailText("patients_detail_not_started");
    case "pending":
      return patientDetailText("patients_detail_pending");
    case "open":
      return patientDetailText("patients_detail_open");
    case "in_progress":
      return patientDetailText("patients_detail_in_progress");
    case "closed":
      return patientDetailText("patients_detail_closed");
    case "active":
      return patientDetailText("patients_detail_active");
    case "completed":
      return patientDetailText("patients_detail_completed");
    case "draft":
      return patientDetailText("patients_detail_draft");
    case "sent":
      return patientDetailText("patients_detail_sent");
    case "signed":
      return patientDetailText("patients_detail_signed");
    case "overdue":
      return patientDetailText("patients_detail_overdue");
    case "partially_paid":
      return patientDetailText("patients_detail_partially_paid");
    case "paid":
      return patientDetailText("patients_detail_paid");
    case "expired":
      return patientDetailText("patients_detail_expired");
    case "terminated":
      return patientDetailText("patients_detail_terminated");
    case "cancelled":
      return patientDetailText("patients_detail_cancelled");
    case "planned":
      return patientDetailText("patients_detail_planned");
    case "confirmed":
      return patientDetailText("patients_detail_confirmed");
    case "submitted":
      return patientDetailText("patients_detail_submitted");
    case "archived":
      return patientDetailText("patients_detail_archived");
    default:
      return patientDetailUnknownEnumLabel(status);
  }
}

function priorityLabel(priority: string) {
  switch (priority) {
    case "low":
      return patientDetailText("patients_detail_low");
    case "normal":
      return patientDetailText("patients_detail_normal");
    case "high":
      return patientDetailText("patients_detail_high");
    case "urgent":
      return patientDetailText("patients_detail_urgent");
    default:
      return patientDetailUnknownEnumLabel(priority);
  }
}

function timelineRangeOptions(): Array<{ value: PatientTimelineRangeFilter; label: string }> {
  return [
    { value: "all", label: patientDetailText("patients_timeline_range_all") },
    { value: "30d", label: patientDetailText("patients_timeline_range_30d") },
    { value: "90d", label: patientDetailText("patients_timeline_range_90d") },
    { value: "180d", label: patientDetailText("patients_timeline_range_180d") },
    { value: "365d", label: patientDetailText("patients_timeline_range_365d") },
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
      return "border-zinc-200 bg-zinc-50 text-zinc-600";
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
      return "bg-zinc-500";
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

function timelineDateGroupLabel(value: string | null | undefined) {
  const key = timelineDateGroupKey(value);
  if (key === "unknown") {
    return patientDetailText("timeline_date_unknown");
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
    return patientDetailText("timeline_date_today");
  }

  if (sameDay(date, yesterday)) {
    return patientDetailText("timeline_date_yesterday");
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
  draft: "border-zinc-200 bg-zinc-50 text-zinc-700",
  sent: "border-sky-200 bg-sky-50 text-sky-700",
  signed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  overdue: "border-rose-200 bg-rose-50 text-rose-700",
  partially_paid: "border-amber-200 bg-amber-50 text-amber-700",
  paid: "border-emerald-200 bg-emerald-50 text-emerald-700",
  expired: "border-zinc-200 bg-zinc-50 text-zinc-600",
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
  it_admin: "bg-zinc-100 text-zinc-700",
  patient: "bg-emerald-100 text-emerald-700",
};

const STATUS_BADGE_CLASSES: Record<string, string> = {
  active: "border-emerald-200 bg-emerald-50 text-emerald-700",
  completed: "border-sky-200 bg-sky-50 text-sky-700",
  cancelled: "border-rose-200 bg-rose-50 text-rose-700",
};

const PATIENT_DETAIL_REALTIME_EVENTS = [
  "patient.updated",
  "patient.assigned",
  "patient.assignment_revoked",
  "patient.activated",
  "patient.deactivated",
  "appointment.created",
  "appointment.updated",
  "appointment.status_changed",
  "appointment_checklist.created",
  "appointment_checklist.completed",
  "appointment_request.created",
  "appointment_request.reviewed",
  "appointment_request.converted",
  "concierge_service.created",
  "concierge_service.updated",
  "concierge_service.cancelled",
  "concierge_service.billing_ready",
  "document.uploaded",
  "document.payment_proof_uploaded",
  "document.generated",
  "document.updated",
  "document.deleted",
  "document.portal_released",
  "document.portal_revoked",
  "document.confirmed",
  "document.translation_requested",
  "document.translation_updated",
  "invoice.created",
  "invoice.status_changed",
  "invoice.dunning_created",
  "invoice.overdue_marked",
  "privacy_request.created",
  "privacy_request.reviewed",
  "privacy_request.executed",
  "consent.granted",
  "consent.revoked",
  "reminder.created",
  "reminder.completed",
  "task.created",
  "task.status_changed",
  "feedback.submitted",
  "feedback.reviewed",
  "order.created",
  "order.phase_changed",
  "order.process_gates_updated",
  "order.debt_management_updated",
  "order.planning_preparation_updated",
  "order.execution_flow_updated",
  "order.followup_flow_updated",
  "order.external_invoice_created",
  "order.external_invoice_updated",
  "order.external_invoice_overdue",
  "order.leistung_added",
  "order.leistung_approved",
  "framework_contract.created",
  "framework_contract.status_changed",
  "quote.created",
  "quote.status_changed",
  "case.created",
  "case.updated",
  "case.medication_expiry_confirmed",
  "case.medication_expiry_flagged",
  "workflow_checklist_item.created",
  "workflow_checklist_item.completed",
] as const;

type PatientDetailPageState = {
  actionErrorState: { patientId: string; message: string };
  selectedAssignee: string;
  assignBusy: boolean;
  activeTab: string;
  version: number;
  tabVersion: number;
  tabActionError: string;
  profileEditorOpen: boolean;
  cardEntrySheetOpen: boolean;
  docsPreviewOpen: boolean;
  contractsPreviewOpen: boolean;
  invoicesPreviewOpen: boolean;
  legalStatusSheetOpen: boolean;
  vitalsSheetOpen: boolean;
  caveSheetOpen: boolean;
  notesSheetOpen: boolean;
  medicalOrderActionId: string;
  medicalOrderSheetOpen: boolean;
  riskScoreSheetOpen: boolean;
  appointmentSheetOpen: boolean;
  relationEditorOpen: boolean;
  editingRelation: RelationItem | null;
  documentUploadOpen: boolean;
  contractCreateOpen: boolean;
  contractCreateForm: ContractFormState;
  contractBusy: boolean;
  contractStatusId: string;
  contractStatusForm: ContractFormState;
  invoiceManageId: string;
  invoiceStatusForm: InvoiceStatusFormState;
  invoiceBusy: boolean;
  dunningBusy: boolean;
  dunningNote: string;
  complianceExportBusy: boolean;
  patientLabelBusy: boolean;
  workflowBusy: boolean;
  workflowForm: WorkflowChecklistFormState;
  documentStatusFilter: string;
  documentCategoryFilter: string;
  timelineEntityFilter: string;
  timelineCategoryFilter: string;
  timelineSourceFilter: string;
  timelineRangeFilter: PatientTimelineRangeFilter;
  timelineSearch: string;
  timelineOffset: ReturnType<typeof normalizeTimelineOffsetValue>;
};

type PatientDetailPagePatch =
  | Partial<PatientDetailPageState>
  | ((current: PatientDetailPageState) => Partial<PatientDetailPageState>);

function patientDetailPageReducer(
  state: PatientDetailPageState,
  patch: PatientDetailPagePatch,
): PatientDetailPageState {
  return {
    ...state,
    ...(typeof patch === "function" ? patch(state) : patch),
  };
}

function createPatientDetailPageFieldPatch<K extends keyof PatientDetailPageState>(
  field: K,
  value: SetStateAction<PatientDetailPageState[K]>,
): PatientDetailPagePatch {
  return (current) => {
    const nextValue =
      typeof value === "function"
        ? (value as (previous: PatientDetailPageState[K]) => PatientDetailPageState[K])(current[field])
        : value;
    return { [field]: nextValue } as Partial<PatientDetailPageState>;
  };
}

function usePatientDetailPageContent() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { staffGo } = useStaffNavigate();
  const { user } = useAuth();
  const { t, lang } = useLang();
  const tr = t as unknown as Record<string, string>;
  const l = (key: string) => t.uiText[key] ?? key;

  const [pageState, dispatchPageState] = useReducer(
    patientDetailPageReducer,
    undefined,
    (): PatientDetailPageState => ({
      actionErrorState: { patientId: "", message: "" },
      selectedAssignee: "",
      assignBusy: false,
      activeTab: searchParams.get("tab") || "profile",
      version: 0,
      tabVersion: 0,
      tabActionError: "",
      profileEditorOpen: false,
      cardEntrySheetOpen: false,
      docsPreviewOpen: false,
      contractsPreviewOpen: false,
      invoicesPreviewOpen: false,
      legalStatusSheetOpen: false,
      vitalsSheetOpen: false,
      caveSheetOpen: false,
      notesSheetOpen: false,
      medicalOrderActionId: "",
      medicalOrderSheetOpen: false,
      riskScoreSheetOpen: false,
      appointmentSheetOpen: false,
      relationEditorOpen: false,
      editingRelation: null,
      documentUploadOpen: false,
      contractCreateOpen: false,
      contractCreateForm: blankContractForm(),
      contractBusy: false,
      contractStatusId: "",
      contractStatusForm: blankContractForm(),
      invoiceManageId: "",
      invoiceStatusForm: {
        status: "draft",
        dueDate: "",
        paidAmount: "",
        notes: "",
      },
      invoiceBusy: false,
      dunningBusy: false,
      dunningNote: "",
      complianceExportBusy: false,
      patientLabelBusy: false,
      workflowBusy: false,
      workflowForm: blankWorkflowChecklistForm(),
      documentStatusFilter: "all",
      documentCategoryFilter: "all",
      timelineEntityFilter: normalizeTimelineQueryValue(searchParams.get("entity_type")),
      timelineCategoryFilter: normalizeTimelineQueryValue(searchParams.get("category")),
      timelineSourceFilter: normalizeTimelineQueryValue(searchParams.get("source")),
      timelineRangeFilter: normalizeTimelineRangeFilterValue(searchParams.get("range")),
      timelineSearch: normalizeTimelineSearchValue(searchParams.get("search")),
      timelineOffset: normalizeTimelineOffsetValue(searchParams.get("offset")),
    }),
  );
  const {
    actionErrorState,
    selectedAssignee,
    assignBusy,
    activeTab,
    version,
    tabVersion,
    tabActionError,
    profileEditorOpen,
    cardEntrySheetOpen,
    docsPreviewOpen,
    contractsPreviewOpen,
    invoicesPreviewOpen,
    legalStatusSheetOpen,
    vitalsSheetOpen,
    caveSheetOpen,
    notesSheetOpen,
    medicalOrderActionId,
    medicalOrderSheetOpen,
    riskScoreSheetOpen,
    appointmentSheetOpen,
    relationEditorOpen,
    editingRelation,
    documentUploadOpen,
    contractCreateOpen,
    contractCreateForm,
    contractBusy,
    contractStatusId,
    contractStatusForm,
    invoiceManageId,
    invoiceStatusForm,
    invoiceBusy,
    dunningBusy,
    dunningNote,
    complianceExportBusy,
    patientLabelBusy,
    workflowBusy,
    workflowForm,
    documentStatusFilter,
    documentCategoryFilter,
    timelineEntityFilter,
    timelineCategoryFilter,
    timelineSourceFilter,
    timelineRangeFilter,
    timelineSearch,
    timelineOffset,
  } = pageState;
  const setPageField = <K extends keyof PatientDetailPageState>(
    field: K,
    value: SetStateAction<PatientDetailPageState[K]>,
  ) => dispatchPageState(createPatientDetailPageFieldPatch(field, value));
  const setActionErrorState = (value: SetStateAction<PatientDetailPageState["actionErrorState"]>) =>
    setPageField("actionErrorState", value);
  const setSelectedAssignee = (value: SetStateAction<string>) =>
    setPageField("selectedAssignee", value);
  const setAssignBusy = (value: SetStateAction<boolean>) =>
    setPageField("assignBusy", value);
  const setActiveTab = (value: SetStateAction<string>) =>
    setPageField("activeTab", value);
  const setVersion = (value: SetStateAction<number>) =>
    setPageField("version", value);
  const setTabVersion = (value: SetStateAction<number>) =>
    setPageField("tabVersion", value);
  const setTabActionError = (value: SetStateAction<string>) =>
    setPageField("tabActionError", value);
  const setProfileEditorOpen = (value: SetStateAction<boolean>) =>
    setPageField("profileEditorOpen", value);
  const setCardEntrySheetOpen = (value: SetStateAction<boolean>) =>
    setPageField("cardEntrySheetOpen", value);
  const setDocsPreviewOpen = (value: SetStateAction<boolean>) =>
    setPageField("docsPreviewOpen", value);
  const setContractsPreviewOpen = (value: SetStateAction<boolean>) =>
    setPageField("contractsPreviewOpen", value);
  const setInvoicesPreviewOpen = (value: SetStateAction<boolean>) =>
    setPageField("invoicesPreviewOpen", value);
  const setLegalStatusSheetOpen = (value: SetStateAction<boolean>) =>
    setPageField("legalStatusSheetOpen", value);
  const setVitalsSheetOpen = (value: SetStateAction<boolean>) =>
    setPageField("vitalsSheetOpen", value);
  const setCaveSheetOpen = (value: SetStateAction<boolean>) =>
    setPageField("caveSheetOpen", value);
  const setNotesSheetOpen = (value: SetStateAction<boolean>) =>
    setPageField("notesSheetOpen", value);
  const setMedicalOrderActionId = (value: SetStateAction<string>) =>
    setPageField("medicalOrderActionId", value);
  const setMedicalOrderSheetOpen = (value: SetStateAction<boolean>) =>
    setPageField("medicalOrderSheetOpen", value);
  const setRiskScoreSheetOpen = (value: SetStateAction<boolean>) =>
    setPageField("riskScoreSheetOpen", value);
  const setAppointmentSheetOpen = (value: SetStateAction<boolean>) =>
    setPageField("appointmentSheetOpen", value);
  const setRelationEditorOpen = (value: SetStateAction<boolean>) =>
    setPageField("relationEditorOpen", value);
  const setEditingRelation = (value: SetStateAction<RelationItem | null>) =>
    setPageField("editingRelation", value);
  const setDocumentUploadOpen = (value: SetStateAction<boolean>) =>
    setPageField("documentUploadOpen", value);
  const setContractCreateOpen = (value: SetStateAction<boolean>) =>
    setPageField("contractCreateOpen", value);
  const setContractCreateForm = (value: SetStateAction<ContractFormState>) =>
    setPageField("contractCreateForm", value);
  const setContractBusy = (value: SetStateAction<boolean>) =>
    setPageField("contractBusy", value);
  const setContractStatusId = (value: SetStateAction<string>) =>
    setPageField("contractStatusId", value);
  const setContractStatusForm = (value: SetStateAction<ContractFormState>) =>
    setPageField("contractStatusForm", value);
  const setInvoiceManageId = (value: SetStateAction<string>) =>
    setPageField("invoiceManageId", value);
  const setInvoiceStatusForm = (value: SetStateAction<InvoiceStatusFormState>) =>
    setPageField("invoiceStatusForm", value);
  const setInvoiceBusy = (value: SetStateAction<boolean>) =>
    setPageField("invoiceBusy", value);
  const setDunningBusy = (value: SetStateAction<boolean>) =>
    setPageField("dunningBusy", value);
  const setDunningNote = (value: SetStateAction<string>) =>
    setPageField("dunningNote", value);
  const setComplianceExportBusy = (value: SetStateAction<boolean>) =>
    setPageField("complianceExportBusy", value);
  const setPatientLabelBusy = (value: SetStateAction<boolean>) =>
    setPageField("patientLabelBusy", value);
  const patientLabelFormatRef = useRef<PatientLabelFormatId>(DEFAULT_PATIENT_LABEL_FORMAT_ID);
  const setWorkflowBusy = (value: SetStateAction<boolean>) =>
    setPageField("workflowBusy", value);
  const setWorkflowForm = (value: SetStateAction<WorkflowChecklistFormState>) =>
    setPageField("workflowForm", value);
  const setDocumentStatusFilter = (value: SetStateAction<string>) =>
    setPageField("documentStatusFilter", value);
  const setDocumentCategoryFilter = (value: SetStateAction<string>) =>
    setPageField("documentCategoryFilter", value);
  const setTimelineEntityFilter = (value: SetStateAction<string>) =>
    setPageField("timelineEntityFilter", value);
  const setTimelineCategoryFilter = (value: SetStateAction<string>) =>
    setPageField("timelineCategoryFilter", value);
  const setTimelineSourceFilter = (value: SetStateAction<string>) =>
    setPageField("timelineSourceFilter", value);
  const setTimelineRangeFilter = (value: SetStateAction<PatientTimelineRangeFilter>) =>
    setPageField("timelineRangeFilter", value);
  const setTimelineSearch = (value: SetStateAction<string>) =>
    setPageField("timelineSearch", value);
  const setTimelineOffset = (value: SetStateAction<ReturnType<typeof normalizeTimelineOffsetValue>>) =>
    setPageField("timelineOffset", value);
  const timelineLimit = 50;

  const canManage = user?.role === "ceo" || user?.role === "patient_manager" || user?.role === "teamlead_interpreter";
  const canManageRelations = user?.role === "ceo" || user?.role === "patient_manager";
  const canViewOperationalSurface = canViewPatientOperationalSurface(user?.role);
  const canViewClinical = canViewPatientClinicalProfile(user?.role);
  const canViewDocuments = canViewPatientDocumentsSurface(user?.role);
  const canOpenDocumentsWorkspace = canOpenPatientDocumentsWorkspace(user?.role);
  const canManageDocuments =
    user?.role === "ceo" ||
    user?.role === "patient_manager" ||
    user?.role === "it_admin";
  const canViewContracts = canViewPatientContractsSurface(user?.role);
  const canManageContracts =
    user?.role === "ceo" ||
    user?.role === "patient_manager" ||
    user?.role === "billing" ||
    user?.role === "it_admin";
  const canViewInvoices = canViewPatientInvoicesSurface(user?.role);
  const canManageInvoices =
    user?.role === "ceo" || user?.role === "billing" || user?.role === "it_admin";
  const canEditPatientProfile =
    user?.role === "ceo" ||
    user?.role === "patient_manager" ||
    user?.role === "it_admin";
  const canManagePatientVitals = canEditPatientProfile;
  const canManagePatientCardEntries = canEditPatientProfile;
  const canManagePatientMedicalOrders = canEditPatientProfile;
  const canManagePatientRiskScores = canEditPatientProfile;
  const canExportPatientCompliance =
    user?.role === "ceo" ||
    user?.role === "patient_manager" ||
    user?.role === "it_admin";
  const canOpenComplianceWorkspace =
    user?.role === "ceo" ||
    user?.role === "patient_manager" ||
    user?.role === "it_admin";
  const canPrintPatientLabel =
    user?.role === "ceo" ||
    user?.role === "patient_manager" ||
    user?.role === "it_admin";
  const canManageWorkflowChecklist =
    user?.role === "ceo" ||
    user?.role === "patient_manager" ||
    user?.role === "concierge" ||
    user?.role === "it_admin";
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
    financialLedger,
    financialSummary,
    invoices,
    orders,
    relations,
    servicePackages,
    tabError,
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
    canViewClinical
      ? {
          key: "clinical",
          label: l("patients_clinical_profile"),
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
        ? uniqueSortedNonEmpty(timeline.map((item) => item.category))
        : [],
    [isTimelineTabActive, timeline]
  );
  const timelineSourceOptions = useMemo(
    () =>
      isTimelineTabActive
        ? uniqueSortedNonEmpty(timeline.map((item) => item.source_label))
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
      const label = timelineDateGroupLabel(item.happened_at);

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
    () => (isTimelineTabActive ? timelineRangeOptions() : []),
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
      return uniqueSortedNonEmpty(documents.map((item) => item.status));
    },
    [documents, isDocumentsTabActive]
  );
  const documentCategoryOptions = useMemo(
    () => {
      if (!isDocumentsTabActive) return [];
      return uniqueSortedNonEmpty(documents.map((item) => item.category));
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

  useDebouncedRealtimeSubscription(PATIENT_DETAIL_REALTIME_EVENTS, (_event, events) => {
    if (!id) return;
    const matchesCurrentPatient = events.some(
      (event) =>
        event.patient_id === id ||
        (event.entity_type === "patient" && event.entity_id === id),
    );
    if (!matchesCurrentPatient) return;

    clearApiCache(`/patients/${id}`);
    clearApiCache(`/patients/${id}/cases`);
    clearApiCache(`/patients/${id}/orders`);
    clearApiCache(`/patients/${id}/appointments`);
    clearApiCache(`/patients/${id}/documents`);
    clearApiCache(`/patients/${id}/document-alerts`);
    clearApiCache(`/patients/${id}/framework-contracts`);
    clearApiCache(`/patients/${id}/financial-ledger`);
    clearApiCache(`/patients/${id}/financial-summary`);
    clearApiCache(`/patients/${id}/invoices`);
    clearApiCache(`/patients/${id}/service-packages`);
    clearApiCache(`/patients/${id}/timeline`);
    clearApiCache(`/patients/${id}/workflow-checklist`);
    reload();
  }, 250);

  void reloadTab;
  void blankPatientCardEntryForm;
  void blankPatientMedicalOrderForm;
  void blankPatientRiskScoreForm;
  void blankPatientVitalForm;
  void parseOptionalIntegerInput;
  void computeVitalBmi;
  const applyActiveTab = useCallback((nextTab: string) => {
    setActiveTab(nextTab);
    setTabActionError("");
  }, []);

  const handleTabChange = useCallback(
    (nextTab: string) => {
      applyActiveTab(nextTab);
      const nextParams = new URLSearchParams(searchParams);
      if (nextTab === "profile") {
        nextParams.delete("tab");
      } else {
        nextParams.set("tab", nextTab);
      }
      setSearchParams(nextParams, { replace: true });
    },
    [applyActiveTab, searchParams, setSearchParams]
  );

  const applyTimelineFiltersFromQuery = useCallback(
    ({
      category,
      entity,
      offset,
      range,
      search,
      source,
    }: {
      category: string;
      entity: string;
      offset: number;
      range: PatientTimelineRangeFilter;
      search: string;
      source: string;
    }) => {
      if (timelineEntityFilter !== entity) setTimelineEntityFilter(entity);
      if (timelineCategoryFilter !== category) setTimelineCategoryFilter(category);
      if (timelineSourceFilter !== source) setTimelineSourceFilter(source);
      if (timelineRangeFilter !== range) setTimelineRangeFilter(range);
      if (timelineSearch !== search) setTimelineSearch(search);
      if (timelineOffset !== offset) setTimelineOffset(offset);
    },
    [
      timelineCategoryFilter,
      timelineEntityFilter,
      timelineOffset,
      timelineRangeFilter,
      timelineSearch,
      timelineSourceFilter,
    ],
  );

  useEffect(() => {
    if (!isTimelineTabActive) return;
    const nextEntityFilter = normalizeTimelineQueryValue(searchParams.get("entity_type"));
    const nextCategoryFilter = normalizeTimelineQueryValue(searchParams.get("category"));
    const nextSourceFilter = normalizeTimelineQueryValue(searchParams.get("source"));
    const nextRangeFilter = normalizeTimelineRangeFilterValue(searchParams.get("range"));
    const nextSearch = normalizeTimelineSearchValue(searchParams.get("search"));
    const nextOffset = normalizeTimelineOffsetValue(searchParams.get("offset"));

    applyTimelineFiltersFromQuery({
      category: nextCategoryFilter,
      entity: nextEntityFilter,
      offset: nextOffset,
      range: nextRangeFilter,
      search: nextSearch,
      source: nextSourceFilter,
    });
  }, [
    applyTimelineFiltersFromQuery,
    isTimelineTabActive,
    searchParams,
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
      canViewClinical,
      canViewDocuments,
      canViewContracts,
      canViewInvoices,
    });

    if (activeTab !== normalizedTab) {
      applyActiveTab(normalizedTab);
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
    applyActiveTab,
    canViewContracts,
    canViewDocuments,
    canViewInvoices,
    canViewOperationalSurface,
    searchParams,
    setSearchParams,
  ]);

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
      toast.success(l("patients_dsgvo_export_downloaded"));
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
    const chosenFormat = format ?? patientLabelFormatRef.current;

    const printWindow = window.open("", "_blank", "noopener,noreferrer");
    if (!printWindow) {
      setTabActionError(patientDetailText("patients_error_allow_popups_print_label"));
      return;
    }

    setPatientLabelBusy(true);
    setTabActionError("");

    try {
      const payload = await fetchPatientLabelPayload<PatientLabelPayload>(id, chosenFormat);
      printWindow.document.open();
      printWindow.document.write(buildPatientLabelPrintHtml(payload));
      printWindow.document.close();
      toast.info(l("patients_label_opened"));
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
        ? l("patients_order_completed")
        : l("patients_order_cancelled"));
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
        <LoaderCircle className="size-6 animate-spin text-zinc-400" />
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
      l("patients_revoke_assignment_confirm").replace(
        "{name}",
        item.user_name,
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
    patientLabelFormatRef.current = format;
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
        emptyOrdersLabel={l("patients_no_orders_have_been_recorded_for_this_patient_yet")}
        emptyAppointmentsLabel={l("patients_no_appointments_are_scheduled_for_this_patient_yet")}
        fieldValue={fieldVal}
        filteredDocuments={filteredDocuments}
        filteredTimeline={filteredTimeline}
        financialLedger={financialLedger}
        financialSummary={financialSummary}
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
        onDocumentCategoryFilterChange={setDocumentCategoryFilter}
        onDocumentStatusFilterChange={setDocumentStatusFilter}
        onEditContractStatus={openContractStatusEditor}
        onEditRelation={openEditRelation}
        onInvoicesPreviewOpenChange={setInvoicesPreviewOpen}
        onLegalStatusSheetOpenChange={setLegalStatusSheetOpen}
        onManageInvoice={openInvoiceManager}
        onMedicalOrderSheetOpenChange={setMedicalOrderSheetOpen}
        onNotesSheetOpenChange={setNotesSheetOpen}
        onOpenAppointment={(appointmentId) => { staffGo(`/appointments?appointment=${appointmentId}`); }}
        onOpenCase={openCaseWorkspace}
        onOpenContract={(contractId) => {
          window.open(`/contracts?contract=${contractId}`, "_blank", "noopener,noreferrer");
        }}
        onOpenInvoice={(invoiceId) => {
          window.open(`/invoices?invoice=${invoiceId}`, "_blank", "noopener,noreferrer");
        }}
        onOpenOrder={(orderId) => { staffGo(`/orders/${orderId}?patient=${id}`); }}
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
        servicePackages={servicePackages}
        staffGo={staffGo}
        statusColors={STATUS_COLORS}
        statusBadgeClasses={STATUS_BADGE_CLASSES}
        t={t}
        tabActionError={tabActionError}
        tabError={tabError}
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

export function PatientDetailPage(...args: Parameters<typeof usePatientDetailPageContent>) {
  return usePatientDetailPageContent(...args);
}
