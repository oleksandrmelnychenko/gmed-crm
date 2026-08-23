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

export type NavCounters = {
  /** Unread direct-chat messages for the current user. */
  chatUnread: number;
  /** Leads currently in the `new` qualification status. */
  newLeads: number;
};

/**
 * Lightweight badge counters for the nav panel. Each source degrades
 * silently: roles without access to an endpoint simply get no badge.
 */
export function useNavCounters(enabled: boolean): NavCounters {
  const [chatUnread, setChatUnread] = useState(0);
  const [newLeads, setNewLeads] = useState(0);

  const refreshChat = useCallback(() => {
    if (!enabled) return;
    apiFetch<{ count: number }>("/messages/unread-total", { forceFresh: true })
      .then((payload) => setChatUnread(payload?.count ?? 0))
      .catch(() => undefined);
  }, [enabled]);

  const refreshLeads = useCallback(() => {
    if (!enabled) return;
    apiFetch<{ data: { status: string; count: number }[] }>("/stats/leads/by-status", {
      forceFresh: true,
    })
      .then((payload) => {
        const row = payload?.data?.find((item) => item.status === "new");
        setNewLeads(row?.count ?? 0);
      })
      .catch(() => undefined);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    refreshChat();
    refreshLeads();
    const timer = window.setInterval(() => {
      refreshChat();
      refreshLeads();
    }, REFRESH_INTERVAL_MS);
    const onFocus = () => {
      refreshChat();
      refreshLeads();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [enabled, refreshChat, refreshLeads]);

  useDebouncedRealtimeSubscription(LEAD_EVENTS, refreshLeads);
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
