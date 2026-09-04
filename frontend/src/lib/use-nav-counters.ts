import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import { useDebouncedRealtimeSubscription } from "@/lib/realtime";

const LEAD_EVENTS = [
  "lead.created",
  "lead.updated",
  "lead.status_changed",
  "lead.promoted_to_console",
  "lead.converted",
  "lead.failed_resolved",
] as const;

const CHAT_NOTIFICATION_EVENTS = [
  "notification.created",
  "notification.read",
  "notifications.read_all",
] as const;

const REFRESH_INTERVAL_MS = 60_000;

type LeadStatusCount = {
  status: string;
  count: number;
};

type LeadStatusCountsPayload =
  | LeadStatusCount[]
  | { data?: LeadStatusCount[] };

export function getNewLeadCount(
  payload: LeadStatusCountsPayload | null | undefined,
): number {
  const rows = Array.isArray(payload) ? payload : payload?.data ?? [];
  return rows.find((item) => item.status === "new")?.count ?? 0;
}

export type NavCounters = {
  /** Unread direct-chat messages for the current user. */
  chatUnread: number;
  /** Leads currently in the `new` qualification status. */
  newLeads: number;
};

export function useNewLeadCounter(enabled: boolean): number {
  const [newLeads, setNewLeads] = useState(0);

  const refreshLeads = useCallback(() => {
    if (!enabled) return;
    apiFetch<LeadStatusCountsPayload>("/stats/leads/by-status", {
      forceFresh: true,
    })
      .then((payload) => setNewLeads(getNewLeadCount(payload)))
      .catch(() => undefined);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    refreshLeads();
    const timer = window.setInterval(refreshLeads, REFRESH_INTERVAL_MS);
    window.addEventListener("focus", refreshLeads);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshLeads);
    };
  }, [enabled, refreshLeads]);

  useDebouncedRealtimeSubscription(LEAD_EVENTS, refreshLeads);

  return newLeads;
}

/**
 * Lightweight badge counters for the nav panel. Each source degrades
 * silently: roles without access to an endpoint simply get no badge.
 */
export function useNavCounters(enabled: boolean): NavCounters {
  const [chatUnread, setChatUnread] = useState(0);
  const newLeads = useNewLeadCounter(enabled);

  const refreshChat = useCallback(() => {
    if (!enabled) return;
    apiFetch<{ count: number }>("/messages/unread-total", { forceFresh: true })
      .then((payload) => setChatUnread(payload?.count ?? 0))
      .catch(() => undefined);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    refreshChat();
    const timer = window.setInterval(refreshChat, REFRESH_INTERVAL_MS);
    window.addEventListener("focus", refreshChat);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshChat);
    };
  }, [enabled, refreshChat]);

  useDebouncedRealtimeSubscription(CHAT_NOTIFICATION_EVENTS, (_event, events) => {
    if (
      events.some(
        (event) => event.payload?.entity_type === "message_peer",
      )
    ) {
      refreshChat();
    }
  });

  return { chatUnread, newLeads };
}
