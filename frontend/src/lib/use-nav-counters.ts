import { useCallback, useEffect, useRef, useState } from "react";

import { apiFetch } from "@/lib/api";
import { CHAT_READ_REFRESH_EVENT } from "@/lib/chat-read-events";
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
export const NEW_LEAD_COUNTER_REFRESH_EVENT = "gmed:new-lead-counter-refresh";

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

/**
 * One shared read of the new-lead count for every badge (top bar and nav
 * panel): they mount, refocus and hear the same lead events together, and
 * used to send the same request each (QA C-33: up to 6 identical calls per
 * navigation). A read asked for within `LEAD_COUNT_JOIN_MS` of a running one
 * joins it; a lead change heard later than that reads once more afterwards,
 * so the count never stays behind the change.
 */
export const LEAD_COUNT_JOIN_MS = 250;
/** A passive read (mount, focus) within this time after the last one reuses it. */
export const LEAD_COUNT_FRESH_MS = 3_000;

type LeadCountListener = (count: number) => void;

export function createSharedLeadCounter(
  load: () => Promise<LeadStatusCountsPayload>,
  now: () => number = Date.now,
) {
  const listeners = new Set<LeadCountListener>();
  let running: { startedAt: number } | null = null;
  let rerun = false;
  let last: { count: number; at: number } | null = null;

  const refresh = (reason: "passive" | "change" = "passive") => {
    if (listeners.size === 0) return;
    if (running) {
      if (reason === "change" && now() - running.startedAt > LEAD_COUNT_JOIN_MS) rerun = true;
      return;
    }
    // A badge mounting or the window refocusing right after a read takes it.
    if (reason === "passive" && last && now() - last.at < LEAD_COUNT_FRESH_MS) {
      const count = last.count;
      listeners.forEach((listener) => listener(count));
      return;
    }
    running = { startedAt: now() };
    void load()
      .then((payload) => {
        const count = getNewLeadCount(payload);
        last = { count, at: now() };
        listeners.forEach((listener) => listener(count));
      })
      .catch(() => undefined)
      .finally(() => {
        running = null;
        if (rerun) {
          rerun = false;
          refresh("change");
        }
      });
  };

  const subscribe = (listener: LeadCountListener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      // Nobody shows the count any more (logout): the next user reads anew.
      if (listeners.size === 0) last = null;
    };
  };

  return { refresh, subscribe, listenerCount: () => listeners.size };
}

const sharedLeadCounter = createSharedLeadCounter(() =>
  apiFetch<LeadStatusCountsPayload>("/stats/leads/by-status", { forceFresh: true }),
);
let sharedLeadTimer: number | undefined;
const refreshSharedLeadsPassive = () => sharedLeadCounter.refresh("passive");
const refreshSharedLeadsAfterChange = () => sharedLeadCounter.refresh("change");

function startSharedLeadPolling() {
  if (sharedLeadTimer !== undefined) return;
  sharedLeadTimer = window.setInterval(refreshSharedLeadsPassive, REFRESH_INTERVAL_MS);
  window.addEventListener("focus", refreshSharedLeadsPassive);
  window.addEventListener(NEW_LEAD_COUNTER_REFRESH_EVENT, refreshSharedLeadsAfterChange);
}

function stopSharedLeadPolling() {
  if (sharedLeadTimer === undefined || sharedLeadCounter.listenerCount() > 0) return;
  window.clearInterval(sharedLeadTimer);
  sharedLeadTimer = undefined;
  window.removeEventListener("focus", refreshSharedLeadsPassive);
  window.removeEventListener(NEW_LEAD_COUNTER_REFRESH_EVENT, refreshSharedLeadsAfterChange);
}

export function useNewLeadCounter(enabled: boolean): number {
  const [newLeads, setNewLeads] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const unsubscribe = sharedLeadCounter.subscribe(setNewLeads);
    startSharedLeadPolling();
    sharedLeadCounter.refresh("passive");
    return () => {
      unsubscribe();
      stopSharedLeadPolling();
    };
  }, [enabled]);

  const refreshAfterLeadEvent = useCallback(() => {
    if (enabled) refreshSharedLeadsAfterChange();
  }, [enabled]);
  useDebouncedRealtimeSubscription(LEAD_EVENTS, refreshAfterLeadEvent);

  return newLeads;
}

/**
 * Lightweight badge counters for the nav panel. `leadsEnabled` must follow
 * the leads route access (`/stats/leads/by-status` answers 403 to roles
 * without `leads.view`, e.g. interpreters), so those roles never call it.
 */
export function useNavCounters(enabled: boolean, leadsEnabled: boolean): NavCounters {
  const [chatUnread, setChatUnread] = useState(0);
  const chatRequestId = useRef(0);
  const newLeads = useNewLeadCounter(enabled && leadsEnabled);

  const refreshChat = useCallback(() => {
    if (!enabled) return;
    const requestId = ++chatRequestId.current;
    apiFetch<{ count: number }>("/messages/unread-total", { forceFresh: true })
      .then((payload) => {
        if (requestId === chatRequestId.current) setChatUnread(payload?.count ?? 0);
      })
      .catch(() => undefined);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    refreshChat();
    const timer = window.setInterval(refreshChat, REFRESH_INTERVAL_MS);
    window.addEventListener("focus", refreshChat);
    window.addEventListener(CHAT_READ_REFRESH_EVENT, refreshChat);
    return () => {
      chatRequestId.current++;
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshChat);
      window.removeEventListener(CHAT_READ_REFRESH_EVENT, refreshChat);
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

  return { chatUnread: enabled ? chatUnread : 0, newLeads };
}
