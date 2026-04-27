import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import type {
  AppointmentRequestItem,
} from "@/pages/appointments/model/types";

type UseAppointmentRequestsQueueOptions = {
  enabled: boolean;
  appointmentsVersion: number;
  failedLoadMessage: string;
};

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
  const [appointmentRequests, setAppointmentRequests] = useState<
    AppointmentRequestItem[]
  >([]);
  const [appointmentRequestsLoading, setAppointmentRequestsLoading] =
    useState(false);
  const [appointmentRequestsError, setAppointmentRequestsError] = useState("");

  useEffect(() => {
    let active = true;

    if (!enabled) {
      setAppointmentRequests([]);
      setAppointmentRequestsLoading(false);
      setAppointmentRequestsError("");
      return () => {
        active = false;
      };
    }

    async function loadRequests() {
      setAppointmentRequestsLoading(true);
      setAppointmentRequestsError("");
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
        setAppointmentRequests(mergeOpenRequests(requested, approved));
      } catch (error) {
        if (!active) return;
        setAppointmentRequests([]);
        setAppointmentRequestsError(
          error instanceof Error ? error.message : failedLoadMessage,
        );
      } finally {
        if (active) setAppointmentRequestsLoading(false);
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
