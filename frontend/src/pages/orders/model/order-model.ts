import { appWallClock, berlinLocalInputToIso, isoToBerlinLocalInput } from "@/lib/app-time-zone";
import {
  formatMoneyAmount,
  moneyLineAmounts,
  roundCents,
  type MoneyLineAmounts,
} from "@/lib/money";
import { hasCapability, type Actor } from "@/lib/permissions";

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
  OrderReadScope,
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
  uiText,
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

export function externalInvoiceStatusTransitions(
  current: ExternalInvoiceStatus,
): ExternalInvoiceStatus[] {
  switch (current) {
    case "expected":
      return ["received", "cancelled"];
    case "received":
      return ["approved", "cancelled"];
    case "approved":
    case "overdue":
      return ["paid", "cancelled"];
    case "paid":
    case "cancelled":
      return [];
  }
}

export const DEFAULT_FILTERS: OrdersFilters = {
  search: "",
  phase: "",
  status: "",
  patientId: "",
  providerId: "",
  providerTaxonomyNodeId: "",
  doctorId: "",
};

export function orderPermissions(actor?: Actor): OrdersPermissions {
  const canEdit = hasCapability(actor, "orders.edit");
  return {
    canViewPage: hasCapability(actor, "orders.view"),
    canCreate: canEdit,
    canManagePhase: canEdit,
    canAddLeistung: canEdit,
    canApproveLeistung: canEdit,
    canCancelLeistung: canEdit,
    // Provider (external) invoices: the order owner or finance.
    canManageExternalInvoices: canEdit || hasCapability(actor, "invoices.finance"),
    canManageEconomics: hasCapability(actor, "orders.economics"),
    readsOnlyOrderPart: readsOnlyOrderPart(actor),
  };
}

/**
 * `orders.view` without any commercial capability: the concierge and the
 * interpreter team lead read a projection of their part of an order.
 */
export function readsOnlyOrderPart(actor?: Actor) {
  return (
    hasCapability(actor, "orders.view") &&
    !hasCapability(actor, "orders.edit") &&
    !hasCapability(actor, "orders.economics") &&
    !hasCapability(actor, "invoices.view")
  );
}

/** Whether an order payload is a partial projection (see `readsOnlyOrderPart`). */
export function isPartialOrderRead(detail: { read_scope?: OrderReadScope } | null | undefined) {
  return Boolean(detail?.read_scope && detail.read_scope !== "full");
}

export function blankCreateOrderForm(): CreateOrderFormState {
  return { patientId: "", needsDescription: "" };
}

export function blankLeistungForm(): LeistungFormState {
  return {
    agencyServiceId: "",
    agencyServicePriceVersionId: "",
    description: "",
    quantity: "1",
    unitPrice: "",
    currency: "EUR",
    vatRate: "19",
    plannedPartnerCostNet: "",
    plannedPartnerCostVat: "",
    plannedPartnerCostGross: "",
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
    orderLeistungId: "",
    externalInvoiceNumber: "",
    invoiceDate: "",
    dueDate: "",
    amountNet: "",
    amountVat: "",
    amountGross: "",
    currency: "EUR",
    status: "expected",
    paidBy: "unpaid",
    serviceDelivered: false,
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
    medicalRequired: true,
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
    issueStatus: "not_required",
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
    followup1wDate: "",
    followup1mDate: "",
    followup6mDate: "",
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
    medicalRequired: planning.medical_required ?? true,
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
    followup1wDate: followup.followup_1w_date ?? "",
    followup1mDate: followup.followup_1m_date ?? "",
    followup6mDate: followup.followup_6m_date ?? "",
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
      return labels?.discovery ?? uiText("orders_phase_discovery");
    case "order_intake":
      return labels?.intake ?? uiText("orders_phase_intake");
    case "order_execution":
      return labels?.execution ?? uiText("orders_phase_execution");
    case "order_closure":
      return labels?.closure ?? uiText("orders_phase_closure");
    case "order_followup":
      return labels?.followup ?? uiText("orders_phase_followup");
    case "order_custom":
      return labels?.custom ?? uiText("orders_phase_custom");
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
      return labels?.primary_contact ?? uiText("orders_recheck_primary_contact");
    case "country":
      return labels?.country ?? uiText("orders_recheck_country");
    case "language":
      return labels?.language ?? uiText("orders_recheck_preferred_language");
    default:
      return unknownValueLabel(field, translations);
  }
}

export function optString(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// Dates in the order workspace read DD.MM.YYYY in every staff language
// (docs/architecture/patient-order-wizard-plan_ua.md). A calendar date
// ("2026-09-27") is never shifted through a time zone, and a date-only value
// stored as a UTC-midnight timestamp shows no time of day ("03:00").
const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const UTC_MIDNIGHT = /^(\d{4})-(\d{2})-(\d{2})T00:00(?::00(?:\.0+)?)?(?:Z|[+-]00:?00)$/;

function twoDigits(value: number) {
  return String(value).padStart(2, "0");
}

function calendarDateLabel(value: string): string | null {
  const match = CALENDAR_DATE.exec(value.trim()) ?? UTC_MIDNIGHT.exec(value.trim());
  return match ? `${match[3]}.${match[2]}.${match[1]}` : null;
}

function berlinDateLabel(date: Date) {
  const { year, month, day } = appWallClock(date);
  return `${twoDigits(day)}.${twoDigits(month)}.${year}`;
}

/** DD.MM.YYYY of a calendar date or of a timestamp's Berlin date. */
export function formatDate(
  value: string | null | undefined,
  _locale = "de-DE",
  emptyLabel = translateCatalog(getLang()).common_not_set,
) {
  void _locale;
  if (!value) return emptyLabel;
  const calendarDate = calendarDateLabel(value);
  if (calendarDate) return calendarDate;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return berlinDateLabel(date);
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

export function formatCurrency(value: unknown, currency = "EUR", _locale = "de-DE") {
  void _locale;
  const parsed = numberFromUnknown(value);
  // Unparseable values still render in the unified money style, never "0 EUR".
  return formatMoneyAmount(parsed ?? 0, currency);
}

export function formatOptionalCurrency(
  value: unknown,
  currency = "EUR",
  locale = "de-DE",
  unavailableLabel = "—",
) {
  return numberFromUnknown(value) == null
    ? unavailableLabel
    : formatCurrency(value, currency, locale);
}

/**
 * "DD.MM.YYYY, HH:MM" of a timestamp in Berlin time; a date-only value (a
 * calendar date or a UTC-midnight timestamp) shows the date alone.
 */
export function formatDateTime(
  value: string | null | undefined,
  _locale = "de-DE",
  emptyLabel = translateCatalog(getLang()).common_not_set,
) {
  void _locale;
  if (!value) return emptyLabel;
  const calendarDate = calendarDateLabel(value);
  if (calendarDate) return calendarDate;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const { hour, minute } = appWallClock(date);
  return `${berlinDateLabel(date)}, ${twoDigits(hour)}:${twoDigits(minute)}`;
}

/** DD.MM.YYYY; the same rules as {@link formatDate}. */
export function formatDateOnly(
  value: string | null | undefined,
  locale = "de-DE",
  emptyLabel = translateCatalog(getLang()).common_not_set,
) {
  return formatDate(value, locale, emptyLabel);
}

function toDateTimeInputValue(value: string | null | undefined) {
  return isoToBerlinLocalInput(value);
}

/** A `datetime-local` value, read as Berlin time, as an API timestamp; null when empty or invalid. */
export function inputDateTimeToApiValue(value: string) {
  return berlinLocalInputToIso(value);
}

export function patientLabel(
  patient: PatientOption,
  fallback = translateCatalog(getLang()).orders_patient_fallback,
) {
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

/** Net total of the order's service lines; cancelled lines no longer count. */
export function sumLeistungTotals(items: Leistung[]) {
  return items.reduce((sum, item) => {
    if (item.status === "cancelled") return sum;
    const quantity = numberFromUnknown(item.quantity) ?? 0;
    const unitPrice = numberFromUnknown(item.unit_price) ?? 0;
    return sum + quantity * unitPrice;
  }, 0);
}

/**
 * Net, VAT and gross of one order service line, rounded like quotes and
 * invoices (pass-through costs carry no VAT). The gross is what the line adds
 * to the order total.
 */
export function leistungLineAmounts(item: Leistung): MoneyLineAmounts {
  const quantity = numberFromUnknown(item.quantity) ?? 0;
  const unitPrice =
    numberFromUnknown(item.unit_price_snapshot) ?? numberFromUnknown(item.unit_price) ?? 0;
  const vatRate = item.is_cost_passthrough
    ? 0
    : numberFromUnknown(item.vat_rate_snapshot) ?? numberFromUnknown(item.vat_rate) ?? 0;
  return moneyLineAmounts(quantity, unitPrice, vatRate);
}

/**
 * Counters of the order services. Cancelled lines are left out of the totals
 * and counted separately. "Delivered" includes approved and invoiced services
 * (they were delivered first); "awaiting approval" is delivered but not yet
 * approved.
 */
export function summarizeLeistungMetrics(items: Leistung[]) {
  const active = items.filter((item) => item.status !== "cancelled");
  return {
    total: active.length,
    cancelled: items.length - active.length,
    delivered: active.filter((item) =>
      item.status === "delivered" || item.status === "approved" || item.status === "invoiced"
    ).length,
    awaitingApproval: active.filter((item) => item.status === "delivered").length,
    approved: active.filter((item) =>
      item.status === "approved" || item.status === "invoiced"
    ).length,
    net: roundCents(active.reduce((sum, item) => sum + leistungLineAmounts(item).net, 0)),
    gross: sumLeistungGross(items),
  };
}

/**
 * Gross total of the order services that are not cancelled — the order total
 * the server reports as `total_estimated` for an order with services.
 */
export function sumLeistungGross(items: Leistung[]) {
  return roundCents(
    items.reduce(
      (sum, item) => (item.status === "cancelled" ? sum : sum + leistungLineAmounts(item).gross),
      0,
    ),
  );
}
