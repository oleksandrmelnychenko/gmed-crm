import { startTransition, useEffect, useReducer } from "react";

import { apiFetch } from "@/lib/api";

import type {
  PatientAssignment,
  PatientDetail,
  StaffOption,
} from "../model/list-model";

type UsePatientDetailCoreDataArgs = {
  id: string | undefined;
  version: number;
};

type PatientDetailCoreDataState = {
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
      detail: PatientDetail;
      assignments: PatientAssignment[];
      staff: StaffOption[];
    }
  | { type: "error"; requestKey: string; message: string };

const EMPTY_PATIENT_DETAIL_CORE_DATA_STATE: PatientDetailCoreDataState = {
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

function patientDetailCoreDataReducer(
  state: PatientDetailCoreDataState,
  action: PatientDetailCoreDataAction,
): PatientDetailCoreDataState {
  switch (action.type) {
    case "success":
      return {
        detail: action.detail,
        assignments: action.assignments,
        staff: action.staff,
        coreError: "",
        settledKey: action.requestKey,
      };
    case "error":
      return {
        ...EMPTY_PATIENT_DETAIL_CORE_DATA_STATE,
        coreError: action.message,
        settledKey: action.requestKey,
      };
    default:
      return state;
  }
}

export function usePatientDetailCoreData({
  id,
  version,
}: UsePatientDetailCoreDataArgs) {
  const [
    { detail, assignments, staff, coreError, settledKey },
    dispatchCoreData,
  ] = useReducer(
    patientDetailCoreDataReducer,
    EMPTY_PATIENT_DETAIL_CORE_DATA_STATE,
  );

  const requestKey = id ? `${id}:${version}` : "";

  useEffect(() => {
    if (!requestKey || !id) return;

    const controller = new AbortController();
    const { signal } = controller;

    Promise.all([
      apiFetch<PatientDetail>(`/patients/${id}`, { signal }),
      apiFetch<PatientAssignment[]>(`/patients/${id}/assignments`, { signal }).catch(() => []),
      apiFetch<StaffOption[]>("/users?assignable_only=true&active_only=true", { signal }).catch(() => []),
    ])
      .then(([nextDetail, nextAssignments, nextStaff]) => {
        if (signal.aborted) return;
        startTransition(() => {
          dispatchCoreData({
            type: "success",
            requestKey,
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
            message: error instanceof Error ? error.message : String(error),
          });
        });
      });

    return () => {
      controller.abort();
    };
  }, [id, requestKey]);

  const isSettled = settledKey === requestKey;

  return {
    assignments: isSettled ? assignments : [],
    coreError: isSettled ? coreError : "",
    detail: isSettled ? detail : null,
    loading: Boolean(requestKey) && !isSettled,
    staff: isSettled ? staff : [],
  };
}
