import { ApiRequestError } from "@/lib/api";
import type { Translations } from "@/lib/i18n";

/**
 * The refusals of `routes/totp.rs` carry an English sentence and the HTTP
 * reason only; the 2FA setup, the account page and the user administration
 * show them in the UI language (QA round 2, group E).
 */
const TWO_FACTOR_ERROR_KEYS: Record<string, string> = {
  "The code does not match": "twofactor_error_code",
  "Sign in again": "twofactor_error_sign_in_again",
  "Two-factor authentication is already active": "twofactor_error_already_active",
  "Two-factor authentication is not active": "twofactor_error_not_active",
  "Start the enrolment first": "twofactor_error_start_first",
  "No second factor enrolled": "twofactor_error_none_enrolled",
  "Account is disabled": "twofactor_error_account_disabled",
  "Insufficient permissions": "twofactor_error_forbidden",
};

/** The translated text of a known 2FA refusal, or `null`. */
export function knownTwoFactorError(error: unknown, t: Translations): string | null {
  const message = error instanceof Error ? error.message.trim() : "";
  const key = TWO_FACTOR_ERROR_KEYS[message];
  if (key && t.uiText[key]) return t.uiText[key];
  // "Failed to start enrolment", "An internal error occurred", …
  if (error instanceof ApiRequestError && (error.status ?? 0) >= 500) return t.uiText.twofactor_error_generic;
  return null;
}

/** Any 2FA error in the UI language; unknown texts fall back to the generic one. */
export function twoFactorErrorMessage(error: unknown, t: Translations): string {
  const known = knownTwoFactorError(error, t);
  if (known) return known;
  const message = error instanceof Error ? error.message : "";
  return message || t.uiText.twofactor_error_generic;
}
