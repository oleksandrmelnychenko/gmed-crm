/**
 * The answer of the reading of an identity scan (the machine readable zone
 * of a passport, an ID card or a residence permit), as the forms read it.
 * Kept apart from the staff form's model: the payer's public page reads it too.
 */
export type IdentityRecognitionStatus = "verified" | "unverified" | "not_found";

export type IdentityRecognitionChecks = {
  document_number: boolean;
  birth_date: boolean;
  valid_until: boolean;
  composite: boolean;
};

export type IdentityRecognitionHolder = {
  last_name: string | null;
  first_name: string | null;
  date_of_birth: string | null;
  legal_sex: string | null;
  citizenship: string | null;
};

export type IdentityRecognition = {
  status: IdentityRecognitionStatus;
  format: string | null;
  checks: IdentityRecognitionChecks;
  namesTruncated: boolean;
  document: {
    type: string;
    number: string;
    country: string;
    validUntil: string;
  };
  holder: IdentityRecognitionHolder;
};

const RECOGNIZED_DOCUMENT_TYPES: readonly string[] = ["passport", "id_card", "residence_permit"];

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const textOrNull = (value: unknown) => text(value) || null;
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const dateKey = (value: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(text(value)) ? text(value) : "");

/** The server's answer as the form reads it; `null` for an answer that is none. */
export function normalizeIdentityRecognition(raw: unknown): IdentityRecognition | null {
  const answer = record(raw);
  const status = text(answer.status);
  if (status !== "verified" && status !== "unverified" && status !== "not_found") return null;
  const document = record(answer.document);
  const holder = record(answer.holder);
  const checks = record(answer.checks);
  const type = text(document.id_document_type);
  return {
    status,
    format: textOrNull(answer.format),
    checks: {
      document_number: checks.document_number === true,
      birth_date: checks.birth_date === true,
      valid_until: checks.valid_until === true,
      composite: checks.composite === true,
    },
    namesTruncated: answer.names_truncated === true,
    document: {
      type: RECOGNIZED_DOCUMENT_TYPES.includes(type) ? type : "",
      // As the forms store a number: spaces collapsed, upper case.
      number: text(document.id_document_number).split(/\s+/).filter(Boolean).join(" ").toUpperCase(),
      country: text(document.id_issuing_country).toUpperCase(),
      validUntil: dateKey(document.id_valid_until),
    },
    holder: {
      last_name: textOrNull(holder.last_name),
      first_name: textOrNull(holder.first_name),
      date_of_birth: dateKey(holder.date_of_birth) || null,
      legal_sex: textOrNull(holder.legal_sex),
      citizenship: textOrNull(holder.citizenship)?.toUpperCase() ?? null,
    },
  };
}
