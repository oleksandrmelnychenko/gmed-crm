import { ApiRequestError } from "@/lib/api";

/**
 * The translated state of an order that cannot be opened: a Patient Manager
 * who is not assigned to the patient gets 403 "Insufficient permissions" from
 * the server (QA 2026-10-11 C-14), which must not reach the UI in English.
 * Returns a `uiText` key, or `null` when the error has its own text.
 */
export function orderLoadErrorKey(error: unknown): string | null {
  if (!(error instanceof ApiRequestError)) return null;
  if (error.status === 403) return "orders_error_no_access";
  if (error.status === 404) return "orders_error_not_found";
  return null;
}
