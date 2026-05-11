import type {
  CreateOrderFormState,
  ExternalInvoiceFormState,
  ExternalInvoiceStatus,
  Leistung,
  LeistungFormState,
  OrderExecutionFlow,
  OrderExecutionFormState,
  OrderFollowupFlow,
  OrderFollowupFormState,
  OrderPhase,
  OrderPlanningFormState,
  OrderPlanningPreparation,
  OrderProcessGateFormState,
  OrderProcessGates,
  OrdersFilters,
  OrdersPermissions,
  OrderStatus,
  PatientOption,
  WorkflowChecklistFormState,
} from "./types";
import {
  formatUnknownValue,
  getLang,
  t as translateCatalog,
  type Translations,
} from "@/lib/i18n";

type UnknownValueTranslations = Pick<
  Translations,
  "common_unknown" | "common_unknown_value"
>;

function unknownValueLabel(
  value: string,
  translations?: UnknownValueTranslations,
) {
  return formatUnknownValue(value, translations ?? translateCatalog(getLang()));
}

export const ORDER_PHASES: OrderPhase[] = [
  "discovery",
  "intake",
  "execution",
  "closure",
  "followup",
];

export const ORDER_STATUSES: OrderStatus[] = [
  "active",
  "paused",
  "completed",
  "cancelled",
];

export const EXTERNAL_INVOICE_STATUSES: ExternalInvoiceStatus[] = [
  "expected",
  "received",
  "approved",
  "paid",
  "overdue",
  "cancelled",
];

export const DEFAULT_FILTERS: OrdersFilters = {
  search: "",
  phase: "",
  status: "",
  patientId: "",
  providerId: "",
  doctorId: "",
};

export function orderPermissions(role?: string): OrdersPermissions {
  switch (role) {
    case "ceo":
    case "patient_manager":
      return {
        canViewPage: true,
        canCreate: true,
        canManagePhase: true,
        canAddLeistung: true,
        canApproveLeistung: true,
        canManageExternalInvoices: true,
      };
    case "billing":
      return {
        canViewPage: true,
        canCreate: false,
        canManagePhase: false,
        canAddLeistung: false,
        canApproveLeistung: false,
        canManageExternalInvoices: true,
      };
    default:
      return {
        canViewPage: false,
        canCreate: false,
        canManagePhase: false,
        canAddLeistung: false,
        canApproveLeistung: false,
        canManageExternalInvoices: false,
      };
  }
}

export function blankCreateOrderForm(): CreateOrderFormState {
  return { patientId: "", needsDescription: "" };
}

export function blankLeistungForm(): LeistungFormState {
  return {
    description: "",
    quantity: "1",
    unitPrice: "",
    vatRate: "19",
    providerId: "",
    doctorId: "",
    externalDocumentId: "",
    notes: "",
    isCostPassthrough: false,
  };
}

export function blankExternalInvoiceForm(): ExternalInvoiceFormState {
  return {
    providerId: "",
    externalInvoiceNumber: "",
    invoiceDate: "",
    dueDate: "",
    amountNet: "",
    amountVat: "",
    amountGross: "",
    currency: "EUR",
    status: "expected",
    notes: "",
  };
}

export function blankWorkflowChecklistForm(): WorkflowChecklistFormState {
  return {
    itemText: "",
    ownerUserId: "",
    priority: "normal",
    dueDate: "",
  };
}

export function blankOrderProcessGateForm(): OrderProcessGateFormState {
  return {
    debtStatus: "review_required",
    debtNote: "",
    debtOwnerUserId: "",
    debtNextReviewAt: "",
    debtLastContactAt: "",
    debtResolutionNote: "",
    billingReleaseStatus: "pending",
    billingReleaseNote: "",
    packageCoverageStatus: "unknown",
    packageCoverageNote: "",
  };
}

export function blankOrderPlanningForm(): OrderPlanningFormState {
  return {
    treatmentPlanStatus: "draft",
    treatmentPlanNote: "",
    nonMedicalRequired: false,
    interpreterRequired: false,
    preparationDocumentsStatus: "pending",
    interpreterBriefingStatus: "not_needed",
  };
}

export function blankOrderExecutionForm(): OrderExecutionFormState {
  return {
    arrivalStatus: "pending",
    medicalExecutionStatus: "pending",
    nonMedicalExecutionStatus: "not_required",
    interpreterServiceStatus: "not_required",
    issueStatus: "pending",
    deviationNote: "",
    executionSummary: "",
  };
}

export function blankOrderFollowupForm(): OrderFollowupFormState {
  return {
    doctorFollowupStatus: "not_required",
    followup1wStatus: "pending",
    followup1mStatus: "pending",
    followup6mStatus: "pending",
    packageEndDate: "",
    packageEndStatus: "not_required",
    resultsHandoffStatus: "pending",
    followupSummary: "",
  };
}

export function orderProcessGatesToForm(
  processGates?: OrderProcessGates | null,
): OrderProcessGateFormState {
  if (!processGates) return blankOrderProcessGateForm();
  return {
    debtStatus: processGates.debt_management?.status ?? "review_required",
    debtNote: processGates.debt_management?.note ?? "",
    debtOwnerUserId: processGates.debt_management?.owner_user_id ?? "",
    debtNextReviewAt: toDateTimeInputValue(
      processGates.debt_management?.next_review_at,
    ),
    debtLastContactAt: toDateTimeInputValue(
      processGates.debt_management?.last_contact_at,
    ),
    debtResolutionNote: processGates.debt_management?.resolution_note ?? "",
    billingReleaseStatus: processGates.billing_release_status,
    billingReleaseNote: processGates.billing_release_note ?? "",
    packageCoverageStatus: processGates.package_coverage_status,
    packageCoverageNote: processGates.package_coverage_note ?? "",
  };
}

export function orderPlanningToForm(
  planning?: OrderPlanningPreparation | null,
): OrderPlanningFormState {
  if (!planning) return blankOrderPlanningForm();
  return {
    treatmentPlanStatus: planning.treatment_plan_status,
    treatmentPlanNote: planning.treatment_plan_note ?? "",
    nonMedicalRequired: planning.non_medical_required,
    interpreterRequired: planning.interpreter_required,
    preparationDocumentsStatus: planning.preparation_documents_status,
    interpreterBriefingStatus: planning.interpreter_briefing_status,
  };
}

export function orderExecutionToForm(
  execution?: OrderExecutionFlow | null,
): OrderExecutionFormState {
  if (!execution) return blankOrderExecutionForm();
  return {
    arrivalStatus: execution.arrival_status,
    medicalExecutionStatus: execution.medical_execution_status,
    nonMedicalExecutionStatus: execution.non_medical_execution_status,
    interpreterServiceStatus: execution.interpreter_service_status,
    issueStatus: execution.issue_status,
    deviationNote: execution.deviation_note ?? "",
    executionSummary: execution.execution_summary ?? "",
  };
}

export function orderFollowupToForm(
  followup?: OrderFollowupFlow | null,
): OrderFollowupFormState {
  if (!followup) return blankOrderFollowupForm();
  return {
    doctorFollowupStatus: followup.doctor_followup_status,
    followup1wStatus: followup.followup_1w_status,
    followup1mStatus: followup.followup_1m_status,
    followup6mStatus: followup.followup_6m_status,
    packageEndDate:
      followup.package_end_date ?? followup.suggested_package_end_date ?? "",
    packageEndStatus: followup.package_end_status,
    resultsHandoffStatus: followup.results_handoff_status,
    followupSummary: followup.followup_summary ?? "",
  };
}

export function workflowChecklistLabel(
  key: string,
  labels?: Partial<Record<OrderPhase | "custom", string>>,
  translations?: UnknownValueTranslations,
) {
  switch (key) {
    case "order_discovery":
      return labels?.discovery ?? "Discovery";
    case "order_intake":
      return labels?.intake ?? "Intake";
    case "order_execution":
      return labels?.execution ?? "Execution";
    case "order_closure":
      return labels?.closure ?? "Closure";
    case "order_followup":
      return labels?.followup ?? "Follow-up";
    case "order_custom":
      return labels?.custom ?? "Custom";
    default:
      return unknownValueLabel(key, translations);
  }
}

export function recheckMissingFieldLabel(
  field: string,
  labels?: Partial<Record<"primary_contact" | "country" | "language", string>>,
  translations?: UnknownValueTranslations,
) {
  switch (field) {
    case "primary_contact":
      return labels?.primary_contact ?? "Primary contact";
    case "country":
      return labels?.country ?? "Country";
    case "language":
      return labels?.language ?? "Preferred language";
    default:
      return unknownValueLabel(field, translations);
  }
}

export function optString(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function formatDate(
  value: string | null | undefined,
  locale = "de-DE",
  emptyLabel = "Nicht festgelegt",
) {
  if (!value) return emptyLabel;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(locale, { dateStyle: "medium" });
}

export function numberFromUnknown(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function formatNumber(value: unknown, locale = "de-DE") {
  const parsed = numberFromUnknown(value);
  if (parsed == null) {
    if (typeof value === "string") return value;
    return "0";
  }
  return parsed.toLocaleString(locale, {
    maximumFractionDigits: 2,
  });
}

export function formatCurrency(value: unknown, currency = "EUR", locale = "de-DE") {
  const parsed = numberFromUnknown(value);
  if (parsed == null) {
    const fallback = typeof value === "string" && value.trim() ? value : "0";
    return `${fallback} ${currency}`;
  }
  return parsed.toLocaleString(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  });
}

export function formatDateTime(
  value: string | null | undefined,
  locale = "de-DE",
  emptyLabel = "Nicht festgelegt",
) {
  if (!value) return emptyLabel;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function formatDateOnly(
  value: string | null | undefined,
  locale = "de-DE",
  emptyLabel = "Nicht festgelegt",
) {
  if (!value) return emptyLabel;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(locale, { dateStyle: "medium" });
}

function toDateTimeInputValue(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function inputDateTimeToApiValue(value: string) {
  if (!value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function patientLabel(patient: PatientOption, fallback = "Patient") {
  const name = [patient.first_name, patient.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  return `${name || fallback} (${patient.patient_id})`;
}

export function nextPhase(current: string) {
  const index = ORDER_PHASES.indexOf(current as OrderPhase);
  if (index < 0 || index >= ORDER_PHASES.length - 1) return null;
  return ORDER_PHASES[index + 1];
}

export function sumLeistungTotals(items: Leistung[]) {
  return items.reduce((sum, item) => {
    const quantity = numberFromUnknown(item.quantity) ?? 0;
    const unitPrice = numberFromUnknown(item.unit_price) ?? 0;
    return sum + quantity * unitPrice;
  }, 0);
}
