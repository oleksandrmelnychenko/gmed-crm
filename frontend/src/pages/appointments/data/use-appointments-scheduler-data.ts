import { useEffect, useState } from "react";

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

export function useAppointmentsSchedulerData({
  appointmentsQuery,
  attentionQuery,
  appointmentsVersion,
  failedLoadMessage,
}: UseAppointmentsSchedulerDataOptions) {
  const [appointments, setAppointments] = useState<AppointmentListItem[]>([]);
  const [attentionItems, setAttentionItems] = useState<
    AppointmentAttentionItem[]
  >([]);
  const [appointmentsLoading, setAppointmentsLoading] = useState(true);
  const [appointmentsError, setAppointmentsError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadAppointments() {
      setAppointmentsLoading(true);
      setAppointmentsError("");
      try {
        const [rows, attention] = await Promise.all([
          apiFetch<AppointmentListItem[]>(appointmentsQuery),
          apiFetch<AppointmentAttentionItem[]>(attentionQuery),
        ]);
        if (!active) return;
        setAppointments(rows);
        setAttentionItems(attention);
      } catch (error) {
        if (!active) return;
        setAppointments([]);
        setAttentionItems([]);
        setAppointmentsError(
          error instanceof Error ? error.message : failedLoadMessage,
        );
      } finally {
        if (active) setAppointmentsLoading(false);
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
    appointments,
    attentionItems,
    appointmentsLoading,
    appointmentsError,
    setAppointmentsError,
  };
}
