import { ApiRequestError, isLocalizedApiError } from "@/lib/api";
import { uiText, type Lang } from "@/lib/i18n";

/**
 * The text a section shows when its data could not be loaded: never the raw
 * "ApiRequestError: Insufficient permissions" of the server (QA 2026-10-12
 * E2-02). A refusal reads "not open for your role", any other failure "could
 * not be loaded"; an error whose server code already has a translation keeps
 * it.
 */
export function sectionLoadErrorText(error: unknown, lang?: Lang): string {
  if (isLocalizedApiError(error)) return error.message;
  if (error instanceof ApiRequestError && (error.status === 401 || error.status === 403)) {
    return uiText("patient_section_load_forbidden", lang);
  }
  return uiText("patient_section_load_failed", lang);
}
