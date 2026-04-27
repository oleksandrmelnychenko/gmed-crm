import { apiFetch } from "@/lib/api";

export interface Notification {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  is_read: boolean;
  created_at: string;
}

export interface ActiveSession {
  user_id: string;
  user_name: string;
  user_email: string;
  role: string;
}

export interface ActiveAnnouncement {
  title: string;
  message: string;
  variant: string;
}

export interface ChatMessage {
  from_user: string;
  message: string;
  created_at: string;
}

const TOPBAR_FAST_CACHE_TTL_MS = 10_000;
const TOPBAR_PANEL_CACHE_TTL_MS = 15_000;
const TOPBAR_STATIC_CACHE_TTL_MS = 60_000;

export async function fetchTopbarPresence() {
  const [countPayload, onlineUsers] = await Promise.all([
    apiFetch<{ count: number }>("/notifications/unread-count", {
      cacheTtlMs: TOPBAR_FAST_CACHE_TTL_MS,
    }).catch(() => null),
    apiFetch<ActiveSession[]>("/users/online", {
      cacheTtlMs: TOPBAR_FAST_CACHE_TTL_MS,
    }).catch(() => []),
  ]);
  return {
    unreadCount: countPayload?.count ?? 0,
    onlineUsers,
  };
}

export async function fetchNotificationPanelWorkspace() {
  const [notifications, announcements] = await Promise.all([
    apiFetch<Notification[]>("/notifications", {
      cacheTtlMs: TOPBAR_PANEL_CACHE_TTL_MS,
    }).catch(() => []),
    apiFetch<ActiveAnnouncement[]>("/announcements/active", {
      cacheTtlMs: TOPBAR_STATIC_CACHE_TTL_MS,
    }).catch(() => []),
  ]);
  return { notifications, announcements };
}

export function markAllNotificationsRead() {
  return apiFetch("/notifications/read-all", { method: "POST" });
}

export function markNotificationRead(id: string) {
  return apiFetch(`/notifications/${id}/read`, { method: "POST" });
}

export function fetchTopbarChatMessages(userId: string) {
  return apiFetch<ChatMessage[]>(`/messages/${userId}`);
}

export function markTopbarChatRead(userId: string) {
  return apiFetch(`/messages/${userId}/read`, { method: "POST" });
}

export function sendTopbarChatMessage(userId: string, message: string) {
  return apiFetch(`/messages/${userId}`, {
    method: "POST",
    body: JSON.stringify({ message }),
  });
}
