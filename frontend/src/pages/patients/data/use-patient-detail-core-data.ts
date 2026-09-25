import { startTransition, useEffect, useReducer } from "react";

import { apiFetch } from "@/lib/api";

import type {
  PatientAssignment,
  PatientDetail,
  StaffOption,
} from "../model/list-model";

type UsePatientDetailCoreDataArgs = {
  /** Only roles the server admits to `/patients/{id}/assignments`. */
  canViewAssignments: boolean;
  /** `/users` requires `users.view`; other roles would only get a 403. */
  canLoadAssignableStaff: boolean;
  id: string | undefined;
  version: number;
};

type PatientDetailCoreDataState = {
  patientId: string;
  detail: PatientDetail | null;
  assignments: PatientAssignment[];
  staff: StaffOption[];
  coreError: string;
  settledKey: string;
};

type PatientDetailCoreDataAction =
  | {
      type: "success";
      requestKey: string;
      patientId: string;
      detail: PatientDetail;
      assignments: PatientAssignment[];
      staff: StaffOption[];
    }
  | { type: "error"; requestKey: string; patientId: string; message: string };

const EMPTY_PATIENT_DETAIL_CORE_DATA_STATE: PatientDetailCoreDataState = {
  patientId: "",
  detail: null,
  assignments: [],
  staff: [],
  coreError: "",
  settledKey: "",
};

export function patientDetailResourceItems<T>(
  resource: { items?: T[] | null } | null | undefined,
) {
  return Array.isArray(resource?.items) ? resource.items : [];
}

export function patientDetailCoreDataPresentation(
  requestedPatientId: string | undefined,
  loadedPatientId: string,
  hasDetail: boolean,
  requestKey: string,
  settledKey: string,
) {
  const isSettled = settledKey === requestKey;
  const hasCurrentPatientData = Boolean(
    requestedPatientId && loadedPatientId === requestedPatientId && hasDetail,
  );
  return {
    hasCurrentPatientData,
    isSettled,
    loading: Boolean(requestKey) && !isSettled && !hasCurrentPatientData,
  };
}

function patientDetailCoreDataReducer(
  state: PatientDetailCoreDataState,
  action: PatientDetailCoreDataAction,
): PatientDetailCoreDataState {
  switch (action.type) {
    case "success":
      return {
        patientId: action.patientId,
        detail: action.detail,
        assignments: action.assignments,
        staff: action.staff,
        coreError: "",
        settledKey: action.requestKey,
      };
    case "error":
      if (state.patientId === action.patientId && state.detail) {
        return {
          ...state,
          coreError: action.message,
          settledKey: action.requestKey,
        };
      }
      return {
        ...EMPTY_PATIENT_DETAIL_CORE_DATA_STATE,
        patientId: action.patientId,
        coreError: action.message,
        settledKey: action.requestKey,
      };
    default:
      return state;
  }
}

export function usePatientDetailCoreData({
  canLoadAssignableStaff,
  canViewAssignments,
  id,
  version,
}: UsePatientDetailCoreDataArgs) {
  const [
    { patientId: loadedPatientId, detail, assignments, staff, coreError, settledKey },
    dispatchCoreData,
  ] = useReducer(
    patientDetailCoreDataReducer,
    EMPTY_PATIENT_DETAIL_CORE_DATA_STATE,
  );

  const requestKey = id
    ? `${id}:${version}:${Number(canViewAssignments)}:${Number(canLoadAssignableStaff)}`
    : "";

  useEffect(() => {
    if (!requestKey || !id) return;

    const controller = new AbortController();
    const { signal } = controller;

    Promise.all([
      apiFetch<PatientDetail>(`/patients/${id}`, { signal }),
      canViewAssignments
        ? apiFetch<PatientAssignment[]>(`/patients/${id}/assignments`, { signal }).catch(() => [])
        : Promise.resolve([] as PatientAssignment[]),
      canLoadAssignableStaff
        ? apiFetch<StaffOption[]>("/users?assignable_only=true&active_only=true", { signal }).catch(() => [])
        : Promise.resolve([] as StaffOption[]),
    ])
      .then(([nextDetail, nextAssignments, nextStaff]) => {
        if (signal.aborted) return;
        startTransition(() => {
          dispatchCoreData({
            type: "success",
            requestKey,
            patientId: id,
            detail: nextDetail,
            assignments: nextAssignments,
            staff: nextStaff,
          });
        });
      })
      .catch((error: unknown) => {
        if (signal.aborted) return;
        startTransition(() => {
          dispatchCoreData({
            type: "error",
            requestKey,
            patientId: id,
            message: error instanceof Error ? error.message : String(error),
          });
        });
      });

    return () => {
      controller.abort();
    };
  }, [canLoadAssignableStaff, canViewAssignments, id, requestKey]);

  const { hasCurrentPatientData, isSettled, loading } =
    patientDetailCoreDataPresentation(
      id,
      loadedPatientId,
      detail !== null,
      requestKey,
      settledKey,
    );

  return {
    assignments: hasCurrentPatientData ? assignments : [],
    coreError: isSettled ? coreError : "",
    detail: hasCurrentPatientData ? detail : null,
    loading,
    staff: hasCurrentPatientData ? staff : [],
  };
}
