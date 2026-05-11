import {
  useCallback,
  useEffect,
  useReducer,
  type SetStateAction,
} from "react";

import { assignLinkedPatient } from "@/pages/appointments/data/appointment-mutations";

type UseAppointmentLinkedPatientAssignmentOptions = {
  linkedPatientDetailId: string | null;
  failedAssignMessage: string;
  onAssigned: () => void;
};

type LinkedPatientAssignmentState = {
  linkedPatientSelectedAssignee: string;
  linkedPatientAssignmentBusy: boolean;
  linkedPatientAssignmentError: string;
};

type LinkedPatientAssignmentPatch =
  | Partial<LinkedPatientAssignmentState>
  | ((current: LinkedPatientAssignmentState) => Partial<LinkedPatientAssignmentState>);

function createLinkedPatientAssignmentState(): LinkedPatientAssignmentState {
  return {
    linkedPatientSelectedAssignee: "",
    linkedPatientAssignmentBusy: false,
    linkedPatientAssignmentError: "",
  };
}

function linkedPatientAssignmentReducer(
  state: LinkedPatientAssignmentState,
  patch: LinkedPatientAssignmentPatch,
): LinkedPatientAssignmentState {
  return {
    ...state,
    ...(typeof patch === "function" ? patch(state) : patch),
  };
}

export function useAppointmentLinkedPatientAssignment({
  linkedPatientDetailId,
  failedAssignMessage,
  onAssigned,
}: UseAppointmentLinkedPatientAssignmentOptions) {
  const [assignmentState, dispatchAssignmentState] = useReducer(
    linkedPatientAssignmentReducer,
    undefined,
    createLinkedPatientAssignmentState,
  );
  const {
    linkedPatientSelectedAssignee,
    linkedPatientAssignmentBusy,
    linkedPatientAssignmentError,
  } = assignmentState;

  const setLinkedPatientSelectedAssignee = useCallback(
    (nextValue: SetStateAction<string>) => {
      dispatchAssignmentState((current) => ({
        linkedPatientSelectedAssignee:
          typeof nextValue === "function"
            ? nextValue(current.linkedPatientSelectedAssignee)
            : nextValue,
      }));
    },
    [],
  );

  const resetLinkedPatientAssignmentState = useCallback(() => {
    dispatchAssignmentState(createLinkedPatientAssignmentState());
  }, []);

  useEffect(() => {
    if (linkedPatientDetailId) return;
    resetLinkedPatientAssignmentState();
  }, [linkedPatientDetailId, resetLinkedPatientAssignmentState]);

  const handleAssignLinkedPatient = useCallback(async () => {
    if (!linkedPatientDetailId || !linkedPatientSelectedAssignee) return;

    dispatchAssignmentState({
      linkedPatientAssignmentBusy: true,
      linkedPatientAssignmentError: "",
    });

    try {
      await assignLinkedPatient(
        linkedPatientDetailId,
        linkedPatientSelectedAssignee,
      );
      dispatchAssignmentState({ linkedPatientSelectedAssignee: "" });
      onAssigned();
    } catch (error) {
      dispatchAssignmentState({
        linkedPatientAssignmentError:
          error instanceof Error ? error.message : failedAssignMessage,
      });
    } finally {
      dispatchAssignmentState({ linkedPatientAssignmentBusy: false });
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
