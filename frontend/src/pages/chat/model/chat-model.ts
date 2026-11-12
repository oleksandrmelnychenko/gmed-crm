import { appDateKey, formatAppDateTime, formatAppTime } from "@/lib/app-time-zone";
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

/** "HH:mm" for a message sent today, else "DD.MM.YYYY HH:mm" (Berlin time). */
export function timeAgo(iso: string, _lang: "de" | "ru" = "de", now = new Date()) {
  void _lang;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return chatMessageDateKey(iso) === appDateKey(now)
    ? formatAppTime(date)
    : formatAppDateTime(date);
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

export function canMarkLoadedMessagesRead(messages: Message[], myId: string) {
  // Opening the visible conversation acknowledges the displayed rows, including
  // an unavailable-message notice. Missing device keys must not trap its badge.
  return messages.some((message) => message.to_user === myId && !message.is_read);
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

export type ChatTextPart = { kind: "text"; text: string } | { kind: "link"; text: string; href: string };

const CHAT_LINK_PATTERN = /https?:\/\/[^\s<>"'`]+/gi;
const CHAT_LINK_TRAILING = /[.,;:!?)\]}»"']+$/;

/**
 * Splits a message into plain text and web links. Only http(s) addresses
 * become links; everything stays text (rendered by React, never as HTML).
 * Trailing punctuation of a sentence is not part of the link, a closing
 * bracket only when the link has no opening one (QA 2026-11-12 system-A S3-2).
 */
export function splitChatTextLinks(text: string): ChatTextPart[] {
  const parts: ChatTextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(CHAT_LINK_PATTERN)) {
    const start = match.index ?? 0;
    let candidate = match[0];
    const trailing = CHAT_LINK_TRAILING.exec(candidate)?.[0] ?? "";
    if (trailing) {
      let keep = 0;
      // A ")" closes a bracket of the link itself (Wikipedia style).
      const opens = (candidate.match(/\(/g) ?? []).length;
      const closes = (candidate.slice(0, candidate.length - trailing.length).match(/\)/g) ?? []).length;
      if (trailing.startsWith(")") && opens > closes) keep = 1;
      candidate = candidate.slice(0, candidate.length - trailing.length + keep);
    }
    let href: string | null = null;
    try {
      const url = new URL(candidate);
      if ((url.protocol === "http:" || url.protocol === "https:") && url.hostname) href = url.href;
    } catch {
      href = null;
    }
    if (!href) continue;
    if (start > last) parts.push({ kind: "text", text: text.slice(last, start) });
    parts.push({ kind: "link", text: candidate, href });
    last = start + candidate.length;
  }
  if (last < text.length) parts.push({ kind: "text", text: text.slice(last) });
  return parts;
}

export const CHAT_MESSAGE_GROUP_WINDOW_MS = 5 * 60 * 1000;

/** The German calendar day a message belongs to. */
export function chatMessageDateKey(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  return appDateKey(date);
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
    // The server and the menu have opened the chat to Sales all along.
    role === "sales" ||
    role === "patient_manager" ||
    role === "teamlead_interpreter" ||
    role === "interpreter" ||
    role === "concierge" ||
    role === "billing" ||
    role === "it_admin"
  );
}
