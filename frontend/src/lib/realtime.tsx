import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  buildApiWebSocketUrl,
  clearApiCache,
  getAccessToken,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";

export type RealtimeEvent = {
  seq?: number | null;
  id?: string;
  type: string;
  entity_type: string;
  entity_id: string;
  patient_id?: string | null;
  actor_user_id?: string | null;
  occurred_at?: string;
  payload?: Record<string, unknown>;
};

export type RealtimeConnectionStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

export type RealtimeConnectionSnapshot = {
  status: RealtimeConnectionStatus;
  attempt: number;
  userId: string | null;
  updatedAt: number;
};

const REALTIME_EVENT_NAME = "gmed:realtime-event";
const REALTIME_CONNECTION_EVENT_NAME = "gmed:realtime-connection";
const BASE_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const STATS_CACHE_EVENT_PREFIXES = [
  "appointment.",
  "appointment_checklist.",
  "appointment_request.",
  "case.",
  "concierge_service.",
  "consent.",
  "document.",
  "feedback.",
  "framework_contract.",
  "invoice.",
  "lead.",
  "order.",
  "patient.",
  "privacy_request.",
  "provider.",
  "quote.",
  "reminder.",
  "task.",
  "user.",
  "workflow_checklist_item.",
] as const;

type RealtimeCustomEvent = CustomEvent<RealtimeEvent>;
type RealtimeConnectionCustomEvent = CustomEvent<RealtimeConnectionSnapshot>;

let latestConnectionSnapshot: RealtimeConnectionSnapshot = {
  status: "disconnected",
  attempt: 0,
  userId: null,
  updatedAt: Date.now(),
};

function dispatchConnectionSnapshot(
  status: RealtimeConnectionStatus,
  attempt: number,
  userId: string | null,
) {
  latestConnectionSnapshot = {
    status,
    attempt,
    userId,
    updatedAt: Date.now(),
  };
  window.dispatchEvent(
    new CustomEvent(REALTIME_CONNECTION_EVENT_NAME, {
      detail: latestConnectionSnapshot,
    }),
  );
}

function cursorStorageKey(userId: string) {
  return `gmed:realtime:last-seq:${userId}`;
}

function readStoredCursor(key: string) {
  try {
    const value = window.localStorage.getItem(key);
    if (!value) return 0;
    const seq = Number(value);
    return Number.isFinite(seq) && seq > 0 ? seq : 0;
  } catch {
    return 0;
  }
}

function writeStoredCursor(key: string, seq: number) {
  try {
    window.localStorage.setItem(key, String(seq));
  } catch {
    // Realtime still works without durable client-side cursors.
  }
}

function invalidateStatsCacheForEvent(event: RealtimeEvent) {
  if (!STATS_CACHE_EVENT_PREFIXES.some((prefix) => event.type.startsWith(prefix))) {
    return;
  }

  clearApiCache("/stats");

  if (event.type.startsWith("patient.")) {
    clearApiCache("/patients");
  }
  if (event.type.startsWith("privacy_request.") || event.type.startsWith("consent.")) {
    clearApiCache("/admin/compliance");
    clearApiCache("/me/privacy-requests");
  }
  if (event.type.startsWith("lead.")) {
    clearApiCache("/leads");
  }
  if (event.type.startsWith("appointment.")) {
    clearApiCache("/appointments");
  }
  if (
    event.type.startsWith("appointment_checklist.") ||
    event.type.startsWith("reminder.") ||
    event.type.startsWith("task.") ||
    event.type.startsWith("workflow_checklist_item.")
  ) {
    clearApiCache("/appointments");
    clearApiCache("/tasks");
  }
  if (event.type.startsWith("order.")) {
    clearApiCache("/orders");
  }
  if (event.type.startsWith("workflow_checklist_item.")) {
    clearApiCache("/orders");
    clearApiCache("/patients");
  }
  if (event.type.startsWith("provider.")) {
    clearApiCache("/providers");
  }
  if (event.type.startsWith("invoice.")) {
    clearApiCache("/invoices");
    clearApiCache("/me/invoices");
  }
  if (event.type.startsWith("document.")) {
    clearApiCache("/documents");
    clearApiCache("/me/documents");
  }
  if (event.type.startsWith("feedback.")) {
    clearApiCache("/feedback");
    clearApiCache("/me/feedback");
  }
  if (event.type.startsWith("user.")) {
    clearApiCache("/users");
  }
}

function readEventSeq(event: RealtimeEvent) {
  return typeof event.seq === "number" && Number.isFinite(event.seq) && event.seq > 0
    ? event.seq
    : null;
}

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const userId = user?.id ?? "";

  useEffect(() => {
    if (loading) return;

    if (!userId) {
      dispatchConnectionSnapshot("disconnected", 0, null);
      return;
    }

    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let stopped = false;
    let attempt = 0;
    const storageKey = cursorStorageKey(userId);
    let lastSeq = readStoredCursor(storageKey);

    function dispatch(event: RealtimeEvent) {
      window.dispatchEvent(new CustomEvent(REALTIME_EVENT_NAME, { detail: event }));
    }

    function rememberCursor(event: RealtimeEvent) {
      const seq = readEventSeq(event);
      if (seq === null || seq <= lastSeq) return;
      lastSeq = seq;
      writeStoredCursor(storageKey, seq);
    }

    function scheduleReconnect() {
      if (stopped) return;
      const delay = Math.min(
        BASE_RECONNECT_DELAY_MS * 2 ** attempt,
        MAX_RECONNECT_DELAY_MS,
      );
      attempt += 1;
      dispatchConnectionSnapshot("reconnecting", attempt, userId);
      reconnectTimer = window.setTimeout(connect, delay);
    }

    function connect() {
      const token = getAccessToken();
      if (stopped) return;
      if (!token) {
        dispatchConnectionSnapshot("disconnected", attempt, userId);
        return;
      }

      socket = new WebSocket(buildApiWebSocketUrl("/events/ws", {
        token,
        last_seq: lastSeq > 0 ? lastSeq : undefined,
      }));
      socket.onopen = () => {
        attempt = 0;
        dispatchConnectionSnapshot("connected", attempt, userId);
      };
      socket.onmessage = (message) => {
        if (typeof message.data !== "string") return;
        try {
          const event = JSON.parse(message.data) as RealtimeEvent;
          rememberCursor(event);
          if (event.type === "realtime.resync_required") {
            clearApiCache();
          } else {
            invalidateStatsCacheForEvent(event);
          }
          dispatch(event);
        } catch {
          // Ignore malformed realtime frames; the next valid frame can still be used.
        }
      };
      socket.onclose = () => {
        socket = null;
        if (!stopped) {
          clearApiCache();
          dispatch({
            type: "realtime.disconnected",
            entity_type: "realtime",
            entity_id: userId,
          });
          scheduleReconnect();
        }
      };
      socket.onerror = () => {
        socket?.close();
      };
    }

    dispatchConnectionSnapshot("connecting", attempt, userId);
    connect();

    return () => {
      stopped = true;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      socket?.close();
      dispatchConnectionSnapshot("disconnected", 0, userId);
    };
  }, [loading, userId]);

  return children;
}

export function useRealtimeConnectionStatus() {
  const [snapshot, setSnapshot] = useState<RealtimeConnectionSnapshot>(
    latestConnectionSnapshot,
  );

  useEffect(() => {
    function onConnectionChange(event: Event) {
      setSnapshot((event as RealtimeConnectionCustomEvent).detail);
    }

    window.addEventListener(REALTIME_CONNECTION_EVENT_NAME, onConnectionChange);
    return () => {
      window.removeEventListener(
        REALTIME_CONNECTION_EVENT_NAME,
        onConnectionChange,
      );
    };
  }, []);

  return snapshot;
}

export function useRealtimeSubscription(
  eventTypes: readonly string[],
  handler: (event: RealtimeEvent) => void,
) {
  const latestHandlerRef = useRef(handler);
  const eventTypeKey = eventTypes.join("\u0000");

  useEffect(() => {
    latestHandlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    const eventTypeSet = new Set(eventTypeKey ? eventTypeKey.split("\u0000") : []);

    function onRealtimeEvent(event: Event) {
      const realtimeEvent = (event as RealtimeCustomEvent).detail;
      if (!realtimeEvent || !eventTypeSet.has(realtimeEvent.type)) return;
      latestHandlerRef.current(realtimeEvent);
    }

    window.addEventListener(REALTIME_EVENT_NAME, onRealtimeEvent);
    return () => {
      window.removeEventListener(REALTIME_EVENT_NAME, onRealtimeEvent);
    };
  }, [eventTypeKey]);
}

export function useDebouncedRealtimeSubscription(
  eventTypes: readonly string[],
  handler: (event: RealtimeEvent, events: readonly RealtimeEvent[]) => void,
  delayMs = 250,
) {
  const latestHandlerRef = useRef(handler);
  const queuedEventsRef = useRef<RealtimeEvent[]>([]);
  const timerRef = useRef<number | null>(null);
  const eventTypeKey = eventTypes.join("\u0000");

  useEffect(() => {
    latestHandlerRef.current = handler;
  }, [handler]);

  useRealtimeSubscription(eventTypes, (event) => {
    if (delayMs <= 0) {
      latestHandlerRef.current(event, [event]);
      return;
    }

    queuedEventsRef.current.push(event);
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      const events = queuedEventsRef.current;
      queuedEventsRef.current = [];
      const latestEvent = events[events.length - 1];
      if (latestEvent) {
        latestHandlerRef.current(latestEvent, events);
      }
    }, delayMs);
  });

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      queuedEventsRef.current = [];
    };
  }, [delayMs, eventTypeKey]);
}
