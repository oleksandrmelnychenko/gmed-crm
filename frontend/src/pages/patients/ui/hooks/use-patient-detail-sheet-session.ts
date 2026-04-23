import { useCallback, useEffect, useState } from "react";

import { assignPatient } from "../../data/patient-mutations";

type UsePatientDetailSheetSessionParams = {
  detailId?: string;
  detailOpen: boolean;
  failedAssignMessage: string;
  refreshDetail: () => void;
};

export function usePatientDetailSheetSession({
  detailId,
  detailOpen,
  failedAssignMessage,
  refreshDetail,
}: UsePatientDetailSheetSessionParams) {
  const [assignmentBusy, setAssignmentBusy] = useState(false);
  const [assignmentError, setAssignmentError] = useState("");
  const [selectedAssignee, setSelectedAssignee] = useState("");

  useEffect(() => {
    if (!detailOpen || !detailId) {
      setSelectedAssignee("");
      setAssignmentError("");
      return;
    }

    setAssignmentError("");
  }, [detailId, detailOpen]);

  const handleAssignPatient = useCallback(async () => {
    if (!detailId || !selectedAssignee) return;

    setAssignmentBusy(true);
    setAssignmentError("");

    try {
      await assignPatient(detailId, selectedAssignee);
      setSelectedAssignee("");
      refreshDetail();
    } catch (error) {
      setAssignmentError(
        error instanceof Error ? error.message : failedAssignMessage,
      );
    } finally {
      setAssignmentBusy(false);
    }
  }, [detailId, failedAssignMessage, refreshDetail, selectedAssignee]);

  return {
    assignmentBusy,
    assignmentError,
    handleAssignPatient,
    selectedAssignee,
    setSelectedAssignee,
  };
}
