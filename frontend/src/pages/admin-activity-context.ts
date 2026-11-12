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

/** Keys whose value is the status code of the changed record. */
const STATUS_KEYS = new Set(["status", "previous_status", "from_status", "to_status", "new_status", "old_status"]);
/** Keys whose value is a language code ("de", "ru"). */
const LANGUAGE_KEYS = new Set(["language", "preferred_language", "lang", "locale"]);
const CODE_VALUE = /^[a-z][a-z0-9_]*$/;

/**
 * A stored code shown in words (QA E3-01): first the label of exactly this
 * key and value, then the shared dictionaries — statuses, languages,
 * document categories, other known codes. Unknown codes stay as they are.
 */
function codeLabel(key: string, text: string, t: Translations): string | undefined {
  const exact = t.uiText[`activity_context_${key}_${text}`];
  if (exact) return exact;
  if (key === "role") return roleLabel(text, t);
  if (LANGUAGE_KEYS.has(key)) {
    const language = t.uiText[`activity_language_${text.toLowerCase()}`];
    if (language) return language;
  }
  if (!CODE_VALUE.test(text)) return undefined;
  if (STATUS_KEYS.has(key) || key === "from" || key === "to") {
    const status = t.uiText[`activity_status_${text}`];
    if (status) return status;
  }
  if (key === "category" || key === "access_category") {
    const category = t.uiText[`activity_category_${text}`] ?? t.uiText[`document_category_${text}`];
    if (category) return category;
  }
  return t.uiText[`activity_value_${text}`] ?? t.uiText[`activity_status_${text}`];
}

function formatScalar(key: string, value: unknown, t: Translations): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? t.common_yes : t.common_no;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  const mapped = codeLabel(key, text, t);
  if (mapped) return mapped;
  if (key === "role") return text;
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

/** Labels of the patient fields of the access matrix (as on /admin/access). */
const ACCESS_FIELD_LABEL_KEYS: Record<string, string> = {
  name: "field_name",
  birth_date: "field_birth_date",
  phone: "field_phone",
  email: "field_email",
  nationality: "field_nationality",
  languages: "field_languages",
  insurance: "field_insurance",
  diagnosis: "field_diagnosis",
  medications: "field_medications",
  allergies: "field_allergies",
  vitals: "field_vitals",
  internal_notes: "field_internal_notes",
  travel_data: "field_travel_data",
  functional_labels: "access_field_functional_labels",
};

const ACCESS_LEVEL_LABEL_KEYS: Record<string, string> = {
  full: "access_full",
  masked: "access_masked",
  hidden: "access_hidden",
  conditional: "access_conditional",
};

function translationByKey(t: Translations, key: string | undefined): string | undefined {
  if (!key) return undefined;
  const value = (t as unknown as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * A cell change of the access matrix (QA 2026-11-12 S3-3: the row showed
 * «—»): role, field and the level as "old → new". The server stores the new
 * cell under `new_value` and, since this fix, the old one under
 * `previous_value`.
 */
function accessPolicyContextEntries(
  context: Record<string, unknown>,
  t: Translations,
): ActivityContextEntry[] | null {
  const next = context.new_value;
  if (!isValueRecord(next as ActivityValues) || typeof (next as Record<string, unknown>).field_name !== "string") {
    return null;
  }
  const after = next as Record<string, unknown>;
  const before = isValueRecord(context.previous_value as ActivityValues)
    ? (context.previous_value as Record<string, unknown>)
    : null;
  const levelText = (level: unknown, condition: unknown): string | null => {
    if (typeof level !== "string" || !level) return null;
    const label = translationByKey(t, ACCESS_LEVEL_LABEL_KEYS[level]) ?? level;
    if (typeof condition === "string" && condition) {
      return `${label} (${t.uiText[`activity_value_${condition}`] ?? condition})`;
    }
    return label;
  };
  const entries: ActivityContextEntry[] = [];
  const role = typeof after.role === "string" ? after.role : "";
  if (role) {
    entries.push({
      key: "role",
      label: contextKeyLabel("role", t) ?? "role",
      value: roleLabel(role, t) ?? role,
    });
  }
  const field = after.field_name as string;
  entries.push({
    key: "field_name",
    label: contextKeyLabel("field_name", t) ?? "field_name",
    value: translationByKey(t, ACCESS_FIELD_LABEL_KEYS[field]) ?? field,
  });
  const to = levelText(after.access_level, after.condition_type);
  if (to) {
    const from = before ? levelText(before.access_level, before.condition_type) : null;
    entries.push({
      key: "access_level",
      label: contextKeyLabel("access_level", t) ?? "access_level",
      value: from && from !== to ? `${from} → ${to}` : to,
    });
  }
  return entries;
}

/** The known, non-empty entries of an audit context, in their stored order. */
export function activityContextEntries(
  context: Record<string, unknown> | null | undefined,
  t: Translations,
): ActivityContextEntry[] {
  if (!context || typeof context !== "object") return [];
  const accessPolicy = accessPolicyContextEntries(context, t);
  if (accessPolicy) return accessPolicy;
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

type ActivityValues = Record<string, unknown> | null | undefined;

function isValueRecord(value: ActivityValues): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * What a before/after audit row changed, as "field: old → new" (QA
 * 2026-11-10, E F-7: "Пользователь изменён" named no field). Only fields
 * that have a label (`activity_change_key_<field>`), are stored on both
 * sides and differ; an empty side reads "—".
 */
export function activityChangeEntries(
  oldValue: ActivityValues,
  newValue: ActivityValues,
  t: Translations,
): ActivityContextEntry[] {
  if (!isValueRecord(oldValue) || !isValueRecord(newValue)) return [];
  const entries: ActivityContextEntry[] = [];
  for (const [key, after] of Object.entries(newValue)) {
    if (!(key in oldValue)) continue;
    const label = t.uiText[`activity_change_key_${key}`];
    if (!label) continue;
    const before = oldValue[key];
    if (JSON.stringify(before ?? null) === JSON.stringify(after ?? null)) continue;
    const from = formatContextValue(key, before, t) ?? "—";
    const to = formatContextValue(key, after, t) ?? "—";
    if (from === to) continue;
    entries.push({ key: `change:${key}`, label, value: `${from} → ${to}` });
  }
  return entries;
}

/** One line for the table: up to three entries, "—" when nothing is left. */
export function activityContextSummary(
  context: Record<string, unknown> | null | undefined,
  t: Translations,
  changes: ActivityContextEntry[] = [],
): string {
  const entries = [...changes, ...activityContextEntries(context, t)].slice(0, 3);
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
