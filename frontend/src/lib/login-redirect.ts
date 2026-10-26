/**
 * Where the login page sends a user after sign-in, and why the previous
 * session ended (QA E-24 / E-37, 2026-10-11).
 *
 * - A deep link opened without a session returns to that page after sign-in.
 * - An explicit sign-out forgets the page: the next person at this browser
 *   starts on their own dashboard.
 * - After an idle timeout or an expired session the page is kept only for the
 *   same account; another account starts on its dashboard.
 */

import type { SignOut, SignOutReason } from "@/lib/auth";

export type LoginRedirectState = {
  from?: string;
  /** Account whose session was on `from`; `null` for a deep link without a session. */
  fromUserId?: string | null;
  reason?: SignOutReason;
};

type LocationLike = { pathname: string; search?: string; hash?: string };

export function loginRedirectState(
  signOut: SignOut | null | undefined,
  location: LocationLike,
): LoginRedirectState {
  if (signOut?.reason === "explicit") {
    return { reason: "explicit" };
  }
  return {
    from: `${location.pathname}${location.search ?? ""}${location.hash ?? ""}`,
    fromUserId: signOut?.userId ?? null,
    reason: signOut?.reason,
  };
}

function asState(state: unknown): LoginRedirectState {
  return state && typeof state === "object" ? (state as LoginRedirectState) : {};
}

/** The page to open after `userId` signed in. */
export function resolveLoginRedirect(state: unknown, userId: string | null | undefined): string {
  const { from, fromUserId } = asState(state);
  if (typeof from !== "string" || !from.startsWith("/") || from.startsWith("//")) {
    return "/";
  }
  if (fromUserId && fromUserId !== userId) {
    return "/";
  }
  return from;
}

const SIGN_OUT_NOTICE_KEY = "gmed.sign-out-notice";

/**
 * A thank-you the login page shows once after a deliberate sign-out (the lead
 * cabinet's «Abschließen und abmelden», owner 2026-10-26), in the language the
 * person used. Kept for this tab only; best effort.
 */
export function rememberSignOutNotice(text: string): void {
  try {
    window.sessionStorage.setItem(SIGN_OUT_NOTICE_KEY, text);
  } catch {
    /* No storage: no thank-you. */
  }
}

/** The notice of [rememberSignOutNotice], if any; [clearSignOutNotice] removes it. */
export function readSignOutNotice(): string | null {
  try {
    return window.sessionStorage.getItem(SIGN_OUT_NOTICE_KEY);
  } catch {
    return null;
  }
}

export function clearSignOutNotice(): void {
  try {
    window.sessionStorage.removeItem(SIGN_OUT_NOTICE_KEY);
  } catch {
    /* Nothing to clear. */
  }
}

/** Why the previous session ended, for the notice on the login page. */
export function signOutReasonOf(state: unknown): SignOutReason | null {
  const { reason } = asState(state);
  return reason === "idle" || reason === "expired" || reason === "explicit" ? reason : null;
}
