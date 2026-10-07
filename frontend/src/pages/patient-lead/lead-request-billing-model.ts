import type {
  BillingExtrasPatch,
  BillingPatch,
  InvoiceTo,
  LeadRequest,
  LeadRequestBilling,
  PaymentMethod,
  PaymentRouteBy,
} from "./lead-request-api";

// Invoice recipient and payment route (owner spec "Patientenformular",
// sections 7 and 8; contract phase 2). This module imports types only, so
// that `lead-request-model` can take the keys of `progress.missing_for_submit`
// from here.

/** Where the invoice can go, in the order of the form. */
export const INVOICE_TARGETS = ["self", "payer", "other"] as const satisfies readonly InvoiceTo[];

/** How the treatment can be paid, in the order of the form. */
export const PAYMENT_METHODS = ["bank_transfer", "card", "cash", "crypto", "other"] as const satisfies readonly PaymentMethod[];

/** The two sections as the patient types them (strings; answers as "yes", "no" or ""). */
export type BillingDraft = {
  /** "self", "payer", "other" or "" (not answered yet). */
  invoice_to: string;
  invoice_name: string;
  invoice_street: string;
  invoice_zip: string;
  invoice_city: string;
  invoice_country: string;
  invoice_email: string;
  /** One of `PAYMENT_METHODS` or "" (not answered yet). */
  payment_method: string;
  payment_method_details: string;
  account_country: string;
  account_holder: string;
  bank_name: string;
  /** "yes", "no" or "". */
  via_third_party: string;
  via_third_party_details: string;
};

export type BillingField = keyof BillingDraft;

/** The fields of both sections in the order of the form. */
export const BILLING_FIELDS: BillingField[] = [
  "invoice_to",
  "invoice_name",
  "invoice_street",
  "invoice_zip",
  "invoice_city",
  "invoice_country",
  "invoice_email",
  "payment_method",
  "payment_method_details",
  "account_country",
  "account_holder",
  "bank_name",
  "via_third_party",
  "via_third_party_details",
];

/** The fields of section 7, the invoice recipient. */
export const INVOICE_FIELDS: readonly BillingField[] = BILLING_FIELDS.slice(0, 7);

/** The fields of section 8, the payment route: the payer's answer, not asked of anybody else. */
export const PAYMENT_ROUTE_FIELDS: readonly BillingField[] = BILLING_FIELDS.slice(7);

/** The address of another recipient, asked with the answer `other`. */
const INVOICE_ADDRESS_FIELDS: readonly BillingField[] = ["invoice_name", "invoice_street", "invoice_zip", "invoice_city", "invoice_country"];

/** The account the payment comes from, asked with a bank transfer or a card. */
const ACCOUNT_FIELDS: readonly BillingField[] = ["account_country", "account_holder", "bank_name"];

/** Free texts that may run over several lines: only the ends are trimmed. */
const MULTILINE_FIELDS: ReadonlySet<BillingField> = new Set(["via_third_party_details"]);

/** Whether the cabinet asks section 8 at all: the patient or the paying parent answers it, the payer does not. */
export function asksPaymentRoute(routeBy: PaymentRouteBy): boolean {
  return routeBy !== "payer";
}

/** The method is a bank transfer or a card payment: the account is asked for. */
export function asksAccount(method: string): boolean {
  return method === "bank_transfer" || method === "card";
}

export function draftFromBilling(billing: LeadRequestBilling | null | undefined): BillingDraft {
  return {
    invoice_to: billing?.invoice_to ?? "",
    invoice_name: billing?.invoice_name ?? "",
    invoice_street: billing?.invoice_street ?? "",
    invoice_zip: billing?.invoice_zip ?? "",
    invoice_city: billing?.invoice_city ?? "",
    invoice_country: billing?.invoice_country ?? "",
    invoice_email: billing?.invoice_email ?? "",
    payment_method: billing?.payment_method ?? "",
    payment_method_details: billing?.payment_method_details ?? "",
    account_country: billing?.account_country ?? "",
    account_holder: billing?.account_holder ?? "",
    bank_name: billing?.bank_name ?? "",
    via_third_party: billing?.via_third_party == null ? "" : billing.via_third_party ? "yes" : "no",
    via_third_party_details: billing?.via_third_party_details ?? "",
  };
}

/** The answers of the form that decide which fields are asked. */
export type BillingContext = {
  routeBy: PaymentRouteBy;
  /** A third party is declared: "to the payer" is an answer. */
  payerDeclared: boolean;
};

/**
 * Whether a field is asked, given the answers so far. Another address is
 * asked with `other`; the e-mail for invoices goes to the patient or to that
 * address, never to the payer. Section 8 is asked of the patient or the
 * paying parent only; the account with a bank transfer or a card, the
 * details with "other" and with a "yes".
 */
export function asksBillingField(field: BillingField, draft: BillingDraft, context: BillingContext): boolean {
  if (INVOICE_ADDRESS_FIELDS.includes(field)) return draft.invoice_to === "other";
  if (field === "invoice_email") return draft.invoice_to === "self" || draft.invoice_to === "other";
  if (field === "invoice_to") return true;
  if (!asksPaymentRoute(context.routeBy)) return false;
  if (field === "payment_method_details") return draft.payment_method === "other";
  if (ACCOUNT_FIELDS.includes(field)) return asksAccount(draft.payment_method);
  if (field === "via_third_party_details") return draft.via_third_party === "yes";
  return true;
}

/**
 * Whether the request cannot be sent without the field (contract 3.3): what
 * is asked, except the e-mail for invoices and the bank of a card payment.
 */
export function requiresBillingField(field: BillingField, draft: BillingDraft, context: BillingContext): boolean {
  if (!asksBillingField(field, draft, context)) return false;
  if (field === "invoice_email") return false;
  if (field === "bank_name") return draft.payment_method === "bank_transfer";
  return true;
}

/** The answers to "where does the invoice go" the form offers: `payer` only with a declared third party. */
export function invoiceTargets(context: Pick<BillingContext, "payerDeclared">): InvoiceTo[] {
  return INVOICE_TARGETS.filter((target) => target !== "payer" || context.payerDeclared);
}

/**
 * The draft after "where does the invoice go". What belongs to another
 * answer goes, as on the server: the address with anything but `other`, the
 * e-mail with `payer`.
 */
export function withInvoiceTo(draft: BillingDraft, target: string): BillingDraft {
  const next: BillingDraft = { ...draft, invoice_to: target };
  if (target !== "other") {
    for (const field of INVOICE_ADDRESS_FIELDS) next[field] = "";
  }
  if (target === "payer") next.invoice_email = "";
  return next;
}

/**
 * The draft after the payment method. The details belong to "other", the
 * account to a bank transfer or a card: the rest goes, as on the server. The
 * account holder is offered once: the name of the person who pays, while the
 * field is empty (`suggestion`; `null` when it was offered before).
 */
export function withPaymentMethod(draft: BillingDraft, method: string, suggestion: string | null = null): BillingDraft {
  const next: BillingDraft = { ...draft, payment_method: method };
  if (method !== "other") next.payment_method_details = "";
  if (!asksAccount(method)) {
    for (const field of ACCOUNT_FIELDS) next[field] = "";
  } else if (!next.account_holder.trim() && suggestion?.trim()) {
    next.account_holder = suggestion.trim();
  }
  return next;
}

/** The draft after "through a third person or a payment service provider?": the details belong to a "yes". */
export function withViaThirdParty(draft: BillingDraft, answer: string): BillingDraft {
  return { ...draft, via_third_party: answer, via_third_party_details: answer === "yes" ? draft.via_third_party_details : "" };
}

/** The comparable form of a field: what would be sent, as text. */
export function billingValue(field: BillingField, draft: BillingDraft): string {
  const value = draft[field].trim();
  return MULTILINE_FIELDS.has(field) ? value : value.replace(/\s+/g, " ");
}

/** Values the server refused, by field; none of them is sent again until the patient changes it. */
export type RejectedBilling = Partial<Record<BillingField, string>>;

/**
 * Only the fields that differ from the last saved state. A cleared text is
 * sent as `""`, the yes/no answer as `true`, `false` or `null`, a refused
 * value is not repeated. Section 8 is never sent while the payer answers it:
 * the server refuses the whole save then.
 */
export function billingPatch(
  saved: BillingDraft,
  draft: BillingDraft,
  routeBy: PaymentRouteBy,
  rejected: RejectedBilling = {},
): BillingPatch {
  const patch: BillingPatch = {};
  for (const field of BILLING_FIELDS) {
    if (PAYMENT_ROUTE_FIELDS.includes(field) && !asksPaymentRoute(routeBy)) continue;
    const next = billingValue(field, draft);
    if (next === billingValue(field, saved)) continue;
    if (rejected[field] === next) continue;
    if (field === "via_third_party") patch[field] = next === "yes" ? true : next === "no" ? false : null;
    else patch[field] = next;
  }
  return patch;
}

/** Notes that the server refused the current value of `field`; other fields keep their entry. */
export function withRejectedBilling(rejected: RejectedBilling, field: string, draft: BillingDraft): RejectedBilling | null {
  if (!BILLING_FIELDS.includes(field as BillingField)) return null;
  const key = field as BillingField;
  return { ...rejected, [key]: billingValue(key, draft) };
}

/** The refusals that still apply: a value the patient changed since may be sent again. */
export function stillRejectedBilling(rejected: RejectedBilling, draft: BillingDraft): RejectedBilling {
  const next: RejectedBilling = {};
  for (const field of BILLING_FIELDS) {
    if (rejected[field] !== undefined && rejected[field] === billingValue(field, draft)) next[field] = rejected[field];
  }
  return next;
}

/**
 * The fields another save changed on the server: "who pays" may clear
 * section 8, or take the answer "to the payer" back (contract D5). The draft
 * takes those values over; what the patient is typing elsewhere stays.
 */
export function changedOnServer(saved: BillingDraft, incoming: BillingDraft): BillingField[] {
  return BILLING_FIELDS.filter((field) => incoming[field] !== saved[field]);
}

/** Keys of the two sections in `progress.missing_for_submit`: the e-mail for invoices is never missing. */
export type BillingSubmitField = Exclude<BillingField, "invoice_email">;

/** Everything the server can name as missing about invoice and payment, in the order of the form (contract 3.3). */
export const BILLING_SUBMIT_FIELDS: BillingSubmitField[] = [
  "invoice_to",
  "invoice_name",
  "invoice_street",
  "invoice_zip",
  "invoice_city",
  "invoice_country",
  "payment_method",
  "payment_method_details",
  "account_country",
  "account_holder",
  "bank_name",
  "via_third_party",
  "via_third_party_details",
];

export function isBillingField(field: string): field is BillingField {
  return BILLING_FIELDS.includes(field as BillingField);
}

// ---------------------------------------------------------------------------
// Block C of the follow-up (trigger flow 2026-10-07): through whom the payment
// goes and the expected total. Saved on the billing route like section 8, but
// kept apart from its fields, which the payer's own link shares.
// ---------------------------------------------------------------------------

/** Through whom a payment via a third party goes, in form order. */
export const VIA_THIRD_PARTY_KINDS = ["person", "psp"] as const;

export type BillingExtrasField = "via_third_party_kind" | "expected_total_eur";

export const BILLING_EXTRAS_FIELDS: readonly BillingExtrasField[] = ["via_third_party_kind", "expected_total_eur"];

/** The two extras as typed: the kind ("person", "psp" or ""), the amount as text. */
export type BillingExtrasDraft = Record<BillingExtrasField, string>;

export function draftFromBillingExtras(
  billing: Pick<LeadRequestBilling, "via_third_party_kind" | "expected_total_eur"> | null | undefined,
): BillingExtrasDraft {
  const amount = billing?.expected_total_eur;
  return {
    via_third_party_kind: billing?.via_third_party_kind ?? "",
    expected_total_eur: amount == null || amount === "" ? "" : String(amount),
  };
}

/**
 * An amount in EUR as typed: "12.500", "12.500,50", "12500.5" or "€ 900".
 * `null` for nothing typed, `undefined` for something that is no amount.
 */
export function parseEuroAmount(value: string): number | null | undefined {
  const compact = value.replace(/[\s€]/g, "").replace(/EUR$/i, "");
  if (!compact) return null;
  let normalized = compact;
  const comma = compact.lastIndexOf(",");
  const dot = compact.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    // The later separator is the decimal one, the other groups thousands.
    normalized = comma > dot ? compact.replace(/\./g, "").replace(",", ".") : compact.replace(/,/g, "");
  } else if (comma >= 0) {
    normalized = /^\d{1,3}(,\d{3})+$/.test(compact) ? compact.replace(/,/g, "") : compact.replace(",", ".");
  } else if (dot >= 0 && /^\d{1,3}(\.\d{3})+$/.test(compact)) {
    normalized = compact.replace(/\./g, "");
  }
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return undefined;
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : undefined;
}

/** The comparable form of an extra: the kind, or the amount as a number. */
export function billingExtrasValue(field: BillingExtrasField, draft: BillingExtrasDraft): string {
  if (field === "expected_total_eur") {
    const amount = parseEuroAmount(draft.expected_total_eur);
    return amount === undefined ? `invalid:${draft.expected_total_eur.trim()}` : amount === null ? "" : String(amount);
  }
  return draft[field].trim();
}

/**
 * Only the extras that differ from the last saved state: the kind as text
 * (`null` clears it), the amount as a number (`null` clears it). An amount
 * that is no number is not sent; neither is a refused value.
 */
export function billingExtrasPatch(
  saved: BillingExtrasDraft,
  draft: BillingExtrasDraft,
  rejected: Partial<Record<BillingExtrasField, string>> = {},
): BillingExtrasPatch {
  const patch: BillingExtrasPatch = {};
  for (const field of BILLING_EXTRAS_FIELDS) {
    const next = billingExtrasValue(field, draft);
    if (next === billingExtrasValue(field, saved) || rejected[field] === next) continue;
    if (field === "expected_total_eur") {
      const amount = parseEuroAmount(draft.expected_total_eur);
      if (amount === undefined) continue;
      patch.expected_total_eur = amount;
    } else {
      patch.via_third_party_kind = next || null;
    }
  }
  return patch;
}

/**
 * What tells the two sections apart from the other blocks of the request:
 * whether the server knows them at all.
 */
export function knowsBilling(request: Pick<LeadRequest, "billing">): request is Pick<LeadRequest, "billing"> & { billing: LeadRequestBilling } {
  return request.billing !== undefined;
}
