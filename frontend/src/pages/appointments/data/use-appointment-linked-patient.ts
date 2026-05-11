import { useCallback, useEffect, useReducer } from "react";

import { apiFetch } from "@/lib/api";
import {
  type PatientAssignment as PatientSheetAssignment,
  type PatientDetail as PatientSheetDetail,
  type StaffOption as PatientSheetStaffOption,
} from "@/pages/patients";

type UseAppointmentLinkedPatientOptions = {
  linkedPatientOpen: boolean;
  linkedPatientId: string;
  linkedPatientVersion: number;
  canViewAssignments: boolean;
  canManageAssignments: boolean;
  failedLoadMessage: string;
};

type LinkedPatientState = {
  linkedPatientDetailLoading: boolean;
  linkedPatientDetailError: string;
  linkedPatientDetail: PatientSheetDetail | null;
  linkedPatientAssignments: PatientSheetAssignment[];
  linkedPatientAssignableStaff: PatientSheetStaffOption[];
};

type LinkedPatientPatch =
  | Partial<LinkedPatientState>
  | ((current: LinkedPatientState) => Partial<LinkedPatientState>);

function createLinkedPatientState(): LinkedPatientState {
  return {
    linkedPatientDetailLoading: false,
    linkedPatientDetailError: "",
    linkedPatientDetail: null,
    linkedPatientAssignments: [],
    linkedPatientAssignableStaff: [],
  };
}

function linkedPatientReducer(
  state: LinkedPatientState,
  patch: LinkedPatientPatch,
): LinkedPatientState {
  return {
    ...state,
    ...(typeof patch === "function" ? patch(state) : patch),
  };
}

export function useAppointmentLinkedPatient({
  linkedPatientOpen,
  linkedPatientId,
  linkedPatientVersion,
  canViewAssignments,
  canManageAssignments,
  failedLoadMessage,
}: UseAppointmentLinkedPatientOptions) {
  const [linkedPatientState, dispatchLinkedPatientState] = useReducer(
    linkedPatientReducer,
    undefined,
    createLinkedPatientState,
  );
  const {
    linkedPatientDetailLoading,
    linkedPatientDetailError,
    linkedPatientDetail,
    linkedPatientAssignments,
    linkedPatientAssignableStaff,
  } = linkedPatientState;

  const resetLinkedPatientState = useCallback(() => {
    dispatchLinkedPatientState(createLinkedPatientState());
  }, []);

  useEffect(() => {
    if (linkedPatientOpen && linkedPatientId) return;
    resetLinkedPatientState();
  }, [linkedPatientId, linkedPatientOpen, resetLinkedPatientState]);

  useEffect(() => {
    if (!linkedPatientOpen || !linkedPatientId) return;

    let active = true;
    void (async () => {
      dispatchLinkedPatientState({
        linkedPatientDetailLoading: true,
        linkedPatientDetailError: "",
      });

      const detailRequest = apiFetch<PatientSheetDetail>(
        `/patients/${linkedPatientId}`,
      );
      const assignmentsRequest = canViewAssignments
        ? apiFetch<PatientSheetAssignment[]>(
            `/patients/${linkedPatientId}/assignments`,
          ).catch(() => [])
        : Promise.resolve([] as PatientSheetAssignment[]);
      const staffRequest = canManageAssignments
        ? apiFetch<PatientSheetStaffOption[]>("/appointments/meta/staff").catch(
            () => [],
          )
        : Promise.resolve([] as PatientSheetStaffOption[]);

      try {
        const [patientDetail, assignments, assignableStaff] = await Promise.all([
          detailRequest,
          assignmentsRequest,
          staffRequest,
        ]);
        if (!active) return;
        dispatchLinkedPatientState({
          linkedPatientDetail: patientDetail,
          linkedPatientAssignments: assignments,
          linkedPatientAssignableStaff: assignableStaff,
          linkedPatientDetailLoading: false,
        });
      } catch (error) {
        if (!active) return;
        dispatchLinkedPatientState({
          linkedPatientDetail: null,
          linkedPatientAssignments: [],
          linkedPatientAssignableStaff: [],
          linkedPatientDetailError:
            error instanceof Error ? error.message : failedLoadMessage,
          linkedPatientDetailLoading: false,
        });
      }
    })();

    return () => {
      active = false;
    };
  }, [
    canManageAssignments,
    canViewAssignments,
    failedLoadMessage,
    linkedPatientId,
    linkedPatientOpen,
    linkedPatientVersion,
  ]);

  return {
    linkedPatientDetailLoading,
    linkedPatientDetailError,
    linkedPatientDetail,
    linkedPatientAssignments,
    linkedPatientAssignableStaff,
  };
}
