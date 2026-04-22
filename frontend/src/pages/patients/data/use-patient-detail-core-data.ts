import { startTransition, useEffect, useState } from "react";

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

export function usePatientDetailCoreData({
  canManagePatientCardEntries,
  canManagePatientMedicalOrders,
  canManagePatientRiskScores,
  canManagePatientVitals,
  id,
  version,
}: UsePatientDetailCoreDataArgs) {
  const [detail, setDetail] = useState<PatientDetail | null>(null);
  const [assignments, setAssignments] = useState<PatientAssignment[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [vitalsHistory, setVitalsHistory] = useState<PatientVitalMeasurement[]>([]);
  const [cardEntries, setCardEntries] = useState<PatientCardEntry[]>([]);
  const [medicalOrders, setMedicalOrders] = useState<PatientMedicalOrder[]>([]);
  const [riskScores, setRiskScores] = useState<PatientRiskScore[]>([]);
  const [coreError, setCoreError] = useState("");
  const [settledKey, setSettledKey] = useState("");

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
          setAssignments(nextAssignments);
          setCardEntries(entries.items ?? []);
          setCoreError("");
          setDetail(nextDetail);
          setMedicalOrders(nextMedicalOrders.items ?? []);
          setRiskScores(nextRiskScores.items ?? []);
          setSettledKey(requestKey);
          setStaff(nextStaff);
          setVitalsHistory(vitals.items ?? []);
        });
      })
      .catch((error: unknown) => {
        if (signal.aborted) return;
        startTransition(() => {
          setAssignments([]);
          setCardEntries([]);
          setCoreError(error instanceof Error ? error.message : String(error));
          setDetail(null);
          setMedicalOrders([]);
          setRiskScores([]);
          setSettledKey(requestKey);
          setStaff([]);
          setVitalsHistory([]);
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
