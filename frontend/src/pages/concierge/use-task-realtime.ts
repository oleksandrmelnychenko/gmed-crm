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

  useEffect(() => {
    latest.current = { refresh, enabled, busy };
    if (!enabled) queued.current = false;
    else if (!busy && queued.current) requestRefresh();
  }, [refresh, enabled, busy, requestRefresh]);

  useDebouncedRealtimeSubscription(eventTypes, (_event, events) => {
    if (taskRealtimeBatchAffects(events, taskId)) requestRefresh();
  });

  useEffect(() => {
    if (!enabled) return;
    // Reconcile missed frames, including a socket stuck in its handshake.
    // Hidden/offline tabs do not poll; returning to the view refreshes once.
    const timer = window.setInterval(() => {
      if (!pollingPaused && Date.now() - lastRefresh.current >= (status === "connected" ? 60_000 : 10_000)) requestRefresh();
    }, 1_000);
    window.addEventListener("focus", requestRefresh);
    window.addEventListener("online", requestRefresh);
    document.addEventListener("visibilitychange", requestRefresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", requestRefresh);
      window.removeEventListener("online", requestRefresh);
      document.removeEventListener("visibilitychange", requestRefresh);
    };
  }, [enabled, pollingPaused, status, requestRefresh]);
}
