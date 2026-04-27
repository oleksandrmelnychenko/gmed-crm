import { startTransition, useEffect, useMemo, useRef, useState } from "react";

import { apiFetch, clearApiCache } from "@/lib/api";
import { useRealtimeSubscription } from "@/lib/realtime";

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

const DASHBOARD_CACHE_TTL_MS = 30_000;
const STAFF_DASHBOARD_REALTIME_EVENTS = [
  "patient.created",
  "patient.updated",
  "patient.assigned",
  "patient.assignment_revoked",
  "patient.activated",
  "patient.deactivated",
  "lead.created",
  "lead.updated",
  "lead.status_changed",
  "lead.converted",
  "lead.failed_resolved",
  "appointment.created",
  "appointment.updated",
  "appointment.status_changed",
  "appointment_checklist.created",
  "appointment_checklist.completed",
  "appointment_request.created",
  "appointment_request.reviewed",
  "appointment_request.converted",
  "case.created",
  "case.updated",
  "case.medication_expiry_confirmed",
  "case.medication_expiry_flagged",
  "order.created",
  "order.phase_changed",
  "order.process_gates_updated",
  "order.debt_management_updated",
  "order.planning_preparation_updated",
  "order.execution_flow_updated",
  "order.followup_flow_updated",
  "order.external_invoice_created",
  "order.external_invoice_updated",
  "order.external_invoice_overdue",
  "order.leistung_added",
  "order.leistung_approved",
  "invoice.created",
  "invoice.status_changed",
  "invoice.dunning_created",
  "invoice.overdue_marked",
  "document.uploaded",
  "document.payment_proof_uploaded",
  "document.generated",
  "document.updated",
  "document.deleted",
  "document.translation_requested",
  "document.translation_updated",
  "feedback.submitted",
  "feedback.reviewed",
  "provider.created",
  "provider.updated",
  "provider.deleted",
  "provider.activated",
  "provider.deactivated",
  "provider.doctor_created",
  "provider.doctor_updated",
  "provider.doctor_deleted",
  "provider.service_created",
  "provider.service_updated",
  "provider.service_deleted",
  "concierge_service.created",
  "concierge_service.updated",
  "concierge_service.cancelled",
  "concierge_service.billing_ready",
  "framework_contract.created",
  "framework_contract.status_changed",
  "quote.created",
  "quote.status_changed",
  "privacy_request.created",
  "privacy_request.reviewed",
  "privacy_request.executed",
  "reminder.created",
  "reminder.completed",
  "task.created",
  "task.status_changed",
  "consent.granted",
  "consent.revoked",
  "user.created",
  "user.activated",
  "user.deactivated",
  "workflow_checklist_item.created",
  "workflow_checklist_item.completed",
] as const;

function clearStaffDashboardCache() {
  clearApiCache("/stats");
  clearApiCache("/patients");
  clearApiCache("/tasks");
}

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
  const [refreshVersion, setRefreshVersion] = useState(0);
  const overviewLoadedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    void Promise.all([
      apiFetch<OverviewStats>("/stats/overview", {
        cacheTtlMs: DASHBOARD_CACHE_TTL_MS,
      }).catch(() => null),
      apiFetch<MonthlyEntry[]>("/stats/leads/monthly", {
        cacheTtlMs: DASHBOARD_CACHE_TTL_MS,
      }).catch(() => [] as MonthlyEntry[]),
      apiFetch<UpcomingAppointment[]>("/stats/appointments/upcoming", {
        cacheTtlMs: DASHBOARD_CACHE_TTL_MS,
      }).catch(
        () => [] as UpcomingAppointment[],
      ),
      apiFetch<TaskItem[]>("/tasks?mine_only=true", {
        cacheTtlMs: DASHBOARD_CACHE_TTL_MS,
      }).catch(() => [] as TaskItem[]),
      apiFetch<PatientSummary[]>("/patients", {
        cacheTtlMs: DASHBOARD_CACHE_TTL_MS,
      }).catch(() => [] as PatientSummary[]),
    ]).then(([ov, mm, up, tk, pts]) => {
      if (cancelled) return;
      startTransition(() => {
        setOverview(ov);
        setMonthly(mm);
        setUpcoming(up);
        setTasks(tk);
        setPatients(pts);
      });
      overviewLoadedRef.current = true;
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [refreshVersion]);

  useEffect(() => {
    let cancelled = false;

    void Promise.all([
      apiFetch<DemographicsPayload>(`/stats/dashboard/demographics?period=${period}`, {
        cacheTtlMs: DASHBOARD_CACHE_TTL_MS,
      }).catch(() => null),
      apiFetch<ClinicalPayload>(`/stats/dashboard/clinical?period=${period}`, {
        cacheTtlMs: DASHBOARD_CACHE_TTL_MS,
      }).catch(() => null),
      apiFetch<OperationsPayload>(`/stats/dashboard/operations?period=${period}`, {
        cacheTtlMs: DASHBOARD_CACHE_TTL_MS,
      }).catch(() => null),
    ]).then(([d, c, o]) => {
      if (cancelled) return;
      startTransition(() => {
        setDemographics(d);
        setClinical(c);
        setOperations(o);
      });
      setSectionsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [period, refreshVersion]);

  useRealtimeSubscription(STAFF_DASHBOARD_REALTIME_EVENTS, () => {
    clearStaffDashboardCache();
    if (!overviewLoadedRef.current) {
      setLoading(true);
    }
    setRefreshVersion((version) => version + 1);
  });

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
