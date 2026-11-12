import { formatAppDateTime } from "@/lib/app-time-zone";
import type { Lang } from "@/lib/i18n";

export function adminLocale(lang: Lang) {
  return lang === "ru" ? "ru-RU" : "de-DE";
}

/** "DD.MM.YYYY HH:mm" Berlin time in every language. */
export function formatAdminDateTime(value: string | Date, _lang: Lang) {
  void _lang;
  return formatAppDateTime(value) || String(value);
}

/** What a stored credential reads as; the server keeps the value when it comes back. */
export const NOTIFICATION_SECRET_MASK = "********";

const NOTIFICATION_SECRET_KEY = /pass|secret|token|api_?key|auth|bearer|credential|private_key|signing_key/i;

/**
 * The config with every credential masked (screens QA 2026-11-12, E F3: the
 * SMTP password was printed in the table and the detail). The server masks
 * already; this keeps a page from showing one an older server still sends.
 */
export function maskNotificationSecrets(cfg: unknown): unknown {
  if (Array.isArray(cfg)) return cfg.map(maskNotificationSecrets);
  if (!cfg || typeof cfg !== "object") return cfg;
  return Object.fromEntries(
    Object.entries(cfg as Record<string, unknown>).map(([key, value]) => [
      key,
      NOTIFICATION_SECRET_KEY.test(key) && value !== null && value !== undefined && value !== ""
        ? NOTIFICATION_SECRET_MASK
        : maskNotificationSecrets(value),
    ]),
  );
}

export function compactNotificationConfig(cfg: Record<string, unknown>): string {
  const masked = maskNotificationSecrets(cfg) as Record<string, unknown>;
  return Object.entries(masked)
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join(", ");
}

export function prettyNotificationConfig(cfg: Record<string, unknown>): string {
  return JSON.stringify(maskNotificationSecrets(cfg), null, 2);
}

/**
 * The translated text of a refusal the server marks with a code
 * (`{"error": "<code>"}`); otherwise the server message or the fallback.
 */
export function codedAdminErrorText(
  error: unknown,
  messages: Partial<Record<string, string>>,
  fallback: string,
): string {
  const body = (error as { body?: { error?: unknown } } | null)?.body;
  const code = typeof body?.error === "string" ? body.error : "";
  const known = code ? messages[code] : undefined;
  if (known) return known;
  return error instanceof Error && error.message ? error.message : fallback;
}

export function matchesNotificationSearch(
  channel: {
    name: string;
    channel_type: string;
    config: Record<string, unknown>;
  },
  needle: string,
): boolean {
  const search = needle.trim().toLowerCase();
  if (!search) return true;
  const haystack = [
    channel.name,
    channel.channel_type,
    compactNotificationConfig(channel.config),
    prettyNotificationConfig(channel.config),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(search);
}

/**
 * The editable text of a setting. The API sends the stored JSON value as
 * text: a string arrives quoted and escaped (`"Straße 56\n81735 München"`),
 * so it is decoded instead of only stripping the quotes (QA E-07: a literal
 * "\n" was shown and would have been saved back).
 */
export function normalizeAdminSettingValue(value: string | undefined) {
  const raw = value ?? "";
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    try {
      const decoded: unknown = JSON.parse(raw);
      if (typeof decoded === "string") return decoded;
    } catch {
      // Not valid JSON: fall back to stripping the quotes.
    }
  }
  return raw.replace(/^"|"$/g, "");
}

export function summarizeAdminSettingValue(fieldKey: string, value: string): string {
  const normalized = normalizeAdminSettingValue(value).trim();
  if (!normalized) return "—";
  if (fieldKey === "required_patient_documents") {
    const count = normalized.split(/\r?\n/).reduce((total, line) => {
      return line.trim() ? total + 1 : total;
    }, 0);
    return count > 0 ? `${count}` : "—";
  }
  // A multi-line value (an address) reads as one line in the table.
  const oneLine = normalized.replace(/\s*\r?\n\s*/g, ", ");
  if (oneLine.length > 56) return `${oneLine.slice(0, 56)}…`;
  return oneLine;
}

export function shortAdminUserAgent(ua: string | null, max = 56): string {
  if (!ua) return "\u2014";
  return ua.length > max ? `${ua.slice(0, max)}\u2026` : ua;
}
