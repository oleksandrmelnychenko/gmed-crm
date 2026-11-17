/**
 * What staff note on a new or draft invoice for its issued document (owner
 * 2026-11-17): money that arrived before the invoice (day, amount, method;
 * Billing/CEO only) and the service period. The release records the payment
 * with its day and prints both. The server checks everything again.
 */

import { normalizeMoneyInput, parseMoneyInput, roundCents, sameCents } from "@/lib/money";

import { INVOICE_PAYMENT_METHODS } from "./payment-correction";

export type ReceivedPaymentForm = {
  enabled: boolean;
  receivedOn: string;
  /** Empty = what is left to pay at the release («К оплате», after advances). */
  amount: string;
  method: string;
};

export type ServicePeriodForm = {
  from: string;
  to: string;
};

export type ReceivedPaymentPayload = {
  received_on: string;
  amount_gross: string | null;
  payment_method: string;
};

export type ServicePeriodPayload = { from: string | null; to: string };

export const blankReceivedPayment = (): ReceivedPaymentForm => ({
  enabled: false,
  receivedOn: "",
  amount: "",
  method: "bank_transfer",
});

export function receivedPaymentFormFrom(payload: ReceivedPaymentPayload | null | undefined): ReceivedPaymentForm {
  if (!payload) return blankReceivedPayment();
  const amount = payload.amount_gross == null ? Number.NaN : Number(payload.amount_gross);
  return {
    enabled: true,
    receivedOn: payload.received_on,
    amount: Number.isFinite(amount) ? formatMoneyInput(amount) : "",
    method: payload.payment_method,
  };
}

/** «2.144,91»: the German money format the dialogs show. */
export function formatMoneyInput(amount: number): string {
  return amount.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export type ReceivedPaymentProblem = "missing_date" | "future_date" | "invalid_amount" | "invalid_method";

/** The amount staff typed, else what is due («К оплате»). */
export function receivedAmount(form: ReceivedPaymentForm, dueGross: number): number {
  if (form.amount.trim() === "") return roundCents(dueGross);
  return parseMoneyInput(form.amount);
}

export function receivedPaymentProblem(
  form: ReceivedPaymentForm,
  dueGross: number,
  today: string,
): ReceivedPaymentProblem | null {
  if (!form.enabled) return null;
  if (!form.receivedOn) return "missing_date";
  if (form.receivedOn > today) return "future_date";
  // Left empty: the server takes what is due at the release.
  if (form.amount.trim() === "") return (INVOICE_PAYMENT_METHODS as readonly string[]).includes(form.method) ? null : "invalid_method";
  const amount = receivedAmount(form, dueGross);
  if (!Number.isFinite(amount) || amount <= 0 || !sameCents(amount, roundCents(amount))) return "invalid_amount";
  if (!(INVOICE_PAYMENT_METHODS as readonly string[]).includes(form.method)) return "invalid_method";
  return null;
}

/**
 * A typed amount above what is due: the excess becomes the patient's credit
 * (the release asks to confirm it). 0 when nothing is typed or nothing exceeds.
 */
export function receivedPaymentExcess(form: ReceivedPaymentForm, dueGross: number | null): number {
  if (!form.enabled || form.amount.trim() === "" || dueGross == null || !Number.isFinite(dueGross)) return 0;
  const amount = parseMoneyInput(form.amount);
  if (!Number.isFinite(amount)) return 0;
  return Math.max(0, roundCents(amount - roundCents(dueGross)));
}

/** The body part; an empty amount is sent as null = what is due at the release (the server knows it). */
export function receivedPaymentPayload(form: ReceivedPaymentForm): ReceivedPaymentPayload | null {
  if (!form.enabled) return null;
  return {
    received_on: form.receivedOn,
    amount_gross: form.amount.trim() === "" ? null : normalizeMoneyInput(form.amount) ?? form.amount,
    payment_method: form.method,
  };
}

/** Something is left to pay after the received money: a part payment. */
export function receivedPaymentIsPartial(form: ReceivedPaymentForm, dueGross: number): boolean {
  if (!form.enabled) return false;
  const amount = receivedAmount(form, dueGross);
  return Number.isFinite(amount) && roundCents(amount) < roundCents(dueGross);
}

/** The service period is invalid when the end is missing or before the start. */
export function servicePeriodProblem(form: ServicePeriodForm): "missing_end" | "end_before_start" | null {
  if (!form.from && !form.to) return null;
  if (!form.to) return "missing_end";
  if (form.from && form.from > form.to) return "end_before_start";
  return null;
}

/**
 * The period to send: only one that differs from the default (the period
 * of the lines and the order); null = keep the default.
 */
export function servicePeriodPayload(form: ServicePeriodForm, defaults: ServicePeriodForm): ServicePeriodPayload | null {
  if (!form.to || servicePeriodProblem(form)) return null;
  if (form.from === defaults.from && form.to === defaults.to) return null;
  return { from: form.from || null, to: form.to };
}

export function samePeriod(left: ServicePeriodForm, right: ServicePeriodForm): boolean {
  return left.from === right.from && left.to === right.to;
}

export function sameReceivedPayment(left: ReceivedPaymentForm, right: ReceivedPaymentForm): boolean {
  if (!left.enabled || !right.enabled) return left.enabled === right.enabled;
  const leftOpen = left.amount.trim() === "";
  const rightOpen = right.amount.trim() === "";
  return (
    left.receivedOn === right.receivedOn &&
    left.method === right.method &&
    leftOpen === rightOpen &&
    (leftOpen || sameCents(parseMoneyInput(left.amount), parseMoneyInput(right.amount)))
  );
}

export function receivedPaymentProblemText(problem: ReceivedPaymentProblem, de: boolean): string {
  switch (problem) {
    case "missing_date":
      return de ? "Eingangsdatum der Zahlung angeben." : "Укажите дату поступления оплаты.";
    case "future_date":
      return de ? "Das Eingangsdatum darf nicht in der Zukunft liegen." : "Дата поступления не может быть в будущем.";
    case "invalid_amount":
      return de ? "Betrag der Zahlung prüfen." : "Проверьте сумму оплаты.";
    case "invalid_method":
      return de ? "Zahlungsart wählen." : "Выберите способ оплаты.";
  }
}

/** Amber warning beside a typed amount above what is due (QA verify2 B-5). */
export function receivedPaymentExcessText(due: string, excessText: string, de: boolean): string {
  return de
    ? `Mehr als der offene Betrag (${due}): ${excessText} werden Guthaben des Patienten.`
    : `Больше суммы к оплате (${due}): ${excessText} станут переплатой пациента.`;
}

export function servicePeriodProblemText(problem: "missing_end" | "end_before_start", de: boolean): string {
  return problem === "missing_end"
    ? (de ? "Ende des Leistungszeitraums angeben." : "Укажите конец периода услуг.")
    : (de ? "Das Ende liegt vor dem Beginn." : "Конец периода раньше начала.");
}

export function paymentMethodLabel(method: string, de: boolean): string {
  const labels: Record<string, [string, string]> = {
    bank_transfer: ["Überweisung", "Банковский перевод"],
    card: ["Karte", "Карта"],
    cash: ["Bar", "Наличные"],
    direct_debit: ["Lastschrift", "Прямое списание"],
    cheque: ["Scheck", "Чек"],
    other: ["Sonstige", "Другое"],
  };
  const label = labels[method];
  return label ? label[de ? 0 : 1] : method;
}

/** The period the dialog proposes: the order's planned one. */
export function quotePeriodDefaults(
  quote: { order_period_from?: string | null; order_period_to?: string | null } | null | undefined,
): ServicePeriodForm {
  return { from: quote?.order_period_from ?? "", to: quote?.order_period_to ?? "" };
}

export type DocumentTermsBody = { payment_received?: ReceivedPaymentPayload; service_period?: ServicePeriodPayload };

/** What a new invoice sends beside its lines: the received payment and a period staff changed. */
export function createDocumentTermsPayload(
  form: { receivedPayment: ReceivedPaymentForm; servicePeriod: ServicePeriodForm | null },
  defaults: ServicePeriodForm,
): DocumentTermsBody {
  const body: DocumentTermsBody = {};
  const received = receivedPaymentPayload(form.receivedPayment);
  if (received) body.payment_received = received;
  const period = form.servicePeriod ? servicePeriodPayload(form.servicePeriod, defaults) : null;
  if (period) body.service_period = period;
  return body;
}
