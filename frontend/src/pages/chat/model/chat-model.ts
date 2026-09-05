import { formatUnknownValue, type Translations } from "@/lib/i18n";
import type { Message } from "./types";

export function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export function roleDisplay(role: string, translations: Translations) {
  const labels = translations as unknown as Record<string, string>;
  return labels[`role_${role}`] ?? formatUnknownValue(role, translations);
}

export function timeAgo(iso: string, lang: "de" | "ru" = "de") {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const now = new Date();
  const options: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };
  if (chatMessageDateKey(iso) !== chatMessageDateKey(now.toISOString())) {
    options.day = "2-digit";
    options.month = "2-digit";
    if (date.getFullYear() !== now.getFullYear()) options.year = "numeric";
  }
  return new Intl.DateTimeFormat(lang === "de" ? "de-DE" : "ru-RU", options).format(date);
}

// The API uses descending (created_at, id) cursors. Match that order even when
// socket events and delivery receipts arrive before their HTTP refresh.
export function sortChatMessages(messages: Message[]) {
  return [...messages].sort((a, b) =>
    Date.parse(b.created_at) - Date.parse(a.created_at) || b.id.localeCompare(a.id),
  );
}

export function mergeChatMessages(current: Message[], incoming: Message[]) {
  const ids = new Set(incoming.map((message) => message.id));
  const clients = new Set(incoming.map((message) => message.client_message_id).filter(Boolean));
  return sortChatMessages([
    ...incoming,
    ...current.filter((message) => !ids.has(message.id) &&
      !(message.client_message_id && clients.has(message.client_message_id))),
  ]);
}

export function reconcileChatMessages(current: Message[], incoming: Message[], pageSize = 100) {
  const ordered = sortChatMessages(incoming);
  const oldest = ordered.at(-1);
  // A complete latest page is authoritative: missing rows were deleted or
  // expired. Preserve older loaded pages and local sends awaiting a receipt.
  const retained = current.filter((message) => message.delivery_state || (
    incoming.length >= pageSize && oldest && (
      Date.parse(message.created_at) < Date.parse(oldest.created_at) ||
      (Date.parse(message.created_at) === Date.parse(oldest.created_at) && message.id < oldest.id)
    )
  ));
  return mergeChatMessages(retained, ordered);
}

export function truncate(s: string, max: number) {
  return s.length <= max ? s : `${s.slice(0, max)}...`;
}

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const CHAT_MESSAGE_GROUP_WINDOW_MS = 5 * 60 * 1000;

export function chatMessageDateKey(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export function isSameChatMessageGroup(
  previous: { from_user: string; created_at: string } | undefined,
  current: { from_user: string; created_at: string } | undefined,
) {
  if (!previous || !current || previous.from_user !== current.from_user) {
    return false;
  }
  if (chatMessageDateKey(previous.created_at) !== chatMessageDateKey(current.created_at)) {
    return false;
  }

  const previousTime = new Date(previous.created_at).getTime();
  const currentTime = new Date(current.created_at).getTime();
  if (!Number.isFinite(previousTime) || !Number.isFinite(currentTime)) {
    return false;
  }
  return Math.abs(currentTime - previousTime) <= CHAT_MESSAGE_GROUP_WINDOW_MS;
}

export function canAccessChat(role?: string) {
  return (
    role === "patient" ||
    role === "ceo" ||
    role === "ceo_assistant" ||
    role === "patient_manager" ||
    role === "teamlead_interpreter" ||
    role === "interpreter" ||
    role === "concierge" ||
    role === "billing" ||
    role === "it_admin"
  );
}
