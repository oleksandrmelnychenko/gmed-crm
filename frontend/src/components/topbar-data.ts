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

export function notificationHrefForRole(item: Notification, role: string) {
  if (!item.entity_type) return null;

  if (role === "patient") {
    switch (item.entity_type) {
      case "message_peer":
        return item.entity_id ? `/chat?peer=${item.entity_id}` : "/chat";
      case "appointment":
      case "appointment_request":
        return "/appointments";
      case "concierge_service":
        return "/services";
      case "document":
      case "translation_request":
        return "/documents";
      case "invoice":
        return "/invoices";
      case "recommendation":
        return "/recommendations";
      case "service_package":
      case "patient_service_package":
        return "/subscriptions";
      case "privacy_request":
        return "/privacy";
      case "feedback":
        return "/feedback";
      default:
        return null;
    }
  }

  if (!item.entity_id) return null;
  if (item.entity_type === "message_peer") return `/chat?peer=${item.entity_id}`;
  if (item.entity_type === "lead") return `/leads?lead=${item.entity_id}`;
  if (item.entity_type === "patient") return `/patients?patient=${item.entity_id}`;
  if (item.entity_type === "provider") return `/providers/${item.entity_id}`;
  if (item.entity_type === "order") return `/orders?order=${item.entity_id}`;
  if (item.entity_type === "appointment") return `/appointments?appointment=${item.entity_id}`;
  if (item.entity_type === "appointment_request") return "/appointments";
  if (item.entity_type === "concierge_service") {
    return role === "concierge" ? "/concierge" : "/services";
  }
  if (item.entity_type === "concierge_task") {
    return role === "concierge" || role === "ceo" || role === "billing"
      ? `/task-manager?task=${item.entity_id}`
      : null;
  }
  if (item.entity_type === "concierge_expense") {
    if (role === "ceo" || role === "billing") {
      return `/company-finance?tab=concierge-expenses&expense=${item.entity_id}`;
    }
    return role === "concierge" ? "/concierge" : null;
  }
  if (item.entity_type === "document") return `/documents?document=${item.entity_id}`;
  if (item.entity_type === "invoice") return `/invoices?invoice=${item.entity_id}`;
  if (item.entity_type === "privacy_request") return "/admin/compliance";
  if (item.entity_type === "feedback") return "/feedback";
  if (item.entity_type === "case") return "/patients";
  return null;
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

export async function fetchUnreadNotificationCount() {
  const payload = await apiFetch<{ count: number }>("/notifications/unread-count", {
    cacheTtlMs: TOPBAR_FAST_CACHE_TTL_MS,
  }).catch(() => null);
  return payload?.count ?? 0;
}

export function fetchUserNotifications(options: { forceFresh?: boolean } = {}) {
  return apiFetch<Notification[]>("/notifications", {
    cacheTtlMs: options.forceFresh ? undefined : TOPBAR_PANEL_CACHE_TTL_MS,
    forceFresh: options.forceFresh,
  });
}

export async function fetchNotificationPanelWorkspace() {
  const [notifications, announcements] = await Promise.all([
    fetchUserNotifications().catch(() => []),
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
