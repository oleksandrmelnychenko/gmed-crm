import { ApiRequestError } from "@/lib/api";
import type { Lang } from "@/lib/i18n";

/** Mirrors `crates/server/src/auth/password_policy.rs`. */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 256;
export const PROFILE_NAME_MAX = 200;
export const PROFILE_PHONE_MAX = 40;

export const PASSWORD_CHANGE_REQUIRED_CODE = "password_change_required";

export type AccountProfile = {
  id: string;
  email: string;
  name: string;
  role: string;
  phone: string | null;
  preferred_language: Lang | null;
  password_changed_at?: string | null;
};

export type AccountSession = {
  family_id: string;
  is_current: boolean;
  device_fingerprint: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  last_activity_at: string;
};

export type PasswordFormErrorKey =
  | "account_password_error_current_required"
  | "account_password_error_too_short"
  | "account_password_error_too_long"
  | "account_password_error_policy"
  | "account_password_error_mismatch"
  | "account_password_error_same_as_current";

/**
 * Client-side pre-check of the new password. The server remains the source of
 * truth (history, exact policy); this only avoids an obvious round trip.
 */
export function validatePasswordForm(input: {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}): PasswordFormErrorKey | null {
  const { currentPassword, newPassword, confirmPassword } = input;
  if (!currentPassword) return "account_password_error_current_required";
  if (newPassword.length < PASSWORD_MIN_LENGTH) return "account_password_error_too_short";
  if (newPassword.length > PASSWORD_MAX_LENGTH) return "account_password_error_too_long";
  if (!passwordMeetsPolicy(newPassword)) return "account_password_error_policy";
  if (newPassword === currentPassword) return "account_password_error_same_as_current";
  if (newPassword !== confirmPassword) return "account_password_error_mismatch";
  return null;
}

export function passwordMeetsPolicy(password: string): boolean {
  return (
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /[0-9]/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
}

export type PasswordChangeErrorKey =
  | "account_password_error_invalid_current"
  | "account_password_error_reused"
  | "account_password_error_policy"
  | "account_password_error_generic";

/** Maps the `PUT /me/password` failure to a translation key. */
export function mapPasswordChangeError(error: unknown): PasswordChangeErrorKey {
  if (error instanceof ApiRequestError) {
    if (error.code === "invalid_current_password") return "account_password_error_invalid_current";
    if (error.code === "password_policy") {
      return /used recently/i.test(error.message)
        ? "account_password_error_reused"
        : "account_password_error_policy";
    }
  }
  return "account_password_error_generic";
}

export function isPasswordChangeRequiredError(error: unknown): boolean {
  return (
    error instanceof ApiRequestError &&
    error.status === 403 &&
    error.code === PASSWORD_CHANGE_REQUIRED_CODE
  );
}

export type ProfileFormErrorKey =
  | "account_profile_error_name"
  | "account_profile_error_phone";

const PHONE_PATTERN = /^[0-9+\s\-()/]+$/;

export function validateProfileForm(input: { name: string; phone: string }): ProfileFormErrorKey | null {
  const name = input.name.trim();
  if (!name || name.length > PROFILE_NAME_MAX) return "account_profile_error_name";
  const phone = input.phone.trim();
  if (phone && (phone.length > PROFILE_PHONE_MAX || !PHONE_PATTERN.test(phone))) {
    return "account_profile_error_phone";
  }
  return null;
}

/**
 * Short device label from a user-agent string; falls back to the fingerprint
 * or an "unknown device" key when nothing usable is present.
 */
export function describeSessionDevice(session: Pick<AccountSession, "user_agent" | "device_fingerprint">): string | null {
  const ua = session.user_agent ?? "";
  if (ua) {
    const browser =
      /Edg\//.test(ua) ? "Edge" :
      /OPR\//.test(ua) ? "Opera" :
      /Firefox\//.test(ua) ? "Firefox" :
      /Chrome\//.test(ua) ? "Chrome" :
      /Safari\//.test(ua) ? "Safari" :
      null;
    const os =
      /Windows/.test(ua) ? "Windows" :
      /Android/.test(ua) ? "Android" :
      /iPhone|iPad/.test(ua) ? "iOS" :
      /Mac OS X/.test(ua) ? "macOS" :
      /Linux/.test(ua) ? "Linux" :
      null;
    const parts = [browser, os].filter(Boolean);
    if (parts.length) return parts.join(" · ");
    return ua.length > 48 ? `${ua.slice(0, 45)}…` : ua;
  }
  if (session.device_fingerprint) return session.device_fingerprint.slice(0, 12);
  return null;
}

/** Current session first, then most recent activity. */
export function sortSessions(sessions: AccountSession[]): AccountSession[] {
  return [...sessions].sort((a, b) => {
    if (a.is_current !== b.is_current) return a.is_current ? -1 : 1;
    return b.last_activity_at.localeCompare(a.last_activity_at);
  });
}
