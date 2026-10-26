import { ApiRequestError } from "@/lib/api";

import type { PayerDeclaration, Tx } from "./lead-payer";

/**
 * Staff's entry of a third-party payer's payment route (section 8 of the
 * owner's form) in the wizard's payer section (owner 2026-10-26,
 * `POST /leads/{id}/payer-declaration/payment-route`). The keys, the choices
 * and the rules are the payer link's (`lead_payer.rs`, `PortalBillingPatch`):
 * the server validates and clears what belongs to another answer; this model
 * only mirrors it so the form shows the right fields and errors before the
 * save. Staff's route counts for the risk at once; the payer's later answer
 * on the link replaces it (last writer wins).
 */

/** The seven keys of section 8, in form order (API keys = column names). */
export const PAYMENT_ROUTE_FIELDS = [
  "payment_method",
  "payment_method_details",
  "account_country",
  "account_holder",
  "bank_name",
  "via_third_party",
  "via_third_party_details",
] as const;

export type PaymentRouteField = (typeof PAYMENT_ROUTE_FIELDS)[number];

/**
 * The methods staff choose from: those the server accepts. Cryptocurrency is
 * no longer offered (owner 2026-10-12); an older answer is shown and kept
 * while staff leave the method alone.
 */
export const STAFF_PAYMENT_METHODS = ["bank_transfer", "card", "cash", "other"] as const;

/** Who gave the stored route (`declaration.payment_route_source`). */
export type PaymentRouteSource = "payer" | "staff" | "lead";

/** Section 8 as staff type it: texts, the yes/no answer as "yes", "no" or "". */
export type PaymentRouteDraft = Record<PaymentRouteField, string>;

/** The server's limits (`SHORT_TEXT_MAX`, `LONG_TEXT_MAX`). */
const SHORT_TEXT_MAX = 200;
const LONG_TEXT_MAX = 2000;

const ACCOUNT_FIELDS: readonly PaymentRouteField[] = ["account_country", "account_holder", "bank_name"];

/** The method is a bank transfer or a card payment: the account is asked for. */
export function routeAsksAccount(method: string): boolean {
  return method === "bank_transfer" || method === "card";
}

export function paymentRouteDraft(declaration: PayerDeclaration | null | undefined): PaymentRouteDraft {
  const via = declaration?.via_third_party;
  return {
    payment_method: declaration?.payment_method ?? "",
    payment_method_details: declaration?.payment_method_details ?? "",
    account_country: declaration?.account_country ?? "",
    account_holder: declaration?.account_holder ?? "",
    bank_name: declaration?.bank_name ?? "",
    via_third_party: via == null ? "" : via ? "yes" : "no",
    via_third_party_details: declaration?.via_third_party_details ?? "",
  };
}

/** Whether the form shows a field: details with "other", the account with a transfer or a card, the description with "yes". */
export function paymentRouteFieldShown(field: PaymentRouteField, draft: PaymentRouteDraft): boolean {
  if (field === "payment_method_details") return draft.payment_method === "other";
  if (ACCOUNT_FIELDS.includes(field)) return routeAsksAccount(draft.payment_method);
  if (field === "via_third_party_details") return draft.via_third_party === "yes";
  return true;
}

/** The draft after another method: what belongs to another answer goes, as on the server. */
export function withRouteMethod(draft: PaymentRouteDraft, method: string): PaymentRouteDraft {
  const next = { ...draft, payment_method: method };
  if (method !== "other") next.payment_method_details = "";
  if (!routeAsksAccount(method)) for (const field of ACCOUNT_FIELDS) next[field] = "";
  return next;
}

/** The draft after "through a third person or a payment service provider?". */
export function withRouteViaThirdParty(draft: PaymentRouteDraft, answer: string): PaymentRouteDraft {
  return { ...draft, via_third_party: answer, via_third_party_details: answer === "yes" ? draft.via_third_party_details : "" };
}

/** What would be stored, as text: single lines collapsed, the description only trimmed. */
function routeValue(field: PaymentRouteField, draft: PaymentRouteDraft): string {
  const value = (draft[field] ?? "").trim();
  return field === "via_third_party_details" ? value.replace(/\r\n?/g, "\n") : value.replace(/\s+/g, " ");
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
// eslint-disable-next-line no-control-regex
const CONTROL_MULTILINE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/;

/** The errors the server would answer, by field (empty when the draft can be saved). */
export function paymentRouteErrors(draft: PaymentRouteDraft, tx: Tx): Partial<Record<PaymentRouteField, string>> {
  const errors: Partial<Record<PaymentRouteField, string>> = {};
  const method = routeValue("payment_method", draft);
  if (method && !(STAFF_PAYMENT_METHODS as readonly string[]).includes(method) && method !== "crypto") {
    errors.payment_method = tx("Выберите способ из списка", "Bitte eine Zahlungsart aus der Liste wählen");
  }
  const country = routeValue("account_country", draft);
  if (country && !/^[A-Za-z]{2}$/.test(country)) {
    errors.account_country = tx("Укажите страну из списка", "Bitte ein Land aus der Liste wählen");
  }
  for (const field of ["payment_method_details", "account_holder", "bank_name"] as const) {
    const value = routeValue(field, draft);
    if (value.length > SHORT_TEXT_MAX) errors[field] = tx(`Не более ${SHORT_TEXT_MAX} символов`, `Höchstens ${SHORT_TEXT_MAX} Zeichen`);
    else if (CONTROL.test(value)) errors[field] = tx("Недопустимые символы", "Ungültige Zeichen");
  }
  const description = routeValue("via_third_party_details", draft);
  if (description.length > LONG_TEXT_MAX) {
    errors.via_third_party_details = tx(`Не более ${LONG_TEXT_MAX} символов`, `Höchstens ${LONG_TEXT_MAX} Zeichen`);
  } else if (CONTROL_MULTILINE.test(description)) {
    errors.via_third_party_details = tx("Недопустимые символы", "Ungültige Zeichen");
  }
  return errors;
}

/**
 * The body of the save: only the keys whose value differs from `saved` (a
 * cleared text as `null`, the yes/no answer as `true`, `false` or `null`).
 * An untouched older answer (cryptocurrency) is never sent back.
 */
export function paymentRoutePatch(draft: PaymentRouteDraft, saved: PaymentRouteDraft): Record<string, string | boolean | null> {
  const patch: Record<string, string | boolean | null> = {};
  for (const field of PAYMENT_ROUTE_FIELDS) {
    const value = routeValue(field, draft);
    if (value === routeValue(field, saved)) continue;
    if (field === "via_third_party") patch[field] = value === "yes" ? true : value === "no" ? false : null;
    else if (field === "account_country") patch[field] = value ? value.toUpperCase() : null;
    else patch[field] = value || null;
  }
  return patch;
}

/** The stored route's author as the block says it; "" without a route. */
export function paymentRouteSourceLabel(source: PaymentRouteSource | string | null | undefined, tx: Tx): string {
  switch (source) {
    case "payer":
      return tx("указал плательщик", "vom Zahler angegeben");
    case "staff":
      return tx("внесено сотрудником", "von GMED eingetragen");
    case "lead":
      return tx("указал пациент в кабинете", "vom Patienten im Portal angegeben");
    default:
      return "";
  }
}

/** The field a refused save names (422 `invalid_field`), with the server's message; null for another error. */
export function paymentRouteServerError(error: unknown): { field: string; message: string } | null {
  if (!(error instanceof ApiRequestError) || error.status !== 422) return null;
  const body = error.body;
  if (body?.error !== "invalid_field" || typeof body.field !== "string") return null;
  return { field: body.field, message: typeof body.message === "string" ? body.message : "" };
}
