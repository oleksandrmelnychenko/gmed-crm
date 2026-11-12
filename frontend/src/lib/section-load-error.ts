import { ApiRequestError, isLocalizedApiError } from "@/lib/api";
import { getLang, uiText, type Lang } from "@/lib/i18n";

/**
 * The text a section shows when its data could not be loaded: never the raw
 * "ApiRequestError: Insufficient permissions" of the server (QA 2026-10-12
 * E2-02). A refusal reads "not open for your role", any other failure "could
 * not be loaded"; an error whose server code already has a translation keeps
 * it.
 */
const RECORD_UNAVAILABLE_TEXT = {
  ru: "Запись не найдена или недоступна для вашей роли.",
  de: "Der Eintrag wurde nicht gefunden oder ist für Ihre Rolle nicht freigegeben.",
} as const;

/**
 * The text a record page (a patient, a document, a provider, an invoice)
 * shows when the record itself could not be opened: a missing record, an
 * address with a malformed id and a record of another person read alike,
 * translated and without telling which one it is (QA 2026-11-12, B S3-2:
 * "Patient not found", "400 Bad Request", "Insufficient permissions", and
 * "this section is not open for your role" for a role that has the section).
 */
export function recordLoadErrorText(error: unknown, lang?: Lang): string {
  if (
    error instanceof ApiRequestError
    && (error.status === 400 || error.status === 403 || error.status === 404 || error.status === 422)
  ) {
    return RECORD_UNAVAILABLE_TEXT[lang ?? getLang()];
  }
  if (isLocalizedApiError(error)) return error.message;
  return uiText("patient_section_load_failed", lang);
}

export function sectionLoadErrorText(error: unknown, lang?: Lang): string {
  if (isLocalizedApiError(error)) return error.message;
  if (error instanceof ApiRequestError && (error.status === 401 || error.status === 403)) {
    return uiText("patient_section_load_forbidden", lang);
  }
  return uiText("patient_section_load_failed", lang);
}
