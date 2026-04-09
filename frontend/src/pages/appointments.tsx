import {
  startTransition,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin, {
  type DateClickArg,
  type EventResizeDoneArg,
} from "@fullcalendar/interaction";
import type {
  DatesSetArg,
  EventClickArg,
  EventContentArg,
  EventDropArg,
  EventInput,
} from "@fullcalendar/core";
import {
  AlertCircle,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  MapPin,
  Plus,
  RefreshCw,
  ShieldAlert,
  Stethoscope,
  UserRound,
  UsersRound,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  buildAppointmentTimelineEvents,
  canResubmitInterpreterReport,
  type AppointmentTimelineEvent,
  type AppointmentTimelineKind,
} from "@/pages/appointments.helpers";

type AppointmentKind = "medical" | "non_medical" | "internal";
type AppointmentStatus =
  | "planned"
  | "confirmed"
  | "in_progress"
  | "completed"
  | "cancelled";
type InterpreterResponse = "pending" | "accepted" | "declined" | "discussion";

type AppointmentListItem = {
  id: string;
  title: string;
  date: string;
  time_start: string | null;
  time_end: string | null;
  type: AppointmentKind;
  status: AppointmentStatus;
  location: string | null;
  interpreter_response: InterpreterResponse | null;
  checklist_phase: string;
  patient_id: string;
  patient_name: string;
  patient_pid: string;
  provider_id: string | null;
  provider_name: string | null;
  doctor_id: string | null;
  doctor_name: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  owner_role: string | null;
  interpreter_id: string | null;
  interpreter_name: string | null;
  is_blocked: boolean;
};

type AppointmentDetail = AppointmentListItem & {
  category: string | null;
  preparation_notes: string | null;
  followup_notes: string | null;
  notes: string | null;
  order_id: string | null;
  created_at: string;
};

type ConflictItem = {
  id: string;
  title: string;
  date: string;
  time_start: string | null;
  time_end: string | null;
  type: AppointmentKind;
  status: AppointmentStatus;
  patient_name: string;
  patient_pid: string;
  provider_name: string | null;
  doctor_name: string | null;
  interpreter_name: string | null;
  is_blocked: boolean;
};

type ConflictSummary = {
  patient_conflict_count: number;
  interpreter_conflict_count: number;
  has_conflicts: boolean;
  patient_conflicts: ConflictItem[];
  interpreter_conflicts: ConflictItem[];
};

type PatientSummary = {
  id: string;
  patient_id: string;
  first_name?: string;
  last_name?: string;
};

type ProviderSummary = {
  id: string;
  name: string;
  provider_type: string;
  address_city: string | null;
  fachbereich: string | null;
};

type DoctorOption = {
  id: string;
  name: string;
  title: string | null;
  fachbereich: string | null;
};

type StaffOption = {
  id: string;
  name: string;
  role: string;
};

type InterpreterOption = {
  id: string;
  name: string;
  role: string;
};

type ChecklistItem = {
  id: string;
  phase: string;
  item_text: string;
  is_completed: boolean;
  completed_at: string | null;
};

type ReminderEntry = {
  id: string;
  user_id: string;
  user_name: string;
  remind_at: string;
  title: string;
  description: string | null;
  is_completed: boolean;
  completed_at: string | null;
};

type PatientAssignment = {
  user_id: string;
  user_name: string;
  user_role: string;
  user_active: boolean;
  assigned_by: string;
  assigned_by_name: string | null;
  assigned_at: string;
  revoked_at: string | null;
};

type ReportSummary = {
  id: string;
  interpreter_id: string;
  interpreter_name: string;
  hours: string;
  report_text: string | null;
  approval_status: string;
  notes?: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  created_at: string;
};

type TaskEntry = {
  id: string;
  title: string;
  description: string | null;
  assigned_to: string;
  assigned_to_name: string;
  assigned_to_role: string;
  assigned_by: string;
  assigned_by_name: string;
  patient_id: string | null;
  order_id: string | null;
  appointment_id: string | null;
  due_date: string | null;
  priority: string;
  status: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

type ConciergeServiceEntry = {
  id: string;
  patient_id: string;
  patient_name: string;
  patient_pid: string;
  appointment_id: string | null;
  appointment_title: string | null;
  provider_id: string | null;
  provider_name: string | null;
  assigned_concierge_id: string | null;
  assigned_concierge_name: string | null;
  service_kind: string;
  title: string;
  status: string;
  booking_reference: string | null;
  vendor_name: string | null;
  vendor_contact: string | null;
  starts_at: string | null;
  ends_at: string | null;
  cost_estimate: string | null;
  actual_cost: string | null;
  currency: string;
  billing_status: string;
  service_notes: string | null;
  billing_notes: string | null;
  completed_at: string | null;
  billed_at: string | null;
  created_at: string;
};

type CalendarEventExtendedProps = {
  patientName: string;
  patientPid: string;
  providerName: string | null;
  doctorName: string | null;
  interpreterName: string | null;
  ownerName: string | null;
  location: string | null;
  appointmentType: AppointmentKind;
  appointmentStatus: AppointmentStatus;
  isBlocked: boolean;
};

type LocalScheduleWarningScope = "owner" | "doctor" | "clinic";

type LocalScheduleWarning = {
  scope: LocalScheduleWarningScope;
  label: string;
  items: AppointmentListItem[];
};

type CalendarView = "dayGridMonth" | "timeGridWeek" | "timeGridDay" | "listWeek";
type OperationalScope =
  | "all"
  | "owned_by_me"
  | "pending_interpreter"
  | "my_interpreter_queue"
  | "concierge_flow"
  | "blocked_medical";

type FiltersState = {
  search: string;
  appointmentType: string;
  status: string;
  patientId: string;
  providerId: string;
  doctorId: string;
  ownerUserId: string;
  interpreterId: string;
  dateFrom: string;
  dateTo: string;
};

type AppointmentFormState = {
  patientId: string;
  providerId: string;
  doctorId: string;
  ownerUserId: string;
  interpreterId: string;
  appointmentType: AppointmentKind;
  title: string;
  date: string;
  timeStart: string;
  timeEnd: string;
  location: string;
  category: string;
  notes: string;
};

type FollowUpVisitFormState = AppointmentFormState & {
  linkOrder: boolean;
  createReminder: boolean;
  reminderUserId: string;
  reminderAt: string;
};

type ReminderFormState = {
  userId: string;
  remindAt: string;
  title: string;
  description: string;
};

type DoctorFollowUpFormState = {
  title: string;
  assigneeId: string;
  dueAt: string;
  notes: string;
  createTask: boolean;
  taskPriority: string;
};

type PackageEndFollowUpFormState = {
  title: string;
  assigneeId: string;
  packageEndDate: string;
  notes: string;
  createTask: boolean;
  taskPriority: string;
};

type ExternalHandoffFormState = {
  target: "clinic" | "doctor";
  title: string;
  assigneeId: string;
  dueAt: string;
  notes: string;
  createTask: boolean;
  taskPriority: string;
};

type BillingHandoffKind =
  | "interpreter_hours"
  | "concierge_settlement"
  | "patient_invoice"
  | "provider_invoice"
  | "payment_confirmation"
  | "other";

type BillingHandoffFormState = {
  kind: BillingHandoffKind;
  title: string;
  assigneeId: string;
  dueAt: string;
  notes: string;
  createTask: boolean;
  taskPriority: string;
};

type FindingsFollowUpArtifact = "arztbrief" | "written_findings" | "both";

type FindingsFollowUpFormState = {
  artifact: FindingsFollowUpArtifact;
  assigneeId: string;
  dueAt: string;
  notes: string;
  translationRequired: boolean;
  sendToPatient: boolean;
  createTask: boolean;
  taskPriority: string;
};

type IncomingDataSource =
  | "patient"
  | "doctor"
  | "clinic"
  | "interpreter"
  | "external_lab"
  | "other";

type IncomingDataCategory =
  | "medical_update"
  | "diagnosis"
  | "medication"
  | "symptom"
  | "lab_result"
  | "imaging"
  | "recommendation"
  | "risk_flag"
  | "other";

type IncomingDataFormState = {
  source: IncomingDataSource;
  category: IncomingDataCategory;
  assigneeId: string;
  dueAt: string;
  notes: string;
  requiresCaseUpdate: boolean;
  requiresPatientFollowUp: boolean;
  createTask: boolean;
  taskPriority: string;
};

type ReportFormState = {
  hours: string;
  reportText: string;
};

type ChecklistFormState = {
  phase: string;
  itemText: string;
};

type TaskFormState = {
  title: string;
  description: string;
  assignedTo: string;
  dueDate: string;
  priority: string;
};

type ConciergeServiceFormState = {
  providerId: string;
  assignedConciergeId: string;
  serviceKind: string;
  title: string;
  vendorName: string;
  vendorContact: string;
  startsAt: string;
  endsAt: string;
  costEstimate: string;
  currency: string;
  serviceNotes: string;
};

type ConciergeServiceDraftState = {
  providerId: string;
  assignedConciergeId: string;
  title: string;
  status: string;
  billingStatus: string;
  bookingReference: string;
  vendorName: string;
  vendorContact: string;
  startsAt: string;
  endsAt: string;
  actualCost: string;
  currency: string;
  serviceNotes: string;
  billingNotes: string;
};

type AppointmentPermissions = {
  canViewPage: boolean;
  canCreate: boolean;
  canEditSchedule: boolean;
  canManageStatus: boolean;
  canAssignInterpreter: boolean;
  canManageChecklist: boolean;
  canViewReminders: boolean;
  canManageReminders: boolean;
  canRespondToAssignment: boolean;
  canSubmitReport: boolean;
  canViewReport: boolean;
  canApproveReport: boolean;
  canRejectReport: boolean;
  canViewNotes: boolean;
  canViewTasks: boolean;
  canCreateTasks: boolean;
  canViewConciergeServices: boolean;
  canManageConciergeServices: boolean;
  canManageConciergeBilling: boolean;
};

type OperationalScopeOption = {
  id: OperationalScope;
  label: string;
};

type HandoffStakeholder = {
  id: string;
  name: string;
  role: string;
  badges: string[];
};

const STATUS_OPTIONS: AppointmentStatus[] = [
  "planned",
  "confirmed",
  "in_progress",
  "completed",
  "cancelled",
];
const TYPE_OPTIONS: AppointmentKind[] = ["medical", "non_medical", "internal"];
const INTERPRETER_RESPONSE_OPTIONS: InterpreterResponse[] = [
  "pending",
  "accepted",
  "declined",
  "discussion",
];
const CHECKLIST_PHASES = ["preparation", "execution", "followup"];
const TASK_STATUS_OPTIONS = ["open", "in_progress", "completed", "cancelled"];
const TASK_PRIORITY_OPTIONS = ["low", "normal", "high", "urgent"];
const CONCIERGE_SERVICE_KIND_OPTIONS = [
  "hotel",
  "transfer",
  "vip_terminal",
  "flight",
  "chauffeur",
  "translation_support",
  "other",
];
const CONCIERGE_SERVICE_STATUS_OPTIONS = [
  "planned",
  "booked",
  "confirmed",
  "in_service",
  "completed",
  "cancelled",
];
const CONCIERGE_BILLING_STATUS_OPTIONS = [
  "draft",
  "ready",
  "billed",
  "settled",
  "waived",
];
const DOCTOR_FOLLOW_UP_PREFIX = "Doctor-directed:";
const PACKAGE_END_FOLLOW_UP_PREFIX = "Package-end:";
const EXTERNAL_HANDOFF_PREFIX = "External handoff:";
const BILLING_HANDOFF_PREFIX = "Billing handoff:";
const FINDINGS_FOLLOW_UP_PREFIX = "Findings:";
const FINDINGS_CHECKLIST_PREFIX = "[Findings]";
const INCOMING_DATA_PREFIX = "Incoming data:";
const INCOMING_DATA_CHECKLIST_PREFIX = "[Incoming data]";
const FOLLOW_UP_PRESETS = [
  { id: "post_1w", label: "1 week", offsetDays: 7, title: "1-week follow-up check-in" },
  { id: "post_1m", label: "1 month", offsetMonths: 1, title: "1-month follow-up check-in" },
  { id: "post_6m", label: "6 months", offsetMonths: 6, title: "6-month follow-up check-in" },
] as const;
const CALENDAR_STORAGE_VIEW_KEY = "gmed_appointments_calendar_view";
const CALENDAR_STORAGE_DATE_KEY = "gmed_appointments_calendar_date";
const DEFAULT_FILTERS: FiltersState = {
  search: "",
  appointmentType: "",
  status: "",
  patientId: "",
  providerId: "",
  doctorId: "",
  ownerUserId: "",
  interpreterId: "",
  dateFrom: "",
  dateTo: "",
};

const selectClassName =
  "h-10 w-full rounded-xl border border-input bg-slate-50 px-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100";
const textareaClassName =
  "min-h-[96px] w-full rounded-xl border border-input bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100";

function appointmentPermissions(role?: string): AppointmentPermissions {
  switch (role) {
    case "ceo":
    case "patient_manager":
      return {
        canViewPage: true,
        canCreate: true,
        canEditSchedule: true,
        canManageStatus: true,
        canAssignInterpreter: true,
        canManageChecklist: true,
        canViewReminders: true,
        canManageReminders: true,
        canRespondToAssignment: false,
        canSubmitReport: false,
        canViewReport: true,
        canApproveReport: true,
        canRejectReport: true,
        canViewNotes: true,
        canViewTasks: true,
        canCreateTasks: true,
        canViewConciergeServices: true,
        canManageConciergeServices: true,
        canManageConciergeBilling: true,
      };
    case "teamlead_interpreter":
      return {
        canViewPage: true,
        canCreate: true,
        canEditSchedule: true,
        canManageStatus: false,
        canAssignInterpreter: true,
        canManageChecklist: false,
        canViewReminders: true,
        canManageReminders: false,
        canRespondToAssignment: true,
        canSubmitReport: false,
        canViewReport: true,
        canApproveReport: true,
        canRejectReport: true,
        canViewNotes: true,
        canViewTasks: true,
        canCreateTasks: false,
        canViewConciergeServices: false,
        canManageConciergeServices: false,
        canManageConciergeBilling: false,
      };
    case "interpreter":
      return {
        canViewPage: true,
        canCreate: false,
        canEditSchedule: false,
        canManageStatus: false,
        canAssignInterpreter: false,
        canManageChecklist: false,
        canViewReminders: true,
        canManageReminders: false,
        canRespondToAssignment: true,
        canSubmitReport: true,
        canViewReport: true,
        canApproveReport: false,
        canRejectReport: false,
        canViewNotes: true,
        canViewTasks: true,
        canCreateTasks: false,
        canViewConciergeServices: false,
        canManageConciergeServices: false,
        canManageConciergeBilling: false,
      };
    case "concierge":
      return {
        canViewPage: true,
        canCreate: true,
        canEditSchedule: true,
        canManageStatus: false,
        canAssignInterpreter: false,
        canManageChecklist: true,
        canViewReminders: true,
        canManageReminders: false,
        canRespondToAssignment: false,
        canSubmitReport: false,
        canViewReport: false,
        canApproveReport: false,
        canRejectReport: false,
        canViewNotes: false,
        canViewTasks: true,
        canCreateTasks: false,
        canViewConciergeServices: true,
        canManageConciergeServices: true,
        canManageConciergeBilling: false,
      };
    default:
      return {
        canViewPage: false,
        canCreate: false,
        canEditSchedule: false,
        canManageStatus: false,
        canAssignInterpreter: false,
        canManageChecklist: false,
        canViewReminders: false,
        canManageReminders: false,
        canRespondToAssignment: false,
        canSubmitReport: false,
        canViewReport: false,
        canApproveReport: false,
        canRejectReport: false,
        canViewNotes: false,
        canViewTasks: false,
        canCreateTasks: false,
        canViewConciergeServices: false,
        canManageConciergeServices: false,
        canManageConciergeBilling: false,
      };
  }
}

function blankAppointmentForm(): AppointmentFormState {
  const today = currentDateInput();
  return {
    patientId: "",
    providerId: "",
    doctorId: "",
    ownerUserId: "",
    interpreterId: "",
    appointmentType: "medical",
    title: "",
    date: today,
    timeStart: "",
    timeEnd: "",
    location: "",
    category: "",
    notes: "",
  };
}

function buildFollowUpVisitForm(
  detail: AppointmentDetail,
  defaultReminderUserId = ""
): FollowUpVisitFormState {
  const start = detail.time_start
    ? shiftLocalDateTime(`${detail.date}T${detail.time_start.slice(0, 5)}`, { months: 1 })
    : "";
  const end = detail.time_end
    ? shiftLocalDateTime(`${detail.date}T${detail.time_end.slice(0, 5)}`, { months: 1 })
    : "";
  const reminderAt = start ? shiftLocalDateTime(start, { days: -3 }) : "";

  return {
    patientId: detail.patient_id,
    providerId: detail.provider_id ?? "",
    doctorId: detail.doctor_id ?? "",
    ownerUserId: detail.owner_user_id ?? "",
    interpreterId: detail.interpreter_id ?? "",
    appointmentType: detail.type,
    title: detail.category ? `${detail.category} follow-up` : `Follow-up: ${detail.title}`,
    date: start ? start.slice(0, 10) : currentDateInput(),
    timeStart: start ? start.slice(11, 16) : "",
    timeEnd: end ? end.slice(11, 16) : "",
    location: detail.location ?? "",
    category: detail.category ? `${detail.category} follow-up` : "Follow-up",
    notes: detail.followup_notes ?? detail.notes ?? "",
    linkOrder: Boolean(detail.order_id),
    createReminder: true,
    reminderUserId: defaultReminderUserId,
    reminderAt,
  };
}

function currentDateInput() {
  return new Date().toLocaleDateString("en-CA");
}

function readStoredCalendarView(): CalendarView {
  if (typeof window === "undefined") return "timeGridWeek";
  const stored = window.localStorage.getItem(CALENDAR_STORAGE_VIEW_KEY);
  if (
    stored === "dayGridMonth" ||
    stored === "timeGridWeek" ||
    stored === "timeGridDay" ||
    stored === "listWeek"
  ) {
    return stored;
  }
  return "timeGridWeek";
}

function readStoredCalendarDate() {
  if (typeof window === "undefined") return currentDateInput();
  return window.localStorage.getItem(CALENDAR_STORAGE_DATE_KEY) || currentDateInput();
}

function startOfWeekInput(anchorDate: string) {
  const date = new Date(`${anchorDate}T12:00:00`);
  const diff = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - diff);
  return toDateInput(date);
}

function endOfWeekInput(anchorDate: string) {
  const start = new Date(`${startOfWeekInput(anchorDate)}T12:00:00`);
  start.setDate(start.getDate() + 6);
  return toDateInput(start);
}

function blankReminderForm(): ReminderFormState {
  return { userId: "", remindAt: "", title: "", description: "" };
}

function blankDoctorFollowUpForm(
  defaultAssignee = "",
  defaultDueAt = ""
): DoctorFollowUpFormState {
  return {
    title: "",
    assigneeId: defaultAssignee,
    dueAt: defaultDueAt,
    notes: "",
    createTask: true,
    taskPriority: "normal",
  };
}

function blankPackageEndFollowUpForm(defaultAssignee = ""): PackageEndFollowUpFormState {
  return {
    title: "Package completion control",
    assigneeId: defaultAssignee,
    packageEndDate: "",
    notes: "",
    createTask: true,
    taskPriority: "normal",
  };
}

function blankExternalHandoffForm(
  defaultAssignee = "",
  defaultDueAt = "",
  defaultTarget: ExternalHandoffFormState["target"] = "clinic"
): ExternalHandoffFormState {
  return {
    target: defaultTarget,
    title: "",
    assigneeId: defaultAssignee,
    dueAt: defaultDueAt,
    notes: "",
    createTask: true,
    taskPriority: "normal",
  };
}

function blankBillingHandoffForm(
  defaultAssignee = "",
  defaultDueAt = "",
  defaultKind: BillingHandoffKind = "patient_invoice"
): BillingHandoffFormState {
  return {
    kind: defaultKind,
    title: "",
    assigneeId: defaultAssignee,
    dueAt: defaultDueAt,
    notes: "",
    createTask: true,
    taskPriority: "normal",
  };
}

function blankFindingsFollowUpForm(
  defaultAssignee = "",
  defaultDueAt = "",
  defaultArtifact: FindingsFollowUpArtifact = "arztbrief"
): FindingsFollowUpFormState {
  return {
    artifact: defaultArtifact,
    assigneeId: defaultAssignee,
    dueAt: defaultDueAt,
    notes: "",
    translationRequired: false,
    sendToPatient: true,
    createTask: true,
    taskPriority: "normal",
  };
}

function blankIncomingDataForm(
  defaultAssignee = "",
  defaultDueAt = "",
  defaultSource: IncomingDataSource = "doctor"
): IncomingDataFormState {
  return {
    source: defaultSource,
    category: "medical_update",
    assigneeId: defaultAssignee,
    dueAt: defaultDueAt,
    notes: "",
    requiresCaseUpdate: true,
    requiresPatientFollowUp: false,
    createTask: true,
    taskPriority: "normal",
  };
}

function blankReportForm(): ReportFormState {
  return { hours: "", reportText: "" };
}

function blankChecklistForm(): ChecklistFormState {
  return { phase: "preparation", itemText: "" };
}

function defaultCompletionPlan() {
  return Object.fromEntries(
    FOLLOW_UP_PRESETS.map((preset) => [preset.id, true])
  ) as Record<string, boolean>;
}

function blankTaskForm(defaultAssignee = "", defaultDueDate = ""): TaskFormState {
  return {
    title: "",
    description: "",
    assignedTo: defaultAssignee,
    dueDate: defaultDueDate,
    priority: "normal",
  };
}

function blankConciergeServiceForm(
  defaults?: Partial<ConciergeServiceFormState>
): ConciergeServiceFormState {
  return {
    providerId: defaults?.providerId ?? "",
    assignedConciergeId: defaults?.assignedConciergeId ?? "",
    serviceKind: defaults?.serviceKind ?? "other",
    title: defaults?.title ?? "",
    vendorName: defaults?.vendorName ?? "",
    vendorContact: defaults?.vendorContact ?? "",
    startsAt: defaults?.startsAt ?? "",
    endsAt: defaults?.endsAt ?? "",
    costEstimate: defaults?.costEstimate ?? "",
    currency: defaults?.currency ?? "EUR",
    serviceNotes: defaults?.serviceNotes ?? "",
  };
}

function roleLabel(role?: string | null) {
  return role
    ? role
        .split("_")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ")
    : "";
}

function appointmentTypeLabel(type: AppointmentKind) {
  return type === "non_medical"
    ? "Concierge"
    : type === "internal"
      ? "Internal"
      : "Medical";
}

function statusLabel(status: AppointmentStatus) {
  return status.replace("_", " ");
}

function responseLabel(value: InterpreterResponse) {
  return value === "discussion" ? "Needs discussion" : value;
}

function reportApprovalLabel(status: string) {
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function reportApprovalBadgeClass(status: string) {
  switch (status) {
    case "approved":
      return "bg-emerald-100 text-emerald-700 border-emerald-200";
    case "rejected":
      return "bg-rose-100 text-rose-700 border-rose-200";
    default:
      return "bg-amber-100 text-amber-700 border-amber-200";
  }
}

function statusBadgeClass(status: AppointmentStatus) {
  switch (status) {
    case "planned":
      return "bg-slate-100 text-slate-700 border-slate-200";
    case "confirmed":
      return "bg-sky-100 text-sky-700 border-sky-200";
    case "in_progress":
      return "bg-amber-100 text-amber-700 border-amber-200";
    case "completed":
      return "bg-emerald-100 text-emerald-700 border-emerald-200";
    case "cancelled":
      return "bg-rose-100 text-rose-700 border-rose-200";
  }
}

function typeBadgeClass(type: AppointmentKind) {
  switch (type) {
    case "medical":
      return "bg-violet-100 text-violet-700 border-violet-200";
    case "non_medical":
      return "bg-teal-100 text-teal-700 border-teal-200";
    case "internal":
      return "bg-slate-100 text-slate-700 border-slate-200";
  }
}

function appointmentEventClass(item: AppointmentListItem) {
  if (item.is_blocked) return "fc-apt-event fc-apt-event-blocked";
  if (item.status === "completed") return "fc-apt-event fc-apt-event-completed";
  if (item.status === "cancelled") return "fc-apt-event fc-apt-event-cancelled";
  if (item.type === "non_medical") return "fc-apt-event fc-apt-event-concierge";
  if (item.type === "internal") return "fc-apt-event fc-apt-event-internal";
  return "fc-apt-event fc-apt-event-medical";
}

function toCalendarEvent(item: AppointmentListItem, canEditSchedule: boolean): EventInput {
  const timed = Boolean(item.time_start);
  return {
    id: item.id,
    title: `${item.patient_pid} · ${item.title}`,
    start: timed ? `${item.date}T${item.time_start}` : item.date,
    end: timed && item.time_end ? `${item.date}T${item.time_end}` : undefined,
    allDay: !timed,
    editable: canEditSchedule && !item.is_blocked,
    classNames: [appointmentEventClass(item)],
    extendedProps: {
      patientName: item.patient_name,
      patientPid: item.patient_pid,
      providerName: item.provider_name,
      doctorName: item.doctor_name,
      interpreterName: item.interpreter_name,
      ownerName: item.owner_name,
      location: item.location,
      appointmentType: item.type,
      appointmentStatus: item.status,
      isBlocked: item.is_blocked,
    } satisfies CalendarEventExtendedProps,
  };
}

function slotWindow(date: string, timeStart: string | null, timeEnd: string | null) {
  if (!date) return null;
  const start = new Date(`${date}T${timeStart || "00:00"}:00`);
  const end = new Date(
    `${date}T${timeEnd || (timeStart ? addHourToTime(timeStart) : "23:59")}:00`
  );
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return {
    startMs: start.getTime(),
    endMs: Math.max(end.getTime(), start.getTime() + 60_000),
  };
}

function addHourToTime(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  const total = (hours * 60 + minutes + 60) % (24 * 60);
  const nextHours = Math.floor(total / 60)
    .toString()
    .padStart(2, "0");
  const nextMinutes = (total % 60).toString().padStart(2, "0");
  return `${nextHours}:${nextMinutes}`;
}

function overlaps(
  left: { startMs: number; endMs: number } | null,
  right: { startMs: number; endMs: number } | null
) {
  if (!left || !right) return false;
  return left.startMs < right.endMs && right.startMs < left.endMs;
}

function buildLocalScheduleWarnings(
  items: AppointmentListItem[],
  payload: {
    appointmentId?: string;
    date: string;
    timeStart: string;
    timeEnd: string;
    ownerUserId?: string | null;
    providerId?: string | null;
    doctorId?: string | null;
  }
): LocalScheduleWarning[] {
  if (!payload.date) return [];

  const targetWindow = slotWindow(
    payload.date,
    payload.timeStart || null,
    payload.timeEnd || null
  );

  const scopes: Array<{
    scope: LocalScheduleWarningScope;
    label: string;
    match: (item: AppointmentListItem) => boolean;
  }> = [
    {
      scope: "owner",
      label: "Owner overlap",
      match: (item) => Boolean(payload.ownerUserId) && item.owner_user_id === payload.ownerUserId,
    },
    {
      scope: "doctor",
      label: "Doctor overlap",
      match: (item) => Boolean(payload.doctorId) && item.doctor_id === payload.doctorId,
    },
    {
      scope: "clinic",
      label: "Clinic overlap",
      match: (item) => Boolean(payload.providerId) && item.provider_id === payload.providerId,
    },
  ];

  return scopes
    .map((scope) => ({
      scope: scope.scope,
      label: scope.label,
      items: items.filter((item) => {
        if (item.id === payload.appointmentId || item.status === "cancelled") return false;
        if (!scope.match(item)) return false;
        return overlaps(
          slotWindow(item.date, item.time_start, item.time_end),
          targetWindow
        );
      }),
    }))
    .filter((warning) => warning.items.length > 0);
}

function buildScheduleNotice(
  conflicts: ConflictSummary | null | undefined,
  warnings: LocalScheduleWarning[]
) {
  const parts: string[] = [];
  if (conflicts?.patient_conflict_count) {
    parts.push(`${conflicts.patient_conflict_count} patient overlap`);
  }
  if (conflicts?.interpreter_conflict_count) {
    parts.push(`${conflicts.interpreter_conflict_count} interpreter overlap`);
  }
  for (const warning of warnings) {
    parts.push(`${warning.items.length} ${warning.scope} overlap`);
  }
  return parts.length ? `Scheduling warning: ${parts.join(", ")}.` : "";
}

function matchesOperationalScope(
  item: AppointmentListItem,
  scope: OperationalScope,
  userId?: string,
  userRole?: string
) {
  switch (scope) {
    case "all":
      return true;
    case "owned_by_me":
      return Boolean(userId) && item.owner_user_id === userId;
    case "pending_interpreter":
      return (
        Boolean(item.interpreter_id) &&
        item.interpreter_response === "pending" &&
        item.status !== "cancelled"
      );
    case "my_interpreter_queue":
      return (
        Boolean(userId) &&
        item.interpreter_id === userId &&
        item.status !== "cancelled" &&
        (item.interpreter_response === "pending" ||
          ["planned", "confirmed", "in_progress"].includes(item.status))
      );
    case "concierge_flow":
      return item.type === "non_medical" && item.status !== "cancelled";
    case "blocked_medical":
      return userRole === "concierge" && item.is_blocked;
  }
}

function operationalScopeReason(
  item: AppointmentListItem,
  scope: OperationalScope,
  userRole?: string
) {
  switch (scope) {
    case "owned_by_me":
      return item.owner_role ? `Owner · ${roleLabel(item.owner_role)}` : "Owned by me";
    case "pending_interpreter":
      return item.interpreter_name
        ? `${item.interpreter_name} · ${responseLabel(item.interpreter_response ?? "pending")}`
        : "Interpreter pending";
    case "my_interpreter_queue":
      return item.interpreter_response === "pending"
        ? "Response required"
        : item.status === "completed"
          ? "Completed slot"
          : "Assigned interpreter slot";
    case "concierge_flow":
      return item.provider_name || "Non-medical service flow";
    case "blocked_medical":
      return userRole === "concierge"
        ? "Medical slot shown as blocked"
        : "Blocked slot";
    case "all":
      return item.owner_name || item.provider_name || "Operational slot";
  }
}

function operationalScopeOptions(role?: string): OperationalScopeOption[] {
  const options: OperationalScopeOption[] = [{ id: "all", label: "All visible" }];

  if (role && role !== "interpreter") {
    options.push({ id: "owned_by_me", label: "Owned by me" });
  }
  if (role === "ceo" || role === "patient_manager" || role === "teamlead_interpreter") {
    options.push({ id: "pending_interpreter", label: "Pending interpreter" });
  }
  if (role === "teamlead_interpreter" || role === "interpreter") {
    options.push({ id: "my_interpreter_queue", label: "Interpreter queue" });
  }
  if (role === "ceo" || role === "patient_manager" || role === "concierge") {
    options.push({ id: "concierge_flow", label: "Concierge flow" });
  }
  if (role === "concierge") {
    options.push({ id: "blocked_medical", label: "Blocked medical" });
  }

  return options;
}

function renderCalendarEventContent(arg: EventContentArg) {
  const props = arg.event.extendedProps as CalendarEventExtendedProps;
  const secondaryLine =
    props.doctorName || props.providerName || props.location || props.ownerName || "Operational slot";
  const isListView = arg.view.type.startsWith("list");

  return (
    <div className={cn("fc-apt-event-card", isListView && "fc-apt-event-card-list")}>
      <div className="fc-apt-event-head">
        {arg.timeText ? <span className="fc-apt-event-time">{arg.timeText}</span> : null}
        <span className="fc-apt-event-tag">{appointmentTypeLabel(props.appointmentType)}</span>
      </div>
      <div className="fc-apt-event-title">{arg.event.title}</div>
      <div className="fc-apt-event-meta">{props.patientName}</div>
      <div className="fc-apt-event-submeta">{secondaryLine}</div>
      {props.isBlocked ? (
        <div className="fc-apt-event-note">Limited view</div>
      ) : props.interpreterName ? (
        <div className="fc-apt-event-note">Interpreter: {props.interpreterName}</div>
      ) : null}
    </div>
  );
}

function buildAppointmentsQuery(filters: FiltersState) {
  const params = new URLSearchParams();
  if (filters.search.trim()) params.set("search", filters.search.trim());
  if (filters.appointmentType) params.set("appointment_type", filters.appointmentType);
  if (filters.status) params.set("status", filters.status);
  if (filters.patientId) params.set("patient_id", filters.patientId);
  if (filters.providerId) params.set("provider_id", filters.providerId);
  if (filters.doctorId) params.set("doctor_id", filters.doctorId);
  if (filters.ownerUserId) params.set("owner_user_id", filters.ownerUserId);
  if (filters.interpreterId) params.set("interpreter_id", filters.interpreterId);
  if (filters.dateFrom) params.set("date_from", filters.dateFrom);
  if (filters.dateTo) params.set("date_to", filters.dateTo);
  return params.size ? `/appointments?${params.toString()}` : "/appointments";
}

function buildConflictQuery(
  patientId: string,
  appointmentId: string,
  date: string,
  timeStart: string,
  timeEnd: string,
  interpreterId: string
) {
  const params = new URLSearchParams({ patient_id: patientId, date });
  if (appointmentId) params.set("appointment_id", appointmentId);
  if (timeStart) params.set("time_start", timeStart);
  if (timeEnd) params.set("time_end", timeEnd);
  if (interpreterId) params.set("interpreter_id", interpreterId);
  return `/appointments/meta/conflicts?${params.toString()}`;
}

function formatDateLabel(date: string) {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(new Date(`${date}T00:00:00`));
  } catch {
    return date;
  }
}

function formatDateTimeLabel(dateTime: string | null | undefined) {
  if (!dateTime) return "Not set";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(dateTime));
  } catch {
    return dateTime;
  }
}

function toDateTimeLocalInput(dateTime: string | null | undefined) {
  if (!dateTime) return "";
  const value = new Date(dateTime);
  if (Number.isNaN(value.getTime())) return "";
  const shifted = new Date(value.getTime() - value.getTimezoneOffset() * 60000);
  return shifted.toISOString().slice(0, 16);
}

function slotLabel(item: { date: string; time_start: string | null; time_end: string | null }) {
  return item.time_start
    ? `${formatDateLabel(item.date)} · ${item.time_start}${item.time_end ? ` - ${item.time_end}` : ""}`
    : formatDateLabel(item.date);
}

function toRfc3339(localDateTime: string) {
  return localDateTime ? new Date(localDateTime).toISOString() : "";
}

function toDateInput(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
}

function shiftLocalDateTime(
  localDateTime: string,
  adjustment: { days?: number; months?: number }
) {
  if (!localDateTime) return "";
  const value = new Date(localDateTime);
  if (Number.isNaN(value.getTime())) return "";
  if (adjustment.days) {
    value.setDate(value.getDate() + adjustment.days);
  }
  if (adjustment.months) {
    value.setMonth(value.getMonth() + adjustment.months);
  }
  return toDateTimeLocalInput(value.toISOString());
}

function toTimeInput(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(11, 16);
}

function patientName(patient: PatientSummary) {
  const name = `${patient.first_name ?? ""} ${patient.last_name ?? ""}`.trim();
  return name || patient.patient_id;
}

function doctorLabel(doctor: DoctorOption) {
  return doctor.fachbereich ? `${doctor.name} (${doctor.fachbereich})` : doctor.name;
}

function findingsArtifactLabel(value: FindingsFollowUpArtifact) {
  switch (value) {
    case "arztbrief":
      return "Arztbrief";
    case "written_findings":
      return "Written findings";
    case "both":
      return "Arztbrief and written findings";
    default:
      return value;
  }
}

function incomingDataSourceLabel(value: IncomingDataSource) {
  switch (value) {
    case "patient":
      return "Patient";
    case "doctor":
      return "Doctor";
    case "clinic":
      return "Clinic";
    case "interpreter":
      return "Interpreter";
    case "external_lab":
      return "External lab";
    case "other":
      return "Other source";
    default:
      return value;
  }
}

function incomingDataCategoryLabel(value: IncomingDataCategory) {
  switch (value) {
    case "medical_update":
      return "Medical update";
    case "diagnosis":
      return "Diagnosis";
    case "medication":
      return "Medication";
    case "symptom":
      return "Symptom update";
    case "lab_result":
      return "Lab result";
    case "imaging":
      return "Imaging";
    case "recommendation":
      return "Recommendation";
    case "risk_flag":
      return "Risk flag";
    case "other":
      return "Other";
    default:
      return value;
  }
}

function taskStatusLabel(status: string) {
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function taskPriorityLabel(priority: string) {
  return priority.charAt(0).toUpperCase() + priority.slice(1);
}

function billingHandoffKindLabel(kind: BillingHandoffKind) {
  switch (kind) {
    case "interpreter_hours":
      return "Interpreter hours";
    case "concierge_settlement":
      return "Concierge settlement";
    case "patient_invoice":
      return "Patient invoice";
    case "provider_invoice":
      return "Provider invoice";
    case "payment_confirmation":
      return "Payment confirmation";
    case "other":
      return "Other";
    default:
      return kind;
  }
}

function serviceKindLabel(kind: string) {
  return kind
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function billingStatusLabel(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatMoneyLabel(value: string | null, currency = "EUR") {
  if (!value) return "Not set";
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return `${value} ${currency}`;
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(numeric);
  } catch {
    return `${numeric.toFixed(2)} ${currency}`;
  }
}

function buildTaskDefaultDueDate(detail: AppointmentDetail) {
  if (detail.time_start) {
    return `${detail.date}T${detail.time_start.slice(0, 5)}`;
  }
  return `${detail.date}T09:00`;
}

function buildServiceDraft(service: ConciergeServiceEntry): ConciergeServiceDraftState {
  return {
    providerId: service.provider_id ?? "",
    assignedConciergeId: service.assigned_concierge_id ?? "",
    title: service.title,
    status: service.status,
    billingStatus: service.billing_status,
    bookingReference: service.booking_reference ?? "",
    vendorName: service.vendor_name ?? "",
    vendorContact: service.vendor_contact ?? "",
    startsAt: toDateTimeLocalInput(service.starts_at),
    endsAt: toDateTimeLocalInput(service.ends_at),
    actualCost: service.actual_cost ?? "",
    currency: service.currency || "EUR",
    serviceNotes: service.service_notes ?? "",
    billingNotes: service.billing_notes ?? "",
  };
}

function appointmentAnchorDateTime(detail: AppointmentDetail) {
  const time = detail.time_end ?? detail.time_start ?? "09:00";
  return `${detail.date}T${time.slice(0, 5)}`;
}

function buildHandoffStakeholders(
  detail: AppointmentDetail,
  assignments: PatientAssignment[]
): HandoffStakeholder[] {
  const items = new Map<string, HandoffStakeholder>();
  const activeAssignments = assignments.filter(
    (item) => item.user_active && !item.revoked_at
  );

  for (const assignment of activeAssignments) {
    items.set(assignment.user_id, {
      id: assignment.user_id,
      name: assignment.user_name,
      role: assignment.user_role,
      badges: ["Case assignment"],
    });
  }

  if (detail.owner_user_id && detail.owner_name) {
    const existing = items.get(detail.owner_user_id);
    if (existing) {
      existing.badges = Array.from(new Set([...existing.badges, "Appointment owner"]));
    } else {
      items.set(detail.owner_user_id, {
        id: detail.owner_user_id,
        name: detail.owner_name,
        role: detail.owner_role ?? "",
        badges: ["Appointment owner"],
      });
    }
  }

  if (detail.interpreter_id && detail.interpreter_name) {
    const existing = items.get(detail.interpreter_id);
    if (existing) {
      existing.badges = Array.from(new Set([...existing.badges, "Interpreter"]));
    } else {
      items.set(detail.interpreter_id, {
        id: detail.interpreter_id,
        name: detail.interpreter_name,
        role: "interpreter",
        badges: ["Interpreter"],
      });
    }
  }

  return Array.from(items.values()).sort((left, right) =>
    `${left.role}:${left.name}`.localeCompare(`${right.role}:${right.name}`)
  );
}

function sectionCardClass(extra?: string) {
  return cn(
    "rounded-[1.75rem] border border-border/70 bg-card shadow-[0_20px_60px_rgba(15,23,42,0.05)]",
    extra
  );
}

function timelineToneClass(tone: AppointmentTimelineEvent["tone"]) {
  switch (tone) {
    case "success":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "warning":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "danger":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "info":
      return "border-sky-200 bg-sky-50 text-sky-700";
    default:
      return "border-slate-200 bg-slate-100 text-slate-600";
  }
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">
        {label}
      </span>
      {children}
    </label>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-4 py-5 text-sm text-muted-foreground">
      {text}
    </div>
  );
}

function Banner({
  tone,
  children,
}: {
  tone: "error" | "warning";
  children: ReactNode;
}) {
  const classes =
    tone === "error"
      ? "border-rose-200 bg-rose-50 text-rose-700"
      : "border-amber-200 bg-amber-50 text-amber-700";
  return (
    <div className={cn("flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm", classes)}>
      {tone === "error" ? (
        <AlertCircle className="mt-0.5 size-4 shrink-0" />
      ) : (
        <ShieldAlert className="mt-0.5 size-4 shrink-0" />
      )}
      <div>{children}</div>
    </div>
  );
}

export function AppointmentsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const permissions = appointmentPermissions(user?.role);
  const calendarRef = useRef<FullCalendar | null>(null);
  const [calendarView, setCalendarView] = useState<CalendarView>(() => readStoredCalendarView());
  const [calendarDate, setCalendarDate] = useState(() => readStoredCalendarDate());
  const [filters, setFilters] = useState<FiltersState>(DEFAULT_FILTERS);
  const [operationalScope, setOperationalScope] = useState<OperationalScope>("all");
  const deferredSearch = useDeferredValue(filters.search);

  const [appointments, setAppointments] = useState<AppointmentListItem[]>([]);
  const [appointmentsLoading, setAppointmentsLoading] = useState(true);
  const [appointmentsError, setAppointmentsError] = useState("");
  const [appointmentsNotice, setAppointmentsNotice] = useState("");
  const [appointmentsVersion, setAppointmentsVersion] = useState(0);

  const [patients, setPatients] = useState<PatientSummary[]>([]);
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [interpreters, setInterpreters] = useState<InterpreterOption[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [filterDoctors, setFilterDoctors] = useState<DoctorOption[]>([]);
  const [metadataLoading, setMetadataLoading] = useState(true);
  const [metadataError, setMetadataError] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<AppointmentFormState>(blankAppointmentForm());
  const [createDoctors, setCreateDoctors] = useState<DoctorOption[]>([]);
  const [createConflicts, setCreateConflicts] = useState<ConflictSummary | null>(null);
  const [createError, setCreateError] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [followUpVisitForm, setFollowUpVisitForm] = useState<FollowUpVisitFormState | null>(null);
  const [followUpVisitDoctors, setFollowUpVisitDoctors] = useState<DoctorOption[]>([]);
  const [followUpVisitConflicts, setFollowUpVisitConflicts] = useState<ConflictSummary | null>(null);
  const [followUpVisitError, setFollowUpVisitError] = useState("");
  const [followUpVisitBusy, setFollowUpVisitBusy] = useState(false);

  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detail, setDetail] = useState<AppointmentDetail | null>(null);
  const [detailAssignments, setDetailAssignments] = useState<PatientAssignment[]>([]);
  const [detailChecklist, setDetailChecklist] = useState<ChecklistItem[]>([]);
  const [detailReminders, setDetailReminders] = useState<ReminderEntry[]>([]);
  const [detailReport, setDetailReport] = useState<ReportSummary | null>(null);
  const [detailTasks, setDetailTasks] = useState<TaskEntry[]>([]);
  const [detailServices, setDetailServices] = useState<ConciergeServiceEntry[]>([]);
  const [detailVersion, setDetailVersion] = useState(0);

  const [editForm, setEditForm] = useState<AppointmentFormState | null>(null);
  const [editDoctors, setEditDoctors] = useState<DoctorOption[]>([]);
  const [editConflicts, setEditConflicts] = useState<ConflictSummary | null>(null);
  const [editError, setEditError] = useState("");
  const [editBusy, setEditBusy] = useState(false);

  const [checklistForm, setChecklistForm] = useState<ChecklistFormState>(blankChecklistForm());
  const [checklistBusy, setChecklistBusy] = useState(false);
  const [reminderForm, setReminderForm] = useState<ReminderFormState>(blankReminderForm());
  const [reminderBusy, setReminderBusy] = useState(false);
  const [doctorFollowUpForm, setDoctorFollowUpForm] = useState<DoctorFollowUpFormState>(
    blankDoctorFollowUpForm()
  );
  const [doctorFollowUpBusy, setDoctorFollowUpBusy] = useState(false);
  const [packageEndFollowUpForm, setPackageEndFollowUpForm] =
    useState<PackageEndFollowUpFormState>(blankPackageEndFollowUpForm());
  const [packageEndFollowUpBusy, setPackageEndFollowUpBusy] = useState(false);
  const [externalHandoffForm, setExternalHandoffForm] = useState<ExternalHandoffFormState>(
    blankExternalHandoffForm()
  );
  const [externalHandoffBusy, setExternalHandoffBusy] = useState(false);
  const [billingHandoffForm, setBillingHandoffForm] = useState<BillingHandoffFormState>(
    blankBillingHandoffForm()
  );
  const [billingHandoffBusy, setBillingHandoffBusy] = useState(false);
  const [findingsFollowUpForm, setFindingsFollowUpForm] =
    useState<FindingsFollowUpFormState>(blankFindingsFollowUpForm());
  const [findingsFollowUpBusy, setFindingsFollowUpBusy] = useState(false);
  const [incomingDataForm, setIncomingDataForm] = useState<IncomingDataFormState>(
    blankIncomingDataForm()
  );
  const [incomingDataBusy, setIncomingDataBusy] = useState(false);
  const [reportForm, setReportForm] = useState<ReportFormState>(blankReportForm());
  const [taskForm, setTaskForm] = useState<TaskFormState>(blankTaskForm());
  const [taskBusy, setTaskBusy] = useState(false);
  const [serviceForm, setServiceForm] = useState<ConciergeServiceFormState>(
    blankConciergeServiceForm()
  );
  const [serviceDrafts, setServiceDrafts] = useState<
    Record<string, ConciergeServiceDraftState>
  >({});
  const [serviceBusy, setServiceBusy] = useState(false);
  const [followUpAssigneeId, setFollowUpAssigneeId] = useState("");
  const [followUpBusy, setFollowUpBusy] = useState(false);
  const [completionPlan, setCompletionPlan] = useState<Record<string, boolean>>(
    defaultCompletionPlan
  );
  const [completionBusy, setCompletionBusy] = useState(false);
  const [reportRejectReason, setReportRejectReason] = useState("");
  const [timelineFilter, setTimelineFilter] = useState<"all" | AppointmentTimelineKind>("all");
  const [actionBusy, setActionBusy] = useState("");

  const todayDate = currentDateInput();
  const weekStart = startOfWeekInput(todayDate);
  const weekEnd = endOfWeekInput(todayDate);
  const mineFilterActive = user
    ? user.role === "interpreter"
      ? filters.interpreterId === user.id
      : filters.ownerUserId === user.id
    : false;
  const createLocalWarnings = buildLocalScheduleWarnings(appointments, {
    date: createForm.date,
    timeStart: createForm.timeStart,
    timeEnd: createForm.timeEnd,
    ownerUserId: createForm.ownerUserId || user?.id || null,
    providerId: createForm.providerId || null,
    doctorId: createForm.doctorId || null,
  });
  const editLocalWarnings =
    detail && editForm
      ? buildLocalScheduleWarnings(appointments, {
          appointmentId: detail.id,
          date: editForm.date,
          timeStart: editForm.timeStart,
          timeEnd: editForm.timeEnd,
          ownerUserId: editForm.ownerUserId || detail.owner_user_id,
          providerId: editForm.providerId || null,
          doctorId: editForm.doctorId || null,
        })
      : [];
  const followUpVisitLocalWarnings =
    detail && followUpVisitForm
      ? buildLocalScheduleWarnings(appointments, {
          date: followUpVisitForm.date,
          timeStart: followUpVisitForm.timeStart,
          timeEnd: followUpVisitForm.timeEnd,
          ownerUserId: followUpVisitForm.ownerUserId || detail.owner_user_id,
          providerId: followUpVisitForm.providerId || null,
          doctorId: followUpVisitForm.doctorId || null,
        })
      : [];
  const taskAssignableStaff = staff.filter((member) =>
    ["patient_manager", "teamlead_interpreter", "interpreter", "concierge"].includes(
      member.role
    )
  );
  const billingStaff = staff.filter((member) => member.role === "billing");
  const conciergeStaff = staff.filter((member) => member.role === "concierge");
  const nonMedicalProviders = providers.filter(
    (provider) => provider.provider_type === "non_medical"
  );
  const canShowConciergeSection =
    permissions.canViewConciergeServices && detail?.type === "non_medical";
  const scopeOptions = operationalScopeOptions(user?.role);
  const handoffStakeholders =
    detail && !detail.is_blocked
      ? buildHandoffStakeholders(detail, detailAssignments)
      : [];
  const openChecklistCount = detailChecklist.filter((item) => !item.is_completed).length;
  const openTaskCount = detailTasks.filter(
    (item) => !["completed", "cancelled"].includes(item.status)
  ).length;
  const pendingReminderCount = detailReminders.filter((item) => !item.is_completed).length;
  const selectedCompletionPresetCount = FOLLOW_UP_PRESETS.filter(
    (preset) => completionPlan[preset.id]
  ).length;
  const doctorDirectedReminders = detailReminders.filter((item) =>
    item.title.startsWith(DOCTOR_FOLLOW_UP_PREFIX)
  );
  const doctorDirectedTasks = detailTasks.filter((item) =>
    item.title.startsWith(DOCTOR_FOLLOW_UP_PREFIX)
  );
  const packageEndReminders = detailReminders.filter((item) =>
    item.title.startsWith(PACKAGE_END_FOLLOW_UP_PREFIX)
  );
  const packageEndTasks = detailTasks.filter((item) =>
    item.title.startsWith(PACKAGE_END_FOLLOW_UP_PREFIX)
  );
  const externalHandoffReminders = detailReminders.filter((item) =>
    item.title.startsWith(EXTERNAL_HANDOFF_PREFIX)
  );
  const externalHandoffTasks = detailTasks.filter((item) =>
    item.title.startsWith(EXTERNAL_HANDOFF_PREFIX)
  );
  const billingHandoffReminders = detailReminders.filter((item) =>
    item.title.startsWith(BILLING_HANDOFF_PREFIX)
  );
  const billingHandoffTasks = detailTasks.filter((item) =>
    item.title.startsWith(BILLING_HANDOFF_PREFIX)
  );
  const canShowBillingHandoffSection =
    permissions.canManageConciergeBilling ||
    billingHandoffTasks.length > 0 ||
    billingHandoffReminders.length > 0;
  const findingsChecklist = detailChecklist.filter((item) =>
    item.item_text.startsWith(FINDINGS_CHECKLIST_PREFIX)
  );
  const findingsReminders = detailReminders.filter((item) =>
    item.title.startsWith(FINDINGS_FOLLOW_UP_PREFIX)
  );
  const findingsTasks = detailTasks.filter((item) =>
    item.title.startsWith(FINDINGS_FOLLOW_UP_PREFIX)
  );
  const incomingDataChecklist = detailChecklist.filter((item) =>
    item.item_text.startsWith(INCOMING_DATA_CHECKLIST_PREFIX)
  );
  const incomingDataReminders = detailReminders.filter((item) =>
    item.title.startsWith(INCOMING_DATA_PREFIX)
  );
  const incomingDataTasks = detailTasks.filter((item) =>
    item.title.startsWith(INCOMING_DATA_PREFIX)
  );
  const doctorFollowUpAssignees = Array.from(
    new Map(
      [...handoffStakeholders, ...taskAssignableStaff].map((item) => [
        item.id,
        {
          id: item.id,
          name: item.name,
          role: item.role,
        },
      ])
    ).values()
  ).sort((left, right) =>
    `${left.role}:${left.name}`.localeCompare(`${right.role}:${right.name}`)
  );
  const interpreterReportReady = !detail?.interpreter_id
    ? true
    : detailReport?.approval_status === "approved";
  const canResubmitRejectedReport =
    permissions.canSubmitReport &&
    canResubmitInterpreterReport({
      approvalStatus: detailReport?.approval_status,
      currentUserId: user?.id,
      interpreterId: detail?.interpreter_id,
    });
  const canSubmitInterpreterReport = Boolean(
    permissions.canSubmitReport &&
      detail?.interpreter_id === user?.id &&
      (!detailReport || canResubmitRejectedReport)
  );
  const serviceInFlightCount = detailServices.filter(
    (item) => !["completed", "cancelled"].includes(item.status)
  ).length;
  const readyConciergeServices = detailServices.filter((item) => item.billing_status === "ready");
  const settledConciergeServices = detailServices.filter((item) =>
    ["billed", "settled"].includes(item.billing_status)
  );
  const openBillingHandoffTasks = billingHandoffTasks.filter(
    (item) => !["completed", "cancelled"].includes(item.status)
  );
  const billingReadinessWarnings = [
    detail?.interpreter_id && !interpreterReportReady
      ? "Interpreter hours are not approved yet."
      : "",
    detail?.type === "non_medical" && serviceInFlightCount > 0
      ? `${serviceInFlightCount} concierge service(s) are still operationally open.`
      : "",
    detail?.type === "non_medical" &&
    detailServices.length > 0 &&
    readyConciergeServices.length === 0 &&
    settledConciergeServices.length === 0
      ? "No concierge service is marked ready for billing yet."
      : "",
    billingStaff.length === 0 ? "No active billing users available for handoff." : "",
  ].filter(Boolean);
  const showReportReviewActions = Boolean(
    (permissions.canApproveReport || permissions.canRejectReport) &&
      detailReport &&
      detailReport.approval_status === "pending"
  );
  const reportReviewMeta = !detailReport
    ? ""
    : detailReport.approval_status === "approved"
      ? `Approved ${formatDateTimeLabel(detailReport.approved_at)}`
      : detailReport.approval_status === "rejected"
        ? `Returned ${formatDateTimeLabel(detailReport.approved_at)}`
        : "Awaiting teamlead review";
  const openFindingsChecklistCount = findingsChecklist.filter((item) => !item.is_completed).length;
  const openIncomingDataChecklistCount = incomingDataChecklist.filter(
    (item) => !item.is_completed
  ).length;
  const completionWarnings = [
    openChecklistCount > 0 ? `${openChecklistCount} checklist item(s) still open.` : "",
    openIncomingDataChecklistCount > 0
      ? `${openIncomingDataChecklistCount} incoming data item(s) still need triage.`
      : "",
    openTaskCount > 0 ? `${openTaskCount} operational task(s) still open.` : "",
    !interpreterReportReady && detail?.interpreter_id
      ? "Interpreter report is missing or not approved yet."
      : "",
    detail?.type === "non_medical" && serviceInFlightCount > 0
      ? `${serviceInFlightCount} concierge service(s) are still in progress.`
      : "",
  ].filter(Boolean);
  const timelineEvents = buildAppointmentTimelineEvents({
    detail,
    checklist: detailChecklist,
    reminders: detailReminders,
    tasks: detailTasks,
    services: detailServices,
    report: detailReport,
  });
  const visibleTimelineEvents =
    timelineFilter === "all"
      ? timelineEvents
      : timelineEvents.filter((item) => item.kind === timelineFilter);

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

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(CALENDAR_STORAGE_VIEW_KEY, calendarView);
    window.localStorage.setItem(CALENDAR_STORAGE_DATE_KEY, calendarDate);
  }, [calendarDate, calendarView]);

  useEffect(() => {
    if (scopeOptions.some((option) => option.id === operationalScope)) return;
    setOperationalScope("all");
  }, [operationalScope, scopeOptions]);

  useEffect(() => {
    const patientParam = searchParams.get("patient") ?? "";
    const providerParam = searchParams.get("provider") ?? "";
    const doctorParam = searchParams.get("doctor") ?? "";
    const appointmentParam = searchParams.get("appointment") ?? "";

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

    if (appointmentParam && appointmentParam !== selectedId) {
      setSelectedId(appointmentParam);
      setDetailOpen(true);
    }
  }, [searchParams, selectedId]);

  useEffect(() => {
    setAppointmentsNotice("");
  }, [filters]);

  useEffect(() => {
    let active = true;
    async function loadMetadata() {
      setMetadataLoading(true);
      setMetadataError("");
      const [patientRows, providerRows, interpreterRows, staffRows] = await Promise.all([
        apiFetch<PatientSummary[]>("/patients").catch(() => []),
        apiFetch<ProviderSummary[]>("/providers").catch(() => []),
        apiFetch<InterpreterOption[]>("/appointments/meta/interpreters").catch(() => []),
        apiFetch<StaffOption[]>("/appointments/meta/staff").catch(() => []),
      ]);
      if (!active) return;
      setPatients(patientRows);
      setProviders(providerRows);
      setInterpreters(interpreterRows);
      setStaff(staffRows);
      if (patientRows.length === 0 && interpreterRows.length === 0 && staffRows.length === 0) {
        setMetadataError("Core appointment metadata could not be loaded.");
      }
      setMetadataLoading(false);
    }
    void loadMetadata();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    async function loadAppointments() {
      setAppointmentsLoading(true);
      setAppointmentsError("");
      try {
        const rows = await apiFetch<AppointmentListItem[]>(
          buildAppointmentsQuery({ ...filters, search: deferredSearch })
        );
        if (!active) return;
        setAppointments(rows);
      } catch (error) {
        if (!active) return;
        setAppointments([]);
        setAppointmentsError(
          error instanceof Error ? error.message : "Failed to load appointments"
        );
      } finally {
        if (active) setAppointmentsLoading(false);
      }
    }
    void loadAppointments();
    return () => {
      active = false;
    };
  }, [deferredSearch, filters, appointmentsVersion]);

  useEffect(() => {
    if (!createForm.providerId) {
      setCreateDoctors([]);
      setCreateForm((current) => ({ ...current, doctorId: "" }));
      return;
    }
    let active = true;
    apiFetch<DoctorOption[]>(`/providers/${createForm.providerId}/doctors`)
      .then((rows) => {
        if (active) setCreateDoctors(rows);
      })
      .catch(() => {
        if (active) setCreateDoctors([]);
      });
    return () => {
      active = false;
    };
  }, [createForm.providerId]);

  useEffect(() => {
    if (!filters.providerId) {
      setFilterDoctors([]);
      setFilters((current) =>
        current.doctorId ? { ...current, doctorId: "" } : current
      );
      return;
    }
    let active = true;
    apiFetch<DoctorOption[]>(`/providers/${filters.providerId}/doctors`)
      .then((rows) => {
        if (active) setFilterDoctors(rows);
      })
      .catch(() => {
        if (active) setFilterDoctors([]);
      });
    return () => {
      active = false;
    };
  }, [filters.providerId]);

  useEffect(() => {
    if (!editForm?.providerId) {
      setEditDoctors([]);
      return;
    }
    let active = true;
    apiFetch<DoctorOption[]>(`/providers/${editForm.providerId}/doctors`)
      .then((rows) => {
        if (active) setEditDoctors(rows);
      })
      .catch(() => {
        if (active) setEditDoctors([]);
      });
    return () => {
      active = false;
    };
  }, [editForm?.providerId]);

  useEffect(() => {
    if (!followUpVisitForm?.providerId) {
      setFollowUpVisitDoctors([]);
      return;
    }
    let active = true;
    apiFetch<DoctorOption[]>(`/providers/${followUpVisitForm.providerId}/doctors`)
      .then((rows) => {
        if (active) setFollowUpVisitDoctors(rows);
      })
      .catch(() => {
        if (active) setFollowUpVisitDoctors([]);
      });
    return () => {
      active = false;
    };
  }, [followUpVisitForm?.providerId]);

  useEffect(() => {
    if (!createOpen || !permissions.canCreate || !createForm.patientId || !createForm.date) {
      setCreateConflicts(null);
      return;
    }
    let active = true;
    apiFetch<ConflictSummary>(
      buildConflictQuery(
        createForm.patientId,
        "",
        createForm.date,
        createForm.timeStart,
        createForm.timeEnd,
        createForm.interpreterId
      )
    )
      .then((value) => {
        if (active) setCreateConflicts(value);
      })
      .catch(() => {
        if (active) setCreateConflicts(null);
      });
    return () => {
      active = false;
    };
  }, [
    createOpen,
    permissions.canCreate,
    createForm.patientId,
    createForm.date,
    createForm.timeStart,
    createForm.timeEnd,
    createForm.interpreterId,
  ]);

  useEffect(() => {
    if (
      !detailOpen ||
      !permissions.canEditSchedule ||
      !detail ||
      !editForm ||
      !editForm.date
    ) {
      setEditConflicts(null);
      return;
    }
    let active = true;
    apiFetch<ConflictSummary>(
      buildConflictQuery(
        detail.patient_id,
        detail.id,
        editForm.date,
        editForm.timeStart,
        editForm.timeEnd,
        editForm.interpreterId
      )
    )
      .then((value) => {
        if (active) setEditConflicts(value);
      })
      .catch(() => {
        if (active) setEditConflicts(null);
      });
    return () => {
      active = false;
    };
  }, [detailOpen, permissions.canEditSchedule, detail, editForm]);

  useEffect(() => {
    if (
      !detailOpen ||
      !permissions.canCreate ||
      !detail ||
      !followUpVisitForm ||
      !followUpVisitForm.date
    ) {
      setFollowUpVisitConflicts(null);
      return;
    }
    let active = true;
    apiFetch<ConflictSummary>(
      buildConflictQuery(
        detail.patient_id,
        "",
        followUpVisitForm.date,
        followUpVisitForm.timeStart,
        followUpVisitForm.timeEnd,
        followUpVisitForm.interpreterId
      )
    )
      .then((value) => {
        if (active) setFollowUpVisitConflicts(value);
      })
      .catch(() => {
        if (active) setFollowUpVisitConflicts(null);
      });
    return () => {
      active = false;
    };
  }, [detailOpen, permissions.canCreate, detail, followUpVisitForm]);

  useEffect(() => {
    if (!selectedId || !detailOpen) return;
    let active = true;
    async function loadDetail() {
      setDetailLoading(true);
      setDetailError("");
      try {
        const [appointmentDetail, checklist, reminders, report, tasks, services] =
          await Promise.all([
          apiFetch<AppointmentDetail>(`/appointments/${selectedId}`),
          permissions.canManageChecklist
            ? apiFetch<ChecklistItem[]>(`/appointments/${selectedId}/checklist`)
            : Promise.resolve([]),
          permissions.canViewReminders
            ? apiFetch<ReminderEntry[]>(`/appointments/${selectedId}/reminders`)
            : Promise.resolve([]),
          permissions.canViewReport
            ? apiFetch<ReportSummary | null>(`/appointments/${selectedId}/report`)
            : Promise.resolve(null),
          permissions.canViewTasks
            ? apiFetch<TaskEntry[]>(`/tasks?appointment_id=${selectedId}`).catch(() => [])
            : Promise.resolve([]),
          permissions.canViewConciergeServices
            ? apiFetch<ConciergeServiceEntry[]>(
                `/concierge-services?appointment_id=${selectedId}`
              ).catch(() => [])
            : Promise.resolve([]),
        ]);
        const assignments =
          appointmentDetail.is_blocked || !permissions.canViewNotes
            ? []
            : await apiFetch<PatientAssignment[]>(
                `/patients/${appointmentDetail.patient_id}/assignments`
              ).catch(() => []);
        if (!active) return;
        const assignableStaff = staff.filter((member) =>
          ["patient_manager", "teamlead_interpreter", "interpreter", "concierge"].includes(
            member.role
          )
        );
        const billingOptions = staff.filter((member) => member.role === "billing");
        const conciergeOptions = staff.filter((member) => member.role === "concierge");
        const nonMedicalOptions = providers.filter(
          (provider) => provider.provider_type === "non_medical"
        );
        setDetail(appointmentDetail);
        setDetailAssignments(assignments);
        setDetailChecklist(checklist);
        setDetailReminders(reminders);
        setDetailReport(report);
        setDetailTasks(tasks);
        setDetailServices(services);
        setChecklistForm(blankChecklistForm());
        setReminderForm(blankReminderForm());
        setReportForm(
          report && report.approval_status === "rejected"
            ? {
                hours: report.hours,
                reportText: report.report_text ?? "",
              }
            : blankReportForm()
        );
        setReportRejectReason(report?.approval_status === "rejected" ? report.notes ?? "" : "");
        setTimelineFilter("all");
        setTaskForm(
          blankTaskForm(
            appointmentDetail.interpreter_id ??
              appointmentDetail.owner_user_id ??
              assignableStaff[0]?.id ??
              "",
            buildTaskDefaultDueDate(appointmentDetail)
          )
        );
        const followUpDefaultAssignee =
          assignments.find(
            (item) => !item.revoked_at && item.user_active && item.user_role === "patient_manager"
          )?.user_id ??
          appointmentDetail.owner_user_id ??
          assignments.find((item) => !item.revoked_at && item.user_active)?.user_id ??
          "";
        setFollowUpAssigneeId(followUpDefaultAssignee);
        setFollowUpVisitForm(
          buildFollowUpVisitForm(appointmentDetail, followUpDefaultAssignee)
        );
        setFollowUpVisitError("");
        setDoctorFollowUpForm(
          blankDoctorFollowUpForm(
            followUpDefaultAssignee,
            shiftLocalDateTime(appointmentAnchorDateTime(appointmentDetail), { days: 7 })
          )
        );
        setPackageEndFollowUpForm(blankPackageEndFollowUpForm(followUpDefaultAssignee));
        setExternalHandoffForm(
          blankExternalHandoffForm(
            followUpDefaultAssignee,
            shiftLocalDateTime(appointmentAnchorDateTime(appointmentDetail), { days: 1 }),
            appointmentDetail.doctor_id ? "doctor" : "clinic"
          )
        );
        setBillingHandoffForm(
          blankBillingHandoffForm(
            billingOptions[0]?.id ?? "",
            shiftLocalDateTime(appointmentAnchorDateTime(appointmentDetail), { days: 1 }),
            appointmentDetail.type === "non_medical"
              ? "concierge_settlement"
              : appointmentDetail.interpreter_id
                ? "interpreter_hours"
                : "patient_invoice"
          )
        );
        setFindingsFollowUpForm(
          blankFindingsFollowUpForm(
            followUpDefaultAssignee,
            shiftLocalDateTime(appointmentAnchorDateTime(appointmentDetail), { days: 3 }),
            appointmentDetail.doctor_id ? "arztbrief" : "written_findings"
          )
        );
        setIncomingDataForm(
          blankIncomingDataForm(
            followUpDefaultAssignee,
            shiftLocalDateTime(appointmentAnchorDateTime(appointmentDetail), { days: 2 }),
            appointmentDetail.interpreter_id ? "interpreter" : "doctor"
          )
        );
        setCompletionPlan(defaultCompletionPlan());
        setServiceForm(
          blankConciergeServiceForm({
            providerId:
              appointmentDetail.provider_id &&
              nonMedicalOptions.some(
                (provider) => provider.id === appointmentDetail.provider_id
              )
                ? appointmentDetail.provider_id
                : "",
            assignedConciergeId:
              appointmentDetail.owner_role === "concierge"
                ? appointmentDetail.owner_user_id ?? ""
                : conciergeOptions[0]?.id ?? "",
            serviceKind:
              appointmentDetail.category?.toLowerCase().includes("transfer") ? "transfer" : "other",
            title: appointmentDetail.title,
            startsAt: appointmentDetail.time_start
              ? `${appointmentDetail.date}T${appointmentDetail.time_start.slice(0, 5)}`
              : "",
            endsAt: appointmentDetail.time_end
              ? `${appointmentDetail.date}T${appointmentDetail.time_end.slice(0, 5)}`
              : "",
            currency: "EUR",
          })
        );
        setServiceDrafts(
          Object.fromEntries(
            services.map((service) => [service.id, buildServiceDraft(service)])
          )
        );
        setReportRejectReason("");
        setEditError("");
        setEditForm({
          patientId: appointmentDetail.patient_id,
          providerId: appointmentDetail.provider_id ?? "",
          doctorId: appointmentDetail.doctor_id ?? "",
          ownerUserId: appointmentDetail.owner_user_id ?? "",
          interpreterId: appointmentDetail.interpreter_id ?? "",
          appointmentType: appointmentDetail.type,
          title: appointmentDetail.title,
          date: appointmentDetail.date,
          timeStart: appointmentDetail.time_start ?? "",
          timeEnd: appointmentDetail.time_end ?? "",
          location: appointmentDetail.location ?? "",
          category: appointmentDetail.category ?? "",
          notes: appointmentDetail.notes ?? "",
        });
      } catch (error) {
        if (!active) return;
        setDetail(null);
        setDetailAssignments([]);
        setDetailChecklist([]);
        setDetailReminders([]);
        setDetailReport(null);
        setReportRejectReason("");
        setDetailTasks([]);
        setDetailServices([]);
        setTaskForm(blankTaskForm());
        setServiceForm(blankConciergeServiceForm());
        setServiceDrafts({});
        setFollowUpAssigneeId("");
        setFollowUpVisitForm(null);
        setFollowUpVisitDoctors([]);
        setFollowUpVisitConflicts(null);
        setFollowUpVisitError("");
        setTimelineFilter("all");
        setDoctorFollowUpForm(blankDoctorFollowUpForm());
        setPackageEndFollowUpForm(blankPackageEndFollowUpForm());
        setExternalHandoffForm(blankExternalHandoffForm());
        setBillingHandoffForm(blankBillingHandoffForm());
        setFindingsFollowUpForm(blankFindingsFollowUpForm());
        setIncomingDataForm(blankIncomingDataForm());
        setCompletionPlan(defaultCompletionPlan());
        setEditForm(null);
        setDetailError(error instanceof Error ? error.message : "Failed to load appointment");
      } finally {
        if (active) setDetailLoading(false);
      }
    }
    void loadDetail();
    return () => {
      active = false;
    };
  }, [
    selectedId,
    detailOpen,
    detailVersion,
    permissions.canManageChecklist,
    permissions.canViewReminders,
    permissions.canViewReport,
    permissions.canViewNotes,
    permissions.canViewTasks,
    permissions.canViewConciergeServices,
    staff,
    providers,
  ]);

  const scopedAppointments = appointments.filter((item) =>
    matchesOperationalScope(item, operationalScope, user?.id, user?.role)
  );
  const todayAppointments = scopedAppointments.filter((item) => item.date === todayDate).length;
  const activeAppointments = scopedAppointments.filter((item) =>
    ["planned", "confirmed", "in_progress"].includes(item.status)
  ).length;
  const pendingInterpreterResponses = scopedAppointments.filter(
    (item) => item.interpreter_response === "pending"
  ).length;
  const queueAppointments = scopedAppointments
    .filter((item) =>
      operationalScope === "all" ? item.status !== "cancelled" : true
    )
    .slice()
    .sort((left, right) =>
      `${left.date}${left.time_start ?? ""}`.localeCompare(
        `${right.date}${right.time_start ?? ""}`
      )
    )
    .slice(0, 10);

  function refreshAppointments() {
    startTransition(() => setAppointmentsVersion((current) => current + 1));
  }

  function refreshDetail() {
    startTransition(() => {
      setDetailVersion((current) => current + 1);
      setAppointmentsVersion((current) => current + 1);
    });
  }

  function syncCalendar(nextView?: CalendarView, nextDate?: string) {
    const api = calendarRef.current?.getApi();
    if (api && nextView && api.view.type !== nextView) {
      api.changeView(nextView);
    }
    if (api && nextDate) {
      api.gotoDate(nextDate);
    }
    if (nextView) setCalendarView(nextView);
    if (nextDate) setCalendarDate(nextDate);
  }

  function handleDatesSet(arg: DatesSetArg) {
    const nextView = arg.view.type as CalendarView;
    const nextDate = toDateInput(arg.view.calendar.getDate());
    setCalendarView((current) => (current === nextView ? current : nextView));
    setCalendarDate((current) => (current === nextDate ? current : nextDate));
  }

  function applyTodayScope() {
    startTransition(() => {
      setFilters((current) => ({ ...current, dateFrom: todayDate, dateTo: todayDate }));
    });
    syncCalendar("timeGridDay", todayDate);
  }

  function applyWeekScope() {
    startTransition(() => {
      setFilters((current) => ({ ...current, dateFrom: weekStart, dateTo: weekEnd }));
    });
    syncCalendar("timeGridWeek", weekStart);
  }

  function applyMineScope() {
    const currentUser = user;
    if (!currentUser?.id) return;
    setOperationalScope("all");
    startTransition(() => {
      setFilters((current) => ({
        ...current,
        ownerUserId: currentUser.role === "interpreter" ? "" : currentUser.id,
        interpreterId: currentUser.role === "interpreter" ? currentUser.id : "",
      }));
    });
  }

  function applyTypeScope(type: AppointmentKind) {
    setOperationalScope("all");
    startTransition(() => {
      setFilters((current) => ({ ...current, appointmentType: type }));
    });
  }

  function applyOperationalScope(scope: OperationalScope) {
    setOperationalScope(scope);
  }

  function resetQuickScopes() {
    setOperationalScope("all");
    startTransition(() => setFilters(DEFAULT_FILTERS));
    syncCalendar("timeGridWeek", todayDate);
    syncQuery({ patient: null, provider: null, doctor: null, appointment: null });
  }

  function openCreateSheetFromDate(info?: DateClickArg) {
    if (!permissions.canCreate) return;
    const next = blankAppointmentForm();
    if (info) {
      next.date = toDateInput(info.date);
      if (!info.allDay) {
        next.timeStart = toTimeInput(info.date);
        next.timeEnd = toTimeInput(new Date(info.date.getTime() + 60 * 60 * 1000));
      }
    }
    setCreateError("");
    setCreateConflicts(null);
    setCreateForm(next);
    setCreateOpen(true);
  }

  function openDetailSheet(id: string) {
    startTransition(() => {
      setSelectedId(id);
      setDetailOpen(true);
    });
    syncQuery({ appointment: id });
  }

  function handleEventClick(info: EventClickArg) {
    openDetailSheet(info.event.id);
  }

  function handleCalendarDateClick(info: DateClickArg) {
    openCreateSheetFromDate(info);
  }

  async function handleCreateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateBusy(true);
    setCreateError("");
    try {
      const result = await apiFetch<{ id: string; conflicts?: ConflictSummary }>("/appointments", {
        method: "POST",
        body: JSON.stringify({
          patient_id: createForm.patientId,
          provider_id: createForm.providerId || null,
          doctor_id: createForm.doctorId || null,
          owner_user_id: createForm.ownerUserId || null,
          interpreter_id: createForm.interpreterId || null,
          appointment_type: createForm.appointmentType,
          title: createForm.title.trim(),
          date: createForm.date,
          time_start: createForm.timeStart || null,
          time_end: createForm.timeEnd || null,
          location: createForm.location.trim() || null,
          category: createForm.category.trim() || null,
          notes: createForm.notes.trim() || null,
        }),
      });
      const notice = buildScheduleNotice(result.conflicts, createLocalWarnings);
      setCreateOpen(false);
      setCreateForm(blankAppointmentForm());
      setCreateConflicts(null);
      setAppointmentsNotice(notice);
      refreshAppointments();
      if (result.id) openDetailSheet(result.id);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Failed to create appointment");
    } finally {
      setCreateBusy(false);
    }
  }

  async function handleInlineReschedule(info: EventDropArg | EventResizeDoneArg) {
    const source = appointments.find((item) => item.id === info.event.id);
    if (!source || !permissions.canEditSchedule || source.is_blocked || !info.event.start) {
      info.revert();
      return;
    }
    const nextDate = toDateInput(info.event.start);
    const nextTimeStart = info.event.allDay ? "" : toTimeInput(info.event.start);
    const nextTimeEnd = info.event.allDay
      ? ""
      : info.event.end
        ? toTimeInput(info.event.end)
        : source.time_end || "";
    const localWarnings = buildLocalScheduleWarnings(appointments, {
      appointmentId: source.id,
      date: nextDate,
      timeStart: nextTimeStart,
      timeEnd: nextTimeEnd,
      ownerUserId: source.owner_user_id,
      providerId: source.provider_id,
      doctorId: source.doctor_id,
    });
    try {
      const result = await apiFetch<{ ok: boolean; conflicts?: ConflictSummary }>(
        `/appointments/${source.id}/update`,
        {
          method: "POST",
          body: JSON.stringify({
            provider_id: source.provider_id,
            doctor_id: source.doctor_id,
            owner_user_id: source.owner_user_id,
            interpreter_id: source.interpreter_id,
            title: source.title,
            date: nextDate,
            time_start: nextTimeStart || null,
            time_end: nextTimeEnd || null,
            location: source.location,
          }),
        }
      );
      setAppointmentsNotice(buildScheduleNotice(result.conflicts, localWarnings));
      refreshAppointments();
      if (selectedId === source.id) refreshDetail();
    } catch (error) {
      info.revert();
      setAppointmentsError(
        error instanceof Error ? error.message : "Failed to reschedule appointment"
      );
    }
  }

  async function handleStatusChange(status: AppointmentStatus) {
    if (!detail) return;
    setActionBusy(`status:${status}`);
    try {
      await apiFetch<{ ok: boolean }>(`/appointments/${detail.id}/status`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      refreshDetail();
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "Failed to change status");
    } finally {
      setActionBusy("");
    }
  }

  async function handleAssignInterpreter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || !editForm?.interpreterId) return;
    setActionBusy("assign");
    try {
      await apiFetch<{ ok: boolean }>(`/appointments/${detail.id}/assign-interpreter`, {
        method: "POST",
        body: JSON.stringify({ interpreter_id: editForm.interpreterId }),
      });
      refreshDetail();
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "Failed to assign interpreter");
    } finally {
      setActionBusy("");
    }
  }

  async function handleInterpreterResponse(response: InterpreterResponse) {
    if (!detail) return;
    setActionBusy(`response:${response}`);
    try {
      await apiFetch<{ ok: boolean }>(`/appointments/${detail.id}/interpreter-response`, {
        method: "POST",
        body: JSON.stringify({ response }),
      });
      refreshDetail();
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "Failed to submit response");
    } finally {
      setActionBusy("");
    }
  }

  async function handleEditSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || !editForm) return;
    setEditBusy(true);
    setEditError("");
    try {
      const result = await apiFetch<{ ok: boolean; conflicts?: ConflictSummary }>(
        `/appointments/${detail.id}/update`,
        {
          method: "POST",
          body: JSON.stringify({
            provider_id: editForm.providerId || null,
            doctor_id: editForm.doctorId || null,
            owner_user_id: editForm.ownerUserId || null,
            interpreter_id: editForm.interpreterId || null,
            title: editForm.title.trim(),
            date: editForm.date,
            time_start: editForm.timeStart || null,
            time_end: editForm.timeEnd || null,
            location: editForm.location.trim() || null,
          }),
        }
      );
      setAppointmentsNotice(buildScheduleNotice(result.conflicts, editLocalWarnings));
      refreshDetail();
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "Failed to save schedule");
    } finally {
      setEditBusy(false);
    }
  }

  async function handleChecklistSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    setChecklistBusy(true);
    try {
      await apiFetch<{ id: string }>(`/appointments/${detail.id}/checklist`, {
        method: "POST",
        body: JSON.stringify({
          phase: checklistForm.phase,
          item_text: checklistForm.itemText.trim(),
        }),
      });
      setChecklistForm(blankChecklistForm());
      refreshDetail();
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "Failed to add checklist item");
    } finally {
      setChecklistBusy(false);
    }
  }

  async function createChecklistItem(phase: string, itemText: string) {
    if (!detail) return;
    await apiFetch<{ id: string }>(`/appointments/${detail.id}/checklist`, {
      method: "POST",
      body: JSON.stringify({
        phase,
        item_text: itemText,
      }),
    });
  }

  async function handleChecklistComplete(itemId: string) {
    if (!detail) return;
    setActionBusy(`check:${itemId}`);
    try {
      await apiFetch<{ ok: boolean }>(
        `/appointments/${detail.id}/checklist/${itemId}/complete`,
        { method: "POST" }
      );
      refreshDetail();
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "Failed to complete item");
    } finally {
      setActionBusy("");
    }
  }

  async function handleReminderSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    setReminderBusy(true);
    try {
      await apiFetch<{ id: string }>(`/appointments/${detail.id}/reminders`, {
        method: "POST",
        body: JSON.stringify({
          user_id: reminderForm.userId,
          remind_at: toRfc3339(reminderForm.remindAt),
          title: reminderForm.title.trim(),
          description: reminderForm.description.trim() || null,
        }),
      });
      setReminderForm(blankReminderForm());
      refreshDetail();
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "Failed to add reminder");
    } finally {
      setReminderBusy(false);
    }
  }

  async function handleReminderComplete(reminderId: string) {
    if (!detail) return;
    setActionBusy(`reminder:${reminderId}`);
    try {
      await apiFetch<{ ok: boolean }>(
        `/appointments/${detail.id}/reminders/${reminderId}/complete`,
        { method: "POST" }
      );
      refreshDetail();
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "Failed to complete reminder");
    } finally {
      setActionBusy("");
    }
  }

  async function handleReportSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    setActionBusy("report-submit");
    try {
      await apiFetch<{ id: string }>(`/appointments/${detail.id}/report`, {
        method: "POST",
        body: JSON.stringify({
          hours: Number(reportForm.hours),
          report_text: reportForm.reportText.trim() || null,
        }),
      });
      setReportForm(blankReportForm());
      refreshDetail();
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "Failed to submit report");
    } finally {
      setActionBusy("");
    }
  }

  async function handleApproveReport() {
    if (!detail) return;
    setActionBusy("report-approve");
    try {
      await apiFetch<{ ok: boolean }>(`/appointments/${detail.id}/report/approve`, {
        method: "POST",
      });
      refreshDetail();
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "Failed to approve report");
    } finally {
      setActionBusy("");
    }
  }

  async function handleRejectReport() {
    if (!detail) return;
    setActionBusy("report-reject");
    try {
      await apiFetch<{ ok: boolean }>(`/appointments/${detail.id}/report/reject`, {
        method: "POST",
        body: JSON.stringify({ notes: reportRejectReason.trim() || null }),
      });
      setReportRejectReason("");
      refreshDetail();
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "Failed to reject report");
    } finally {
      setActionBusy("");
    }
  }

  async function handleTaskSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    setTaskBusy(true);
    try {
      await apiFetch<{ id: string }>("/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: taskForm.title.trim(),
          description: taskForm.description.trim() || null,
          assigned_to: taskForm.assignedTo,
          patient_id: detail.patient_id,
          order_id: detail.order_id,
          appointment_id: detail.id,
          due_date: taskForm.dueDate ? toRfc3339(taskForm.dueDate) : null,
          priority: taskForm.priority,
        }),
      });
      setTaskForm(
        blankTaskForm(
          detail.interpreter_id ?? detail.owner_user_id ?? taskAssignableStaff[0]?.id ?? "",
          buildTaskDefaultDueDate(detail)
        )
      );
      refreshDetail();
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "Failed to create task");
    } finally {
      setTaskBusy(false);
    }
  }

  async function handleTaskStatus(taskId: string, status: string) {
    setActionBusy(`task:${taskId}:${status}`);
    try {
      await apiFetch<{ ok: boolean }>(`/tasks/${taskId}/status`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      refreshDetail();
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "Failed to update task");
    } finally {
      setActionBusy("");
    }
  }

  function updateServiceDraft(
    serviceId: string,
    patch: Partial<ConciergeServiceDraftState>
  ) {
    setServiceDrafts((current) => {
      const existingDraft = current[serviceId];
      if (existingDraft) {
        return {
          ...current,
          [serviceId]: { ...existingDraft, ...patch },
        };
      }
      const service = detailServices.find((item) => item.id === serviceId);
      if (!service) return current;
      return {
        ...current,
        [serviceId]: { ...buildServiceDraft(service), ...patch },
      };
    });
  }

  async function handleServiceSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    setServiceBusy(true);
    try {
      await apiFetch<ConciergeServiceEntry>("/concierge-services", {
        method: "POST",
        body: JSON.stringify({
          patient_id: detail.patient_id,
          appointment_id: detail.id,
          provider_id: serviceForm.providerId || null,
          assigned_concierge_id: serviceForm.assignedConciergeId || null,
          service_kind: serviceForm.serviceKind,
          title: serviceForm.title.trim(),
          vendor_name: serviceForm.vendorName.trim() || null,
          vendor_contact: serviceForm.vendorContact.trim() || null,
          starts_at: serviceForm.startsAt ? toRfc3339(serviceForm.startsAt) : null,
          ends_at: serviceForm.endsAt ? toRfc3339(serviceForm.endsAt) : null,
          cost_estimate: serviceForm.costEstimate ? Number(serviceForm.costEstimate) : null,
          currency: serviceForm.currency.trim().toUpperCase() || "EUR",
          service_notes: serviceForm.serviceNotes.trim() || null,
        }),
      });
      setServiceForm(
        blankConciergeServiceForm({
          providerId:
            detail.provider_id &&
            nonMedicalProviders.some((provider) => provider.id === detail.provider_id)
              ? detail.provider_id
              : "",
          assignedConciergeId:
            detail.owner_role === "concierge"
              ? detail.owner_user_id ?? ""
              : conciergeStaff[0]?.id ?? "",
          title: detail.title,
          startsAt: detail.time_start ? `${detail.date}T${detail.time_start.slice(0, 5)}` : "",
          endsAt: detail.time_end ? `${detail.date}T${detail.time_end.slice(0, 5)}` : "",
          currency: "EUR",
        })
      );
      refreshDetail();
    } catch (error) {
      setDetailError(
        error instanceof Error ? error.message : "Failed to create concierge service"
      );
    } finally {
      setServiceBusy(false);
    }
  }

  async function handleServiceSave(serviceId: string) {
    const draft = serviceDrafts[serviceId];
    if (!draft) return;
    setActionBusy(`service:${serviceId}`);
    try {
      const payload = permissions.canManageConciergeBilling
        ? {
            provider_id: draft.providerId || null,
            assigned_concierge_id: draft.assignedConciergeId || null,
            title: draft.title.trim(),
            status: draft.status,
            billing_status: draft.billingStatus,
            booking_reference: draft.bookingReference.trim() || null,
            vendor_name: draft.vendorName.trim() || null,
            vendor_contact: draft.vendorContact.trim() || null,
            starts_at: draft.startsAt ? toRfc3339(draft.startsAt) : null,
            ends_at: draft.endsAt ? toRfc3339(draft.endsAt) : null,
            actual_cost: draft.actualCost ? Number(draft.actualCost) : null,
            currency: draft.currency.trim().toUpperCase() || "EUR",
            service_notes: draft.serviceNotes.trim() || null,
            billing_notes: draft.billingNotes.trim() || null,
          }
        : {
            status: draft.status,
            booking_reference: draft.bookingReference.trim() || null,
            vendor_name: draft.vendorName.trim() || null,
            vendor_contact: draft.vendorContact.trim() || null,
            starts_at: draft.startsAt ? toRfc3339(draft.startsAt) : null,
            ends_at: draft.endsAt ? toRfc3339(draft.endsAt) : null,
            actual_cost: draft.actualCost ? Number(draft.actualCost) : null,
            service_notes: draft.serviceNotes.trim() || null,
          };
      await apiFetch<ConciergeServiceEntry>(`/concierge-services/${serviceId}/update`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      refreshDetail();
    } catch (error) {
      setDetailError(
        error instanceof Error ? error.message : "Failed to update concierge service"
      );
    } finally {
      setActionBusy("");
    }
  }

  function openInternalChat(peerId: string, name: string, role: string, draft: string) {
    const params = new URLSearchParams({
      peer: peerId,
      name,
      role,
      draft,
    });
    navigate(`/chat?${params.toString()}`);
  }

  function openAppointmentChat(peer: HandoffStakeholder) {
    if (!detail) return;
    openInternalChat(
      peer.id,
      peer.name,
      peer.role,
      `Appointment handoff: ${detail.patient_pid} · ${detail.title} · ${slotLabel(detail)}.`
    );
  }

  async function createAppointmentDirective(params: {
    title: string;
    assigneeId: string;
    remindAt: string;
    description: string;
    createTask: boolean;
    taskPriority: string;
  }) {
    if (!detail) return;

    const requests: Array<Promise<unknown>> = [
      apiFetch<{ id: string }>(`/appointments/${detail.id}/reminders`, {
        method: "POST",
        body: JSON.stringify({
          user_id: params.assigneeId,
          remind_at: toRfc3339(params.remindAt),
          title: params.title,
          description: params.description,
        }),
      }),
    ];

    if (params.createTask && permissions.canCreateTasks) {
      requests.push(
        apiFetch<{ id: string }>("/tasks", {
          method: "POST",
          body: JSON.stringify({
            title: params.title,
            description: params.description,
            assigned_to: params.assigneeId,
            patient_id: detail.patient_id,
            order_id: detail.order_id,
            appointment_id: detail.id,
            due_date: toRfc3339(params.remindAt),
            priority: params.taskPriority,
          }),
        })
      );
    }

    await Promise.all(requests);
  }

  async function handleFollowUpPreset(preset: (typeof FOLLOW_UP_PRESETS)[number]) {
    if (!detail || !followUpAssigneeId) return;
    const anchor = appointmentAnchorDateTime(detail);
    const remindAt = shiftLocalDateTime(anchor, {
      days: "offsetDays" in preset ? preset.offsetDays : undefined,
      months: "offsetMonths" in preset ? preset.offsetMonths : undefined,
    });
    if (!remindAt) return;
    setFollowUpBusy(true);
    try {
      await apiFetch<{ id: string }>(`/appointments/${detail.id}/reminders`, {
        method: "POST",
        body: JSON.stringify({
          user_id: followUpAssigneeId,
          remind_at: toRfc3339(remindAt),
          title: preset.title,
          description: `Auto-planned from appointment ${detail.patient_pid} · ${detail.title}.`,
        }),
      });
      refreshDetail();
    } catch (error) {
      setDetailError(
        error instanceof Error ? error.message : "Failed to schedule follow-up reminder"
      );
    } finally {
      setFollowUpBusy(false);
    }
  }

  async function handleDoctorFollowUpSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || !doctorFollowUpForm.assigneeId || !doctorFollowUpForm.dueAt) return;

    const followUpTitle = `${DOCTOR_FOLLOW_UP_PREFIX} ${doctorFollowUpForm.title.trim()}`;
    const descriptionParts = [
      detail.doctor_name ? `Doctor: ${detail.doctor_name}` : "",
      detail.provider_name ? `Clinic: ${detail.provider_name}` : "",
      `Appointment: ${detail.patient_pid} · ${detail.title} · ${slotLabel(detail)}`,
      doctorFollowUpForm.notes.trim() || "",
    ].filter(Boolean);
    const description = descriptionParts.join("\n");

    setDoctorFollowUpBusy(true);
    try {
      await createAppointmentDirective({
        title: followUpTitle,
        assigneeId: doctorFollowUpForm.assigneeId,
        remindAt: doctorFollowUpForm.dueAt,
        description,
        createTask: doctorFollowUpForm.createTask,
        taskPriority: doctorFollowUpForm.taskPriority,
      });
      setDoctorFollowUpForm(
        blankDoctorFollowUpForm(
          doctorFollowUpForm.assigneeId,
          shiftLocalDateTime(doctorFollowUpForm.dueAt, { days: 7 })
        )
      );
      refreshDetail();
    } catch (error) {
      setDetailError(
        error instanceof Error ? error.message : "Failed to create doctor follow-up"
      );
    } finally {
      setDoctorFollowUpBusy(false);
    }
  }

  async function handlePackageEndFollowUpSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || !packageEndFollowUpForm.assigneeId || !packageEndFollowUpForm.packageEndDate) {
      return;
    }

    const remindAt = shiftLocalDateTime(
      `${packageEndFollowUpForm.packageEndDate}T09:00`,
      { months: -1 }
    );
    if (!remindAt) return;

    const followUpTitle = `${PACKAGE_END_FOLLOW_UP_PREFIX} ${packageEndFollowUpForm.title.trim()}`;
    const descriptionParts = [
      `Package target end date: ${formatDateLabel(packageEndFollowUpForm.packageEndDate)}`,
      detail.order_id ? `Order: ${detail.order_id}` : "",
      detail.provider_name ? `Clinic: ${detail.provider_name}` : "",
      detail.doctor_name ? `Doctor: ${detail.doctor_name}` : "",
      `Appointment: ${detail.patient_pid} · ${detail.title} · ${slotLabel(detail)}`,
      packageEndFollowUpForm.notes.trim() || "",
    ].filter(Boolean);

    setPackageEndFollowUpBusy(true);
    try {
      await createAppointmentDirective({
        title: followUpTitle,
        assigneeId: packageEndFollowUpForm.assigneeId,
        remindAt,
        description: descriptionParts.join("\n"),
        createTask: packageEndFollowUpForm.createTask,
        taskPriority: packageEndFollowUpForm.taskPriority,
      });
      setPackageEndFollowUpForm(
        blankPackageEndFollowUpForm(packageEndFollowUpForm.assigneeId)
      );
      refreshDetail();
    } catch (error) {
      setDetailError(
        error instanceof Error ? error.message : "Failed to create package-end follow-up"
      );
    } finally {
      setPackageEndFollowUpBusy(false);
    }
  }

  function openExternalHandoffChatDraft() {
    if (!detail || !externalHandoffForm.assigneeId) return;
    const assignee = doctorFollowUpAssignees.find(
      (item) => item.id === externalHandoffForm.assigneeId
    );
    if (!assignee) return;

    const targetLabel =
      externalHandoffForm.target === "doctor"
        ? detail.doctor_name || "doctor contact"
        : detail.provider_name || "clinic contact";
    const draftParts = [
      `External handoff: ${detail.patient_pid} · ${detail.title}`,
      `Target: ${targetLabel}`,
      `Slot: ${slotLabel(detail)}`,
      externalHandoffForm.notes.trim() || "",
    ].filter(Boolean);

    openInternalChat(
      assignee.id,
      assignee.name,
      assignee.role,
      draftParts.join("\n")
    );
  }

  async function handleExternalHandoffSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || !externalHandoffForm.assigneeId || !externalHandoffForm.dueAt) return;

    const targetLabel =
      externalHandoffForm.target === "doctor"
        ? detail.doctor_name || "Doctor"
        : detail.provider_name || "Clinic";
    const handoffTitle = `${EXTERNAL_HANDOFF_PREFIX} ${externalHandoffForm.title.trim()}`;
    const descriptionParts = [
      `Target: ${externalHandoffForm.target === "doctor" ? "Doctor" : "Clinic"} · ${targetLabel}`,
      `Appointment: ${detail.patient_pid} · ${detail.title} · ${slotLabel(detail)}`,
      externalHandoffForm.notes.trim() || "",
    ].filter(Boolean);

    setExternalHandoffBusy(true);
    try {
      await createAppointmentDirective({
        title: handoffTitle,
        assigneeId: externalHandoffForm.assigneeId,
        remindAt: externalHandoffForm.dueAt,
        description: descriptionParts.join("\n"),
        createTask: externalHandoffForm.createTask,
        taskPriority: externalHandoffForm.taskPriority,
      });
      setExternalHandoffForm(
        blankExternalHandoffForm(
          externalHandoffForm.assigneeId,
          shiftLocalDateTime(externalHandoffForm.dueAt, { days: 1 }),
          externalHandoffForm.target
        )
      );
      refreshDetail();
    } catch (error) {
      setDetailError(
        error instanceof Error ? error.message : "Failed to create external handoff"
      );
    } finally {
      setExternalHandoffBusy(false);
    }
  }

  function openBillingHandoffChatDraft() {
    if (!detail || !billingHandoffForm.assigneeId) return;
    const assignee = billingStaff.find((item) => item.id === billingHandoffForm.assigneeId);
    if (!assignee) return;

    const draftParts = [
      `Billing handoff: ${detail.patient_pid} · ${detail.title}`,
      `Track: ${billingHandoffKindLabel(billingHandoffForm.kind)}`,
      `Slot: ${slotLabel(detail)}`,
      billingHandoffForm.kind === "interpreter_hours" && detailReport
        ? `Interpreter hours: ${detailReport.hours}h · ${reportApprovalLabel(detailReport.approval_status)}`
        : "",
      billingHandoffForm.kind === "concierge_settlement"
        ? `Concierge services: ${readyConciergeServices.length} ready · ${settledConciergeServices.length} billed/settled`
        : "",
      billingHandoffForm.notes.trim() || "",
    ].filter(Boolean);

    openInternalChat(assignee.id, assignee.name, assignee.role, draftParts.join("\n"));
  }

  async function handleBillingHandoffSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || !billingHandoffForm.assigneeId || !billingHandoffForm.dueAt) return;

    const titleSuffix =
      billingHandoffForm.title.trim() || billingHandoffKindLabel(billingHandoffForm.kind);
    const handoffTitle = `${BILLING_HANDOFF_PREFIX} ${titleSuffix}`;
    const descriptionParts = [
      `Track: ${billingHandoffKindLabel(billingHandoffForm.kind)}`,
      `Appointment: ${detail.patient_pid} · ${detail.title} · ${slotLabel(detail)}`,
      detail.provider_name ? `Clinic: ${detail.provider_name}` : "",
      detail.doctor_name ? `Doctor: ${detail.doctor_name}` : "",
      billingHandoffForm.kind === "interpreter_hours" && detailReport
        ? `Interpreter hours: ${detailReport.hours}h · ${reportApprovalLabel(detailReport.approval_status)}`
        : "",
      billingHandoffForm.kind === "concierge_settlement"
        ? `Concierge services ready: ${readyConciergeServices.length}; billed or settled: ${settledConciergeServices.length}`
        : "",
      billingHandoffForm.notes.trim() || "",
    ].filter(Boolean);

    setBillingHandoffBusy(true);
    try {
      await createAppointmentDirective({
        title: handoffTitle,
        assigneeId: billingHandoffForm.assigneeId,
        remindAt: billingHandoffForm.dueAt,
        description: descriptionParts.join("\n"),
        createTask: billingHandoffForm.createTask,
        taskPriority: billingHandoffForm.taskPriority,
      });
      setBillingHandoffForm(
        blankBillingHandoffForm(
          billingHandoffForm.assigneeId,
          shiftLocalDateTime(billingHandoffForm.dueAt, { days: 1 }),
          billingHandoffForm.kind
        )
      );
      refreshDetail();
    } catch (error) {
      setDetailError(
        error instanceof Error ? error.message : "Failed to create billing handoff"
      );
    } finally {
      setBillingHandoffBusy(false);
    }
  }

  function openFindingsFollowUpChatDraft() {
    if (!detail || !findingsFollowUpForm.assigneeId) return;
    const assignee = doctorFollowUpAssignees.find(
      (item) => item.id === findingsFollowUpForm.assigneeId
    );
    if (!assignee) return;

    const draftParts = [
      `Findings follow-up: ${detail.patient_pid} · ${detail.title}`,
      `Expected: ${findingsArtifactLabel(findingsFollowUpForm.artifact)}`,
      detail.provider_name ? `Clinic: ${detail.provider_name}` : "",
      detail.doctor_name ? `Doctor: ${detail.doctor_name}` : "",
      findingsFollowUpForm.translationRequired ? "Written translation required." : "",
      findingsFollowUpForm.sendToPatient ? "Patient dispatch required after processing." : "",
      findingsFollowUpForm.notes.trim() || "",
    ].filter(Boolean);

    openInternalChat(
      assignee.id,
      assignee.name,
      assignee.role,
      draftParts.join("\n")
    );
  }

  async function handleFindingsFollowUpSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || !findingsFollowUpForm.assigneeId || !findingsFollowUpForm.dueAt) return;

    const artifactLabel = findingsArtifactLabel(findingsFollowUpForm.artifact);
    const title = `${FINDINGS_FOLLOW_UP_PREFIX} ${artifactLabel}`;
    const descriptionParts = [
      detail.provider_name ? `Clinic: ${detail.provider_name}` : "",
      detail.doctor_name ? `Doctor: ${detail.doctor_name}` : "",
      `Appointment: ${detail.patient_pid} · ${detail.title} · ${slotLabel(detail)}`,
      findingsFollowUpForm.translationRequired ? "Written translation required." : "",
      findingsFollowUpForm.sendToPatient ? "Patient dispatch required after processing." : "",
      findingsFollowUpForm.notes.trim() || "",
    ].filter(Boolean);

    const checklistItems = [
      `${FINDINGS_CHECKLIST_PREFIX} Await ${artifactLabel}`,
      `${FINDINGS_CHECKLIST_PREFIX} Review and categorize ${artifactLabel}`,
      findingsFollowUpForm.translationRequired
        ? `${FINDINGS_CHECKLIST_PREFIX} Written translation completed`
        : "",
      findingsFollowUpForm.sendToPatient
        ? `${FINDINGS_CHECKLIST_PREFIX} Findings package sent to patient`
        : "",
    ].filter(Boolean);

    setFindingsFollowUpBusy(true);
    try {
      await Promise.all([
        createAppointmentDirective({
          title,
          assigneeId: findingsFollowUpForm.assigneeId,
          remindAt: findingsFollowUpForm.dueAt,
          description: descriptionParts.join("\n"),
          createTask: findingsFollowUpForm.createTask,
          taskPriority: findingsFollowUpForm.taskPriority,
        }),
        ...checklistItems.map((item) => createChecklistItem("followup", item)),
      ]);
      setFindingsFollowUpForm(
        blankFindingsFollowUpForm(
          findingsFollowUpForm.assigneeId,
          shiftLocalDateTime(findingsFollowUpForm.dueAt, { days: 7 }),
          findingsFollowUpForm.artifact
        )
      );
      refreshDetail();
    } catch (error) {
      setDetailError(
        error instanceof Error ? error.message : "Failed to create findings follow-up"
      );
    } finally {
      setFindingsFollowUpBusy(false);
    }
  }

  function openIncomingDataChatDraft() {
    if (!detail || !incomingDataForm.assigneeId) return;
    const assignee = doctorFollowUpAssignees.find((item) => item.id === incomingDataForm.assigneeId);
    if (!assignee) return;

    const draftParts = [
      `Incoming data intake: ${detail.patient_pid} · ${detail.title}`,
      `Source: ${incomingDataSourceLabel(incomingDataForm.source)}`,
      `Category: ${incomingDataCategoryLabel(incomingDataForm.category)}`,
      incomingDataForm.requiresCaseUpdate ? "Case/anamnesis update required." : "",
      incomingDataForm.requiresPatientFollowUp ? "Patient follow-up required after triage." : "",
      incomingDataForm.notes.trim() || "",
    ].filter(Boolean);

    openInternalChat(assignee.id, assignee.name, assignee.role, draftParts.join("\n"));
  }

  async function handleIncomingDataSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || !incomingDataForm.assigneeId || !incomingDataForm.dueAt) return;

    const title = `${INCOMING_DATA_PREFIX} ${incomingDataCategoryLabel(
      incomingDataForm.category
    )} from ${incomingDataSourceLabel(incomingDataForm.source)}`;
    const descriptionParts = [
      detail.provider_name ? `Clinic: ${detail.provider_name}` : "",
      detail.doctor_name ? `Doctor: ${detail.doctor_name}` : "",
      `Appointment: ${detail.patient_pid} · ${detail.title} · ${slotLabel(detail)}`,
      `Source: ${incomingDataSourceLabel(incomingDataForm.source)}`,
      `Category: ${incomingDataCategoryLabel(incomingDataForm.category)}`,
      incomingDataForm.requiresCaseUpdate ? "Case/anamnesis update required." : "",
      incomingDataForm.requiresPatientFollowUp ? "Patient follow-up required after review." : "",
      incomingDataForm.notes.trim() || "",
    ].filter(Boolean);

    const checklistItems = [
      `${INCOMING_DATA_CHECKLIST_PREFIX} Review and categorize incoming data`,
      incomingDataForm.requiresCaseUpdate
        ? `${INCOMING_DATA_CHECKLIST_PREFIX} Apply update to case/anamnesis`
        : "",
      incomingDataForm.requiresPatientFollowUp
        ? `${INCOMING_DATA_CHECKLIST_PREFIX} Patient follow-up after data triage`
        : "",
    ].filter(Boolean);

    setIncomingDataBusy(true);
    try {
      await Promise.all([
        createAppointmentDirective({
          title,
          assigneeId: incomingDataForm.assigneeId,
          remindAt: incomingDataForm.dueAt,
          description: descriptionParts.join("\n"),
          createTask: incomingDataForm.createTask,
          taskPriority: incomingDataForm.taskPriority,
        }),
        ...checklistItems.map((item) => createChecklistItem("followup", item)),
      ]);
      setIncomingDataForm(
        blankIncomingDataForm(
          incomingDataForm.assigneeId,
          shiftLocalDateTime(incomingDataForm.dueAt, { days: 2 }),
          incomingDataForm.source
        )
      );
      refreshDetail();
    } catch (error) {
      setDetailError(
        error instanceof Error ? error.message : "Failed to create incoming data intake"
      );
    } finally {
      setIncomingDataBusy(false);
    }
  }

  function applyFollowUpVisitPreset(preset: (typeof FOLLOW_UP_PRESETS)[number]) {
    if (!followUpVisitForm || !detail) return;
    const anchor = appointmentAnchorDateTime(detail);
    const shifted = shiftLocalDateTime(anchor, {
      days: "offsetDays" in preset ? preset.offsetDays : undefined,
      months: "offsetMonths" in preset ? preset.offsetMonths : undefined,
    });
    if (!shifted) return;
    const nextReminderAt = shiftLocalDateTime(shifted, { days: -3 });
    setFollowUpVisitForm((current) =>
      current
        ? {
            ...current,
            date: shifted.slice(0, 10),
            timeStart: shifted.slice(11, 16),
            timeEnd: current.timeEnd
              ? shiftLocalDateTime(
                  `${detail.date}T${detail.time_end?.slice(0, 5) ?? current.timeEnd}`,
                  {
                    days: "offsetDays" in preset ? preset.offsetDays : undefined,
                    months: "offsetMonths" in preset ? preset.offsetMonths : undefined,
                  }
                ).slice(11, 16)
              : current.timeEnd,
            title:
              current.title.trim() === "" || current.title.startsWith("Follow-up")
                ? preset.title
                : current.title,
            reminderAt: nextReminderAt || current.reminderAt,
          }
        : current
    );
  }

  async function handleFollowUpVisitSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || !followUpVisitForm) return;
    setFollowUpVisitBusy(true);
    setFollowUpVisitError("");
    try {
      const result = await apiFetch<{ id: string; conflicts?: ConflictSummary }>("/appointments", {
        method: "POST",
        body: JSON.stringify({
          patient_id: detail.patient_id,
          provider_id: followUpVisitForm.providerId || null,
          doctor_id: followUpVisitForm.doctorId || null,
          owner_user_id: followUpVisitForm.ownerUserId || null,
          interpreter_id: followUpVisitForm.interpreterId || null,
          order_id: followUpVisitForm.linkOrder ? detail.order_id : null,
          appointment_type: followUpVisitForm.appointmentType,
          title: followUpVisitForm.title.trim(),
          date: followUpVisitForm.date,
          time_start: followUpVisitForm.timeStart || null,
          time_end: followUpVisitForm.timeEnd || null,
          location: followUpVisitForm.location.trim() || null,
          category: followUpVisitForm.category.trim() || null,
          notes: followUpVisitForm.notes.trim() || null,
        }),
      });

      if (
        result.id &&
        followUpVisitForm.createReminder &&
        followUpVisitForm.reminderUserId &&
        followUpVisitForm.reminderAt
      ) {
        await apiFetch<{ id: string }>(`/appointments/${result.id}/reminders`, {
          method: "POST",
          body: JSON.stringify({
            user_id: followUpVisitForm.reminderUserId,
            remind_at: toRfc3339(followUpVisitForm.reminderAt),
            title: `Prepare follow-up visit: ${followUpVisitForm.title.trim()}`,
            description: `Planned from appointment ${detail.patient_pid} · ${detail.title} · ${slotLabel(detail)}.`,
          }),
        });
      }

      setAppointmentsNotice(
        result.conflicts
          ? `${buildScheduleNotice(result.conflicts, followUpVisitLocalWarnings)} Follow-up visit created.`
          : "Follow-up visit created."
      );
      refreshAppointments();
      setFollowUpVisitForm(buildFollowUpVisitForm(detail, followUpVisitForm.reminderUserId));
      if (result.id) {
        openDetailSheet(result.id);
      } else {
        refreshDetail();
      }
    } catch (error) {
      setFollowUpVisitError(
        error instanceof Error ? error.message : "Failed to create follow-up visit"
      );
    } finally {
      setFollowUpVisitBusy(false);
    }
  }

  async function handleCompleteWithFollowUp() {
    if (!detail) return;
    const selectedPresets = FOLLOW_UP_PRESETS.filter((preset) => completionPlan[preset.id]);
    if (selectedPresets.length > 0 && !followUpAssigneeId) return;

    setCompletionBusy(true);
    let completed = false;
    try {
      await apiFetch<{ ok: boolean }>(`/appointments/${detail.id}/status`, {
        method: "POST",
        body: JSON.stringify({ status: "completed" }),
      });
      completed = true;

      if (selectedPresets.length > 0) {
        const anchor = appointmentAnchorDateTime(detail);
        await Promise.all(
          selectedPresets.map((preset) => {
            const remindAt = shiftLocalDateTime(anchor, {
              days: "offsetDays" in preset ? preset.offsetDays : undefined,
              months: "offsetMonths" in preset ? preset.offsetMonths : undefined,
            });
            return apiFetch<{ id: string }>(`/appointments/${detail.id}/reminders`, {
              method: "POST",
              body: JSON.stringify({
                user_id: followUpAssigneeId,
                remind_at: toRfc3339(remindAt),
                title: preset.title,
                description: `Auto-planned during appointment completion for ${detail.patient_pid} · ${detail.title}.`,
              }),
            });
          })
        );
      }

      setAppointmentsNotice(
        selectedPresets.length > 0
          ? `Appointment completed. ${selectedPresets.length} follow-up reminder(s) scheduled.`
          : "Appointment completed."
      );
      refreshDetail();
    } catch (error) {
      if (completed) {
        setDetailError(
          error instanceof Error
            ? `Appointment completed, but follow-up scheduling failed: ${error.message}`
            : "Appointment completed, but follow-up scheduling failed"
        );
        refreshDetail();
      } else {
        setDetailError(
          error instanceof Error ? error.message : "Failed to complete appointment"
        );
      }
    } finally {
      setCompletionBusy(false);
    }
  }

  if (!permissions.canViewPage) {
    return (
      <div className={sectionCardClass("p-8 text-sm text-muted-foreground")}>
        Your current role does not have access to appointments.
      </div>
    );
  }

  return (
    <>
      <div className="space-y-6">
        <section className="relative overflow-hidden rounded-[2rem] border border-slate-200/80 bg-[linear-gradient(135deg,#f8fbff_0%,#eef5ff_42%,#ffffff_100%)] px-6 py-6 shadow-[0_30px_80px_rgba(15,23,42,0.08)]">
          <div className="absolute inset-y-0 right-0 w-80 bg-[radial-gradient(circle_at_top_right,rgba(14,165,233,0.18),transparent_58%)]" />
          <div className="relative flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-white/85 px-3 py-1 text-xs font-medium tracking-[0.16em] text-sky-700 uppercase">
                <CalendarClock className="size-3.5" />
                Appointment Control
              </div>
              <div className="space-y-2">
                <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
                  Calendar, scheduling and operational follow-up in one workspace.
                </h1>
                <p className="max-w-2xl text-sm leading-6 text-slate-600">
                  Manage medical slots, concierge bookings, interpreter handoff,
                  checklist execution and reporting without leaving the appointment flow.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" className="rounded-2xl bg-white/80" onClick={refreshAppointments}>
                <RefreshCw className="size-4" />
                Refresh
              </Button>
              {permissions.canCreate ? (
                <Button className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800" onClick={() => openCreateSheetFromDate()}>
                  <Plus className="size-4" />
                  New appointment
                </Button>
              ) : null}
            </div>
          </div>
          <div className="relative mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatsCard icon={CalendarDays} label="Today" value={String(todayAppointments)} tone="sky" />
            <StatsCard icon={CheckCircle2} label="Active" value={String(activeAppointments)} tone="emerald" />
            <StatsCard icon={UsersRound} label="Pending interpreter" value={String(pendingInterpreterResponses)} tone="amber" />
            <StatsCard icon={UserRound} label="Visible in scope" value={String(scopedAppointments.length)} tone="slate" />
          </div>
          <div className="relative mt-5 flex flex-wrap items-center gap-2">
            <QuickScopeButton active={filters.dateFrom === todayDate && filters.dateTo === todayDate} onClick={applyTodayScope}>
              Today
            </QuickScopeButton>
            <QuickScopeButton active={filters.dateFrom === weekStart && filters.dateTo === weekEnd} onClick={applyWeekScope}>
              This week
            </QuickScopeButton>
            <QuickScopeButton active={mineFilterActive} onClick={applyMineScope}>
              Mine
            </QuickScopeButton>
            <QuickScopeButton active={filters.appointmentType === "medical"} onClick={() => applyTypeScope("medical")}>
              Medical
            </QuickScopeButton>
            <QuickScopeButton active={filters.appointmentType === "non_medical"} onClick={() => applyTypeScope("non_medical")}>
              Concierge
            </QuickScopeButton>
            <QuickScopeButton active={filters.appointmentType === "internal"} onClick={() => applyTypeScope("internal")}>
              Internal
            </QuickScopeButton>
            <Button variant="ghost" size="sm" className="rounded-full px-3" onClick={resetQuickScopes}>
              Reset scope
            </Button>
          </div>
          {scopeOptions.length > 1 ? (
            <div className="relative mt-3 flex flex-wrap items-center gap-2">
              {scopeOptions.map((option) => (
                <QuickScopeButton
                  key={option.id}
                  active={operationalScope === option.id}
                  onClick={() => applyOperationalScope(option.id)}
                >
                  {option.label}
                </QuickScopeButton>
              ))}
            </div>
          ) : null}
        </section>

        {appointmentsError ? <Banner tone="error">{appointmentsError}</Banner> : null}
        {appointmentsNotice ? <Banner tone="warning">{appointmentsNotice}</Banner> : null}
        {metadataError ? <Banner tone="warning">{metadataError}</Banner> : null}

        <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="space-y-6">
            <section className={sectionCardClass("p-5")}>
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-slate-950">Filters</h2>
                  <p className="text-xs text-muted-foreground">
                    Narrow the calendar to the exact operational slice.
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => { setOperationalScope("all"); setFilters(DEFAULT_FILTERS); syncQuery({ patient: null, provider: null, doctor: null, appointment: null }); }}>
                  Reset
                </Button>
              </div>
              <div className="space-y-4">
                <Field label="Search">
                  <Input value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Patient, title, clinic, PID" className="h-10 rounded-xl bg-slate-50" />
                </Field>
                <Field label="Type">
                  <select value={filters.appointmentType} onChange={(event) => setFilters((current) => ({ ...current, appointmentType: event.target.value }))} className={selectClassName}>
                    <option value="">All types</option>
                    {TYPE_OPTIONS.map((value) => <option key={value} value={value}>{appointmentTypeLabel(value)}</option>)}
                  </select>
                </Field>
                <Field label="Status">
                  <select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))} className={selectClassName}>
                    <option value="">All statuses</option>
                    {STATUS_OPTIONS.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}
                  </select>
                </Field>
                <Field label="Patient">
                  <select value={filters.patientId} onChange={(event) => { const patientId = event.target.value; setFilters((current) => ({ ...current, patientId })); syncQuery({ patient: patientId || null }); }} className={selectClassName}>
                    <option value="">All patients</option>
                    {patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.patient_id} · {patientName(patient)}</option>)}
                  </select>
                </Field>
                <Field label="Clinic">
                  <select value={filters.providerId} onChange={(event) => { const providerId = event.target.value; setFilters((current) => ({ ...current, providerId, doctorId: "" })); syncQuery({ provider: providerId || null, doctor: null }); }} className={selectClassName}>
                    <option value="">All clinics</option>
                    {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
                  </select>
                </Field>
                <Field label="Doctor">
                  <select value={filters.doctorId} onChange={(event) => { const doctorId = event.target.value; setFilters((current) => ({ ...current, doctorId })); syncQuery({ doctor: doctorId || null }); }} className={selectClassName} disabled={!filters.providerId}>
                    <option value="">All doctors</option>
                    {filterDoctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctorLabel(doctor)}</option>)}
                  </select>
                </Field>
                <Field label="Owner">
                  <select value={filters.ownerUserId} onChange={(event) => setFilters((current) => ({ ...current, ownerUserId: event.target.value }))} className={selectClassName}>
                    <option value="">All owners</option>
                    {staff.map((member) => <option key={member.id} value={member.id}>{member.name} · {roleLabel(member.role)}</option>)}
                  </select>
                </Field>
                <Field label="Interpreter">
                  <select value={filters.interpreterId} onChange={(event) => setFilters((current) => ({ ...current, interpreterId: event.target.value }))} className={selectClassName}>
                    <option value="">All interpreters</option>
                    {interpreters.map((member) => <option key={member.id} value={member.id}>{member.name} · {roleLabel(member.role)}</option>)}
                  </select>
                </Field>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
                  <Field label="From"><Input type="date" value={filters.dateFrom} onChange={(event) => setFilters((current) => ({ ...current, dateFrom: event.target.value }))} className="h-10 rounded-xl bg-slate-50" /></Field>
                  <Field label="To"><Input type="date" value={filters.dateTo} onChange={(event) => setFilters((current) => ({ ...current, dateTo: event.target.value }))} className="h-10 rounded-xl bg-slate-50" /></Field>
                </div>
              </div>
            </section>

            <section className={sectionCardClass("p-5")}>
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-slate-950">Operational queue</h2>
                  <p className="text-xs text-muted-foreground">
                    {operationalScope === "all"
                      ? "The next visible appointments in your current scope."
                      : "The next appointments matching the active operational mode."}
                  </p>
                </div>
                {appointmentsLoading || metadataLoading ? <LoaderCircle className="size-4 animate-spin text-muted-foreground" /> : null}
              </div>
              <div className="space-y-3">
                {queueAppointments.length === 0 ? <EmptyState text="No appointments match the current operational scope." /> : queueAppointments.map((item) => (
                  <button key={item.id} type="button" onClick={() => openDetailSheet(item.id)} className="w-full rounded-2xl border border-slate-200/80 bg-slate-50/80 px-4 py-3 text-left transition hover:border-sky-200 hover:bg-white">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-950">{item.title}</p>
                        <p className="truncate text-xs text-slate-500">{item.patient_pid} · {item.patient_name}</p>
                      </div>
                      <span className={cn("rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]", statusBadgeClass(item.status))}>{statusLabel(item.status)}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                      <span className="inline-flex items-center gap-1"><Clock3 className="size-3.5" />{slotLabel(item)}</span>
                      {item.provider_name ? <span className="inline-flex items-center gap-1"><Stethoscope className="size-3.5" />{item.provider_name}</span> : null}
                    </div>
                    <p className="mt-3 truncate text-xs font-medium text-slate-500">
                      {operationalScopeReason(item, operationalScope, user?.role)}
                    </p>
                  </button>
                ))}
              </div>
            </section>
          </aside>

          <section className={sectionCardClass("overflow-hidden p-4 md:p-5")}>
            <div className="mb-4">
              <h2 className="text-sm font-semibold text-slate-950">Operational calendar</h2>
              <p className="text-xs text-muted-foreground">
                Drag to reschedule when your role allows it. Click a slot to open the full workflow.
              </p>
            </div>
            <div className="appointments-calendar-shell">
              <FullCalendar
                ref={calendarRef}
                plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
                initialView={calendarView}
                initialDate={calendarDate}
                headerToolbar={{ left: "prev,next today", center: "title", right: "dayGridMonth,timeGridWeek,timeGridDay,listWeek" }}
                buttonText={{ today: "Today", month: "Month", week: "Week", day: "Day", list: "List" }}
                height="auto"
                firstDay={1}
                slotMinTime="06:00:00"
                slotMaxTime="22:00:00"
                dayMaxEvents={3}
                nowIndicator
                editable={permissions.canEditSchedule}
                eventStartEditable={permissions.canEditSchedule}
                eventDurationEditable={permissions.canEditSchedule}
                eventResizableFromStart={permissions.canEditSchedule}
                dateClick={handleCalendarDateClick}
                eventClick={handleEventClick}
                eventDrop={handleInlineReschedule}
                eventResize={handleInlineReschedule}
                eventContent={renderCalendarEventContent}
                datesSet={handleDatesSet}
                events={scopedAppointments.map((item) => toCalendarEvent(item, permissions.canEditSchedule))}
              />
            </div>
          </section>
        </div>
      </div>

      <Sheet open={createOpen} onOpenChange={setCreateOpen}>
        <SheetContent side="right" className="w-full sm:max-w-[760px]">
          <SheetHeader className="border-b border-border/70 pb-4">
            <SheetTitle>Create appointment</SheetTitle>
            <SheetDescription>
              Build a new medical, concierge or internal slot and validate conflicts before it lands in the calendar.
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-4 pb-6">
            <form onSubmit={handleCreateSubmit} className="space-y-6 pt-5">
              {createError ? <Banner tone="error">{createError}</Banner> : null}
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Patient">
                  <select value={createForm.patientId} onChange={(event) => setCreateForm((current) => ({ ...current, patientId: event.target.value }))} required className={selectClassName}>
                    <option value="">Select patient</option>
                    {patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.patient_id} · {patientName(patient)}</option>)}
                  </select>
                </Field>
                <Field label="Type">
                  <select value={createForm.appointmentType} onChange={(event) => setCreateForm((current) => ({ ...current, appointmentType: event.target.value as AppointmentKind, providerId: event.target.value === "internal" ? "" : current.providerId, doctorId: event.target.value === "internal" ? "" : current.doctorId }))} className={selectClassName}>
                    {TYPE_OPTIONS.map((value) => <option key={value} value={value}>{appointmentTypeLabel(value)}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="Title">
                <Input value={createForm.title} onChange={(event) => setCreateForm((current) => ({ ...current, title: event.target.value }))} placeholder="Consultation, airport transfer, interpreter briefing" required className="h-10 rounded-xl bg-slate-50" />
              </Field>
              <div className="grid gap-4 md:grid-cols-3">
                <Field label="Date"><Input type="date" value={createForm.date} onChange={(event) => setCreateForm((current) => ({ ...current, date: event.target.value }))} required className="h-10 rounded-xl bg-slate-50" /></Field>
                <Field label="Start time"><Input type="time" value={createForm.timeStart} onChange={(event) => setCreateForm((current) => ({ ...current, timeStart: event.target.value }))} className="h-10 rounded-xl bg-slate-50" /></Field>
                <Field label="End time"><Input type="time" value={createForm.timeEnd} onChange={(event) => setCreateForm((current) => ({ ...current, timeEnd: event.target.value }))} className="h-10 rounded-xl bg-slate-50" /></Field>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Clinic">
                  <select value={createForm.providerId} onChange={(event) => setCreateForm((current) => ({ ...current, providerId: event.target.value, doctorId: "" }))} className={selectClassName} disabled={createForm.appointmentType === "internal"}>
                    <option value="">No clinic</option>
                    {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}{provider.address_city ? ` · ${provider.address_city}` : ""}</option>)}
                  </select>
                </Field>
                <Field label="Doctor">
                  <select value={createForm.doctorId} onChange={(event) => setCreateForm((current) => ({ ...current, doctorId: event.target.value }))} className={selectClassName} disabled={!createForm.providerId}>
                    <option value="">No doctor</option>
                    {createDoctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctorLabel(doctor)}</option>)}
                  </select>
                </Field>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Owner">
                  <select value={createForm.ownerUserId} onChange={(event) => setCreateForm((current) => ({ ...current, ownerUserId: event.target.value }))} className={selectClassName}>
                    <option value="">Auto / current role</option>
                    {staff.map((member) => <option key={member.id} value={member.id}>{member.name} · {roleLabel(member.role)}</option>)}
                  </select>
                </Field>
                <Field label="Interpreter">
                  <select value={createForm.interpreterId} onChange={(event) => setCreateForm((current) => ({ ...current, interpreterId: event.target.value }))} className={selectClassName}>
                    <option value="">No interpreter yet</option>
                    {interpreters.map((member) => <option key={member.id} value={member.id}>{member.name} · {roleLabel(member.role)}</option>)}
                  </select>
                </Field>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Location"><Input value={createForm.location} onChange={(event) => setCreateForm((current) => ({ ...current, location: event.target.value }))} placeholder="Clinic room, hotel lobby, airport, call" className="h-10 rounded-xl bg-slate-50" /></Field>
                <Field label="Category"><Input value={createForm.category} onChange={(event) => setCreateForm((current) => ({ ...current, category: event.target.value }))} placeholder="Initial consult, follow-up, transfer, briefing" className="h-10 rounded-xl bg-slate-50" /></Field>
              </div>
              <Field label="Notes">
                <textarea value={createForm.notes} onChange={(event) => setCreateForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Operational notes, patient context, clinic handoff, concierge specifics." className={textareaClassName} rows={4} />
              </Field>
              <ConflictPanel conflicts={createConflicts} />
              <ScheduleWarningsPanel warnings={createLocalWarnings} />
              <div className="flex justify-end gap-3 border-t border-border/70 pt-4">
                <Button type="button" variant="outline" className="rounded-2xl" onClick={() => setCreateOpen(false)}>Cancel</Button>
                <Button type="submit" className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800" disabled={createBusy}>
                  {createBusy ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}
                  {createBusy ? "Creating" : "Create appointment"}
                </Button>
              </div>
            </form>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet
        open={detailOpen}
        onOpenChange={(open) => {
          setDetailOpen(open);
          if (!open) {
            setSelectedId("");
            setDetail(null);
            setDetailAssignments([]);
            setDetailTasks([]);
            setDetailServices([]);
            setDetailChecklist([]);
            setDetailReminders([]);
            setDetailReport(null);
            setReminderForm(blankReminderForm());
            setDoctorFollowUpForm(blankDoctorFollowUpForm());
            setDoctorFollowUpBusy(false);
            setPackageEndFollowUpForm(blankPackageEndFollowUpForm());
            setPackageEndFollowUpBusy(false);
            setExternalHandoffForm(blankExternalHandoffForm());
            setExternalHandoffBusy(false);
            setBillingHandoffForm(blankBillingHandoffForm());
            setBillingHandoffBusy(false);
            setFindingsFollowUpForm(blankFindingsFollowUpForm());
            setFindingsFollowUpBusy(false);
            setIncomingDataForm(blankIncomingDataForm());
            setIncomingDataBusy(false);
            setReportForm(blankReportForm());
            setTaskForm(blankTaskForm());
            setTaskBusy(false);
            setServiceForm(blankConciergeServiceForm());
            setServiceDrafts({});
            setServiceBusy(false);
            setFollowUpAssigneeId("");
            setFollowUpBusy(false);
            setCompletionPlan(defaultCompletionPlan());
            setCompletionBusy(false);
            setReportRejectReason("");
            setActionBusy("");
            setEditForm(null);
            setFollowUpVisitForm(null);
            setFollowUpVisitDoctors([]);
            setFollowUpVisitConflicts(null);
            setFollowUpVisitError("");
            setFollowUpVisitBusy(false);
            setTimelineFilter("all");
            syncQuery({ appointment: null });
          }
        }}
      >
        <SheetContent side="right" className="w-full sm:max-w-[860px]">
          <SheetHeader className="border-b border-border/70 pb-4">
            <SheetTitle>Appointment workflow</SheetTitle>
            <SheetDescription>
              Review context, reschedule, manage interpreter flow and close the operational loop from one sheet.
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-4 pb-6">
            {detailLoading ? (
              <div className="flex min-h-[320px] items-center justify-center text-muted-foreground">
                <LoaderCircle className="mr-2 size-4 animate-spin" />
                Loading appointment
              </div>
            ) : detailError ? (
              <div className="pt-5">
                <Banner tone="error">{detailError}</Banner>
              </div>
            ) : detail ? (
              <div className="space-y-6 pt-5">
                <section className={sectionCardClass("p-5")}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn("rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]", typeBadgeClass(detail.type))}>{appointmentTypeLabel(detail.type)}</span>
                    <span className={cn("rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]", statusBadgeClass(detail.status))}>{statusLabel(detail.status)}</span>
                    {detail.interpreter_response ? <span className="rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">Interpreter {responseLabel(detail.interpreter_response)}</span> : null}
                  </div>
                  <div className="mt-4 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div>
                      <h2 className="text-2xl font-semibold text-slate-950">{detail.title}</h2>
                      <p className="mt-2 text-sm text-slate-600">{detail.patient_pid} · {detail.patient_name}</p>
                    </div>
                    <div className="grid gap-2 text-sm text-slate-600">
                      <InfoLine icon={Clock3} label={slotLabel(detail)} />
                      <InfoLine icon={MapPin} label={detail.location || "Location not specified"} />
                      <InfoLine icon={Stethoscope} label={detail.provider_name || "No clinic linked"} />
                    </div>
                  </div>
                  {detail.is_blocked ? <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">Concierge view is intentionally limited for medical slots. Clinical notes and provider specifics stay hidden here.</div> : null}
                </section>
                <section className={sectionCardClass("p-5")}>
                  <h3 className="text-sm font-semibold text-slate-950">Operational context</h3>
                  <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <ContextCard label="Checklist phase" value={detail.checklist_phase || "Preparation"} meta={appointmentTypeLabel(detail.type)} />
                    <ContextCard label="Owner" value={detail.owner_name || "Unassigned"} meta={detail.owner_role ? roleLabel(detail.owner_role) : "No owner set"} />
                    <ContextCard label="Interpreter" value={detail.interpreter_name || "Not assigned"} meta={detail.interpreter_response ? responseLabel(detail.interpreter_response) : "Awaiting assignment"} />
                    <ContextCard label="Linked records" value={detail.order_id || "No linked order"} meta={detail.category || formatDateTimeLabel(detail.created_at)} />
                  </div>
                </section>
                <section className={sectionCardClass("p-5")}>
                  <h3 className="text-sm font-semibold text-slate-950">Linked workspaces</h3>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button type="button" variant="outline" className="rounded-2xl" onClick={() => navigate(`/patients?patient=${detail.patient_id}`)}>
                      Patient
                    </Button>
                    {detail.order_id ? (
                      <Button type="button" variant="outline" className="rounded-2xl" onClick={() => navigate(`/orders?order=${detail.order_id}`)}>
                        Order
                      </Button>
                    ) : null}
                    {detail.provider_id ? (
                      <Button type="button" variant="outline" className="rounded-2xl" onClick={() => navigate(`/providers?provider=${detail.provider_id}`)}>
                        Clinic
                      </Button>
                    ) : null}
                    <Button type="button" variant="outline" className="rounded-2xl" onClick={() => navigate(`/cases?patient=${detail.patient_id}`)}>
                      Cases
                    </Button>
                  </div>
                </section>
                <section className={sectionCardClass("p-5")}>
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-950">Appointment timeline</h3>
                      <p className="text-xs text-slate-500">
                        Unified event trail across scheduling, interpreter handling, follow-up,
                        concierge work and operational execution.
                      </p>
                    </div>
                    <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                      {visibleTimelineEvents.length} event
                      {visibleTimelineEvents.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {(["all", "workflow", "interpreter", "clinical", "followup", "concierge"] as const).map(
                      (filter) => (
                        <Button
                          key={filter}
                          type="button"
                          variant={timelineFilter === filter ? "default" : "outline"}
                          size="sm"
                          className={cn(
                            "rounded-2xl",
                            timelineFilter === filter
                              ? "bg-slate-950 text-white hover:bg-slate-800"
                              : ""
                          )}
                          onClick={() => setTimelineFilter(filter)}
                        >
                          {filter === "all"
                            ? "All"
                            : filter === "followup"
                              ? "Follow-up"
                              : filter.charAt(0).toUpperCase() + filter.slice(1)}
                        </Button>
                      )
                    )}
                  </div>
                  <div className="mt-4 space-y-3">
                    {visibleTimelineEvents.length === 0 ? (
                      <EmptyState text="No timeline events match the current filter." />
                    ) : (
                      visibleTimelineEvents.map((item) => (
                        <div
                          key={item.id}
                          className="flex flex-col gap-3 rounded-2xl border border-slate-200/80 bg-slate-50/80 px-4 py-3 md:flex-row md:items-start md:justify-between"
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-semibold text-slate-950">{item.title}</p>
                              <span
                                className={cn(
                                  "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]",
                                  timelineToneClass(item.tone)
                                )}
                              >
                                {item.kind}
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-slate-500">
                              {formatDateTimeLabel(item.occurredAt)}
                            </p>
                            {item.detail ? (
                              <p className="mt-3 whitespace-pre-line text-sm text-slate-600">
                                {item.detail}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </section>
                {!detail.is_blocked ? (
                  <section className={sectionCardClass("p-5")}>
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-950">
                          Handoff and follow-up
                        </h3>
                        <p className="text-xs text-slate-500">
                          Coordinate the assigned team and schedule post-care follow-up from the
                          appointment itself.
                        </p>
                      </div>
                      <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                        {handoffStakeholders.length} stakeholder
                        {handoffStakeholders.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="mt-4 space-y-3">
                      {handoffStakeholders.length === 0 ? (
                        <EmptyState text="No active case assignments are linked to this appointment yet." />
                      ) : (
                        handoffStakeholders.map((peer) => (
                          <div
                            key={peer.id}
                            className="flex flex-col gap-3 rounded-2xl border border-slate-200/80 bg-slate-50/80 px-4 py-3 md:flex-row md:items-center md:justify-between"
                          >
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-semibold text-slate-950">
                                  {peer.name}
                                </p>
                                <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                                  {roleLabel(peer.role)}
                                </span>
                                {peer.badges.map((badge) => (
                                  <span
                                    key={badge}
                                    className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600"
                                  >
                                    {badge}
                                  </span>
                                ))}
                              </div>
                              <p className="mt-1 text-xs text-slate-500">
                                {detail.patient_pid} · {slotLabel(detail)}
                              </p>
                            </div>
                            <Button
                              type="button"
                              variant="outline"
                              className="rounded-2xl"
                              onClick={() => openAppointmentChat(peer)}
                            >
                              Open chat
                            </Button>
                          </div>
                        ))
                      )}
                    </div>
                    {permissions.canManageReminders ? (
                      <div className="mt-5 grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
                        <Field label="Follow-up assignee">
                          <select
                            value={followUpAssigneeId}
                            onChange={(event) => setFollowUpAssigneeId(event.target.value)}
                            className={selectClassName}
                          >
                            <option value="">Select assignee</option>
                            {handoffStakeholders.map((peer) => (
                              <option key={peer.id} value={peer.id}>
                                {peer.name} · {roleLabel(peer.role)}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <div className="flex flex-wrap items-end gap-2">
                          {FOLLOW_UP_PRESETS.map((preset) => (
                            <Button
                              key={preset.id}
                              type="button"
                              variant="outline"
                              className="rounded-2xl"
                              disabled={followUpBusy || !followUpAssigneeId}
                              onClick={() => handleFollowUpPreset(preset)}
                            >
                              {followUpBusy ? (
                                <LoaderCircle className="size-4 animate-spin" />
                              ) : null}
                              {preset.label}
                            </Button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </section>
                ) : null}
                {!detail.is_blocked && permissions.canCreate && followUpVisitForm ? (
                  <section className={sectionCardClass("p-5")}>
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-950">
                          Follow-up visit planning
                        </h3>
                        <p className="text-xs text-slate-500">
                          Schedule the next control visit or examination directly from the current
                          appointment context.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {FOLLOW_UP_PRESETS.map((preset) => (
                          <Button
                            key={preset.id}
                            type="button"
                            variant="outline"
                            size="sm"
                            className="rounded-2xl"
                            onClick={() => applyFollowUpVisitPreset(preset)}
                          >
                            {preset.label}
                          </Button>
                        ))}
                      </div>
                    </div>
                    {followUpVisitError ? (
                      <div className="mt-4">
                        <Banner tone="error">{followUpVisitError}</Banner>
                      </div>
                    ) : null}
                    <form onSubmit={handleFollowUpVisitSubmit} className="mt-4 space-y-4">
                      <Field label="Title">
                        <Input
                          value={followUpVisitForm.title}
                          onChange={(event) =>
                            setFollowUpVisitForm((current) =>
                              current ? { ...current, title: event.target.value } : current
                            )
                          }
                          className="h-10 rounded-xl bg-slate-50"
                          required
                        />
                      </Field>
                      <div className="grid gap-4 md:grid-cols-3">
                        <Field label="Date">
                          <Input
                            type="date"
                            value={followUpVisitForm.date}
                            onChange={(event) =>
                              setFollowUpVisitForm((current) =>
                                current ? { ...current, date: event.target.value } : current
                              )
                            }
                            className="h-10 rounded-xl bg-slate-50"
                            required
                          />
                        </Field>
                        <Field label="Start time">
                          <Input
                            type="time"
                            value={followUpVisitForm.timeStart}
                            onChange={(event) =>
                              setFollowUpVisitForm((current) =>
                                current ? { ...current, timeStart: event.target.value } : current
                              )
                            }
                            className="h-10 rounded-xl bg-slate-50"
                          />
                        </Field>
                        <Field label="End time">
                          <Input
                            type="time"
                            value={followUpVisitForm.timeEnd}
                            onChange={(event) =>
                              setFollowUpVisitForm((current) =>
                                current ? { ...current, timeEnd: event.target.value } : current
                              )
                            }
                            className="h-10 rounded-xl bg-slate-50"
                          />
                        </Field>
                      </div>
                      <div className="grid gap-4 md:grid-cols-2">
                        <Field label="Clinic">
                          <select
                            value={followUpVisitForm.providerId}
                            onChange={(event) =>
                              setFollowUpVisitForm((current) =>
                                current
                                  ? {
                                      ...current,
                                      providerId: event.target.value,
                                      doctorId: "",
                                    }
                                  : current
                              )
                            }
                            className={selectClassName}
                            disabled={followUpVisitForm.appointmentType === "internal"}
                          >
                            <option value="">No clinic</option>
                            {providers.map((provider) => (
                              <option key={provider.id} value={provider.id}>
                                {provider.name}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Doctor">
                          <select
                            value={followUpVisitForm.doctorId}
                            onChange={(event) =>
                              setFollowUpVisitForm((current) =>
                                current ? { ...current, doctorId: event.target.value } : current
                              )
                            }
                            className={selectClassName}
                            disabled={!followUpVisitForm.providerId}
                          >
                            <option value="">No doctor</option>
                            {followUpVisitDoctors.map((doctor) => (
                              <option key={doctor.id} value={doctor.id}>
                                {doctorLabel(doctor)}
                              </option>
                            ))}
                          </select>
                        </Field>
                      </div>
                      <div className="grid gap-4 md:grid-cols-2">
                        <Field label="Owner">
                          <select
                            value={followUpVisitForm.ownerUserId}
                            onChange={(event) =>
                              setFollowUpVisitForm((current) =>
                                current ? { ...current, ownerUserId: event.target.value } : current
                              )
                            }
                            className={selectClassName}
                          >
                            <option value="">Auto / current role</option>
                            {staff.map((member) => (
                              <option key={member.id} value={member.id}>
                                {member.name} · {roleLabel(member.role)}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Interpreter">
                          <select
                            value={followUpVisitForm.interpreterId}
                            onChange={(event) =>
                              setFollowUpVisitForm((current) =>
                                current
                                  ? { ...current, interpreterId: event.target.value }
                                  : current
                              )
                            }
                            className={selectClassName}
                          >
                            <option value="">No interpreter</option>
                            {interpreters.map((member) => (
                              <option key={member.id} value={member.id}>
                                {member.name} · {roleLabel(member.role)}
                              </option>
                            ))}
                          </select>
                        </Field>
                      </div>
                      <div className="grid gap-4 md:grid-cols-2">
                        <Field label="Location">
                          <Input
                            value={followUpVisitForm.location}
                            onChange={(event) =>
                              setFollowUpVisitForm((current) =>
                                current ? { ...current, location: event.target.value } : current
                              )
                            }
                            className="h-10 rounded-xl bg-slate-50"
                          />
                        </Field>
                        <Field label="Category">
                          <Input
                            value={followUpVisitForm.category}
                            onChange={(event) =>
                              setFollowUpVisitForm((current) =>
                                current ? { ...current, category: event.target.value } : current
                              )
                            }
                            className="h-10 rounded-xl bg-slate-50"
                          />
                        </Field>
                      </div>
                      <Field label="Notes">
                        <textarea
                          value={followUpVisitForm.notes}
                          onChange={(event) =>
                            setFollowUpVisitForm((current) =>
                              current ? { ...current, notes: event.target.value } : current
                            )
                          }
                          className={textareaClassName}
                          rows={4}
                          placeholder="Control goals, required prep, physician recommendation, patient context."
                        />
                      </Field>
                      {detail.order_id ? (
                        <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            checked={followUpVisitForm.linkOrder}
                            onChange={(event) =>
                              setFollowUpVisitForm((current) =>
                                current ? { ...current, linkOrder: event.target.checked } : current
                              )
                            }
                            className="mt-0.5 size-4 rounded border-slate-300 text-slate-950"
                          />
                          <span>Link this follow-up visit to the current order.</span>
                        </label>
                      ) : null}
                      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
                        <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            checked={followUpVisitForm.createReminder}
                            onChange={(event) =>
                              setFollowUpVisitForm((current) =>
                                current
                                  ? { ...current, createReminder: event.target.checked }
                                  : current
                              )
                            }
                            className="mt-0.5 size-4 rounded border-slate-300 text-slate-950"
                          />
                          <span>Create a preparation reminder on the new follow-up visit.</span>
                        </label>
                        <Field label="Reminder assignee">
                          <select
                            value={followUpVisitForm.reminderUserId}
                            onChange={(event) =>
                              setFollowUpVisitForm((current) =>
                                current
                                  ? { ...current, reminderUserId: event.target.value }
                                  : current
                              )
                            }
                            className={selectClassName}
                            disabled={!followUpVisitForm.createReminder}
                          >
                            <option value="">Select assignee</option>
                            {staff.map((member) => (
                              <option key={member.id} value={member.id}>
                                {member.name} · {roleLabel(member.role)}
                              </option>
                            ))}
                          </select>
                        </Field>
                      </div>
                      {followUpVisitForm.createReminder ? (
                        <Field label="Reminder at">
                          <Input
                            type="datetime-local"
                            value={followUpVisitForm.reminderAt}
                            onChange={(event) =>
                              setFollowUpVisitForm((current) =>
                                current ? { ...current, reminderAt: event.target.value } : current
                              )
                            }
                            className="h-10 rounded-xl bg-slate-50"
                          />
                        </Field>
                      ) : null}
                      <ConflictPanel conflicts={followUpVisitConflicts} />
                      <ScheduleWarningsPanel warnings={followUpVisitLocalWarnings} />
                      <div className="flex justify-end">
                        <Button
                          type="submit"
                          className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
                          disabled={followUpVisitBusy || !followUpVisitForm.title.trim()}
                        >
                          {followUpVisitBusy ? (
                            <LoaderCircle className="size-4 animate-spin" />
                          ) : null}
                          Create follow-up visit
                        </Button>
                      </div>
                    </form>
                  </section>
                ) : null}
                {!detail.is_blocked && permissions.canViewReminders ? (
                  <section className={sectionCardClass("p-5")}>
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-950">
                          Doctor-directed follow-up
                        </h3>
                        <p className="text-xs text-slate-500">
                          Capture next visits, control checks and prescription-driven actions
                          separately from the standard 1 week / 1 month / 6 months cadence.
                        </p>
                      </div>
                      <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                        {doctorDirectedReminders.length + doctorDirectedTasks.length} directed item
                        {doctorDirectedReminders.length + doctorDirectedTasks.length === 1
                          ? ""
                          : "s"}
                      </span>
                    </div>
                    <div className="mt-4 grid gap-4 xl:grid-cols-2">
                      <div className="space-y-3">
                        <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                            Reminder trail
                          </p>
                          <div className="mt-3 space-y-3">
                            {doctorDirectedReminders.length === 0 ? (
                              <EmptyState text="No doctor-directed reminders yet." />
                            ) : (
                              doctorDirectedReminders.map((item) => (
                                <div
                                  key={item.id}
                                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
                                >
                                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                                    <div>
                                      <p className="text-sm font-medium text-slate-900">
                                        {item.title.replace(`${DOCTOR_FOLLOW_UP_PREFIX} `, "")}
                                      </p>
                                      <p className="mt-1 text-xs text-slate-500">
                                        {item.user_name} · {formatDateTimeLabel(item.remind_at)}
                                      </p>
                                    </div>
                                    {item.is_completed ? (
                                      <span className="text-xs font-medium text-emerald-700">
                                        Completed {formatDateTimeLabel(item.completed_at)}
                                      </span>
                                    ) : (
                                      <span className="text-xs font-medium text-amber-700">
                                        Pending
                                      </span>
                                    )}
                                  </div>
                                  {item.description ? (
                                    <p className="mt-3 whitespace-pre-line text-sm text-slate-600">
                                      {item.description}
                                    </p>
                                  ) : null}
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                            Task trail
                          </p>
                          <div className="mt-3 space-y-3">
                            {doctorDirectedTasks.length === 0 ? (
                              <EmptyState text="No doctor-directed tasks yet." />
                            ) : (
                              doctorDirectedTasks.map((task) => (
                                <div
                                  key={task.id}
                                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
                                >
                                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                                    <div>
                                      <p className="text-sm font-medium text-slate-900">
                                        {task.title.replace(`${DOCTOR_FOLLOW_UP_PREFIX} `, "")}
                                      </p>
                                      <p className="mt-1 text-xs text-slate-500">
                                        {task.assigned_to_name} · {taskStatusLabel(task.status)} ·{" "}
                                        {taskPriorityLabel(task.priority)}
                                      </p>
                                    </div>
                                    <span className="text-xs text-slate-500">
                                      {task.due_date
                                        ? formatDateTimeLabel(task.due_date)
                                        : "No due date"}
                                    </span>
                                  </div>
                                  {task.description ? (
                                    <p className="mt-3 whitespace-pre-line text-sm text-slate-600">
                                      {task.description}
                                    </p>
                                  ) : null}
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      </div>
                      {permissions.canManageReminders ? (
                        <form onSubmit={handleDoctorFollowUpSubmit} className="space-y-4 rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4">
                          <Field label="Directive title">
                            <Input
                              value={doctorFollowUpForm.title}
                              onChange={(event) =>
                                setDoctorFollowUpForm((current) => ({
                                  ...current,
                                  title: event.target.value,
                                }))
                              }
                              placeholder="Repeat MRI, control bloodwork, cardiology check"
                              className="h-10 rounded-xl bg-white"
                              required
                            />
                          </Field>
                          <Field label="Assignee">
                            <select
                              value={doctorFollowUpForm.assigneeId}
                              onChange={(event) =>
                                setDoctorFollowUpForm((current) => ({
                                  ...current,
                                  assigneeId: event.target.value,
                                }))
                              }
                              className={selectClassName}
                              required
                            >
                              <option value="">Select assignee</option>
                              {doctorFollowUpAssignees.map((member) => (
                                <option key={member.id} value={member.id}>
                                  {member.name} · {roleLabel(member.role)}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <Field label="Due at">
                            <Input
                              type="datetime-local"
                              value={doctorFollowUpForm.dueAt}
                              onChange={(event) =>
                                setDoctorFollowUpForm((current) => ({
                                  ...current,
                                  dueAt: event.target.value,
                                }))
                              }
                              className="h-10 rounded-xl bg-white"
                              required
                            />
                          </Field>
                          <Field label="Doctor notes / directive">
                            <textarea
                              value={doctorFollowUpForm.notes}
                              onChange={(event) =>
                                setDoctorFollowUpForm((current) => ({
                                  ...current,
                                  notes: event.target.value,
                                }))
                              }
                              className={textareaClassName}
                              rows={5}
                              placeholder="Summarise the physician's recommendation, target timing, required preparation or control package."
                            />
                          </Field>
                          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px]">
                            <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                              <input
                                type="checkbox"
                                checked={doctorFollowUpForm.createTask}
                                onChange={(event) =>
                                  setDoctorFollowUpForm((current) => ({
                                    ...current,
                                    createTask: event.target.checked,
                                  }))
                                }
                                className="mt-0.5 size-4 rounded border-slate-300 text-slate-950"
                              />
                              <span>
                                Mirror this directive as an operational task for execution and
                                ownership.
                              </span>
                            </label>
                            <Field label="Task priority">
                              <select
                                value={doctorFollowUpForm.taskPriority}
                                onChange={(event) =>
                                  setDoctorFollowUpForm((current) => ({
                                    ...current,
                                    taskPriority: event.target.value,
                                  }))
                                }
                                className={selectClassName}
                                disabled={!doctorFollowUpForm.createTask}
                              >
                                {TASK_PRIORITY_OPTIONS.map((value) => (
                                  <option key={value} value={value}>
                                    {taskPriorityLabel(value)}
                                  </option>
                                ))}
                              </select>
                            </Field>
                          </div>
                          <div className="flex justify-end">
                            <Button
                              type="submit"
                              className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
                              disabled={
                                doctorFollowUpBusy ||
                                !doctorFollowUpForm.title.trim() ||
                                !doctorFollowUpForm.assigneeId ||
                                !doctorFollowUpForm.dueAt
                              }
                            >
                              {doctorFollowUpBusy ? (
                                <LoaderCircle className="size-4 animate-spin" />
                              ) : null}
                              Create doctor follow-up
                            </Button>
                          </div>
                        </form>
                      ) : (
                        <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4">
                          <EmptyState text="This role can review doctor-directed follow-up but cannot create new directives." />
                        </div>
                      )}
                    </div>
                  </section>
                ) : null}
                {!detail.is_blocked && permissions.canManageChecklist && permissions.canViewReminders ? (
                  <section className={sectionCardClass("p-5")}>
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-950">
                          Incoming unprocessed medical data
                        </h3>
                        <p className="text-xs text-slate-500">
                          Capture incoming updates from patients, doctors, interpreters or clinics
                          that still need triage, categorization and case update.
                        </p>
                      </div>
                      <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                        {openIncomingDataChecklistCount === 0 && incomingDataChecklist.length > 0
                          ? "Intake clear"
                          : `${openIncomingDataChecklistCount} open`}
                      </span>
                    </div>
                    <div className="mt-4 grid gap-4 md:grid-cols-3">
                      <ContextCard
                        label="Checklist"
                        value={
                          incomingDataChecklist.length === 0
                            ? "Not started"
                            : `${incomingDataChecklist.length} item(s)`
                        }
                        meta={
                          incomingDataChecklist.length === 0
                            ? "No intake checklist yet."
                            : `${openIncomingDataChecklistCount} item(s) still open.`
                        }
                      />
                      <ContextCard
                        label="Reminders"
                        value={
                          incomingDataReminders.length === 0
                            ? "0"
                            : String(incomingDataReminders.length)
                        }
                        meta="Deadline control for data triage and processing."
                      />
                      <ContextCard
                        label="Tasks"
                        value={incomingDataTasks.length === 0 ? "0" : String(incomingDataTasks.length)}
                        meta="Operational ownership for categorization and case updates."
                      />
                    </div>
                    <div className="mt-4 grid gap-4 xl:grid-cols-2">
                      <div className="space-y-4">
                        <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                            Intake checklist
                          </p>
                          <div className="mt-3 space-y-3">
                            {incomingDataChecklist.length === 0 ? (
                              <EmptyState text="No incoming data intake items created yet." />
                            ) : (
                              incomingDataChecklist.map((item) => (
                                <div
                                  key={item.id}
                                  className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 md:flex-row md:items-center md:justify-between"
                                >
                                  <div>
                                    <p className="text-sm font-medium text-slate-900">
                                      {item.item_text.replace(`${INCOMING_DATA_CHECKLIST_PREFIX} `, "")}
                                    </p>
                                    <p className="mt-1 text-xs uppercase tracking-[0.12em] text-slate-500">
                                      {item.phase}
                                    </p>
                                  </div>
                                  {item.is_completed ? (
                                    <span className="text-xs font-medium text-emerald-700">
                                      Completed {formatDateTimeLabel(item.completed_at)}
                                    </span>
                                  ) : (
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="rounded-2xl"
                                      disabled={Boolean(actionBusy)}
                                      onClick={() => handleChecklistComplete(item.id)}
                                    >
                                      {actionBusy === `check:${item.id}` ? (
                                        <LoaderCircle className="size-4 animate-spin" />
                                      ) : null}
                                      Complete
                                    </Button>
                                  )}
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                            Reminder and task trail
                          </p>
                          <div className="mt-3 space-y-3">
                            {incomingDataReminders.length === 0 && incomingDataTasks.length === 0 ? (
                              <EmptyState text="No intake reminders or tasks logged yet." />
                            ) : (
                              <>
                                {incomingDataReminders.map((item) => (
                                  <div
                                    key={item.id}
                                    className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
                                  >
                                    <p className="text-sm font-medium text-slate-900">
                                      {item.title.replace(`${INCOMING_DATA_PREFIX} `, "")}
                                    </p>
                                    <p className="mt-1 text-xs text-slate-500">
                                      {item.user_name} · {formatDateTimeLabel(item.remind_at)}
                                    </p>
                                    {item.description ? (
                                      <p className="mt-3 whitespace-pre-line text-sm text-slate-600">
                                        {item.description}
                                      </p>
                                    ) : null}
                                  </div>
                                ))}
                                {incomingDataTasks.map((task) => (
                                  <div
                                    key={task.id}
                                    className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
                                  >
                                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                                      <p className="text-sm font-medium text-slate-900">
                                        {task.title.replace(`${INCOMING_DATA_PREFIX} `, "")}
                                      </p>
                                      <span className="text-xs text-slate-500">
                                        {taskStatusLabel(task.status)} · {taskPriorityLabel(task.priority)}
                                      </span>
                                    </div>
                                    <p className="mt-1 text-xs text-slate-500">
                                      {task.assigned_to_name}
                                      {task.due_date ? ` · ${formatDateTimeLabel(task.due_date)}` : ""}
                                    </p>
                                    {task.description ? (
                                      <p className="mt-3 whitespace-pre-line text-sm text-slate-600">
                                        {task.description}
                                      </p>
                                    ) : null}
                                  </div>
                                ))}
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <form
                        onSubmit={handleIncomingDataSubmit}
                        className="space-y-4 rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4"
                      >
                        <div className="grid gap-4 md:grid-cols-2">
                          <Field label="Source">
                            <select
                              value={incomingDataForm.source}
                              onChange={(event) =>
                                setIncomingDataForm((current) => ({
                                  ...current,
                                  source: event.target.value as IncomingDataSource,
                                }))
                              }
                              className={selectClassName}
                            >
                              <option value="patient">Patient</option>
                              <option value="doctor">Doctor</option>
                              <option value="clinic">Clinic</option>
                              <option value="interpreter">Interpreter</option>
                              <option value="external_lab">External lab</option>
                              <option value="other">Other</option>
                            </select>
                          </Field>
                          <Field label="Category">
                            <select
                              value={incomingDataForm.category}
                              onChange={(event) =>
                                setIncomingDataForm((current) => ({
                                  ...current,
                                  category: event.target.value as IncomingDataCategory,
                                }))
                              }
                              className={selectClassName}
                            >
                              <option value="medical_update">Medical update</option>
                              <option value="diagnosis">Diagnosis</option>
                              <option value="medication">Medication</option>
                              <option value="symptom">Symptom update</option>
                              <option value="lab_result">Lab result</option>
                              <option value="imaging">Imaging</option>
                              <option value="recommendation">Recommendation</option>
                              <option value="risk_flag">Risk flag</option>
                              <option value="other">Other</option>
                            </select>
                          </Field>
                        </div>
                        <div className="grid gap-4 md:grid-cols-2">
                          <Field label="Assignee">
                            <select
                              value={incomingDataForm.assigneeId}
                              onChange={(event) =>
                                setIncomingDataForm((current) => ({
                                  ...current,
                                  assigneeId: event.target.value,
                                }))
                              }
                              className={selectClassName}
                              required
                            >
                              <option value="">Select assignee</option>
                              {doctorFollowUpAssignees.map((member) => (
                                <option key={member.id} value={member.id}>
                                  {member.name} · {roleLabel(member.role)}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <Field label="Review deadline">
                            <Input
                              type="datetime-local"
                              value={incomingDataForm.dueAt}
                              onChange={(event) =>
                                setIncomingDataForm((current) => ({
                                  ...current,
                                  dueAt: event.target.value,
                                }))
                              }
                              className="h-10 rounded-xl bg-white"
                              required
                            />
                          </Field>
                        </div>
                        <Field label="Notes / incoming signal">
                          <textarea
                            value={incomingDataForm.notes}
                            onChange={(event) =>
                              setIncomingDataForm((current) => ({
                                ...current,
                                notes: event.target.value,
                              }))
                            }
                            className={textareaClassName}
                            rows={5}
                            placeholder="Describe what came in, from whom, and what still needs to be reviewed or categorized."
                          />
                        </Field>
                        <div className="grid gap-3 md:grid-cols-2">
                          <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                            <input
                              type="checkbox"
                              checked={incomingDataForm.requiresCaseUpdate}
                              onChange={(event) =>
                                setIncomingDataForm((current) => ({
                                  ...current,
                                  requiresCaseUpdate: event.target.checked,
                                }))
                              }
                              className="mt-0.5 size-4 rounded border-slate-300 text-slate-950"
                            />
                            <span>Case or anamnesis update required.</span>
                          </label>
                          <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                            <input
                              type="checkbox"
                              checked={incomingDataForm.requiresPatientFollowUp}
                              onChange={(event) =>
                                setIncomingDataForm((current) => ({
                                  ...current,
                                  requiresPatientFollowUp: event.target.checked,
                                }))
                              }
                              className="mt-0.5 size-4 rounded border-slate-300 text-slate-950"
                            />
                            <span>Patient follow-up required after triage.</span>
                          </label>
                        </div>
                        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px]">
                          <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                            <input
                              type="checkbox"
                              checked={incomingDataForm.createTask}
                              onChange={(event) =>
                                setIncomingDataForm((current) => ({
                                  ...current,
                                  createTask: event.target.checked,
                                }))
                              }
                              className="mt-0.5 size-4 rounded border-slate-300 text-slate-950"
                            />
                            <span>Create a linked task for the intake workflow.</span>
                          </label>
                          <Field label="Task priority">
                            <select
                              value={incomingDataForm.taskPriority}
                              onChange={(event) =>
                                setIncomingDataForm((current) => ({
                                  ...current,
                                  taskPriority: event.target.value,
                                }))
                              }
                              className={selectClassName}
                              disabled={!incomingDataForm.createTask}
                            >
                              {TASK_PRIORITY_OPTIONS.map((value) => (
                                <option key={value} value={value}>
                                  {taskPriorityLabel(value)}
                                </option>
                              ))}
                            </select>
                          </Field>
                        </div>
                        <div className="flex flex-wrap justify-end gap-3">
                          <Button
                            type="button"
                            variant="outline"
                            className="rounded-2xl"
                            disabled={!incomingDataForm.assigneeId}
                            onClick={openIncomingDataChatDraft}
                          >
                            Open internal chat draft
                          </Button>
                          <Button
                            type="submit"
                            className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
                            disabled={
                              incomingDataBusy ||
                              !incomingDataForm.assigneeId ||
                              !incomingDataForm.dueAt
                            }
                          >
                            {incomingDataBusy ? (
                              <LoaderCircle className="size-4 animate-spin" />
                            ) : null}
                            Start intake flow
                          </Button>
                        </div>
                      </form>
                    </div>
                  </section>
                ) : null}
                {!detail.is_blocked && permissions.canViewReminders && detail.order_id ? (
                  <section className={sectionCardClass("p-5")}>
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-950">
                          Package-end follow-up
                        </h3>
                        <p className="text-xs text-slate-500">
                          Schedule the required reminder one month before the linked package or
                          order window ends.
                        </p>
                      </div>
                      <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                        {packageEndReminders.length + packageEndTasks.length} package item
                        {packageEndReminders.length + packageEndTasks.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="mt-4 grid gap-4 xl:grid-cols-2">
                      <div className="space-y-3">
                        {packageEndReminders.length === 0 && packageEndTasks.length === 0 ? (
                          <EmptyState text="No package-end reminder has been scheduled yet." />
                        ) : (
                          <>
                            {packageEndReminders.map((item) => (
                              <div
                                key={item.id}
                                className="rounded-2xl border border-slate-200/80 bg-slate-50/80 px-4 py-3"
                              >
                                <p className="text-sm font-medium text-slate-900">
                                  {item.title.replace(`${PACKAGE_END_FOLLOW_UP_PREFIX} `, "")}
                                </p>
                                <p className="mt-1 text-xs text-slate-500">
                                  {item.user_name} · {formatDateTimeLabel(item.remind_at)}
                                </p>
                                {item.description ? (
                                  <p className="mt-3 whitespace-pre-line text-sm text-slate-600">
                                    {item.description}
                                  </p>
                                ) : null}
                              </div>
                            ))}
                            {packageEndTasks.map((task) => (
                              <div
                                key={task.id}
                                className="rounded-2xl border border-slate-200/80 bg-slate-50/80 px-4 py-3"
                              >
                                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                                  <p className="text-sm font-medium text-slate-900">
                                    {task.title.replace(`${PACKAGE_END_FOLLOW_UP_PREFIX} `, "")}
                                  </p>
                                  <span className="text-xs text-slate-500">
                                    {taskStatusLabel(task.status)} · {taskPriorityLabel(task.priority)}
                                  </span>
                                </div>
                                <p className="mt-1 text-xs text-slate-500">
                                  {task.assigned_to_name}
                                  {task.due_date ? ` · ${formatDateTimeLabel(task.due_date)}` : ""}
                                </p>
                                {task.description ? (
                                  <p className="mt-3 whitespace-pre-line text-sm text-slate-600">
                                    {task.description}
                                  </p>
                                ) : null}
                              </div>
                            ))}
                          </>
                        )}
                      </div>
                      {permissions.canManageReminders ? (
                        <form
                          onSubmit={handlePackageEndFollowUpSubmit}
                          className="space-y-4 rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4"
                        >
                          <Field label="Package end date">
                            <Input
                              type="date"
                              value={packageEndFollowUpForm.packageEndDate}
                              onChange={(event) =>
                                setPackageEndFollowUpForm((current) => ({
                                  ...current,
                                  packageEndDate: event.target.value,
                                }))
                              }
                              className="h-10 rounded-xl bg-white"
                              required
                            />
                          </Field>
                          <Field label="Reminder title">
                            <Input
                              value={packageEndFollowUpForm.title}
                              onChange={(event) =>
                                setPackageEndFollowUpForm((current) => ({
                                  ...current,
                                  title: event.target.value,
                                }))
                              }
                              className="h-10 rounded-xl bg-white"
                              required
                            />
                          </Field>
                          <Field label="Assignee">
                            <select
                              value={packageEndFollowUpForm.assigneeId}
                              onChange={(event) =>
                                setPackageEndFollowUpForm((current) => ({
                                  ...current,
                                  assigneeId: event.target.value,
                                }))
                              }
                              className={selectClassName}
                              required
                            >
                              <option value="">Select assignee</option>
                              {doctorFollowUpAssignees.map((member) => (
                                <option key={member.id} value={member.id}>
                                  {member.name} · {roleLabel(member.role)}
                                </option>
                              ))}
                            </select>
                          </Field>
                          {packageEndFollowUpForm.packageEndDate ? (
                            <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-700">
                              Reminder will be scheduled for{" "}
                              {formatDateTimeLabel(
                                toRfc3339(
                                  shiftLocalDateTime(
                                    `${packageEndFollowUpForm.packageEndDate}T09:00`,
                                    { months: -1 }
                                  )
                                )
                              )}
                              .
                            </div>
                          ) : null}
                          <Field label="Notes">
                            <textarea
                              value={packageEndFollowUpForm.notes}
                              onChange={(event) =>
                                setPackageEndFollowUpForm((current) => ({
                                  ...current,
                                  notes: event.target.value,
                                }))
                              }
                              className={textareaClassName}
                              rows={4}
                              placeholder="Package closure context, expected controls, payment or documentation dependencies."
                            />
                          </Field>
                          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px]">
                            <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                              <input
                                type="checkbox"
                                checked={packageEndFollowUpForm.createTask}
                                onChange={(event) =>
                                  setPackageEndFollowUpForm((current) => ({
                                    ...current,
                                    createTask: event.target.checked,
                                  }))
                                }
                                className="mt-0.5 size-4 rounded border-slate-300 text-slate-950"
                              />
                              <span>Create a linked task alongside the reminder.</span>
                            </label>
                            <Field label="Task priority">
                              <select
                                value={packageEndFollowUpForm.taskPriority}
                                onChange={(event) =>
                                  setPackageEndFollowUpForm((current) => ({
                                    ...current,
                                    taskPriority: event.target.value,
                                  }))
                                }
                                className={selectClassName}
                                disabled={!packageEndFollowUpForm.createTask}
                              >
                                {TASK_PRIORITY_OPTIONS.map((value) => (
                                  <option key={value} value={value}>
                                    {taskPriorityLabel(value)}
                                  </option>
                                ))}
                              </select>
                            </Field>
                          </div>
                          <div className="flex justify-end">
                            <Button
                              type="submit"
                              className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
                              disabled={
                                packageEndFollowUpBusy ||
                                !packageEndFollowUpForm.title.trim() ||
                                !packageEndFollowUpForm.assigneeId ||
                                !packageEndFollowUpForm.packageEndDate
                              }
                            >
                              {packageEndFollowUpBusy ? (
                                <LoaderCircle className="size-4 animate-spin" />
                              ) : null}
                              Schedule package reminder
                            </Button>
                          </div>
                        </form>
                      ) : null}
                    </div>
                  </section>
                ) : null}
                {!detail.is_blocked &&
                permissions.canViewReminders &&
                (detail.provider_id || detail.doctor_id) ? (
                  <section className={sectionCardClass("p-5")}>
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-950">
                          Clinic and doctor handoff trail
                        </h3>
                        <p className="text-xs text-slate-500">
                          Track outbound coordination with clinics or doctors as operational
                          reminders and internal assignments.
                        </p>
                      </div>
                      <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                        {externalHandoffReminders.length + externalHandoffTasks.length} handoff
                        item{externalHandoffReminders.length + externalHandoffTasks.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="mt-4 grid gap-4 xl:grid-cols-2">
                      <div className="space-y-3">
                        {externalHandoffReminders.length === 0 && externalHandoffTasks.length === 0 ? (
                          <EmptyState text="No clinic or doctor handoff actions logged yet." />
                        ) : (
                          <>
                            {externalHandoffReminders.map((item) => (
                              <div
                                key={item.id}
                                className="rounded-2xl border border-slate-200/80 bg-slate-50/80 px-4 py-3"
                              >
                                <p className="text-sm font-medium text-slate-900">
                                  {item.title.replace(`${EXTERNAL_HANDOFF_PREFIX} `, "")}
                                </p>
                                <p className="mt-1 text-xs text-slate-500">
                                  {item.user_name} · {formatDateTimeLabel(item.remind_at)}
                                </p>
                                {item.description ? (
                                  <p className="mt-3 whitespace-pre-line text-sm text-slate-600">
                                    {item.description}
                                  </p>
                                ) : null}
                              </div>
                            ))}
                            {externalHandoffTasks.map((task) => (
                              <div
                                key={task.id}
                                className="rounded-2xl border border-slate-200/80 bg-slate-50/80 px-4 py-3"
                              >
                                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                                  <p className="text-sm font-medium text-slate-900">
                                    {task.title.replace(`${EXTERNAL_HANDOFF_PREFIX} `, "")}
                                  </p>
                                  <span className="text-xs text-slate-500">
                                    {taskStatusLabel(task.status)} · {taskPriorityLabel(task.priority)}
                                  </span>
                                </div>
                                <p className="mt-1 text-xs text-slate-500">
                                  {task.assigned_to_name}
                                  {task.due_date ? ` · ${formatDateTimeLabel(task.due_date)}` : ""}
                                </p>
                                {task.description ? (
                                  <p className="mt-3 whitespace-pre-line text-sm text-slate-600">
                                    {task.description}
                                  </p>
                                ) : null}
                              </div>
                            ))}
                          </>
                        )}
                      </div>
                      {permissions.canManageReminders ? (
                        <form
                          onSubmit={handleExternalHandoffSubmit}
                          className="space-y-4 rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4"
                        >
                          <div className="grid gap-4 md:grid-cols-2">
                            <Field label="Target">
                              <select
                                value={externalHandoffForm.target}
                                onChange={(event) =>
                                  setExternalHandoffForm((current) => ({
                                    ...current,
                                    target: event.target.value as ExternalHandoffFormState["target"],
                                  }))
                                }
                                className={selectClassName}
                              >
                                <option value="clinic" disabled={!detail.provider_id}>
                                  Clinic
                                </option>
                                <option value="doctor" disabled={!detail.doctor_id}>
                                  Doctor
                                </option>
                              </select>
                            </Field>
                            <Field label="Assignee">
                              <select
                                value={externalHandoffForm.assigneeId}
                                onChange={(event) =>
                                  setExternalHandoffForm((current) => ({
                                    ...current,
                                    assigneeId: event.target.value,
                                  }))
                                }
                                className={selectClassName}
                                required
                              >
                                <option value="">Select assignee</option>
                                {doctorFollowUpAssignees.map((member) => (
                                  <option key={member.id} value={member.id}>
                                    {member.name} · {roleLabel(member.role)}
                                  </option>
                                ))}
                              </select>
                            </Field>
                          </div>
                          <Field label="Action title">
                            <Input
                              value={externalHandoffForm.title}
                              onChange={(event) =>
                                setExternalHandoffForm((current) => ({
                                  ...current,
                                  title: event.target.value,
                                }))
                              }
                              placeholder="Send physician summary, request Arztbrief, confirm next slot"
                              className="h-10 rounded-xl bg-white"
                              required
                            />
                          </Field>
                          <Field label="Due at">
                            <Input
                              type="datetime-local"
                              value={externalHandoffForm.dueAt}
                              onChange={(event) =>
                                setExternalHandoffForm((current) => ({
                                  ...current,
                                  dueAt: event.target.value,
                                }))
                              }
                              className="h-10 rounded-xl bg-white"
                              required
                            />
                          </Field>
                          <Field label="Briefing / message draft">
                            <textarea
                              value={externalHandoffForm.notes}
                              onChange={(event) =>
                                setExternalHandoffForm((current) => ({
                                  ...current,
                                  notes: event.target.value,
                                }))
                              }
                              className={textareaClassName}
                              rows={5}
                              placeholder="What has to be sent, requested or confirmed with the clinic or doctor."
                            />
                          </Field>
                          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px]">
                            <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                              <input
                                type="checkbox"
                                checked={externalHandoffForm.createTask}
                                onChange={(event) =>
                                  setExternalHandoffForm((current) => ({
                                    ...current,
                                    createTask: event.target.checked,
                                  }))
                                }
                                className="mt-0.5 size-4 rounded border-slate-300 text-slate-950"
                              />
                              <span>Create a linked task for the outbound handoff.</span>
                            </label>
                            <Field label="Task priority">
                              <select
                                value={externalHandoffForm.taskPriority}
                                onChange={(event) =>
                                  setExternalHandoffForm((current) => ({
                                    ...current,
                                    taskPriority: event.target.value,
                                  }))
                                }
                                className={selectClassName}
                                disabled={!externalHandoffForm.createTask}
                              >
                                {TASK_PRIORITY_OPTIONS.map((value) => (
                                  <option key={value} value={value}>
                                    {taskPriorityLabel(value)}
                                  </option>
                                ))}
                              </select>
                            </Field>
                          </div>
                          <div className="flex flex-wrap justify-end gap-3">
                            <Button
                              type="button"
                              variant="outline"
                              className="rounded-2xl"
                              disabled={!externalHandoffForm.assigneeId}
                              onClick={openExternalHandoffChatDraft}
                            >
                              Open internal chat draft
                            </Button>
                            <Button
                              type="submit"
                              className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
                              disabled={
                                externalHandoffBusy ||
                                !externalHandoffForm.title.trim() ||
                                !externalHandoffForm.assigneeId ||
                                !externalHandoffForm.dueAt
                              }
                            >
                              {externalHandoffBusy ? (
                                <LoaderCircle className="size-4 animate-spin" />
                              ) : null}
                              Log handoff action
                            </Button>
                          </div>
                        </form>
                      ) : null}
                    </div>
                  </section>
                ) : null}
                {!detail.is_blocked &&
                permissions.canManageChecklist &&
                permissions.canViewReminders &&
                (detail.provider_id || detail.doctor_id) ? (
                  <section className={sectionCardClass("p-5")}>
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-950">
                          Arztbrief and written findings
                        </h3>
                        <p className="text-xs text-slate-500">
                          Track missing findings, translation needs and patient dispatch from the
                          appointment itself.
                        </p>
                      </div>
                      <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                        {openFindingsChecklistCount === 0 && findingsChecklist.length > 0
                          ? "Follow-up ready"
                          : `${openFindingsChecklistCount} open`}
                      </span>
                    </div>
                    <div className="mt-4 grid gap-4 md:grid-cols-3">
                      <ContextCard
                        label="Checklist"
                        value={findingsChecklist.length === 0 ? "Not started" : `${findingsChecklist.length} item(s)`}
                        meta={
                          findingsChecklist.length === 0
                            ? "No document follow-up checklist yet."
                            : `${openFindingsChecklistCount} item(s) still open.`
                        }
                      />
                      <ContextCard
                        label="Reminders"
                        value={findingsReminders.length === 0 ? "0" : String(findingsReminders.length)}
                        meta="Timing control for missing findings and document handling."
                      />
                      <ContextCard
                        label="Tasks"
                        value={findingsTasks.length === 0 ? "0" : String(findingsTasks.length)}
                        meta="Operational ownership for requesting, translating or sending findings."
                      />
                    </div>
                    <div className="mt-4 grid gap-4 xl:grid-cols-2">
                      <div className="space-y-4">
                        <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                            Checklist trail
                          </p>
                          <div className="mt-3 space-y-3">
                            {findingsChecklist.length === 0 ? (
                              <EmptyState text="No Arztbrief or findings checklist exists yet." />
                            ) : (
                              findingsChecklist.map((item) => (
                                <div
                                  key={item.id}
                                  className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 md:flex-row md:items-center md:justify-between"
                                >
                                  <div>
                                    <p className="text-sm font-medium text-slate-900">
                                      {item.item_text.replace(`${FINDINGS_CHECKLIST_PREFIX} `, "")}
                                    </p>
                                    <p className="mt-1 text-xs uppercase tracking-[0.12em] text-slate-500">
                                      {item.phase}
                                    </p>
                                  </div>
                                  {item.is_completed ? (
                                    <span className="text-xs font-medium text-emerald-700">
                                      Completed {formatDateTimeLabel(item.completed_at)}
                                    </span>
                                  ) : (
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="rounded-2xl"
                                      disabled={Boolean(actionBusy)}
                                      onClick={() => handleChecklistComplete(item.id)}
                                    >
                                      {actionBusy === `check:${item.id}` ? (
                                        <LoaderCircle className="size-4 animate-spin" />
                                      ) : null}
                                      Complete
                                    </Button>
                                  )}
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                            Reminder and task trail
                          </p>
                          <div className="mt-3 space-y-3">
                            {findingsReminders.length === 0 && findingsTasks.length === 0 ? (
                              <EmptyState text="No findings reminders or tasks logged yet." />
                            ) : (
                              <>
                                {findingsReminders.map((item) => (
                                  <div
                                    key={item.id}
                                    className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
                                  >
                                    <p className="text-sm font-medium text-slate-900">
                                      {item.title.replace(`${FINDINGS_FOLLOW_UP_PREFIX} `, "")}
                                    </p>
                                    <p className="mt-1 text-xs text-slate-500">
                                      {item.user_name} · {formatDateTimeLabel(item.remind_at)}
                                    </p>
                                    {item.description ? (
                                      <p className="mt-3 whitespace-pre-line text-sm text-slate-600">
                                        {item.description}
                                      </p>
                                    ) : null}
                                  </div>
                                ))}
                                {findingsTasks.map((task) => (
                                  <div
                                    key={task.id}
                                    className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
                                  >
                                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                                      <p className="text-sm font-medium text-slate-900">
                                        {task.title.replace(`${FINDINGS_FOLLOW_UP_PREFIX} `, "")}
                                      </p>
                                      <span className="text-xs text-slate-500">
                                        {taskStatusLabel(task.status)} · {taskPriorityLabel(task.priority)}
                                      </span>
                                    </div>
                                    <p className="mt-1 text-xs text-slate-500">
                                      {task.assigned_to_name}
                                      {task.due_date ? ` · ${formatDateTimeLabel(task.due_date)}` : ""}
                                    </p>
                                    {task.description ? (
                                      <p className="mt-3 whitespace-pre-line text-sm text-slate-600">
                                        {task.description}
                                      </p>
                                    ) : null}
                                  </div>
                                ))}
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      {permissions.canManageReminders ? (
                        <form
                          onSubmit={handleFindingsFollowUpSubmit}
                          className="space-y-4 rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4"
                        >
                          <div className="grid gap-4 md:grid-cols-2">
                            <Field label="Expected artifact">
                              <select
                                value={findingsFollowUpForm.artifact}
                                onChange={(event) =>
                                  setFindingsFollowUpForm((current) => ({
                                    ...current,
                                    artifact: event.target.value as FindingsFollowUpArtifact,
                                  }))
                                }
                                className={selectClassName}
                              >
                                <option value="arztbrief">Arztbrief</option>
                                <option value="written_findings">Written findings</option>
                                <option value="both">Arztbrief + written findings</option>
                              </select>
                            </Field>
                            <Field label="Assignee">
                              <select
                                value={findingsFollowUpForm.assigneeId}
                                onChange={(event) =>
                                  setFindingsFollowUpForm((current) => ({
                                    ...current,
                                    assigneeId: event.target.value,
                                  }))
                                }
                                className={selectClassName}
                                required
                              >
                                <option value="">Select assignee</option>
                                {doctorFollowUpAssignees.map((member) => (
                                  <option key={member.id} value={member.id}>
                                    {member.name} · {roleLabel(member.role)}
                                  </option>
                                ))}
                              </select>
                            </Field>
                          </div>
                          <Field label="Follow-up deadline">
                            <Input
                              type="datetime-local"
                              value={findingsFollowUpForm.dueAt}
                              onChange={(event) =>
                                setFindingsFollowUpForm((current) => ({
                                  ...current,
                                  dueAt: event.target.value,
                                }))
                              }
                              className="h-10 rounded-xl bg-white"
                              required
                            />
                          </Field>
                          <Field label="Notes / expected content">
                            <textarea
                              value={findingsFollowUpForm.notes}
                              onChange={(event) =>
                                setFindingsFollowUpForm((current) => ({
                                  ...current,
                                  notes: event.target.value,
                                }))
                              }
                              className={textareaClassName}
                              rows={5}
                              placeholder="What is expected from the clinic or doctor, what has to be reviewed, and what should happen next."
                            />
                          </Field>
                          <div className="grid gap-3 md:grid-cols-2">
                            <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                              <input
                                type="checkbox"
                                checked={findingsFollowUpForm.translationRequired}
                                onChange={(event) =>
                                  setFindingsFollowUpForm((current) => ({
                                    ...current,
                                    translationRequired: event.target.checked,
                                  }))
                                }
                                className="mt-0.5 size-4 rounded border-slate-300 text-slate-950"
                              />
                              <span>Written translation required.</span>
                            </label>
                            <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                              <input
                                type="checkbox"
                                checked={findingsFollowUpForm.sendToPatient}
                                onChange={(event) =>
                                  setFindingsFollowUpForm((current) => ({
                                    ...current,
                                    sendToPatient: event.target.checked,
                                  }))
                                }
                                className="mt-0.5 size-4 rounded border-slate-300 text-slate-950"
                              />
                              <span>Patient dispatch required after processing.</span>
                            </label>
                          </div>
                          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px]">
                            <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                              <input
                                type="checkbox"
                                checked={findingsFollowUpForm.createTask}
                                onChange={(event) =>
                                  setFindingsFollowUpForm((current) => ({
                                    ...current,
                                    createTask: event.target.checked,
                                  }))
                                }
                                className="mt-0.5 size-4 rounded border-slate-300 text-slate-950"
                              />
                              <span>Create a linked task for the findings workflow.</span>
                            </label>
                            <Field label="Task priority">
                              <select
                                value={findingsFollowUpForm.taskPriority}
                                onChange={(event) =>
                                  setFindingsFollowUpForm((current) => ({
                                    ...current,
                                    taskPriority: event.target.value,
                                  }))
                                }
                                className={selectClassName}
                                disabled={!findingsFollowUpForm.createTask}
                              >
                                {TASK_PRIORITY_OPTIONS.map((value) => (
                                  <option key={value} value={value}>
                                    {taskPriorityLabel(value)}
                                  </option>
                                ))}
                              </select>
                            </Field>
                          </div>
                          <div className="flex flex-wrap justify-end gap-3">
                            <Button
                              type="button"
                              variant="outline"
                              className="rounded-2xl"
                              disabled={!findingsFollowUpForm.assigneeId}
                              onClick={openFindingsFollowUpChatDraft}
                            >
                              Open internal chat draft
                            </Button>
                            <Button
                              type="submit"
                              className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
                              disabled={
                                findingsFollowUpBusy ||
                                !findingsFollowUpForm.assigneeId ||
                                !findingsFollowUpForm.dueAt
                              }
                            >
                              {findingsFollowUpBusy ? (
                                <LoaderCircle className="size-4 animate-spin" />
                              ) : null}
                              Start findings follow-up
                            </Button>
                          </div>
                        </form>
                      ) : null}
                    </div>
                  </section>
                ) : null}
                {permissions.canManageStatus ? (
                  <section className={sectionCardClass("p-5")}>
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-950">
                          Completion readiness
                        </h3>
                        <p className="text-xs text-slate-500">
                          Review operational blockers before closing the appointment and launching
                          standard post-care follow-up.
                        </p>
                      </div>
                      <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                        {detail.status === "completed" ? "Completed" : statusLabel(detail.status)}
                      </span>
                    </div>
                    <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                      <ContextCard
                        label="Checklist"
                        value={openChecklistCount === 0 ? "Ready" : `${openChecklistCount} open`}
                        meta={openChecklistCount === 0 ? "No pending checklist items." : "Finish outstanding preparation or follow-up steps."}
                      />
                      <ContextCard
                        label="Tasks"
                        value={openTaskCount === 0 ? "Ready" : `${openTaskCount} open`}
                        meta={openTaskCount === 0 ? "No open operational tasks." : "Resolve active PM, interpreter or concierge tasks."}
                      />
                      <ContextCard
                        label="Reminders"
                        value={`${pendingReminderCount} pending`}
                        meta={pendingReminderCount === 0 ? "No outstanding reminders." : "Pending reminders stay active after closure."}
                      />
                      <ContextCard
                        label="Interpreter report"
                        value={
                          !detail.interpreter_id
                            ? "Not required"
                            : interpreterReportReady
                              ? "Approved"
                              : "Pending"
                        }
                        meta={
                          !detail.interpreter_id
                            ? "No interpreter linked."
                            : detailReport
                              ? detailReport.approval_status
                              : "No report submitted yet."
                        }
                      />
                    </div>
                    {completionWarnings.length > 0 ? (
                      <div className="mt-4">
                        <Banner tone="warning">
                          <div className="space-y-1">
                            {completionWarnings.map((warning) => (
                              <p key={warning}>{warning}</p>
                            ))}
                          </div>
                        </Banner>
                      </div>
                    ) : null}
                    {detail.status !== "completed" && detail.status !== "cancelled" ? (
                      <div className="mt-5 space-y-4">
                        <Field label="Follow-up assignee">
                          <select
                            value={followUpAssigneeId}
                            onChange={(event) => setFollowUpAssigneeId(event.target.value)}
                            className={selectClassName}
                          >
                            <option value="">Select assignee</option>
                            {handoffStakeholders.map((peer) => (
                              <option key={peer.id} value={peer.id}>
                                {peer.name} · {roleLabel(peer.role)}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <div className="flex flex-wrap gap-2">
                          {FOLLOW_UP_PRESETS.map((preset) => (
                            <Button
                              key={preset.id}
                              type="button"
                              variant={completionPlan[preset.id] ? "default" : "outline"}
                              size="sm"
                              className={cn(
                                "rounded-2xl",
                                completionPlan[preset.id]
                                  ? "bg-slate-950 text-white hover:bg-slate-800"
                                  : ""
                              )}
                              onClick={() =>
                                setCompletionPlan((current) => ({
                                  ...current,
                                  [preset.id]: !current[preset.id],
                                }))
                              }
                            >
                              {preset.label}
                            </Button>
                          ))}
                        </div>
                        <div className="flex flex-wrap justify-end gap-3">
                          <Button
                            type="button"
                            variant="outline"
                            className="rounded-2xl"
                            disabled={completionBusy || Boolean(actionBusy)}
                            onClick={() => handleStatusChange("completed")}
                          >
                            Complete only
                          </Button>
                          <Button
                            type="button"
                            className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
                            disabled={
                              completionBusy ||
                              Boolean(actionBusy) ||
                              (selectedCompletionPresetCount > 0 && !followUpAssigneeId)
                            }
                            onClick={handleCompleteWithFollowUp}
                          >
                            {completionBusy ? (
                              <LoaderCircle className="size-4 animate-spin" />
                            ) : null}
                            Complete and schedule
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </section>
                ) : null}
                {permissions.canManageStatus ? <section className={sectionCardClass("p-5")}><h3 className="text-sm font-semibold text-slate-950">Status flow</h3><div className="mt-4 flex flex-wrap gap-2">{STATUS_OPTIONS.map((status) => <Button key={status} variant={detail.status === status ? "default" : "outline"} className={cn("rounded-2xl", detail.status === status ? "bg-slate-950 text-white hover:bg-slate-800" : "")} disabled={Boolean(actionBusy)} onClick={() => handleStatusChange(status)}>{actionBusy === `status:${status}` ? <LoaderCircle className="size-4 animate-spin" /> : null}{statusLabel(status)}</Button>)}</div></section> : null}
                {permissions.canEditSchedule && editForm ? <section className={sectionCardClass("p-5")}><h3 className="text-sm font-semibold text-slate-950">Reschedule and reassign</h3>{editError ? <div className="mt-4"><Banner tone="error">{editError}</Banner></div> : null}<form onSubmit={handleEditSubmit} className="mt-4 space-y-4"><Field label="Title"><Input value={editForm.title} onChange={(event) => setEditForm((current) => current ? { ...current, title: event.target.value } : current)} className="h-10 rounded-xl bg-slate-50" /></Field><div className="grid gap-4 md:grid-cols-3"><Field label="Date"><Input type="date" value={editForm.date} onChange={(event) => setEditForm((current) => current ? { ...current, date: event.target.value } : current)} className="h-10 rounded-xl bg-slate-50" /></Field><Field label="Start time"><Input type="time" value={editForm.timeStart} onChange={(event) => setEditForm((current) => current ? { ...current, timeStart: event.target.value } : current)} className="h-10 rounded-xl bg-slate-50" /></Field><Field label="End time"><Input type="time" value={editForm.timeEnd} onChange={(event) => setEditForm((current) => current ? { ...current, timeEnd: event.target.value } : current)} className="h-10 rounded-xl bg-slate-50" /></Field></div><div className="grid gap-4 md:grid-cols-2"><Field label="Clinic"><select value={editForm.providerId} onChange={(event) => setEditForm((current) => current ? { ...current, providerId: event.target.value, doctorId: "" } : current)} className={selectClassName} disabled={detail.type === "internal"}><option value="">No clinic</option>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></Field><Field label="Doctor"><select value={editForm.doctorId} onChange={(event) => setEditForm((current) => current ? { ...current, doctorId: event.target.value } : current)} className={selectClassName} disabled={!editForm.providerId}><option value="">No doctor</option>{editDoctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctorLabel(doctor)}</option>)}</select></Field></div><div className="grid gap-4 md:grid-cols-2"><Field label="Owner"><select value={editForm.ownerUserId} onChange={(event) => setEditForm((current) => current ? { ...current, ownerUserId: event.target.value } : current)} className={selectClassName}><option value="">Auto / current role</option>{staff.map((member) => <option key={member.id} value={member.id}>{member.name} · {roleLabel(member.role)}</option>)}</select></Field><Field label="Interpreter"><select value={editForm.interpreterId} onChange={(event) => setEditForm((current) => current ? { ...current, interpreterId: event.target.value } : current)} className={selectClassName}><option value="">No interpreter</option>{interpreters.map((member) => <option key={member.id} value={member.id}>{member.name} · {roleLabel(member.role)}</option>)}</select></Field></div><Field label="Location"><Input value={editForm.location} onChange={(event) => setEditForm((current) => current ? { ...current, location: event.target.value } : current)} className="h-10 rounded-xl bg-slate-50" /></Field><ConflictPanel conflicts={editConflicts} /><ScheduleWarningsPanel warnings={editLocalWarnings} /><div className="flex justify-end"><Button type="submit" className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800" disabled={editBusy}>{editBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}{editBusy ? "Saving" : "Save schedule"}</Button></div></form></section> : null}
                {permissions.canAssignInterpreter && !detail.is_blocked ? <section className={sectionCardClass("p-5")}><h3 className="text-sm font-semibold text-slate-950">Interpreter assignment</h3><form onSubmit={handleAssignInterpreter} className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]"><Field label="Interpreter"><select value={editForm?.interpreterId ?? ""} onChange={(event) => setEditForm((current) => current ? { ...current, interpreterId: event.target.value } : current)} className={selectClassName}><option value="">No interpreter</option>{interpreters.map((member) => <option key={member.id} value={member.id}>{member.name} · {roleLabel(member.role)}</option>)}</select></Field><div className="flex items-end"><Button type="submit" className="rounded-2xl" disabled={!editForm?.interpreterId || actionBusy === "assign"}>{actionBusy === "assign" ? <LoaderCircle className="size-4 animate-spin" /> : null}Assign</Button></div></form></section> : null}
                {permissions.canRespondToAssignment && detail.interpreter_id === user?.id ? <section className={sectionCardClass("p-5")}><h3 className="text-sm font-semibold text-slate-950">Interpreter response</h3><div className="mt-4 flex flex-wrap gap-2">{INTERPRETER_RESPONSE_OPTIONS.map((value) => <Button key={value} variant={detail.interpreter_response === value ? "default" : "outline"} className="rounded-2xl" disabled={Boolean(actionBusy)} onClick={() => handleInterpreterResponse(value)}>{actionBusy === `response:${value}` ? <LoaderCircle className="size-4 animate-spin" /> : null}{responseLabel(value)}</Button>)}</div></section> : null}
                {permissions.canManageChecklist ? <section className={sectionCardClass("p-5")}><h3 className="text-sm font-semibold text-slate-950">Checklist</h3><div className="mt-4 space-y-3">{detailChecklist.length === 0 ? <EmptyState text="No checklist items yet." /> : detailChecklist.map((item) => <div key={item.id} className="flex flex-col gap-3 rounded-2xl border border-slate-200/80 bg-slate-50/80 px-4 py-3 md:flex-row md:items-center md:justify-between"><div><p className="text-sm font-medium text-slate-900">{item.item_text}</p><p className="mt-1 text-xs uppercase tracking-[0.12em] text-slate-500">{item.phase}</p></div>{item.is_completed ? <span className="text-xs font-medium text-emerald-700">Completed {formatDateTimeLabel(item.completed_at)}</span> : <Button variant="outline" size="sm" className="rounded-2xl" disabled={Boolean(actionBusy)} onClick={() => handleChecklistComplete(item.id)}>{actionBusy === `check:${item.id}` ? <LoaderCircle className="size-4 animate-spin" /> : null}Complete</Button>}</div>)}</div><form onSubmit={handleChecklistSubmit} className="mt-5 grid gap-4 md:grid-cols-[180px_minmax(0,1fr)_auto]"><Field label="Phase"><select value={checklistForm.phase} onChange={(event) => setChecklistForm((current) => ({ ...current, phase: event.target.value }))} className={selectClassName}>{CHECKLIST_PHASES.map((phase) => <option key={phase} value={phase}>{phase}</option>)}</select></Field><Field label="Checklist item"><Input value={checklistForm.itemText} onChange={(event) => setChecklistForm((current) => ({ ...current, itemText: event.target.value }))} placeholder="Confirm patient arrival, print referral, call driver" className="h-10 rounded-xl bg-slate-50" required /></Field><div className="flex items-end"><Button type="submit" className="rounded-2xl" disabled={checklistBusy || !checklistForm.itemText.trim()}>{checklistBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}Add item</Button></div></form></section> : null}
                {permissions.canViewReminders ? <section className={sectionCardClass("p-5")}><h3 className="text-sm font-semibold text-slate-950">Reminders</h3><div className="mt-4 space-y-3">{detailReminders.length === 0 ? <EmptyState text="No reminders linked to this appointment." /> : detailReminders.map((item) => <div key={item.id} className="flex flex-col gap-3 rounded-2xl border border-slate-200/80 bg-slate-50/80 px-4 py-3 md:flex-row md:items-center md:justify-between"><div><p className="text-sm font-medium text-slate-900">{item.title}</p><p className="mt-1 text-xs text-slate-500">{item.user_name} · {formatDateTimeLabel(item.remind_at)}</p>{item.description ? <p className="mt-2 text-sm text-slate-600">{item.description}</p> : null}</div>{item.is_completed ? <span className="text-xs font-medium text-emerald-700">Completed {formatDateTimeLabel(item.completed_at)}</span> : <Button variant="outline" size="sm" className="rounded-2xl" disabled={Boolean(actionBusy)} onClick={() => handleReminderComplete(item.id)}>{actionBusy === `reminder:${item.id}` ? <LoaderCircle className="size-4 animate-spin" /> : null}Complete</Button>}</div>)}</div>{permissions.canManageReminders ? <form onSubmit={handleReminderSubmit} className="mt-5 grid gap-4 md:grid-cols-2"><Field label="Assignee"><select value={reminderForm.userId} onChange={(event) => setReminderForm((current) => ({ ...current, userId: event.target.value }))} className={selectClassName} required><option value="">Select user</option>{staff.map((member) => <option key={member.id} value={member.id}>{member.name} · {roleLabel(member.role)}</option>)}</select></Field><Field label="Remind at"><Input type="datetime-local" value={reminderForm.remindAt} onChange={(event) => setReminderForm((current) => ({ ...current, remindAt: event.target.value }))} className="h-10 rounded-xl bg-slate-50" required /></Field><Field label="Title"><Input value={reminderForm.title} onChange={(event) => setReminderForm((current) => ({ ...current, title: event.target.value }))} className="h-10 rounded-xl bg-slate-50" required /></Field><Field label="Description"><textarea value={reminderForm.description} onChange={(event) => setReminderForm((current) => ({ ...current, description: event.target.value }))} className={textareaClassName} rows={3} /></Field><div className="md:col-span-2 flex justify-end"><Button type="submit" className="rounded-2xl" disabled={reminderBusy || !reminderForm.userId || !reminderForm.remindAt || !reminderForm.title.trim()}>{reminderBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}Add reminder</Button></div></form> : null}</section> : null}
                {permissions.canViewReport ? (
                  <section className={sectionCardClass("p-5")}>
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-950">
                          Interpreter report
                        </h3>
                        <p className="text-xs text-slate-500">
                          Hours, free-text report and teamlead approval trail.
                        </p>
                      </div>
                      {detailReport ? (
                        <span
                          className={cn(
                            "rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]",
                            reportApprovalBadgeClass(detailReport.approval_status)
                          )}
                        >
                          {reportApprovalLabel(detailReport.approval_status)}
                        </span>
                      ) : null}
                    </div>

                    {detailReport ? (
                      <div className="mt-4 space-y-4">
                        <div className="grid gap-3 xl:grid-cols-3">
                          <ContextCard
                            label="Interpreter"
                            value={detailReport.interpreter_name}
                            meta={`Submitted ${formatDateTimeLabel(detailReport.created_at)}`}
                          />
                          <ContextCard
                            label="Hours"
                            value={`${detailReport.hours} h`}
                            meta={
                              detailReport.approval_status === "approved"
                                ? "Approved for payroll handoff"
                                : detailReport.approval_status === "rejected"
                                  ? "Needs interpreter revision"
                                  : "Waiting for teamlead review"
                            }
                          />
                          <ContextCard
                            label="Review"
                            value={
                              detailReport.approved_by_name ??
                              (detailReport.approval_status === "pending"
                                ? "Pending"
                                : "No reviewer recorded")
                            }
                            meta={reportReviewMeta}
                          />
                        </div>

                        {detailReport.notes ? (
                          <Banner
                            tone={
                              detailReport.approval_status === "rejected"
                                ? "error"
                                : "warning"
                            }
                          >
                            <span className="font-medium">Reviewer notes:</span>{" "}
                            {detailReport.notes}
                          </Banner>
                        ) : null}

                        <div className="rounded-2xl border border-slate-200/80 bg-white px-4 py-3">
                          {detailReport.report_text ? (
                            <p className="text-sm leading-6 text-slate-700">
                              {detailReport.report_text}
                            </p>
                          ) : (
                            <p className="text-sm text-slate-500">
                              No free-text report submitted.
                            </p>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="mt-4">
                        <EmptyState text="No interpreter report has been submitted yet." />
                      </div>
                    )}

                    {canSubmitInterpreterReport ? (
                      <form
                        onSubmit={handleReportSubmit}
                        className="mt-5 grid gap-4 md:grid-cols-[180px_minmax(0,1fr)]"
                      >
                        {canResubmitRejectedReport ? (
                          <div className="md:col-span-2">
                            <Banner tone="warning">
                              The latest report was returned. Update the hours or report text and
                              resubmit it for teamlead approval.
                            </Banner>
                          </div>
                        ) : null}
                        <Field label="Hours">
                          <Input
                            type="number"
                            min="0"
                            step="0.25"
                            value={reportForm.hours}
                            onChange={(event) =>
                              setReportForm((current) => ({
                                ...current,
                                hours: event.target.value,
                              }))
                            }
                            className="h-10 rounded-xl bg-slate-50"
                            required
                          />
                        </Field>
                        <Field label="Report text">
                          <textarea
                            value={reportForm.reportText}
                            onChange={(event) =>
                              setReportForm((current) => ({
                                ...current,
                                reportText: event.target.value,
                              }))
                            }
                            className={textareaClassName}
                            rows={4}
                            placeholder="Travel context, interpretation scope, issues, follow-up."
                          />
                        </Field>
                        <div className="md:col-span-2 flex justify-end">
                          <Button
                            type="submit"
                            className="rounded-2xl"
                            disabled={actionBusy === "report-submit" || !reportForm.hours}
                          >
                            {actionBusy === "report-submit" ? (
                              <LoaderCircle className="size-4 animate-spin" />
                            ) : null}
                            {canResubmitRejectedReport ? "Resubmit report" : "Submit report"}
                          </Button>
                        </div>
                      </form>
                    ) : null}

                    {showReportReviewActions ? (
                      <div className="mt-5 grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
                        <Field label="Teamlead review notes">
                          <textarea
                            value={reportRejectReason}
                            onChange={(event) => setReportRejectReason(event.target.value)}
                            className={textareaClassName}
                            rows={3}
                            placeholder="Optional reason if the report needs revision."
                          />
                        </Field>
                        <div className="flex items-end gap-3">
                          {permissions.canRejectReport ? (
                            <Button
                              variant="outline"
                              className="rounded-2xl border-rose-200 text-rose-700 hover:bg-rose-50"
                              disabled={actionBusy === "report-reject"}
                              onClick={handleRejectReport}
                            >
                              {actionBusy === "report-reject" ? (
                                <LoaderCircle className="size-4 animate-spin" />
                              ) : null}
                              Return for revision
                            </Button>
                          ) : null}
                          {permissions.canApproveReport ? (
                            <Button
                              className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
                              disabled={actionBusy === "report-approve"}
                              onClick={handleApproveReport}
                            >
                              {actionBusy === "report-approve" ? (
                                <LoaderCircle className="size-4 animate-spin" />
                              ) : null}
                              Approve hours and report
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </section>
                ) : null}
                {permissions.canViewTasks ? (
                  <section className={sectionCardClass("p-5")}>
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-950">
                          Operational tasks
                        </h3>
                        <p className="text-xs text-slate-500">
                          Appointment-linked follow-up for PM, teamlead, interpreter and
                          concierge.
                        </p>
                      </div>
                      <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                        {detailTasks.length} linked
                      </span>
                    </div>
                    <div className="mt-4 space-y-3">
                      {detailTasks.length === 0 ? (
                        <EmptyState text="No tasks linked to this appointment yet." />
                      ) : (
                        detailTasks.map((task) => (
                          <div
                            key={task.id}
                            className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4"
                          >
                            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="text-sm font-semibold text-slate-950">
                                    {task.title}
                                  </p>
                                  <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                                    {taskStatusLabel(task.status)}
                                  </span>
                                  <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                                    {taskPriorityLabel(task.priority)}
                                  </span>
                                </div>
                                <p className="mt-1 text-xs text-slate-500">
                                  {task.assigned_to_name} · {roleLabel(task.assigned_to_role)}
                                  {task.due_date
                                    ? ` · Due ${formatDateTimeLabel(task.due_date)}`
                                    : ""}
                                </p>
                                {task.description ? (
                                  <p className="mt-3 text-sm leading-6 text-slate-600">
                                    {task.description}
                                  </p>
                                ) : null}
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {TASK_STATUS_OPTIONS.map((status) => (
                                  <Button
                                    key={status}
                                    type="button"
                                    variant={task.status === status ? "default" : "outline"}
                                    size="sm"
                                    className={cn(
                                      "rounded-2xl",
                                      task.status === status
                                        ? "bg-slate-950 text-white hover:bg-slate-800"
                                        : ""
                                    )}
                                    disabled={
                                      Boolean(actionBusy) || task.status === status
                                    }
                                    onClick={() => handleTaskStatus(task.id, status)}
                                  >
                                    {actionBusy === `task:${task.id}:${status}` ? (
                                      <LoaderCircle className="size-4 animate-spin" />
                                    ) : null}
                                    {taskStatusLabel(status)}
                                  </Button>
                                ))}
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                    {permissions.canCreateTasks ? (
                      <form
                        onSubmit={handleTaskSubmit}
                        className="mt-5 grid gap-4 md:grid-cols-2"
                      >
                        <Field label="Task title">
                          <Input
                            value={taskForm.title}
                            onChange={(event) =>
                              setTaskForm((current) => ({
                                ...current,
                                title: event.target.value,
                              }))
                            }
                            placeholder="Confirm clinic slot, call interpreter, arrange driver"
                            className="h-10 rounded-xl bg-slate-50"
                            required
                          />
                        </Field>
                        <Field label="Assign to">
                          <select
                            value={taskForm.assignedTo}
                            onChange={(event) =>
                              setTaskForm((current) => ({
                                ...current,
                                assignedTo: event.target.value,
                              }))
                            }
                            className={selectClassName}
                            required
                          >
                            <option value="">Select assignee</option>
                            {taskAssignableStaff.map((member) => (
                              <option key={member.id} value={member.id}>
                                {member.name} · {roleLabel(member.role)}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Due at">
                          <Input
                            type="datetime-local"
                            value={taskForm.dueDate}
                            onChange={(event) =>
                              setTaskForm((current) => ({
                                ...current,
                                dueDate: event.target.value,
                              }))
                            }
                            className="h-10 rounded-xl bg-slate-50"
                          />
                        </Field>
                        <Field label="Priority">
                          <select
                            value={taskForm.priority}
                            onChange={(event) =>
                              setTaskForm((current) => ({
                                ...current,
                                priority: event.target.value,
                              }))
                            }
                            className={selectClassName}
                          >
                            {TASK_PRIORITY_OPTIONS.map((priority) => (
                              <option key={priority} value={priority}>
                                {taskPriorityLabel(priority)}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Description">
                          <textarea
                            value={taskForm.description}
                            onChange={(event) =>
                              setTaskForm((current) => ({
                                ...current,
                                description: event.target.value,
                              }))
                            }
                            className={textareaClassName}
                            rows={3}
                            placeholder="Add operational context, SLA or handoff note."
                          />
                        </Field>
                        <div className="flex items-end justify-end md:col-span-2">
                          <Button
                            type="submit"
                            className="rounded-2xl"
                            disabled={
                              taskBusy || !taskForm.title.trim() || !taskForm.assignedTo
                            }
                          >
                            {taskBusy ? (
                              <LoaderCircle className="size-4 animate-spin" />
                            ) : null}
                            Add task
                          </Button>
                        </div>
                      </form>
                    ) : null}
                  </section>
                ) : null}
                {canShowConciergeSection ? (
                  <section className={sectionCardClass("p-5")}>
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-950">
                          Concierge and VIP services
                        </h3>
                        <p className="text-xs text-slate-500">
                          Travel, transfer and VIP execution linked to this appointment.
                        </p>
                      </div>
                      <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                        {detailServices.length} service{detailServices.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="mt-4 space-y-4">
                      {detailServices.length === 0 ? (
                        <EmptyState text="No concierge or VIP services linked yet." />
                      ) : (
                        detailServices.map((service) => {
                          const draft =
                            serviceDrafts[service.id] ?? buildServiceDraft(service);
                          return (
                            <div
                              key={service.id}
                              className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4"
                            >
                              <div className="flex flex-col gap-4">
                                <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <p className="text-sm font-semibold text-slate-950">
                                        {service.title}
                                      </p>
                                      <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                                        {serviceKindLabel(service.service_kind)}
                                      </span>
                                      <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                                        {taskStatusLabel(service.status)}
                                      </span>
                                      <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                                        {billingStatusLabel(service.billing_status)}
                                      </span>
                                    </div>
                                    <p className="mt-1 text-xs text-slate-500">
                                      {service.assigned_concierge_name || "No concierge assigned"}
                                      {service.provider_name
                                        ? ` · ${service.provider_name}`
                                        : ""}
                                      {service.starts_at
                                        ? ` · ${formatDateTimeLabel(service.starts_at)}`
                                        : ""}
                                    </p>
                                  </div>
                                  <div className="text-xs text-slate-500 xl:text-right">
                                    <div>
                                      Estimate{" "}
                                      {formatMoneyLabel(
                                        service.cost_estimate,
                                        draft.currency || service.currency
                                      )}
                                    </div>
                                    <div>
                                      Actual{" "}
                                      {formatMoneyLabel(
                                        draft.actualCost || service.actual_cost,
                                        draft.currency || service.currency
                                      )}
                                    </div>
                                  </div>
                                </div>
                                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                                  {permissions.canManageConciergeBilling ? (
                                    <>
                                      <Field label="Title">
                                        <Input
                                          value={draft.title}
                                          onChange={(event) =>
                                            updateServiceDraft(service.id, {
                                              title: event.target.value,
                                            })
                                          }
                                          className="h-10 rounded-xl bg-white"
                                        />
                                      </Field>
                                      <Field label="Provider">
                                        <select
                                          value={draft.providerId}
                                          onChange={(event) =>
                                            updateServiceDraft(service.id, {
                                              providerId: event.target.value,
                                            })
                                          }
                                          className={selectClassName}
                                        >
                                          <option value="">No provider</option>
                                          {nonMedicalProviders.map((provider) => (
                                            <option key={provider.id} value={provider.id}>
                                              {provider.name}
                                            </option>
                                          ))}
                                        </select>
                                      </Field>
                                      <Field label="Assigned concierge">
                                        <select
                                          value={draft.assignedConciergeId}
                                          onChange={(event) =>
                                            updateServiceDraft(service.id, {
                                              assignedConciergeId: event.target.value,
                                            })
                                          }
                                          className={selectClassName}
                                        >
                                          <option value="">No concierge</option>
                                          {conciergeStaff.map((member) => (
                                            <option key={member.id} value={member.id}>
                                              {member.name}
                                            </option>
                                          ))}
                                        </select>
                                      </Field>
                                    </>
                                  ) : null}
                                  <Field label="Operational status">
                                    <select
                                      value={draft.status}
                                      onChange={(event) =>
                                        updateServiceDraft(service.id, {
                                          status: event.target.value,
                                        })
                                      }
                                      className={selectClassName}
                                    >
                                      {CONCIERGE_SERVICE_STATUS_OPTIONS.map((status) => (
                                        <option key={status} value={status}>
                                          {taskStatusLabel(status)}
                                        </option>
                                      ))}
                                    </select>
                                  </Field>
                                  <Field label="Booking reference">
                                    <Input
                                      value={draft.bookingReference}
                                      onChange={(event) =>
                                        updateServiceDraft(service.id, {
                                          bookingReference: event.target.value,
                                        })
                                      }
                                      className="h-10 rounded-xl bg-white"
                                    />
                                  </Field>
                                  <Field label="Actual cost">
                                    <Input
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      value={draft.actualCost}
                                      onChange={(event) =>
                                        updateServiceDraft(service.id, {
                                          actualCost: event.target.value,
                                        })
                                      }
                                      className="h-10 rounded-xl bg-white"
                                    />
                                  </Field>
                                  <Field label="Vendor">
                                    <Input
                                      value={draft.vendorName}
                                      onChange={(event) =>
                                        updateServiceDraft(service.id, {
                                          vendorName: event.target.value,
                                        })
                                      }
                                      className="h-10 rounded-xl bg-white"
                                    />
                                  </Field>
                                  <Field label="Vendor contact">
                                    <Input
                                      value={draft.vendorContact}
                                      onChange={(event) =>
                                        updateServiceDraft(service.id, {
                                          vendorContact: event.target.value,
                                        })
                                      }
                                      className="h-10 rounded-xl bg-white"
                                    />
                                  </Field>
                                  <Field label="Starts at">
                                    <Input
                                      type="datetime-local"
                                      value={draft.startsAt}
                                      onChange={(event) =>
                                        updateServiceDraft(service.id, {
                                          startsAt: event.target.value,
                                        })
                                      }
                                      className="h-10 rounded-xl bg-white"
                                    />
                                  </Field>
                                  <Field label="Ends at">
                                    <Input
                                      type="datetime-local"
                                      value={draft.endsAt}
                                      onChange={(event) =>
                                        updateServiceDraft(service.id, {
                                          endsAt: event.target.value,
                                        })
                                      }
                                      className="h-10 rounded-xl bg-white"
                                    />
                                  </Field>
                                  {permissions.canManageConciergeBilling ? (
                                    <>
                                      <Field label="Billing status">
                                        <select
                                          value={draft.billingStatus}
                                          onChange={(event) =>
                                            updateServiceDraft(service.id, {
                                              billingStatus: event.target.value,
                                            })
                                          }
                                          className={selectClassName}
                                        >
                                          {CONCIERGE_BILLING_STATUS_OPTIONS.map((status) => (
                                            <option key={status} value={status}>
                                              {billingStatusLabel(status)}
                                            </option>
                                          ))}
                                        </select>
                                      </Field>
                                      <Field label="Currency">
                                        <Input
                                          value={draft.currency}
                                          onChange={(event) =>
                                            updateServiceDraft(service.id, {
                                              currency: event.target.value,
                                            })
                                          }
                                          className="h-10 rounded-xl bg-white"
                                          maxLength={3}
                                        />
                                      </Field>
                                    </>
                                  ) : null}
                                </div>
                                <div className="grid gap-4 md:grid-cols-2">
                                  <Field label="Service notes">
                                    <textarea
                                      value={draft.serviceNotes}
                                      onChange={(event) =>
                                        updateServiceDraft(service.id, {
                                          serviceNotes: event.target.value,
                                        })
                                      }
                                      className={textareaClassName}
                                      rows={3}
                                    />
                                  </Field>
                                  {permissions.canManageConciergeBilling ? (
                                    <Field label="Billing notes">
                                      <textarea
                                        value={draft.billingNotes}
                                        onChange={(event) =>
                                          updateServiceDraft(service.id, {
                                            billingNotes: event.target.value,
                                          })
                                        }
                                        className={textareaClassName}
                                        rows={3}
                                      />
                                    </Field>
                                  ) : null}
                                </div>
                                <div className="flex justify-end">
                                  <Button
                                    type="button"
                                    className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
                                    disabled={actionBusy === `service:${service.id}`}
                                    onClick={() => handleServiceSave(service.id)}
                                  >
                                    {actionBusy === `service:${service.id}` ? (
                                      <LoaderCircle className="size-4 animate-spin" />
                                    ) : null}
                                    Save service
                                  </Button>
                                </div>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                    {permissions.canManageConciergeServices ? (
                      <form
                        onSubmit={handleServiceSubmit}
                        className="mt-5 grid gap-4 md:grid-cols-2"
                      >
                        <Field label="Service kind">
                          <select
                            value={serviceForm.serviceKind}
                            onChange={(event) =>
                              setServiceForm((current) => ({
                                ...current,
                                serviceKind: event.target.value,
                              }))
                            }
                            className={selectClassName}
                          >
                            {CONCIERGE_SERVICE_KIND_OPTIONS.map((kind) => (
                              <option key={kind} value={kind}>
                                {serviceKindLabel(kind)}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Service title">
                          <Input
                            value={serviceForm.title}
                            onChange={(event) =>
                              setServiceForm((current) => ({
                                ...current,
                                title: event.target.value,
                              }))
                            }
                            className="h-10 rounded-xl bg-slate-50"
                            required
                          />
                        </Field>
                        <Field label="Provider">
                          <select
                            value={serviceForm.providerId}
                            onChange={(event) =>
                              setServiceForm((current) => ({
                                ...current,
                                providerId: event.target.value,
                              }))
                            }
                            className={selectClassName}
                          >
                            <option value="">No provider</option>
                            {nonMedicalProviders.map((provider) => (
                              <option key={provider.id} value={provider.id}>
                                {provider.name}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Assigned concierge">
                          <select
                            value={serviceForm.assignedConciergeId}
                            onChange={(event) =>
                              setServiceForm((current) => ({
                                ...current,
                                assignedConciergeId: event.target.value,
                              }))
                            }
                            className={selectClassName}
                          >
                            <option value="">No concierge</option>
                            {conciergeStaff.map((member) => (
                              <option key={member.id} value={member.id}>
                                {member.name}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Starts at">
                          <Input
                            type="datetime-local"
                            value={serviceForm.startsAt}
                            onChange={(event) =>
                              setServiceForm((current) => ({
                                ...current,
                                startsAt: event.target.value,
                              }))
                            }
                            className="h-10 rounded-xl bg-slate-50"
                          />
                        </Field>
                        <Field label="Ends at">
                          <Input
                            type="datetime-local"
                            value={serviceForm.endsAt}
                            onChange={(event) =>
                              setServiceForm((current) => ({
                                ...current,
                                endsAt: event.target.value,
                              }))
                            }
                            className="h-10 rounded-xl bg-slate-50"
                          />
                        </Field>
                        <Field label="Vendor">
                          <Input
                            value={serviceForm.vendorName}
                            onChange={(event) =>
                              setServiceForm((current) => ({
                                ...current,
                                vendorName: event.target.value,
                              }))
                            }
                            className="h-10 rounded-xl bg-slate-50"
                          />
                        </Field>
                        <Field label="Vendor contact">
                          <Input
                            value={serviceForm.vendorContact}
                            onChange={(event) =>
                              setServiceForm((current) => ({
                                ...current,
                                vendorContact: event.target.value,
                              }))
                            }
                            className="h-10 rounded-xl bg-slate-50"
                          />
                        </Field>
                        <Field label="Cost estimate">
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={serviceForm.costEstimate}
                            onChange={(event) =>
                              setServiceForm((current) => ({
                                ...current,
                                costEstimate: event.target.value,
                              }))
                            }
                            className="h-10 rounded-xl bg-slate-50"
                          />
                        </Field>
                        <Field label="Currency">
                          <Input
                            value={serviceForm.currency}
                            onChange={(event) =>
                              setServiceForm((current) => ({
                                ...current,
                                currency: event.target.value,
                              }))
                            }
                            className="h-10 rounded-xl bg-slate-50"
                            maxLength={3}
                          />
                        </Field>
                        <Field label="Service notes">
                          <textarea
                            value={serviceForm.serviceNotes}
                            onChange={(event) =>
                              setServiceForm((current) => ({
                                ...current,
                                serviceNotes: event.target.value,
                              }))
                            }
                            className={textareaClassName}
                            rows={3}
                          />
                        </Field>
                        <div className="flex items-end justify-end md:col-span-2">
                          <Button
                            type="submit"
                            className="rounded-2xl"
                            disabled={serviceBusy || !serviceForm.title.trim()}
                          >
                            {serviceBusy ? (
                              <LoaderCircle className="size-4 animate-spin" />
                            ) : null}
                            Add service
                          </Button>
                        </div>
                      </form>
                    ) : null}
                  </section>
                ) : null}
                {canShowBillingHandoffSection ? (
                  <section className={sectionCardClass("p-5")}>
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-950">
                          Billing and settlement handoff
                        </h3>
                        <p className="text-xs text-slate-500">
                          Structured transfer to billing before the document layer lands.
                        </p>
                      </div>
                      <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                        {billingHandoffTasks.length + billingHandoffReminders.length} linked
                      </span>
                    </div>

                    <div className="mt-4 grid gap-3 xl:grid-cols-3">
                      <ContextCard
                        label="Interpreter settlement"
                        value={
                          detail?.interpreter_id
                            ? interpreterReportReady && detailReport
                              ? `${detailReport.hours} h approved`
                              : "Pending approval"
                            : "Not required"
                        }
                        meta={
                          detail?.interpreter_id
                            ? detailReport
                              ? reportReviewMeta || reportApprovalLabel(detailReport.approval_status)
                              : "No report submitted"
                            : "No interpreter on this appointment"
                        }
                      />
                      <ContextCard
                        label="Concierge settlement"
                        value={
                          detail?.type === "non_medical"
                            ? `${readyConciergeServices.length} ready / ${settledConciergeServices.length} billed`
                            : "Not applicable"
                        }
                        meta={
                          detail?.type === "non_medical"
                            ? `${detailServices.length} service(s) linked`
                            : "Medical appointment"
                        }
                      />
                      <ContextCard
                        label="Billing queue"
                        value={`${openBillingHandoffTasks.length} open task(s)`}
                        meta={`${billingHandoffReminders.length} reminder(s) linked`}
                      />
                    </div>

                    {billingReadinessWarnings.length > 0 ? (
                      <div className="mt-4 space-y-2">
                        {billingReadinessWarnings.map((warning) => (
                          <Banner key={warning} tone="warning">
                            {warning}
                          </Banner>
                        ))}
                      </div>
                    ) : null}

                    <div className="mt-5 grid gap-4 xl:grid-cols-2">
                      <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <h4 className="text-sm font-semibold text-slate-950">
                            Billing reminders
                          </h4>
                          <span className="text-xs text-slate-500">
                            {billingHandoffReminders.length} linked
                          </span>
                        </div>
                        <div className="mt-3 space-y-3">
                          {billingHandoffReminders.length === 0 ? (
                            <EmptyState text="No billing reminders linked yet." />
                          ) : (
                            billingHandoffReminders.map((item) => (
                              <div
                                key={item.id}
                                className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
                              >
                                <p className="text-sm font-medium text-slate-900">
                                  {item.title}
                                </p>
                                <p className="mt-1 text-xs text-slate-500">
                                  {item.user_name} · {formatDateTimeLabel(item.remind_at)}
                                </p>
                                {item.description ? (
                                  <p className="mt-2 text-sm text-slate-600">
                                    {item.description}
                                  </p>
                                ) : null}
                              </div>
                            ))
                          )}
                        </div>
                      </div>

                      <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <h4 className="text-sm font-semibold text-slate-950">
                            Billing tasks
                          </h4>
                          <span className="text-xs text-slate-500">
                            {billingHandoffTasks.length} linked
                          </span>
                        </div>
                        <div className="mt-3 space-y-3">
                          {billingHandoffTasks.length === 0 ? (
                            <EmptyState text="No billing tasks linked yet." />
                          ) : (
                            billingHandoffTasks.map((task) => (
                              <div
                                key={task.id}
                                className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
                              >
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="text-sm font-medium text-slate-900">
                                    {task.title}
                                  </p>
                                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                                    {taskStatusLabel(task.status)}
                                  </span>
                                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                                    {taskPriorityLabel(task.priority)}
                                  </span>
                                </div>
                                <p className="mt-1 text-xs text-slate-500">
                                  {task.assigned_to_name} · {roleLabel(task.assigned_to_role)}
                                  {task.due_date
                                    ? ` · Due ${formatDateTimeLabel(task.due_date)}`
                                    : ""}
                                </p>
                                {task.description ? (
                                  <p className="mt-2 text-sm text-slate-600">
                                    {task.description}
                                  </p>
                                ) : null}
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </div>

                    {permissions.canManageConciergeBilling ? (
                      <form
                        onSubmit={handleBillingHandoffSubmit}
                        className="mt-5 grid gap-4 md:grid-cols-2"
                      >
                        <Field label="Billing track">
                          <select
                            value={billingHandoffForm.kind}
                            onChange={(event) =>
                              setBillingHandoffForm((current) => ({
                                ...current,
                                kind: event.target.value as BillingHandoffKind,
                              }))
                            }
                            className={selectClassName}
                          >
                            {(
                              [
                                "interpreter_hours",
                                "concierge_settlement",
                                "patient_invoice",
                                "provider_invoice",
                                "payment_confirmation",
                                "other",
                              ] as BillingHandoffKind[]
                            ).map((kind) => (
                              <option key={kind} value={kind}>
                                {billingHandoffKindLabel(kind)}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Assign to billing">
                          <select
                            value={billingHandoffForm.assigneeId}
                            onChange={(event) =>
                              setBillingHandoffForm((current) => ({
                                ...current,
                                assigneeId: event.target.value,
                              }))
                            }
                            className={selectClassName}
                            required
                          >
                            <option value="">Select billing assignee</option>
                            {billingStaff.map((member) => (
                              <option key={member.id} value={member.id}>
                                {member.name} · {roleLabel(member.role)}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Due at">
                          <Input
                            type="datetime-local"
                            value={billingHandoffForm.dueAt}
                            onChange={(event) =>
                              setBillingHandoffForm((current) => ({
                                ...current,
                                dueAt: event.target.value,
                              }))
                            }
                            className="h-10 rounded-xl bg-slate-50"
                            required
                          />
                        </Field>
                        <Field label="Task priority">
                          <select
                            value={billingHandoffForm.taskPriority}
                            onChange={(event) =>
                              setBillingHandoffForm((current) => ({
                                ...current,
                                taskPriority: event.target.value,
                              }))
                            }
                            className={selectClassName}
                          >
                            {TASK_PRIORITY_OPTIONS.map((priority) => (
                              <option key={priority} value={priority}>
                                {taskPriorityLabel(priority)}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Handoff title">
                          <Input
                            value={billingHandoffForm.title}
                            onChange={(event) =>
                              setBillingHandoffForm((current) => ({
                                ...current,
                                title: event.target.value,
                              }))
                            }
                            className="h-10 rounded-xl bg-slate-50"
                            placeholder="Interpreter payout, concierge reimbursement, patient invoice"
                          />
                        </Field>
                        <Field label="Notes">
                          <textarea
                            value={billingHandoffForm.notes}
                            onChange={(event) =>
                              setBillingHandoffForm((current) => ({
                                ...current,
                                notes: event.target.value,
                              }))
                            }
                            className={textareaClassName}
                            rows={3}
                            placeholder="Clarify amounts, approvals, pending payment proof or settlement context."
                          />
                        </Field>
                        <div className="md:col-span-2 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                          <label className="flex items-center gap-2 text-sm text-slate-600">
                            <input
                              type="checkbox"
                              checked={billingHandoffForm.createTask}
                              onChange={(event) =>
                                setBillingHandoffForm((current) => ({
                                  ...current,
                                  createTask: event.target.checked,
                                }))
                              }
                              className="size-4 rounded border-slate-300"
                            />
                            Mirror this billing handoff as a task
                          </label>
                          <div className="flex flex-wrap justify-end gap-3">
                            <Button
                              type="button"
                              variant="outline"
                              className="rounded-2xl"
                              disabled={!billingHandoffForm.assigneeId}
                              onClick={openBillingHandoffChatDraft}
                            >
                              Open billing chat draft
                            </Button>
                            <Button
                              type="submit"
                              className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
                              disabled={
                                billingHandoffBusy ||
                                !billingHandoffForm.assigneeId ||
                                !billingHandoffForm.dueAt ||
                                billingStaff.length === 0
                              }
                            >
                              {billingHandoffBusy ? (
                                <LoaderCircle className="size-4 animate-spin" />
                              ) : null}
                              Create billing handoff
                            </Button>
                          </div>
                        </div>
                      </form>
                    ) : null}
                  </section>
                ) : null}
                {permissions.canViewNotes && !detail.is_blocked ? <section className={sectionCardClass("p-5")}><h3 className="text-sm font-semibold text-slate-950">Notes</h3><div className="mt-4 grid gap-4 md:grid-cols-3"><TextPanel title="Preparation" text={detail.preparation_notes} /><TextPanel title="Follow-up" text={detail.followup_notes} /><TextPanel title="General notes" text={detail.notes} /></div></section> : null}
              </div>
            ) : <div className="flex min-h-[320px] items-center justify-center text-muted-foreground">Select an appointment from the calendar or list.</div>}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function StatsCard({ icon: Icon, label, value, tone }: { icon: typeof CalendarDays; label: string; value: string; tone: "sky" | "emerald" | "amber" | "slate" }) {
  const toneClass = tone === "sky" ? "bg-sky-100 text-sky-700" : tone === "emerald" ? "bg-emerald-100 text-emerald-700" : tone === "amber" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-700";
  return <div className="rounded-[1.5rem] border border-white/90 bg-white/88 p-4 shadow-sm backdrop-blur"><div className="flex items-center justify-between"><span className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">{label}</span><span className={cn("rounded-2xl p-2", toneClass)}><Icon className="size-4" /></span></div><p className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">{value}</p></div>;
}

function QuickScopeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant={active ? "default" : "outline"}
      size="sm"
      className={cn(
        "rounded-full px-3.5",
        active ? "bg-slate-950 text-white hover:bg-slate-800" : "bg-white/80"
      )}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function ContextCard({
  label,
  value,
  meta,
}: {
  label: string;
  value: string;
  meta: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className="mt-3 text-sm font-semibold text-slate-950">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{meta}</p>
    </div>
  );
}

function InfoLine({ icon: Icon, label }: { icon: typeof Clock3; label: string }) {
  return <div className="inline-flex items-center gap-2"><Icon className="size-4 text-slate-400" /><span>{label}</span></div>;
}

function TextPanel({ title, text }: { title: string; text: string | null }) {
  return <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4"><p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">{title}</p><p className="mt-3 text-sm leading-6 text-slate-700">{text?.trim() || "No notes captured yet."}</p></div>;
}

function ConflictPanel({ conflicts }: { conflicts: ConflictSummary | null }) {
  if (!conflicts) return null;
  const items = [...conflicts.patient_conflicts.map((item) => ({ ...item, scope: "Patient" })), ...conflicts.interpreter_conflicts.map((item) => ({ ...item, scope: "Interpreter" }))].slice(0, 6);
  if (!conflicts.has_conflicts) return <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">No patient or interpreter overlaps detected for the current slot.</div>;
  return <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800"><div className="flex items-start gap-3"><ShieldAlert className="mt-0.5 size-4 shrink-0" /><div className="min-w-0"><p className="font-semibold">{conflicts.patient_conflict_count + conflicts.interpreter_conflict_count} overlap(s) detected</p><div className="mt-3 space-y-2">{items.map((item) => <div key={`${item.scope}-${item.id}`} className="rounded-xl border border-amber-200/70 bg-white/75 px-3 py-2"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]">{item.scope}</span><span className="text-sm font-medium text-amber-900">{item.title}</span></div><p className="mt-1 text-xs text-amber-800">{slotLabel(item)} · {item.patient_pid}{item.interpreter_name ? ` · ${item.interpreter_name}` : ""}</p></div>)}</div></div></div></div>;
}

function ScheduleWarningsPanel({ warnings }: { warnings: LocalScheduleWarning[] }) {
  if (warnings.length === 0) return null;
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0">
          <p className="font-semibold">Local schedule pressure detected</p>
          <div className="mt-3 space-y-2">
            {warnings.map((warning) => (
              <div
                key={warning.scope}
                className="rounded-xl border border-amber-200/70 bg-white/75 px-3 py-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]">
                    {warning.scope}
                  </span>
                  <span className="text-sm font-medium text-amber-900">{warning.label}</span>
                </div>
                <p className="mt-1 text-xs text-amber-800">
                  {warning.items
                    .slice(0, 2)
                    .map((item) => `${item.title} · ${slotLabel(item)}`)
                    .join(" | ")}
                  {warning.items.length > 2 ? ` | +${warning.items.length - 2} more` : ""}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
