import { useCallback, useEffect, useState } from "react";

import { assignLinkedPatient } from "@/pages/appointments/data/appointment-mutations";

type UseAppointmentLinkedPatientAssignmentOptions = {
  linkedPatientDetailId: string | null;
  failedAssignMessage: string;
  onAssigned: () => void;
};

export function useAppointmentLinkedPatientAssignment({
  linkedPatientDetailId,
  failedAssignMessage,
  onAssigned,
}: UseAppointmentLinkedPatientAssignmentOptions) {
  const [linkedPatientSelectedAssignee, setLinkedPatientSelectedAssignee] =
    useState("");
  const [linkedPatientAssignmentBusy, setLinkedPatientAssignmentBusy] =
    useState(false);
  const [linkedPatientAssignmentError, setLinkedPatientAssignmentError] =
    useState("");

  const resetLinkedPatientAssignmentState = useCallback(() => {
    setLinkedPatientSelectedAssignee("");
    setLinkedPatientAssignmentBusy(false);
    setLinkedPatientAssignmentError("");
  }, []);

  useEffect(() => {
    if (linkedPatientDetailId) return;
    resetLinkedPatientAssignmentState();
  }, [linkedPatientDetailId, resetLinkedPatientAssignmentState]);

  const handleAssignLinkedPatient = useCallback(async () => {
    if (!linkedPatientDetailId || !linkedPatientSelectedAssignee) return;

    setLinkedPatientAssignmentBusy(true);
    setLinkedPatientAssignmentError("");

    try {
      await assignLinkedPatient(
        linkedPatientDetailId,
        linkedPatientSelectedAssignee,
      );
      setLinkedPatientSelectedAssignee("");
      onAssigned();
    } catch (error) {
      setLinkedPatientAssignmentError(
        error instanceof Error ? error.message : failedAssignMessage,
      );
    } finally {
      setLinkedPatientAssignmentBusy(false);
    }
  }, [
    failedAssignMessage,
    linkedPatientDetailId,
    linkedPatientSelectedAssignee,
    onAssigned,
  ]);

  return {
    linkedPatientSelectedAssignee,
    setLinkedPatientSelectedAssignee,
    linkedPatientAssignmentBusy,
    linkedPatientAssignmentError,
    handleAssignLinkedPatient,
  };
}
