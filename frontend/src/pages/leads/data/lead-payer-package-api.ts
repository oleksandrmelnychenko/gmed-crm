import { apiFetch } from "@/lib/api";

/**
 * The payer's signature package (contract phase 3b): one package of four
 * documents that a third-party payer (or a paying parent with a cabinet
 * login) signs with a qualified electronic signature (QES) through Skribble.
 * The server assembles it in two steps: `prepare` generates the four
 * documents, `send` creates the signature request from exactly that set.
 */

/** The four documents, in the fixed order of the bundle (contract D1). */
export const PAYER_PACKAGE_SLOTS = ["self_disclosure", "cost_coverage", "patient_statement", "cost_estimate"] as const;

export type PayerPackageSlot = (typeof PAYER_PACKAGE_SLOTS)[number];

/** The templates behind the slots: never listed among the wizard's other documents. */
export const PAYER_PACKAGE_TEMPLATE_IDS = ["payer_self_disclosure", "patient_payer_statement", "payer_cost_estimate"] as const;

/** The state of a package, read from its signature request (`prepared` before sending). */
export const PAYER_PACKAGE_STATUSES = [
  "prepared",
  "sending",
  "pending",
  "signed",
  "needs_review",
  "declined",
  "withdrawn",
  "expired",
  "error",
] as const;

export type PayerPackageStatus = (typeof PAYER_PACKAGE_STATUSES)[number];

/** Why the package cannot be prepared or sent now (first that applies, contract 4.1 and 11.4). */
export const PAYER_PACKAGE_BLOCKED_REASONS = [
  "lead_converted",
  "lead_deleted",
  "no_third_party",
  "payer_not_submitted",
  "payer_declaration_incomplete",
  "order_missing",
  "cost_estimate_missing",
  "cost_estimate_consent_missing",
  "payer_signer_incomplete",
  "payer_documents_pending",
] as const;

/** Why a prepared package no longer matches what it was built from (contract D8). */
export const PAYER_PACKAGE_OUTDATED_REASONS = [
  "payer_answers_changed",
  "payer_changed",
  "signer_changed",
  "cost_estimate_changed",
  "patient_statement_changed",
  "document_replaced",
] as const;

/** Languages of Skribble's invitation. */
export const PAYER_PACKAGE_LANGUAGES = ["de", "en", "fr", "it"] as const;

export type PayerPackageLanguage = (typeof PAYER_PACKAGE_LANGUAGES)[number];

/** `link` for a third party, `cabinet` for a paying parent with a cabinet login. */
export type PayerPackageMode = "link" | "cabinet";

export type PayerPackageSigner = {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  /** The organisation a legal representative signs for. */
  acting_for: string | null;
};

export type PayerPackageDocument = {
  slot: PayerPackageSlot;
  document_id: string;
  title: string | null;
  version: number | null;
  signed_at: string | null;
};

/** A read-only attachment of the sent request. */
export type PayerPackageAttachment = {
  document_id: string;
  title: string | null;
};

export type PayerPackage = {
  id: string;
  status: PayerPackageStatus;
  outdated_reasons: string[];
  prepared_at: string | null;
  prepared_by_name: string | null;
  sent_at: string | null;
  sent_by_name: string | null;
  language: string | null;
  request_id: string | null;
  /** Skribble's demo mode: archived as evidence only, without legal effect. */
  test_mode: boolean;
  signed_at: string | null;
  documents: PayerPackageDocument[];
  attachments: PayerPackageAttachment[];
};

export type PayerPackageIdentification = {
  qes_signed_at: string | null;
  qes_test_mode: boolean;
  own_account_payment_confirmed_at: string | null;
};

/** `GET /leads/{id}/payer-signature-package` (contract 4.1). */
export type LeadPayerPackageState = {
  /** Null when the lead has no payer who signs such a package. */
  mode: PayerPackageMode | null;
  blocked_reason: string | null;
  /** The declaration's own reasons behind `payer_declaration_incomplete`. */
  missing: string[];
  can_prepare: boolean;
  can_send: boolean;
  signature_enabled: boolean;
  languages: string[];
  suggested_language: string | null;
  signer: PayerPackageSigner | null;
  order: { id: string; number: string | null } | null;
  cost_estimate_document_id: string | null;
  package: PayerPackage | null;
  payer_identification: PayerPackageIdentification | null;
};

/**
 * The package as `GET /leads/{id}/payer-declaration` names it in its status
 * (contract 4.4); null while none is prepared.
 */
export type PayerPackageSummary = {
  status: PayerPackageStatus;
  outdated: boolean;
  sent_at: string | null;
  signed_at: string | null;
};

/** The body of "send": the invitation's language; no message, the default expiry. */
export type PayerPackageSendInput = { package_id: string; language: string | null };

// Four PDFs are rendered (prepare), or merged, malware-scanned and handed to
// Skribble (send): both take longer than an ordinary request.
const PREPARE_TIMEOUT_MS = 120_000;
const SEND_TIMEOUT_MS = 90_000;

const base = (leadId: string) => `/leads/${encodeURIComponent(leadId)}/payer-signature-package`;

/** The package state; null when the answer is not one (an older backend behind a catch-all). */
export async function fetchLeadPayerPackage(leadId: string): Promise<LeadPayerPackageState | null> {
  return normalizeLeadPayerPackageState(await apiFetch<unknown>(base(leadId), { forceFresh: true }));
}

/** Generates fresh versions of the four documents; answers with the state. */
export async function prepareLeadPayerPackage(leadId: string): Promise<LeadPayerPackageState | null> {
  return normalizeLeadPayerPackageState(
    await apiFetch<unknown>(`${base(leadId)}/prepare`, {
      method: "POST",
      body: JSON.stringify({}),
      timeoutMs: PREPARE_TIMEOUT_MS,
    }),
  );
}

/** Sends exactly the prepared package to the payer for signature; answers with the state. */
export async function sendLeadPayerPackage(
  leadId: string,
  input: PayerPackageSendInput,
): Promise<LeadPayerPackageState | null> {
  return normalizeLeadPayerPackageState(
    await apiFetch<unknown>(`${base(leadId)}/send`, {
      method: "POST",
      body: JSON.stringify({ package_id: input.package_id, language: input.language, message: null, expires_at: null }),
      timeoutMs: SEND_TIMEOUT_MS,
    }),
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

const textOrNull = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
const stringList = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "") : [];

function oneOf<Value extends string>(values: readonly Value[], value: unknown): Value | null {
  return values.find((item) => item === value) ?? null;
}

/**
 * The status of a request as the package names it: `completed` reads as
 * signed, the uncertain submissions as sending (also for a server that
 * passes the request's own status through).
 */
export function payerPackageStatusOf(value: unknown): PayerPackageStatus | null {
  if (value === "completed") return "signed";
  if (value === "submitting" || value === "submission_unknown") return "sending";
  return oneOf(PAYER_PACKAGE_STATUSES, value);
}

function normalizeDocument(value: unknown): PayerPackageDocument | null {
  const raw = asRecord(value);
  const slot = oneOf(PAYER_PACKAGE_SLOTS, raw?.slot);
  const documentId = textOrNull(raw?.document_id);
  if (!raw || !slot || !documentId) return null;
  return {
    slot,
    document_id: documentId,
    title: textOrNull(raw.title),
    version: typeof raw.version === "number" && Number.isFinite(raw.version) ? raw.version : null,
    signed_at: textOrNull(raw.signed_at),
  };
}

function normalizeAttachment(value: unknown): PayerPackageAttachment | null {
  const raw = asRecord(value);
  const documentId = textOrNull(raw?.document_id);
  return raw && documentId ? { document_id: documentId, title: textOrNull(raw.title) } : null;
}

function present<Value>(items: (Value | null)[]): Value[] {
  return items.filter((item): item is Value => item !== null);
}

function normalizePackage(value: unknown): PayerPackage | null {
  const raw = asRecord(value);
  const id = textOrNull(raw?.id);
  const status = payerPackageStatusOf(raw?.status);
  if (!raw || !id || !status) return null;
  const documents = Array.isArray(raw.documents) ? present(raw.documents.map(normalizeDocument)) : [];
  return {
    id,
    status,
    outdated_reasons: stringList(raw.outdated_reasons),
    prepared_at: textOrNull(raw.prepared_at),
    prepared_by_name: textOrNull(raw.prepared_by_name),
    sent_at: textOrNull(raw.sent_at),
    sent_by_name: textOrNull(raw.sent_by_name),
    language: textOrNull(raw.language),
    request_id: textOrNull(raw.request_id),
    test_mode: raw.test_mode === true,
    signed_at: textOrNull(raw.signed_at),
    // In the bundle's order, whatever order the server listed them in.
    documents: [...documents].sort((a, b) => PAYER_PACKAGE_SLOTS.indexOf(a.slot) - PAYER_PACKAGE_SLOTS.indexOf(b.slot)),
    attachments: Array.isArray(raw.attachments) ? present(raw.attachments.map(normalizeAttachment)) : [],
  };
}

function normalizeSigner(value: unknown): PayerPackageSigner | null {
  const raw = asRecord(value);
  if (!raw) return null;
  return {
    first_name: textOrNull(raw.first_name),
    last_name: textOrNull(raw.last_name),
    email: textOrNull(raw.email),
    acting_for: textOrNull(raw.acting_for),
  };
}

function normalizeIdentification(value: unknown): PayerPackageIdentification | null {
  const raw = asRecord(value);
  if (!raw) return null;
  return {
    qes_signed_at: textOrNull(raw.qes_signed_at),
    qes_test_mode: raw.qes_test_mode === true,
    own_account_payment_confirmed_at: textOrNull(raw.own_account_payment_confirmed_at),
  };
}

/**
 * The state with every key present; null for anything that is not one (an
 * older backend, or a proxy reply), so the panel stays away.
 */
export function normalizeLeadPayerPackageState(value: unknown): LeadPayerPackageState | null {
  const raw = asRecord(value);
  if (!raw || typeof raw.can_prepare !== "boolean") return null;
  const order = asRecord(raw.order);
  const orderId = textOrNull(order?.id);
  const languages = stringList(raw.languages);
  return {
    mode: raw.mode === "link" || raw.mode === "cabinet" ? raw.mode : null,
    blocked_reason: textOrNull(raw.blocked_reason),
    missing: stringList(raw.missing),
    can_prepare: raw.can_prepare,
    can_send: raw.can_send === true,
    signature_enabled: raw.signature_enabled !== false,
    languages: languages.length > 0 ? languages : [...PAYER_PACKAGE_LANGUAGES],
    suggested_language: textOrNull(raw.suggested_language),
    signer: normalizeSigner(raw.signer),
    order: orderId ? { id: orderId, number: textOrNull(order?.number) } : null,
    cost_estimate_document_id: textOrNull(raw.cost_estimate_document_id),
    package: normalizePackage(raw.package),
    payer_identification: normalizeIdentification(raw.payer_identification),
  };
}

/** The package of the payer declaration's status (contract 4.4); null for none or anything else. */
export function normalizePayerPackageSummary(value: unknown): PayerPackageSummary | null {
  const raw = asRecord(value);
  const status = payerPackageStatusOf(raw?.status);
  if (!raw || !status) return null;
  return {
    status,
    outdated: raw.outdated === true,
    sent_at: textOrNull(raw.sent_at),
    signed_at: textOrNull(raw.signed_at),
  };
}
