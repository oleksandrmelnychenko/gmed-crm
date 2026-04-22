import { startTransition, useEffect, useState } from "react";

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

export function usePatientDetailSheetData({
  commonFailedLoad,
  detailOpen,
  detailVersion,
  permissions,
  selectedId,
}: UsePatientDetailSheetDataArgs) {
  const [detail, setDetail] = useState<PatientDetail | null>(null);
  const [detailError, setDetailError] = useState("");
  const [assignments, setAssignments] = useState<PatientAssignment[]>([]);
  const [settledKey, setSettledKey] = useState("");
  const [staff, setStaff] = useState<StaffOption[]>([]);
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
      ? apiFetch<StaffOption[]>("/appointments/meta/staff").catch(() => [])
      : Promise.resolve([] as StaffOption[]);

    void Promise.all([detailPromise, assignmentsPromise, staffPromise])
      .then(([patientDetail, assignmentItems, staffItems]) => {
        if (cancelled) return;
        startTransition(() => {
          setDetail(patientDetail);
          setAssignments(assignmentItems);
          setDetailError("");
          setSettledKey(requestKey);
          setStaff(staffItems);
        });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          startTransition(() => {
            setAssignments([]);
            setDetail(null);
            setDetailError(error instanceof Error ? error.message : commonFailedLoad);
            setSettledKey(requestKey);
            setStaff([]);
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
