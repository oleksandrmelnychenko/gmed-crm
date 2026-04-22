import { useCallback, useEffect, useState } from "react";

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

export function useAppointmentLinkedPatient({
  linkedPatientOpen,
  linkedPatientId,
  linkedPatientVersion,
  canViewAssignments,
  canManageAssignments,
  failedLoadMessage,
}: UseAppointmentLinkedPatientOptions) {
  const [linkedPatientDetailLoading, setLinkedPatientDetailLoading] =
    useState(false);
  const [linkedPatientDetailError, setLinkedPatientDetailError] = useState("");
  const [linkedPatientDetail, setLinkedPatientDetail] =
    useState<PatientSheetDetail | null>(null);
  const [linkedPatientAssignments, setLinkedPatientAssignments] = useState<
    PatientSheetAssignment[]
  >([]);
  const [linkedPatientAssignableStaff, setLinkedPatientAssignableStaff] =
    useState<PatientSheetStaffOption[]>([]);
  const resetLinkedPatientState = useCallback(() => {
    setLinkedPatientDetailLoading(false);
    setLinkedPatientDetailError("");
    setLinkedPatientDetail(null);
    setLinkedPatientAssignments([]);
    setLinkedPatientAssignableStaff([]);
  }, []);

  useEffect(() => {
    if (linkedPatientOpen && linkedPatientId) return;
    resetLinkedPatientState();
  }, [linkedPatientId, linkedPatientOpen, resetLinkedPatientState]);

  useEffect(() => {
    if (!linkedPatientOpen || !linkedPatientId) return;

    let active = true;
    void (async () => {
      setLinkedPatientDetailLoading(true);
      setLinkedPatientDetailError("");

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
        setLinkedPatientDetail(patientDetail);
        setLinkedPatientAssignments(assignments);
        setLinkedPatientAssignableStaff(assignableStaff);
      } catch (error) {
        if (!active) return;
        setLinkedPatientDetail(null);
        setLinkedPatientAssignments([]);
        setLinkedPatientAssignableStaff([]);
        setLinkedPatientDetailError(
          error instanceof Error ? error.message : failedLoadMessage,
        );
      } finally {
        if (active) {
          setLinkedPatientDetailLoading(false);
        }
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
