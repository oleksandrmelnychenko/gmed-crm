import { useEffect, useMemo, useState } from "react";

import { apiFetch } from "@/lib/api";

import type {
  ClinicalPayload,
  DemographicsPayload,
  MonthlyEntry,
  OperationsPayload,
  OverviewStats,
  PatientSummary,
  Period,
  TaskItem,
  UpcomingAppointment,
} from "../model/staff-dashboard-types";

export function useStaffDashboardData(period: Period) {
  const [overview, setOverview] = useState<OverviewStats | null>(null);
  const [monthly, setMonthly] = useState<MonthlyEntry[]>([]);
  const [upcoming, setUpcoming] = useState<UpcomingAppointment[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [patients, setPatients] = useState<PatientSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const [demographics, setDemographics] = useState<DemographicsPayload | null>(null);
  const [clinical, setClinical] = useState<ClinicalPayload | null>(null);
  const [operations, setOperations] = useState<OperationsPayload | null>(null);
  const [sectionsLoading, setSectionsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void Promise.all([
      apiFetch<OverviewStats>("/stats/overview").catch(() => null),
      apiFetch<MonthlyEntry[]>("/stats/leads/monthly").catch(() => [] as MonthlyEntry[]),
      apiFetch<UpcomingAppointment[]>("/stats/appointments/upcoming").catch(
        () => [] as UpcomingAppointment[],
      ),
      apiFetch<TaskItem[]>("/tasks?mine_only=true").catch(() => [] as TaskItem[]),
      apiFetch<PatientSummary[]>("/patients").catch(() => [] as PatientSummary[]),
    ]).then(([ov, mm, up, tk, pts]) => {
      if (cancelled) return;
      setOverview(ov);
      setMonthly(mm);
      setUpcoming(up);
      setTasks(tk);
      setPatients(pts);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    void Promise.all([
      apiFetch<DemographicsPayload>(`/stats/dashboard/demographics?period=${period}`).catch(() => null),
      apiFetch<ClinicalPayload>(`/stats/dashboard/clinical?period=${period}`).catch(() => null),
      apiFetch<OperationsPayload>(`/stats/dashboard/operations?period=${period}`).catch(() => null),
    ]).then(([d, c, o]) => {
      if (cancelled) return;
      setDemographics(d);
      setClinical(c);
      setOperations(o);
      setSectionsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [period]);

  const newPatientsThisMonth = useMemo(() => {
    const now = new Date();
    return patients.filter((patient) => {
      const createdAt = new Date(patient.created_at);
      return (
        createdAt.getFullYear() === now.getFullYear() &&
        createdAt.getMonth() === now.getMonth()
      );
    }).length;
  }, [patients]);

  const openTasksCount = useMemo(
    () => tasks.filter((task) => task.status !== "done" && task.status !== "cancelled").length,
    [tasks],
  );

  return {
    clinical,
    demographics,
    loading,
    monthly,
    newPatientsThisMonth,
    openTasksCount,
    operations,
    overview,
    patients,
    sectionsLoading,
    setSectionsLoading,
    tasks,
    upcoming,
  };
}
