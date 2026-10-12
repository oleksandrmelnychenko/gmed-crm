import { useCallback, useEffect, useRef } from "react";
import { useDebouncedRealtimeSubscription, useRealtimeConnectionStatus, type RealtimeEvent } from "@/lib/realtime";

export const TASK_REALTIME_EVENTS = [
  "realtime.connected", "realtime.resync_required",
  "task.created", "task.status_changed",
  "concierge_operational_item.created", "concierge_operational_item.updated",
  "concierge_operational_item.deleted", "concierge_operational_item.archived",
  "concierge_operational_item.restored", "concierge_operational_item.reminder_sent",
  "concierge_operational_item.comment_added", "concierge_operational_item.comment_edited",
  "concierge_operational_item.comment_deleted", "concierge_operational_item.checklist_item_added",
  "concierge_operational_item.checklist_item_toggled", "concierge_operational_item.checklist_item_edited",
  "concierge_operational_item.checklist_item_deleted", "concierge_operational_item.attachment_added",
  "concierge_operational_item.attachment_deleted",
] as const;

export function taskRealtimeBatchAffects(events: readonly RealtimeEvent[], taskId?: string | null) {
  return events.some(event => event.type.startsWith("realtime.") || !taskId || event.entity_id === taskId);
}

/**
 * A refresh asked for by the browser (window focus, back online, tab shown) or
 * by the socket (re)connecting, not by a change: right after the view loaded
 * (or refreshed) it would only repeat the same requests (QA C-33: every list
 * of the task manager was loaded twice per navigation).
 */
export const PASSIVE_REFRESH_MIN_GAP_MS = 3_000;

export function isPassiveRealtimeBatch(events: readonly RealtimeEvent[]) {
  return events.length > 0 && events.every(event => event.type === "realtime.connected");
}

export function passiveRefreshDue(lastRefreshAt: number, now = Date.now()) {
  return now - lastRefreshAt >= PASSIVE_REFRESH_MIN_GAP_MS;
}

// Use the same lifecycle events in every task view. Coalesced events must all
// be checked: the last frame in a burst may belong to a different task.
export function useTaskRealtimeRefresh(
  refresh: () => void,
  { enabled = true, busy = false, pollingPaused = false, taskId, eventTypes = TASK_REALTIME_EVENTS }: {
    enabled?: boolean;
    busy?: boolean;
    pollingPaused?: boolean;
    taskId?: string | null;
    eventTypes?: readonly string[];
  } = {},
) {
  const { status } = useRealtimeConnectionStatus();
  const latest = useRef({ refresh, enabled, busy });
  const queued = useRef(false);
  const lastRefresh = useRef(Date.now());
  const requestRefresh = useCallback(() => {
    const current = latest.current;
    if (!current.enabled) return;
    if (current.busy || document.visibilityState !== "visible" || !navigator.onLine) {
      queued.current = true;
      return;
    }
    queued.current = false;
    lastRefresh.current = Date.now();
    current.refresh();
  }, []);
  const requestPassiveRefresh = useCallback(() => {
    if (passiveRefreshDue(lastRefresh.current)) requestRefresh();
  }, [requestRefresh]);

  useEffect(() => {
    latest.current = { refresh, enabled, busy };
    if (!enabled) queued.current = false;
    else if (!busy && queued.current) requestRefresh();
  }, [refresh, enabled, busy, requestRefresh]);

  useDebouncedRealtimeSubscription(eventTypes, (_event, events) => {
    if (!taskRealtimeBatchAffects(events, taskId)) return;
    if (isPassiveRealtimeBatch(events)) requestPassiveRefresh();
    else requestRefresh();
  });

  useEffect(() => {
    if (!enabled) return;
    // Reconcile missed frames, including a socket stuck in its handshake.
    // Hidden/offline tabs do not poll; returning to the view refreshes once.
    const timer = window.setInterval(() => {
      if (!pollingPaused && Date.now() - lastRefresh.current >= (status === "connected" ? 60_000 : 10_000)) requestRefresh();
    }, 1_000);
    window.addEventListener("focus", requestPassiveRefresh);
    window.addEventListener("online", requestPassiveRefresh);
    document.addEventListener("visibilitychange", requestPassiveRefresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", requestPassiveRefresh);
      window.removeEventListener("online", requestPassiveRefresh);
      document.removeEventListener("visibilitychange", requestPassiveRefresh);
    };
  }, [enabled, pollingPaused, status, requestRefresh, requestPassiveRefresh]);
}
