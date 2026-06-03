import { startTransition, useEffect, useReducer } from "react";

import { apiFetch } from "@/lib/api";

import type {
  PatientAssignment,
  PatientDetail,
  StaffOption,
} from "../model/list-model";
import type {
  PatientCardEntry,
  PatientMedicalOrder,
  PatientRiskScore,
  PatientVitalMeasurement,
} from "../model/detail-resource-types";

type UsePatientDetailCoreDataArgs = {
  canManagePatientCardEntries: boolean;
  canManagePatientMedicalOrders: boolean;
  canManagePatientRiskScores: boolean;
  canManagePatientVitals: boolean;
  id: string | undefined;
  version: number;
};

type PatientDetailCoreDataState = {
  detail: PatientDetail | null;
  assignments: PatientAssignment[];
  staff: StaffOption[];
  vitalsHistory: PatientVitalMeasurement[];
  cardEntries: PatientCardEntry[];
  medicalOrders: PatientMedicalOrder[];
  riskScores: PatientRiskScore[];
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
      vitalsHistory: PatientVitalMeasurement[];
      cardEntries: PatientCardEntry[];
      medicalOrders: PatientMedicalOrder[];
      riskScores: PatientRiskScore[];
    }
  | { type: "error"; requestKey: string; message: string };

const EMPTY_PATIENT_DETAIL_CORE_DATA_STATE: PatientDetailCoreDataState = {
  detail: null,
  assignments: [],
  staff: [],
  vitalsHistory: [],
  cardEntries: [],
  medicalOrders: [],
  riskScores: [],
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
        vitalsHistory: action.vitalsHistory,
        cardEntries: action.cardEntries,
        medicalOrders: action.medicalOrders,
        riskScores: action.riskScores,
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
  canManagePatientCardEntries,
  canManagePatientMedicalOrders,
  canManagePatientRiskScores,
  canManagePatientVitals,
  id,
  version,
}: UsePatientDetailCoreDataArgs) {
  const [
    {
      detail,
      assignments,
      staff,
      vitalsHistory,
      cardEntries,
      medicalOrders,
      riskScores,
      coreError,
      settledKey,
    },
    dispatchCoreData,
  ] = useReducer(
    patientDetailCoreDataReducer,
    EMPTY_PATIENT_DETAIL_CORE_DATA_STATE,
  );

  const requestKey = id
    ? `${id}:${version}:${Number(canManagePatientVitals)}:${Number(
        canManagePatientCardEntries
      )}:${Number(canManagePatientMedicalOrders)}:${Number(canManagePatientRiskScores)}`
    : "";

  useEffect(() => {
    if (!requestKey || !id) return;

    const controller = new AbortController();
    const { signal } = controller;

    Promise.all([
      apiFetch<PatientDetail>(`/patients/${id}`, { signal }),
      apiFetch<PatientAssignment[]>(`/patients/${id}/assignments`, { signal }).catch(() => []),
      apiFetch<StaffOption[]>("/users?assignable_only=true&active_only=true", { signal }).catch(() => []),
      canManagePatientVitals
        ? apiFetch<{ items: PatientVitalMeasurement[] }>(`/patients/${id}/vitals`, { signal }).catch(() => ({
            items: [],
          }))
        : Promise.resolve({ items: [] as PatientVitalMeasurement[] }),
      canManagePatientCardEntries
        ? apiFetch<{ items: PatientCardEntry[] }>(`/patients/${id}/card-entries`, { signal }).catch(() => ({
            items: [],
          }))
        : Promise.resolve({ items: [] as PatientCardEntry[] }),
      canManagePatientMedicalOrders
        ? apiFetch<{ items: PatientMedicalOrder[] }>(`/patients/${id}/medical-orders`, { signal }).catch(() => ({
            items: [],
          }))
        : Promise.resolve({ items: [] as PatientMedicalOrder[] }),
      canManagePatientRiskScores
        ? apiFetch<{ items: PatientRiskScore[] }>(`/patients/${id}/risk-scores`, { signal }).catch(() => ({
            items: [],
          }))
        : Promise.resolve({ items: [] as PatientRiskScore[] }),
    ])
      .then(([nextDetail, nextAssignments, nextStaff, vitals, entries, nextMedicalOrders, nextRiskScores]) => {
        if (signal.aborted) return;
        startTransition(() => {
          dispatchCoreData({
            type: "success",
            requestKey,
            detail: nextDetail,
            assignments: nextAssignments,
            staff: nextStaff,
            vitalsHistory: patientDetailResourceItems(vitals),
            cardEntries: patientDetailResourceItems(entries),
            medicalOrders: patientDetailResourceItems(nextMedicalOrders),
            riskScores: patientDetailResourceItems(nextRiskScores),
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
  }, [
    canManagePatientCardEntries,
    canManagePatientMedicalOrders,
    canManagePatientRiskScores,
    canManagePatientVitals,
    id,
    requestKey,
  ]);

  const isSettled = settledKey === requestKey;

  return {
    assignments: isSettled ? assignments : [],
    cardEntries: isSettled ? cardEntries : [],
    coreError: isSettled ? coreError : "",
    detail: isSettled ? detail : null,
    loading: Boolean(requestKey) && !isSettled,
    medicalOrders: isSettled ? medicalOrders : [],
    riskScores: isSettled ? riskScores : [],
    staff: isSettled ? staff : [],
    vitalsHistory: isSettled ? vitalsHistory : [],
  };
}
