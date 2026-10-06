import { buildApiUrl } from "@/lib/api";

// The payer's own link (contract phase 3a, section 3): a public page without
// an account. Every call carries the link token in `X-Payer-Link`, from the
// verified code on also the session secret in `X-Payer-Session`. Plain
// `fetch` on purpose: `apiFetch` adds the staff token and sends the browser to
// the login page on a 401, which here only means "ask for a new code".
// Neither secret ever goes into a path, a query, a log or an error message.

export type PayerType = "person" | "company" | "organisation" | "insurance";

/** 3.1: what the link shows before the code. */
export type PayerLinkInfo = {
  state: "code_required" | "active" | "submitted";
  patient_name: string;
  payer_type: PayerType;
  email_masked: string;
  language: string | null;
  expires_at: string | null;
  code_sent_at: string | null;
  session_valid: boolean;
};

/** 3.2: a code was mailed. */
export type PayerCodeSent = { sent_at: string | null; resend_after_seconds: number | null };

/** One natural person holding more than 25 % of a company or an organisation. */
export type PayerBeneficialOwner = {
  first_name: string | null;
  last_name: string | null;
  date_of_birth: string | null;
  birth_place: string | null;
  street: string | null;
  zip: string | null;
  city: string | null;
  country: string | null;
  /** Number on the wire; a string is accepted when the server sends a decimal as text. */
  share_percent: number | string | null;
};

/** The payer's answers (contract 2.3): effective values, the other payer type's keys null. */
export type PayerAnswers = {
  salutation: string | null;
  first_name: string | null;
  last_name: string | null;
  former_names: string | null;
  date_of_birth: string | null;
  birth_place: string | null;
  birth_country: string | null;
  citizenships: string[] | null;
  street: string | null;
  zip: string | null;
  city: string | null;
  country: string | null;
  habitual_residence_country: string | null;
  phone: string | null;
  language: string | null;
  id_document_type: string | null;
  id_document_number: string | null;
  id_issuing_authority: string | null;
  id_issuing_country: string | null;
  id_issued_on: string | null;
  id_valid_until: string | null;
  organisation_name: string | null;
  register_court: string | null;
  register_number: string | null;
  representative_first_name: string | null;
  representative_last_name: string | null;
  representative_role: string | null;
  beneficial_owners: PayerBeneficialOwner[] | null;
  beneficial_owners_none: boolean | null;
  relationship_kind: string | null;
  relationship: string | null;
  occupation: string | null;
  industry: string | null;
  funds_sources: string[] | null;
  funds_description: string | null;
  pep_self: boolean | null;
  pep_self_details: string | null;
  pep_related: boolean | null;
  pep_related_details: string | null;
  high_risk_country: boolean | null;
  high_risk_country_code: string | null;
  sanctions_links: boolean | null;
  sanctions_links_details: string | null;
};

/** Section 8 (phase 2), asked here when the payer answers it. */
export type PayerPaymentRoute = {
  payment_method: string | null;
  payment_method_details: string | null;
  account_country: string | null;
  account_holder: string | null;
  bank_name: string | null;
  via_third_party: boolean | null;
  via_third_party_details: string | null;
  account_holder_suggestion: string | null;
  asked: boolean;
};

export type PayerDocument = {
  id: string;
  file_name: string | null;
  size_bytes: number | null;
  mime_type: string | null;
  uploaded_at: string | null;
  reviewed: boolean;
  can_delete: boolean;
};

/** 3.5: the questionnaire as the payer sees it. */
export type PayerQuestionnaire = {
  patient_name: string;
  source: "link" | "cabinet";
  payer_type: PayerType;
  state: "draft" | "submitted";
  email: string | null;
  email_confirmed_at: string | null;
  privacy: { acknowledged_at: string | null; text_version: string | null; contact_channels: string[] | null };
  answers: PayerAnswers;
  payment_route: PayerPaymentRoute | null;
  identity_documents: PayerDocument[] | null;
  funds_proof_documents: PayerDocument[] | null;
  funds_proof_required: boolean;
  missing_for_submit: string[] | null;
  declared_correct_at: string | null;
  submitted_at: string | null;
};

export type PayerVerified = { session: string; session_expires_at: string | null; questionnaire: PayerQuestionnaire };

/** The changed keys of the answers and of section 8, as sent. */
export type PayerAnswersPatch = Record<string, unknown>;

/**
 * A refused call. The message is the server's code or the status, never a
 * header value; `body` carries the extras (`field`, `attempts_left`,
 * `retry_after_seconds`, `missing`).
 */
export class PayerLinkError extends Error {
  readonly status: number;
  readonly code: string;
  readonly body: Record<string, unknown>;

  constructor(status: number, code: string, body: Record<string, unknown> = {}) {
    super(code || `HTTP ${status}`);
    this.name = "PayerLinkError";
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

/** No answer from the server at all (offline, timeout). */
export const NETWORK_ERROR_STATUS = 0;

/** The two secrets of a call, read fresh for every request. */
export type PayerCredentials = {
  link: () => string | null;
  session: () => string | null;
};

const REQUEST_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 120_000;

type CallOptions = {
  method?: "GET" | "POST" | "DELETE";
  json?: unknown;
  form?: FormData;
  withSession?: boolean;
  timeoutMs?: number;
};

function errorFromBody(status: number, body: unknown): PayerLinkError {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  // `error` is the status's reason phrase on these routes; only `code` names the case.
  const code = typeof record.code === "string" ? record.code : "";
  return new PayerLinkError(status, code, record);
}

async function call(credentials: PayerCredentials, path: string, options: CallOptions = {}): Promise<unknown> {
  const link = credentials.link();
  if (!link) throw new PayerLinkError(401, "link_missing");
  const headers = new Headers({ Accept: "application/json", "X-Payer-Link": link });
  if (options.withSession) {
    const session = credentials.session();
    if (!session) throw new PayerLinkError(401, "session_required");
    headers.set("X-Payer-Session", session);
  }
  let body: BodyInit | undefined;
  if (options.form) body = options.form;
  else if (options.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(options.json);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(buildApiUrl(path), {
      method: options.method ?? "GET",
      headers,
      body,
      // Nothing of the staff session belongs here, and nothing of this page in a referrer.
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    });
  } catch {
    throw new PayerLinkError(NETWORK_ERROR_STATUS, "network");
  } finally {
    clearTimeout(timer);
  }
  const text = await response.text().catch(() => "");
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  if (!response.ok) throw errorFromBody(response.status, parsed);
  return parsed;
}

/** Whether an answer is the questionnaire object (some writes may answer without it). */
export function isQuestionnaire(value: unknown): value is PayerQuestionnaire {
  return Boolean(value && typeof value === "object" && "answers" in value && "payer_type" in value);
}

export type PayerLinkClient = ReturnType<typeof createPayerLinkClient>;

/** The calls of the page, bound to the stored link and session. */
export function createPayerLinkClient(credentials: PayerCredentials) {
  const base = "/public/payer-link";

  async function questionnaire(): Promise<PayerQuestionnaire> {
    const result = await call(credentials, `${base}/questionnaire`, { withSession: true });
    if (!isQuestionnaire(result)) throw new PayerLinkError(500, "invalid_response");
    return result;
  }

  /** A write that answers with the questionnaire; without it, the questionnaire is loaded. */
  async function writeThenQuestionnaire(path: string, options: CallOptions): Promise<PayerQuestionnaire> {
    const result = await call(credentials, path, { ...options, withSession: true });
    return isQuestionnaire(result) ? result : questionnaire();
  }

  return {
    info: async (withSession: boolean): Promise<PayerLinkInfo> =>
      (await call(credentials, base, { withSession })) as PayerLinkInfo,
    requestCode: async (): Promise<PayerCodeSent> =>
      (await call(credentials, `${base}/code`, { method: "POST", json: {} })) as PayerCodeSent,
    verifyCode: async (code: string): Promise<PayerVerified> =>
      (await call(credentials, `${base}/verify`, { method: "POST", json: { code } })) as PayerVerified,
    questionnaire,
    /** `language`: the language the notice was shown in (recorded as `privacy_language`). */
    consent: (contactChannels: string[], language: string) =>
      writeThenQuestionnaire(`${base}/consent`, {
        method: "POST",
        json: { acknowledged: true, contact_channels: contactChannels, language },
      }),
    saveAnswers: (patch: PayerAnswersPatch) =>
      writeThenQuestionnaire(`${base}/questionnaire`, { method: "POST", json: patch }),
    uploadIdentityDocument: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return writeThenQuestionnaire(`${base}/identity-document`, { method: "POST", form, timeoutMs: UPLOAD_TIMEOUT_MS });
    },
    uploadFundsProof: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return writeThenQuestionnaire(`${base}/funds-proof`, { method: "POST", form, timeoutMs: UPLOAD_TIMEOUT_MS });
    },
    withdrawDocument: (documentId: string) =>
      writeThenQuestionnaire(`${base}/documents/${encodeURIComponent(documentId)}`, { method: "DELETE" }),
    submit: () => writeThenQuestionnaire(`${base}/submit`, { method: "POST", json: { declared_correct: true } }),
  };
}
