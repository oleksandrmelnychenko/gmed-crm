import { startTransition, useEffect, useReducer } from "react";

import { apiFetch } from "@/lib/api";

import type {
  PatientAssignment,
  PatientDetail,
  StaffOption,
} from "../model/list-model";

type UsePatientDetailSheetDataArgs = {
  commonFailedLoad: string;
  detailOpen: boolean;
  detailVersion: number;
  permissions: {
    canManageAssignments: boolean;
    canViewAssignments: boolean;
  };
  selectedId: string;
};

const PATIENT_DETAIL_SHEET_META_CACHE_TTL_MS = 60_000;

type PatientDetailSheetDataState = {
  detail: PatientDetail | null;
  detailError: string;
  assignments: PatientAssignment[];
  settledKey: string;
  staff: StaffOption[];
};

type PatientDetailSheetDataAction =
  | {
      type: "success";
      detail: PatientDetail;
      assignments: PatientAssignment[];
      requestKey: string;
      staff: StaffOption[];
    }
  | { type: "error"; message: string; requestKey: string };

const EMPTY_PATIENT_DETAIL_SHEET_DATA_STATE: PatientDetailSheetDataState = {
  detail: null,
  detailError: "",
  assignments: [],
  settledKey: "",
  staff: [],
};

function patientDetailSheetDataReducer(
  state: PatientDetailSheetDataState,
  action: PatientDetailSheetDataAction,
): PatientDetailSheetDataState {
  switch (action.type) {
    case "success":
      return {
        detail: action.detail,
        detailError: "",
        assignments: action.assignments,
        settledKey: action.requestKey,
        staff: action.staff,
      };
    case "error":
      return {
        detail: null,
        detailError: action.message,
        assignments: [],
        settledKey: action.requestKey,
        staff: [],
      };
    default:
      return state;
  }
}

export function usePatientDetailSheetData({
  commonFailedLoad,
  detailOpen,
  detailVersion,
  permissions,
  selectedId,
}: UsePatientDetailSheetDataArgs) {
  const [{ detail, detailError, assignments, settledKey, staff }, dispatchSheetData] =
    useReducer(
      patientDetailSheetDataReducer,
      EMPTY_PATIENT_DETAIL_SHEET_DATA_STATE,
    );
  const requestKey =
    detailOpen && selectedId
      ? `${selectedId}:${detailVersion}:${Number(permissions.canViewAssignments)}:${Number(
          permissions.canManageAssignments
        )}`
      : "";

  useEffect(() => {
    if (!requestKey) return;

    let cancelled = false;

    const detailPromise = apiFetch<PatientDetail>(`/patients/${selectedId}`);
    const assignmentsPromise = permissions.canViewAssignments
      ? apiFetch<PatientAssignment[]>(`/patients/${selectedId}/assignments`).catch(() => [])
      : Promise.resolve([] as PatientAssignment[]);
    const staffPromise = permissions.canManageAssignments
      ? apiFetch<StaffOption[]>("/appointments/meta/staff", {
          cacheTtlMs: PATIENT_DETAIL_SHEET_META_CACHE_TTL_MS,
        }).catch(() => [])
      : Promise.resolve([] as StaffOption[]);

    void Promise.all([detailPromise, assignmentsPromise, staffPromise])
      .then(([patientDetail, assignmentItems, staffItems]) => {
        if (cancelled) return;
        startTransition(() => {
          dispatchSheetData({
            type: "success",
            detail: patientDetail,
            assignments: assignmentItems,
            requestKey,
            staff: staffItems,
          });
        });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          startTransition(() => {
            dispatchSheetData({
              type: "error",
              message: error instanceof Error ? error.message : commonFailedLoad,
              requestKey,
            });
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    commonFailedLoad,
    permissions.canManageAssignments,
    permissions.canViewAssignments,
    requestKey,
    selectedId,
  ]);

  return {
    assignments: requestKey && settledKey === requestKey ? assignments : [],
    detail: requestKey && settledKey === requestKey ? detail : null,
    detailBusy: Boolean(requestKey) && settledKey !== requestKey,
    detailError: requestKey && settledKey === requestKey ? detailError : "",
    staff: requestKey && settledKey === requestKey ? staff : [],
  };
}
