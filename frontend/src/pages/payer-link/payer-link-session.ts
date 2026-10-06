// The payer's own link (contract phase 3a, 3 and 5.1): what the page keeps
// of the link and of the session, what a refused call means, and the helpers
// of the code step. Pure functions without the browser, so they run in the
// unit tests (`payer-link-model.test.ts`).

// ---------------------------------------------------------------------------
// Link token and session
// ---------------------------------------------------------------------------

export const LINK_STORAGE_KEY = "gmed-payer-link";
export const SESSION_STORAGE_KEY = "gmed-payer-session";

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The tab's session storage, or null where the browser refuses it (private mode, blocked site data). */
export function browserSessionStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * The link token and the session secret of this tab. Session storage keeps
 * them over a reload; when it throws, the page still works from memory for as
 * long as it is open. A value set here wins over what the storage says.
 */
export class PayerSecrets {
  private readonly memory = new Map<string, string | null>();
  private readonly storage: StorageLike | null;

  constructor(storage: StorageLike | null) {
    this.storage = storage;
  }

  get(key: string): string | null {
    if (this.memory.has(key)) return this.memory.get(key) ?? null;
    try {
      return this.storage?.getItem(key) || null;
    } catch {
      return null;
    }
  }

  set(key: string, value: string | null): void {
    this.memory.set(key, value || null);
    try {
      if (value) this.storage?.setItem(key, value);
      else this.storage?.removeItem(key);
    } catch {
      // Memory keeps the value for this page; a reload then asks for the link again.
    }
  }
}

/** 32 random bytes as hex (64 characters); a little slack for a longer token later. */
const LINK_TOKEN = /^[0-9a-f]{32,256}$/i;

/** The token of `#<token>`, or null for an empty or damaged fragment. */
export function linkTokenFromHash(hash: string): string | null {
  const raw = hash.replace(/^#/, "").trim();
  return LINK_TOKEN.test(raw) ? raw : null;
}

/**
 * The token the page works with. A fragment wins: it is kept and a session of
 * another link is dropped. A damaged fragment means a cut-off link (null,
 * "incomplete"); without a fragment the stored token of this tab is used.
 */
export function captureLinkToken(hash: string, secrets: PayerSecrets): string | null {
  const raw = hash.replace(/^#/, "").trim();
  if (!raw) return secrets.get(LINK_STORAGE_KEY);
  const token = linkTokenFromHash(raw);
  if (!token) return null;
  if (secrets.get(LINK_STORAGE_KEY) !== token) secrets.set(SESSION_STORAGE_KEY, null);
  secrets.set(LINK_STORAGE_KEY, token);
  return token;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type PayerErrorKind =
  | "link_incomplete"
  | "link_invalid"
  | "link_revoked"
  | "link_expired"
  | "link_locked"
  | "session"
  | "consent_required"
  | "submitted"
  | "rate_limited"
  | "mail_failed"
  | "network"
  | "other";

/** What a refused call means for the page (contract 3, every error code and its status). */
export function payerErrorKind(status: number, code: string): PayerErrorKind {
  switch (code) {
    case "link_missing":
      return "link_incomplete";
    case "link_invalid":
    case "link_revoked":
    case "link_expired":
    case "link_locked":
      return code;
    case "session_required":
    case "session_expired":
      return "session";
    case "payer_consent_required":
      return "consent_required";
    case "payer_submitted":
      return "submitted";
    case "code_rate_limited":
      return "rate_limited";
  }
  if (code.startsWith("mail_")) return "mail_failed";
  if (status === 0) return "network";
  if (status === 423) return "link_locked";
  if (status === 410) return "link_revoked";
  if (status === 401) return "link_invalid";
  if (status === 429) return "rate_limited";
  return "other";
}

export type FatalKind = "link_incomplete" | "link_invalid" | "link_revoked" | "link_expired" | "link_locked";

const FATAL_KINDS: ReadonlySet<PayerErrorKind> = new Set([
  "link_incomplete",
  "link_invalid",
  "link_revoked",
  "link_expired",
  "link_locked",
]);

/** The link cannot be used any more: the page shows only the message. */
export function isFatalKind(kind: PayerErrorKind): kind is FatalKind {
  return FATAL_KINDS.has(kind);
}

type ErrorTexts = {
  linkIncomplete: string;
  linkInvalid: string;
  linkRevoked: string;
  linkExpired: string;
  linkLocked: string;
  sessionExpired: string;
  privacyFirst: string;
  alreadySubmitted: string;
  tooManyRequests: string;
  mailFailed: string;
  networkError: string;
  unexpectedError: string;
};

/** The one message of an error kind, in the page's language. */
export function payerErrorMessage(kind: PayerErrorKind, text: ErrorTexts): string {
  switch (kind) {
    case "link_incomplete":
      return text.linkIncomplete;
    case "link_invalid":
      return text.linkInvalid;
    case "link_revoked":
      return text.linkRevoked;
    case "link_expired":
      return text.linkExpired;
    case "link_locked":
      return text.linkLocked;
    case "session":
      return text.sessionExpired;
    case "consent_required":
      return text.privacyFirst;
    case "submitted":
      return text.alreadySubmitted;
    case "rate_limited":
      return text.tooManyRequests;
    case "mail_failed":
      return text.mailFailed;
    case "network":
      return text.networkError;
    default:
      return text.unexpectedError;
  }
}

type CodeTexts = ErrorTexts & {
  codeInvalid: (attemptsLeft: number | null) => string;
  codeExpired: string;
  codeRateLimited: (seconds: number | null) => string;
};

function numberOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : null;
}

/** The message of a refused "send code" or "confirm" (3.2, 3.3). */
export function codeErrorMessage(status: number, code: string, body: Record<string, unknown>, text: CodeTexts): string {
  if (code === "code_invalid") return text.codeInvalid(numberOf(body.attempts_left));
  if (code === "code_expired") return text.codeExpired;
  if (code === "code_rate_limited") return text.codeRateLimited(numberOf(body.retry_after_seconds));
  return payerErrorMessage(payerErrorKind(status, code), text);
}

// ---------------------------------------------------------------------------
// Code step
// ---------------------------------------------------------------------------

/** Seconds left of a cooldown that ends at `untilMs`. */
export function secondsLeft(untilMs: number | null, nowMs: number): number {
  if (untilMs === null) return 0;
  return Math.max(0, Math.ceil((untilMs - nowMs) / 1000));
}

/** When a code may be asked for again: `resend_after_seconds` after it was sent (60 s by default). */
export function resendAllowedAt(sentAt: string | null, resendAfterSeconds: number | null, nowMs: number): number | null {
  const wait = (resendAfterSeconds ?? 60) * 1000;
  if (!sentAt) return nowMs + wait;
  const sent = Date.parse(sentAt);
  return Number.isFinite(sent) ? sent + wait : nowMs + wait;
}

/** The six digits of a typed or pasted code; anything else is dropped. */
export function codeDigits(value: string): string {
  return value.replace(/\D/g, "").slice(0, 6);
}
