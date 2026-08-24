import { startTransition, useEffect, useMemo, useReducer, useRef, type SetStateAction } from "react";

import { apiFetch, clearApiCache } from "@/lib/api";
import { useDebouncedRealtimeSubscription } from "@/lib/realtime";
import {
  fetchCompanyFinancialAccounts,
  fetchCompanyFinancialPosition,
} from "@/pages/company-finance/data";

import type {
  ClinicalPayload,
  DemographicsPayload,
  ExecutiveFinanceSnapshot,
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
  "accounting_entry.created",
  "accounting_entry.financial_account_assigned",
  "company_financial_account.created",
  "company_financial_account.updated",
  "company_financial_account.adjustment_created",
  "company_financial_account.adjustment_reversed",
  "company_financial_account.transfer_created",
  "company_financial_account.transfer_reversed",
  "concierge_expense.posted",
  "concierge_expense.reversed",
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
  clearApiCache("/company-financial-position");
  clearApiCache("/company-financial-accounts");
}

function localIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function fetchExecutiveFinanceSnapshot(): Promise<ExecutiveFinanceSnapshot | null> {
  const today = new Date();
  const from = new Date(today.getFullYear(), today.getMonth(), 1);
  try {
    const [position, accounts] = await Promise.all([
      fetchCompanyFinancialPosition({
        from: localIsoDate(from),
        to: localIsoDate(today),
        currency: "EUR",
        movement: "all",
        search: "",
      }, true),
      fetchCompanyFinancialAccounts("EUR", true),
    ]);
    const actualCashBalance = accounts.items
      .filter((account) => account.is_active && account.currency === "EUR")
      .reduce((sum, account) => sum + (Number(account.current_balance) || 0), 0);
    return {
      actual_cash_balance: actualCashBalance.toFixed(2),
      patient_receivables: position.summary.patient_receivables_calculated,
      provider_payables: position.summary.provider_payables,
      cash_inflow: position.summary.cash_inflow,
      cash_outflow: position.summary.cash_outflow,
      net_cash_flow: position.summary.net_cash_flow,
      reconciliation_required: position.summary.reconciliation_required,
      reconciliation_patient_count: position.summary.reconciliation_patient_count,
      unassigned_movement_count: accounts.unassigned_movement_count,
      cash_movements: position.cash_movements.map((movement) => ({
        entry_date: movement.entry_date,
        movement: movement.movement,
        signed_amount: movement.signed_amount,
      })),
    };
  } catch {
    return null;
  }
}

type StaffDashboardDataState = {
  overview: OverviewStats | null;
  monthly: MonthlyEntry[];
  upcoming: UpcomingAppointment[];
  tasks: TaskItem[];
  patients: PatientSummary[];
  finance: ExecutiveFinanceSnapshot | null;
  loading: boolean;
  demographics: DemographicsPayload | null;
  clinical: ClinicalPayload | null;
  operations: OperationsPayload | null;
  sectionsLoading: boolean;
  refreshVersion: number;
};

type StaffDashboardDataAction =
  | {
      type: "overview-success";
      overview: OverviewStats | null;
      monthly: MonthlyEntry[];
      upcoming: UpcomingAppointment[];
      tasks: TaskItem[];
      patients: PatientSummary[];
      finance: ExecutiveFinanceSnapshot | null;
    }
  | {
      type: "sections-success";
      demographics: DemographicsPayload | null;
      clinical: ClinicalPayload | null;
      operations: OperationsPayload | null;
    }
  | { type: "set-loading"; loading: boolean }
  | { type: "set-sections-loading"; value: SetStateAction<boolean> }
  | { type: "refresh" };

const STAFF_DASHBOARD_INITIAL_STATE: StaffDashboardDataState = {
  overview: null,
  monthly: [],
  upcoming: [],
  tasks: [],
  patients: [],
  finance: null,
  loading: true,
  demographics: null,
  clinical: null,
  operations: null,
  sectionsLoading: true,
  refreshVersion: 0,
};

function staffDashboardDataReducer(
  state: StaffDashboardDataState,
  action: StaffDashboardDataAction,
): StaffDashboardDataState {
  switch (action.type) {
    case "overview-success":
      return {
        ...state,
        overview: action.overview,
        monthly: action.monthly,
        upcoming: action.upcoming,
        tasks: action.tasks,
        patients: action.patients,
        finance: action.finance,
        loading: false,
      };
    case "sections-success":
      return {
        ...state,
        demographics: action.demographics,
        clinical: action.clinical,
        operations: action.operations,
        sectionsLoading: false,
      };
    case "set-loading":
      return { ...state, loading: action.loading };
    case "set-sections-loading":
      return {
        ...state,
        sectionsLoading:
          typeof action.value === "function"
            ? action.value(state.sectionsLoading)
            : action.value,
      };
    case "refresh":
      return { ...state, refreshVersion: state.refreshVersion + 1 };
    default:
      return state;
  }
}

export function useStaffDashboardData(period: Period) {
  const [
    {
      overview,
      monthly,
      upcoming,
      tasks,
      patients,
      finance,
      loading,
      demographics,
      clinical,
      operations,
      sectionsLoading,
      refreshVersion,
    },
    dispatchDashboardData,
  ] = useReducer(staffDashboardDataReducer, STAFF_DASHBOARD_INITIAL_STATE);
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
      fetchExecutiveFinanceSnapshot(),
    ]).then(([ov, mm, up, tk, pts, financeSnapshot]) => {
      if (cancelled) return;
      startTransition(() => {
        dispatchDashboardData({
          type: "overview-success",
          overview: ov,
          monthly: mm,
          upcoming: up,
          tasks: tk,
          patients: pts,
          finance: financeSnapshot,
        });
      });
      overviewLoadedRef.current = true;
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
        dispatchDashboardData({
          type: "sections-success",
          demographics: d,
          clinical: c,
          operations: o,
        });
      });
    });

    return () => {
      cancelled = true;
    };
  }, [period, refreshVersion]);

  useDebouncedRealtimeSubscription(STAFF_DASHBOARD_REALTIME_EVENTS, () => {
    clearStaffDashboardCache();
    if (!overviewLoadedRef.current) {
      dispatchDashboardData({ type: "set-loading", loading: true });
    }
    dispatchDashboardData({ type: "refresh" });
  }, 300);

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
  const setSectionsLoading = (value: SetStateAction<boolean>) => {
    dispatchDashboardData({ type: "set-sections-loading", value });
  };

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
    finance,
    sectionsLoading,
    setSectionsLoading,
    tasks,
    upcoming,
  };
}
