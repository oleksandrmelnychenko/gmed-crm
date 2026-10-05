import { cachedLanguageDisplayNames } from "@/lib/intl-cache";

import type { LeadRequest, LeadRequestPersonalData, PersonalDataPatch } from "./lead-request-api";

/** The step-1 form as the patient types it (strings, citizenships as codes). */
export type PersonalDraft = {
  first_name: string;
  middle_name: string;
  last_name: string;
  date_of_birth: string;
  legal_sex: string;
  citizenships: string[];
  street_address: string;
  zip_code: string;
  city: string;
  country: string;
  phone: string;
  primary_language: string;
  /** "yes", "no" or "" (not stated). */
  has_insurance: string;
  insurance_type: string;
  insurance_provider: string;
  insurance_number: string;
  insurance_covers_germany: string;
};

export type PersonalField = keyof PersonalDraft;

export const PERSONAL_FIELDS: PersonalField[] = [
  "first_name",
  "middle_name",
  "last_name",
  "date_of_birth",
  "legal_sex",
  "citizenships",
  "street_address",
  "zip_code",
  "city",
  "country",
  "phone",
  "primary_language",
  "has_insurance",
  "insurance_type",
  "insurance_provider",
  "insurance_number",
  "insurance_covers_germany",
];

export function draftFromPersonalData(data: LeadRequestPersonalData): PersonalDraft {
  return {
    first_name: data.first_name ?? "",
    middle_name: data.middle_name ?? "",
    last_name: data.last_name ?? "",
    date_of_birth: data.date_of_birth ?? "",
    legal_sex: data.legal_sex ?? "",
    citizenships: [...(data.citizenships ?? [])],
    street_address: data.street_address ?? "",
    zip_code: data.zip_code ?? "",
    city: data.city ?? "",
    country: data.country ?? "",
    phone: data.phone ?? "",
    primary_language: data.primary_language ?? "",
    has_insurance: data.has_insurance == null ? "" : data.has_insurance ? "yes" : "no",
    insurance_type: data.insurance_type ?? "",
    insurance_provider: data.insurance_provider ?? "",
    insurance_number: data.insurance_number ?? "",
    insurance_covers_germany: data.insurance_covers_germany ?? "",
  };
}

/**
 * The draft after the answer "is there an insurance?". "No" means self-payer,
 * as in the staff wizard: the details of an insurance go (the server does the
 * same). An insured person is never the self-payer type.
 */
export function withInsuranceAnswer(draft: PersonalDraft, answer: string): PersonalDraft {
  if (answer === "no") {
    return {
      ...draft,
      has_insurance: "no",
      insurance_type: "self_pay",
      insurance_provider: "",
      insurance_number: "",
      insurance_covers_germany: "",
    };
  }
  return {
    ...draft,
    has_insurance: answer,
    insurance_type: draft.insurance_type === "self_pay" ? "" : draft.insurance_type,
  };
}

function normalized(field: PersonalField, draft: PersonalDraft): string {
  const value = draft[field];
  return Array.isArray(value) ? value.join(",") : value.trim().replace(/\s+/g, " ");
}

/** A value the server refused; it is not sent again until the patient changes it. */
export type RejectedValue = { field: PersonalField; value: string };

/**
 * Only the fields that differ from the last saved state, so a concurrent edit
 * by staff to another field is not overwritten. Empty names are not sent
 * (both are required) and a refused value is not repeated.
 */
export function personalDataPatch(
  saved: PersonalDraft,
  draft: PersonalDraft,
  rejected: RejectedValue | null = null,
): PersonalDataPatch {
  const patch: PersonalDataPatch = {};
  for (const field of PERSONAL_FIELDS) {
    const next = normalized(field, draft);
    if (next === normalized(field, saved)) continue;
    if ((field === "first_name" || field === "last_name") && !next) continue;
    if (rejected && rejected.field === field && rejected.value === next) continue;
    patch[field] = field === "citizenships" ? [...draft.citizenships] : next;
  }
  return patch;
}

export function rejectedValue(field: string, draft: PersonalDraft): RejectedValue | null {
  if (!PERSONAL_FIELDS.includes(field as PersonalField)) return null;
  return { field: field as PersonalField, value: normalized(field as PersonalField, draft) };
}

/** Fields still missing for "send to the manager", in form order. */
export function missingForSubmit(request: Pick<LeadRequest, "progress">): PersonalField[] {
  const missing = new Set(request.progress.missing_for_submit);
  return PERSONAL_FIELDS.filter((field) => missing.has(field));
}

export function consentGiven(request: Pick<LeadRequest, "consents">, purpose: string): boolean {
  return Boolean(request.consents[purpose]?.given_at);
}

/**
 * Something changed after the request was sent: only then "send again" is
 * offered. An older server does not say so; documents uploaded later still count.
 */
export function changedSinceSubmit(
  request: Pick<LeadRequest, "submitted_at" | "changed_since_submit" | "documents">,
): boolean {
  if (!request.submitted_at) return false;
  if (typeof request.changed_since_submit === "boolean") return request.changed_since_submit;
  const sentAt = Date.parse(request.submitted_at);
  return request.documents.some((document) => Date.parse(document.uploaded_at) > sentAt);
}

export function canSubmit(request: Pick<LeadRequest, "progress" | "consents">, inquiryPurpose: string): boolean {
  return request.progress.missing_for_submit.length === 0 && consentGiven(request, inquiryPurpose);
}

/** The consent text in the cabinet language, German as fallback. */
export function consentText(request: Pick<LeadRequest, "consents">, purpose: string, lang: string): string {
  const texts = request.consents[purpose]?.texts ?? {};
  return texts[lang] ?? texts.de ?? "";
}

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export function formatFileSize(size: number | null | undefined, lang: string): string {
  if (!size || size <= 0) return "";
  const locale = cabinetLocale(lang);
  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toLocaleString(locale, { maximumFractionDigits: 1 })} MB`;
  }
  return `${Math.max(1, Math.round(size / 1024)).toLocaleString(locale)} KB`;
}

/** Number and name locale of a cabinet language (DE, EN, UA, RU). */
export function cabinetLocale(lang: string): string {
  switch (lang) {
    case "de":
      return "de-DE";
    case "en":
      return "en-GB";
    case "uk":
      return "uk-UA";
    default:
      return "ru-RU";
  }
}

/** A language code as a name in the cabinet language, e.g. "uk" → "українська". */
export function languageName(code: string, lang: string): string {
  const display = cachedLanguageDisplayNames(cabinetLocale(lang).slice(0, 2));
  try {
    const name = display?.of(code) ?? code;
    return name.charAt(0).toLocaleUpperCase(cabinetLocale(lang)) + name.slice(1);
  } catch {
    return code;
  }
}
