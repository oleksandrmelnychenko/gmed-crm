import { formatAppDate, formatAppDateTime } from "@/lib/app-time-zone";
import type { Translations } from "@/lib/i18n";

/**
 * Readable details of an audit row (QA E2-03): known context keys with
 * translated labels and formatted values — dates as DD.MM.YYYY HH:MM, yes/no,
 * translated reasons — and nothing for empty values. Record ids, request
 * metadata and keys without a label stay in the "technical data" of the
 * detail sheet.
 */
export type ActivityContextEntry = { key: string; label: string; value: string };

/** Request metadata the audit middleware adds to every annotated row. */
const REQUEST_KEYS = new Set(["method", "route", "latency_ms", "is_ceo_access", "redacted"]);

/** Lists whose items are codes or ids: their number is what a reader needs. */
const COUNTED_LIST_KEYS = new Set([
  "fields",
  "visible_fields",
  "sessions_ended_by_limit",
  "check_reasons",
  "document_ids",
  "revoked_share_ids",
]);

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Postgres and chrono write up to nine fractional digits; dates parse three. */
function normalizeInstant(value: string): string {
  return value.replace(/(\.\d{3})\d+/, "$1");
}

function isIdKey(key: string): boolean {
  return key === "id" || key.endsWith("_id") || key.endsWith("_ids");
}

function contextKeyLabel(key: string, t: Translations): string | undefined {
  return t.uiText[`activity_context_key_${key}`];
}

function roleLabel(value: string, t: Translations): string | undefined {
  const label = (t as unknown as Record<string, unknown>)[`role_${value}`];
  return typeof label === "string" ? label : undefined;
}

function formatScalar(key: string, value: unknown, t: Translations): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? t.common_yes : t.common_no;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  const mapped = t.uiText[`activity_context_${key}_${text}`];
  if (mapped) return mapped;
  if (key === "role") return roleLabel(text, t) ?? text;
  if (ISO_DATE_TIME.test(text)) return formatAppDateTime(normalizeInstant(text)) || text;
  if (ISO_DATE.test(text)) return formatAppDate(text) || text;
  if (UUID.test(text)) return null;
  return text;
}

function formatContextValue(key: string, value: unknown, t: Translations): string | null {
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    if (COUNTED_LIST_KEYS.has(key)) return String(value.length);
    const items = value
      .map((item) => formatScalar(key, item, t))
      .filter((item): item is string => Boolean(item));
    return items.length ? items.join(", ") : null;
  }
  return formatScalar(key, value, t);
}

/** The known, non-empty entries of an audit context, in their stored order. */
export function activityContextEntries(
  context: Record<string, unknown> | null | undefined,
  t: Translations,
): ActivityContextEntry[] {
  if (!context || typeof context !== "object") return [];
  const entries: ActivityContextEntry[] = [];
  for (const [key, raw] of Object.entries(context)) {
    if (REQUEST_KEYS.has(key) || isIdKey(key)) continue;
    // A numeric status is the HTTP status of the request, not a record status.
    if (key === "status" && typeof raw === "number") continue;
    const label = contextKeyLabel(key, t);
    if (!label) continue;
    const value = formatContextValue(key, raw, t);
    if (value === null) continue;
    entries.push({ key, label, value });
  }
  return entries;
}

/** One line for the table: up to three entries, "—" when nothing is left. */
export function activityContextSummary(
  context: Record<string, unknown> | null | undefined,
  t: Translations,
): string {
  const entries = activityContextEntries(context, t).slice(0, 3);
  return entries.length
    ? entries.map((entry) => `${entry.label}: ${entry.value}`).join(" · ")
    : "—";
}

const SIGN_IN_ACTIONS = new Set([
  "login",
  "login_success",
  "login_failure",
  "login_failed",
  "login_blocked",
  "login_mfa_requested",
  "refresh_token_theft",
  "refresh_family_revoked",
  "token_theft_detected",
]);

/**
 * Who acted, when the row has no staff name: a patient or lead login, the
 * payer through the token link (QA E2-03 — not an "unauthorized request"), an
 * anonymous sign-in attempt, or the system itself (scheduled jobs, webhooks).
 */
export function activityActorLabel(
  activity: { user_name?: string | null; actor_role?: string | null; action: string; entity_type?: string | null },
  t: Translations,
): string {
  if (activity.user_name) return activity.user_name;
  if (activity.actor_role === "patient") return t.activity_portal_actor;
  if (activity.action.startsWith("payer_")) return t.uiText.activity_payer_link_actor;
  if (activity.entity_type === "auth" || SIGN_IN_ACTIONS.has(activity.action)) {
    return t.activity_anonymous_actor;
  }
  return t.uiText.activity_system_actor;
}
