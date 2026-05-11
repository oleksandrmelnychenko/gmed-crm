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
};

type SchedulerState = {
  appointments: AppointmentListItem[];
  attentionItems: AppointmentAttentionItem[];
  appointmentsLoading: boolean;
  appointmentsError: string;
};

const INITIAL_SCHEDULER_STATE: SchedulerState = {
  appointments: [],
  attentionItems: [],
  appointmentsLoading: true,
  appointmentsError: "",
};

function schedulerReducer(
  state: SchedulerState,
  patch: Partial<SchedulerState>,
) {
  return { ...state, ...patch };
}

export function useAppointmentsSchedulerData({
  appointmentsQuery,
  attentionQuery,
  appointmentsVersion,
  failedLoadMessage,
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
      });
      try {
        const [rows, attention] = await Promise.all([
          apiFetch<AppointmentListItem[]>(appointmentsQuery),
          apiFetch<AppointmentAttentionItem[]>(attentionQuery),
        ]);
        if (!active) return;
        dispatchSchedulerState({
          appointments: rows,
          attentionItems: attention,
          appointmentsLoading: false,
          appointmentsError: "",
        });
      } catch (error) {
        if (!active) return;
        dispatchSchedulerState({
          appointments: [],
          attentionItems: [],
          appointmentsLoading: false,
          appointmentsError:
            error instanceof Error ? error.message : failedLoadMessage,
        });
      }
    }

    void loadAppointments();
    return () => {
      active = false;
    };
  }, [
    appointmentsQuery,
    attentionQuery,
    appointmentsVersion,
    failedLoadMessage,
  ]);

  return {
    appointments: schedulerState.appointments,
    attentionItems: schedulerState.attentionItems,
    appointmentsLoading: schedulerState.appointmentsLoading,
    appointmentsError: schedulerState.appointmentsError,
    setAppointmentsError,
  };
}
