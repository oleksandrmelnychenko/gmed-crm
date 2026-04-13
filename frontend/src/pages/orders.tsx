import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Building2,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  Stethoscope,
  Wallet,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type OrderPhase = "discovery" | "intake" | "execution" | "closure" | "followup";
type OrderStatus = "active" | "paused" | "completed" | "cancelled";
type LeistungStatus = "draft" | "delivered" | "approved" | "cancelled";

type OrderSummary = {
  id: string;
  order_number: string;
  patient_id: string;
  patient_name: string;
  patient_pid: string;
  phase: OrderPhase | string;
  status: OrderStatus | string;
  total_estimated?: unknown;
  created_at: string;
};

type Leistung = {
  id: string;
  description: string;
  quantity: unknown;
  unit_price: unknown;
  currency: string;
  vat_rate: unknown;
  is_cost_passthrough: boolean;
  status: LeistungStatus | string;
  delivered_at?: string | null;
  approved_at?: string | null;
  notes: string | null;
  provider_id: string | null;
  provider_name: string | null;
  doctor_id: string | null;
  doctor_name: string | null;
};

type OrderDetail = {
  id: string;
  order_number: string;
  patient_id: string;
  patient_name: string;
  patient_pid: string;
  phase: OrderPhase | string;
  status: OrderStatus | string;
  needs_description: string | null;
  signed_patient?: boolean | null;
  signed_agency?: boolean | null;
  total_estimated: unknown;
  total_actual: unknown;
  leistungen: Leistung[];
  process_gates?: OrderProcessGates | null;
  planning_preparation?: OrderPlanningPreparation | null;
  execution_flow?: OrderExecutionFlow | null;
  followup_flow?: OrderFollowupFlow | null;
  lifecycle?: OrderLifecycle | null;
  created_at: string;
  updated_at: string;
};

type OrderProcessGates = {
  execution_ready: boolean;
  debt_hold: boolean;
  overdue_invoice_count: number;
  outstanding_balance?: string | null;
  debt_management?: OrderDebtManagement | null;
  billing_release_status: string;
  billing_release_note: string | null;
  billing_released_by: string | null;
  billing_released_at: string | null;
  package_coverage_status: string;
  package_coverage_note: string | null;
  package_coverage_decided_by: string | null;
  package_coverage_decided_at: string | null;
  financial_gate_ready: boolean;
  contract_gate_ready: boolean;
  signed_patient: boolean;
  signed_agency: boolean;
  payment_gate_required: boolean;
  payment_gate_ready: boolean;
  advance_invoice_count: number;
  paid_advance_invoice_count: number;
  blocking_reasons: string[];
};

type OrderDebtManagement = {
  status: string;
  effective_status: string;
  workflow_required: boolean;
  blocking: boolean;
  blocking_reason: string | null;
  note: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  next_review_at: string | null;
  last_contact_at: string | null;
  resolution_note: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  resolved_by_name: string | null;
  overdue_invoice_count: number;
  outstanding_balance: string;
  created_at: string;
  updated_at: string;
};

type OrderPlanningPreparation = {
  planning_ready: boolean;
  treatment_plan_status: string;
  treatment_plan_note: string | null;
  non_medical_required: boolean;
  interpreter_required: boolean;
  preparation_documents_status: string;
  interpreter_briefing_status: string;
  treatment_plan_ready: boolean;
  medical_bookings_ready: boolean;
  medical_total: number;
  medical_confirmed: number;
  non_medical_bookings_ready: boolean;
  non_medical_total: number;
  non_medical_confirmed: number;
  interpreter_assignment_ready: boolean;
  interpreter_confirmation_ready: boolean;
  interpreter_assigned: number;
  interpreter_confirmed: number;
  interpreter_briefing_ready: boolean;
  preparation_documents_ready: boolean;
  plan_finalized_at: string | null;
  plan_finalized_by: string | null;
  plan_finalized_by_name: string | null;
  preparation_documents_sent_at: string | null;
  preparation_documents_sent_by: string | null;
  preparation_documents_sent_by_name: string | null;
  interpreter_briefed_at: string | null;
  interpreter_briefed_by: string | null;
  interpreter_briefed_by_name: string | null;
  blocking_reasons: string[];
};

type OrderExecutionFlow = {
  closure_ready: boolean;
  arrival_status: string;
  medical_execution_status: string;
  non_medical_execution_status: string;
  interpreter_service_status: string;
  issue_status: string;
  deviation_note: string | null;
  execution_summary: string | null;
  non_medical_required: boolean;
  interpreter_required: boolean;
  arrival_ready: boolean;
  medical_execution_ready: boolean;
  non_medical_execution_ready: boolean;
  interpreter_execution_ready: boolean;
  issue_ready: boolean;
  execution_checklist_ready: boolean;
  medical_completed: number;
  non_medical_completed: number;
  interpreter_completed: number;
  interpreter_confirmed_completed: number;
  approved_interpreter_reports: number;
  delivered_leistungen: number;
  concierge_completed: number;
  execution_documents: number;
  open_execution_checklist_count: number;
  arrival_recorded_at: string | null;
  medical_completed_at: string | null;
  non_medical_completed_at: string | null;
  interpreter_completed_at: string | null;
  issues_resolved_at: string | null;
  blocking_reasons: string[];
};

type OrderFollowupFlow = {
  followup_ready: boolean;
  doctor_followup_status: string;
  followup_1w_status: string;
  followup_1m_status: string;
  followup_6m_status: string;
  package_end_date: string | null;
  suggested_package_end_date: string | null;
  package_end_status: string;
  results_handoff_status: string;
  followup_summary: string | null;
  doctor_followup_ready: boolean;
  followup_1w_ready: boolean;
  followup_1m_ready: boolean;
  followup_6m_ready: boolean;
  package_end_required: boolean;
  package_end_ready: boolean;
  results_handoff_ready: boolean;
  followup_activity_ready: boolean;
  closure_anchor_at: string | null;
  recommended_followup_1w_at: string | null;
  recommended_followup_1m_at: string | null;
  recommended_followup_6m_at: string | null;
  recommended_package_end_followup_at: string | null;
  followup_appointments_total: number;
  doctor_followup_visits: number;
  doctor_followup_tasks: number;
  followup_1w_visits: number;
  followup_1m_visits: number;
  followup_6m_visits: number;
  followup_1w_reminders: number;
  followup_1m_reminders: number;
  followup_6m_reminders: number;
  package_end_tasks: number;
  package_end_reminders: number;
  results_portal_shares: number;
  blocking_reasons: string[];
};

type LifecycleEvent = {
  from_stage: string | null;
  to_stage: string;
  transition_kind: string;
  note: string | null;
  created_at: string;
};

type OrderLifecycleTransition = {
  phase: string;
  blocked: boolean;
  reasons: string[];
};

type OrderLifecycle = {
  current_stage: string;
  stage_entered_at: string | null;
  next_stage: string | null;
  allowed_transitions: OrderLifecycleTransition[];
  history: LifecycleEvent[];
};

type WorkflowChecklistItem = {
  id: string;
  checklist_key: string;
  item_key: string;
  item_text: string;
  owner_role: string;
  owner_user_id: string | null;
  owner_name: string | null;
  owner_user_role: string | null;
  priority: string;
  due_date: string | null;
  linked_task_id: string | null;
  linked_task_status: string | null;
  is_completed: boolean;
  completed_at: string | null;
  sort_order: number;
  created_at: string;
};

type WorkflowChecklistResponse = {
  scope_type: string;
  scope_id: string;
  open_count: number;
  completed_count: number;
  items: WorkflowChecklistItem[];
};

type WorkflowChecklistFormState = {
  itemText: string;
  ownerUserId: string;
  priority: string;
  dueDate: string;
};

type OrderProcessGateFormState = {
  debtStatus: string;
  debtNote: string;
  debtOwnerUserId: string;
  debtNextReviewAt: string;
  debtLastContactAt: string;
  debtResolutionNote: string;
  billingReleaseStatus: string;
  billingReleaseNote: string;
  packageCoverageStatus: string;
  packageCoverageNote: string;
};

type OrderPlanningFormState = {
  treatmentPlanStatus: string;
  treatmentPlanNote: string;
  nonMedicalRequired: boolean;
  interpreterRequired: boolean;
  preparationDocumentsStatus: string;
  interpreterBriefingStatus: string;
};

type OrderExecutionFormState = {
  arrivalStatus: string;
  medicalExecutionStatus: string;
  nonMedicalExecutionStatus: string;
  interpreterServiceStatus: string;
  issueStatus: string;
  deviationNote: string;
  executionSummary: string;
};

type OrderFollowupFormState = {
  doctorFollowupStatus: string;
  followup1wStatus: string;
  followup1mStatus: string;
  followup6mStatus: string;
  packageEndDate: string;
  packageEndStatus: string;
  resultsHandoffStatus: string;
  followupSummary: string;
};

type PatientAssignmentOption = {
  user_id: string;
  user_name: string;
  user_role: string;
  user_active: boolean;
  revoked_at: string | null;
};

type PatientOption = {
  id: string;
  patient_id: string;
  first_name?: string;
  last_name?: string;
};

type ProviderOption = {
  id: string;
  name: string;
  address_city: string | null;
};

type DoctorOption = {
  id: string;
  name: string;
  fachbereich: string | null;
};

type ProviderDetailResponse = {
  doctors?: DoctorOption[];
};

type CreateResponse = {
  id: string;
};

type PatientRecheckCheck = {
  key: string;
  label: string;
  passed: boolean;
  blocking_for: string;
};

type PatientRecheckDocumentAlerts = {
  missing_documents: Array<{ key: string; label: string }>;
  missing_count: number;
  out_of_sync: boolean;
};

type PatientRecheckContract = {
  id: string;
  contract_number: string;
  status: string;
  signed_at: string | null;
  valid_from: string | null;
  valid_to: string | null;
};

type PatientOrderRecheck = {
  requires_recheck: boolean;
  can_create_order: boolean;
  reason?: string | null;
  base_data_ready: boolean;
  compliance_ready: boolean;
  identity_ready: boolean;
  document_pack_ready: boolean;
  contract_ready: boolean;
  debt_hold: boolean;
  overdue_invoice_count: number;
  outstanding_balance?: string | null;
  debt_management?: {
    blocking: boolean;
    blocking_reason: string | null;
    overdue_invoice_count: number;
    outstanding_balance: string;
    latest_workflow?: {
      order_id: string;
      order_number: string;
      status: string;
      effective_status: string;
      blocking: boolean;
      note: string | null;
      owner_user_id: string | null;
      owner_name: string | null;
      next_review_at: string | null;
      last_contact_at: string | null;
      resolution_note: string | null;
      resolved_at: string | null;
      resolved_by: string | null;
      resolved_by_name: string | null;
      updated_at: string | null;
      overdue_invoice_count: number;
      outstanding_balance: string;
    } | null;
  } | null;
  base_data_missing_fields: string[];
  blocking_reasons: string[];
  checks: PatientRecheckCheck[];
  document_alerts: PatientRecheckDocumentAlerts;
  latest_framework_contract: PatientRecheckContract | null;
};

type OrderDebtQueueItem = {
  order_id: string;
  order_number: string;
  phase: string;
  order_status: string;
  patient_id: string;
  patient_code: string;
  patient_name: string;
  status: string;
  effective_status: string;
  blocking_reason: string | null;
  note: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  next_review_at: string | null;
  last_contact_at: string | null;
  resolution_note: string | null;
  resolved_at: string | null;
  updated_at: string | null;
  overdue_invoice_count: number;
  outstanding_balance: string;
};

type OrdersFilters = {
  search: string;
  phase: string;
  status: string;
  patientId: string;
  providerId: string;
  doctorId: string;
};

type CreateOrderFormState = {
  patientId: string;
  needsDescription: string;
};

type LeistungFormState = {
  description: string;
  quantity: string;
  unitPrice: string;
  vatRate: string;
  providerId: string;
  doctorId: string;
  notes: string;
  isCostPassthrough: boolean;
};

type OrdersPermissions = {
  canViewPage: boolean;
  canCreate: boolean;
  canManagePhase: boolean;
  canAddLeistung: boolean;
  canApproveLeistung: boolean;
};

type StatCardProps = {
  label: string;
  value: string;
  description: string;
  icon: ReactNode;
};

type SectionCardProps = {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
};

type DetailFieldProps = {
  label: string;
  value: ReactNode;
};

type EmptyStateProps = {
  title: string;
  description: string;
  action?: ReactNode;
};

const ORDER_PHASES: OrderPhase[] = [
  "discovery",
  "intake",
  "execution",
  "closure",
  "followup",
];
const ORDER_STATUSES: OrderStatus[] = ["active", "paused", "completed", "cancelled"];

const DEFAULT_FILTERS: OrdersFilters = {
  search: "",
  phase: "",
  status: "",
  patientId: "",
  providerId: "",
  doctorId: "",
};

const selectClassName =
  "h-10 w-full rounded-xl border border-input bg-slate-50 px-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100";
const textareaClassName =
  "min-h-[104px] w-full rounded-xl border border-input bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100";

function orderPermissions(role?: string): OrdersPermissions {
  switch (role) {
    case "ceo":
    case "patient_manager":
      return {
        canViewPage: true,
        canCreate: true,
        canManagePhase: true,
        canAddLeistung: true,
        canApproveLeistung: true,
      };
    case "billing":
      return {
        canViewPage: true,
        canCreate: false,
        canManagePhase: false,
        canAddLeistung: false,
        canApproveLeistung: false,
      };
    default:
      return {
        canViewPage: false,
        canCreate: false,
        canManagePhase: false,
        canAddLeistung: false,
        canApproveLeistung: false,
      };
  }
}

function blankCreateOrderForm(): CreateOrderFormState {
  return { patientId: "", needsDescription: "" };
}

function blankLeistungForm(): LeistungFormState {
  return {
    description: "",
    quantity: "1",
    unitPrice: "",
    vatRate: "19",
    providerId: "",
    doctorId: "",
    notes: "",
    isCostPassthrough: false,
  };
}

function blankWorkflowChecklistForm(): WorkflowChecklistFormState {
  return {
    itemText: "",
    ownerUserId: "",
    priority: "normal",
    dueDate: "",
  };
}

function blankOrderProcessGateForm(): OrderProcessGateFormState {
  return {
    debtStatus: "review_required",
    debtNote: "",
    debtOwnerUserId: "",
    debtNextReviewAt: "",
    debtLastContactAt: "",
    debtResolutionNote: "",
    billingReleaseStatus: "pending",
    billingReleaseNote: "",
    packageCoverageStatus: "unknown",
    packageCoverageNote: "",
  };
}

function blankOrderPlanningForm(): OrderPlanningFormState {
  return {
    treatmentPlanStatus: "draft",
    treatmentPlanNote: "",
    nonMedicalRequired: false,
    interpreterRequired: false,
    preparationDocumentsStatus: "pending",
    interpreterBriefingStatus: "not_needed",
  };
}

function blankOrderExecutionForm(): OrderExecutionFormState {
  return {
    arrivalStatus: "pending",
    medicalExecutionStatus: "pending",
    nonMedicalExecutionStatus: "not_required",
    interpreterServiceStatus: "not_required",
    issueStatus: "pending",
    deviationNote: "",
    executionSummary: "",
  };
}

function blankOrderFollowupForm(): OrderFollowupFormState {
  return {
    doctorFollowupStatus: "not_required",
    followup1wStatus: "pending",
    followup1mStatus: "pending",
    followup6mStatus: "pending",
    packageEndDate: "",
    packageEndStatus: "not_required",
    resultsHandoffStatus: "pending",
    followupSummary: "",
  };
}

function orderProcessGatesToForm(
  processGates?: OrderProcessGates | null,
): OrderProcessGateFormState {
  if (!processGates) return blankOrderProcessGateForm();
  return {
    debtStatus: processGates.debt_management?.status ?? "review_required",
    debtNote: processGates.debt_management?.note ?? "",
    debtOwnerUserId: processGates.debt_management?.owner_user_id ?? "",
    debtNextReviewAt: toDateTimeInputValue(processGates.debt_management?.next_review_at),
    debtLastContactAt: toDateTimeInputValue(processGates.debt_management?.last_contact_at),
    debtResolutionNote: processGates.debt_management?.resolution_note ?? "",
    billingReleaseStatus: processGates.billing_release_status,
    billingReleaseNote: processGates.billing_release_note ?? "",
    packageCoverageStatus: processGates.package_coverage_status,
    packageCoverageNote: processGates.package_coverage_note ?? "",
  };
}

function orderPlanningToForm(
  planning?: OrderPlanningPreparation | null,
): OrderPlanningFormState {
  if (!planning) return blankOrderPlanningForm();
  return {
    treatmentPlanStatus: planning.treatment_plan_status,
    treatmentPlanNote: planning.treatment_plan_note ?? "",
    nonMedicalRequired: planning.non_medical_required,
    interpreterRequired: planning.interpreter_required,
    preparationDocumentsStatus: planning.preparation_documents_status,
    interpreterBriefingStatus: planning.interpreter_briefing_status,
  };
}

function orderExecutionToForm(
  execution?: OrderExecutionFlow | null,
): OrderExecutionFormState {
  if (!execution) return blankOrderExecutionForm();
  return {
    arrivalStatus: execution.arrival_status,
    medicalExecutionStatus: execution.medical_execution_status,
    nonMedicalExecutionStatus: execution.non_medical_execution_status,
    interpreterServiceStatus: execution.interpreter_service_status,
    issueStatus: execution.issue_status,
    deviationNote: execution.deviation_note ?? "",
    executionSummary: execution.execution_summary ?? "",
  };
}

function orderFollowupToForm(
  followup?: OrderFollowupFlow | null,
): OrderFollowupFormState {
  if (!followup) return blankOrderFollowupForm();
  return {
    doctorFollowupStatus: followup.doctor_followup_status,
    followup1wStatus: followup.followup_1w_status,
    followup1mStatus: followup.followup_1m_status,
    followup6mStatus: followup.followup_6m_status,
    packageEndDate: followup.package_end_date ?? followup.suggested_package_end_date ?? "",
    packageEndStatus: followup.package_end_status,
    resultsHandoffStatus: followup.results_handoff_status,
    followupSummary: followup.followup_summary ?? "",
  };
}

function workflowChecklistLabel(key: string) {
  switch (key) {
    case "order_discovery":
      return "Discovery";
    case "order_intake":
      return "Intake";
    case "order_execution":
      return "Execution";
    case "order_closure":
      return "Closure";
    case "order_followup":
      return "Follow-up";
    case "order_custom":
      return "Custom";
    default:
      return key.replaceAll("_", " ");
  }
}

function priorityBadgeClass(priority: string) {
  switch (priority) {
    case "urgent":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "high":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "low":
      return "border-slate-200 bg-slate-50 text-slate-600";
    default:
      return "border-sky-200 bg-sky-50 text-sky-700";
  }
}

function phaseClassName(phase: string) {
  switch (phase) {
    case "discovery":
      return "border-slate-200 bg-slate-100 text-slate-700";
    case "intake":
      return "border-sky-200 bg-sky-100 text-sky-700";
    case "execution":
      return "border-amber-200 bg-amber-100 text-amber-700";
    case "closure":
      return "border-emerald-200 bg-emerald-100 text-emerald-700";
    case "followup":
      return "border-violet-200 bg-violet-100 text-violet-700";
    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
}

function recheckBadgeClass(passed: boolean) {
  return passed
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : "border-amber-200 bg-amber-50 text-amber-700";
}

function recheckMissingFieldLabel(field: string) {
  switch (field) {
    case "primary_contact":
      return "Primary contact";
    case "country":
      return "Country";
    case "language":
      return "Preferred language";
    default:
      return field.replaceAll("_", " ");
  }
}

function statusClassName(status: string) {
  switch (status) {
    case "active":
      return "border-emerald-200 bg-emerald-100 text-emerald-700";
    case "paused":
      return "border-amber-200 bg-amber-100 text-amber-700";
    case "completed":
      return "border-sky-200 bg-sky-100 text-sky-700";
    case "cancelled":
      return "border-rose-200 bg-rose-100 text-rose-700";
    case "draft":
      return "border-slate-200 bg-slate-100 text-slate-700";
    case "delivered":
      return "border-amber-200 bg-amber-100 text-amber-700";
    case "approved":
      return "border-emerald-200 bg-emerald-100 text-emerald-700";
    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
}

function optString(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function numberFromUnknown(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatNumber(value: unknown) {
  const parsed = numberFromUnknown(value);
  if (parsed == null) {
    if (typeof value === "string") return value;
    return "0";
  }
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(parsed);
}

function formatCurrency(value: unknown, currency = "EUR") {
  const parsed = numberFromUnknown(value);
  if (parsed == null) {
    const fallback = typeof value === "string" && value.trim() ? value : "0";
    return `${fallback} ${currency}`;
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(parsed);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatDateOnly(value: string | null | undefined) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(date);
}

function toDateTimeInputValue(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function inputDateTimeToApiValue(value: string) {
  if (!value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function patientLabel(patient: PatientOption) {
  const name = [patient.first_name, patient.last_name].filter(Boolean).join(" ").trim();
  return `${name || "Patient"} (${patient.patient_id})`;
}

function nextPhase(current: string) {
  const index = ORDER_PHASES.indexOf(current as OrderPhase);
  if (index < 0 || index >= ORDER_PHASES.length - 1) return null;
  return ORDER_PHASES[index + 1];
}

function sumLeistungTotals(items: Leistung[]) {
  return items.reduce((sum, item) => {
    const quantity = numberFromUnknown(item.quantity) ?? 0;
    const unitPrice = numberFromUnknown(item.unit_price) ?? 0;
    return sum + quantity * unitPrice;
  }, 0);
}

function StatCard({ label, value, description, icon }: StatCardProps) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
            {label}
          </div>
          <div className="text-2xl font-semibold tracking-tight text-slate-900">{value}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-2 text-slate-600">
          {icon}
        </div>
      </div>
      <p className="mt-3 text-sm text-slate-500">{description}</p>
    </div>
  );
}

function SectionCard({ title, description, action, children, className }: SectionCardProps) {
  return (
    <section className={cn("rounded-2xl border border-slate-200 bg-white shadow-sm", className)}>
      <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold tracking-[0.02em] text-slate-900">{title}</h2>
          {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function DetailField({ label, value }: DetailFieldProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        {label}
      </div>
      <div className="mt-2 text-sm text-slate-900">{value}</div>
    </div>
  );
}

function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center shadow-sm">
      <div className="mx-auto flex max-w-md flex-col items-center gap-3">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-slate-500">
          <ClipboardList className="size-5" />
        </div>
        <div>
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <p className="mt-2 text-sm text-slate-500">{description}</p>
        </div>
        {action}
      </div>
    </div>
  );
}

export function OrdersPage() {
  const { t } = useLang();
  const tx = t as unknown as Record<string, string>;
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const permissions = orderPermissions(user?.role);

  const [filters, setFilters] = useState<OrdersFilters>(DEFAULT_FILTERS);
  const deferredSearch = useDeferredValue(filters.search);

  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  const [patients, setPatients] = useState<PatientOption[]>([]);
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [providerDoctors, setProviderDoctors] = useState<Record<string, DoctorOption[]>>({});

  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [orderDetail, setOrderDetail] = useState<OrderDetail | null>(null);
  const [workflowChecklist, setWorkflowChecklist] =
    useState<WorkflowChecklistResponse | null>(null);
  const [workflowAssignments, setWorkflowAssignments] = useState<
    PatientAssignmentOption[]
  >([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [phaseDraft, setPhaseDraft] = useState("");
  const [phaseSaving, setPhaseSaving] = useState(false);
  const [phaseError, setPhaseError] = useState<string | null>(null);
  const [approvingLeistungId, setApprovingLeistungId] = useState<string | null>(null);
  const [workflowBusy, setWorkflowBusy] = useState(false);
  const [workflowForm, setWorkflowForm] = useState<WorkflowChecklistFormState>(
    blankWorkflowChecklistForm
  );
  const [processGateBusy, setProcessGateBusy] = useState(false);
  const [processGateError, setProcessGateError] = useState<string | null>(null);
  const [processGateForm, setProcessGateForm] = useState<OrderProcessGateFormState>(
    blankOrderProcessGateForm
  );
  const [debtQueue, setDebtQueue] = useState<OrderDebtQueueItem[]>([]);
  const [debtQueueLoading, setDebtQueueLoading] = useState(false);
  const [debtQueueError, setDebtQueueError] = useState<string | null>(null);
  const [planningBusy, setPlanningBusy] = useState(false);
  const [planningError, setPlanningError] = useState<string | null>(null);
  const [planningForm, setPlanningForm] = useState<OrderPlanningFormState>(
    blankOrderPlanningForm
  );
  const [executionBusy, setExecutionBusy] = useState(false);
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [executionForm, setExecutionForm] = useState<OrderExecutionFormState>(
    blankOrderExecutionForm
  );
  const [followupBusy, setFollowupBusy] = useState(false);
  const [followupError, setFollowupError] = useState<string | null>(null);
  const [followupForm, setFollowupForm] = useState<OrderFollowupFormState>(
    blankOrderFollowupForm
  );

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateOrderFormState>(blankCreateOrderForm);
  const [createSaving, setCreateSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createRecheck, setCreateRecheck] = useState<PatientOrderRecheck | null>(null);
  const [createRecheckLoading, setCreateRecheckLoading] = useState(false);
  const [createRecheckError, setCreateRecheckError] = useState<string | null>(null);

  const [leistungOpen, setLeistungOpen] = useState(false);
  const [leistungForm, setLeistungForm] = useState<LeistungFormState>(blankLeistungForm);
  const [leistungSaving, setLeistungSaving] = useState(false);
  const [leistungError, setLeistungError] = useState<string | null>(null);

  const filterDoctorOptions = useMemo(
    () => (filters.providerId ? (providerDoctors[filters.providerId] ?? []) : []),
    [filters.providerId, providerDoctors],
  );
  const leistungDoctorOptions = useMemo(
    () => (leistungForm.providerId ? (providerDoctors[leistungForm.providerId] ?? []) : []),
    [leistungForm.providerId, providerDoctors],
  );

  const metrics = useMemo(() => {
    const active = orders.filter((item) => item.status === "active").length;
    const execution = orders.filter(
      (item) => item.phase === "execution" || item.phase === "closure",
    ).length;
    const estimatedTotal = orders.reduce((sum, item) => {
      return sum + (numberFromUnknown(item.total_estimated) ?? 0);
    }, 0);

    return {
      total: orders.length,
      active,
      execution,
      estimatedTotal,
    };
  }, [orders]);

  const leistungMetrics = useMemo(() => {
    const items = orderDetail?.leistungen ?? [];
    return {
      total: items.length,
      delivered: items.filter((item) => item.status === "delivered").length,
      approved: items.filter((item) => item.status === "approved").length,
      gross: sumLeistungTotals(items),
    };
  }, [orderDetail]);
  const workflowChecklistGroups = useMemo(() => {
    const items = workflowChecklist?.items ?? [];
    const grouped = new Map<string, WorkflowChecklistItem[]>();
    for (const item of items) {
      const current = grouped.get(item.checklist_key) ?? [];
      current.push(item);
      grouped.set(item.checklist_key, current);
    }
    return Array.from(grouped.entries()).map(([key, groupItems]) => ({
      key,
      label: workflowChecklistLabel(key),
      items: groupItems,
    }));
  }, [workflowChecklist]);
  const nextLifecycleTransition = useMemo(
    () => orderDetail?.lifecycle?.allowed_transitions?.[0] ?? null,
    [orderDetail?.lifecycle]
  );
  const activeWorkflowAssignments = useMemo(
    () =>
      workflowAssignments.filter(
        (item) => !item.revoked_at && item.user_active
      ),
    [workflowAssignments]
  );
  const debtOwnerOptions = useMemo(() => {
    const items = [...activeWorkflowAssignments];
    const currentOwnerId = orderDetail?.process_gates?.debt_management?.owner_user_id;
    const currentOwnerName = orderDetail?.process_gates?.debt_management?.owner_name;
    if (
      currentOwnerId &&
      !items.some((item) => item.user_id === currentOwnerId)
    ) {
      items.push({
        user_id: currentOwnerId,
        user_name: currentOwnerName ?? "Current owner",
        user_role: "debt_owner",
        user_active: true,
        revoked_at: null,
      });
    }
    return items;
  }, [
    activeWorkflowAssignments,
    orderDetail?.process_gates?.debt_management?.owner_name,
    orderDetail?.process_gates?.debt_management?.owner_user_id,
  ]);
  const canManageDebt = user?.role === "patient_manager" || user?.role === "billing" || user?.role === "ceo";

  function syncQuery(next: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams);
    Object.entries(next).forEach(([key, value]) => {
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    });
    setSearchParams(params, { replace: true });
  }

  function triggerReload() {
    startTransition(() => {
      setReloadNonce((current) => current + 1);
    });
  }

  const ensureProviderDoctors = useCallback(
    async (providerId: string) => {
      if (!providerId) return [] as DoctorOption[];
      const cached = providerDoctors[providerId];
      if (cached) return cached;

      const detail = await apiFetch<ProviderDetailResponse>(`/providers/${providerId}`);
      const doctors = detail.doctors ?? [];
      setProviderDoctors((current) => ({
        ...current,
        [providerId]: doctors,
      }));
      return doctors;
    },
    [providerDoctors],
  );

  useEffect(() => {
    if (workflowForm.ownerUserId) return;
    const preferredAssignee =
      activeWorkflowAssignments.find((item) => item.user_id === user?.id)?.user_id ??
      activeWorkflowAssignments[0]?.user_id ??
      "";
    if (!preferredAssignee) return;
    setWorkflowForm((current) => ({
      ...current,
      ownerUserId: preferredAssignee,
    }));
  }, [activeWorkflowAssignments, user?.id, workflowForm.ownerUserId]);

  function openOrder(orderId: string) {
    setDetailError(null);
    setDetailLoading(true);
    startTransition(() => {
      setSelectedOrderId(orderId);
    });
    syncQuery({ order: orderId });
  }

  function resetCreateDialog(open: boolean) {
    setCreateOpen(open);
    if (!open) {
      setCreateError(null);
      setCreateForm(blankCreateOrderForm());
      setCreateSaving(false);
      setCreateRecheck(null);
      setCreateRecheckError(null);
      setCreateRecheckLoading(false);
    }
  }

  function resetLeistungDialog(open: boolean) {
    setLeistungOpen(open);
    if (!open) {
      setLeistungError(null);
      setLeistungForm(blankLeistungForm());
      setLeistungSaving(false);
    }
  }

  useEffect(() => {
    const patientParam = searchParams.get("patient") ?? "";
    const providerParam = searchParams.get("provider") ?? "";
    const doctorParam = searchParams.get("doctor") ?? "";
    const orderParam = searchParams.get("order") ?? "";
    const createParam = searchParams.get("create") ?? "";

    setFilters((current) => {
      if (
        current.patientId === patientParam &&
        current.providerId === providerParam &&
        current.doctorId === doctorParam
      ) {
        return current;
      }
      return {
        ...current,
        patientId: patientParam,
        providerId: providerParam,
        doctorId: doctorParam,
      };
    });

    if (orderParam && orderParam !== selectedOrderId) {
      setSelectedOrderId(orderParam);
      setDetailLoading(true);
    }

    if (createParam && permissions.canCreate) {
      setCreateError(null);
      setCreateForm({
        ...blankCreateOrderForm(),
        patientId: patientParam,
      });
      setCreateOpen(true);
      const params = new URLSearchParams(searchParams);
      params.delete("create");
      setSearchParams(params, { replace: true });
    }
  }, [permissions.canCreate, searchParams, selectedOrderId, setSearchParams]);

  useEffect(() => {
    if (!permissions.canViewPage) return;

    let cancelled = false;
    async function loadDirectory() {
      try {
        const [patientsResponse, providersResponse] = await Promise.all([
          apiFetch<PatientOption[]>("/patients"),
          apiFetch<ProviderOption[]>("/providers"),
        ]);
        if (cancelled) return;
        setPatients(patientsResponse);
        setProviders(providersResponse);
      } catch {
        if (cancelled) return;
        setPatients([]);
        setProviders([]);
      }
    }

    void loadDirectory();
    return () => {
      cancelled = true;
    };
  }, [permissions.canViewPage]);

  useEffect(() => {
    if (!createOpen || !createForm.patientId) {
      setCreateRecheck(null);
      setCreateRecheckError(null);
      setCreateRecheckLoading(false);
      return;
    }

    let cancelled = false;
    setCreateRecheckLoading(true);
    setCreateRecheckError(null);

    async function loadCreateRecheck() {
      try {
        const response = await apiFetch<PatientOrderRecheck>(
          `/patients/${createForm.patientId}/recheck`,
        );
        if (cancelled) return;
        setCreateRecheck(response);
      } catch (error) {
        if (cancelled) return;
        setCreateRecheck(null);
        setCreateRecheckError(
          error instanceof Error ? error.message : "Failed to load patient re-check",
        );
      } finally {
        if (!cancelled) {
          setCreateRecheckLoading(false);
        }
      }
    }

    void loadCreateRecheck();
    return () => {
      cancelled = true;
    };
  }, [createForm.patientId, createOpen]);

  useEffect(() => {
    if (!permissions.canViewPage) return;

    let cancelled = false;
    setLoading(true);
    setListError(null);

    async function loadOrders() {
      try {
        const params = new URLSearchParams();
        if (deferredSearch.trim()) params.set("search", deferredSearch.trim());
        if (filters.phase) params.set("phase", filters.phase);
        if (filters.status) params.set("status", filters.status);
        if (filters.patientId) params.set("patient_id", filters.patientId);
        if (filters.providerId) params.set("provider_id", filters.providerId);
        if (filters.doctorId) params.set("doctor_id", filters.doctorId);

        const queryString = params.toString();
        const response = await apiFetch<OrderSummary[]>(
          `/orders${queryString ? `?${queryString}` : ""}`,
        );
        if (cancelled) return;
        setOrders(response);
      } catch (error) {
        if (cancelled) return;
        setListError(error instanceof Error ? error.message : "Failed to load orders");
        setOrders([]);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadOrders();
    return () => {
      cancelled = true;
    };
  }, [
    deferredSearch,
    filters.doctorId,
    filters.patientId,
    filters.phase,
    filters.providerId,
    filters.status,
    permissions.canViewPage,
    reloadNonce,
  ]);

  useEffect(() => {
    if (!permissions.canViewPage || !canManageDebt) {
      setDebtQueue([]);
      setDebtQueueError(null);
      setDebtQueueLoading(false);
      return;
    }

    let cancelled = false;
    setDebtQueueLoading(true);
    setDebtQueueError(null);

    async function loadDebtQueue() {
      try {
        const response = await apiFetch<OrderDebtQueueItem[]>("/orders/debt-management");
        if (cancelled) return;
        setDebtQueue(response);
      } catch (error) {
        if (cancelled) return;
        setDebtQueue([]);
        setDebtQueueError(
          error instanceof Error ? error.message : "Failed to load debt-management queue",
        );
      } finally {
        if (!cancelled) {
          setDebtQueueLoading(false);
        }
      }
    }

    void loadDebtQueue();
    return () => {
      cancelled = true;
    };
  }, [canManageDebt, permissions.canViewPage, reloadNonce]);

  useEffect(() => {
    if (!filters.providerId) return;
    void ensureProviderDoctors(filters.providerId).catch(() => {
      setProviderDoctors((current) => ({ ...current, [filters.providerId]: [] }));
    });
  }, [ensureProviderDoctors, filters.providerId]);

  useEffect(() => {
    if (!leistungForm.providerId) return;
    void ensureProviderDoctors(leistungForm.providerId).catch(() => {
      setProviderDoctors((current) => ({ ...current, [leistungForm.providerId]: [] }));
    });
  }, [ensureProviderDoctors, leistungForm.providerId]);

  useEffect(() => {
    if (!selectedOrderId) {
      setOrderDetail(null);
      setWorkflowChecklist(null);
      setWorkflowAssignments([]);
      setPhaseDraft("");
      setProcessGateForm(blankOrderProcessGateForm());
      setProcessGateError(null);
      setPlanningForm(blankOrderPlanningForm());
      setPlanningError(null);
      setExecutionForm(blankOrderExecutionForm());
      setExecutionError(null);
      setFollowupForm(blankOrderFollowupForm());
      setFollowupError(null);
      return;
    }

    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);

    async function loadDetail() {
      try {
        const detail = await apiFetch<OrderDetail>(`/orders/${selectedOrderId}`);
        const [workflow, assignments] = await Promise.all([
          apiFetch<WorkflowChecklistResponse>(
            `/orders/${selectedOrderId}/workflow-checklist`
          ).catch(() => null),
          apiFetch<PatientAssignmentOption[]>(
            `/patients/${detail.patient_id}/assignments`
          ).catch(() => []),
        ]);
        if (cancelled) return;
        setOrderDetail(detail);
        setWorkflowChecklist(workflow);
        setWorkflowAssignments(assignments);
        setPhaseDraft(detail.phase);
        setProcessGateForm(orderProcessGatesToForm(detail.process_gates));
        setProcessGateError(null);
        setPlanningForm(orderPlanningToForm(detail.planning_preparation));
        setPlanningError(null);
        setExecutionForm(orderExecutionToForm(detail.execution_flow));
        setExecutionError(null);
        setFollowupForm(orderFollowupToForm(detail.followup_flow));
        setFollowupError(null);
      } catch (error) {
        if (cancelled) return;
        setOrderDetail(null);
        setWorkflowChecklist(null);
        setWorkflowAssignments([]);
        setProcessGateForm(blankOrderProcessGateForm());
        setPlanningError(null);
        setPlanningForm(blankOrderPlanningForm());
        setExecutionForm(blankOrderExecutionForm());
        setExecutionError(null);
        setFollowupForm(blankOrderFollowupForm());
        setFollowupError(null);
        setDetailError(error instanceof Error ? error.message : "Failed to load order");
      } finally {
        if (!cancelled) {
          setDetailLoading(false);
        }
      }
    }

    void loadDetail();
    return () => {
      cancelled = true;
    };
  }, [reloadNonce, selectedOrderId]);

  async function handleCreateOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!createForm.patientId) {
      setCreateError("Patient is required");
      return;
    }
    if (createRecheckLoading) {
      setCreateError("Existing customer re-check is still loading");
      return;
    }
    if (!createRecheck) {
      setCreateError(createRecheckError ?? "Failed to load patient re-check");
      return;
    }
    if (createRecheck?.requires_recheck && !createRecheck.can_create_order) {
      setCreateError(
        createRecheck?.blocking_reasons?.[0] ?? "Existing customer re-check is incomplete",
      );
      return;
    }

    setCreateSaving(true);
    setCreateError(null);
    try {
      const created = await apiFetch<CreateResponse>("/orders", {
        method: "POST",
        body: JSON.stringify({
          patient_id: createForm.patientId,
          contract_id: null,
          needs_description: optString(createForm.needsDescription),
        }),
      });

      resetCreateDialog(false);
      openOrder(created.id);
      triggerReload();
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Failed to create order");
    } finally {
      setCreateSaving(false);
    }
  }

  async function handleSavePhase() {
    if (!selectedOrderId || !phaseDraft || phaseDraft === orderDetail?.phase) {
      return;
    }
    if (
      orderDetail?.lifecycle?.next_stage &&
      phaseDraft !== orderDetail.lifecycle.next_stage
    ) {
      setPhaseError(
        `Only the next lifecycle phase is allowed: ${orderDetail.lifecycle.next_stage}`
      );
      return;
    }

    setPhaseSaving(true);
    setPhaseError(null);
    try {
      await apiFetch(`/orders/${selectedOrderId}/phase`, {
        method: "POST",
        body: JSON.stringify({ phase: phaseDraft }),
      });
      triggerReload();
    } catch (error) {
      setPhaseError(error instanceof Error ? error.message : "Failed to update phase");
    } finally {
      setPhaseSaving(false);
    }
  }

  async function handleAdvancePhase() {
    if (!orderDetail) return;
    const phase = orderDetail.lifecycle?.next_stage ?? nextPhase(orderDetail.phase);
    if (!phase) return;
    setPhaseDraft(phase);
    await apiFetch(`/orders/${orderDetail.id}/phase`, {
      method: "POST",
      body: JSON.stringify({ phase }),
    })
      .then(() => {
        setPhaseError(null);
        triggerReload();
      })
      .catch((error: unknown) => {
        setPhaseDraft(orderDetail.phase);
        setPhaseError(error instanceof Error ? error.message : "Failed to advance phase");
      });
  }

  async function handleSaveDebtManagement() {
    if (!selectedOrderId) return;

    setProcessGateBusy(true);
    setProcessGateError(null);
    try {
      await apiFetch(`/orders/${selectedOrderId}/debt-management`, {
        method: "POST",
        body: JSON.stringify({
          status: processGateForm.debtStatus,
          note: optString(processGateForm.debtNote),
          owner_user_id: processGateForm.debtOwnerUserId || null,
          next_review_at: inputDateTimeToApiValue(processGateForm.debtNextReviewAt),
          last_contact_at: inputDateTimeToApiValue(processGateForm.debtLastContactAt),
          resolution_note: optString(processGateForm.debtResolutionNote),
        }),
      });
      triggerReload();
    } catch (error) {
      setProcessGateError(
        error instanceof Error ? error.message : "Failed to update debt-management workflow",
      );
    } finally {
      setProcessGateBusy(false);
    }
  }

  async function handleSaveBillingRelease() {
    if (!selectedOrderId) return;

    setProcessGateBusy(true);
    setProcessGateError(null);
    try {
      await apiFetch(`/orders/${selectedOrderId}/process-gates`, {
        method: "POST",
        body: JSON.stringify({
          billing_release_status: processGateForm.billingReleaseStatus,
          billing_release_note: optString(processGateForm.billingReleaseNote),
        }),
      });
      triggerReload();
    } catch (error) {
      setProcessGateError(
        error instanceof Error ? error.message : "Failed to update billing release"
      );
    } finally {
      setProcessGateBusy(false);
    }
  }

  async function handleSavePackageCoverage() {
    if (!selectedOrderId) return;

    setProcessGateBusy(true);
    setProcessGateError(null);
    try {
      await apiFetch(`/orders/${selectedOrderId}/process-gates`, {
        method: "POST",
        body: JSON.stringify({
          package_coverage_status: processGateForm.packageCoverageStatus,
          package_coverage_note: optString(processGateForm.packageCoverageNote),
        }),
      });
      triggerReload();
    } catch (error) {
      setProcessGateError(
        error instanceof Error ? error.message : "Failed to update package coverage"
      );
    } finally {
      setProcessGateBusy(false);
    }
  }

  async function handleSavePlanningPreparation() {
    if (!selectedOrderId) return;

    setPlanningBusy(true);
    setPlanningError(null);
    try {
      await apiFetch(`/orders/${selectedOrderId}/planning-preparation`, {
        method: "POST",
        body: JSON.stringify({
          treatment_plan_status: planningForm.treatmentPlanStatus,
          treatment_plan_note: optString(planningForm.treatmentPlanNote),
          non_medical_required: planningForm.nonMedicalRequired,
          interpreter_required: planningForm.interpreterRequired,
          preparation_documents_status: planningForm.preparationDocumentsStatus,
          interpreter_briefing_status: planningForm.interpreterRequired
            ? planningForm.interpreterBriefingStatus
            : "not_needed",
        }),
      });
      triggerReload();
    } catch (error) {
      setPlanningError(
        error instanceof Error ? error.message : "Failed to update planning/preparation",
      );
    } finally {
      setPlanningBusy(false);
    }
  }

  async function handleSaveExecutionFlow() {
    if (!selectedOrderId) return;

    setExecutionBusy(true);
    setExecutionError(null);
    try {
      await apiFetch(`/orders/${selectedOrderId}/execution-flow`, {
        method: "POST",
        body: JSON.stringify({
          arrival_status: executionForm.arrivalStatus,
          medical_execution_status: executionForm.medicalExecutionStatus,
          non_medical_execution_status: executionForm.nonMedicalExecutionStatus,
          interpreter_service_status: executionForm.interpreterServiceStatus,
          issue_status: executionForm.issueStatus,
          deviation_note: optString(executionForm.deviationNote),
          execution_summary: optString(executionForm.executionSummary),
        }),
      });
      triggerReload();
    } catch (error) {
      setExecutionError(
        error instanceof Error ? error.message : "Failed to update execution flow",
      );
    } finally {
      setExecutionBusy(false);
    }
  }

  async function handleSaveFollowupFlow() {
    if (!selectedOrderId) return;

    setFollowupBusy(true);
    setFollowupError(null);
    try {
      await apiFetch(`/orders/${selectedOrderId}/followup-flow`, {
        method: "POST",
        body: JSON.stringify({
          doctor_followup_status: followupForm.doctorFollowupStatus,
          followup_1w_status: followupForm.followup1wStatus,
          followup_1m_status: followupForm.followup1mStatus,
          followup_6m_status: followupForm.followup6mStatus,
          package_end_date: followupForm.packageEndDate,
          package_end_status: followupForm.packageEndStatus,
          results_handoff_status: followupForm.resultsHandoffStatus,
          followup_summary: optString(followupForm.followupSummary),
        }),
      });
      triggerReload();
    } catch (error) {
      setFollowupError(
        error instanceof Error ? error.message : "Failed to update follow-up flow",
      );
    } finally {
      setFollowupBusy(false);
    }
  }

  async function handleAddLeistung(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedOrderId) {
      setLeistungError("Select an order first");
      return;
    }

    const quantity = Number(leistungForm.quantity.replace(",", "."));
    const unitPrice = Number(leistungForm.unitPrice.replace(",", "."));
    const vatRate = Number(leistungForm.vatRate.replace(",", "."));

    if (!leistungForm.description.trim()) {
      setLeistungError("Description is required");
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setLeistungError("Quantity must be a positive number");
      return;
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      setLeistungError("Unit price must be numeric");
      return;
    }
    if (!Number.isFinite(vatRate) || vatRate < 0) {
      setLeistungError("VAT must be numeric");
      return;
    }

    setLeistungSaving(true);
    setLeistungError(null);
    try {
      await apiFetch(`/orders/${selectedOrderId}/leistungen`, {
        method: "POST",
        body: JSON.stringify({
          description: leistungForm.description.trim(),
          quantity,
          unit_price: unitPrice,
          vat_rate: vatRate,
          is_cost_passthrough: leistungForm.isCostPassthrough,
          provider_id: optString(leistungForm.providerId),
          doctor_id: optString(leistungForm.doctorId),
          notes: optString(leistungForm.notes),
        }),
      });
      resetLeistungDialog(false);
      triggerReload();
    } catch (error) {
      setLeistungError(error instanceof Error ? error.message : "Failed to add Leistung");
    } finally {
      setLeistungSaving(false);
    }
  }

  async function handleApproveLeistung(leistungId: string) {
    if (!selectedOrderId) return;

    setApprovingLeistungId(leistungId);
    try {
      await apiFetch(`/orders/${selectedOrderId}/leistungen/${leistungId}/approve`, {
        method: "POST",
      });
      triggerReload();
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "Failed to approve Leistung");
    } finally {
      setApprovingLeistungId(null);
    }
  }

  async function handleAddWorkflowItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedOrderId || !workflowForm.itemText.trim()) {
      setDetailError("Checklist item text is required");
      return;
    }

    setWorkflowBusy(true);
    setDetailError(null);
    try {
      await apiFetch(`/orders/${selectedOrderId}/workflow-checklist`, {
        method: "POST",
        body: JSON.stringify({
          item_text: workflowForm.itemText.trim(),
          owner_user_id: optString(workflowForm.ownerUserId),
          priority: workflowForm.priority,
          due_date: workflowForm.dueDate
            ? new Date(workflowForm.dueDate).toISOString()
            : null,
        }),
      });
      setWorkflowForm((current) => ({
        ...blankWorkflowChecklistForm(),
        ownerUserId: current.ownerUserId,
      }));
      triggerReload();
    } catch (error) {
      setDetailError(
        error instanceof Error ? error.message : "Failed to create checklist item"
      );
    } finally {
      setWorkflowBusy(false);
    }
  }

  async function handleCompleteWorkflowItem(itemId: string) {
    if (!selectedOrderId) return;

    setWorkflowBusy(true);
    setDetailError(null);
    try {
      await apiFetch(`/orders/${selectedOrderId}/workflow-checklist/${itemId}/complete`, {
        method: "POST",
      });
      triggerReload();
    } catch (error) {
      setDetailError(
        error instanceof Error ? error.message : "Failed to complete checklist item"
      );
    } finally {
      setWorkflowBusy(false);
    }
  }

  if (!permissions.canViewPage) {
    return (
      <EmptyState
        title={tx.orders_title}
        description={tx.orders_subtitle}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
            Operations
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
            {t.orders_title}
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-500">{t.orders_subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={triggerReload}>
            <RefreshCw className="mr-2 size-4" />
            Refresh
          </Button>
          {permissions.canCreate ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 size-4" />
              New order
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={tx.orders_title}
          value={String(metrics.total)}
          description={tx.orders_subtitle}
          icon={<ClipboardList className="size-4" />}
        />
        <StatCard
          label={tx.common_active}
          value={String(metrics.active)}
          description={tx.orders_subtitle}
          icon={<CheckCircle2 className="size-4" />}
        />
        <StatCard
          label={tx.orders_phase}
          value={String(metrics.execution)}
          description={tx.orders_subtitle}
          icon={<Stethoscope className="size-4" />}
        />
        <StatCard
          label={tx.contracts_total}
          value={formatCurrency(metrics.estimatedTotal)}
          description={tx.orders_subtitle}
          icon={<Wallet className="size-4" />}
        />
      </div>

      {canManageDebt ? (
        <SectionCard
          title="Debt-management queue"
          description="Orders blocked by overdue receivables or an open debt workflow."
        >
          {debtQueueError ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {debtQueueError}
            </div>
          ) : debtQueueLoading ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
              <LoaderCircle className="mb-2 size-4 animate-spin" />
              Loading debt-management queue...
            </div>
          ) : debtQueue.length === 0 ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-700">
              No open debt-management items right now.
            </div>
          ) : (
            <div className="grid gap-4 xl:grid-cols-3">
              {debtQueue.slice(0, 6).map((item) => (
                <button
                  key={item.order_id}
                  type="button"
                  onClick={() => openOrder(item.order_id)}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-mono text-xs font-semibold tracking-[0.16em] text-slate-500">
                        {item.order_number}
                      </div>
                      <div className="mt-2 text-sm font-semibold text-slate-950">
                        {item.patient_name}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">{item.patient_code}</div>
                    </div>
                    <Badge variant="outline" className="rounded-full border-amber-200 bg-amber-50 text-amber-700">
                      {item.effective_status}
                    </Badge>
                  </div>
                  <div className="mt-4 space-y-2 text-sm text-slate-600">
                    <div>{item.blocking_reason ?? "Open debt workflow"}</div>
                    <div>
                      {item.overdue_invoice_count} overdue / {formatCurrency(item.outstanding_balance)}
                    </div>
                    <div>
                      Owner: {item.owner_name ?? "Unassigned"} / Review {formatDateTime(item.next_review_at)}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </SectionCard>
      ) : null}

      <SectionCard
        title={tx.common_search}
        description={tx.orders_subtitle}
      >
        <div className="grid gap-4 xl:grid-cols-6">
          <div className="xl:col-span-2">
            <Label htmlFor="orders-search">{t.common_search}</Label>
            <div className="relative mt-1">
              <Search className="pointer-events-none absolute top-3 left-3 size-4 text-slate-400" />
              <Input
                id="orders-search"
                value={filters.search}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, search: event.target.value }))
                }
                placeholder={t.search_placeholder}
                className="pl-9"
              />
            </div>
          </div>
          <div>
            <Label>{t.orders_phase}</Label>
            <select
              value={filters.phase}
              onChange={(event) =>
                setFilters((current) => ({ ...current, phase: event.target.value }))
              }
              className={`mt-1 ${selectClassName}`}
            >
              <option value="">{t.providers_all}</option>
              {ORDER_PHASES.map((phase) => (
                <option key={phase} value={phase}>
                  {phase}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>{t.users_status}</Label>
            <select
              value={filters.status}
              onChange={(event) =>
                setFilters((current) => ({ ...current, status: event.target.value }))
              }
              className={`mt-1 ${selectClassName}`}
            >
              <option value="">{t.providers_all}</option>
              {ORDER_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>{t.orders_patient}</Label>
            <select
              value={filters.patientId}
              onChange={(event) => {
                const patientId = event.target.value;
                setFilters((current) => ({ ...current, patientId }));
                syncQuery({ patient: patientId || null });
              }}
              className={`mt-1 ${selectClassName}`}
            >
              <option value="">All patients</option>
              {patients.map((patient) => (
                <option key={patient.id} value={patient.id}>
                  {patientLabel(patient)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>Provider</Label>
            <select
              value={filters.providerId}
              onChange={(event) => {
                const providerId = event.target.value;
                setFilters((current) => ({
                  ...current,
                  providerId,
                  doctorId: "",
                }));
                syncQuery({ provider: providerId || null, doctor: null });
              }}
              className={`mt-1 ${selectClassName}`}
            >
              <option value="">{t.providers_all}</option>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                  {provider.address_city ? ` (${provider.address_city})` : ""}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto]">
          <div className="max-w-xs">
            <Label>Doctor</Label>
            <select
              value={filters.doctorId}
              onChange={(event) => {
                const doctorId = event.target.value;
                setFilters((current) => ({ ...current, doctorId }));
                syncQuery({ doctor: doctorId || null });
              }}
              className={`mt-1 ${selectClassName}`}
              disabled={!filters.providerId}
            >
              <option value="">{t.providers_all}</option>
              {filterDoctorOptions.map((doctor) => (
                <option key={doctor.id} value={doctor.id}>
                  {doctor.name}
                  {doctor.fachbereich ? ` (${doctor.fachbereich})` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setFilters(DEFAULT_FILTERS);
                syncQuery({ patient: null, provider: null, doctor: null, order: null });
              }}
            >
              Reset filters
            </Button>
          </div>
        </div>
      </SectionCard>

      {listError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {listError}
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-12 text-center text-sm text-slate-500 shadow-sm">
          <LoaderCircle className="mx-auto mb-3 size-5 animate-spin" />
          {t.common_loading}
        </div>
      ) : orders.length === 0 ? (
        <EmptyState
          title={tx.common_not_set}
          description={tx.orders_subtitle}
          action={
            permissions.canCreate ? (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="mr-2 size-4" />
                New order
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {orders.map((order) => {
            const isSelected = order.id === selectedOrderId;
            return (
              <button
                key={order.id}
                type="button"
                onClick={() => openOrder(order.id)}
                className={cn(
                  "rounded-2xl border bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md",
                  isSelected
                    ? "border-sky-300 ring-4 ring-sky-100"
                    : "border-slate-200",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-mono text-xs font-semibold tracking-[0.16em] text-slate-500">
                      {order.order_number}
                    </div>
                    <h2 className="mt-2 text-lg font-semibold text-slate-950">
                      {order.patient_name}
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">{order.patient_pid}</p>
                  </div>
                  <ChevronRight className="mt-1 size-4 text-slate-400" />
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Badge variant="outline" className={cn("rounded-full", phaseClassName(order.phase))}>
                    {order.phase}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={cn("rounded-full", statusClassName(order.status))}
                  >
                    {order.status}
                  </Badge>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Created
                    </div>
                    <div className="mt-2 text-sm text-slate-900">
                      {formatDateOnly(order.created_at)}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Estimated
                    </div>
                    <div className="mt-2 text-sm text-slate-900">
                      {formatCurrency(order.total_estimated)}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <Sheet
        open={Boolean(selectedOrderId)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedOrderId(null);
            setOrderDetail(null);
            setWorkflowChecklist(null);
            setWorkflowAssignments([]);
            setDetailError(null);
            setPhaseDraft("");
            setProcessGateError(null);
            setProcessGateForm(blankOrderProcessGateForm());
            syncQuery({ order: null });
          }
        }}
      >
        <SheetContent
          side="right"
          className="w-full overflow-y-auto border-l border-slate-200 p-0 sm:max-w-3xl"
        >
          <SheetHeader className="border-b border-slate-200 px-6 py-5">
            <SheetTitle>
              {orderDetail ? `${orderDetail.order_number} / ${orderDetail.patient_name}` : tx.orders_title}
            </SheetTitle>
            <SheetDescription>
              Full operational view for the current order, including phase control and provider-linked Leistungen.
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-6 px-6 py-6">
            {detailLoading ? (
              <div className="rounded-2xl border border-slate-200 bg-white px-6 py-12 text-center text-sm text-slate-500 shadow-sm">
                <LoaderCircle className="mx-auto mb-3 size-5 animate-spin" />
                {t.common_loading}
              </div>
            ) : detailError ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {detailError}
              </div>
            ) : !orderDetail ? (
              <EmptyState
                title={tx.common_not_set}
                description={tx.orders_subtitle}
              />
            ) : (
              <>
                <SectionCard
                  title={tx.orders_title}
                  description={tx.orders_subtitle}
                  action={
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className={cn("rounded-full", phaseClassName(orderDetail.phase))}>
                        {orderDetail.phase}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={cn("rounded-full", statusClassName(orderDetail.status))}
                      >
                        {orderDetail.status}
                      </Badge>
                    </div>
                  }
                >
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <DetailField
                      label={t.orders_patient}
                      value={`${orderDetail.patient_name} (${orderDetail.patient_pid})`}
                    />
                    <DetailField
                      label={tx.patients_created}
                      value={
                        <span className="inline-flex items-center gap-2">
                          <CalendarClock className="size-4 text-slate-500" />
                          {formatDateTime(orderDetail.created_at)}
                        </span>
                      }
                    />
                    <DetailField
                      label={tx.common_loading}
                      value={
                        <span className="inline-flex items-center gap-2">
                          <RefreshCw className="size-4 text-slate-500" />
                          {formatDateTime(orderDetail.updated_at)}
                        </span>
                      }
                    />
                    <DetailField
                      label={tx.contracts_signed}
                      value={`${orderDetail.signed_patient ? tx.contracts_signed : tx.mfa_pending} / ${
                        orderDetail.signed_agency ? tx.contracts_signed : tx.mfa_pending
                      }`}
                    />
                    <DetailField
                      label={t.leads_needs}
                      value={orderDetail.needs_description || tx.common_not_set}
                    />
                    <DetailField
                      label={tx.invoices_subtotal}
                      value={formatCurrency(orderDetail.total_estimated)}
                    />
                    <DetailField
                      label={tx.invoices_total}
                      value={formatCurrency(orderDetail.total_actual)}
                    />
                    <DetailField
                      label={tx.providers_services}
                      value={`${leistungMetrics.total} items / ${leistungMetrics.delivered} delivered / ${leistungMetrics.approved} approved`}
                    />
                  </div>
                </SectionCard>

                <SectionCard
                  title={tx.providers_linked_patients}
                  description="Jump to the adjacent patient, case and appointment contexts without rebuilding filters manually."
                >
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-2xl"
                      onClick={() => navigate(`/patients?patient=${orderDetail.patient_id}`)}
                    >
                      Patient
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-2xl"
                      onClick={() => navigate(`/cases?patient=${orderDetail.patient_id}`)}
                    >
                      Cases
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-2xl"
                      onClick={() => navigate(`/appointments?patient=${orderDetail.patient_id}`)}
                    >
                      Appointments
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-2xl"
                      onClick={() => navigate(`/contracts?order=${orderDetail.id}&patient=${orderDetail.patient_id}&tab=quotes`)}
                    >
                      Contracts
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-2xl"
                      onClick={() => navigate(`/invoices?order=${orderDetail.id}&patient=${orderDetail.patient_id}`)}
                    >
                      Invoices
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-2xl"
                      onClick={() => navigate(`/documents?order=${orderDetail.id}&patient=${orderDetail.patient_id}`)}
                    >
                      Documents
                    </Button>
                  </div>
                </SectionCard>

                {orderDetail.process_gates ? (
                  <SectionCard
                    title="Process gates"
                    description="Finance-side execution gates for debt, billing release and package coverage."
                  >
                    <div className="space-y-4">
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <DetailField
                          label="Execution readiness"
                          value={
                            <Badge
                              variant="outline"
                              className={cn(
                                "rounded-full",
                                orderDetail.process_gates.execution_ready
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                  : "border-rose-200 bg-rose-50 text-rose-700"
                              )}
                            >
                              {orderDetail.process_gates.execution_ready ? "ready" : "blocked"}
                            </Badge>
                          }
                        />
                        <DetailField
                          label="Debt hold"
                          value={
                            orderDetail.process_gates.debt_management?.blocking_reason
                              ? orderDetail.process_gates.debt_management.blocking_reason
                              : orderDetail.process_gates.debt_hold
                                ? `${orderDetail.process_gates.overdue_invoice_count} overdue invoice(s)`
                                : "No overdue debt"
                          }
                        />
                        <DetailField
                          label="Debt workflow"
                          value={
                            orderDetail.process_gates.debt_management?.effective_status ?? "not_required"
                          }
                        />
                        <DetailField
                          label="Billing release"
                          value={orderDetail.process_gates.billing_release_status}
                        />
                        <DetailField
                          label="Package coverage"
                          value={orderDetail.process_gates.package_coverage_status}
                        />
                        <DetailField
                          label="Outstanding balance"
                          value={formatCurrency(orderDetail.process_gates.outstanding_balance)}
                        />
                      </div>

                      {orderDetail.process_gates.blocking_reasons.length > 0 ? (
                        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                          <div className="font-medium">Blocking reasons</div>
                          <ul className="mt-2 space-y-1">
                            {orderDetail.process_gates.blocking_reasons.map((reason) => (
                              <li key={reason}>• {reason}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}

                      {processGateError ? (
                        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                          {processGateError}
                        </div>
                      ) : null}

                      <div className="grid gap-4 xl:grid-cols-3">
                        {canManageDebt ? (
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <div className="text-sm font-semibold text-slate-900">
                              Debt management
                            </div>
                            <div className="mt-1 text-sm text-slate-500">
                              Track the active debt workflow, assign ownership and set the next review checkpoint.
                            </div>
                            <div className="mt-4 grid gap-3">
                              <select
                                value={processGateForm.debtStatus}
                                onChange={(event) =>
                                  setProcessGateForm((current) => ({
                                    ...current,
                                    debtStatus: event.target.value,
                                  }))
                                }
                                className={selectClassName}
                              >
                                {[
                                  "review_required",
                                  "payment_plan",
                                  "awaiting_payment",
                                  "escalated",
                                  "cleared",
                                  "not_required",
                                ].map((status) => (
                                  <option key={status} value={status}>
                                    {status}
                                  </option>
                                ))}
                              </select>
                              <select
                                value={processGateForm.debtOwnerUserId}
                                onChange={(event) =>
                                  setProcessGateForm((current) => ({
                                    ...current,
                                    debtOwnerUserId: event.target.value,
                                  }))
                                }
                                className={selectClassName}
                              >
                                <option value="">Keep current owner</option>
                                {debtOwnerOptions.map((item) => (
                                  <option key={item.user_id} value={item.user_id}>
                                    {item.user_name} · {item.user_role}
                                  </option>
                                ))}
                              </select>
                              <Input
                                type="datetime-local"
                                value={processGateForm.debtNextReviewAt}
                                onChange={(event) =>
                                  setProcessGateForm((current) => ({
                                    ...current,
                                    debtNextReviewAt: event.target.value,
                                  }))
                                }
                                className="h-10 rounded-xl bg-white"
                              />
                              <Input
                                type="datetime-local"
                                value={processGateForm.debtLastContactAt}
                                onChange={(event) =>
                                  setProcessGateForm((current) => ({
                                    ...current,
                                    debtLastContactAt: event.target.value,
                                  }))
                                }
                                className="h-10 rounded-xl bg-white"
                              />
                              <textarea
                                value={processGateForm.debtNote}
                                onChange={(event) =>
                                  setProcessGateForm((current) => ({
                                    ...current,
                                    debtNote: event.target.value,
                                  }))
                                }
                                className={textareaClassName}
                                placeholder="Debt-management note"
                              />
                              <textarea
                                value={processGateForm.debtResolutionNote}
                                onChange={(event) =>
                                  setProcessGateForm((current) => ({
                                    ...current,
                                    debtResolutionNote: event.target.value,
                                  }))
                                }
                                className={textareaClassName}
                                placeholder="Resolution note"
                              />
                              <div className="grid gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-3 text-xs text-slate-500">
                                <div>
                                  Owner: {orderDetail.process_gates.debt_management?.owner_name ?? "Not assigned"}
                                </div>
                                <div>
                                  Last contact: {formatDateTime(orderDetail.process_gates.debt_management?.last_contact_at)}
                                </div>
                                <div>
                                  Next review: {formatDateTime(orderDetail.process_gates.debt_management?.next_review_at)}
                                </div>
                                <div>
                                  Resolved: {formatDateTime(orderDetail.process_gates.debt_management?.resolved_at)}
                                </div>
                              </div>
                              <div className="flex justify-end">
                                <Button
                                  type="button"
                                  onClick={() => void handleSaveDebtManagement()}
                                  disabled={processGateBusy}
                                >
                                  {processGateBusy ? (
                                    <LoaderCircle className="mr-2 size-4 animate-spin" />
                                  ) : null}
                                  Save debt workflow
                                </Button>
                              </div>
                            </div>
                          </div>
                        ) : null}

                        {user?.role === "billing" || user?.role === "ceo" ? (
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <div className="text-sm font-semibold text-slate-900">
                              Billing release
                            </div>
                            <div className="mt-1 text-sm text-slate-500">
                              Abrechnung decides whether execution may continue outside package coverage.
                            </div>
                            <div className="mt-4 space-y-3">
                              <select
                                value={processGateForm.billingReleaseStatus}
                                onChange={(event) =>
                                  setProcessGateForm((current) => ({
                                    ...current,
                                    billingReleaseStatus: event.target.value,
                                  }))
                                }
                                className={selectClassName}
                              >
                                <option value="pending">pending</option>
                                <option value="granted">granted</option>
                                <option value="denied">denied</option>
                              </select>
                              <textarea
                                value={processGateForm.billingReleaseNote}
                                onChange={(event) =>
                                  setProcessGateForm((current) => ({
                                    ...current,
                                    billingReleaseNote: event.target.value,
                                  }))
                                }
                                className={textareaClassName}
                                placeholder="Billing note"
                              />
                              <div className="flex justify-end">
                                <Button
                                  type="button"
                                  onClick={() => void handleSaveBillingRelease()}
                                  disabled={processGateBusy}
                                >
                                  {processGateBusy ? (
                                    <LoaderCircle className="mr-2 size-4 animate-spin" />
                                  ) : null}
                                  Save billing gate
                                </Button>
                              </div>
                            </div>
                          </div>
                        ) : null}

                        {user?.role === "patient_manager" || user?.role === "ceo" ? (
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <div className="text-sm font-semibold text-slate-900">
                              Package coverage
                            </div>
                            <div className="mt-1 text-sm text-slate-500">
                              Existing-package coverage can unblock repeat work without a separate billing release.
                            </div>
                            <div className="mt-4 space-y-3">
                              <select
                                value={processGateForm.packageCoverageStatus}
                                onChange={(event) =>
                                  setProcessGateForm((current) => ({
                                    ...current,
                                    packageCoverageStatus: event.target.value,
                                  }))
                                }
                                className={selectClassName}
                              >
                                <option value="unknown">unknown</option>
                                <option value="covered">covered</option>
                                <option value="not_covered">not covered</option>
                              </select>
                              <textarea
                                value={processGateForm.packageCoverageNote}
                                onChange={(event) =>
                                  setProcessGateForm((current) => ({
                                    ...current,
                                    packageCoverageNote: event.target.value,
                                  }))
                                }
                                className={textareaClassName}
                                placeholder="Coverage note"
                              />
                              <div className="flex justify-end">
                                <Button
                                  type="button"
                                  onClick={() => void handleSavePackageCoverage()}
                                  disabled={processGateBusy}
                                >
                                  {processGateBusy ? (
                                    <LoaderCircle className="mr-2 size-4 animate-spin" />
                                  ) : null}
                                  Save package gate
                                </Button>
                              </div>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </SectionCard>
                ) : null}

                {orderDetail.planning_preparation ? (
                  <SectionCard
                    title="Planning and preparation"
                    description="Treatment-plan finalization, slot booking, interpreter handoff and prep-document delivery before execution starts."
                  >
                    <div className="space-y-4">
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <DetailField
                          label="Planning readiness"
                          value={
                            <Badge
                              variant="outline"
                              className={cn(
                                "rounded-full",
                                orderDetail.planning_preparation.planning_ready
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                  : "border-amber-200 bg-amber-50 text-amber-700",
                              )}
                            >
                              {orderDetail.planning_preparation.planning_ready
                                ? "ready"
                                : "blocked"}
                            </Badge>
                          }
                        />
                        <DetailField
                          label="Treatment plan"
                          value={orderDetail.planning_preparation.treatment_plan_status}
                        />
                        <DetailField
                          label="Medical bookings"
                          value={`${orderDetail.planning_preparation.medical_confirmed}/${orderDetail.planning_preparation.medical_total} confirmed`}
                        />
                        <DetailField
                          label="Preparation documents"
                          value={orderDetail.planning_preparation.preparation_documents_status}
                        />
                      </div>

                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <DetailField
                          label="Non-medical flow"
                          value={
                            orderDetail.planning_preparation.non_medical_required
                              ? `${orderDetail.planning_preparation.non_medical_confirmed}/${orderDetail.planning_preparation.non_medical_total} confirmed`
                              : "Not required"
                          }
                        />
                        <DetailField
                          label="Interpreter"
                          value={
                            orderDetail.planning_preparation.interpreter_required
                              ? `${orderDetail.planning_preparation.interpreter_assigned} assigned / ${orderDetail.planning_preparation.interpreter_confirmed} accepted`
                              : "Not required"
                          }
                        />
                        <DetailField
                          label="Interpreter briefing"
                          value={orderDetail.planning_preparation.interpreter_briefing_status}
                        />
                        <DetailField
                          label="Latest milestone"
                          value={
                            orderDetail.planning_preparation.plan_finalized_at
                              ? `Plan ${formatDateTime(
                                  orderDetail.planning_preparation.plan_finalized_at,
                                )}`
                              : "No planning milestone yet"
                          }
                        />
                      </div>

                      {orderDetail.planning_preparation.blocking_reasons.length > 0 ? (
                        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                          <div className="font-medium">Execution blockers from planning</div>
                          <ul className="mt-2 space-y-1">
                            {orderDetail.planning_preparation.blocking_reasons.map((reason) => (
                              <li key={reason}>• {reason}</li>
                            ))}
                          </ul>
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                          Planning and preparation requirements are complete for execution.
                        </div>
                      )}

                      {planningError ? (
                        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                          {planningError}
                        </div>
                      ) : null}

                      {user?.role === "patient_manager" || user?.role === "ceo" ? (
                        <div className="grid gap-4 xl:grid-cols-2">
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <div className="text-sm font-semibold text-slate-900">
                              Planning controls
                            </div>
                            <div className="mt-1 text-sm text-slate-500">
                              Lock the treatment plan, declare if non-medical services or
                              interpreter support are still required, and mark prep documents.
                            </div>
                            <div className="mt-4 space-y-3">
                              <select
                                value={planningForm.treatmentPlanStatus}
                                onChange={(event) =>
                                  setPlanningForm((current) => ({
                                    ...current,
                                    treatmentPlanStatus: event.target.value,
                                  }))
                                }
                                className={selectClassName}
                              >
                                <option value="draft">draft</option>
                                <option value="agreed">agreed</option>
                                <option value="correction_requested">
                                  correction requested
                                </option>
                                <option value="finalized">finalized</option>
                              </select>
                              <textarea
                                value={planningForm.treatmentPlanNote}
                                onChange={(event) =>
                                  setPlanningForm((current) => ({
                                    ...current,
                                    treatmentPlanNote: event.target.value,
                                  }))
                                }
                                className={textareaClassName}
                                placeholder="Treatment-plan note"
                              />
                              <label className="flex items-center gap-2 text-sm text-slate-700">
                                <input
                                  type="checkbox"
                                  checked={planningForm.nonMedicalRequired}
                                  onChange={(event) =>
                                    setPlanningForm((current) => ({
                                      ...current,
                                      nonMedicalRequired: event.target.checked,
                                    }))
                                  }
                                />
                                Non-medical services required
                              </label>
                              <label className="flex items-center gap-2 text-sm text-slate-700">
                                <input
                                  type="checkbox"
                                  checked={planningForm.interpreterRequired}
                                  onChange={(event) =>
                                    setPlanningForm((current) => ({
                                      ...current,
                                      interpreterRequired: event.target.checked,
                                      interpreterBriefingStatus: event.target.checked
                                        ? current.interpreterBriefingStatus === "not_needed"
                                          ? "pending"
                                          : current.interpreterBriefingStatus
                                        : "not_needed",
                                    }))
                                  }
                                />
                                Interpreter required
                              </label>
                              <select
                                value={planningForm.preparationDocumentsStatus}
                                onChange={(event) =>
                                  setPlanningForm((current) => ({
                                    ...current,
                                    preparationDocumentsStatus: event.target.value,
                                  }))
                                }
                                className={selectClassName}
                              >
                                <option value="pending">documents pending</option>
                                <option value="sent">documents sent</option>
                                <option value="not_required">documents not required</option>
                              </select>
                              <select
                                value={planningForm.interpreterBriefingStatus}
                                onChange={(event) =>
                                  setPlanningForm((current) => ({
                                    ...current,
                                    interpreterBriefingStatus: event.target.value,
                                  }))
                                }
                                className={selectClassName}
                                disabled={!planningForm.interpreterRequired}
                              >
                                <option value="not_needed">not needed</option>
                                <option value="pending">briefing pending</option>
                                <option value="completed">briefing completed</option>
                              </select>
                              <div className="flex justify-end">
                                <Button
                                  type="button"
                                  onClick={() => void handleSavePlanningPreparation()}
                                  disabled={planningBusy}
                                >
                                  {planningBusy ? (
                                    <LoaderCircle className="mr-2 size-4 animate-spin" />
                                  ) : null}
                                  Save planning state
                                </Button>
                              </div>
                            </div>
                          </div>

                          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <div className="text-sm font-semibold text-slate-900">
                              Operational handoff
                            </div>
                            <div className="mt-1 text-sm text-slate-500">
                              Use the linked workspaces to confirm medical slots, non-medical
                              services, interpreter assignment and preparation documents.
                            </div>
                            <div className="mt-4 grid gap-3">
                              <Button
                                type="button"
                                variant="outline"
                                className="justify-start rounded-xl"
                                onClick={() =>
                                  navigate(`/appointments?order=${orderDetail.id}&patient=${orderDetail.patient_id}`)
                                }
                              >
                                Medical and non-medical appointments
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                className="justify-start rounded-xl"
                                onClick={() =>
                                  navigate(`/documents?order=${orderDetail.id}&patient=${orderDetail.patient_id}`)
                                }
                              >
                                Preparation documents
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                className="justify-start rounded-xl"
                                onClick={() =>
                                  navigate(`/appointments?order=${orderDetail.id}&patient=${orderDetail.patient_id}`)
                                }
                              >
                                Interpreter assignment and briefing
                              </Button>
                              {orderDetail.planning_preparation.treatment_plan_note ? (
                                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                                  {orderDetail.planning_preparation.treatment_plan_note}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </SectionCard>
                ) : null}

                {orderDetail.execution_flow ? (
                  <SectionCard
                    title="Execution flow"
                    description="Arrival, delivered services, interpreter support and deviation handling before the order can move to closure."
                  >
                    <div className="space-y-4">
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <DetailField
                          label="Closure readiness"
                          value={
                            <Badge
                              variant="outline"
                              className={cn(
                                "rounded-full",
                                orderDetail.execution_flow.closure_ready
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                  : "border-amber-200 bg-amber-50 text-amber-700",
                              )}
                            >
                              {orderDetail.execution_flow.closure_ready ? "ready" : "blocked"}
                            </Badge>
                          }
                        />
                        <DetailField
                          label="Arrival"
                          value={orderDetail.execution_flow.arrival_status}
                        />
                        <DetailField
                          label="Medical execution"
                          value={`${orderDetail.execution_flow.medical_execution_status} · ${orderDetail.execution_flow.medical_completed} visit(s) / ${orderDetail.execution_flow.delivered_leistungen} line(s)`}
                        />
                        <DetailField
                          label="Open execution checklist"
                          value={String(orderDetail.execution_flow.open_execution_checklist_count)}
                        />
                      </div>

                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <DetailField
                          label="Non-medical execution"
                          value={
                            orderDetail.execution_flow.non_medical_required
                              ? `${orderDetail.execution_flow.non_medical_execution_status} · ${orderDetail.execution_flow.non_medical_completed} visit(s) / ${orderDetail.execution_flow.concierge_completed} concierge service(s)`
                              : "Not required"
                          }
                        />
                        <DetailField
                          label="Interpreter support"
                          value={
                            orderDetail.execution_flow.interpreter_required
                              ? `${orderDetail.execution_flow.interpreter_service_status} · ${orderDetail.execution_flow.approved_interpreter_reports} approved report(s)`
                              : "Not required"
                          }
                        />
                        <DetailField
                          label="Deviation handling"
                          value={orderDetail.execution_flow.issue_status}
                        />
                        <DetailField
                          label="Execution documents"
                          value={String(orderDetail.execution_flow.execution_documents)}
                        />
                      </div>

                      {orderDetail.execution_flow.blocking_reasons.length > 0 ? (
                        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                          <div className="font-medium">Closure blockers from execution</div>
                          <ul className="mt-2 space-y-1">
                            {orderDetail.execution_flow.blocking_reasons.map((reason) => (
                              <li key={reason}>• {reason}</li>
                            ))}
                          </ul>
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                          Execution evidence and operational handoff are complete for closure.
                        </div>
                      )}

                      {executionError ? (
                        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                          {executionError}
                        </div>
                      ) : null}

                      <div className="grid gap-4 xl:grid-cols-2">
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                          <div className="text-sm font-semibold text-slate-900">
                            Execution controls
                          </div>
                          <div className="mt-1 text-sm text-slate-500">
                            Confirm arrival, delivered scope and whether execution deviations are resolved.
                          </div>
                          <div className="mt-4 space-y-3">
                            <select
                              value={executionForm.arrivalStatus}
                              onChange={(event) =>
                                setExecutionForm((current) => ({
                                  ...current,
                                  arrivalStatus: event.target.value,
                                }))
                              }
                              className={selectClassName}
                            >
                              <option value="pending">arrival pending</option>
                              <option value="arrived">arrived</option>
                              <option value="not_required">not required</option>
                            </select>
                            <select
                              value={executionForm.medicalExecutionStatus}
                              onChange={(event) =>
                                setExecutionForm((current) => ({
                                  ...current,
                                  medicalExecutionStatus: event.target.value,
                                }))
                              }
                              className={selectClassName}
                            >
                              <option value="pending">medical pending</option>
                              <option value="in_progress">medical in progress</option>
                              <option value="completed">medical completed</option>
                              <option value="not_required">medical not required</option>
                            </select>
                            <select
                              value={executionForm.nonMedicalExecutionStatus}
                              onChange={(event) =>
                                setExecutionForm((current) => ({
                                  ...current,
                                  nonMedicalExecutionStatus: event.target.value,
                                }))
                              }
                              className={selectClassName}
                              disabled={!orderDetail.execution_flow.non_medical_required}
                            >
                              <option value="not_required">non-medical not required</option>
                              <option value="pending">non-medical pending</option>
                              <option value="in_progress">non-medical in progress</option>
                              <option value="completed">non-medical completed</option>
                            </select>
                            <select
                              value={executionForm.interpreterServiceStatus}
                              onChange={(event) =>
                                setExecutionForm((current) => ({
                                  ...current,
                                  interpreterServiceStatus: event.target.value,
                                }))
                              }
                              className={selectClassName}
                              disabled={!orderDetail.execution_flow.interpreter_required}
                            >
                              <option value="not_required">interpreter not required</option>
                              <option value="pending">interpreter pending</option>
                              <option value="in_progress">interpreter in progress</option>
                              <option value="completed">interpreter completed</option>
                            </select>
                            <select
                              value={executionForm.issueStatus}
                              onChange={(event) =>
                                setExecutionForm((current) => ({
                                  ...current,
                                  issueStatus: event.target.value,
                                }))
                              }
                              className={selectClassName}
                            >
                              <option value="pending">issues pending</option>
                              <option value="monitoring">issues under monitoring</option>
                              <option value="resolved">issues resolved</option>
                              <option value="not_required">no issues</option>
                            </select>
                            <textarea
                              value={executionForm.deviationNote}
                              onChange={(event) =>
                                setExecutionForm((current) => ({
                                  ...current,
                                  deviationNote: event.target.value,
                                }))
                              }
                              className={textareaClassName}
                              placeholder="Deviation note or unresolved operational detail"
                            />
                            <textarea
                              value={executionForm.executionSummary}
                              onChange={(event) =>
                                setExecutionForm((current) => ({
                                  ...current,
                                  executionSummary: event.target.value,
                                }))
                              }
                              className={textareaClassName}
                              placeholder="Arrival, delivered scope, clinic notes, service outcome..."
                            />
                            <div className="flex justify-end">
                              <Button
                                type="button"
                                onClick={() => void handleSaveExecutionFlow()}
                                disabled={executionBusy}
                              >
                                {executionBusy ? (
                                  <LoaderCircle className="mr-2 size-4 animate-spin" />
                                ) : null}
                                Save execution state
                              </Button>
                            </div>
                          </div>
                        </div>

                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                          <div className="text-sm font-semibold text-slate-900">
                            Execution evidence
                          </div>
                          <div className="mt-1 text-sm text-slate-500">
                            Use linked workspaces to close the remaining operational trail.
                          </div>
                          <div className="mt-4 grid gap-3">
                            <DetailField
                              label="Arrival recorded"
                              value={formatDateTime(orderDetail.execution_flow.arrival_recorded_at)}
                            />
                            <DetailField
                              label="Medical completed"
                              value={formatDateTime(orderDetail.execution_flow.medical_completed_at)}
                            />
                            <DetailField
                              label="Non-medical completed"
                              value={formatDateTime(orderDetail.execution_flow.non_medical_completed_at)}
                            />
                            <DetailField
                              label="Issues resolved"
                              value={formatDateTime(orderDetail.execution_flow.issues_resolved_at)}
                            />
                            <div className="flex flex-wrap gap-3 pt-2">
                              <Button
                                type="button"
                                variant="outline"
                                className="rounded-xl"
                                onClick={() =>
                                  navigate(`/appointments?order=${orderDetail.id}&patient=${orderDetail.patient_id}`)
                                }
                              >
                                Appointments
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                className="rounded-xl"
                                onClick={() =>
                                  navigate(`/documents?order=${orderDetail.id}&patient=${orderDetail.patient_id}`)
                                }
                              >
                                Documents
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                className="rounded-xl"
                                onClick={() =>
                                  navigate(`/providers?patient=${orderDetail.patient_id}`)
                                }
                              >
                                Providers
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </SectionCard>
                ) : null}

                {orderDetail.followup_flow ? (
                  <SectionCard
                    title="Follow-up flow"
                    description="Launch post-care milestones, package-end outreach and final patient handoff before the order enters follow-up."
                  >
                    <div className="space-y-4">
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <DetailField
                          label="Follow-up readiness"
                          value={
                            <Badge
                              variant="outline"
                              className={cn(
                                "rounded-full",
                                orderDetail.followup_flow.followup_ready
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                  : "border-amber-200 bg-amber-50 text-amber-700",
                              )}
                            >
                              {orderDetail.followup_flow.followup_ready ? "ready" : "blocked"}
                            </Badge>
                          }
                        />
                        <DetailField
                          label="Results handoff"
                          value={orderDetail.followup_flow.results_handoff_status}
                        />
                        <DetailField
                          label="Follow-up activity"
                          value={`${orderDetail.followup_flow.followup_appointments_total} appointment(s) / ${orderDetail.followup_flow.followup_1w_reminders + orderDetail.followup_flow.followup_1m_reminders + orderDetail.followup_flow.followup_6m_reminders + orderDetail.followup_flow.package_end_reminders} reminder(s)`}
                        />
                        <DetailField
                          label="Portal releases"
                          value={String(orderDetail.followup_flow.results_portal_shares)}
                        />
                      </div>

                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <DetailField
                          label="Doctor-directed"
                          value={orderDetail.followup_flow.doctor_followup_status}
                        />
                        <DetailField
                          label="1w / 1m / 6m"
                          value={`${orderDetail.followup_flow.followup_1w_status} / ${orderDetail.followup_flow.followup_1m_status} / ${orderDetail.followup_flow.followup_6m_status}`}
                        />
                        <DetailField
                          label="Package end"
                          value={
                            orderDetail.followup_flow.package_end_required
                              ? `${orderDetail.followup_flow.package_end_status} · ${formatDateOnly(
                                  orderDetail.followup_flow.package_end_date ??
                                    orderDetail.followup_flow.suggested_package_end_date,
                                )}`
                              : "Not required"
                          }
                        />
                        <DetailField
                          label="Closure anchor"
                          value={formatDateTime(orderDetail.followup_flow.closure_anchor_at)}
                        />
                      </div>

                      {orderDetail.followup_flow.blocking_reasons.length > 0 ? (
                        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                          <div className="font-medium">Follow-up launch blockers</div>
                          <ul className="mt-2 space-y-1">
                            {orderDetail.followup_flow.blocking_reasons.map((reason) => (
                              <li key={reason}>• {reason}</li>
                            ))}
                          </ul>
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                          Follow-up milestones and handoff are launched for the post-care phase.
                        </div>
                      )}

                      {followupError ? (
                        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                          {followupError}
                        </div>
                      ) : null}

                      <div className="grid gap-4 xl:grid-cols-2">
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                          <div className="text-sm font-semibold text-slate-900">
                            Follow-up controls
                          </div>
                          <div className="mt-1 text-sm text-slate-500">
                            Mark which milestones are required and whether the final handoff to the patient is complete.
                          </div>
                          <div className="mt-4 space-y-3">
                            <select
                              value={followupForm.doctorFollowupStatus}
                              onChange={(event) =>
                                setFollowupForm((current) => ({
                                  ...current,
                                  doctorFollowupStatus: event.target.value,
                                }))
                              }
                              className={selectClassName}
                            >
                              <option value="not_required">doctor follow-up not required</option>
                              <option value="pending">doctor follow-up pending</option>
                              <option value="scheduled">doctor follow-up scheduled</option>
                              <option value="completed">doctor follow-up completed</option>
                            </select>
                            <div className="grid gap-3 md:grid-cols-3">
                              <select
                                value={followupForm.followup1wStatus}
                                onChange={(event) =>
                                  setFollowupForm((current) => ({
                                    ...current,
                                    followup1wStatus: event.target.value,
                                  }))
                                }
                                className={selectClassName}
                              >
                                <option value="pending">1w pending</option>
                                <option value="scheduled">1w scheduled</option>
                                <option value="completed">1w completed</option>
                                <option value="not_required">1w not required</option>
                              </select>
                              <select
                                value={followupForm.followup1mStatus}
                                onChange={(event) =>
                                  setFollowupForm((current) => ({
                                    ...current,
                                    followup1mStatus: event.target.value,
                                  }))
                                }
                                className={selectClassName}
                              >
                                <option value="pending">1m pending</option>
                                <option value="scheduled">1m scheduled</option>
                                <option value="completed">1m completed</option>
                                <option value="not_required">1m not required</option>
                              </select>
                              <select
                                value={followupForm.followup6mStatus}
                                onChange={(event) =>
                                  setFollowupForm((current) => ({
                                    ...current,
                                    followup6mStatus: event.target.value,
                                  }))
                                }
                                className={selectClassName}
                              >
                                <option value="pending">6m pending</option>
                                <option value="scheduled">6m scheduled</option>
                                <option value="completed">6m completed</option>
                                <option value="not_required">6m not required</option>
                              </select>
                            </div>
                            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
                              <Input
                                type="date"
                                value={followupForm.packageEndDate}
                                onChange={(event) =>
                                  setFollowupForm((current) => ({
                                    ...current,
                                    packageEndDate: event.target.value,
                                  }))
                                }
                                className="h-10 rounded-xl bg-white"
                              />
                              <select
                                value={followupForm.packageEndStatus}
                                onChange={(event) =>
                                  setFollowupForm((current) => ({
                                    ...current,
                                    packageEndStatus: event.target.value,
                                  }))
                                }
                                className={selectClassName}
                              >
                                <option value="not_required">package-end not required</option>
                                <option value="pending">package-end pending</option>
                                <option value="scheduled">package-end scheduled</option>
                                <option value="completed">package-end completed</option>
                              </select>
                            </div>
                            <select
                              value={followupForm.resultsHandoffStatus}
                              onChange={(event) =>
                                setFollowupForm((current) => ({
                                  ...current,
                                  resultsHandoffStatus: event.target.value,
                                }))
                              }
                              className={selectClassName}
                            >
                              <option value="pending">results handoff pending</option>
                              <option value="completed">results handoff completed</option>
                              <option value="not_required">results handoff not required</option>
                            </select>
                            <textarea
                              value={followupForm.followupSummary}
                              onChange={(event) =>
                                setFollowupForm((current) => ({
                                  ...current,
                                  followupSummary: event.target.value,
                                }))
                              }
                              className={textareaClassName}
                              placeholder="Patient communication, Arztbrief handoff, outreach plan..."
                            />
                            <div className="flex justify-end">
                              <Button
                                type="button"
                                onClick={() => void handleSaveFollowupFlow()}
                                disabled={followupBusy}
                              >
                                {followupBusy ? (
                                  <LoaderCircle className="mr-2 size-4 animate-spin" />
                                ) : null}
                                Save follow-up state
                              </Button>
                            </div>
                          </div>
                        </div>

                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                          <div className="text-sm font-semibold text-slate-900">
                            Recommended milestone anchors
                          </div>
                          <div className="mt-1 text-sm text-slate-500">
                            Existing appointment presets and portal visibility read from these order-level milestones.
                          </div>
                          <div className="mt-4 grid gap-3">
                            <DetailField
                              label="1-week target"
                              value={formatDateTime(orderDetail.followup_flow.recommended_followup_1w_at)}
                            />
                            <DetailField
                              label="1-month target"
                              value={formatDateTime(orderDetail.followup_flow.recommended_followup_1m_at)}
                            />
                            <DetailField
                              label="6-month target"
                              value={formatDateTime(orderDetail.followup_flow.recommended_followup_6m_at)}
                            />
                            <DetailField
                              label="Package-end outreach"
                              value={formatDateOnly(orderDetail.followup_flow.recommended_package_end_followup_at)}
                            />
                            <div className="flex flex-wrap gap-3 pt-2">
                              <Button
                                type="button"
                                variant="outline"
                                className="rounded-xl"
                                onClick={() =>
                                  navigate(`/appointments?order=${orderDetail.id}&patient=${orderDetail.patient_id}`)
                                }
                              >
                                Appointments
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                className="rounded-xl"
                                onClick={() =>
                                  navigate(`/documents?order=${orderDetail.id}&patient=${orderDetail.patient_id}`)
                                }
                              >
                                Documents
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                className="rounded-xl"
                                onClick={() =>
                                  navigate(`/patients/${orderDetail.patient_id}`)
                                }
                              >
                                Patient profile
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </SectionCard>
                ) : null}

                <SectionCard
                  title={tx.orders_phase}
                  description="Lifecycle transitions are sequential and recorded in workflow history."
                  action={
                    permissions.canManagePhase && orderDetail.lifecycle?.next_stage ? (
                      <Button
                        variant="outline"
                        onClick={() => void handleAdvancePhase()}
                        disabled={Boolean(nextLifecycleTransition?.blocked)}
                      >
                        <ChevronRight className="mr-2 size-4" />
                        Advance to {orderDetail.lifecycle.next_stage}
                      </Button>
                    ) : null
                  }
                >
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
                    <div className="flex flex-wrap gap-2">
                      {ORDER_PHASES.map((phase) => {
                        const isCurrent = orderDetail.phase === phase;
                        const isNext = orderDetail.lifecycle?.next_stage === phase;
                        const disabled =
                          !permissions.canManagePhase || (!isCurrent && !isNext);
                        return (
                        <button
                          key={phase}
                          type="button"
                          disabled={disabled}
                          onClick={() => setPhaseDraft(phase)}
                          className={cn(
                            "rounded-full border px-3 py-2 text-sm transition",
                            phaseDraft === phase
                              ? phaseClassName(phase)
                              : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
                            disabled && "cursor-not-allowed opacity-60",
                          )}
                        >
                          {phase}
                          {isCurrent ? " (current)" : isNext ? " (next)" : ""}
                        </button>
                        );
                      })}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {permissions.canManagePhase ? (
                        <Button
                          onClick={() => void handleSavePhase()}
                          disabled={
                            phaseSaving ||
                            !phaseDraft ||
                            phaseDraft === orderDetail.phase ||
                            (orderDetail.lifecycle?.next_stage != null &&
                              phaseDraft !== orderDetail.lifecycle.next_stage) ||
                            Boolean(nextLifecycleTransition?.blocked)
                          }
                        >
                          {phaseSaving ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
                          Save phase
                        </Button>
                      ) : (
                        <Badge
                          variant="outline"
                          className="rounded-full border-slate-200 bg-slate-100 text-slate-600"
                        >
                          Billing read-only
                        </Badge>
                      )}
                    </div>
                  </div>
                  {orderDetail.lifecycle?.stage_entered_at ? (
                    <p className="mt-4 text-sm text-slate-600">
                      Current phase entered {formatDateTime(orderDetail.lifecycle.stage_entered_at)}.
                    </p>
                  ) : null}
                  {nextLifecycleTransition?.blocked && nextLifecycleTransition.reasons.length > 0 ? (
                    <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                      <div className="font-medium">
                        {nextLifecycleTransition.phase} is blocked
                      </div>
                      <ul className="mt-2 space-y-1">
                        {nextLifecycleTransition.reasons.map((reason) => (
                          <li key={reason}>• {reason}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {phaseError ? (
                    <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                      {phaseError}
                    </div>
                  ) : null}
                  {orderDetail.lifecycle?.history?.length ? (
                    <div className="mt-4 space-y-3">
                      {orderDetail.lifecycle.history.map((event, index) => (
                        <div
                          key={`${event.created_at}-${event.to_stage}-${index}`}
                          className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium text-slate-900">
                                {event.from_stage
                                  ? `${event.from_stage} -> ${event.to_stage}`
                                  : event.to_stage}
                              </p>
                              <p className="mt-1 text-xs uppercase tracking-[0.14em] text-slate-500">
                                {event.transition_kind}
                              </p>
                            </div>
                            <span className="text-xs text-slate-500">
                              {formatDateTime(event.created_at)}
                            </span>
                          </div>
                          {event.note ? (
                            <p className="mt-2 text-sm text-slate-600">{event.note}</p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </SectionCard>

                <SectionCard
                  title="Workflow checklist"
                  description="Auto-generated PM and concierge to-do items for this order."
                >
                  {workflowChecklist ? (
                    <div className="space-y-4">
                      <div className="grid gap-3 md:grid-cols-3">
                        <DetailField
                          label="Open"
                          value={String(workflowChecklist.open_count)}
                        />
                        <DetailField
                          label="Completed"
                          value={String(workflowChecklist.completed_count)}
                        />
                        <DetailField
                          label="Groups"
                          value={String(workflowChecklistGroups.length)}
                        />
                      </div>

                      {workflowChecklistGroups.length === 0 ? (
                        <EmptyState
                          title="No workflow items yet"
                          description="Checklist items are generated from the order phase and can be extended manually."
                        />
                      ) : (
                        <div className="space-y-4">
                          {workflowChecklistGroups.map((group) => (
                            <div
                              key={group.key}
                              className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                                    {group.label}
                                  </p>
                                  <p className="mt-1 text-sm text-slate-600">
                                    {group.items.filter((item) => !item.is_completed).length} open /{" "}
                                    {group.items.length} total
                                  </p>
                                </div>
                                <Badge variant="outline" className="rounded-full border-slate-200 bg-white text-slate-700">
                                  {group.items.length} items
                                </Badge>
                              </div>
                              <div className="mt-4 space-y-3">
                                {group.items.map((item) => (
                                  <div
                                    key={item.id}
                                    className={cn(
                                      "rounded-2xl border px-4 py-4",
                                      item.is_completed
                                        ? "border-emerald-200 bg-emerald-50/70"
                                        : "border-slate-200 bg-white"
                                    )}
                                  >
                                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                      <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <p className="text-sm font-medium text-slate-950">
                                            {item.item_text}
                                          </p>
                                          <Badge
                                            variant="outline"
                                            className={cn(
                                              "rounded-full text-[10px]",
                                              priorityBadgeClass(item.priority)
                                            )}
                                          >
                                            {item.priority}
                                          </Badge>
                                          <Badge
                                            variant="outline"
                                            className={cn(
                                              "rounded-full text-[10px]",
                                              item.is_completed
                                                ? "border-emerald-200 bg-emerald-100 text-emerald-800"
                                                : statusClassName(item.linked_task_status ?? "open")
                                            )}
                                          >
                                            {item.is_completed
                                              ? "completed"
                                              : item.linked_task_status ?? "open"}
                                          </Badge>
                                        </div>
                                        <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
                                          <span>
                                            Owner:{" "}
                                            {item.owner_name
                                              ? `${item.owner_name} · ${item.owner_user_role ?? item.owner_role}`
                                              : item.owner_role}
                                          </span>
                                          <span>
                                            Due: {formatDateTime(item.due_date)}
                                          </span>
                                          {item.completed_at ? (
                                            <span>
                                              Completed: {formatDateTime(item.completed_at)}
                                            </span>
                                          ) : null}
                                        </div>
                                      </div>
                                      {!item.is_completed ? (
                                        <Button
                                          type="button"
                                          variant="outline"
                                          className="rounded-xl"
                                          disabled={workflowBusy}
                                          onClick={() =>
                                            void handleCompleteWorkflowItem(item.id)
                                          }
                                        >
                                          Complete
                                        </Button>
                                      ) : null}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {permissions.canManagePhase ? (
                        <form
                          onSubmit={handleAddWorkflowItem}
                          className="rounded-2xl border border-slate-200 bg-white p-4"
                        >
                          <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-2 md:col-span-2">
                              <Label htmlFor="order-workflow-item">Checklist item</Label>
                              <Input
                                id="order-workflow-item"
                                value={workflowForm.itemText}
                                onChange={(event) =>
                                  setWorkflowForm((current) => ({
                                    ...current,
                                    itemText: event.target.value,
                                  }))
                                }
                                className="h-10 rounded-xl bg-slate-50"
                                placeholder="Escalation call, clinic follow-up, document handoff..."
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="order-workflow-owner">Owner</Label>
                              <select
                                id="order-workflow-owner"
                                className={selectClassName}
                                value={workflowForm.ownerUserId}
                                onChange={(event) =>
                                  setWorkflowForm((current) => ({
                                    ...current,
                                    ownerUserId: event.target.value,
                                  }))
                                }
                              >
                                <option value="">Current user</option>
                                {activeWorkflowAssignments.map((item) => (
                                  <option key={item.user_id} value={item.user_id}>
                                    {item.user_name} · {item.user_role}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="order-workflow-priority">Priority</Label>
                              <select
                                id="order-workflow-priority"
                                className={selectClassName}
                                value={workflowForm.priority}
                                onChange={(event) =>
                                  setWorkflowForm((current) => ({
                                    ...current,
                                    priority: event.target.value,
                                  }))
                                }
                              >
                                {["low", "normal", "high", "urgent"].map((priority) => (
                                  <option key={priority} value={priority}>
                                    {priority}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="order-workflow-due">Due at</Label>
                              <Input
                                id="order-workflow-due"
                                type="datetime-local"
                                value={workflowForm.dueDate}
                                onChange={(event) =>
                                  setWorkflowForm((current) => ({
                                    ...current,
                                    dueDate: event.target.value,
                                  }))
                                }
                                className="h-10 rounded-xl bg-slate-50"
                              />
                            </div>
                          </div>
                          <div className="mt-4 flex justify-end">
                            <Button
                              type="submit"
                              disabled={workflowBusy || !workflowForm.itemText.trim()}
                            >
                              {workflowBusy ? (
                                <LoaderCircle className="mr-2 size-4 animate-spin" />
                              ) : null}
                              Add workflow item
                            </Button>
                          </div>
                        </form>
                      ) : null}
                    </div>
                  ) : (
                    <EmptyState
                      title="No workflow items yet"
                      description="Checklist items are generated from the current phase once the order context is loaded."
                    />
                  )}
                </SectionCard>

                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <StatCard
                    label={tx.providers_services}
                    value={String(leistungMetrics.total)}
                    description="Current service lines attached to this order."
                    icon={<ClipboardList className="size-4" />}
                  />
                  <StatCard
                    label={tx.common_active}
                    value={String(leistungMetrics.delivered)}
                    description="Service lines waiting for PM approval."
                    icon={<CheckCircle2 className="size-4" />}
                  />
                  <StatCard
                    label={tx.common_active}
                    value={String(leistungMetrics.approved)}
                    description="Lines already approved in the current order."
                    icon={<Wallet className="size-4" />}
                  />
                  <StatCard
                    label={tx.contracts_total}
                    value={formatCurrency(leistungMetrics.gross)}
                    description="Quantity x price across visible service lines."
                    icon={<Building2 className="size-4" />}
                  />
                </div>

                <SectionCard
                  title={tx.providers_services}
                  description="Provider- and doctor-linked services within the current order."
                  action={
                    permissions.canAddLeistung ? (
                      <Button onClick={() => resetLeistungDialog(true)}>
                        <Plus className="mr-2 size-4" />
                        Add Leistung
                      </Button>
                    ) : null
                  }
                >
                  {orderDetail.leistungen.length === 0 ? (
                    <EmptyState
                      title={tx.common_not_set}
                      description="Use provider-linked lines to build the order delivery scope and give billing enough context."
                      action={
                        permissions.canAddLeistung ? (
                          <Button onClick={() => resetLeistungDialog(true)}>
                            <Plus className="mr-2 size-4" />
                            Add Leistung
                          </Button>
                        ) : undefined
                      }
                    />
                  ) : (
                    <div className="space-y-3">
                      {orderDetail.leistungen.map((leistung) => (
                        <div
                          key={leistung.id}
                          className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                        >
                          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                            <div className="space-y-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="text-base font-semibold text-slate-950">
                                  {leistung.description}
                                </div>
                                <Badge
                                  variant="outline"
                                  className={cn("rounded-full", statusClassName(leistung.status))}
                                >
                                  {leistung.status}
                                </Badge>
                                {leistung.is_cost_passthrough ? (
                                  <Badge
                                    variant="outline"
                                    className="rounded-full border-violet-200 bg-violet-100 text-violet-700"
                                  >
                                    Cost pass-through
                                  </Badge>
                                ) : null}
                              </div>

                              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                                <DetailField
                                  label={t.common_provider}
                                  value={
                                    leistung.provider_id ? (
                                      <button
                                        type="button"
                                        className="text-left font-medium text-sky-700 hover:text-sky-800"
                                        onClick={() =>
                                          navigate(`/providers?provider=${leistung.provider_id}`)
                                        }
                                      >
                                        {leistung.provider_name || "Open provider"}
                                      </button>
                                    ) : (
                                      leistung.provider_name || "Unlinked"
                                    )
                                  }
                                />
                                <DetailField
                                  label={t.common_doctor}
                                  value={
                                    leistung.provider_id && leistung.doctor_id ? (
                                      <button
                                        type="button"
                                        className="text-left font-medium text-sky-700 hover:text-sky-800"
                                        onClick={() =>
                                          navigate(
                                            `/appointments?provider=${leistung.provider_id}&doctor=${leistung.doctor_id}`,
                                          )
                                        }
                                      >
                                        {leistung.doctor_name || "Open doctor context"}
                                      </button>
                                    ) : (
                                      leistung.doctor_name || "Not specified"
                                    )
                                  }
                                />
                                <DetailField
                                  label={t.providers_service_price}
                                  value={formatNumber(leistung.quantity)}
                                />
                                <DetailField
                                  label={tx.invoices_amount}
                                  value={formatCurrency(leistung.unit_price, leistung.currency)}
                                />
                                <DetailField
                                  label={t.providers_service_price}
                                  value={`${formatNumber(leistung.vat_rate)}%`}
                                />
                                <DetailField
                                  label={tx.invoices_total}
                                  value={formatCurrency(
                                    (numberFromUnknown(leistung.quantity) ?? 0) *
                                      (numberFromUnknown(leistung.unit_price) ?? 0),
                                    leistung.currency,
                                  )}
                                />
                                <DetailField
                                  label={tx.common_active}
                                  value={formatDateTime(leistung.delivered_at)}
                                />
                                <DetailField
                                  label={tx.common_active}
                                  value={formatDateTime(leistung.approved_at)}
                                />
                              </div>

                              {leistung.notes ? (
                                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                                  {leistung.notes}
                                </div>
                              ) : null}
                            </div>

                            <div className="flex shrink-0 items-start">
                              {permissions.canApproveLeistung && leistung.status === "delivered" ? (
                                <Button
                                  onClick={() => void handleApproveLeistung(leistung.id)}
                                  disabled={approvingLeistungId === leistung.id}
                                >
                                  {approvingLeistungId === leistung.id ? (
                                    <LoaderCircle className="mr-2 size-4 animate-spin" />
                                  ) : (
                                    <CheckCircle2 className="mr-2 size-4" />
                                  )}
                                  Approve
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </SectionCard>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={createOpen} onOpenChange={resetCreateDialog}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Create order</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateOrder} className="space-y-4">
            {createError ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {createError}
              </div>
            ) : null}

            <div>
              <Label>{t.orders_patient}</Label>
              <select
                required
                value={createForm.patientId}
                onChange={(event) => {
                  setCreateError(null);
                  setCreateRecheck(null);
                  setCreateForm((current) => ({
                    ...current,
                    patientId: event.target.value,
                  }));
                }}
                className={`mt-1 ${selectClassName}`}
              >
                <option value="">{t.orders_patient}</option>
                {patients.map((patient) => (
                  <option key={patient.id} value={patient.id}>
                    {patientLabel(patient)}
                  </option>
                ))}
              </select>
            </div>

            {createForm.patientId ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-sm font-semibold text-slate-900">
                      Existing customer re-check
                    </div>
                    <p className="text-xs text-slate-500">
                      Validate base data, compliance, identity, document pack, contract
                      status and debt hold before creating a new order.
                    </p>
                  </div>
                  {createRecheck ? (
                    <Badge
                      variant="outline"
                      className={cn(
                        "rounded-full",
                        !createRecheck.requires_recheck || createRecheck.can_create_order
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-amber-200 bg-amber-50 text-amber-700",
                      )}
                    >
                      {!createRecheck.requires_recheck
                        ? "Not required"
                        : createRecheck.can_create_order
                          ? "Ready for order"
                          : "Blocked"}
                    </Badge>
                  ) : null}
                </div>

                {createRecheckLoading ? (
                  <div className="mt-3 flex items-center gap-2 text-sm text-slate-600">
                    <LoaderCircle className="size-4 animate-spin" />
                    Loading patient re-check…
                  </div>
                ) : null}

                {createRecheckError ? (
                  <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    {createRecheckError}
                  </div>
                ) : null}

                {createRecheck ? (
                  <div className="mt-4 space-y-4">
                    {createRecheck.requires_recheck ? (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {createRecheck.checks.map((check) => (
                          <div
                            key={check.key}
                            className="rounded-xl border border-white/80 bg-white px-3 py-2 shadow-sm"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm text-slate-700">{check.label}</span>
                              <Badge
                                variant="outline"
                                className={cn("rounded-full", recheckBadgeClass(check.passed))}
                              >
                                {check.passed ? "OK" : "Needs update"}
                              </Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
                        {createRecheck.reason ??
                          "This patient has no prior operational history yet, so the existing-customer re-check is not required before the first order."}
                      </div>
                    )}

                    {createRecheck.requires_recheck &&
                    createRecheck.base_data_missing_fields.length ? (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
                        Missing base data:{" "}
                        {createRecheck.base_data_missing_fields
                          .map((field) => recheckMissingFieldLabel(field))
                          .join(", ")}
                      </div>
                    ) : null}

                    {createRecheck.requires_recheck && createRecheck.blocking_reasons.length ? (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
                        <div className="font-medium">Blocking reasons</div>
                        <ul className="mt-2 list-disc space-y-1 pl-5">
                          {createRecheck.blocking_reasons.map((reason) => (
                            <li key={reason}>{reason}</li>
                          ))}
                        </ul>
                      </div>
                    ) : createRecheck.requires_recheck ? (
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
                        Existing customer re-check is complete. The patient can move into a new
                        order.
                      </div>
                    ) : null}

                    <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
                      <div className="space-y-1">
                        <div>
                          {createRecheck.requires_recheck &&
                          createRecheck.document_alerts.missing_count > 0
                            ? `${createRecheck.document_alerts.missing_count} required document(s) still missing`
                            : createRecheck.requires_recheck
                              ? "Required document pack complete"
                              : "No existing-customer document check required yet"}
                        </div>
                        <div>
                          {createRecheck.requires_recheck && createRecheck.debt_hold
                            ? `${createRecheck.overdue_invoice_count} overdue invoice(s) keep the patient on debt hold`
                            : createRecheck.requires_recheck
                              ? "No overdue debt detected"
                              : "Debt-management hold is checked when prior customer history exists"}
                        </div>
                        {createRecheck.requires_recheck && createRecheck.outstanding_balance ? (
                          <div>
                            Outstanding balance: {formatCurrency(createRecheck.outstanding_balance)}
                          </div>
                        ) : null}
                        {createRecheck.requires_recheck && createRecheck.debt_management?.latest_workflow ? (
                          <div>
                            Latest debt workflow: {createRecheck.debt_management.latest_workflow.order_number} / {createRecheck.debt_management.latest_workflow.effective_status}
                            {createRecheck.debt_management.latest_workflow.owner_name
                              ? ` / ${createRecheck.debt_management.latest_workflow.owner_name}`
                              : ""}
                          </div>
                        ) : null}
                        {createRecheck.latest_framework_contract ? (
                          <div>
                            Latest framework contract:{" "}
                            {createRecheck.latest_framework_contract.contract_number} (
                            {createRecheck.latest_framework_contract.status})
                          </div>
                        ) : (
                          <div>No framework contract recorded yet</div>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        className="rounded-xl"
                        onClick={() => navigate(`/patients?patient=${createForm.patientId}`)}
                      >
                        Open patient profile
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div>
              <Label>Needs / intake note</Label>
              <textarea
                value={createForm.needsDescription}
                onChange={(event) =>
                  setCreateForm((current) => ({
                    ...current,
                    needsDescription: event.target.value,
                  }))
                }
                className={`mt-1 ${textareaClassName}`}
                placeholder={tx.patients_notes}
              />
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => resetCreateDialog(false)}>
                {t.common_cancel}
              </Button>
              <Button
                type="submit"
                disabled={
                  createSaving ||
                  createRecheckLoading ||
                  (!!createForm.patientId && !createRecheck && !createRecheckLoading) ||
                  (!!createForm.patientId &&
                    createRecheck?.requires_recheck === true &&
                    !createRecheck.can_create_order)
                }
              >
                {createSaving ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
                {t.common_save}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={leistungOpen} onOpenChange={resetLeistungDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add Leistung</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddLeistung} className="space-y-4">
            {leistungError ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {leistungError}
              </div>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label>Description</Label>
                <Input
                  required
                  value={leistungForm.description}
                  onChange={(event) =>
                    setLeistungForm((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Notes</Label>
                <Input
                  value={leistungForm.notes}
                  onChange={(event) =>
                    setLeistungForm((current) => ({
                      ...current,
                      notes: event.target.value,
                    }))
                  }
                  className="mt-1"
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <Label>Quantity</Label>
                <Input
                  value={leistungForm.quantity}
                  onChange={(event) =>
                    setLeistungForm((current) => ({
                      ...current,
                      quantity: event.target.value,
                    }))
                  }
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Unit price</Label>
                <Input
                  value={leistungForm.unitPrice}
                  onChange={(event) =>
                    setLeistungForm((current) => ({
                      ...current,
                      unitPrice: event.target.value,
                    }))
                  }
                  className="mt-1"
                />
              </div>
              <div>
                <Label>VAT %</Label>
                <Input
                  value={leistungForm.vatRate}
                  onChange={(event) =>
                    setLeistungForm((current) => ({
                      ...current,
                      vatRate: event.target.value,
                    }))
                  }
                  className="mt-1"
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label>Provider</Label>
                <select
                  value={leistungForm.providerId}
                  onChange={(event) => {
                    const providerId = event.target.value;
                    setLeistungForm((current) => ({
                      ...current,
                      providerId,
                      doctorId: "",
                    }));
                  }}
                  className={`mt-1 ${selectClassName}`}
                >
                  <option value="">{t.common_provider}</option>
                  {providers.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.name}
                      {provider.address_city ? ` (${provider.address_city})` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Doctor</Label>
                <select
                  value={leistungForm.doctorId}
                  onChange={(event) =>
                    setLeistungForm((current) => ({
                      ...current,
                      doctorId: event.target.value,
                    }))
                  }
                  className={`mt-1 ${selectClassName}`}
                  disabled={!leistungForm.providerId}
                >
                  <option value="">{t.common_doctor}</option>
                  {leistungDoctorOptions.map((doctor) => (
                    <option key={doctor.id} value={doctor.id}>
                      {doctor.name}
                      {doctor.fachbereich ? ` (${doctor.fachbereich})` : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={leistungForm.isCostPassthrough}
                  onChange={(event) =>
                    setLeistungForm((current) => ({
                      ...current,
                      isCostPassthrough: event.target.checked,
                    }))
                  }
                  className="mt-1 size-4 rounded border-slate-300"
                />
                <span>
                  <div className="text-sm font-medium text-slate-900">Treat as cost pass-through</div>
                  <div className="mt-1 text-sm text-slate-500">
                    Keep the line item visible for billing without merging it into agency-owned margin logic.
                  </div>
                </span>
              </label>
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => resetLeistungDialog(false)}>
                {t.common_cancel}
              </Button>
              <Button type="submit" disabled={leistungSaving}>
                {leistungSaving ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
                {t.common_save}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
