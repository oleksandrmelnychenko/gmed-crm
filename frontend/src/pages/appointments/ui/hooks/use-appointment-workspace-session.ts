import { startTransition, useCallback, useState } from "react";

export function useAppointmentWorkspaceSession() {
  const [appointmentsNotice, setAppointmentsNotice] = useState("");
  const [appointmentsVersion, setAppointmentsVersion] = useState(0);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [detailVersion, setDetailVersion] = useState(0);
  const [followUpAssigneeId, setFollowUpAssigneeId] = useState("");

  const bumpAppointmentsVersion = useCallback(() => {
    startTransition(() => setAppointmentsVersion((current) => current + 1));
  }, []);

  const bumpDetailVersion = useCallback(() => {
    startTransition(() => {
      setDetailVersion((current) => current + 1);
      setAppointmentsVersion((current) => current + 1);
    });
  }, []);

  const reportAppointmentsNotice = useCallback((notice: string) => {
    setAppointmentsNotice(notice);
  }, []);

  return {
    appointmentsNotice,
    appointmentsVersion,
    detailOpen,
    setDetailOpen,
    selectedId,
    setSelectedId,
    detailVersion,
    followUpAssigneeId,
    setFollowUpAssigneeId,
    bumpAppointmentsVersion,
    bumpDetailVersion,
    reportAppointmentsNotice,
  };
}
