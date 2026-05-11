import {
  useCallback,
  useEffect,
  useReducer,
  type SetStateAction,
} from "react";

import { apiFetch } from "@/lib/api";
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
};

type AppointmentRequestsQueuePatch =
  | Partial<AppointmentRequestsQueueState>
  | ((current: AppointmentRequestsQueueState) => Partial<AppointmentRequestsQueueState>);

function createAppointmentRequestsQueueState(): AppointmentRequestsQueueState {
  return {
    appointmentRequests: [],
    appointmentRequestsLoading: false,
    appointmentRequestsError: "",
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

  useEffect(() => {
    let active = true;

    if (!enabled) {
      dispatchQueueState(createAppointmentRequestsQueueState());
      return () => {
        active = false;
      };
    }

    async function loadRequests() {
      dispatchQueueState({
        appointmentRequestsLoading: true,
        appointmentRequestsError: "",
      });
      try {
        const [requested, approved] = await Promise.all([
          apiFetch<AppointmentRequestItem[]>(
            "/appointments/requests?status=requested",
          ),
          apiFetch<AppointmentRequestItem[]>(
            "/appointments/requests?status=approved",
          ),
        ]);
        if (!active) return;
        dispatchQueueState({
          appointmentRequests: mergeOpenRequests(requested, approved),
          appointmentRequestsLoading: false,
        });
      } catch (error) {
        if (!active) return;
        dispatchQueueState({
          appointmentRequests: [],
          appointmentRequestsError:
            error instanceof Error ? error.message : failedLoadMessage,
          appointmentRequestsLoading: false,
        });
      }
    }

    void loadRequests();
    return () => {
      active = false;
    };
  }, [appointmentsVersion, enabled, failedLoadMessage]);

  return {
    appointmentRequests,
    appointmentRequestsLoading,
    appointmentRequestsError,
    setAppointmentRequestsError,
  };
}
