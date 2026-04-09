import { get, postNoBody } from "./client";
import type { Notification, ActiveAnnouncement } from "./types";

export function fetchUnreadCount(): Promise<{ count: number }> {
  return get<{ count: number }>("/notifications/unread-count");
}

export function fetchNotifications(): Promise<Notification[]> {
  return get<Notification[]>("/notifications");
}

export function markAllRead(): Promise<void> {
  return postNoBody("/notifications/read-all");
}

export function markOneRead(id: string): Promise<void> {
  return postNoBody(`/notifications/${id}/read`);
}

export function fetchActiveAnnouncements(): Promise<ActiveAnnouncement[]> {
  return get<ActiveAnnouncement[]>("/announcements/active");
}
