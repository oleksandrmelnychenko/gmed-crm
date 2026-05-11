import {
  useCallback,
  useEffect,
  useReducer,
  type SetStateAction,
} from "react";

import { assignPatient } from "../../data/patient-mutations";

type UsePatientDetailSheetSessionParams = {
  detailId?: string;
  detailOpen: boolean;
  failedAssignMessage: string;
  refreshDetail: () => void;
};

type PatientDetailSheetSessionState = {
  assignmentBusy: boolean;
  assignmentError: string;
  selectedAssignee: string;
};

type PatientDetailSheetSessionPatch =
  | Partial<PatientDetailSheetSessionState>
  | ((current: PatientDetailSheetSessionState) => Partial<PatientDetailSheetSessionState>);

function patientDetailSheetSessionReducer(
  state: PatientDetailSheetSessionState,
  patch: PatientDetailSheetSessionPatch,
): PatientDetailSheetSessionState {
  return {
    ...state,
    ...(typeof patch === "function" ? patch(state) : patch),
  };
}

export function usePatientDetailSheetSession({
  detailId,
  detailOpen,
  failedAssignMessage,
  refreshDetail,
}: UsePatientDetailSheetSessionParams) {
  const [sessionState, dispatchSessionState] = useReducer(
    patientDetailSheetSessionReducer,
    undefined,
    () => ({
      assignmentBusy: false,
      assignmentError: "",
      selectedAssignee: "",
    }),
  );
  const { assignmentBusy, assignmentError, selectedAssignee } = sessionState;

  const setSelectedAssignee = useCallback((nextValue: SetStateAction<string>) => {
    dispatchSessionState((current) => ({
      selectedAssignee:
        typeof nextValue === "function"
          ? nextValue(current.selectedAssignee)
          : nextValue,
    }));
  }, []);

  useEffect(() => {
    if (!detailOpen || !detailId) {
      dispatchSessionState({
        selectedAssignee: "",
        assignmentError: "",
      });
      return;
    }

    dispatchSessionState({ assignmentError: "" });
  }, [detailId, detailOpen]);

  const handleAssignPatient = useCallback(async () => {
    if (!detailId || !selectedAssignee) return;

    dispatchSessionState({
      assignmentBusy: true,
      assignmentError: "",
    });

    try {
      await assignPatient(detailId, selectedAssignee);
      dispatchSessionState({
        selectedAssignee: "",
        assignmentBusy: false,
      });
      refreshDetail();
    } catch (error) {
      dispatchSessionState({
        assignmentError:
          error instanceof Error ? error.message : failedAssignMessage,
        assignmentBusy: false,
      });
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
