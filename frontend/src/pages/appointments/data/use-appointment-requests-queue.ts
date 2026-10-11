import {
  useCallback,
  useEffect,
  useReducer,
  type SetStateAction,
} from "react";

import { apiFetch, clearApiCache } from "@/lib/api";
import { useTaskRealtimeRefresh } from "@/pages/concierge/use-task-realtime";
import type {
  AppointmentRequestItem,
} from "@/pages/appointments/model/types";

type UseAppointmentRequestsQueueOptions = {
  enabled: boolean;
  appointmentsVersion: number;
  failedLoadMessage: string;
};

type AppointmentRequestsQueueState = {
  appointmentRequests: AppointmentRequestItem[];
  appointmentRequestsLoading: boolean;
  appointmentRequestsError: string;
  /** Bumped by the queue's own refresh (realtime, reconnect, focus, poll). */
  reloadVersion: number;
};

type AppointmentRequestsQueuePatch =
  | Partial<AppointmentRequestsQueueState>
  | ((current: AppointmentRequestsQueueState) => Partial<AppointmentRequestsQueueState>);

const APPOINTMENT_REQUESTS_PATH = "/appointments/requests";

/**
 * The open requests are read again after these events. The toolbar count
 * ("Очередь (N)") and the queue sheet both show this one list, so the count
 * follows the list (QA 2026-10-11: the count stayed at 1 while the queue
 * already listed 2). A reconnect or resync may follow missed request events;
 * the shared refresh hook also re-reads on focus and polls as a fallback.
 */
export const APPOINTMENT_REQUEST_QUEUE_EVENTS = [
  "realtime.connected",
  "realtime.resync_required",
  "appointment_request.created",
  "appointment_request.reviewed",
  "appointment_request.converted",
  "appointment_request.cancelled",
] as const;

function createAppointmentRequestsQueueState(): AppointmentRequestsQueueState {
  return {
    appointmentRequests: [],
    appointmentRequestsLoading: false,
    appointmentRequestsError: "",
    reloadVersion: 0,
  };
}

function appointmentRequestsQueueReducer(
  state: AppointmentRequestsQueueState,
  patch: AppointmentRequestsQueuePatch,
): AppointmentRequestsQueueState {
  return {
    ...state,
    ...(typeof patch === "function" ? patch(state) : patch),
  };
}

function mergeOpenRequests(
  requested: AppointmentRequestItem[],
  approved: AppointmentRequestItem[],
) {
  const seen = new Set<string>();
  return [...requested, ...approved]
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .toSorted((left, right) =>
      right.requested_at.localeCompare(left.requested_at),
    );
}

export function settleAppointmentRequestQueueResults(
  requestedResult: PromiseSettledResult<AppointmentRequestItem[]>,
  approvedResult: PromiseSettledResult<AppointmentRequestItem[]>,
  currentRows: AppointmentRequestItem[],
  failedLoadMessage: string,
) {
  const requested =
    requestedResult.status === "fulfilled"
      ? requestedResult.value
      : currentRows.filter((item) => item.status === "requested");
  const approved =
    approvedResult.status === "fulfilled"
      ? approvedResult.value
      : currentRows.filter((item) => item.status === "approved");
  const failed =
    requestedResult.status === "rejected" ||
    approvedResult.status === "rejected";

  return {
    appointmentRequests: mergeOpenRequests(requested, approved),
    appointmentRequestsError: failed ? failedLoadMessage : "",
    appointmentRequestsLoading: false,
  };
}

export function useAppointmentRequestsQueue({
  enabled,
  appointmentsVersion,
  failedLoadMessage,
}: UseAppointmentRequestsQueueOptions) {
  const [queueState, dispatchQueueState] = useReducer(
    appointmentRequestsQueueReducer,
    undefined,
    createAppointmentRequestsQueueState,
  );
  const {
    appointmentRequests,
    appointmentRequestsLoading,
    appointmentRequestsError,
    reloadVersion,
  } = queueState;

  const setAppointmentRequestsError = useCallback(
    (nextValue: SetStateAction<string>) => {
      dispatchQueueState((current) => ({
        appointmentRequestsError:
          typeof nextValue === "function"
            ? nextValue(current.appointmentRequestsError)
            : nextValue,
      }));
    },
    [],
  );

  const reloadQueue = useCallback(() => {
    // A fresh read, never an in-flight GET started before the change.
    clearApiCache(APPOINTMENT_REQUESTS_PATH);
    dispatchQueueState((current) => ({ reloadVersion: current.reloadVersion + 1 }));
  }, []);

  useTaskRealtimeRefresh(reloadQueue, {
    enabled,
    busy: appointmentRequestsLoading,
    eventTypes: APPOINTMENT_REQUEST_QUEUE_EVENTS,
  });

  useEffect(() => {
    let active = true;

    if (!enabled) {
      dispatchQueueState({
        appointmentRequests: [],
        appointmentRequestsLoading: false,
        appointmentRequestsError: "",
      });
      return () => {
        active = false;
      };
    }

    async function loadRequests() {
      dispatchQueueState({
        appointmentRequestsLoading: true,
        appointmentRequestsError: "",
      });
      const [requestedResult, approvedResult] = await Promise.allSettled([
        apiFetch<AppointmentRequestItem[]>(
          `${APPOINTMENT_REQUESTS_PATH}?status=requested`,
        ),
        apiFetch<AppointmentRequestItem[]>(
          `${APPOINTMENT_REQUESTS_PATH}?status=approved`,
        ),
      ]);
      if (!active) return;
      dispatchQueueState((current) =>
        settleAppointmentRequestQueueResults(
          requestedResult,
          approvedResult,
          current.appointmentRequests,
          failedLoadMessage,
        ),
      );
    }

    void loadRequests();
    return () => {
      active = false;
    };
  }, [appointmentsVersion, enabled, failedLoadMessage, reloadVersion]);

  return {
    appointmentRequests,
    appointmentRequestsLoading,
    appointmentRequestsError,
    setAppointmentRequestsError,
  };
}
