import type {
  LeadPayerAnswers,
  LeadPayerDocument,
  LeadPayerQuestionnaire,
  LeadPayerSignaturePackage,
  LeadRequestPayerQuestionnaireSummary,
  PayerQuestionnairePatch,
} from "./lead-request-api";

// The paying parent's own questionnaire in the lead cabinet (contract phase
// 3a, 5.2): the parent who pays for the child answers the payer-only
// questions here; person, address and identity document are the parent's
// data in "legal representatives", the payment route is phase 2's section.

/** The sources of funds, in the order of the form. */
export const FUNDS_SOURCES = [
  "employment",
  "business_income",
  "savings",
  "asset_sale",
  "inheritance_gift",
  "other",
] as const;

export type FundsSource = (typeof FUNDS_SOURCES)[number];

/** The languages the paying person may be addressed in. */
export const PAYER_LANGUAGES = ["de", "en", "uk", "ru"] as const;

/** The four legal yes/no questions, in form order, with what a "yes" asks for. */
export const PAYER_LEGAL_QUESTIONS = ["pep_self", "pep_related", "high_risk_country", "sanctions_links"] as const;

export type PayerLegalQuestion = (typeof PAYER_LEGAL_QUESTIONS)[number];

export const PAYER_LEGAL_DETAILS = {
  pep_self: "pep_self_details",
  pep_related: "pep_related_details",
  high_risk_country: "high_risk_country_code",
  sanctions_links: "sanctions_links_details",
} as const satisfies Record<PayerLegalQuestion, keyof LeadPayerAnswers>;

/**
 * The keys the paying parent writes in the cabinet (contract 5.2); the
 * server refuses every other key with 422.
 */
export const PAYER_QUESTIONNAIRE_FIELDS = [
  "salutation",
  "former_names",
  "habitual_residence_country",
  "language",
  "occupation",
  "funds_sources",
  "funds_description",
  "pep_self",
  "pep_self_details",
  "pep_related",
  "pep_related_details",
  "high_risk_country",
  "high_risk_country_code",
  "sanctions_links",
  "sanctions_links_details",
] as const satisfies readonly (keyof LeadPayerAnswers)[];

export type PayerQuestionnaireField = (typeof PAYER_QUESTIONNAIRE_FIELDS)[number];

/** The questionnaire as the parent types it: texts, the sources as a list, answers as "yes", "no" or "". */
export type PayerQuestionnaireDraft = {
  salutation: string;
  former_names: string;
  habitual_residence_country: string;
  language: string;
  occupation: string;
  funds_sources: string[];
  funds_description: string;
  pep_self: string;
  pep_self_details: string;
  pep_related: string;
  pep_related_details: string;
  high_risk_country: string;
  high_risk_country_code: string;
  sanctions_links: string;
  sanctions_links_details: string;
};

/** Free texts that may run over several lines: only the ends are trimmed. */
const MULTILINE: ReadonlySet<PayerQuestionnaireField> = new Set([
  "funds_description",
  "pep_self_details",
  "pep_related_details",
  "sanctions_links_details",
]);

const LEGAL: ReadonlySet<string> = new Set(PAYER_LEGAL_QUESTIONS);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

const textOrNull = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);
const answerOrNull = (value: unknown) => (typeof value === "boolean" ? value : null);
const stringList = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "") : [];

function normalizeDocuments(value: unknown): LeadPayerDocument[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const raw = asRecord(item);
    if (!raw || typeof raw.id !== "string" || !raw.id) return [];
    return [
      {
        id: raw.id,
        file_name: textOrNull(raw.file_name),
        size_bytes: typeof raw.size_bytes === "number" ? raw.size_bytes : null,
        mime_type: textOrNull(raw.mime_type),
        uploaded_at: textOrNull(raw.uploaded_at),
        reviewed: raw.reviewed === true,
        can_delete: raw.can_delete === true,
      },
    ];
  });
}

/**
 * The questionnaire with every key the cabinet reads; `null` for an answer
 * that is not one (an older server, a proxy reply).
 */
export function normalizeLeadPayerQuestionnaire(value: unknown): LeadPayerQuestionnaire | null {
  const raw = asRecord(value);
  const answers = asRecord(raw?.answers);
  if (!raw || !answers || !Array.isArray(raw.missing_for_submit)) return null;
  const privacy = asRecord(raw.privacy) ?? {};
  return {
    state: textOrNull(raw.state),
    email: textOrNull(raw.email),
    privacy: {
      acknowledged_at: textOrNull(privacy.acknowledged_at),
      text_version: textOrNull(privacy.text_version),
      contact_channels: stringList(privacy.contact_channels),
    },
    answers: {
      salutation: textOrNull(answers.salutation),
      former_names: textOrNull(answers.former_names),
      habitual_residence_country: textOrNull(answers.habitual_residence_country),
      language: textOrNull(answers.language),
      occupation: textOrNull(answers.occupation),
      funds_sources: stringList(answers.funds_sources),
      funds_description: textOrNull(answers.funds_description),
      pep_self: answerOrNull(answers.pep_self),
      pep_self_details: textOrNull(answers.pep_self_details),
      pep_related: answerOrNull(answers.pep_related),
      pep_related_details: textOrNull(answers.pep_related_details),
      high_risk_country: answerOrNull(answers.high_risk_country),
      high_risk_country_code: textOrNull(answers.high_risk_country_code),
      sanctions_links: answerOrNull(answers.sanctions_links),
      sanctions_links_details: textOrNull(answers.sanctions_links_details),
    },
    funds_proof_documents: normalizeDocuments(raw.funds_proof_documents),
    funds_proof_required: raw.funds_proof_required === true,
    missing_for_submit: stringList(raw.missing_for_submit),
    declared_correct_at: textOrNull(raw.declared_correct_at),
    submitted_at: textOrNull(raw.submitted_at),
    // Only when the server sends it here: otherwise the request's short form says it.
    ...("signature_package" in raw ? { signature_package: normalizePayerSignaturePackage(raw.signature_package) } : {}),
  };
}

/**
 * The payer's signature package as the payer and the paying parent see it
 * (contract phase 3b, 4.4): `sent` while it waits for the signature (also a
 * server that names the step, `sending` or `pending`), `signed` once it came
 * back; `null` for no package and for anything else.
 */
export function normalizePayerSignaturePackage(value: unknown): LeadPayerSignaturePackage | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const status =
    raw.status === "signed" ? "signed" : raw.status === "sent" || raw.status === "sending" || raw.status === "pending" ? "sent" : null;
  if (!status) return null;
  return { status, sent_at: textOrNull(raw.sent_at), signed_at: textOrNull(raw.signed_at) };
}

/**
 * The package of the first source that says anything about it (the key is
 * there, also as `null`); `null` when none does — an older server, as today.
 */
export function payerSignaturePackageOf(...sources: unknown[]): LeadPayerSignaturePackage | null {
  for (const source of sources) {
    const raw = asRecord(source);
    if (raw && "signature_package" in raw) return normalizePayerSignaturePackage(raw.signature_package);
  }
  return null;
}

/**
 * The short form the request object carries, after a write of the
 * questionnaire. The signature package the request knew stays unless the
 * questionnaire says otherwise.
 */
export function payerQuestionnaireSummary(
  questionnaire: LeadPayerQuestionnaire,
  previous?: LeadRequestPayerQuestionnaireSummary | null,
): LeadRequestPayerQuestionnaireSummary {
  const signature =
    questionnaire.signature_package !== undefined ? questionnaire.signature_package : previous?.signature_package;
  return {
    available: true,
    submitted_at: questionnaire.submitted_at,
    missing_count: questionnaire.missing_for_submit.length,
    ...(signature !== undefined ? { signature_package: signature } : {}),
  };
}

const answerFrom = (value: boolean | null) => (value === null ? "" : value ? "yes" : "no");

/** The sources chosen, without duplicates, in the order of the form; an unknown source stays at the end. */
function sortedSources(values: readonly string[]): string[] {
  const unique = Array.from(new Set(values));
  const known = FUNDS_SOURCES.filter((source) => unique.includes(source));
  return [...known, ...unique.filter((value) => !(FUNDS_SOURCES as readonly string[]).includes(value))];
}

export function draftFromPayerQuestionnaire(questionnaire: Pick<LeadPayerQuestionnaire, "answers"> | null | undefined): PayerQuestionnaireDraft {
  const answers = questionnaire?.answers;
  return {
    salutation: answers?.salutation ?? "",
    former_names: answers?.former_names ?? "",
    habitual_residence_country: answers?.habitual_residence_country ?? "",
    language: answers?.language ?? "",
    occupation: answers?.occupation ?? "",
    funds_sources: sortedSources(answers?.funds_sources ?? []),
    funds_description: answers?.funds_description ?? "",
    pep_self: answerFrom(answers?.pep_self ?? null),
    pep_self_details: answers?.pep_self_details ?? "",
    pep_related: answerFrom(answers?.pep_related ?? null),
    pep_related_details: answers?.pep_related_details ?? "",
    high_risk_country: answerFrom(answers?.high_risk_country ?? null),
    high_risk_country_code: answers?.high_risk_country_code ?? "",
    sanctions_links: answerFrom(answers?.sanctions_links ?? null),
    sanctions_links_details: answers?.sanctions_links_details ?? "",
  };
}

/** The comparable form of a field: what would be sent, as text. */
export function payerQuestionnaireValue(field: PayerQuestionnaireField, draft: PayerQuestionnaireDraft): string {
  if (field === "funds_sources") return sortedSources(draft.funds_sources).join(",");
  const value = draft[field].trim();
  return MULTILINE.has(field) ? value : value.replace(/\s+/g, " ");
}

/** Values the server refused, by field; none is sent again until the parent changes it. */
export type RejectedPayerFields = Partial<Record<PayerQuestionnaireField, string>>;

/**
 * Only the keys that differ from the last saved state. A cleared text or
 * choice goes as `null`, a legal answer as `true`, `false` or `null`, the
 * sources as the whole list; a refused value is not repeated.
 */
export function payerQuestionnairePatch(
  saved: PayerQuestionnaireDraft,
  draft: PayerQuestionnaireDraft,
  rejected: RejectedPayerFields = {},
): PayerQuestionnairePatch {
  const patch: PayerQuestionnairePatch = {};
  for (const field of PAYER_QUESTIONNAIRE_FIELDS) {
    const next = payerQuestionnaireValue(field, draft);
    if (next === payerQuestionnaireValue(field, saved)) continue;
    if (rejected[field] === next) continue;
    if (field === "funds_sources") patch[field] = sortedSources(draft.funds_sources);
    else if (LEGAL.has(field)) patch[field] = next === "yes" ? true : next === "no" ? false : null;
    else patch[field] = next === "" ? null : next;
  }
  return patch;
}

/** Notes that the server refused the current value of `field`; `null` for a key that is not one of the form. */
export function withRejectedPayerField(
  rejected: RejectedPayerFields,
  field: string,
  draft: PayerQuestionnaireDraft,
): RejectedPayerFields | null {
  if (!(PAYER_QUESTIONNAIRE_FIELDS as readonly string[]).includes(field)) return null;
  const key = field as PayerQuestionnaireField;
  return { ...rejected, [key]: payerQuestionnaireValue(key, draft) };
}

/** The refusals that still apply: a value the parent changed since may be sent again. */
export function stillRejectedPayerFields(
  rejected: RejectedPayerFields,
  draft: PayerQuestionnaireDraft,
): RejectedPayerFields {
  const next: RejectedPayerFields = {};
  for (const field of PAYER_QUESTIONNAIRE_FIELDS) {
    if (rejected[field] !== undefined && rejected[field] === payerQuestionnaireValue(field, draft)) next[field] = rejected[field];
  }
  return next;
}

/** The draft after the answer to a legal question: the details belong to a "yes" only (the server does the same). */
export function withPayerLegalAnswer(
  draft: PayerQuestionnaireDraft,
  question: PayerLegalQuestion,
  answer: string,
): PayerQuestionnaireDraft {
  const next: PayerQuestionnaireDraft = { ...draft, [question]: answer };
  if (answer !== "yes") next[PAYER_LEGAL_DETAILS[question]] = "";
  return next;
}

/** A source of funds switched on or off. */
export function withFundsSource(draft: PayerQuestionnaireDraft, source: string, chosen: boolean): PayerQuestionnaireDraft {
  const rest = draft.funds_sources.filter((item) => item !== source);
  return { ...draft, funds_sources: sortedSources(chosen ? [...rest, source] : rest) };
}

/** The description is required with "other" (contract 3.5). */
export function fundsDescriptionRequired(draft: Pick<PayerQuestionnaireDraft, "funds_sources">): boolean {
  return draft.funds_sources.includes("other");
}

/** Keys of `missing_for_submit` the parent answers in the representatives' block: person, address, identity document. */
const REPRESENTATIVE_KEYS: ReadonlySet<string> = new Set([
  "first_name",
  "last_name",
  "date_of_birth",
  "birth_place",
  "birth_country",
  "citizenships",
  "street",
  "zip",
  "city",
  "country",
  "phone",
  "id_document_type",
  "id_document_number",
  "id_issuing_authority",
  "id_issuing_country",
  "id_issued_on",
  "id_valid_until",
  "id_document_upload",
]);

/** Keys answered in "who pays": the relationship to the patient. */
const PAYER_BLOCK_KEYS: ReadonlySet<string> = new Set(["relationship_kind", "relationship"]);

/** Keys of section 8, answered in the payment route of phase 2. */
const PAYMENT_ROUTE_KEYS: ReadonlySet<string> = new Set([
  "payment_method",
  "payment_method_details",
  "account_country",
  "account_holder",
  "bank_name",
  "via_third_party",
  "via_third_party_details",
]);

/**
 * What is still missing, by where it is answered: here (the notice, the
 * payer-only keys, the proof of funds), in the representatives' block, in
 * "who pays", in the payment route. The order of the server stays.
 */
export type PayerMissingParts = {
  own: string[];
  representative: string[];
  payer: string[];
  paymentRoute: string[];
};

export function payerMissingParts(missing: readonly string[]): PayerMissingParts {
  const parts: PayerMissingParts = { own: [], representative: [], payer: [], paymentRoute: [] };
  for (const key of missing) {
    if (REPRESENTATIVE_KEYS.has(key)) parts.representative.push(key);
    else if (PAYER_BLOCK_KEYS.has(key)) parts.payer.push(key);
    else if (PAYMENT_ROUTE_KEYS.has(key)) parts.paymentRoute.push(key);
    else parts.own.push(key);
  }
  return parts;
}

/** The notice is acknowledged: only then is anything else writable. */
export function payerNoticeAcknowledged(questionnaire: Pick<LeadPayerQuestionnaire, "privacy"> | null | undefined): boolean {
  return Boolean(questionnaire?.privacy.acknowledged_at);
}

/** The questionnaire was sent: it is read-only now. */
export function payerQuestionnaireSubmitted(
  questionnaire: Pick<LeadPayerQuestionnaire, "submitted_at" | "state"> | null | undefined,
): boolean {
  return Boolean(questionnaire?.submitted_at) || questionnaire?.state === "submitted";
}

/** Whether "send" may be pressed: nothing missing, confirmed, not sent yet. */
export function canSubmitPayerQuestionnaire(
  questionnaire: Pick<LeadPayerQuestionnaire, "missing_for_submit" | "submitted_at" | "state">,
  declared: boolean,
): boolean {
  return declared && questionnaire.missing_for_submit.length === 0 && !payerQuestionnaireSubmitted(questionnaire);
}
