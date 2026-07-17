import { useCallback, useEffect, useReducer } from "react";

import { apiFetch } from "@/lib/api";
import type {
  AppointmentAttentionItem,
  AppointmentListItem,
} from "@/pages/appointments/model/types";

type UseAppointmentsSchedulerDataOptions = {
  appointmentsQuery: string;
  attentionQuery: string;
  appointmentsVersion: number;
  failedLoadMessage: string;
  attentionFailedMessage: string;
};

type SchedulerState = {
  appointments: AppointmentListItem[];
  attentionItems: AppointmentAttentionItem[];
  appointmentsLoading: boolean;
  appointmentsError: string;
  attentionError: string;
};

const INITIAL_SCHEDULER_STATE: SchedulerState = {
  appointments: [],
  attentionItems: [],
  appointmentsLoading: true,
  appointmentsError: "",
  attentionError: "",
};

function schedulerReducer(
  state: SchedulerState,
  patch: Partial<SchedulerState>,
) {
  return { ...state, ...patch };
}

export function settleAppointmentsSchedulerResults(
  rowsResult: PromiseSettledResult<AppointmentListItem[]>,
  attentionResult: PromiseSettledResult<AppointmentAttentionItem[]>,
  failedLoadMessage: string,
  attentionFailedMessage: string,
): Partial<SchedulerState> {
  const patch: Partial<SchedulerState> = {
    appointmentsLoading: false,
    appointmentsError:
      rowsResult.status === "rejected"
        ? failedLoadMessage
        : "",
    attentionError:
      attentionResult.status === "rejected"
        ? attentionFailedMessage
        : "",
  };

  if (rowsResult.status === "fulfilled") {
    patch.appointments = rowsResult.value;
  }
  if (attentionResult.status === "fulfilled") {
    patch.attentionItems = attentionResult.value;
  }

  return patch;
}

export function useAppointmentsSchedulerData({
  appointmentsQuery,
  attentionQuery,
  appointmentsVersion,
  failedLoadMessage,
  attentionFailedMessage,
}: UseAppointmentsSchedulerDataOptions) {
  const [schedulerState, dispatchSchedulerState] = useReducer(
    schedulerReducer,
    INITIAL_SCHEDULER_STATE,
  );

  const setAppointmentsError = useCallback((appointmentsError: string) => {
    dispatchSchedulerState({ appointmentsError });
  }, []);

  useEffect(() => {
    let active = true;

    async function loadAppointments() {
      dispatchSchedulerState({
        appointmentsLoading: true,
        appointmentsError: "",
        attentionError: "",
      });
      const [rowsResult, attentionResult] = await Promise.allSettled([
        apiFetch<AppointmentListItem[]>(appointmentsQuery),
        apiFetch<AppointmentAttentionItem[]>(attentionQuery),
      ]);
      if (!active) return;
      dispatchSchedulerState(
        settleAppointmentsSchedulerResults(
          rowsResult,
          attentionResult,
          failedLoadMessage,
          attentionFailedMessage,
        ),
      );
    }

    void loadAppointments();
    return () => {
      active = false;
    };
  }, [
    appointmentsQuery,
    attentionQuery,
    appointmentsVersion,
    attentionFailedMessage,
    failedLoadMessage,
  ]);

  return {
    appointments: schedulerState.appointments,
    attentionItems: schedulerState.attentionItems,
    appointmentsLoading: schedulerState.appointmentsLoading,
    appointmentsError: schedulerState.appointmentsError,
    appointmentsAuxiliaryError: schedulerState.attentionError,
    setAppointmentsError,
  };
}
