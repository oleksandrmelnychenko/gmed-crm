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

export function compactNotificationConfig(cfg: Record<string, unknown>): string {
  return Object.entries(cfg)
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join(", ");
}

export function prettyNotificationConfig(cfg: Record<string, unknown>): string {
  return JSON.stringify(cfg, null, 2);
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

export function normalizeAdminSettingValue(value: string | undefined) {
  return (value ?? "").replace(/^"|"$/g, "");
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
  if (normalized.length > 56) return `${normalized.slice(0, 56)}…`;
  return normalized;
}

export function shortAdminUserAgent(ua: string | null, max = 56): string {
  if (!ua) return "\u2014";
  return ua.length > max ? `${ua.slice(0, max)}\u2026` : ua;
}
