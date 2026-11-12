import type { Lang } from "@/lib/i18n";
import { normalizeMoneyInput } from "@/lib/money";

export const CONCIERGE_EXPENSE_MAX_FILE_SIZE = 25 * 1024 * 1024;

export type ConciergeExpensePaidBy = "patient" | "agency" | "unpaid";
export type ConciergeExpenseStatus = "pending_review" | "posted" | "rejected" | "reversed";

export type ConciergeExpenseActor = {
  id: string;
  display_name: string;
};

export type ConciergeExpenseReceipt = {
  document_id: string;
  original_filename: string;
  mime_type: string;
  file_size: number;
  download_url: string;
};

export type ConciergeExpenseBalanceConsequence = {
  state: "none" | "pending" | "receivable" | "reversed";
  patient_receivable_gross: string;
  provider_liability_gross: string;
  company_paid_gross: string;
};

export type ConciergeExpenseItem = {
  id: string;
  status: ConciergeExpenseStatus;
  patient_id: string;
  order_id: string | null;
  order_number: string | null;
  order_leistung_id: string | null;
  order_leistung_name: string | null;
  vendor: string;
  expense_date: string;
  amount_net: string;
  amount_vat: string;
  amount_gross: string;
  currency: string;
  paid_by: ConciergeExpensePaidBy;
  service_delivered: boolean;
  note: string | null;
  receipt: ConciergeExpenseReceipt | null;
  document_missing: boolean;
  external_invoice_id: string | null;
  external_invoice_status: string | null;
  balance_consequence: ConciergeExpenseBalanceConsequence;
  submitted_by: ConciergeExpenseActor;
  reviewed_by: ConciergeExpenseActor | null;
  submitted_at: string;
  reviewed_at: string | null;
  /** Submission, review and storno events, with the reviewer's reason. */
  history?: ConciergeExpenseHistoryEvent[];
};

export type ConciergeExpenseHistoryEvent = {
  action: "submitted" | "posted" | "rejected" | "reversed";
  actor: { id: string | null; display_name: string | null } | null;
  reason: string | null;
  created_at: string | null;
};

/**
 * Net and gross total of the receipts Billing posted for a service (not
 * rejected, not reversed, not waiting), in cents to stay exact.
 */
export function postedReceiptTotals(items: Pick<ConciergeExpenseItem, "status" | "amount_net" | "amount_gross">[]) {
  let netCents = 0;
  let grossCents = 0;
  let count = 0;
  for (const item of items) {
    if (item.status !== "posted") continue;
    count += 1;
    netCents += moneyStringToMinorUnits(item.amount_net) ?? 0;
    grossCents += moneyStringToMinorUnits(item.amount_gross) ?? 0;
  }
  return { count, netCents, grossCents };
}

/**
 * The concierge types the «actual cost» freely; it should match the posted
 * receipts (net or gross). A mismatch warns, never blocks (QA 2026-11-12 C-9).
 * An empty field does not warn.
 */
export function actualCostMismatch(
  actualCost: number,
  totals: { count: number; netCents: number; grossCents: number },
) {
  if (!totals.count || !Number.isFinite(actualCost)) return false;
  const actualCents = Math.round(actualCost * 100);
  return actualCents !== totals.netCents && actualCents !== totals.grossCents;
}

/**
 * Whether the role may read a Concierge service's receipts — the server's
 * rule (finance roles, or the service's own concierge). Other roles that open
 * the edit form skip the call instead of drawing a 403 (QA 2026-11-13, F-B3).
 */
export function readsServiceReceipts(
  role: string | null | undefined,
  userId: string | null | undefined,
  assignedConciergeId: string | null | undefined,
) {
  if (role === "ceo" || role === "billing" || role === "ceo_assistant") return true;
  return role === "concierge" && !!userId && userId === assignedConciergeId;
}

const EXPENSE_SUBMIT_ERRORS: Record<string, Record<Lang, string>> = {
  concierge_expense_duplicate_receipt: {
    de: "Dieser Beleg wurde für diese Aufgabe oder Concierge-Leistung bereits eingereicht.",
    ru: "Этот чек уже отправлен по этой задаче или услуге Concierge.",
  },
};

/**
 * The refusal of a receipt submission in the dialog's language; the
 * server's English text only for refusals without a translation (release QA
 * 2026-11-13, F-B2).
 */
export function conciergeExpenseSubmitErrorMessage(error: unknown, lang: Lang, fallback: string) {
  const code = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  const translated = typeof code === "string" ? EXPENSE_SUBMIT_ERRORS[code]?.[lang] : undefined;
  if (translated) return translated;
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * Why Billing rejected or reversed a receipt, shown to the concierge in the
 * task (QA 2026-11-12 C-7); null for other states or without a reason.
 */
export function expenseDecisionReason(item: Pick<ConciergeExpenseItem, "status" | "history">) {
  if (item.status !== "rejected" && item.status !== "reversed") return null;
  const event = [...(item.history ?? [])].reverse().find((entry) => entry.action === item.status);
  const reason = event?.reason?.trim();
  return reason ? reason : null;
}

export type ConciergeExpenseListResponse = {
  items: ConciergeExpenseItem[];
};

export type ConciergeExpenseMutationResponse = {
  item: ConciergeExpenseItem;
  idempotent_replay: boolean;
};

export type ConciergeExpenseMappedService = {
  id: string;
  name: string;
  description: string | null;
  provider_id: string | null;
};

export type ConciergeExpenseMappedOrder = {
  id: string;
  order_number: string;
  currency: string;
  status: string;
  mapped_leistung: ConciergeExpenseMappedService | null;
};

export type ConciergeExpenseContext = {
  patient: {
    id: string;
    display_name: string;
    pid: string;
  } | null;
  service: {
    id: string;
    title: string;
    currency: string;
    provider_id: string | null;
  } | null;
  task?: {
    id: string;
    title: string;
    currency: string;
    provider_id: string | null;
    assigned_to: string;
    assigned_by: string;
  } | null;
  mapped_order: ConciergeExpenseMappedOrder | null;
};

export type ConciergeExpenseSubmitInput = {
  requestId: string;
  orderId: string | null;
  orderLeistungId: string | null;
  vendor: string;
  expenseDate: string;
  amountNet: string;
  amountVat: string;
  amountGross: string;
  currency: string;
  paidBy: ConciergeExpensePaidBy;
  serviceDelivered: boolean;
  note: string | null;
  documentMissing: boolean;
  file: File | null;
};

export type ReceiptFileValidationError = "required" | "too_large" | "unsupported_type";

type ReceiptFileLike = Pick<File, "name" | "size" | "type">;

const RECEIPT_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const RECEIPT_EXTENSIONS = new Set(["pdf", "jpg", "jpeg", "png", "webp"]);

export function validateConciergeExpenseReceiptFile(
  file: ReceiptFileLike | null,
): ReceiptFileValidationError | null {
  if (!file) return "required";
  if (file.size <= 0 || file.size > CONCIERGE_EXPENSE_MAX_FILE_SIZE) return "too_large";
  const mime = file.type.trim().toLocaleLowerCase();
  const extension = file.name.split(".").at(-1)?.toLocaleLowerCase() ?? "";
  if (RECEIPT_MIME_TYPES.has(mime)) return null;
  if ((!mime || mime === "application/octet-stream") && RECEIPT_EXTENSIONS.has(extension)) {
    return null;
  }
  return "unsupported_type";
}

export function moneyStringToMinorUnits(value: string): number | null {
  // Typed as "1.234,56", "1234,56" or "1234.56" (owner 2026-11-11, German money format).
  const normalized = normalizeMoneyInput(value) ?? "";
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

export function minorUnitsToMoneyString(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) return "";
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}`;
}

function percentageStringToBasisPoints(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  const basisPoints = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(basisPoints) && basisPoints <= 10_000 ? basisPoints : null;
}

export function calculateConciergeExpenseVat(net: string, vatRate: string): string {
  const netMinor = moneyStringToMinorUnits(net);
  const vatBasisPoints = percentageStringToBasisPoints(vatRate);
  if (netMinor === null || vatBasisPoints === null) return "";
  const vatMinorBigInt = (BigInt(netMinor) * BigInt(vatBasisPoints) + 5_000n) / 10_000n;
  if (vatMinorBigInt > BigInt(Number.MAX_SAFE_INTEGER)) return "";
  return minorUnitsToMoneyString(Number(vatMinorBigInt));
}

export function calculateConciergeExpenseGross(net: string, vatRate: string): string {
  const netMinor = moneyStringToMinorUnits(net);
  const vatMinor = moneyStringToMinorUnits(calculateConciergeExpenseVat(net, vatRate));
  if (netMinor === null || vatMinor === null) return "";
  return minorUnitsToMoneyString(netMinor + vatMinor);
}

export function calculateConciergeExpenseNetFromGross(gross: string, vatRate: string): string {
  const grossMinor = moneyStringToMinorUnits(gross);
  const vatBasisPoints = percentageStringToBasisPoints(vatRate);
  if (grossMinor === null || vatBasisPoints === null) return "";
  const divisor = BigInt(10_000 + vatBasisPoints);
  const netMinorBigInt = (BigInt(grossMinor) * 10_000n + divisor / 2n) / divisor;
  if (netMinorBigInt > BigInt(Number.MAX_SAFE_INTEGER)) return "";
  return minorUnitsToMoneyString(Number(netMinorBigInt));
}

export function calculateConciergeExpenseVatFromGross(gross: string, vatRate: string): string {
  const grossMinor = moneyStringToMinorUnits(gross);
  const netMinor = moneyStringToMinorUnits(calculateConciergeExpenseNetFromGross(gross, vatRate));
  if (grossMinor === null || netMinor === null || netMinor > grossMinor) return "";
  return minorUnitsToMoneyString(grossMinor - netMinor);
}

export type ConciergeExpenseConsequencePreview = {
  patientReceivableGross: string;
  providerLiabilityGross: string;
  companyPaidGross: string;
  /** The patient's share is only booked once the service is delivered. */
  patientReceivableAfterDelivery?: boolean;
};

export function conciergeExpenseConsequencePreview(
  paidBy: ConciergeExpensePaidBy,
  serviceDelivered: boolean,
  gross: string,
): ConciergeExpenseConsequencePreview {
  const amount = moneyStringToMinorUnits(gross);
  const normalized = amount === null ? "0.00" : minorUnitsToMoneyString(amount);
  if (paidBy === "patient") {
    return {
      patientReceivableGross: "0.00",
      providerLiabilityGross: "0.00",
      companyPaidGross: "0.00",
    };
  }
  if (paidBy === "agency") {
    return {
      patientReceivableGross: normalized,
      providerLiabilityGross: "0.00",
      companyPaidGross: normalized,
    };
  }
  // Not yet paid: the partner is owed the amount and the patient's share is
  // the same amount, booked once the service is delivered.
  return {
    patientReceivableGross: normalized,
    providerLiabilityGross: normalized,
    companyPaidGross: "0.00",
    patientReceivableAfterDelivery: !serviceDelivered,
  };
}
