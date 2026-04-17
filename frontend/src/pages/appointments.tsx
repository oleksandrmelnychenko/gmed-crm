import {
  startTransition,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { useSearchParams } from "react-router-dom";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import deLocale from "@fullcalendar/core/locales/de";
import ruLocale from "@fullcalendar/core/locales/ru";
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
  AlertTriangle,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  Clock3,
  MoreHorizontal,
  LoaderCircle,
  MapPin,
  Plus,
  RefreshCw,
  ShieldAlert,
  Stethoscope,
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
import {
  Select as ShadSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/lib/auth";
import {
  getLang,
  t as translateCatalog,
  useLang,
  type Translations,
} from "@/lib/i18n";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  buildInterpreterMobileAgendaSections,
  buildAppointmentTimelineEvents,
  canResubmitInterpreterReport,
  shouldUseInterpreterMobileAgenda,
  type AppointmentTimelineEvent,
  type AppointmentTimelineKind,
} from "@/pages/appointments.helpers";
import { PatientAppointmentsPage } from "@/pages/patient-appointments";

type AppointmentKind = "medical" | "non_medical" | "internal";
type AppointmentCarePathKind =
  | "regular"
  | "preventive"
  | "control"
  | "followup";
type AppointmentStatus =
  | "planned"
  | "confirmed"
  | "in_progress"
  | "completed"
  | "cancelled";
type InterpreterResponse = "pending" | "accepted" | "declined" | "discussion";
type AppointmentRecurrenceFrequency = "daily" | "weekly" | "monthly";
type AppointmentRecurringActionScope = "single" | "following" | "series";

type AppointmentListItem = {
  id: string;
  title: string;
  date: string;
  time_start: string | null;
  time_end: string | null;
  type: AppointmentKind;
  care_path_kind: AppointmentCarePathKind | null;
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
  recurrence_series_id: string | null;
  recurrence_frequency: AppointmentRecurrenceFrequency | null;
  recurrence_interval: number | null;
  recurrence_count: number | null;
  recurrence_until: string | null;
  recurrence_index: number;
  recurrence_series_size: number;
  is_blocked: boolean;
};

type AppointmentDetail = AppointmentListItem & {
  category: string | null;
  preparation_notes: string | null;
  followup_notes: string | null;
  notes: string | null;
  order_id: string | null;
  recurrence_parent_series_id: string | null;
  recurrence_split_from_appointment_id: string | null;
  recurrence_split_from_index: number | null;
  recurring_scope_preview: RecurringScopePreviewItem[];
  recurring_lineage_history: RecurringLineageHistoryItem[];
  created_at: string;
};

type RecurringScopePreviewItem = {
  id: string;
  date: string;
  status: AppointmentStatus;
  recurrence_index: number;
  open_checklist_count: number;
};

type RecurringLineageHistoryItem = {
  series_id: string;
  parent_series_id: string | null;
  split_from_appointment_id: string | null;
  split_from_index: number | null;
  first_date: string;
  last_date: string;
  total_occurrences: number;
  active_occurrences: number;
  completed_occurrences: number;
  cancelled_occurrences: number;
  relation: "ancestor" | "current" | "descendant" | string;
  depth: number;
};

type AppointmentAttentionItem = AppointmentListItem & {
  attention_score: number;
  reasons: string[];
  next_due_at: string | null;
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
  billing_leistung_id?: string | null;
  billing_sync_status?: string | null;
  billing_service_key?: string | null;
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

type AppointmentCommunicationTarget = "clinic" | "doctor" | "service_provider";
type AppointmentCommunicationDirection = "outbound" | "inbound";
type AppointmentCommunicationChannel =
  | "phone"
  | "email"
  | "portal"
  | "fax"
  | "whatsapp"
  | "other";
type AppointmentCommunicationStatus =
  | "planned"
  | "sent"
  | "answered"
  | "closed"
  | "cancelled";

type AppointmentCommunicationEntry = {
  id: string;
  appointment_id: string;
  patient_id: string;
  provider_id: string | null;
  provider_name: string | null;
  doctor_id: string | null;
  doctor_name: string | null;
  target_type: AppointmentCommunicationTarget;
  direction: AppointmentCommunicationDirection;
  channel: AppointmentCommunicationChannel;
  status: AppointmentCommunicationStatus;
  subject: string;
  message: string | null;
  contact_name: string | null;
  due_at: string | null;
  responded_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  created_by_name: string;
  created_by_role: string;
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
  recurrenceFrequency: AppointmentRecurrenceFrequency | null;
  isBlocked: boolean;
};

type CalendarQuickActionMenuState = {
  appointmentId: string;
  top: number;
  left: number;
};

type LocalScheduleWarningScope = "owner" | "doctor" | "clinic";

type LocalScheduleWarning = {
  scope: LocalScheduleWarningScope;
  label: string;
  items: AppointmentListItem[];
};

type CalendarView =
  | "dayGridMonth"
  | "timeGridWeek"
  | "timeGridDay"
  | "listWeek";
type OperationalScope =
  | "all"
  | "owned_by_me"
  | "needs_attention"
  | "pending_interpreter"
  | "my_interpreter_queue"
  | "concierge_flow"
  | "blocked_medical";
type SchedulerQuickScope =
  | "all"
  | "today"
  | "week"
  | "mine"
  | "medical"
  | "non_medical"
  | "internal";

type FiltersState = {
  search: string;
  appointmentType: string;
  carePathKind: string;
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
  carePathKind: AppointmentCarePathKind;
  title: string;
  date: string;
  timeStart: string;
  timeEnd: string;
  location: string;
  category: string;
  notes: string;
  repeatEnabled: boolean;
  repeatFrequency: AppointmentRecurrenceFrequency;
  repeatInterval: string;
  repeatCount: string;
  repeatUntil: string;
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
  target: AppointmentCommunicationTarget;
  direction: AppointmentCommunicationDirection;
  channel: AppointmentCommunicationChannel;
  status: AppointmentCommunicationStatus;
  title: string;
  contactName: string;
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
  canViewCommunications: boolean;
  canManageCommunications: boolean;
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
const CARE_PATH_KIND_OPTIONS: AppointmentCarePathKind[] = [
  "regular",
  "preventive",
  "control",
  "followup",
];
const RECURRENCE_FREQUENCY_OPTIONS: AppointmentRecurrenceFrequency[] = [
  "daily",
  "weekly",
  "monthly",
];
const INTERPRETER_RESPONSE_OPTIONS: InterpreterResponse[] = [
  "pending",
  "accepted",
  "declined",
  "discussion",
];
const CHECKLIST_PHASES = ["preparation", "execution", "followup"];
const TASK_STATUS_OPTIONS = ["open", "in_progress", "completed", "cancelled"];
const TASK_PRIORITY_OPTIONS = ["low", "normal", "high", "urgent"];
const COMMUNICATION_STATUS_OPTIONS: AppointmentCommunicationStatus[] = [
  "planned",
  "sent",
  "answered",
  "closed",
  "cancelled",
];
const COMMUNICATION_CHANNEL_OPTIONS: AppointmentCommunicationChannel[] = [
  "phone",
  "email",
  "portal",
  "fax",
  "whatsapp",
  "other",
];
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
  {
    id: "post_1w",
    label: "1 week",
    offsetDays: 7,
    title: "1-week follow-up check-in",
  },
  {
    id: "post_1m",
    label: "1 month",
    offsetMonths: 1,
    title: "1-month follow-up check-in",
  },
  {
    id: "post_6m",
    label: "6 months",
    offsetMonths: 6,
    title: "6-month follow-up check-in",
  },
] as const;
const CALENDAR_STORAGE_VIEW_KEY = "gmed_appointments_calendar_view";
const CALENDAR_STORAGE_DATE_KEY = "gmed_appointments_calendar_date";
const DEFAULT_FILTERS: FiltersState = {
  search: "",
  appointmentType: "",
  carePathKind: "",
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
const createSheetInputClassName = "h-9 rounded-lg bg-card";
const createSheetTextareaClassName =
  "min-h-[80px] w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30";

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
        canViewCommunications: true,
        canManageCommunications: true,
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
        canViewCommunications: true,
        canManageCommunications: true,
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
        canViewCommunications: true,
        canManageCommunications: false,
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
        canViewCommunications: true,
        canManageCommunications: true,
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
        canViewCommunications: false,
        canManageCommunications: false,
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
    carePathKind: "regular",
    title: "",
    date: today,
    timeStart: "",
    timeEnd: "",
    location: "",
    category: "",
    notes: "",
    repeatEnabled: false,
    repeatFrequency: "weekly",
    repeatInterval: "1",
    repeatCount: "4",
    repeatUntil: "",
  };
}

function buildFollowUpVisitForm(
  detail: AppointmentDetail,
  defaultReminderUserId = "",
  followUpLabel = "Follow-up",
): FollowUpVisitFormState {
  const start = detail.time_start
    ? shiftLocalDateTime(`${detail.date}T${detail.time_start.slice(0, 5)}`, {
        months: 1,
      })
    : "";
  const end = detail.time_end
    ? shiftLocalDateTime(`${detail.date}T${detail.time_end.slice(0, 5)}`, {
        months: 1,
      })
    : "";
  const reminderAt = start ? shiftLocalDateTime(start, { days: -3 }) : "";

  return {
    patientId: detail.patient_id,
    providerId: detail.provider_id ?? "",
    doctorId: detail.doctor_id ?? "",
    ownerUserId: detail.owner_user_id ?? "",
    interpreterId: detail.interpreter_id ?? "",
    appointmentType: detail.type,
    carePathKind: "followup",
    title: detail.category
      ? `${detail.category} ${followUpLabel}`
      : `${followUpLabel}: ${detail.title}`,
    date: start ? start.slice(0, 10) : currentDateInput(),
    timeStart: start ? start.slice(11, 16) : "",
    timeEnd: end ? end.slice(11, 16) : "",
    location: detail.location ?? "",
    category: detail.category
      ? `${detail.category} ${followUpLabel}`
      : followUpLabel,
    notes: detail.followup_notes ?? detail.notes ?? "",
    repeatEnabled: false,
    repeatFrequency: "weekly",
    repeatInterval: "1",
    repeatCount: "4",
    repeatUntil: "",
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
  return (
    window.localStorage.getItem(CALENDAR_STORAGE_DATE_KEY) || currentDateInput()
  );
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
  defaultDueAt = "",
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

function blankPackageEndFollowUpForm(
  defaultAssignee = "",
  defaultTitle = "",
): PackageEndFollowUpFormState {
  return {
    title: defaultTitle,
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
  defaultTarget: ExternalHandoffFormState["target"] = "clinic",
): ExternalHandoffFormState {
  return {
    target: defaultTarget,
    direction: "outbound",
    channel: "email",
    status: "sent",
    title: "",
    contactName: "",
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
  defaultKind: BillingHandoffKind = "patient_invoice",
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
  defaultArtifact: FindingsFollowUpArtifact = "arztbrief",
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
  defaultSource: IncomingDataSource = "doctor",
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
    FOLLOW_UP_PRESETS.map((preset) => [preset.id, true]),
  ) as Record<string, boolean>;
}

function blankTaskForm(
  defaultAssignee = "",
  defaultDueDate = "",
): TaskFormState {
  return {
    title: "",
    description: "",
    assignedTo: defaultAssignee,
    dueDate: defaultDueDate,
    priority: "normal",
  };
}

function blankConciergeServiceForm(
  defaults?: Partial<ConciergeServiceFormState>,
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
  const tr = runtimeTranslations();
  if (!role) return "";
  const translated = tr[`role_${role}` as keyof typeof tr];
  return typeof translated === "string"
    ? translated
    : role
        .split("_")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}

function runtimeTranslations() {
  return translateCatalog(getLang());
}

function runtimeLocale() {
  return getLang() === "ru" ? "ru-RU" : "de-DE";
}

function appointmentText(de: string, ru: string, _en: string) {
  return getLang() === "ru" ? ru : de;
}

function appointmentTypeLabel(
  type: AppointmentKind,
  tr?: Record<string, string>,
) {
  if (type === "non_medical")
    return tr?.role_concierge ??
      appointmentText("Concierge", "РљРѕРЅСЃСЊРµСЂР¶", "Concierge");
  if (type === "internal")
    return appointmentText("Intern", "Внутренний", "Internal");
  return tr?.common_doctor ?? appointmentText("Arzt", "Р’СЂР°С‡", "Medical");
}

function carePathKindLabel(value?: string | null) {
  switch (value) {
    case "preventive":
      return appointmentText("Praventiv", "Профилактика", "Preventive");
    case "control":
      return appointmentText("Kontrolle", "Контроль", "Control");
    case "followup":
      return appointmentText("Nachsorge", "Наблюдение", "Follow-up");
    case "regular":
      return appointmentText("Standard", "Стандартный", "Regular");
    default:
      return appointmentText("Standard", "Стандартный", "Regular");
  }
}

function normalizeCarePathKindForAppointmentType(
  appointmentType: AppointmentKind,
  carePathKind: AppointmentCarePathKind,
): AppointmentCarePathKind {
  return appointmentType === "medical" ? carePathKind : "regular";
}

function statusLabel(status: AppointmentStatus) {
  switch (status) {
    case "planned":
      return appointmentText("Geplant", "Запланирован", "Planned");
    case "confirmed":
      return appointmentText("Bestatigt", "Подтверждён", "Confirmed");
    case "in_progress":
      return appointmentText("Lauft", "В процессе", "In progress");
    case "completed":
      return appointmentText("Abgeschlossen", "Завершён", "Completed");
    case "cancelled":
      return appointmentText("Abgesagt", "Отменён", "Cancelled");
  }
}

function communicationStatusLabel(status: AppointmentCommunicationStatus) {
  switch (status) {
    case "planned":
      return appointmentText("Geplant", "Запланировано", "Planned");
    case "sent":
      return appointmentText("Gesendet", "Отправлено", "Sent");
    case "answered":
      return appointmentText("Beantwortet", "Получен ответ", "Answered");
    case "closed":
      return appointmentText("Geschlossen", "Закрыто", "Closed");
    case "cancelled":
      return appointmentText("Abgebrochen", "Отменено", "Cancelled");
  }
  return String(status).replace("_", " ");
}

function communicationChannelLabel(channel: AppointmentCommunicationChannel) {
  switch (channel) {
    case "phone":
      return appointmentText("Telefon", "Телефон", "Phone");
    case "email":
      return appointmentText("E-Mail", "Эл. почта", "Email");
    case "portal":
      return appointmentText("Portal", "Портал", "Portal");
    case "fax":
      return appointmentText("Fax", "Факс", "Fax");
    case "whatsapp":
      return "WhatsApp";
    case "other":
      return appointmentText("Anderer Kanal", "Другой канал", "Other");
  }
  return String(channel).charAt(0).toUpperCase() + String(channel).slice(1);
}

function communicationTargetLabel(
  target: AppointmentCommunicationTarget,
  detail?: AppointmentDetail | null,
) {
  switch (target) {
    case "doctor":
      return detail?.doctor_name || appointmentText("Arzt", "Врач", "Doctor");
    case "service_provider":
      return (
        detail?.provider_name ||
        appointmentText("Leistungserbringer", "Поставщик услуг", "Service provider")
      );
    default:
      return detail?.provider_name || appointmentText("Klinik", "Клиника", "Clinic");
  }
}

function responseLabel(value: InterpreterResponse) {
  switch (value) {
    case "pending":
      return appointmentText("Ausstehend", "Ожидается", "Pending");
    case "accepted":
      return appointmentText("Bestatigt", "Подтверждено", "Accepted");
    case "declined":
      return appointmentText("Abgelehnt", "Отклонено", "Declined");
    case "discussion":
      return appointmentText(
        "Klärung erforderlich",
        "Нужно уточнение",
        "Needs discussion",
      );
  }
}

function reportApprovalLabel(status: string) {
  switch (status) {
    case "approved":
      return appointmentText("Freigegeben", "Согласовано", "Approved");
    case "rejected":
      return appointmentText("Zuruckgewiesen", "Отклонено", "Rejected");
    case "pending_review":
      return appointmentText("Prufung ausstehend", "Ожидает проверки", "Pending review");
    case "needs_interpreter_revision":
      return appointmentText(
        "Uberarbeitung durch Dolmetscher",
        "Нужна доработка переводчика",
        "Needs interpreter revision",
      );
    default:
      return status
        .split("_")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
  }
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

function interpreterReportBillingSyncLabel(
  status: string | null | undefined,
  t: Translations,
) {
  switch (status) {
    case "synced":
      return t.appointments_billing_sync_synced;
    case "missing_catalog":
      return t.appointments_billing_sync_missing_catalog;
    case "missing_order":
      return t.appointments_billing_sync_missing_order;
    case "pending_sync":
      return t.appointments_billing_sync_pending;
    default:
      return t.appointments_billing_sync_none;
  }
}

function interpreterReportBillingSyncClass(status: string | null | undefined) {
  switch (status) {
    case "synced":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "missing_catalog":
    case "missing_order":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "pending_sync":
      return "border-sky-200 bg-sky-50 text-sky-800";
    default:
      return "border-slate-200 bg-slate-50 text-slate-700";
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

function toCalendarEvent(
  item: AppointmentListItem,
  canEditSchedule: boolean,
): EventInput {
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
      recurrenceFrequency: item.recurrence_frequency,
      isBlocked: item.is_blocked,
    } satisfies CalendarEventExtendedProps,
  };
}

function slotWindow(
  date: string,
  timeStart: string | null,
  timeEnd: string | null,
) {
  if (!date) return null;
  const start = new Date(`${date}T${timeStart || "00:00"}:00`);
  const end = new Date(
    `${date}T${timeEnd || (timeStart ? addHourToTime(timeStart) : "23:59")}:00`,
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
  right: { startMs: number; endMs: number } | null,
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
  },
  tr?: Record<string, string>,
): LocalScheduleWarning[] {
  if (!payload.date) return [];

  const targetWindow = slotWindow(
    payload.date,
    payload.timeStart || null,
    payload.timeEnd || null,
  );

  const scopes: Array<{
    scope: LocalScheduleWarningScope;
    label: string;
    match: (item: AppointmentListItem) => boolean;
  }> = [
    {
      scope: "owner",
      label: tr?.patients_assign_owner ?? "Owner",
      match: (item) =>
        Boolean(payload.ownerUserId) &&
        item.owner_user_id === payload.ownerUserId,
    },
    {
      scope: "doctor",
      label: tr?.common_doctor ?? "Doctor",
      match: (item) =>
        Boolean(payload.doctorId) && item.doctor_id === payload.doctorId,
    },
    {
      scope: "clinic",
      label: tr?.common_provider ?? "Clinic",
      match: (item) =>
        Boolean(payload.providerId) && item.provider_id === payload.providerId,
    },
  ];

  return scopes
    .map((scope) => ({
      scope: scope.scope,
      label: scope.label,
      items: items.filter((item) => {
        if (item.id === payload.appointmentId || item.status === "cancelled")
          return false;
        if (!scope.match(item)) return false;
        return overlaps(
          slotWindow(item.date, item.time_start, item.time_end),
          targetWindow,
        );
      }),
    }))
    .filter((warning) => warning.items.length > 0);
}

function buildScheduleNotice(
  conflicts: ConflictSummary | null | undefined,
  warnings: LocalScheduleWarning[],
) {
  const parts: string[] = [];
  if (conflicts?.patient_conflict_count) {
    parts.push(
      appointmentText(
        `${conflicts.patient_conflict_count} Patientenuberschneidung`,
        `${conflicts.patient_conflict_count} пересечение по пациенту`,
        `${conflicts.patient_conflict_count} patient overlap`,
      ),
    );
  }
  if (conflicts?.interpreter_conflict_count) {
    parts.push(
      appointmentText(
        `${conflicts.interpreter_conflict_count} Dolmetscheruberschneidung`,
        `${conflicts.interpreter_conflict_count} пересечение по переводчику`,
        `${conflicts.interpreter_conflict_count} interpreter overlap`,
      ),
    );
  }
  for (const warning of warnings) {
    parts.push(
      appointmentText(
        `${warning.items.length} Konflikt bei ${warning.label.toLowerCase()}`,
        `${warning.items.length} конфликт по ${warning.label.toLowerCase()}`,
        `${warning.items.length} ${warning.scope} overlap`,
      ),
    );
  }
  return parts.length
    ? appointmentText(
        `Planungshinweis: ${parts.join(", ")}.`,
        `Предупреждение по расписанию: ${parts.join(", ")}.`,
        `Scheduling warning: ${parts.join(", ")}.`,
      )
    : "";
}

function matchesOperationalScope(
  item: AppointmentListItem,
  scope: OperationalScope,
  userId?: string,
  userRole?: string,
  attentionIds?: ReadonlySet<string>,
) {
  switch (scope) {
    case "all":
      return true;
    case "owned_by_me":
      return Boolean(userId) && item.owner_user_id === userId;
    case "needs_attention":
      return Boolean(attentionIds?.has(item.id));
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
  userRole?: string,
  attentionIndex?: ReadonlyMap<string, AppointmentAttentionItem>,
  tr?: Record<string, string>,
) {
  switch (scope) {
    case "owned_by_me":
      return item.owner_role
        ? `${tr?.patients_assign_owner ?? appointmentText("Zustandig", "Куратор", "Owner")} · ${roleLabel(item.owner_role)}`
        : appointmentText("Bei mir", "Мои", "Owned by me");
    case "needs_attention":
      return (
        attentionIndex?.get(item.id)?.reasons[0] ||
        (tr?.common_error ??
          appointmentText(
            "Operative Nachverfolgung erforderlich",
            "Нужно операционное действие",
            "Operational follow-up required",
          ))
      );
    case "pending_interpreter":
      return item.interpreter_name
        ? `${item.interpreter_name} · ${responseLabel(item.interpreter_response ?? "pending")}`
        : appointmentText(
            "Dolmetscher ausstehend",
            "Ожидается переводчик",
            "Interpreter pending",
          );
    case "my_interpreter_queue":
      return item.interpreter_response === "pending"
        ? appointmentText("Antwort ausstehend", "Нужен ответ", "Response required")
        : item.status === "completed"
          ? appointmentText("Slot abgeschlossen", "Слот завершён", "Completed slot")
          : appointmentText(
              "Zugewiesener Dolmetscher-Slot",
              "Назначенный слот переводчика",
              "Assigned interpreter slot",
            );
    case "concierge_flow":
      return (
        item.provider_name ||
        appointmentText(
          "Nicht-medizinischer Servicefluss",
          "Поток немедицинского сервиса",
          "Non-medical service flow",
        )
      );
    case "blocked_medical":
      return userRole === "concierge"
        ? appointmentText(
            "Medizinischer Slot als blockiert angezeigt",
            "Медицинский слот показан как заблокированный",
            "Medical slot shown as blocked",
          )
        : appointmentText("Blockierter Slot", "Заблокированный слот", "Blocked slot");
    case "all":
      return (
        item.owner_name ||
        item.provider_name ||
        (tr?.appointments_title ?? appointmentText("Termin", "Приём", "Appointment"))
      );
  }
}

function operationalScopeOptions(
  role: string | undefined,
  tr: Record<string, string>,
): OperationalScopeOption[] {
  const options: OperationalScopeOption[] = [
    {
      id: "all",
      label:
        tr.providers_all ?? appointmentText("Alle sichtbar", "Все видимые", "All visible"),
    },
  ];

  if (role && role !== "interpreter") {
    options.push({
      id: "owned_by_me",
      label: appointmentText("Bei mir", "Мои", "Owned by me"),
    });
  }
  if (role) {
    options.push({
      id: "needs_attention",
      label: appointmentText("Braucht Aufmerksamkeit", "Требует внимания", "Needs attention"),
    });
  }
  if (
    role === "ceo" ||
    role === "patient_manager" ||
    role === "teamlead_interpreter"
  ) {
    options.push({
      id: "pending_interpreter",
      label: appointmentText(
        "Dolmetscher ausstehend",
        "Ожидается переводчик",
        "Pending interpreter",
      ),
    });
  }
  if (role === "teamlead_interpreter" || role === "interpreter") {
    options.push({
      id: "my_interpreter_queue",
      label: appointmentText(
        "Dolmetscher-Warteschlange",
        "Очередь переводчика",
        "Interpreter queue",
      ),
    });
  }
  if (role === "ceo" || role === "patient_manager" || role === "concierge") {
    options.push({
      id: "concierge_flow",
      label: appointmentText("Concierge-Flow", "Поток concierge", "Concierge flow"),
    });
  }
  if (role === "concierge") {
    options.push({
      id: "blocked_medical",
      label: appointmentText(
        "Blockierte Medizin-Slots",
        "Заблокированные медслоты",
        "Blocked medical",
      ),
    });
  }

  return options;
}

function buildAppointmentsQuery(filters: FiltersState) {
  const params = new URLSearchParams();
  if (filters.search.trim()) params.set("search", filters.search.trim());
  if (filters.appointmentType)
    params.set("appointment_type", filters.appointmentType);
  if (filters.carePathKind) params.set("care_path_kind", filters.carePathKind);
  if (filters.status) params.set("status", filters.status);
  if (filters.patientId) params.set("patient_id", filters.patientId);
  if (filters.providerId) params.set("provider_id", filters.providerId);
  if (filters.doctorId) params.set("doctor_id", filters.doctorId);
  if (filters.ownerUserId) params.set("owner_user_id", filters.ownerUserId);
  if (filters.interpreterId)
    params.set("interpreter_id", filters.interpreterId);
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
  interpreterId: string,
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
  if (!dateTime) return runtimeTranslations().common_not_set;
  try {
    return new Intl.DateTimeFormat(runtimeLocale(), {
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

function slotLabel(item: {
  date: string;
  time_start: string | null;
  time_end: string | null;
}) {
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
  adjustment: { days?: number; months?: number },
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
  return doctor.fachbereich
    ? `${doctor.name} (${doctor.fachbereich})`
    : doctor.name;
}

function providerLabel(provider: ProviderSummary) {
  return provider.address_city
    ? `${provider.name} · ${provider.address_city}`
    : provider.name;
}

function staffLabel(option: { name: string; role: string }) {
  return `${option.name} · ${roleLabel(option.role)}`;
}

function recurrenceFrequencyLabel(value: AppointmentRecurrenceFrequency) {
  switch (value) {
    case "daily":
      return appointmentText("Taglich", "Ежедневно", "Daily");
    case "weekly":
      return appointmentText("Wochentlich", "Еженедельно", "Weekly");
    case "monthly":
      return appointmentText("Monatlich", "Ежемесячно", "Monthly");
    default:
      return value;
  }
}

function recurrenceCadenceLabel(item: {
  recurrence_frequency: AppointmentRecurrenceFrequency | null;
  recurrence_interval: number | null;
}) {
  if (!item.recurrence_frequency)
    return appointmentText("Einmaliger Termin", "Разовый приём", "One-time appointment");
  const interval = item.recurrence_interval ?? 1;
  if (item.recurrence_frequency === "daily") {
    return appointmentText(
      interval === 1 ? "Jeden Tag" : `Alle ${interval} Tage`,
      interval === 1 ? "Каждый день" : `Каждые ${interval} дней`,
      `Every ${interval} ${interval === 1 ? "day" : "days"}`,
    );
  }
  if (item.recurrence_frequency === "weekly") {
    return appointmentText(
      interval === 1 ? "Jede Woche" : `Alle ${interval} Wochen`,
      interval === 1 ? "Каждую неделю" : `Каждые ${interval} недель`,
      `Every ${interval} ${interval === 1 ? "week" : "weeks"}`,
    );
  }
  return appointmentText(
    interval === 1 ? "Jeden Monat" : `Alle ${interval} Monate`,
    interval === 1 ? "Каждый месяц" : `Каждые ${interval} месяцев`,
    `Every ${interval} ${interval === 1 ? "month" : "months"}`,
  );
}

function recurrenceLineageText(
  detail: AppointmentDetail,
  t: Translations | Record<string, string>,
) {
  if (
    !detail.recurrence_frequency ||
    !detail.recurrence_parent_series_id ||
    detail.recurrence_split_from_index === null
  ) {
    return "";
  }
  const occurrenceNumber = detail.recurrence_split_from_index + 1;
  return detail.recurrence_split_from_appointment_id === detail.id
    ? `${t.appointments_lineage_tail_root} ${occurrenceNumber} ${t.appointments_lineage_previous_plan}`
    : `${t.appointments_lineage_tail_member} ${occurrenceNumber} ${t.appointments_lineage_previous_plan}`;
}

function recurrenceLineageBadge(
  detail: AppointmentDetail,
  t: Translations | Record<string, string>,
) {
  if (!detail.recurrence_frequency || !detail.recurrence_parent_series_id) {
    return "";
  }
  return detail.recurrence_split_from_appointment_id === detail.id
    ? t.appointments_lineage_child
    : t.appointments_lineage_related;
}

function recurringStatusTargetsForScope(
  detail: AppointmentDetail,
  scope: AppointmentRecurringActionScope,
) {
  const items = detail.recurring_scope_preview ?? [];
  if (!detail.recurrence_frequency) return [];
  if (scope === "single") {
    return items.filter((item) => item.id === detail.id);
  }
  if (scope === "following") {
    return items.filter(
      (item) => item.recurrence_index >= detail.recurrence_index,
    );
  }
  return items;
}

function recurringOccurrenceLabel(
  item: {
    date: string;
    recurrence_index: number;
    open_checklist_count: number;
  },
  t: Translations | Record<string, string>,
) {
  const checklistLabel =
    item.open_checklist_count === 1
      ? t.appointments_open_checklist
      : t.appointments_open_checklists;
  return `Occurrence ${item.recurrence_index + 1} on ${item.date} (${item.open_checklist_count} ${checklistLabel})`;
}

function recurringLineageRelationLabel(
  item: RecurringLineageHistoryItem,
  t: Translations | Record<string, string>,
) {
  switch (item.relation) {
    case "ancestor":
      return item.depth <= 1
        ? t.appointments_lineage_parent
        : `${t.appointments_lineage_ancestor} +${item.depth}`;
    case "current":
      return t.appointments_lineage_current;
    case "descendant":
      return item.depth <= 1
        ? t.appointments_lineage_child
        : `${t.appointments_lineage_descendant} +${item.depth}`;
    default:
      return t.appointments_lineage_related;
  }
}

function recurringLineageSplitLabel(
  item: RecurringLineageHistoryItem,
  t: Translations | Record<string, string>,
) {
  if (item.split_from_index === null) return t.appointments_lineage_current;
  return `${t.appointments_lineage_split_from_occurrence} ${item.split_from_index + 1}`;
}

function currentRecurringLineageHistory(detail: AppointmentDetail) {
  return (
    detail.recurring_lineage_history.find(
      (item) =>
        item.relation === "current" ||
        item.series_id === detail.recurrence_series_id,
    ) ?? null
  );
}

function parsePositiveIntegerInput(value: string) {
  const normalized = value.trim();
  if (!normalized) return null;
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function findingsArtifactLabel(value: FindingsFollowUpArtifact) {
  switch (value) {
    case "arztbrief":
      return "Arztbrief";
    case "written_findings":
      return appointmentText("Schriftlicher Befund", "Письменное заключение", "Written findings");
    case "both":
      return appointmentText(
        "Arztbrief und schriftlicher Befund",
        "Arztbrief и письменное заключение",
        "Arztbrief and written findings",
      );
    default:
      return value;
  }
}

function incomingDataSourceLabel(value: IncomingDataSource) {
  switch (value) {
    case "patient":
      return appointmentText("Patient", "Пациент", "Patient");
    case "doctor":
      return appointmentText("Arzt", "Врач", "Doctor");
    case "clinic":
      return appointmentText("Klinik", "Клиника", "Clinic");
    case "interpreter":
      return appointmentText("Dolmetscher", "Переводчик", "Interpreter");
    case "external_lab":
      return appointmentText("Externes Labor", "Внешняя лаборатория", "External lab");
    case "other":
      return appointmentText("Andere Quelle", "Другой источник", "Other source");
    default:
      return value;
  }
}

function incomingDataCategoryLabel(value: IncomingDataCategory) {
  switch (value) {
    case "medical_update":
      return appointmentText("Medizinisch", "Медицинское", "Medical");
    case "diagnosis":
      return appointmentText("Diagnose", "Диагноз", "Diagnosis");
    case "medication":
      return appointmentText("Medikation", "Назначения", "Medication");
    case "symptom":
      return appointmentText("Symptome", "Симптомы", "Symptoms");
    case "lab_result":
      return appointmentText("Laborergebnis", "Результат анализа", "Lab result");
    case "imaging":
      return appointmentText("Bildgebung", "Визуализация", "Imaging");
    case "recommendation":
      return appointmentText("Empfehlung", "Рекомендация", "Recommendation");
    case "risk_flag":
      return appointmentText("Risikohinweis", "Флаг риска", "Risk flag");
    case "other":
      return appointmentText("Sonstiges", "Другое", "Other");
    default:
      return value;
  }
}

function taskStatusLabel(status: string) {
  switch (status) {
    case "open":
      return appointmentText("Offen", "Открыта", "Open");
    case "in_progress":
      return appointmentText("In Bearbeitung", "В работе", "In progress");
    case "completed":
      return appointmentText("Erledigt", "Завершена", "Completed");
    case "cancelled":
      return appointmentText("Abgebrochen", "Отменена", "Cancelled");
    default:
      return status
        .split("_")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
  }
}

function taskPriorityLabel(priority: string) {
  switch (priority) {
    case "low":
      return appointmentText("Niedrig", "Низкий", "Low");
    case "medium":
      return appointmentText("Mittel", "Средний", "Medium");
    case "high":
      return appointmentText("Hoch", "Высокий", "High");
    case "urgent":
      return appointmentText("Dringend", "Срочно", "Urgent");
    default:
      return priority.charAt(0).toUpperCase() + priority.slice(1);
  }
}

function communicationStatusBadgeClass(status: AppointmentCommunicationStatus) {
  switch (status) {
    case "answered":
    case "closed":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "cancelled":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "planned":
      return "border-amber-200 bg-amber-50 text-amber-700";
    default:
      return "border-sky-200 bg-sky-50 text-sky-700";
  }
}

function billingHandoffKindLabel(kind: BillingHandoffKind) {
  switch (kind) {
    case "interpreter_hours":
      return appointmentText("Dolmetscherstunden", "Часы переводчика", "Interpreter hours");
    case "concierge_settlement":
      return appointmentText("Concierge-Abrechnung", "Расчёт concierge", "Concierge settlement");
    case "patient_invoice":
      return appointmentText("Patientenrechnung", "Счёт пациенту", "Patient invoice");
    case "provider_invoice":
      return appointmentText("Rechnung des Providers", "Счёт провайдера", "Provider invoice");
    case "payment_confirmation":
      return appointmentText("Zahlungsbestätigung", "Подтверждение оплаты", "Payment confirmation");
    case "other":
      return appointmentText("Sonstiges", "Другое", "Other");
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
  switch (status) {
    case "draft":
      return appointmentText("Entwurf", "Черновик", "Draft");
    case "planned":
      return appointmentText("Geplant", "Запланировано", "Planned");
    case "ready":
      return appointmentText("Bereit", "Готово", "Ready");
    case "submitted":
      return appointmentText("Ubergeben", "Передано", "Submitted");
    case "approved":
      return appointmentText("Freigegeben", "Согласовано", "Approved");
    case "settled":
      return appointmentText("Abgerechnet", "Рассчитано", "Settled");
    case "paid":
      return appointmentText("Bezahlt", "Оплачено", "Paid");
    case "cancelled":
      return appointmentText("Abgebrochen", "Отменено", "Cancelled");
    default:
      return status.charAt(0).toUpperCase() + status.slice(1);
  }
}

function formatMoneyLabel(value: string | null, currency = "EUR") {
  if (!value) return runtimeTranslations().common_not_set;
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return `${value} ${currency}`;
  try {
    return new Intl.NumberFormat(runtimeLocale(), {
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

function buildServiceDraft(
  service: ConciergeServiceEntry,
): ConciergeServiceDraftState {
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
  assignments: PatientAssignment[],
  tr?: Record<string, string>,
): HandoffStakeholder[] {
  const caseBadge = tr?.cases_title ?? "Case assignment";
  const ownerBadge = tr?.patients_assign_owner ?? "Appointment owner";
  const interpreterBadge = tr?.role_interpreter ?? "Interpreter";
  const items = new Map<string, HandoffStakeholder>();
  const activeAssignments = assignments.filter(
    (item) => item.user_active && !item.revoked_at,
  );

  for (const assignment of activeAssignments) {
    items.set(assignment.user_id, {
      id: assignment.user_id,
      name: assignment.user_name,
      role: assignment.user_role,
      badges: [caseBadge],
    });
  }

  if (detail.owner_user_id && detail.owner_name) {
    const existing = items.get(detail.owner_user_id);
    if (existing) {
      existing.badges = Array.from(new Set([...existing.badges, ownerBadge]));
    } else {
      items.set(detail.owner_user_id, {
        id: detail.owner_user_id,
        name: detail.owner_name,
        role: detail.owner_role ?? "",
        badges: [ownerBadge],
      });
    }
  }

  if (detail.interpreter_id && detail.interpreter_name) {
    const existing = items.get(detail.interpreter_id);
    if (existing) {
      existing.badges = Array.from(
        new Set([...existing.badges, interpreterBadge]),
      );
    } else {
      items.set(detail.interpreter_id, {
        id: detail.interpreter_id,
        name: detail.interpreter_name,
        role: "interpreter",
        badges: [interpreterBadge],
      });
    }
  }

  return Array.from(items.values()).sort((left, right) =>
    `${left.role}:${left.name}`.localeCompare(`${right.role}:${right.name}`),
  );
}

function sectionCardClass(extra?: string) {
  return cn(
    "rounded-[1.75rem] border border-border/70 bg-card shadow-[0_20px_60px_rgba(15,23,42,0.05)]",
    extra,
  );
}

function AptKpi({
  icon: Icon,
  tone,
  label,
  value,
}: {
  icon: React.ElementType;
  tone: "sky" | "emerald" | "amber" | "rose" | "neutral";
  label: string;
  value: number | string;
}) {
  const toneColor = {
    sky: "text-sky-600",
    emerald: "text-emerald-600",
    amber: "text-amber-600",
    rose: "text-rose-600",
    neutral: "text-muted-foreground",
  }[tone];
  return (
    <div className="flex items-center gap-3 px-4 py-3 min-w-0">
      <Icon
        strokeWidth={1.6}
        className={cn("size-[22px] shrink-0", toneColor)}
      />
      <div className="min-w-0">
        <p className="text-[22px] font-semibold tracking-tight text-foreground leading-none tabular-nums">
          {value}
        </p>
        <p className="mt-1 text-[11.5px] text-muted-foreground truncate">
          {label}
        </p>
      </div>
    </div>
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

function Field({
  label,
  children,
  compact = false,
}: {
  label: string;
  children: ReactNode;
  compact?: boolean;
}) {
  return (
    <label className={compact ? "flex flex-col gap-1.5" : "block space-y-2"}>
      <span
        className={
          compact
            ? "text-[11.5px] font-medium text-muted-foreground leading-tight"
            : "text-xs font-medium uppercase tracking-[0.12em] text-slate-500"
        }
      >
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
    <div
      className={cn(
        "flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm",
        classes,
      )}
    >
      {tone === "error" ? (
        <AlertCircle className="mt-0.5 size-4 shrink-0" />
      ) : (
        <ShieldAlert className="mt-0.5 size-4 shrink-0" />
      )}
      <div>{children}</div>
    </div>
  );
}

function StaffAppointmentsPage() {
  const { user } = useAuth();
  const { t, lang } = useLang();
  const tr = t as unknown as Record<string, string>;
  const { staffGo } = useStaffNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const permissions = appointmentPermissions(user?.role);
  const isMobile = useIsMobile();
  const calendarRef = useRef<FullCalendar | null>(null);
  const [calendarView, setCalendarView] = useState<CalendarView>(() =>
    readStoredCalendarView(),
  );
  const [calendarDate, setCalendarDate] = useState(() =>
    readStoredCalendarDate(),
  );
  const [filters, setFilters] = useState<FiltersState>(DEFAULT_FILTERS);
  const [operationalScope, setOperationalScope] =
    useState<OperationalScope>("all");
  const deferredSearch = useDeferredValue(filters.search);

  const [appointments, setAppointments] = useState<AppointmentListItem[]>([]);
  const [attentionItems, setAttentionItems] = useState<
    AppointmentAttentionItem[]
  >([]);
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
  const [filtersModalOpen, setFiltersModalOpen] = useState(false);
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [queueModalOpen, setQueueModalOpen] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<AppointmentFormState>(
    blankAppointmentForm(),
  );
  const [createDoctors, setCreateDoctors] = useState<DoctorOption[]>([]);
  const [createConflicts, setCreateConflicts] =
    useState<ConflictSummary | null>(null);
  const [createError, setCreateError] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [followUpVisitForm, setFollowUpVisitForm] =
    useState<FollowUpVisitFormState | null>(null);
  const [followUpVisitDoctors, setFollowUpVisitDoctors] = useState<
    DoctorOption[]
  >([]);
  const [followUpVisitConflicts, setFollowUpVisitConflicts] =
    useState<ConflictSummary | null>(null);
  const [followUpVisitError, setFollowUpVisitError] = useState("");
  const [followUpVisitBusy, setFollowUpVisitBusy] = useState(false);

  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detail, setDetail] = useState<AppointmentDetail | null>(null);
  const [detailAssignments, setDetailAssignments] = useState<
    PatientAssignment[]
  >([]);
  const [detailChecklist, setDetailChecklist] = useState<ChecklistItem[]>([]);
  const [detailReminders, setDetailReminders] = useState<ReminderEntry[]>([]);
  const [detailReport, setDetailReport] = useState<ReportSummary | null>(null);
  const [detailTasks, setDetailTasks] = useState<TaskEntry[]>([]);
  const [detailServices, setDetailServices] = useState<ConciergeServiceEntry[]>(
    [],
  );
  const [detailCommunications, setDetailCommunications] = useState<
    AppointmentCommunicationEntry[]
  >([]);
  const [detailVersion, setDetailVersion] = useState(0);

  const [editForm, setEditForm] = useState<AppointmentFormState | null>(null);
  const [editRecurrenceScope, setEditRecurrenceScope] =
    useState<AppointmentRecurringActionScope>("single");
  const [statusRecurrenceScope, setStatusRecurrenceScope] =
    useState<AppointmentRecurringActionScope>("single");
  const [editDoctors, setEditDoctors] = useState<DoctorOption[]>([]);
  const [editConflicts, setEditConflicts] = useState<ConflictSummary | null>(
    null,
  );
  const [editError, setEditError] = useState("");
  const [editBusy, setEditBusy] = useState(false);

  const [checklistForm, setChecklistForm] =
    useState<ChecklistFormState>(blankChecklistForm());
  const [checklistBusy, setChecklistBusy] = useState(false);
  const [reminderForm, setReminderForm] =
    useState<ReminderFormState>(blankReminderForm());
  const [reminderBusy, setReminderBusy] = useState(false);
  const [doctorFollowUpForm, setDoctorFollowUpForm] =
    useState<DoctorFollowUpFormState>(blankDoctorFollowUpForm());
  const [doctorFollowUpBusy, setDoctorFollowUpBusy] = useState(false);
  const [packageEndFollowUpForm, setPackageEndFollowUpForm] =
    useState<PackageEndFollowUpFormState>(blankPackageEndFollowUpForm());
  const [packageEndFollowUpBusy, setPackageEndFollowUpBusy] = useState(false);
  const [externalHandoffForm, setExternalHandoffForm] =
    useState<ExternalHandoffFormState>(blankExternalHandoffForm());
  const [externalHandoffBusy, setExternalHandoffBusy] = useState(false);
  const [billingHandoffForm, setBillingHandoffForm] =
    useState<BillingHandoffFormState>(blankBillingHandoffForm());
  const [billingHandoffBusy, setBillingHandoffBusy] = useState(false);
  const [findingsFollowUpForm, setFindingsFollowUpForm] =
    useState<FindingsFollowUpFormState>(blankFindingsFollowUpForm());
  const [findingsFollowUpBusy, setFindingsFollowUpBusy] = useState(false);
  const [incomingDataForm, setIncomingDataForm] =
    useState<IncomingDataFormState>(blankIncomingDataForm());
  const [incomingDataBusy, setIncomingDataBusy] = useState(false);
  const [reportForm, setReportForm] =
    useState<ReportFormState>(blankReportForm());
  const [taskForm, setTaskForm] = useState<TaskFormState>(blankTaskForm());
  const [taskBusy, setTaskBusy] = useState(false);
  const [serviceForm, setServiceForm] = useState<ConciergeServiceFormState>(
    blankConciergeServiceForm(),
  );
  const [serviceDrafts, setServiceDrafts] = useState<
    Record<string, ConciergeServiceDraftState>
  >({});
  const [serviceBusy, setServiceBusy] = useState(false);
  const [followUpAssigneeId, setFollowUpAssigneeId] = useState("");
  const [followUpBusy, setFollowUpBusy] = useState(false);
  const [completionPlan, setCompletionPlan] = useState<Record<string, boolean>>(
    defaultCompletionPlan,
  );
  const [completionBusy, setCompletionBusy] = useState(false);
  const [reportRejectReason, setReportRejectReason] = useState("");
  const [timelineFilter, setTimelineFilter] = useState<
    "all" | AppointmentTimelineKind
  >("all");
  const [actionBusy, setActionBusy] = useState("");
  const [calendarQuickActionMenu, setCalendarQuickActionMenu] =
    useState<CalendarQuickActionMenuState | null>(null);
  const [calendarQuickActionScope, setCalendarQuickActionScope] =
    useState<AppointmentRecurringActionScope>("single");
  const calendarQuickActionMenuRef = useRef<HTMLDivElement | null>(null);

  const todayDate = currentDateInput();
  const weekStart = startOfWeekInput(todayDate);
  const weekEnd = endOfWeekInput(todayDate);
  const attentionIndex = new Map(attentionItems.map((item) => [item.id, item]));
  const attentionIds = new Set(attentionItems.map((item) => item.id));
  const mineFilterActive = user
    ? user.role === "interpreter"
      ? filters.interpreterId === user.id
      : filters.ownerUserId === user.id
    : false;
  const schedulerQuickScopeValue: SchedulerQuickScope =
    filters.dateFrom === todayDate && filters.dateTo === todayDate
      ? "today"
      : filters.dateFrom === weekStart && filters.dateTo === weekEnd
        ? "week"
        : mineFilterActive
          ? "mine"
          : filters.appointmentType === "medical"
            ? "medical"
            : filters.appointmentType === "non_medical"
              ? "non_medical"
              : filters.appointmentType === "internal"
                ? "internal"
                : "all";
  const createLocalWarnings = buildLocalScheduleWarnings(
    appointments,
    {
      date: createForm.date,
      timeStart: createForm.timeStart,
      timeEnd: createForm.timeEnd,
      ownerUserId: createForm.ownerUserId || user?.id || null,
      providerId: createForm.providerId || null,
      doctorId: createForm.doctorId || null,
    },
    tr,
  );
  const editLocalWarnings =
    detail && editForm
      ? buildLocalScheduleWarnings(
          appointments,
          {
            appointmentId: detail.id,
            date: editForm.date,
            timeStart: editForm.timeStart,
            timeEnd: editForm.timeEnd,
            ownerUserId: editForm.ownerUserId || detail.owner_user_id,
            providerId: editForm.providerId || null,
            doctorId: editForm.doctorId || null,
          },
          tr,
        )
      : [];
  const followUpVisitLocalWarnings =
    detail && followUpVisitForm
      ? buildLocalScheduleWarnings(
          appointments,
          {
            date: followUpVisitForm.date,
            timeStart: followUpVisitForm.timeStart,
            timeEnd: followUpVisitForm.timeEnd,
            ownerUserId: followUpVisitForm.ownerUserId || detail.owner_user_id,
            providerId: followUpVisitForm.providerId || null,
            doctorId: followUpVisitForm.doctorId || null,
          },
          tr,
        )
      : [];
  const taskAssignableStaff = staff.filter((member) =>
    [
      "patient_manager",
      "teamlead_interpreter",
      "interpreter",
      "concierge",
    ].includes(member.role),
  );
  const billingStaff = staff.filter((member) => member.role === "billing");
  const conciergeStaff = staff.filter((member) => member.role === "concierge");
  const nonMedicalProviders = providers.filter(
    (provider) => provider.provider_type === "non_medical",
  );
  const canShowConciergeSection =
    permissions.canViewConciergeServices && detail?.type === "non_medical";
  const scopeOptions = operationalScopeOptions(user?.role, tr);
  const selectedOperationalScopeLabel =
    scopeOptions.find((option) => option.id === operationalScope)?.label ??
    t.providers_all;
  const schedulerQuickScopeOptions: Array<{
    id: SchedulerQuickScope;
    label: string;
  }> = [
    {
      id: "all",
      label: t.providers_all,
    },
    {
      id: "today",
      label:
        tr.appointments_today ??
        appointmentText("Heute", "Сегодня", "Today"),
    },
    {
      id: "week",
      label:
        tr.dash_this_week ??
        appointmentText("Diese Woche", "Эта неделя", "This week"),
    },
    ...(user?.id
      ? [
          {
            id: "mine" as const,
            label: appointmentText("Bei mir", "Мои", "Mine"),
          },
        ]
      : []),
    {
      id: "medical",
      label: appointmentTypeLabel("medical", tr),
    },
    {
      id: "non_medical",
      label: appointmentTypeLabel("non_medical", tr),
    },
    {
      id: "internal",
      label: appointmentTypeLabel("internal", tr),
    },
  ];
  const selectedSchedulerQuickScopeLabel =
    schedulerQuickScopeOptions.find(
      (option) => option.id === schedulerQuickScopeValue,
    )?.label ?? t.providers_all;
  const selectedCreatePatientLabel = createForm.patientId
    ? (() => {
        const patient = patients.find((item) => item.id === createForm.patientId);
        return patient ? `${patient.patient_id} · ${patientName(patient)}` : t.orders_patient;
      })()
    : t.orders_patient;
  const selectedCreateProviderLabel = createForm.providerId
    ? (() => {
        const provider = providers.find((item) => item.id === createForm.providerId);
        return provider ? providerLabel(provider) : t.common_not_set;
      })()
    : t.common_not_set;
  const selectedCreateDoctorLabel = createForm.doctorId
    ? (() => {
        const doctor = createDoctors.find((item) => item.id === createForm.doctorId);
        return doctor ? doctorLabel(doctor) : t.common_not_set;
      })()
    : t.common_not_set;
  const selectedCreateOwnerLabel = createForm.ownerUserId
    ? (() => {
        const owner = staff.find((item) => item.id === createForm.ownerUserId);
        return owner ? staffLabel(owner) : t.common_not_set;
      })()
    : t.common_not_set;
  const selectedCreateInterpreterLabel = createForm.interpreterId
    ? (() => {
        const interpreter = interpreters.find(
          (item) => item.id === createForm.interpreterId,
        );
        return interpreter ? staffLabel(interpreter) : t.common_not_set;
      })()
    : t.common_not_set;
  const handoffStakeholders =
    detail && !detail.is_blocked
      ? buildHandoffStakeholders(detail, detailAssignments, tr)
      : [];
  const openChecklistCount = detailChecklist.filter(
    (item) => !item.is_completed,
  ).length;
  const openTaskCount = detailTasks.filter(
    (item) => !["completed", "cancelled"].includes(item.status),
  ).length;
  const pendingReminderCount = detailReminders.filter(
    (item) => !item.is_completed,
  ).length;
  const selectedCompletionPresetCount = FOLLOW_UP_PRESETS.filter(
    (preset) => completionPlan[preset.id],
  ).length;
  const doctorDirectedReminders = detailReminders.filter((item) =>
    item.title.startsWith(DOCTOR_FOLLOW_UP_PREFIX),
  );
  const doctorDirectedTasks = detailTasks.filter((item) =>
    item.title.startsWith(DOCTOR_FOLLOW_UP_PREFIX),
  );
  const packageEndReminders = detailReminders.filter((item) =>
    item.title.startsWith(PACKAGE_END_FOLLOW_UP_PREFIX),
  );
  const packageEndTasks = detailTasks.filter((item) =>
    item.title.startsWith(PACKAGE_END_FOLLOW_UP_PREFIX),
  );
  const externalCommunicationEntries = detailCommunications.filter((item) =>
    ["clinic", "doctor", "service_provider"].includes(item.target_type),
  );
  const externalHandoffReminders = detailReminders.filter((item) =>
    item.title.startsWith(EXTERNAL_HANDOFF_PREFIX),
  );
  const externalHandoffTasks = detailTasks.filter((item) =>
    item.title.startsWith(EXTERNAL_HANDOFF_PREFIX),
  );
  const billingHandoffReminders = detailReminders.filter((item) =>
    item.title.startsWith(BILLING_HANDOFF_PREFIX),
  );
  const billingHandoffTasks = detailTasks.filter((item) =>
    item.title.startsWith(BILLING_HANDOFF_PREFIX),
  );
  const canShowBillingHandoffSection =
    permissions.canManageConciergeBilling ||
    billingHandoffTasks.length > 0 ||
    billingHandoffReminders.length > 0;
  const findingsChecklist = detailChecklist.filter((item) =>
    item.item_text.startsWith(FINDINGS_CHECKLIST_PREFIX),
  );
  const findingsReminders = detailReminders.filter((item) =>
    item.title.startsWith(FINDINGS_FOLLOW_UP_PREFIX),
  );
  const findingsTasks = detailTasks.filter((item) =>
    item.title.startsWith(FINDINGS_FOLLOW_UP_PREFIX),
  );
  const incomingDataChecklist = detailChecklist.filter((item) =>
    item.item_text.startsWith(INCOMING_DATA_CHECKLIST_PREFIX),
  );
  const incomingDataReminders = detailReminders.filter((item) =>
    item.title.startsWith(INCOMING_DATA_PREFIX),
  );
  const incomingDataTasks = detailTasks.filter((item) =>
    item.title.startsWith(INCOMING_DATA_PREFIX),
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
      ]),
    ).values(),
  ).sort((left, right) =>
    `${left.role}:${left.name}`.localeCompare(`${right.role}:${right.name}`),
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
    (!detailReport || canResubmitRejectedReport),
  );
  const serviceInFlightCount = detailServices.filter(
    (item) => !["completed", "cancelled"].includes(item.status),
  ).length;
  const readyConciergeServices = detailServices.filter(
    (item) => item.billing_status === "ready",
  );
  const settledConciergeServices = detailServices.filter((item) =>
    ["billed", "settled"].includes(item.billing_status),
  );
  const openBillingHandoffTasks = billingHandoffTasks.filter(
    (item) => !["completed", "cancelled"].includes(item.status),
  );
  const billingReadinessWarnings = [
    detail?.interpreter_id && !interpreterReportReady ? tr.common_error : "",
    detail?.type === "non_medical" && serviceInFlightCount > 0
      ? `${serviceInFlightCount} concierge service(s) are still operationally open.`
      : "",
    detail?.type === "non_medical" &&
    detailServices.length > 0 &&
    readyConciergeServices.length === 0 &&
    settledConciergeServices.length === 0
      ? tr.common_not_set
      : "",
    billingStaff.length === 0 ? tr.common_not_set : "",
  ].filter(Boolean);
  const showReportReviewActions = Boolean(
    (permissions.canApproveReport || permissions.canRejectReport) &&
    detailReport &&
    detailReport.approval_status === "pending",
  );
  const reportReviewMeta = !detailReport
    ? ""
    : detailReport.approval_status === "approved"
      ? `Approved ${formatDateTimeLabel(detailReport.approved_at)}`
      : detailReport.approval_status === "rejected"
        ? `Returned ${formatDateTimeLabel(detailReport.approved_at)}`
        : tr.mfa_pending;
  const openFindingsChecklistCount = findingsChecklist.filter(
    (item) => !item.is_completed,
  ).length;
  const openIncomingDataChecklistCount = incomingDataChecklist.filter(
    (item) => !item.is_completed,
  ).length;
  const completionWarnings = [
    openChecklistCount > 0
      ? `${openChecklistCount} checklist item(s) still open.`
      : "",
    openIncomingDataChecklistCount > 0
      ? `${openIncomingDataChecklistCount} incoming data item(s) still need triage.`
      : "",
    openTaskCount > 0 ? `${openTaskCount} operational task(s) still open.` : "",
    !interpreterReportReady && detail?.interpreter_id ? tr.common_error : "",
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
    communications: detailCommunications,
    labels: {
      appointments_timeline_appointment_created:
        t.appointments_timeline_appointment_created,
      appointments_timeline_scheduled_slot:
        t.appointments_timeline_scheduled_slot,
      appointments_timeline_interpreter_pending:
        t.appointments_timeline_interpreter_pending,
      appointments_timeline_interpreter_assigned:
        t.appointments_timeline_interpreter_assigned,
      appointments_timeline_interpreter_accepted:
        t.appointments_timeline_interpreter_accepted,
      appointments_timeline_interpreter_declined:
        t.appointments_timeline_interpreter_declined,
      appointments_timeline_interpreter_discussion:
        t.appointments_timeline_interpreter_discussion,
      appointments_timeline_checklist_completed:
        t.appointments_timeline_checklist_completed,
      appointments_timeline_checklist_pending:
        t.appointments_timeline_checklist_pending,
      appointments_timeline_external_response_logged:
        t.appointments_timeline_external_response_logged,
      appointments_timeline_external_communication_cancelled:
        t.appointments_timeline_external_communication_cancelled,
      appointments_timeline_external_communication_closed:
        t.appointments_timeline_external_communication_closed,
      appointments_timeline_interpreter_report_submitted:
        t.appointments_timeline_interpreter_report_submitted,
      appointments_timeline_interpreter_report_approved:
        t.appointments_timeline_interpreter_report_approved,
      appointments_timeline_interpreter_report_rejected:
        t.appointments_timeline_interpreter_report_rejected,
    },
  });
  const visibleTimelineEvents =
    timelineFilter === "all"
      ? timelineEvents
      : timelineEvents.filter((item) => item.kind === timelineFilter);
  const detailAttention = detail
    ? (attentionIndex.get(detail.id) ?? null)
    : null;
  const activeCalendarQuickActionItem = calendarQuickActionMenu
    ? (appointments.find(
        (item) => item.id === calendarQuickActionMenu.appointmentId,
      ) ?? null)
    : null;
  const detailLineageText = detail ? recurrenceLineageText(detail, t) : "";
  const detailLineageBadge = detail ? recurrenceLineageBadge(detail, t) : "";
  const detailCurrentLineageHistory = detail
    ? currentRecurringLineageHistory(detail)
    : null;
  const detailRelatedLineageCount = detail
    ? Math.max(0, detail.recurring_lineage_history.length - 1)
    : 0;
  const activeCalendarQuickActionScope =
    activeCalendarQuickActionItem?.recurrence_frequency
      ? calendarQuickActionScope
      : "single";
  const selectedRecurringStatusTargets =
    detail && detail.recurrence_frequency
      ? recurringStatusTargetsForScope(detail, statusRecurrenceScope)
      : detail
        ? [
            {
              id: detail.id,
              date: detail.date,
              status: detail.status,
              recurrence_index: detail.recurrence_index,
              open_checklist_count: openChecklistCount,
            },
          ]
        : [];
  const completionScopeBlockers = selectedRecurringStatusTargets.filter(
    (item) =>
      !["completed", "cancelled"].includes(item.status) &&
      item.open_checklist_count > 0,
  );

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
    if (!calendarQuickActionMenu) return;
    function handlePointerDown(event: PointerEvent) {
      if (
        calendarQuickActionMenuRef.current &&
        event.target instanceof Node &&
        calendarQuickActionMenuRef.current.contains(event.target)
      ) {
        return;
      }
      setCalendarQuickActionMenu(null);
    }
    function dismissMenu() {
      setCalendarQuickActionMenu(null);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setCalendarQuickActionMenu(null);
      }
    }
    calendarQuickActionMenuRef.current?.focus();
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("resize", dismissMenu);
    window.addEventListener("scroll", dismissMenu, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("resize", dismissMenu);
      window.removeEventListener("scroll", dismissMenu, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [calendarQuickActionMenu]);

  useEffect(() => {
    setCalendarQuickActionMenu(null);
  }, [calendarView, calendarDate, appointmentsVersion, detailOpen]);

  useEffect(() => {
    setCalendarQuickActionScope("single");
  }, [calendarQuickActionMenu?.appointmentId]);

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

    if (appointmentParam && appointmentParam !== selectedId) {
      setSelectedId(appointmentParam);
      setDetailOpen(true);
    }

    if (createParam && permissions.canCreate) {
      const next = blankAppointmentForm();
      next.patientId = patientParam;
      setCreateError("");
      setCreateConflicts(null);
      setCreateForm(next);
      setCreateOpen(true);
      const params = new URLSearchParams(searchParams);
      params.delete("create");
      setSearchParams(params, { replace: true });
    }
  }, [permissions.canCreate, searchParams, selectedId, setSearchParams]);

  useEffect(() => {
    setAppointmentsNotice("");
  }, [filters]);

  useEffect(() => {
    let active = true;
    async function loadMetadata() {
      setMetadataLoading(true);
      setMetadataError("");
      const [patientRows, providerRows, interpreterRows, staffRows] =
        await Promise.all([
          apiFetch<PatientSummary[]>("/patients").catch(() => []),
          apiFetch<ProviderSummary[]>("/providers").catch(() => []),
          apiFetch<InterpreterOption[]>(
            "/appointments/meta/interpreters",
          ).catch(() => []),
          apiFetch<StaffOption[]>("/appointments/meta/staff").catch(() => []),
        ]);
      if (!active) return;
      setPatients(patientRows);
      setProviders(providerRows);
      setInterpreters(interpreterRows);
      setStaff(staffRows);
      if (
        patientRows.length === 0 &&
        interpreterRows.length === 0 &&
        staffRows.length === 0
      ) {
        setMetadataError(tr.common_failed_load);
      }
      setMetadataLoading(false);
    }
    void loadMetadata();
    return () => {
      active = false;
    };
  }, [tr.common_failed_load]);

  useEffect(() => {
    let active = true;
    async function loadAppointments() {
      setAppointmentsLoading(true);
      setAppointmentsError("");
      try {
        const query = buildAppointmentsQuery({
          ...filters,
          search: deferredSearch,
        });
        const attentionQuery = query.includes("?")
          ? query.replace("/appointments?", "/appointments/meta/attention?")
          : `${query}/meta/attention`;
        const [rows, attention] = await Promise.all([
          apiFetch<AppointmentListItem[]>(query),
          apiFetch<AppointmentAttentionItem[]>(attentionQuery),
        ]);
        if (!active) return;
        setAppointments(rows);
        setAttentionItems(attention);
      } catch (error) {
        if (!active) return;
        setAppointments([]);
        setAttentionItems([]);
        setAppointmentsError(
          error instanceof Error ? error.message : tr.common_failed_load,
        );
      } finally {
        if (active) setAppointmentsLoading(false);
      }
    }
    void loadAppointments();
    return () => {
      active = false;
    };
  }, [deferredSearch, filters, appointmentsVersion, tr.common_failed_load]);

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
        current.doctorId ? { ...current, doctorId: "" } : current,
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
    apiFetch<DoctorOption[]>(
      `/providers/${followUpVisitForm.providerId}/doctors`,
    )
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
    if (
      !createOpen ||
      !permissions.canCreate ||
      !createForm.patientId ||
      !createForm.date
    ) {
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
        createForm.interpreterId,
      ),
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
        editForm.interpreterId,
      ),
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
        followUpVisitForm.interpreterId,
      ),
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
        const [
          appointmentDetail,
          checklist,
          reminders,
          report,
          tasks,
          services,
          communications,
        ] = await Promise.all([
          apiFetch<AppointmentDetail>(`/appointments/${selectedId}`),
          permissions.canManageChecklist
            ? apiFetch<ChecklistItem[]>(`/appointments/${selectedId}/checklist`)
            : Promise.resolve([]),
          permissions.canViewReminders
            ? apiFetch<ReminderEntry[]>(`/appointments/${selectedId}/reminders`)
            : Promise.resolve([]),
          permissions.canViewReport
            ? apiFetch<ReportSummary | null>(
                `/appointments/${selectedId}/report`,
              )
            : Promise.resolve(null),
          permissions.canViewTasks
            ? apiFetch<TaskEntry[]>(
                `/tasks?appointment_id=${selectedId}`,
              ).catch(() => [])
            : Promise.resolve([]),
          permissions.canViewConciergeServices
            ? apiFetch<ConciergeServiceEntry[]>(
                `/concierge-services?appointment_id=${selectedId}`,
              ).catch(() => [])
            : Promise.resolve([]),
          permissions.canViewCommunications
            ? apiFetch<AppointmentCommunicationEntry[]>(
                `/appointments/${selectedId}/communications`,
              ).catch(() => [])
            : Promise.resolve([]),
        ]);
        const assignments =
          appointmentDetail.is_blocked || !permissions.canViewNotes
            ? []
            : await apiFetch<PatientAssignment[]>(
                `/patients/${appointmentDetail.patient_id}/assignments`,
              ).catch(() => []);
        if (!active) return;
        const assignableStaff = staff.filter((member) =>
          [
            "patient_manager",
            "teamlead_interpreter",
            "interpreter",
            "concierge",
          ].includes(member.role),
        );
        const billingOptions = staff.filter(
          (member) => member.role === "billing",
        );
        const conciergeOptions = staff.filter(
          (member) => member.role === "concierge",
        );
        const nonMedicalOptions = providers.filter(
          (provider) => provider.provider_type === "non_medical",
        );
        setDetail(appointmentDetail);
        setDetailAssignments(assignments);
        setDetailChecklist(checklist);
        setDetailReminders(reminders);
        setDetailReport(report);
        setDetailTasks(tasks);
        setDetailServices(services);
        setDetailCommunications(communications);
        setChecklistForm(blankChecklistForm());
        setReminderForm(blankReminderForm());
        setReportForm(
          report && report.approval_status === "rejected"
            ? {
                hours: report.hours,
                reportText: report.report_text ?? "",
              }
            : blankReportForm(),
        );
        setReportRejectReason(
          report?.approval_status === "rejected" ? (report.notes ?? "") : "",
        );
        setTimelineFilter("all");
        setTaskForm(
          blankTaskForm(
            appointmentDetail.interpreter_id ??
              appointmentDetail.owner_user_id ??
              assignableStaff[0]?.id ??
              "",
            buildTaskDefaultDueDate(appointmentDetail),
          ),
        );
        const followUpDefaultAssignee =
          assignments.find(
            (item) =>
              !item.revoked_at &&
              item.user_active &&
              item.user_role === "patient_manager",
          )?.user_id ??
          appointmentDetail.owner_user_id ??
          assignments.find((item) => !item.revoked_at && item.user_active)
            ?.user_id ??
          "";
        setFollowUpAssigneeId(followUpDefaultAssignee);
        setFollowUpVisitForm(
          buildFollowUpVisitForm(
            appointmentDetail,
            followUpDefaultAssignee,
            tr.phase_followup,
          ),
        );
        setFollowUpVisitError("");
        setDoctorFollowUpForm(
          blankDoctorFollowUpForm(
            followUpDefaultAssignee,
            shiftLocalDateTime(appointmentAnchorDateTime(appointmentDetail), {
              days: 7,
            }),
          ),
        );
        setPackageEndFollowUpForm(
          blankPackageEndFollowUpForm(
            followUpDefaultAssignee,
            tr.appointments_new ?? "",
          ),
        );
        setExternalHandoffForm(
          blankExternalHandoffForm(
            followUpDefaultAssignee,
            shiftLocalDateTime(appointmentAnchorDateTime(appointmentDetail), {
              days: 1,
            }),
            appointmentDetail.doctor_id
              ? "doctor"
              : appointmentDetail.type === "non_medical"
                ? "service_provider"
                : "clinic",
          ),
        );
        setBillingHandoffForm(
          blankBillingHandoffForm(
            billingOptions[0]?.id ?? "",
            shiftLocalDateTime(appointmentAnchorDateTime(appointmentDetail), {
              days: 1,
            }),
            appointmentDetail.type === "non_medical"
              ? "concierge_settlement"
              : appointmentDetail.interpreter_id
                ? "interpreter_hours"
                : "patient_invoice",
          ),
        );
        setFindingsFollowUpForm(
          blankFindingsFollowUpForm(
            followUpDefaultAssignee,
            shiftLocalDateTime(appointmentAnchorDateTime(appointmentDetail), {
              days: 3,
            }),
            appointmentDetail.doctor_id ? "arztbrief" : "written_findings",
          ),
        );
        setIncomingDataForm(
          blankIncomingDataForm(
            followUpDefaultAssignee,
            shiftLocalDateTime(appointmentAnchorDateTime(appointmentDetail), {
              days: 2,
            }),
            appointmentDetail.interpreter_id ? "interpreter" : "doctor",
          ),
        );
        setCompletionPlan(defaultCompletionPlan());
        setServiceForm(
          blankConciergeServiceForm({
            providerId:
              appointmentDetail.provider_id &&
              nonMedicalOptions.some(
                (provider) => provider.id === appointmentDetail.provider_id,
              )
                ? appointmentDetail.provider_id
                : "",
            assignedConciergeId:
              appointmentDetail.owner_role === "concierge"
                ? (appointmentDetail.owner_user_id ?? "")
                : (conciergeOptions[0]?.id ?? ""),
            serviceKind: appointmentDetail.category
              ?.toLowerCase()
              .includes("transfer")
              ? "transfer"
              : "other",
            title: appointmentDetail.title,
            startsAt: appointmentDetail.time_start
              ? `${appointmentDetail.date}T${appointmentDetail.time_start.slice(0, 5)}`
              : "",
            endsAt: appointmentDetail.time_end
              ? `${appointmentDetail.date}T${appointmentDetail.time_end.slice(0, 5)}`
              : "",
            currency: "EUR",
          }),
        );
        setServiceDrafts(
          Object.fromEntries(
            services.map((service) => [service.id, buildServiceDraft(service)]),
          ),
        );
        setReportRejectReason("");
        setEditError("");
        setEditRecurrenceScope("single");
        setStatusRecurrenceScope("single");
        setEditForm({
          patientId: appointmentDetail.patient_id,
          providerId: appointmentDetail.provider_id ?? "",
          doctorId: appointmentDetail.doctor_id ?? "",
          ownerUserId: appointmentDetail.owner_user_id ?? "",
          interpreterId: appointmentDetail.interpreter_id ?? "",
          appointmentType: appointmentDetail.type,
          carePathKind: appointmentDetail.care_path_kind ?? "regular",
          title: appointmentDetail.title,
          date: appointmentDetail.date,
          timeStart: appointmentDetail.time_start ?? "",
          timeEnd: appointmentDetail.time_end ?? "",
          location: appointmentDetail.location ?? "",
          category: appointmentDetail.category ?? "",
          notes: appointmentDetail.notes ?? "",
          repeatEnabled: Boolean(appointmentDetail.recurrence_frequency),
          repeatFrequency: appointmentDetail.recurrence_frequency ?? "weekly",
          repeatInterval: String(appointmentDetail.recurrence_interval ?? 1),
          repeatCount: appointmentDetail.recurrence_count
            ? String(appointmentDetail.recurrence_count)
            : "",
          repeatUntil: appointmentDetail.recurrence_until ?? "",
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
        setDetailCommunications([]);
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
        setDetailError(
          error instanceof Error ? error.message : "Failed to load appointment",
        );
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
    permissions.canViewCommunications,
    staff,
    providers,
    tr.appointments_new,
    tr.phase_followup,
  ]);

  const scopedAppointments = appointments.filter((item) =>
    matchesOperationalScope(
      item,
      operationalScope,
      user?.id,
      user?.role,
      attentionIds,
    ),
  );
  const attentionCount = attentionItems.length;
  const todayAppointments = scopedAppointments.filter(
    (item) => item.date === todayDate,
  ).length;
  const activeAppointments = scopedAppointments.filter((item) =>
    ["planned", "confirmed", "in_progress"].includes(item.status),
  ).length;
  const pendingInterpreterResponses = scopedAppointments.filter(
    (item) => item.interpreter_response === "pending",
  ).length;
  const queueAppointments = scopedAppointments
    .filter((item) =>
      operationalScope === "all" ? item.status !== "cancelled" : true,
    )
    .slice()
    .sort((left, right) =>
      `${left.date}${left.time_start ?? ""}`.localeCompare(
        `${right.date}${right.time_start ?? ""}`,
      ),
    )
    .slice(0, 10);
  const useInterpreterMobileAgenda = shouldUseInterpreterMobileAgenda(
    user?.role,
    isMobile,
  );
  const mobileAgendaSections = useInterpreterMobileAgenda
    ? buildInterpreterMobileAgendaSections(
        scopedAppointments,
        todayDate,
        t.appointments_today,
      ).slice(0, 8)
    : [];
  const mobileAgendaPendingCount = scopedAppointments.filter(
    (item) =>
      item.status !== "cancelled" && item.interpreter_response === "pending",
  ).length;
  const mobileAgendaWeekCount = scopedAppointments.filter(
    (item) =>
      item.status !== "cancelled" &&
      item.date >= weekStart &&
      item.date <= weekEnd,
  ).length;

  function refreshAppointments() {
    startTransition(() => setAppointmentsVersion((current) => current + 1));
  }

  function refreshDetail() {
    startTransition(() => {
      setDetailVersion((current) => current + 1);
      setAppointmentsVersion((current) => current + 1);
    });
  }

  function statusActionKey(
    appointmentId: string,
    status: AppointmentStatus,
    recurrenceScope: AppointmentRecurringActionScope = "single",
  ) {
    return recurrenceScope === "single"
      ? `status:${appointmentId}:${status}`
      : `status:${appointmentId}:${status}:${recurrenceScope}`;
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
      setFilters((current) => ({
        ...current,
        dateFrom: todayDate,
        dateTo: todayDate,
      }));
    });
    syncCalendar("timeGridDay", todayDate);
  }

  function applyWeekScope() {
    startTransition(() => {
      setFilters((current) => ({
        ...current,
        dateFrom: weekStart,
        dateTo: weekEnd,
      }));
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

  function applyOperationalScope(scope: OperationalScope) {
    setOperationalScope(scope);
  }

  function applySchedulerQuickScope(scope: SchedulerQuickScope) {
    if (scope === "today") {
      startTransition(() => {
        setFilters((current) => ({
          ...current,
          dateFrom: todayDate,
          dateTo: todayDate,
          ownerUserId: "",
          interpreterId: "",
          appointmentType: "",
        }));
      });
      syncCalendar("timeGridDay", todayDate);
      return;
    }
    if (scope === "week") {
      startTransition(() => {
        setFilters((current) => ({
          ...current,
          dateFrom: weekStart,
          dateTo: weekEnd,
          ownerUserId: "",
          interpreterId: "",
          appointmentType: "",
        }));
      });
      syncCalendar("timeGridWeek", weekStart);
      return;
    }
    if (scope === "mine") {
      const currentUser = user;
      if (!currentUser?.id) return;
      setOperationalScope("all");
      startTransition(() => {
        setFilters((current) => ({
          ...current,
          dateFrom: "",
          dateTo: "",
          appointmentType: "",
          ownerUserId: currentUser.role === "interpreter" ? "" : currentUser.id,
          interpreterId: currentUser.role === "interpreter" ? currentUser.id : "",
        }));
      });
      return;
    }
    if (
      scope === "medical" ||
      scope === "non_medical" ||
      scope === "internal"
    ) {
      setOperationalScope("all");
      startTransition(() => {
        setFilters((current) => ({
          ...current,
          dateFrom: "",
          dateTo: "",
          ownerUserId: "",
          interpreterId: "",
          appointmentType: scope,
        }));
      });
      return;
    }
    startTransition(() => {
      setFilters((current) => ({
        ...current,
        dateFrom: "",
        dateTo: "",
        ownerUserId: "",
        interpreterId: "",
        appointmentType: "",
      }));
    });
  }

  function resetQuickScopes() {
    setOperationalScope("all");
    startTransition(() => setFilters(DEFAULT_FILTERS));
    syncCalendar("timeGridWeek", todayDate);
    syncQuery({
      patient: null,
      provider: null,
      doctor: null,
      appointment: null,
    });
  }

  function openCreateSheetFromDate(info?: DateClickArg) {
    if (!permissions.canCreate) return;
    const next = blankAppointmentForm();
    if (info) {
      next.date = toDateInput(info.date);
      if (!info.allDay) {
        next.timeStart = toTimeInput(info.date);
        next.timeEnd = toTimeInput(
          new Date(info.date.getTime() + 60 * 60 * 1000),
        );
      }
    }
    setCreateError("");
    setCreateConflicts(null);
    setCreateForm(next);
    setCreateOpen(true);
  }

  useEffect(() => {
    const handleRefreshRequest = () => {
      refreshAppointments();
    };
    const handleCreateRequest = () => {
      openCreateSheetFromDate();
    };

    window.addEventListener(
      "appointments:refresh-request",
      handleRefreshRequest as EventListener,
    );
    window.addEventListener(
      "appointments:create-request",
      handleCreateRequest as EventListener,
    );

    return () => {
      window.removeEventListener(
        "appointments:refresh-request",
        handleRefreshRequest as EventListener,
      );
      window.removeEventListener(
        "appointments:create-request",
        handleCreateRequest as EventListener,
      );
    };
  }, [permissions.canCreate]);

  function openDetailSheet(id: string) {
    setCalendarQuickActionMenu(null);
    startTransition(() => {
      setSelectedId(id);
      setDetailOpen(true);
    });
    syncQuery({ appointment: id });
  }

  function openCalendarQuickActionLayer(
    event: ReactMouseEvent<HTMLButtonElement>,
    appointmentId: string,
  ) {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const menuWidth = 220;
    setCalendarQuickActionMenu((current) =>
      current?.appointmentId === appointmentId
        ? null
        : {
            appointmentId,
            top: Math.min(rect.bottom + 8, window.innerHeight - 16),
            left: Math.min(
              Math.max(16, rect.right - menuWidth),
              Math.max(16, window.innerWidth - menuWidth - 16),
            ),
          },
    );
  }

  function handleEventClick(info: EventClickArg) {
    openDetailSheet(info.event.id);
  }

  function handleCalendarDateClick(info: DateClickArg) {
    openCreateSheetFromDate(info);
  }

  function renderCalendarEventContent(arg: EventContentArg) {
    const props = arg.event.extendedProps as CalendarEventExtendedProps;
    const secondaryLine =
      props.doctorName ||
      props.providerName ||
      props.location ||
      props.ownerName ||
      "Appointment";
    const isListView = arg.view.type.startsWith("list");
    const canQuickManage =
      isListView &&
      permissions.canManageStatus &&
      !props.isBlocked &&
      props.appointmentStatus !== "completed" &&
      props.appointmentStatus !== "cancelled";
    const canGridQuickManage =
      !isListView &&
      permissions.canManageStatus &&
      !props.isBlocked &&
      props.appointmentStatus !== "completed" &&
      props.appointmentStatus !== "cancelled";
    return (
      <div
        className={cn(
          "fc-apt-event-card relative",
          isListView && "fc-apt-event-card-list",
        )}
      >
        {canGridQuickManage ? (
          <button
            type="button"
            aria-label={appointmentText(
              "Schnellaktionen fur Termin offnen",
              "Открыть быстрые действия по приёму",
              "Open quick appointment actions",
            )}
            aria-haspopup="menu"
            aria-expanded={
              calendarQuickActionMenu?.appointmentId === arg.event.id
            }
            aria-controls={`appointment-quick-actions-${arg.event.id}`}
            className="absolute top-1 right-1 inline-flex size-6 items-center justify-center rounded-full border border-slate-300/80 bg-white/90 text-slate-600 shadow-sm transition hover:bg-white hover:text-slate-950"
            onClick={(event) =>
              openCalendarQuickActionLayer(event, arg.event.id)
            }
          >
            <MoreHorizontal className="size-3.5" />
          </button>
        ) : null}
        <div className="fc-apt-event-head">
          <span className="fc-apt-event-tag">
            {props.isBlocked
              ? appointmentText("Blockiert", "Заблокировано", "Blocked")
              : props.appointmentStatus === "completed"
                ? statusLabel("completed")
                : props.appointmentStatus === "cancelled"
                  ? statusLabel("cancelled")
                  : appointmentTypeLabel(props.appointmentType, tr)}
          </span>
          {arg.timeText ? (
            <span className="fc-apt-event-time">{arg.timeText}</span>
          ) : null}
        </div>
        <div className="fc-apt-event-title">{arg.event.title}</div>
        <div className="fc-apt-event-meta">{props.patientName}</div>
        <div className="fc-apt-event-submeta">{secondaryLine}</div>
        {props.isBlocked ? (
          <div className="fc-apt-event-note">
            {appointmentText("Blockierte Sicht", "Заблокированная видимость", "Blocked visibility")}
          </div>
        ) : props.interpreterName ? (
          <div className="fc-apt-event-note">
            Interpreter: {props.interpreterName}
          </div>
        ) : null}
        {canQuickManage ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {props.appointmentStatus !== "confirmed" ? (
              <button
                type="button"
                className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-700"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void performStatusChange(arg.event.id, "confirmed");
                }}
              >
                {t.common_confirm}
              </button>
            ) : null}
            <button
              type="button"
              className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-700"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void performStatusChange(arg.event.id, "completed");
              }}
            >
              {t.dash_completed}
            </button>
            {props.recurrenceFrequency ? (
              <button
                type="button"
                className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-rose-700"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void performStatusChange(
                    arg.event.id,
                    "cancelled",
                    "following",
                  );
                }}
              >
                {t.appointments_cancel_this_and_following}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  async function handleCreateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateBusy(true);
    setCreateError("");
    try {
      if (!createForm.patientId) {
        setCreateError(`${t.orders_patient}: ${t.cf_required}`);
        return;
      }
      const repeatInterval = parsePositiveIntegerInput(
        createForm.repeatInterval,
      );
      const repeatCount = parsePositiveIntegerInput(createForm.repeatCount);
      if (createForm.repeatEnabled) {
        if (!repeatInterval) {
          setCreateError("Repeat interval must be a positive number.");
          return;
        }
        if (!repeatCount && !createForm.repeatUntil) {
          setCreateError(
            "Set either total occurrences or a repeat-until date for recurring appointments.",
          );
          return;
        }
      }
      const result = await apiFetch<{
        id: string;
        conflicts?: ConflictSummary;
        series_created_count?: number;
      }>("/appointments", {
        method: "POST",
        body: JSON.stringify({
          patient_id: createForm.patientId,
          provider_id: createForm.providerId || null,
          doctor_id: createForm.doctorId || null,
          owner_user_id: createForm.ownerUserId || null,
          interpreter_id: createForm.interpreterId || null,
          appointment_type: createForm.appointmentType,
          care_path_kind: normalizeCarePathKindForAppointmentType(
            createForm.appointmentType,
            createForm.carePathKind,
          ),
          title: createForm.title.trim(),
          date: createForm.date,
          time_start: createForm.timeStart || null,
          time_end: createForm.timeEnd || null,
          location: createForm.location.trim() || null,
          category: createForm.category.trim() || null,
          notes: createForm.notes.trim() || null,
          recurrence_frequency: createForm.repeatEnabled
            ? createForm.repeatFrequency
            : null,
          recurrence_interval: createForm.repeatEnabled ? repeatInterval : null,
          recurrence_count: createForm.repeatEnabled ? repeatCount : null,
          recurrence_until:
            createForm.repeatEnabled && createForm.repeatUntil
              ? createForm.repeatUntil
              : null,
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
      setCreateError(
        error instanceof Error ? error.message : "Failed to create appointment",
      );
    } finally {
      setCreateBusy(false);
    }
  }

  async function handleInlineReschedule(
    info: EventDropArg | EventResizeDoneArg,
  ) {
    const source = appointments.find((item) => item.id === info.event.id);
    if (
      !source ||
      !permissions.canEditSchedule ||
      source.is_blocked ||
      !info.event.start
    ) {
      info.revert();
      return;
    }
    const nextDate = toDateInput(info.event.start);
    const nextTimeStart = info.event.allDay
      ? ""
      : toTimeInput(info.event.start);
    const nextTimeEnd = info.event.allDay
      ? ""
      : info.event.end
        ? toTimeInput(info.event.end)
        : source.time_end || "";
    const localWarnings = buildLocalScheduleWarnings(
      appointments,
      {
        appointmentId: source.id,
        date: nextDate,
        timeStart: nextTimeStart,
        timeEnd: nextTimeEnd,
        ownerUserId: source.owner_user_id,
        providerId: source.provider_id,
        doctorId: source.doctor_id,
      },
      tr,
    );
    try {
      const result = await apiFetch<{
        ok: boolean;
        conflicts?: ConflictSummary;
      }>(`/appointments/${source.id}/update`, {
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
      });
      setAppointmentsNotice(
        buildScheduleNotice(result.conflicts, localWarnings),
      );
      refreshAppointments();
      if (selectedId === source.id) refreshDetail();
    } catch (error) {
      info.revert();
      setAppointmentsError(
        error instanceof Error ? error.message : tr.common_failed_update,
      );
    }
  }

  async function performStatusChange(
    appointmentId: string,
    status: AppointmentStatus,
    recurrenceScope: AppointmentRecurringActionScope = "single",
  ) {
    setCalendarQuickActionMenu(null);
    setActionBusy(statusActionKey(appointmentId, status, recurrenceScope));
    try {
      await apiFetch<{ ok: boolean }>(`/appointments/${appointmentId}/status`, {
        method: "POST",
        body: JSON.stringify({
          status,
          recurrence_scope: recurrenceScope,
        }),
      });
      if (selectedId === appointmentId) {
        refreshDetail();
      } else {
        refreshAppointments();
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to change status";
      if (selectedId === appointmentId) {
        setDetailError(message);
      } else {
        setAppointmentsError(message);
      }
    } finally {
      setActionBusy("");
    }
  }

  async function handleStatusChange(
    status: AppointmentStatus,
    recurrenceScope: AppointmentRecurringActionScope = "single",
  ) {
    if (!detail) return;
    await performStatusChange(detail.id, status, recurrenceScope);
  }

  async function handleAssignInterpreter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || !editForm?.interpreterId) return;
    setActionBusy("assign");
    try {
      await apiFetch<{ ok: boolean }>(
        `/appointments/${detail.id}/assign-interpreter`,
        {
          method: "POST",
          body: JSON.stringify({ interpreter_id: editForm.interpreterId }),
        },
      );
      refreshDetail();
    } catch (error) {
      setDetailError(
        error instanceof Error ? error.message : "Failed to assign interpreter",
      );
    } finally {
      setActionBusy("");
    }
  }

  async function handleInterpreterResponse(response: InterpreterResponse) {
    if (!detail) return;
    setActionBusy(`response:${response}`);
    try {
      await apiFetch<{ ok: boolean }>(
        `/appointments/${detail.id}/interpreter-response`,
        {
          method: "POST",
          body: JSON.stringify({ response }),
        },
      );
      refreshDetail();
    } catch (error) {
      setDetailError(
        error instanceof Error ? error.message : "Failed to submit response",
      );
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
      const applyRecurrenceRule =
        Boolean(detail.recurrence_frequency) &&
        editRecurrenceScope !== "single";
      const repeatInterval = parsePositiveIntegerInput(editForm.repeatInterval);
      const repeatCount = parsePositiveIntegerInput(editForm.repeatCount);
      if (applyRecurrenceRule) {
        if (!repeatInterval) {
          setEditError("Repeat interval must be a positive number.");
          return;
        }
        if (!repeatCount && !editForm.repeatUntil) {
          setEditError(
            "Set either total occurrences or a repeat-until date for recurring updates.",
          );
          return;
        }
      }
      const result = await apiFetch<{
        ok: boolean;
        conflicts?: ConflictSummary;
      }>(`/appointments/${detail.id}/update`, {
        method: "POST",
        body: JSON.stringify({
          provider_id: editForm.providerId || null,
          doctor_id: editForm.doctorId || null,
          owner_user_id: editForm.ownerUserId || null,
          interpreter_id: editForm.interpreterId || null,
          care_path_kind: normalizeCarePathKindForAppointmentType(
            detail.type,
            editForm.carePathKind,
          ),
          title: editForm.title.trim(),
          date: editForm.date,
          time_start: editForm.timeStart || null,
          time_end: editForm.timeEnd || null,
          location: editForm.location.trim() || null,
          recurrence_frequency: applyRecurrenceRule
            ? editForm.repeatFrequency
            : null,
          recurrence_interval: applyRecurrenceRule ? repeatInterval : null,
          recurrence_count: applyRecurrenceRule ? repeatCount : null,
          recurrence_until:
            applyRecurrenceRule && editForm.repeatUntil
              ? editForm.repeatUntil
              : null,
          recurrence_scope: detail.recurrence_frequency
            ? editRecurrenceScope
            : "single",
        }),
      });
      setAppointmentsNotice(
        buildScheduleNotice(result.conflicts, editLocalWarnings),
      );
      refreshDetail();
    } catch (error) {
      setEditError(
        error instanceof Error ? error.message : "Failed to save schedule",
      );
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
      setDetailError(
        error instanceof Error ? error.message : "Failed to add checklist item",
      );
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
        { method: "POST" },
      );
      refreshDetail();
    } catch (error) {
      setDetailError(
        error instanceof Error ? error.message : "Failed to complete item",
      );
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
      setDetailError(
        error instanceof Error ? error.message : "Failed to add reminder",
      );
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
        { method: "POST" },
      );
      refreshDetail();
    } catch (error) {
      setDetailError(
        error instanceof Error ? error.message : "Failed to complete reminder",
      );
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
      setDetailError(
        error instanceof Error ? error.message : "Failed to submit report",
      );
    } finally {
      setActionBusy("");
    }
  }

  async function handleApproveReport() {
    if (!detail) return;
    setActionBusy("report-approve");
    try {
      await apiFetch<{ ok: boolean }>(
        `/appointments/${detail.id}/report/approve`,
        {
          method: "POST",
        },
      );
      refreshDetail();
    } catch (error) {
      setDetailError(
        error instanceof Error ? error.message : "Failed to approve report",
      );
    } finally {
      setActionBusy("");
    }
  }

  async function handleRejectReport() {
    if (!detail) return;
    setActionBusy("report-reject");
    try {
      await apiFetch<{ ok: boolean }>(
        `/appointments/${detail.id}/report/reject`,
        {
          method: "POST",
          body: JSON.stringify({ notes: reportRejectReason.trim() || null }),
        },
      );
      setReportRejectReason("");
      refreshDetail();
    } catch (error) {
      setDetailError(
        error instanceof Error ? error.message : "Failed to reject report",
      );
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
          detail.interpreter_id ??
            detail.owner_user_id ??
            taskAssignableStaff[0]?.id ??
            "",
          buildTaskDefaultDueDate(detail),
        ),
      );
      refreshDetail();
    } catch (error) {
      setDetailError(
        error instanceof Error ? error.message : "Failed to create task",
      );
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
      setDetailError(
        error instanceof Error ? error.message : "Failed to update task",
      );
    } finally {
      setActionBusy("");
    }
  }

  function updateServiceDraft(
    serviceId: string,
    patch: Partial<ConciergeServiceDraftState>,
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
          starts_at: serviceForm.startsAt
            ? toRfc3339(serviceForm.startsAt)
            : null,
          ends_at: serviceForm.endsAt ? toRfc3339(serviceForm.endsAt) : null,
          cost_estimate: serviceForm.costEstimate
            ? Number(serviceForm.costEstimate)
            : null,
          currency: serviceForm.currency.trim().toUpperCase() || "EUR",
          service_notes: serviceForm.serviceNotes.trim() || null,
        }),
      });
      setServiceForm(
        blankConciergeServiceForm({
          providerId:
            detail.provider_id &&
            nonMedicalProviders.some(
              (provider) => provider.id === detail.provider_id,
            )
              ? detail.provider_id
              : "",
          assignedConciergeId:
            detail.owner_role === "concierge"
              ? (detail.owner_user_id ?? "")
              : (conciergeStaff[0]?.id ?? ""),
          title: detail.title,
          startsAt: detail.time_start
            ? `${detail.date}T${detail.time_start.slice(0, 5)}`
            : "",
          endsAt: detail.time_end
            ? `${detail.date}T${detail.time_end.slice(0, 5)}`
            : "",
          currency: "EUR",
        }),
      );
      refreshDetail();
    } catch (error) {
      setDetailError(
        error instanceof Error ? error.message : tr.common_failed_create,
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
      await apiFetch<ConciergeServiceEntry>(
        `/concierge-services/${serviceId}/update`,
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
      );
      refreshDetail();
    } catch (error) {
      setDetailError(
        error instanceof Error ? error.message : tr.common_failed_update,
      );
    } finally {
      setActionBusy("");
    }
  }

  function openInternalChat(
    peerId: string,
    name: string,
    role: string,
    draft: string,
  ) {
    const params = new URLSearchParams({
      peer: peerId,
      name,
      role,
      draft,
    });
    staffGo(`/chat?${params.toString()}`);
  }

  function openAppointmentChat(peer: HandoffStakeholder) {
    if (!detail) return;
    openInternalChat(
      peer.id,
      peer.name,
      peer.role,
      `Appointment handoff: ${detail.patient_pid} · ${detail.title} · ${slotLabel(detail)}.`,
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
        }),
      );
    }

    await Promise.all(requests);
  }

  async function handleFollowUpPreset(
    preset: (typeof FOLLOW_UP_PRESETS)[number],
  ) {
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
        error instanceof Error ? error.message : tr.common_failed_create,
      );
    } finally {
      setFollowUpBusy(false);
    }
  }

  async function handleDoctorFollowUpSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || !doctorFollowUpForm.assigneeId || !doctorFollowUpForm.dueAt)
      return;

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
          shiftLocalDateTime(doctorFollowUpForm.dueAt, { days: 7 }),
        ),
      );
      refreshDetail();
    } catch (error) {
      setDetailError(
        error instanceof Error ? error.message : tr.common_failed_create,
      );
    } finally {
      setDoctorFollowUpBusy(false);
    }
  }

  async function handlePackageEndFollowUpSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    if (
      !detail ||
      !packageEndFollowUpForm.assigneeId ||
      !packageEndFollowUpForm.packageEndDate
    ) {
      return;
    }

    const remindAt = shiftLocalDateTime(
      `${packageEndFollowUpForm.packageEndDate}T09:00`,
      { months: -1 },
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
        blankPackageEndFollowUpForm(
          packageEndFollowUpForm.assigneeId,
          tr.appointments_new ?? "",
        ),
      );
      refreshDetail();
    } catch (error) {
      setDetailError(
        error instanceof Error ? error.message : tr.common_failed_create,
      );
    } finally {
      setPackageEndFollowUpBusy(false);
    }
  }

  function openExternalHandoffChatDraft() {
    if (!detail || !externalHandoffForm.assigneeId) return;
    const assignee = doctorFollowUpAssignees.find(
      (item) => item.id === externalHandoffForm.assigneeId,
    );
    if (!assignee) return;

    const targetLabel = communicationTargetLabel(
      externalHandoffForm.target,
      detail,
    );
    const draftParts = [
      `External handoff: ${detail.patient_pid} · ${detail.title}`,
      `Target: ${targetLabel} · ${externalHandoffForm.direction} via ${communicationChannelLabel(externalHandoffForm.channel)}`,
      `Slot: ${slotLabel(detail)}`,
      externalHandoffForm.contactName.trim()
        ? `Contact: ${externalHandoffForm.contactName.trim()}`
        : "",
      externalHandoffForm.notes.trim() || "",
    ].filter(Boolean);

    openInternalChat(
      assignee.id,
      assignee.name,
      assignee.role,
      draftParts.join("\n"),
    );
  }

  async function handleExternalHandoffSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    if (!detail || !externalHandoffForm.title.trim()) return;

    const targetLabel = communicationTargetLabel(
      externalHandoffForm.target,
      detail,
    );
    const handoffTitle = `${EXTERNAL_HANDOFF_PREFIX} ${externalHandoffForm.title.trim()}`;
    const descriptionParts = [
      `Target: ${externalHandoffForm.target} · ${targetLabel}`,
      `Direction: ${externalHandoffForm.direction} via ${communicationChannelLabel(externalHandoffForm.channel)}`,
      `Appointment: ${detail.patient_pid} · ${detail.title} · ${slotLabel(detail)}`,
      externalHandoffForm.contactName.trim()
        ? `Contact: ${externalHandoffForm.contactName.trim()}`
        : "",
      externalHandoffForm.notes.trim() || "",
    ].filter(Boolean);

    setExternalHandoffBusy(true);
    try {
      const requests: Array<Promise<unknown>> = [
        apiFetch<{ id: string }>(`/appointments/${detail.id}/communications`, {
          method: "POST",
          body: JSON.stringify({
            target_type: externalHandoffForm.target,
            direction: externalHandoffForm.direction,
            channel: externalHandoffForm.channel,
            status: externalHandoffForm.status,
            subject: externalHandoffForm.title.trim(),
            message: externalHandoffForm.notes.trim() || null,
            contact_name: externalHandoffForm.contactName.trim() || null,
            due_at: externalHandoffForm.dueAt
              ? toRfc3339(externalHandoffForm.dueAt)
              : null,
          }),
        }),
      ];

      if (externalHandoffForm.assigneeId && externalHandoffForm.dueAt) {
        requests.push(
          apiFetch<{ id: string }>(`/appointments/${detail.id}/reminders`, {
            method: "POST",
            body: JSON.stringify({
              user_id: externalHandoffForm.assigneeId,
              remind_at: toRfc3339(externalHandoffForm.dueAt),
              title: handoffTitle,
              description: descriptionParts.join("\n"),
            }),
          }),
        );

        if (externalHandoffForm.createTask && permissions.canCreateTasks) {
          requests.push(
            apiFetch<{ id: string }>("/tasks", {
              method: "POST",
              body: JSON.stringify({
                title: handoffTitle,
                description: descriptionParts.join("\n"),
                assigned_to: externalHandoffForm.assigneeId,
                patient_id: detail.patient_id,
                order_id: detail.order_id,
                appointment_id: detail.id,
                due_date: toRfc3339(externalHandoffForm.dueAt),
                priority: externalHandoffForm.taskPriority,
              }),
            }),
          );
        }
      }

      await Promise.all(requests);
      setExternalHandoffForm(
        blankExternalHandoffForm(
          externalHandoffForm.assigneeId,
          externalHandoffForm.dueAt
            ? shiftLocalDateTime(externalHandoffForm.dueAt, { days: 1 })
            : "",
          externalHandoffForm.target,
        ),
      );
      refreshDetail();
    } catch (error) {
      setDetailError(
        error instanceof Error ? error.message : tr.common_failed_create,
      );
    } finally {
      setExternalHandoffBusy(false);
    }
  }

  async function handleCommunicationStatusUpdate(
    communicationId: string,
    status: AppointmentCommunicationStatus,
  ) {
    if (!detail) return;
    setActionBusy(`communication:${communicationId}:${status}`);
    try {
      await apiFetch(
        `/appointments/${detail.id}/communications/${communicationId}/status`,
        {
          method: "POST",
          body: JSON.stringify({ status }),
        },
      );
      refreshDetail();
    } catch (error) {
      setDetailError(
        error instanceof Error ? error.message : tr.common_failed_update,
      );
    } finally {
      setActionBusy("");
    }
  }

  function openBillingHandoffChatDraft() {
    if (!detail || !billingHandoffForm.assigneeId) return;
    const assignee = billingStaff.find(
      (item) => item.id === billingHandoffForm.assigneeId,
    );
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

    openInternalChat(
      assignee.id,
      assignee.name,
      assignee.role,
      draftParts.join("\n"),
    );
  }

  async function handleBillingHandoffSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || !billingHandoffForm.assigneeId || !billingHandoffForm.dueAt)
      return;

    const titleSuffix =
      billingHandoffForm.title.trim() ||
      billingHandoffKindLabel(billingHandoffForm.kind);
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
          billingHandoffForm.kind,
        ),
      );
      refreshDetail();
    } catch (error) {
      setDetailError(
        error instanceof Error ? error.message : tr.common_failed_create,
      );
    } finally {
      setBillingHandoffBusy(false);
    }
  }

  function openFindingsFollowUpChatDraft() {
    if (!detail || !findingsFollowUpForm.assigneeId) return;
    const assignee = doctorFollowUpAssignees.find(
      (item) => item.id === findingsFollowUpForm.assigneeId,
    );
    if (!assignee) return;

    const draftParts = [
      `Findings follow-up: ${detail.patient_pid} · ${detail.title}`,
      `Expected: ${findingsArtifactLabel(findingsFollowUpForm.artifact)}`,
      detail.provider_name ? `Clinic: ${detail.provider_name}` : "",
      detail.doctor_name ? `Doctor: ${detail.doctor_name}` : "",
      findingsFollowUpForm.translationRequired ? "{tr.common_loading}" : "",
      findingsFollowUpForm.sendToPatient ? tr.common_error : "",
      findingsFollowUpForm.notes.trim() || "",
    ].filter(Boolean);

    openInternalChat(
      assignee.id,
      assignee.name,
      assignee.role,
      draftParts.join("\n"),
    );
  }

  async function handleFindingsFollowUpSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    if (
      !detail ||
      !findingsFollowUpForm.assigneeId ||
      !findingsFollowUpForm.dueAt
    )
      return;

    const artifactLabel = findingsArtifactLabel(findingsFollowUpForm.artifact);
    const title = `${FINDINGS_FOLLOW_UP_PREFIX} ${artifactLabel}`;
    const descriptionParts = [
      detail.provider_name ? `Clinic: ${detail.provider_name}` : "",
      detail.doctor_name ? `Doctor: ${detail.doctor_name}` : "",
      `Appointment: ${detail.patient_pid} · ${detail.title} · ${slotLabel(detail)}`,
      findingsFollowUpForm.translationRequired ? "{tr.common_loading}" : "",
      findingsFollowUpForm.sendToPatient ? tr.common_error : "",
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
          findingsFollowUpForm.artifact,
        ),
      );
      refreshDetail();
    } catch (error) {
      setDetailError(
        error instanceof Error ? error.message : tr.common_failed_create,
      );
    } finally {
      setFindingsFollowUpBusy(false);
    }
  }

  function openIncomingDataChatDraft() {
    if (!detail || !incomingDataForm.assigneeId) return;
    const assignee = doctorFollowUpAssignees.find(
      (item) => item.id === incomingDataForm.assigneeId,
    );
    if (!assignee) return;

    const draftParts = [
      `Incoming data intake: ${detail.patient_pid} · ${detail.title}`,
      `Source: ${incomingDataSourceLabel(incomingDataForm.source)}`,
      `Category: ${incomingDataCategoryLabel(incomingDataForm.category)}`,
      incomingDataForm.requiresCaseUpdate ? tr.common_error : "",
      incomingDataForm.requiresPatientFollowUp ? "{tr.appointments_title}" : "",
      incomingDataForm.notes.trim() || "",
    ].filter(Boolean);

    openInternalChat(
      assignee.id,
      assignee.name,
      assignee.role,
      draftParts.join("\n"),
    );
  }

  async function handleIncomingDataSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || !incomingDataForm.assigneeId || !incomingDataForm.dueAt)
      return;

    const title = `${INCOMING_DATA_PREFIX} ${incomingDataCategoryLabel(
      incomingDataForm.category,
    )} from ${incomingDataSourceLabel(incomingDataForm.source)}`;
    const descriptionParts = [
      detail.provider_name ? `Clinic: ${detail.provider_name}` : "",
      detail.doctor_name ? `Doctor: ${detail.doctor_name}` : "",
      `Appointment: ${detail.patient_pid} · ${detail.title} · ${slotLabel(detail)}`,
      `Source: ${incomingDataSourceLabel(incomingDataForm.source)}`,
      `Category: ${incomingDataCategoryLabel(incomingDataForm.category)}`,
      incomingDataForm.requiresCaseUpdate ? tr.common_error : "",
      incomingDataForm.requiresPatientFollowUp ? tr.common_error : "",
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
          incomingDataForm.source,
        ),
      );
      refreshDetail();
    } catch (error) {
      setDetailError(
        error instanceof Error ? error.message : tr.common_failed_create,
      );
    } finally {
      setIncomingDataBusy(false);
    }
  }

  function applyFollowUpVisitPreset(
    preset: (typeof FOLLOW_UP_PRESETS)[number],
  ) {
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
                    days:
                      "offsetDays" in preset ? preset.offsetDays : undefined,
                    months:
                      "offsetMonths" in preset
                        ? preset.offsetMonths
                        : undefined,
                  },
                ).slice(11, 16)
              : current.timeEnd,
            title:
              current.title.trim() === "" ||
              current.title.startsWith(t.phase_followup)
                ? preset.title
                : current.title,
            reminderAt: nextReminderAt || current.reminderAt,
          }
        : current,
    );
  }

  async function handleFollowUpVisitSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || !followUpVisitForm) return;
    setFollowUpVisitBusy(true);
    setFollowUpVisitError("");
    try {
      const result = await apiFetch<{
        id: string;
        conflicts?: ConflictSummary;
      }>("/appointments", {
        method: "POST",
        body: JSON.stringify({
          patient_id: detail.patient_id,
          provider_id: followUpVisitForm.providerId || null,
          doctor_id: followUpVisitForm.doctorId || null,
          owner_user_id: followUpVisitForm.ownerUserId || null,
          interpreter_id: followUpVisitForm.interpreterId || null,
          order_id: followUpVisitForm.linkOrder ? detail.order_id : null,
          appointment_type: followUpVisitForm.appointmentType,
          care_path_kind: normalizeCarePathKindForAppointmentType(
            followUpVisitForm.appointmentType,
            followUpVisitForm.carePathKind,
          ),
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
          : tr.common_active,
      );
      refreshAppointments();
      setFollowUpVisitForm(
        buildFollowUpVisitForm(
          detail,
          followUpVisitForm.reminderUserId,
          tr.phase_followup,
        ),
      );
      if (result.id) {
        openDetailSheet(result.id);
      } else {
        refreshDetail();
      }
    } catch (error) {
      setFollowUpVisitError(
        error instanceof Error ? error.message : tr.common_failed_create,
      );
    } finally {
      setFollowUpVisitBusy(false);
    }
  }

  async function handleCompleteWithFollowUp() {
    if (!detail) return;
    const selectedPresets = FOLLOW_UP_PRESETS.filter(
      (preset) => completionPlan[preset.id],
    );
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
              months:
                "offsetMonths" in preset ? preset.offsetMonths : undefined,
            });
            return apiFetch<{ id: string }>(
              `/appointments/${detail.id}/reminders`,
              {
                method: "POST",
                body: JSON.stringify({
                  user_id: followUpAssigneeId,
                  remind_at: toRfc3339(remindAt),
                  title: preset.title,
                  description: `Auto-planned during appointment completion for ${detail.patient_pid} · ${detail.title}.`,
                }),
              },
            );
          }),
        );
      }

      setAppointmentsNotice(
        selectedPresets.length > 0
          ? `Appointment completed. ${selectedPresets.length} follow-up reminder(s) scheduled.`
          : tr.common_active,
      );
      refreshDetail();
    } catch (error) {
      if (completed) {
        setDetailError(
          error instanceof Error
            ? `Appointment completed, but follow-up scheduling failed: ${error.message}`
            : tr.common_error,
        );
        refreshDetail();
      } else {
        setDetailError(
          error instanceof Error ? error.message : tr.common_failed_update,
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
      <div className="space-y-4">
        {/* Page header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-[22px] font-semibold tracking-tight text-foreground leading-tight">
              {tr.appointments_title ?? "Appointments"}
            </h1>
            {permissions.canCreate ? (
              <Button
                type="button"
                size="sm"
                className="h-9 rounded-lg gap-1.5 px-3.5"
                onClick={() => openCreateSheetFromDate()}
              >
                <Plus className="size-3.5" />
                {tr.appointments_new ?? "New appointment"}
              </Button>
            ) : null}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-9 w-9 rounded-lg p-0 text-muted-foreground"
            onClick={refreshAppointments}
            title="Refresh"
          >
            <RefreshCw className="size-3.5" />
          </Button>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-2 xl:grid-cols-5 divide-x divide-border/60">
          <AptKpi icon={CalendarDays} tone="sky" label={tr.dash_patients_today ?? "Today"} value={todayAppointments} />
          <AptKpi icon={CheckCircle2} tone="emerald" label={tr.common_active ?? "Active"} value={activeAppointments} />
          <AptKpi icon={Clock3} tone="amber" label={tr.mfa_pending ?? "Pending"} value={pendingInterpreterResponses} />
          <AptKpi icon={AlertTriangle} tone="rose" label={tr.common_error ?? "Attention"} value={attentionCount} />
          <AptKpi icon={UsersRound} tone="neutral" label={tr.providers_all ?? "All"} value={scopedAppointments.length} />
        </div>

        {appointmentsError ? (
          <Banner tone="error">{appointmentsError}</Banner>
        ) : null}
        {appointmentsNotice ? (
          <Banner tone="warning">{appointmentsNotice}</Banner>
        ) : null}
        {metadataError ? <Banner tone="warning">{metadataError}</Banner> : null}

        {useInterpreterMobileAgenda ? (
          <div className="space-y-4">
            <section className={sectionCardClass("p-4")}>
              <div className="grid gap-3 sm:grid-cols-3">
                <StatsCard
                  icon={CalendarDays}
                  label={t.dash_patients_today}
                  value={String(todayAppointments)}
                  tone="sky"
                />
                <StatsCard
                  icon={UsersRound}
                  label={tr.mfa_pending ?? "Pending interpreter"}
                  value={String(mobileAgendaPendingCount)}
                  tone="amber"
                />
                <StatsCard
                  icon={CalendarClock}
                  label={tr.dash_this_week ?? "This week"}
                  value={String(mobileAgendaWeekCount)}
                  tone="slate"
                />
              </div>
            </section>

            <section className={sectionCardClass("p-4")}>
              <div className="space-y-4">
                <Field label={t.common_search}>
                  <Input
                    value={filters.search}
                    onChange={(event) =>
                      setFilters((current) => ({
                        ...current,
                        search: event.target.value,
                      }))
                    }
                    placeholder={tr.common_search}
                    className="h-10 rounded-xl bg-slate-50"
                  />
                </Field>
                <div className="flex flex-wrap items-center gap-2">
                  <QuickScopeButton
                    active={
                      filters.dateFrom === todayDate &&
                      filters.dateTo === todayDate
                    }
                    onClick={applyTodayScope}
                  >
                    Today
                  </QuickScopeButton>
                  <QuickScopeButton
                    active={
                      filters.dateFrom === weekStart &&
                      filters.dateTo === weekEnd
                    }
                    onClick={applyWeekScope}
                  >
                    This week
                  </QuickScopeButton>
                  <QuickScopeButton
                    active={mineFilterActive}
                    onClick={applyMineScope}
                  >
                    Mine
                  </QuickScopeButton>
                  {scopeOptions.length > 1
                    ? scopeOptions.map((option) => (
                        <QuickScopeButton
                          key={option.id}
                          active={operationalScope === option.id}
                          onClick={() => applyOperationalScope(option.id)}
                        >
                          {option.label}
                        </QuickScopeButton>
                      ))
                    : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="rounded-full px-3"
                    onClick={resetQuickScopes}
                  >
                    Reset
                  </Button>
                </div>
              </div>
            </section>

            {mobileAgendaSections.length === 0 ? (
              <section className={sectionCardClass("p-5")}>
                <EmptyState text="No appointments in the current mobile scope." />
              </section>
            ) : (
              mobileAgendaSections.map((section) => (
                <section
                  key={section.date}
                  className={sectionCardClass("p-4 md:p-5")}
                >
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold text-slate-950">
                        {section.label}
                      </h2>
                      <p className="text-xs text-muted-foreground">
                        {section.itemCount} slot(s)
                        {section.pendingResponseCount > 0
                          ? ` · ${section.pendingResponseCount} response pending`
                          : ""}
                      </p>
                    </div>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                      {section.itemCount}
                    </span>
                  </div>
                  <div className="space-y-3">
                    {section.items.map((item) => (
                      <MobileAgendaCard
                        key={item.id}
                        item={item}
                        onOpen={() => openDetailSheet(item.id)}
                      />
                    ))}
                  </div>
                </section>
              ))
            )}
          </div>
        ) : (
          <div className="grid gap-1">

              <Sheet open={filtersModalOpen} onOpenChange={setFiltersModalOpen}>
                <SheetContent side="right" className="w-full sm:max-w-[420px]">
                  <section
                    className={sectionCardClass(
                      "h-full overflow-y-auto border-0 p-5 shadow-none",
                    )}
                  >
                    <div className="mb-4 flex items-center justify-between">
                      <div>
                        <h2 className="text-sm font-semibold text-slate-950">
                          {appointmentText("Filter", "Фильтры", "Filters")}
                        </h2>
                        <p className="text-xs text-muted-foreground">
                          {appointmentText(
                            "Steuerung des Scheduler-Bereichs.",
                            "Управление областью планировщика.",
                            "Scope controls for the scheduler.",
                          )}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={resetQuickScopes}
                      >
                        {appointmentText(
                          "Bereich zurücksetzen",
                          "Сбросить область",
                          "Reset scope",
                        )}
                      </Button>
                    </div>
                    <div className="grid gap-3">
                      <Field
                        compact
                        label={appointmentText(
                          "Operativer Bereich",
                          "Операционная область",
                          "Operational scope",
                        )}
                      >
                        <ShadSelect
                          value={operationalScope}
                          onValueChange={(value) =>
                            applyOperationalScope((value as OperationalScope) ?? "all")
                          }
                        >
                          <SelectTrigger className={cn("w-full", createSheetInputClassName)}>
                            <SelectValue>{selectedOperationalScopeLabel}</SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {scopeOptions.map((option) => (
                              <SelectItem key={`scheduler-sheet-${option.id}`} value={option.id}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </ShadSelect>
                      </Field>
                      <Field
                        compact
                        label={appointmentText(
                          "Schnellbereich",
                          "Быстрая область",
                          "Quick scope",
                        )}
                      >
                        <ShadSelect
                          value={schedulerQuickScopeValue}
                          onValueChange={(value) =>
                            applySchedulerQuickScope((value as SchedulerQuickScope) ?? "all")
                          }
                        >
                          <SelectTrigger className={cn("w-full", createSheetInputClassName)}>
                            <SelectValue>{selectedSchedulerQuickScopeLabel}</SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {schedulerQuickScopeOptions.map((option) => (
                              <SelectItem key={`scheduler-quick-${option.id}`} value={option.id}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </ShadSelect>
                      </Field>
                    </div>
                  </section>
                </SheetContent>
              </Sheet>

              <Sheet open={searchModalOpen} onOpenChange={setSearchModalOpen}>
                <SheetContent side="right" className="w-full sm:max-w-[420px]">
                  <section
                    className={sectionCardClass(
                      "h-full overflow-y-auto border-0 p-5 shadow-none",
                    )}
                  >
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-slate-950">
                    {t.common_search}
                  </h2>
                    <p className="text-xs text-muted-foreground">
                      Narrow the calendar to the exact operational slice.
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setOperationalScope("all");
                      setFilters(DEFAULT_FILTERS);
                      syncQuery({
                        patient: null,
                        provider: null,
                        doctor: null,
                        appointment: null,
                      });
                    }}
                  >
                    Reset
                  </Button>
                </div>
                <div className="space-y-4">
                  <Field label={t.common_search}>
                    <Input
                      value={filters.search}
                      onChange={(event) =>
                        setFilters((current) => ({
                          ...current,
                          search: event.target.value,
                        }))
                      }
                      placeholder={tr.common_search}
                      className="h-10 rounded-xl bg-slate-50"
                    />
                  </Field>
                  <Field label={t.appointments_type}>
                    <select
                      value={filters.appointmentType}
                      onChange={(event) =>
                        setFilters((current) => ({
                          ...current,
                          appointmentType: event.target.value,
                        }))
                      }
                      className={selectClassName}
                    >
                      <option value="">{t.providers_all}</option>
                      {TYPE_OPTIONS.map((value) => (
                        <option key={value} value={value}>
                          {appointmentTypeLabel(value, tr)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={appointmentText("Versorgungspfad", "Траектория лечения", "Care path")}>
                    <select
                      value={filters.carePathKind}
                      onChange={(event) =>
                        setFilters((current) => ({
                          ...current,
                          carePathKind: event.target.value,
                        }))
                      }
                      className={selectClassName}
                    >
                      <option value="">{t.providers_all}</option>
                      {CARE_PATH_KIND_OPTIONS.map((value) => (
                        <option key={value} value={value}>
                          {carePathKindLabel(value)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={t.users_status}>
                    <select
                      value={filters.status}
                      onChange={(event) =>
                        setFilters((current) => ({
                          ...current,
                          status: event.target.value,
                        }))
                      }
                      className={selectClassName}
                    >
                      <option value="">{t.providers_all}</option>
                      {STATUS_OPTIONS.map((value) => (
                        <option key={value} value={value}>
                          {statusLabel(value)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={t.orders_patient}>
                    <select
                      value={filters.patientId}
                      onChange={(event) => {
                        const patientId = event.target.value;
                        setFilters((current) => ({ ...current, patientId }));
                        syncQuery({ patient: patientId || null });
                      }}
                      className={selectClassName}
                    >
                      <option value="">{tr.providers_all}</option>
                      {patients.map((patient) => (
                        <option key={patient.id} value={patient.id}>
                          {patient.patient_id} · {patientName(patient)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={t.common_provider}>
                    <select
                      value={filters.providerId}
                      onChange={(event) => {
                        const providerId = event.target.value;
                        setFilters((current) => ({
                          ...current,
                          providerId,
                          doctorId: "",
                        }));
                        syncQuery({
                          provider: providerId || null,
                          doctor: null,
                        });
                      }}
                      className={selectClassName}
                    >
                      <option value="">{tr.providers_all}</option>
                      {providers.map((provider) => (
                        <option key={provider.id} value={provider.id}>
                          {provider.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={t.common_doctor}>
                    <select
                      value={filters.doctorId}
                      onChange={(event) => {
                        const doctorId = event.target.value;
                        setFilters((current) => ({ ...current, doctorId }));
                        syncQuery({ doctor: doctorId || null });
                      }}
                      className={selectClassName}
                      disabled={!filters.providerId}
                    >
                      <option value="">{t.providers_all}</option>
                      {filterDoctors.map((doctor) => (
                        <option key={doctor.id} value={doctor.id}>
                          {doctorLabel(doctor)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={t.patients_assign_owner}>
                    <select
                      value={filters.ownerUserId}
                      onChange={(event) =>
                        setFilters((current) => ({
                          ...current,
                          ownerUserId: event.target.value,
                        }))
                      }
                      className={selectClassName}
                    >
                      <option value="">{tr.providers_all}</option>
                      {staff.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.name} · {roleLabel(member.role)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={t.common_doctor}>
                    <select
                      value={filters.interpreterId}
                      onChange={(event) =>
                        setFilters((current) => ({
                          ...current,
                          interpreterId: event.target.value,
                        }))
                      }
                      className={selectClassName}
                    >
                      <option value="">{t.providers_all}</option>
                      {interpreters.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.name} · {roleLabel(member.role)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
                    <Field label={tr.providers_service_valid_from}>
                      <Input
                        type="date"
                        value={filters.dateFrom}
                        onChange={(event) =>
                          setFilters((current) => ({
                            ...current,
                            dateFrom: event.target.value,
                          }))
                        }
                        className="h-10 rounded-xl bg-slate-50"
                      />
                    </Field>
                    <Field label={tr.providers_service_valid_to}>
                      <Input
                        type="date"
                        value={filters.dateTo}
                        onChange={(event) =>
                          setFilters((current) => ({
                            ...current,
                            dateTo: event.target.value,
                          }))
                        }
                        className="h-10 rounded-xl bg-slate-50"
                      />
                    </Field>
                  </div>
                </div>
                  </section>
                </SheetContent>
              </Sheet>

              <Sheet open={queueModalOpen} onOpenChange={setQueueModalOpen}>
                <SheetContent side="right" className="w-full sm:max-w-[640px]">
                  <section
                    className={sectionCardClass(
                      "h-full overflow-y-auto border-0 p-5 shadow-none",
                    )}
                  >
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-950">
                      {t.appointments_title}
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      {operationalScope === "all"
                        ? tr.appointments_title
                        : tr.appointments_title}
                    </p>
                  </div>
                  {appointmentsLoading || metadataLoading ? (
                    <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
                  ) : null}
                </div>
                <div className="space-y-3">
                  {queueAppointments.length === 0 ? (
                    <EmptyState text={tr.common_not_set} />
                  ) : (
                    queueAppointments.map((item) => (
                      <div
                        key={item.id}
                        className="rounded-2xl border border-slate-200/80 bg-slate-50/80 px-4 py-3 transition hover:border-sky-200 hover:bg-white"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <button
                              type="button"
                              onClick={() => openDetailSheet(item.id)}
                              className="truncate text-left text-sm font-semibold text-slate-950 hover:text-sky-700"
                            >
                              {item.title}
                            </button>
                            <p className="truncate text-xs text-slate-500">
                              {item.patient_pid} · {item.patient_name}
                            </p>
                          </div>
                          <span
                            className={cn(
                              "rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]",
                              statusBadgeClass(item.status),
                            )}
                          >
                            {statusLabel(item.status)}
                          </span>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                          <span className="inline-flex items-center gap-1">
                            <Clock3 className="size-3.5" />
                            {slotLabel(item)}
                          </span>
                          {item.provider_name ? (
                            <span className="inline-flex items-center gap-1">
                              <Stethoscope className="size-3.5" />
                              {item.provider_name}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-3 truncate text-xs font-medium text-slate-500">
                          {operationalScopeReason(
                            item,
                            operationalScope,
                            user?.role,
                            attentionIndex,
                            tr,
                          )}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="rounded-2xl"
                            onClick={() => openDetailSheet(item.id)}
                          >
                            {t.providers_open}
                          </Button>
                          {permissions.canManageStatus &&
                          item.status !== "confirmed" &&
                          item.status !== "completed" &&
                          item.status !== "cancelled" ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="rounded-2xl"
                              disabled={Boolean(actionBusy)}
                              onClick={() =>
                                void performStatusChange(item.id, "confirmed")
                              }
                            >
                              {actionBusy ===
                              statusActionKey(item.id, "confirmed") ? (
                                <LoaderCircle className="size-4 animate-spin" />
                              ) : null}
                              {t.common_confirm}
                            </Button>
                          ) : null}
                          {permissions.canManageStatus &&
                          item.status !== "completed" &&
                          item.status !== "cancelled" ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="rounded-2xl"
                              disabled={Boolean(actionBusy)}
                              onClick={() =>
                                void performStatusChange(item.id, "completed")
                              }
                            >
                              {actionBusy ===
                              statusActionKey(item.id, "completed") ? (
                                <LoaderCircle className="size-4 animate-spin" />
                              ) : null}
                              {t.dash_completed}
                            </Button>
                          ) : null}
                          {permissions.canManageStatus &&
                          item.recurrence_frequency &&
                          item.status !== "completed" &&
                          item.status !== "cancelled" ? (
                            <>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="rounded-2xl border-rose-200 text-rose-700 hover:bg-rose-50"
                                disabled={Boolean(actionBusy)}
                                onClick={() =>
                                  void performStatusChange(
                                    item.id,
                                    "cancelled",
                                    "following",
                                  )
                                }
                              >
                                {actionBusy ===
                                statusActionKey(
                                  item.id,
                                  "cancelled",
                                  "following",
                                ) ? (
                                  <LoaderCircle className="size-4 animate-spin" />
                                ) : null}
                                {t.appointments_cancel_this_and_following}
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="rounded-2xl border-rose-200 text-rose-700 hover:bg-rose-50"
                                disabled={Boolean(actionBusy)}
                                onClick={() =>
                                  void performStatusChange(
                                    item.id,
                                    "cancelled",
                                    "series",
                                  )
                                }
                              >
                                {actionBusy ===
                                statusActionKey(
                                  item.id,
                                  "cancelled",
                                  "series",
                                ) ? (
                                  <LoaderCircle className="size-4 animate-spin" />
                                ) : null}
                                {t.appointments_cancel_whole_series}
                              </Button>
                            </>
                          ) : null}
                        </div>
                      </div>
                    ))
                  )}
                </div>
                  </section>
                </SheetContent>
              </Sheet>

              <div className="appointments-scheduler-divider w-full rounded-[6px] p-3">
                <div className="appointments-scheduler-toolbar flex w-full flex-col gap-2 lg:flex-row lg:items-start">
                  <div className="appointments-scheduler-search flex w-full items-center gap-2 lg:w-auto">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 shrink-0 rounded-full border-slate-200 bg-transparent hover:cursor-pointer hover:bg-transparent"
                      onClick={() => setFiltersModalOpen(true)}
                      aria-label={t.common_search}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="24"
                        height="24"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="size-4"
                      >
                        <path stroke="none" d="M0 0h24v24H0z" fill="none" />
                        <path d="M4 4h16v2.172a2 2 0 0 1 -.586 1.414l-4.414 4.414v7l-6 2v-8.5l-4.48 -4.928a2 2 0 0 1 -.52 -1.345v-2.227" />
                      </svg>
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-8 w-full justify-start rounded-full border-slate-200 bg-transparent px-3 text-xs font-normal text-slate-500 lg:w-[18rem] hover:cursor-pointer hover:bg-transparent"
                      onClick={() => setSearchModalOpen(true)}
                    >
                      {t.common_search.replace(/[.…]+$/u, "")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 shrink-0 rounded-full bg-transparent px-3 hover:cursor-pointer hover:bg-transparent"
                      onClick={() => setQueueModalOpen(true)}
                    >
                      {t.appointments_title}
                    </Button>
                  </div>
                </div>
              </div>
            <section className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="appointments-calendar-shell p-3">
                <FullCalendar
                  ref={calendarRef}
                  plugins={[
                    dayGridPlugin,
                    timeGridPlugin,
                    listPlugin,
                    interactionPlugin,
                  ]}
                  locale={lang === "de" ? deLocale : ruLocale}
                  eventTimeFormat={{
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false,
                    omitZeroMinute: false,
                  }}
                  displayEventEnd={false}
                  initialView={calendarView}
                  initialDate={calendarDate}
                  headerToolbar={{
                    left: "prev,next today",
                    center: "title",
                    right: "dayGridMonth,timeGridWeek,timeGridDay,listWeek",
                  }}
                  buttonText={{
                    today: tr.dash_patients_today ?? "Today",
                    month: tr.dash_this_month ?? "Month",
                    week: tr.dash_this_week ?? "Week",
                    day: tr.appointments_date ?? "Day",
                    list: tr.providers_all ?? "List",
                  }}
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
                  events={scopedAppointments.map((item) =>
                    toCalendarEvent(item, permissions.canEditSchedule),
                  )}
                />
              </div>
              {calendarQuickActionMenu && activeCalendarQuickActionItem ? (
                <div
                  ref={calendarQuickActionMenuRef}
                  id={`appointment-quick-actions-${activeCalendarQuickActionItem.id}`}
                  role="menu"
                  tabIndex={-1}
                  aria-label={t.appointments_quick_actions}
                  className="fixed z-50 w-56 rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_24px_60px_rgba(15,23,42,0.18)]"
                  style={{
                    top: `${calendarQuickActionMenu.top}px`,
                    left: `${calendarQuickActionMenu.left}px`,
                  }}
                >
                  <div className="border-b border-slate-200 px-2 pb-2">
                    <p className="truncate text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                      {t.appointments_quick_actions}
                    </p>
                    <p className="mt-1 truncate text-sm font-semibold text-slate-950">
                      {activeCalendarQuickActionItem.title}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {activeCalendarQuickActionItem.patient_pid} ·{" "}
                      {activeCalendarQuickActionItem.patient_name}
                    </p>
                  </div>
                  <div className="mt-2 space-y-1">
                    {activeCalendarQuickActionItem.recurrence_frequency ? (
                      <label className="block rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                          {t.appointments_scope_apply_status}
                        </span>
                        <select
                          value={calendarQuickActionScope}
                          onChange={(event) =>
                            setCalendarQuickActionScope(
                              event.target
                                .value as AppointmentRecurringActionScope,
                            )
                          }
                          className="mt-2 h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900"
                        >
                          <option value="single">
                            {t.appointments_scope_single}
                          </option>
                          <option value="following">
                            {t.appointments_scope_following}
                          </option>
                          <option value="series">
                            {t.appointments_scope_series}
                          </option>
                        </select>
                      </label>
                    ) : null}
                    <button
                      type="button"
                      role="menuitem"
                      className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-100 hover:text-slate-950"
                      onClick={() =>
                        openDetailSheet(activeCalendarQuickActionItem.id)
                      }
                    >
                      <span>{t.appointments_open_detail}</span>
                    </button>
                    {activeCalendarQuickActionItem.status !== "confirmed" ? (
                      <button
                        type="button"
                        role="menuitem"
                        className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-100 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={Boolean(actionBusy)}
                        onClick={() =>
                          void performStatusChange(
                            activeCalendarQuickActionItem.id,
                            "confirmed",
                            activeCalendarQuickActionScope,
                          )
                        }
                      >
                        <span>{t.common_confirm}</span>
                        {actionBusy ===
                        statusActionKey(
                          activeCalendarQuickActionItem.id,
                          "confirmed",
                          activeCalendarQuickActionScope,
                        ) ? (
                          <LoaderCircle className="size-4 animate-spin" />
                        ) : null}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      role="menuitem"
                      className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-100 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={Boolean(actionBusy)}
                      onClick={() =>
                        void performStatusChange(
                          activeCalendarQuickActionItem.id,
                          "completed",
                          activeCalendarQuickActionScope,
                        )
                      }
                    >
                      <span>{t.dash_completed}</span>
                      {actionBusy ===
                      statusActionKey(
                        activeCalendarQuickActionItem.id,
                        "completed",
                        activeCalendarQuickActionScope,
                      ) ? (
                        <LoaderCircle className="size-4 animate-spin" />
                      ) : null}
                    </button>
                    {activeCalendarQuickActionItem.recurrence_frequency ? (
                      <button
                        type="button"
                        role="menuitem"
                        className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={Boolean(actionBusy)}
                        onClick={() =>
                          void performStatusChange(
                            activeCalendarQuickActionItem.id,
                            "cancelled",
                            activeCalendarQuickActionScope,
                          )
                        }
                      >
                        <span>
                          {activeCalendarQuickActionScope === "following"
                            ? t.appointments_cancel_this_and_following
                            : activeCalendarQuickActionScope === "series"
                              ? t.appointments_cancel_whole_series
                              : statusLabel("cancelled")}
                        </span>
                        {actionBusy ===
                        statusActionKey(
                          activeCalendarQuickActionItem.id,
                          "cancelled",
                          activeCalendarQuickActionScope,
                        ) ? (
                          <LoaderCircle className="size-4 animate-spin" />
                        ) : null}
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </section>
          </div>
        )}
      </div>

      <Sheet open={createOpen} onOpenChange={setCreateOpen}>
        <SheetContent side="right" className="w-full sm:max-w-[760px]">
          <form onSubmit={handleCreateSubmit} className="flex flex-col flex-1 min-h-0">
            <SheetHeader className="shrink-0 px-4 pt-3 pb-1">
              <SheetTitle>{tr.appointments_new}</SheetTitle>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto px-4 py-2">
              <div className="space-y-4">
                {createError ? <Banner tone="error">{createError}</Banner> : null}
                <section className="space-y-3 rounded-xl border border-border/50 bg-card/40 p-3.5">
                  <div className="grid gap-4 md:grid-cols-3">
                <Field compact label={t.orders_patient}>
                  <ShadSelect
                    value={createForm.patientId}
                    onValueChange={(value) =>
                      setCreateForm((current) => ({
                        ...current,
                        patientId: value ?? "",
                      }))
                    }
                  >
                    <SelectTrigger className={cn("w-full", createSheetInputClassName)}>
                      <SelectValue>{selectedCreatePatientLabel}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">{t.orders_patient}</SelectItem>
                      {patients.map((patient) => (
                      <SelectItem key={patient.id} value={patient.id}>
                        {patient.patient_id} · {patientName(patient)}
                      </SelectItem>
                      ))}
                    </SelectContent>
                  </ShadSelect>
                </Field>
                <Field compact label={t.appointments_type}>
                  <ShadSelect
                    value={createForm.appointmentType}
                    onValueChange={(value) =>
                      setCreateForm((current) => ({
                        ...current,
                        appointmentType: (value as AppointmentKind) ?? current.appointmentType,
                        carePathKind:
                          value === "medical" ? current.carePathKind : "regular",
                        providerId: value === "internal" ? "" : current.providerId,
                        doctorId: value === "internal" ? "" : current.doctorId,
                      }))
                    }
                  >
                    <SelectTrigger className={cn("w-full", createSheetInputClassName)}>
                      <SelectValue>
                        {appointmentTypeLabel(createForm.appointmentType, tr)}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {TYPE_OPTIONS.map((value) => (
                        <SelectItem key={value} value={value}>
                          {appointmentTypeLabel(value, tr)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </ShadSelect>
                </Field>
                <Field compact label={appointmentText("Versorgungspfad", "Траектория лечения", "Care path")}>
                  <ShadSelect
                    value={createForm.carePathKind}
                    onValueChange={(value) =>
                      setCreateForm((current) => ({
                        ...current,
                        carePathKind: (value as AppointmentCarePathKind) ?? current.carePathKind,
                      }))
                    }
                    disabled={createForm.appointmentType !== "medical"}
                  >
                    <SelectTrigger className={cn("w-full", createSheetInputClassName)}>
                      <SelectValue>{carePathKindLabel(createForm.carePathKind)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {CARE_PATH_KIND_OPTIONS.map((value) => (
                        <SelectItem key={value} value={value}>
                          {carePathKindLabel(value)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </ShadSelect>
                </Field>
              </div>
              <Field compact label={t.appointments_title_col}>
                <Input
                  value={createForm.title}
                  onChange={(event) =>
                    setCreateForm((current) => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }
                  required
                  className={createSheetInputClassName}
                />
              </Field>
              <div className="grid gap-4 md:grid-cols-3">
                <Field compact label={t.appointments_date}>
                  <Input
                    type="date"
                    value={createForm.date}
                    onChange={(event) =>
                      setCreateForm((current) => ({
                        ...current,
                        date: event.target.value,
                      }))
                    }
                    required
                    className={createSheetInputClassName}
                  />
                </Field>
                <Field compact label={t.appointments_time}>
                  <Input
                    type="time"
                    value={createForm.timeStart}
                    onChange={(event) =>
                      setCreateForm((current) => ({
                        ...current,
                        timeStart: event.target.value,
                      }))
                    }
                    className={createSheetInputClassName}
                  />
                </Field>
                <Field compact label={t.appointments_time}>
                  <Input
                    type="time"
                    value={createForm.timeEnd}
                    onChange={(event) =>
                      setCreateForm((current) => ({
                        ...current,
                        timeEnd: event.target.value,
                      }))
                    }
                    className={createSheetInputClassName}
                  />
                </Field>
              </div>
              <div className="space-y-3 rounded-lg border border-border/60 bg-card p-3">
                <label className="flex items-start gap-3 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={createForm.repeatEnabled}
                    onChange={(event) =>
                      setCreateForm((current) => ({
                        ...current,
                        repeatEnabled: event.target.checked,
                        repeatInterval: current.repeatInterval || "1",
                        repeatCount:
                          event.target.checked && !current.repeatCount
                            ? "4"
                            : current.repeatCount,
                      }))
                    }
                    className="mt-0.5 size-4 rounded border-input bg-card text-[var(--brand)]"
                  />
                  <span>
                    <span className="block font-medium text-foreground">
                      Repeat this appointment
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      Create a recurring series from the current date and time
                      slot.
                    </span>
                  </span>
                </label>
                {createForm.repeatEnabled ? (
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <Field compact label="Frequency">
                      <ShadSelect
                        value={createForm.repeatFrequency}
                        onValueChange={(value) =>
                          setCreateForm((current) => ({
                            ...current,
                            repeatFrequency:
                              (value as AppointmentRecurrenceFrequency) ?? current.repeatFrequency,
                          }))
                        }
                      >
                        <SelectTrigger className={cn("w-full", createSheetInputClassName)}>
                          <SelectValue>
                            {recurrenceFrequencyLabel(createForm.repeatFrequency)}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {RECURRENCE_FREQUENCY_OPTIONS.map((value) => (
                            <SelectItem key={value} value={value}>
                              {recurrenceFrequencyLabel(value)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </ShadSelect>
                    </Field>
                    <Field compact label="Every">
                      <Input
                        type="number"
                        min="1"
                        step="1"
                        value={createForm.repeatInterval}
                        onChange={(event) =>
                          setCreateForm((current) => ({
                            ...current,
                            repeatInterval: event.target.value,
                          }))
                        }
                        className={createSheetInputClassName}
                      />
                    </Field>
                    <Field compact label={appointmentText("Anzahl Termine", "Всего повторов", "Total occurrences")}>
                      <Input
                        type="number"
                        min="2"
                        step="1"
                        value={createForm.repeatCount}
                        onChange={(event) =>
                          setCreateForm((current) => ({
                            ...current,
                            repeatCount: event.target.value,
                          }))
                        }
                        className={createSheetInputClassName}
                      />
                    </Field>
                    <Field compact label={appointmentText("Wiederholen bis", "Повторять до", "Repeat until")}>
                      <Input
                        type="date"
                        value={createForm.repeatUntil}
                        onChange={(event) =>
                          setCreateForm((current) => ({
                            ...current,
                            repeatUntil: event.target.value,
                          }))
                        }
                        className={createSheetInputClassName}
                      />
                    </Field>
                  </div>
                ) : null}
                  </div>
                </section>
                <section className="space-y-3 rounded-xl border border-border/50 bg-card/40 p-3.5">
                  <div className="grid gap-4 md:grid-cols-2">
                <Field compact label={t.common_provider}>
                  <ShadSelect
                    value={createForm.providerId}
                    onValueChange={(value) =>
                      setCreateForm((current) => ({
                        ...current,
                        providerId: value ?? "",
                        doctorId: "",
                      }))
                    }
                    disabled={createForm.appointmentType === "internal"}
                  >
                    <SelectTrigger className={cn("w-full", createSheetInputClassName)}>
                      <SelectValue>{selectedCreateProviderLabel}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">{t.common_not_set}</SelectItem>
                    {providers.map((provider) => (
                      <SelectItem key={provider.id} value={provider.id}>
                        {providerLabel(provider)}
                      </SelectItem>
                    ))}
                    </SelectContent>
                  </ShadSelect>
                </Field>
                <Field compact label={t.common_doctor}>
                  <ShadSelect
                    value={createForm.doctorId}
                    onValueChange={(value) =>
                      setCreateForm((current) => ({
                        ...current,
                        doctorId: value ?? "",
                      }))
                    }
                    disabled={!createForm.providerId}
                  >
                    <SelectTrigger className={cn("w-full", createSheetInputClassName)}>
                      <SelectValue>{selectedCreateDoctorLabel}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">{t.common_not_set}</SelectItem>
                      {createDoctors.map((doctor) => (
                        <SelectItem key={doctor.id} value={doctor.id}>
                          {doctorLabel(doctor)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </ShadSelect>
                </Field>
                  </div>
                </section>
                <section className="space-y-3 rounded-xl border border-border/50 bg-card/40 p-3.5">
                  <div className="grid gap-4 md:grid-cols-2">
                <Field compact label={t.patients_assign_owner}>
                  <ShadSelect
                    value={createForm.ownerUserId}
                    onValueChange={(value) =>
                      setCreateForm((current) => ({
                        ...current,
                        ownerUserId: value ?? "",
                      }))
                    }
                  >
                    <SelectTrigger className={cn("w-full", createSheetInputClassName)}>
                      <SelectValue>{selectedCreateOwnerLabel}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">{t.common_not_set}</SelectItem>
                    {staff.map((member) => (
                      <SelectItem key={member.id} value={member.id}>
                        {staffLabel(member)}
                      </SelectItem>
                    ))}
                    </SelectContent>
                  </ShadSelect>
                </Field>
                <Field compact label={t.common_doctor}>
                  <ShadSelect
                    value={createForm.interpreterId}
                    onValueChange={(value) =>
                      setCreateForm((current) => ({
                        ...current,
                        interpreterId: value ?? "",
                      }))
                    }
                  >
                    <SelectTrigger className={cn("w-full", createSheetInputClassName)}>
                      <SelectValue>{selectedCreateInterpreterLabel}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">{tr.common_not_set}</SelectItem>
                    {interpreters.map((member) => (
                      <SelectItem key={member.id} value={member.id}>
                        {staffLabel(member)}
                      </SelectItem>
                    ))}
                    </SelectContent>
                  </ShadSelect>
                </Field>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Field compact label={t.appointments_location}>
                  <Input
                    value={createForm.location}
                    onChange={(event) =>
                      setCreateForm((current) => ({
                        ...current,
                        location: event.target.value,
                      }))
                    }
                    className={createSheetInputClassName}
                  />
                </Field>
                <Field compact label={tr.documents_category}>
                  <Input
                    value={createForm.category}
                    onChange={(event) =>
                      setCreateForm((current) => ({
                        ...current,
                        category: event.target.value,
                      }))
                    }
                    className={createSheetInputClassName}
                  />
                </Field>
              </div>
              <Field compact label={t.patients_notes}>
                <textarea
                  value={createForm.notes}
                  onChange={(event) =>
                    setCreateForm((current) => ({
                      ...current,
                      notes: event.target.value,
                    }))
                  }
                  className={createSheetTextareaClassName}
                  rows={4}
                />
              </Field>
                </section>
                <ConflictPanel conflicts={createConflicts} />
                <ScheduleWarningsPanel warnings={createLocalWarnings} />
              </div>
            </div>
            <div className="shrink-0 flex justify-end gap-2 px-4 py-3 bg-popover">
              <Button
                type="button"
                variant="outline"
                className="h-9 rounded-lg"
                onClick={() => setCreateOpen(false)}
              >
                {tr.common_cancel}
              </Button>
              <Button
                type="submit"
                className="h-9 rounded-lg gap-1.5 px-3.5"
                disabled={createBusy}
              >
                {createBusy ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
                {createBusy ? t.patients_creating : t.appointments_new}
              </Button>
            </div>
          </form>
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
            setPackageEndFollowUpForm(
              blankPackageEndFollowUpForm("", tr.appointments_new ?? ""),
            );
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
            setEditRecurrenceScope("single");
            setStatusRecurrenceScope("single");
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
            <SheetTitle>{tr.appointments_title}</SheetTitle>
            <SheetDescription>
              Review context, reschedule, manage interpreter flow and close the
              operational loop from one sheet.
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
                    <span
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]",
                        typeBadgeClass(detail.type),
                      )}
                    >
                      {appointmentTypeLabel(detail.type, tr)}
                    </span>
                    {detail.care_path_kind ? (
                      <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-violet-700">
                        {carePathKindLabel(detail.care_path_kind)}
                      </span>
                    ) : null}
                    <span
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]",
                        statusBadgeClass(detail.status),
                      )}
                    >
                      {statusLabel(detail.status)}
                    </span>
                    {detail.recurrence_frequency ? (
                      <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-700">
                        {recurrenceFrequencyLabel(detail.recurrence_frequency)}{" "}
                        series
                      </span>
                    ) : null}
                    {detailLineageBadge ? (
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700">
                        {detailLineageBadge}
                      </span>
                    ) : null}
                    {detail.interpreter_response ? (
                      <span className="rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                        Interpreter {responseLabel(detail.interpreter_response)}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-4 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div>
                      <h2 className="text-2xl font-semibold text-slate-950">
                        {detail.title}
                      </h2>
                      <p className="mt-2 text-sm text-slate-600">
                        {detail.patient_pid} · {detail.patient_name}
                      </p>
                    </div>
                    <div className="grid gap-2 text-sm text-slate-600">
                      <InfoLine icon={Clock3} label={slotLabel(detail)} />
                      <InfoLine
                        icon={MapPin}
                        label={detail.location || tr.common_not_set}
                      />
                      <InfoLine
                        icon={Stethoscope}
                        label={detail.provider_name || tr.common_not_set}
                      />
                    </div>
                  </div>
                  {detail.is_blocked ? (
                    <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                      Concierge view is intentionally limited for medical slots.
                      Clinical notes and provider specifics stay hidden here.
                    </div>
                  ) : null}
                  {!detail.is_blocked && detail.recurrence_frequency ? (
                    <div className="mt-4 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
                      {t.appointments_recurring_series}:{" "}
                      {t.appointments_occurrence.toLowerCase()}{" "}
                      {detail.recurrence_index + 1}/
                      {detail.recurrence_series_size}.{" "}
                      {recurrenceCadenceLabel(detail)}
                      {detail.recurrence_until
                        ? ` ${t.appointments_until} ${detail.recurrence_until}.`
                        : detail.recurrence_count
                          ? ` ${t.appointments_total_planned_occurrences}: ${detail.recurrence_count}.`
                          : "."}{" "}
                      {t.appointments_scope_bulk_status_hint}{" "}
                      {t.appointments_scope_following_hint}
                      {detailLineageText ? (
                        <span className="mt-2 block rounded-xl border border-sky-300/70 bg-white/70 px-3 py-2 text-xs font-medium text-sky-900">
                          {detailLineageText}
                        </span>
                      ) : null}
                      {detailCurrentLineageHistory ? (
                        <div className="mt-3 grid gap-2 md:grid-cols-4">
                          <div className="rounded-xl border border-sky-300/70 bg-white/70 px-3 py-2">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-sky-700">
                              {t.appointments_lineage_current_branch}
                            </p>
                            <p className="mt-1 text-lg font-semibold text-sky-950">
                              {detailCurrentLineageHistory.total_occurrences}
                            </p>
                            <p className="text-[11px] text-sky-800">
                              {t.appointments_lineage_total_occurrences}
                            </p>
                          </div>
                          <div className="rounded-xl border border-sky-300/70 bg-white/70 px-3 py-2">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-sky-700">
                              {t.common_active}
                            </p>
                            <p className="mt-1 text-lg font-semibold text-sky-950">
                              {detailCurrentLineageHistory.active_occurrences}
                            </p>
                            <p className="text-[11px] text-sky-800">
                              {t.appointments_lineage_still_operational}
                            </p>
                          </div>
                          <div className="rounded-xl border border-sky-300/70 bg-white/70 px-3 py-2">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-sky-700">
                              {t.dash_completed}
                            </p>
                            <p className="mt-1 text-lg font-semibold text-sky-950">
                              {
                                detailCurrentLineageHistory.completed_occurrences
                              }
                            </p>
                            <p className="text-[11px] text-sky-800">
                              {t.appointments_lineage_completed_occurrences}
                            </p>
                          </div>
                          <div className="rounded-xl border border-sky-300/70 bg-white/70 px-3 py-2">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-sky-700">
                              {t.appointments_lineage_related_branches}
                            </p>
                            <p className="mt-1 text-lg font-semibold text-sky-950">
                              {detailRelatedLineageCount}
                            </p>
                            <p className="text-[11px] text-sky-800">
                              {t.appointments_lineage_related_branches_meta}
                            </p>
                          </div>
                        </div>
                      ) : null}
                      {detail.recurring_scope_preview.length > 0 ? (
                        <div className="mt-3 rounded-xl border border-sky-300/70 bg-white/70 p-3">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-sky-900">
                            {t.appointments_active_series_path}
                          </p>
                          <div className="mt-2 space-y-1.5">
                            {detail.recurring_scope_preview.map((item) => (
                              <div
                                key={item.id}
                                className={cn(
                                  "flex flex-wrap items-center gap-2 rounded-lg px-2 py-1.5 text-xs",
                                  item.id === detail.id
                                    ? "bg-sky-100 text-sky-950"
                                    : "bg-sky-50 text-sky-900",
                                )}
                              >
                                <span className="font-semibold">
                                  #{item.recurrence_index + 1}
                                </span>
                                <span>{item.date}</span>
                                {item.id === detail.id ? (
                                  <span className="rounded-full border border-sky-300 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]">
                                    {t.appointments_current_occurrence}
                                  </span>
                                ) : null}
                                {item.open_checklist_count > 0 ? (
                                  <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-800">
                                    {item.open_checklist_count}{" "}
                                    {item.open_checklist_count === 1
                                      ? t.appointments_open_checklist
                                      : t.appointments_open_checklists}
                                  </span>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {detail.recurring_lineage_history.length > 0 ? (
                        <div className="mt-3 rounded-xl border border-sky-300/70 bg-white/70 p-3">
                          <div className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-sky-900">
                                {t.appointments_lineage_history}
                              </p>
                              <p className="text-xs text-sky-800">
                                {t.appointments_lineage_history_hint}
                              </p>
                            </div>
                            <span className="text-[11px] font-medium text-sky-800">
                              {detail.recurring_lineage_history.length}{" "}
                              {t.appointments_lineage_related_series}
                            </span>
                          </div>
                          <div className="mt-3 grid gap-2">
                            {detail.recurring_lineage_history.map((item) => (
                              <div
                                key={item.series_id}
                                className={cn(
                                  "rounded-xl border px-3 py-2",
                                  item.relation === "current"
                                    ? "border-sky-400 bg-sky-100/80 text-sky-950"
                                    : "border-sky-200 bg-sky-50 text-sky-900",
                                )}
                              >
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="rounded-full border border-sky-300 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]">
                                    {recurringLineageRelationLabel(item, t)}
                                  </span>
                                  <span className="text-xs font-medium">
                                    {recurringLineageSplitLabel(item, t)}
                                  </span>
                                  <span className="text-xs text-sky-700">
                                    {item.first_date} to {item.last_date}
                                  </span>
                                  {item.series_id !== detail.id ? (
                                    <button
                                      type="button"
                                      className="rounded-full border border-sky-300 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-sky-900 transition hover:bg-sky-100"
                                      onClick={() =>
                                        openDetailSheet(item.series_id)
                                      }
                                    >
                                      {t.appointments_open_branch_root}
                                    </button>
                                  ) : null}
                                </div>
                                <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-sky-900">
                                  <span className="rounded-full border border-sky-200 bg-white px-2 py-0.5">
                                    {item.total_occurrences}{" "}
                                    {t.appointments_lineage_total_short}
                                  </span>
                                  <span className="rounded-full border border-sky-200 bg-white px-2 py-0.5">
                                    {item.active_occurrences}{" "}
                                    {t.appointments_lineage_active_short}
                                  </span>
                                  <span className="rounded-full border border-sky-200 bg-white px-2 py-0.5">
                                    {item.completed_occurrences}{" "}
                                    {t.appointments_lineage_completed_short}
                                  </span>
                                  <span className="rounded-full border border-sky-200 bg-white px-2 py-0.5">
                                    {item.cancelled_occurrences}{" "}
                                    {t.appointments_lineage_cancelled_short}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </section>
                <section className={sectionCardClass("p-5")}>
                  <h3 className="text-sm font-semibold text-slate-950">
                    {t.appointments_title}
                  </h3>
                  <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <ContextCard
                      label={t.orders_phase}
                      value={detail.checklist_phase || tr.phase_discovery}
                      meta={appointmentTypeLabel(detail.type, tr)}
                    />
                    <ContextCard
                      label={t.patients_assign_owner}
                      value={detail.owner_name || tr.common_not_set}
                      meta={
                        detail.owner_role
                          ? roleLabel(detail.owner_role)
                          : tr.common_not_set
                      }
                    />
                    <ContextCard
                      label={t.common_doctor}
                      value={detail.interpreter_name || tr.common_not_set}
                      meta={
                        detail.interpreter_response
                          ? responseLabel(detail.interpreter_response)
                          : tr.mfa_pending
                      }
                    />
                    <ContextCard
                      label={tr.providers_linked_patients}
                      value={detail.order_id || tr.common_not_set}
                      meta={
                        detail.category ||
                        formatDateTimeLabel(detail.created_at)
                      }
                    />
                  </div>
                </section>
                {detailAttention ? (
                  <section className={sectionCardClass("p-5")}>
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-950">
                          {t.common_error}
                        </h3>
                        <p className="text-xs text-slate-500">
                          This appointment still has unresolved operational
                          follow-up.
                        </p>
                      </div>
                      <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-rose-700">
                        {detailAttention.attention_score} issue
                        {detailAttention.attention_score === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="mt-4 space-y-3">
                      {detailAttention.reasons.map((reason) => (
                        <div
                          key={reason}
                          className="rounded-2xl border border-rose-200/80 bg-rose-50/80 px-4 py-3 text-sm text-rose-800"
                        >
                          {reason}
                        </div>
                      ))}
                    </div>
                    {detailAttention.next_due_at ? (
                      <p className="mt-4 text-xs text-slate-500">
                        Next due checkpoint:{" "}
                        {formatDateTimeLabel(detailAttention.next_due_at)}
                      </p>
                    ) : null}
                  </section>
                ) : null}
                <section className={sectionCardClass("p-5")}>
                  <h3 className="text-sm font-semibold text-slate-950">
                    {t.providers_linked_patients}
                  </h3>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-2xl"
                      onClick={() =>
                        staffGo(`/patients?patient=${detail.patient_id}`)
                      }
                    >
                      Patient
                    </Button>
                    {detail.order_id ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="rounded-2xl"
                        onClick={() =>
                          staffGo(`/orders?order=${detail.order_id}`)
                        }
                      >
                        Order
                      </Button>
                    ) : null}
                    {detail.provider_id ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="rounded-2xl"
                        onClick={() =>
                          staffGo(`/providers?provider=${detail.provider_id}`)
                        }
                      >
                        Clinic
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-2xl"
                      onClick={() =>
                        staffGo(
                          `/documents?appointment=${detail.id}&patient=${detail.patient_id}`,
                        )
                      }
                    >
                      Documents
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-2xl"
                      onClick={() =>
                        staffGo(`/cases?patient=${detail.patient_id}`)
                      }
                    >
                      Cases
                    </Button>
                  </div>
                </section>
                <section className={sectionCardClass("p-5")}>
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-950">
                        {t.appointments_title}
                      </h3>
                      <p className="text-xs text-slate-500">
                        Unified event trail across scheduling, interpreter
                        handling, follow-up, concierge work and operational
                        execution.
                      </p>
                    </div>
                    <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                      {visibleTimelineEvents.length} event
                      {visibleTimelineEvents.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {(
                      [
                        "all",
                        "workflow",
                        "communication",
                        "interpreter",
                        "clinical",
                        "followup",
                        "concierge",
                      ] as const
                    ).map((filter) => (
                      <Button
                        key={filter}
                        type="button"
                        variant={
                          timelineFilter === filter ? "default" : "outline"
                        }
                        size="sm"
                        className={cn(
                          "rounded-2xl",
                          timelineFilter === filter
                            ? "bg-slate-950 text-white hover:bg-slate-800"
                            : "",
                        )}
                        onClick={() => setTimelineFilter(filter)}
                      >
                        {filter === "all"
                          ? "All"
                          : filter === "followup"
                            ? t.phase_followup
                            : filter === "communication"
                              ? "Communication"
                              : filter.charAt(0).toUpperCase() +
                                filter.slice(1)}
                      </Button>
                    ))}
                  </div>
                  <div className="mt-4 space-y-3">
                    {visibleTimelineEvents.length === 0 ? (
                      <EmptyState text={t.common_not_set} />
                    ) : (
                      visibleTimelineEvents.map((item) => (
                        <div
                          key={item.id}
                          className="flex flex-col gap-3 rounded-2xl border border-slate-200/80 bg-slate-50/80 px-4 py-3 md:flex-row md:items-start md:justify-between"
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-semibold text-slate-950">
                                {item.title}
                              </p>
                              <span
                                className={cn(
                                  "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]",
                                  timelineToneClass(item.tone),
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
                          Coordinate the assigned team and schedule post-care
                          follow-up from the appointment itself.
                        </p>
                      </div>
                      <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                        {handoffStakeholders.length} stakeholder
                        {handoffStakeholders.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="mt-4 space-y-3">
                      {handoffStakeholders.length === 0 ? (
                        <EmptyState text={tr.common_not_set} />
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
                        <Field label={tr.patients_assign_owner}>
                          <select
                            value={followUpAssigneeId}
                            onChange={(event) =>
                              setFollowUpAssigneeId(event.target.value)
                            }
                            className={selectClassName}
                          >
                            <option value="">{tr.common_not_set}</option>
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
                {!detail.is_blocked &&
                permissions.canCreate &&
                followUpVisitForm ? (
                  <section className={sectionCardClass("p-5")}>
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-950">
                          Follow-up visit planning
                        </h3>
                        <p className="text-xs text-slate-500">
                          Schedule the next control visit or examination
                          directly from the current appointment context.
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
                    <form
                      onSubmit={handleFollowUpVisitSubmit}
                      className="mt-4 space-y-4"
                    >
                      <Field label={t.appointments_title_col}>
                        <Input
                          value={followUpVisitForm.title}
                          onChange={(event) =>
                            setFollowUpVisitForm((current) =>
                              current
                                ? { ...current, title: event.target.value }
                                : current,
                            )
                          }
                          className="h-10 rounded-xl bg-slate-50"
                          required
                        />
                      </Field>
                      <div className="grid gap-4 md:grid-cols-3">
                        <Field label={t.appointments_date}>
                          <Input
                            type="date"
                            value={followUpVisitForm.date}
                            onChange={(event) =>
                              setFollowUpVisitForm((current) =>
                                current
                                  ? { ...current, date: event.target.value }
                                  : current,
                              )
                            }
                            className="h-10 rounded-xl bg-slate-50"
                            required
                          />
                        </Field>
                        <Field label={t.appointments_time}>
                          <Input
                            type="time"
                            value={followUpVisitForm.timeStart}
                            onChange={(event) =>
                              setFollowUpVisitForm((current) =>
                                current
                                  ? {
                                      ...current,
                                      timeStart: event.target.value,
                                    }
                                  : current,
                              )
                            }
                            className="h-10 rounded-xl bg-slate-50"
                          />
                        </Field>
                        <Field label={t.appointments_time}>
                          <Input
                            type="time"
                            value={followUpVisitForm.timeEnd}
                            onChange={(event) =>
                              setFollowUpVisitForm((current) =>
                                current
                                  ? { ...current, timeEnd: event.target.value }
                                  : current,
                              )
                            }
                            className="h-10 rounded-xl bg-slate-50"
                          />
                        </Field>
                      </div>
                      <div className="grid gap-4 md:grid-cols-2">
                        <Field label={t.common_provider}>
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
                                  : current,
                              )
                            }
                            className={selectClassName}
                            disabled={
                              followUpVisitForm.appointmentType === "internal"
                            }
                          >
                            <option value="">{t.common_not_set}</option>
                            {providers.map((provider) => (
                              <option key={provider.id} value={provider.id}>
                                {provider.name}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label={t.common_doctor}>
                          <select
                            value={followUpVisitForm.doctorId}
                            onChange={(event) =>
                              setFollowUpVisitForm((current) =>
                                current
                                  ? { ...current, doctorId: event.target.value }
                                  : current,
                              )
                            }
                            className={selectClassName}
                            disabled={!followUpVisitForm.providerId}
                          >
                            <option value="">{t.common_not_set}</option>
                            {followUpVisitDoctors.map((doctor) => (
                              <option key={doctor.id} value={doctor.id}>
                                {doctorLabel(doctor)}
                              </option>
                            ))}
                          </select>
                        </Field>
                      </div>
                      <div className="grid gap-4 md:grid-cols-2">
                        <Field label={t.patients_assign_owner}>
                          <select
                            value={followUpVisitForm.ownerUserId}
                            onChange={(event) =>
                              setFollowUpVisitForm((current) =>
                                current
                                  ? {
                                      ...current,
                                      ownerUserId: event.target.value,
                                    }
                                  : current,
                              )
                            }
                            className={selectClassName}
                          >
                            <option value="">{t.common_not_set}</option>
                            {staff.map((member) => (
                              <option key={member.id} value={member.id}>
                                {member.name} · {roleLabel(member.role)}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label={t.common_doctor}>
                          <select
                            value={followUpVisitForm.interpreterId}
                            onChange={(event) =>
                              setFollowUpVisitForm((current) =>
                                current
                                  ? {
                                      ...current,
                                      interpreterId: event.target.value,
                                    }
                                  : current,
                              )
                            }
                            className={selectClassName}
                          >
                            <option value="">{t.common_not_set}</option>
                            {interpreters.map((member) => (
                              <option key={member.id} value={member.id}>
                                {member.name} · {roleLabel(member.role)}
                              </option>
                            ))}
                          </select>
                        </Field>
                      </div>
                      <div className="grid gap-4 md:grid-cols-2">
                        <Field label={appointmentText("Versorgungspfad", "Траектория лечения", "Care path")}>
                          <select
                            value={followUpVisitForm.carePathKind}
                            onChange={(event) =>
                              setFollowUpVisitForm((current) =>
                                current
                                  ? {
                                      ...current,
                                      carePathKind: event.target
                                        .value as AppointmentCarePathKind,
                                    }
                                  : current,
                              )
                            }
                            className={selectClassName}
                            disabled={
                              followUpVisitForm.appointmentType !== "medical"
                            }
                          >
                            {CARE_PATH_KIND_OPTIONS.map((value) => (
                              <option key={value} value={value}>
                                {carePathKindLabel(value)}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label={t.appointments_location}>
                          <Input
                            value={followUpVisitForm.location}
                            onChange={(event) =>
                              setFollowUpVisitForm((current) =>
                                current
                                  ? { ...current, location: event.target.value }
                                  : current,
                              )
                            }
                            className="h-10 rounded-xl bg-slate-50"
                          />
                        </Field>
                        <Field label={tr.documents_category}>
                          <Input
                            value={followUpVisitForm.category}
                            onChange={(event) =>
                              setFollowUpVisitForm((current) =>
                                current
                                  ? { ...current, category: event.target.value }
                                  : current,
                              )
                            }
                            className="h-10 rounded-xl bg-slate-50"
                          />
                        </Field>
                      </div>
                      <Field label={t.patients_notes}>
                        <textarea
                          value={followUpVisitForm.notes}
                          onChange={(event) =>
                            setFollowUpVisitForm((current) =>
                              current
                                ? { ...current, notes: event.target.value }
                                : current,
                            )
                          }
                          className={textareaClassName}
                          rows={4}
                          placeholder={tr.patients_notes}
                        />
                      </Field>
                      {detail.order_id ? (
                        <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            checked={followUpVisitForm.linkOrder}
                            onChange={(event) =>
                              setFollowUpVisitForm((current) =>
                                current
                                  ? {
                                      ...current,
                                      linkOrder: event.target.checked,
                                    }
                                  : current,
                              )
                            }
                            className="mt-0.5 size-4 rounded border-slate-300 text-slate-950"
                          />
                          <span>{tr.providers_linked_patients}</span>
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
                                  ? {
                                      ...current,
                                      createReminder: event.target.checked,
                                    }
                                  : current,
                              )
                            }
                            className="mt-0.5 size-4 rounded border-slate-300 text-slate-950"
                          />
                          <span>
                            Create a preparation reminder on the new follow-up
                            visit.
                          </span>
                        </label>
                        <Field label={tr.patients_assign_owner}>
                          <select
                            value={followUpVisitForm.reminderUserId}
                            onChange={(event) =>
                              setFollowUpVisitForm((current) =>
                                current
                                  ? {
                                      ...current,
                                      reminderUserId: event.target.value,
                                    }
                                  : current,
                              )
                            }
                            className={selectClassName}
                            disabled={!followUpVisitForm.createReminder}
                          >
                            <option value="">{tr.common_not_set}</option>
                            {staff.map((member) => (
                              <option key={member.id} value={member.id}>
                                {member.name} · {roleLabel(member.role)}
                              </option>
                            ))}
                          </select>
                        </Field>
                      </div>
                      {followUpVisitForm.createReminder ? (
                        <Field label={tr.appointments_date}>
                          <Input
                            type="datetime-local"
                            value={followUpVisitForm.reminderAt}
                            onChange={(event) =>
                              setFollowUpVisitForm((current) =>
                                current
                                  ? {
                                      ...current,
                                      reminderAt: event.target.value,
                                    }
                                  : current,
                              )
                            }
                            className="h-10 rounded-xl bg-slate-50"
                          />
                        </Field>
                      ) : null}
                      <ConflictPanel conflicts={followUpVisitConflicts} />
                      <ScheduleWarningsPanel
                        warnings={followUpVisitLocalWarnings}
                      />
                      <div className="flex justify-end">
                        <Button
                          type="submit"
                          className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
                          disabled={
                            followUpVisitBusy || !followUpVisitForm.title.trim()
                          }
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
                          {t.appointments_doctor_directed_followup_title}
                        </h3>
                        <p className="text-xs text-slate-500">
                          {t.appointments_doctor_directed_followup_subtitle}
                        </p>
                      </div>
                      <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                        {doctorDirectedReminders.length +
                          doctorDirectedTasks.length}{" "}
                        {doctorDirectedReminders.length +
                          doctorDirectedTasks.length ===
                        1
                          ? t.appointments_directed_item_singular
                          : t.appointments_directed_item_plural}
                      </span>
                    </div>
                    <div className="mt-4 grid gap-4 xl:grid-cols-2">
                      <div className="space-y-3">
                        <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                            {t.appointments_reminder_trail}
                          </p>
                          <div className="mt-3 space-y-3">
                            {doctorDirectedReminders.length === 0 ? (
                              <EmptyState text={tr.common_not_set} />
                            ) : (
                              doctorDirectedReminders.map((item) => (
                                <div
                                  key={item.id}
                                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
                                >
                                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                                    <div>
                                      <p className="text-sm font-medium text-slate-900">
                                        {item.title.replace(
                                          `${DOCTOR_FOLLOW_UP_PREFIX} `,
                                          "",
                                        )}
                                      </p>
                                      <p className="mt-1 text-xs text-slate-500">
                                        {item.user_name} ·{" "}
                                        {formatDateTimeLabel(item.remind_at)}
                                      </p>
                                    </div>
                                    {item.is_completed ? (
                                      <span className="text-xs font-medium text-emerald-700">
                                        {t.common_completed}{" "}
                                        {formatDateTimeLabel(item.completed_at)}
                                      </span>
                                    ) : (
                                      <span className="text-xs font-medium text-amber-700">
                                        {t.common_pending}
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
                            {t.appointments_task_trail}
                          </p>
                          <div className="mt-3 space-y-3">
                            {doctorDirectedTasks.length === 0 ? (
                              <EmptyState text={tr.common_not_set} />
                            ) : (
                              doctorDirectedTasks.map((task) => (
                                <div
                                  key={task.id}
                                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
                                >
                                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                                    <div>
                                      <p className="text-sm font-medium text-slate-900">
                                        {task.title.replace(
                                          `${DOCTOR_FOLLOW_UP_PREFIX} `,
                                          "",
                                        )}
                                      </p>
                                      <p className="mt-1 text-xs text-slate-500">
                                        {task.assigned_to_name} ·{" "}
                                        {taskStatusLabel(task.status)} ·{" "}
                                        {taskPriorityLabel(task.priority)}
                                      </p>
                                    </div>
                                    <span className="text-xs text-slate-500">
                                      {task.due_date
                                        ? formatDateTimeLabel(task.due_date)
                                        : t.common_not_set}
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
                        <form
                          onSubmit={handleDoctorFollowUpSubmit}
                          className="space-y-4 rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4"
                        >
                          <Field label={tr.appointments_title_col}>
                            <Input
                              value={doctorFollowUpForm.title}
                              onChange={(event) =>
                                setDoctorFollowUpForm((current) => ({
                                  ...current,
                                  title: event.target.value,
                                }))
                              }
                              placeholder={tr.appointments_title_col}
                              className="h-10 rounded-xl bg-white"
                              required
                            />
                          </Field>
                          <Field label={t.patients_assign_owner}>
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
                              <option value="">{tr.common_not_set}</option>
                              {doctorFollowUpAssignees.map((member) => (
                                <option key={member.id} value={member.id}>
                                  {member.name} · {roleLabel(member.role)}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <Field label={tr.invoices_due_at}>
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
                          <Field label={tr.patients_notes}>
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
                              placeholder={tr.patients_notes}
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
                                Mirror this directive as an operational task for
                                execution and ownership.
                              </span>
                            </label>
                            <Field label={tr.appointments_title_col}>
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
                          <EmptyState text={tr.common_not_set} />
                        </div>
                      )}
                    </div>
                  </section>
                ) : null}
                {!detail.is_blocked &&
                permissions.canManageChecklist &&
                permissions.canViewReminders ? (
                  <section className={sectionCardClass("p-5")}>
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-950">
                          Incoming unprocessed medical data
                        </h3>
                        <p className="text-xs text-slate-500">
                          Capture incoming updates from patients, doctors,
                          interpreters or clinics that still need triage,
                          categorization and case update.
                        </p>
                      </div>
                      <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                        {openIncomingDataChecklistCount === 0 &&
                        incomingDataChecklist.length > 0
                          ? "Intake clear"
                          : `${openIncomingDataChecklistCount} open`}
                      </span>
                    </div>
                    <div className="mt-4 grid gap-4 md:grid-cols-3">
                      <ContextCard
                        label={t.cases_status}
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
                        label={t.common_search}
                        value={
                          incomingDataReminders.length === 0
                            ? "0"
                            : String(incomingDataReminders.length)
                        }
                        meta="Deadline control for data triage and processing."
                      />
                      <ContextCard
                        label={t.cases_title}
                        value={
                          incomingDataTasks.length === 0
                            ? "0"
                            : String(incomingDataTasks.length)
                        }
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
                              <EmptyState text={tr.common_not_set} />
                            ) : (
                              incomingDataChecklist.map((item) => (
                                <div
                                  key={item.id}
                                  className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 md:flex-row md:items-center md:justify-between"
                                >
                                  <div>
                                    <p className="text-sm font-medium text-slate-900">
                                      {item.item_text.replace(
                                        `${INCOMING_DATA_CHECKLIST_PREFIX} `,
                                        "",
                                      )}
                                    </p>
                                    <p className="mt-1 text-xs uppercase tracking-[0.12em] text-slate-500">
                                      {item.phase}
                                    </p>
                                  </div>
                                  {item.is_completed ? (
                                    <span className="text-xs font-medium text-emerald-700">
                                      Completed{" "}
                                      {formatDateTimeLabel(item.completed_at)}
                                    </span>
                                  ) : (
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="rounded-2xl"
                                      disabled={Boolean(actionBusy)}
                                      onClick={() =>
                                        handleChecklistComplete(item.id)
                                      }
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
                            {incomingDataReminders.length === 0 &&
                            incomingDataTasks.length === 0 ? (
                              <EmptyState text={tr.common_not_set} />
                            ) : (
                              <>
                                {incomingDataReminders.map((item) => (
                                  <div
                                    key={item.id}
                                    className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
                                  >
                                    <p className="text-sm font-medium text-slate-900">
                                      {item.title.replace(
                                        `${INCOMING_DATA_PREFIX} `,
                                        "",
                                      )}
                                    </p>
                                    <p className="mt-1 text-xs text-slate-500">
                                      {item.user_name} ·{" "}
                                      {formatDateTimeLabel(item.remind_at)}
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
                                        {task.title.replace(
                                          `${INCOMING_DATA_PREFIX} `,
                                          "",
                                        )}
                                      </p>
                                      <span className="text-xs text-slate-500">
                                        {taskStatusLabel(task.status)} ·{" "}
                                        {taskPriorityLabel(task.priority)}
                                      </span>
                                    </div>
                                    <p className="mt-1 text-xs text-slate-500">
                                      {task.assigned_to_name}
                                      {task.due_date
                                        ? ` · ${formatDateTimeLabel(task.due_date)}`
                                        : ""}
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
                          <Field label={tr.documents_source}>
                            <select
                              value={incomingDataForm.source}
                              onChange={(event) =>
                                setIncomingDataForm((current) => ({
                                  ...current,
                                  source: event.target
                                    .value as IncomingDataSource,
                                }))
                              }
                              className={selectClassName}
                            >
                              <option value="patient">
                                {tr.orders_patient}
                              </option>
                              <option value="doctor">{tr.common_doctor}</option>
                              <option value="clinic">
                                {tr.common_provider}
                              </option>
                              <option value="interpreter">
                                {tr.role_interpreter}
                              </option>
                              <option value="external_lab">
                                {tr.common_provider}
                              </option>
                              <option value="other">{tr.common_not_set}</option>
                            </select>
                          </Field>
                          <Field label={tr.documents_category}>
                            <select
                              value={incomingDataForm.category}
                              onChange={(event) =>
                                setIncomingDataForm((current) => ({
                                  ...current,
                                  category: event.target
                                    .value as IncomingDataCategory,
                                }))
                              }
                              className={selectClassName}
                            >
                              <option value="medical_update">
                                Medical update
                              </option>
                              <option value="diagnosis">
                                {tr.cases_preconditions}
                              </option>
                              <option value="medication">
                                {tr.cases_medications}
                              </option>
                              <option value="symptom">
                                {tr.cases_symptoms}
                              </option>
                              <option value="lab_result">
                                {tr.cases_title}
                              </option>
                              <option value="imaging">
                                {tr.documents_title}
                              </option>
                              <option value="recommendation">
                                Recommendation
                              </option>
                              <option value="risk_flag">
                                {tr.common_error}
                              </option>
                              <option value="other">{tr.common_not_set}</option>
                            </select>
                          </Field>
                        </div>
                        <div className="grid gap-4 md:grid-cols-2">
                          <Field label={t.patients_assign_owner}>
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
                              <option value="">{tr.common_not_set}</option>
                              {doctorFollowUpAssignees.map((member) => (
                                <option key={member.id} value={member.id}>
                                  {member.name} · {roleLabel(member.role)}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <Field label={tr.invoices_due_at}>
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
                        <Field label={tr.patients_notes}>
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
                            placeholder={tr.patients_notes}
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
                            <span>{tr.cases_subtitle}</span>
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
                            <span>{tr.appointments_title}</span>
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
                            <span>{tr.providers_linked_patients}</span>
                          </label>
                          <Field label={tr.appointments_title_col}>
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
                {!detail.is_blocked &&
                permissions.canViewReminders &&
                detail.order_id ? (
                  <section className={sectionCardClass("p-5")}>
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-950">
                          Package-end follow-up
                        </h3>
                        <p className="text-xs text-slate-500">
                          Schedule the required reminder one month before the
                          linked package or order window ends.
                        </p>
                      </div>
                      <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                        {packageEndReminders.length + packageEndTasks.length}{" "}
                        package item
                        {packageEndReminders.length + packageEndTasks.length ===
                        1
                          ? ""
                          : "s"}
                      </span>
                    </div>
                    <div className="mt-4 grid gap-4 xl:grid-cols-2">
                      <div className="space-y-3">
                        {packageEndReminders.length === 0 &&
                        packageEndTasks.length === 0 ? (
                          <EmptyState text={tr.common_not_set} />
                        ) : (
                          <>
                            {packageEndReminders.map((item) => (
                              <div
                                key={item.id}
                                className="rounded-2xl border border-slate-200/80 bg-slate-50/80 px-4 py-3"
                              >
                                <p className="text-sm font-medium text-slate-900">
                                  {item.title.replace(
                                    `${PACKAGE_END_FOLLOW_UP_PREFIX} `,
                                    "",
                                  )}
                                </p>
                                <p className="mt-1 text-xs text-slate-500">
                                  {item.user_name} ·{" "}
                                  {formatDateTimeLabel(item.remind_at)}
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
                                    {task.title.replace(
                                      `${PACKAGE_END_FOLLOW_UP_PREFIX} `,
                                      "",
                                    )}
                                  </p>
                                  <span className="text-xs text-slate-500">
                                    {taskStatusLabel(task.status)} ·{" "}
                                    {taskPriorityLabel(task.priority)}
                                  </span>
                                </div>
                                <p className="mt-1 text-xs text-slate-500">
                                  {task.assigned_to_name}
                                  {task.due_date
                                    ? ` · ${formatDateTimeLabel(task.due_date)}`
                                    : ""}
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
                          <Field label={t.appointments_date}>
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
                          <Field label={tr.appointments_title_col}>
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
                          <Field label={t.patients_assign_owner}>
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
                              <option value="">{tr.common_not_set}</option>
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
                                    { months: -1 },
                                  ),
                                ),
                              )}
                              .
                            </div>
                          ) : null}
                          <Field label={t.patients_notes}>
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
                              placeholder={tr.patients_notes}
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
                              <span>{tr.providers_linked_patients}</span>
                            </label>
                            <Field label={tr.appointments_title_col}>
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
                permissions.canViewCommunications &&
                (detail.provider_id || detail.doctor_id) ? (
                  <section className={sectionCardClass("p-5")}>
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-950">
                          Clinic and doctor handoff trail
                        </h3>
                        <p className="text-xs text-slate-500">
                          External communication log for clinics, doctors and
                          service providers, plus linked internal follow-up.
                        </p>
                      </div>
                      <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                        {externalCommunicationEntries.length} communication
                        {externalCommunicationEntries.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="mt-4 grid gap-4 xl:grid-cols-2">
                      <div className="space-y-3">
                        {externalCommunicationEntries.length === 0 &&
                        externalHandoffReminders.length === 0 &&
                        externalHandoffTasks.length === 0 ? (
                          <EmptyState text={tr.common_not_set} />
                        ) : (
                          <>
                            {externalCommunicationEntries.map((item) => (
                              <div
                                key={item.id}
                                className="rounded-2xl border border-slate-200/80 bg-slate-50/80 px-4 py-3"
                              >
                                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                                  <div className="min-w-0">
                                    <p className="text-sm font-medium text-slate-900">
                                      {item.subject}
                                    </p>
                                    <p className="mt-1 text-xs text-slate-500">
                                      {item.created_by_name} · {item.direction}{" "}
                                      via{" "}
                                      {communicationChannelLabel(item.channel)}{" "}
                                      ·{" "}
                                      {communicationTargetLabel(
                                        item.target_type,
                                        detail,
                                      )}
                                      {item.contact_name
                                        ? ` · ${item.contact_name}`
                                        : ""}
                                      {item.due_at
                                        ? ` · due ${formatDateTimeLabel(item.due_at)}`
                                        : ""}
                                    </p>
                                  </div>
                                  <span
                                    className={cn(
                                      "rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em]",
                                      communicationStatusBadgeClass(
                                        item.status,
                                      ),
                                    )}
                                  >
                                    {communicationStatusLabel(item.status)}
                                  </span>
                                </div>
                                {item.message ? (
                                  <p className="mt-3 whitespace-pre-line text-sm text-slate-600">
                                    {item.message}
                                  </p>
                                ) : null}
                                {permissions.canManageCommunications ? (
                                  <div className="mt-4 flex flex-wrap gap-2">
                                    {item.status !== "answered" &&
                                    item.status !== "closed" &&
                                    item.status !== "cancelled" ? (
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="rounded-2xl"
                                        disabled={
                                          actionBusy ===
                                          `communication:${item.id}:answered`
                                        }
                                        onClick={() =>
                                          handleCommunicationStatusUpdate(
                                            item.id,
                                            "answered",
                                          )
                                        }
                                      >
                                        {actionBusy ===
                                        `communication:${item.id}:answered` ? (
                                          <LoaderCircle className="size-4 animate-spin" />
                                        ) : null}
                                        Mark answered
                                      </Button>
                                    ) : null}
                                    {item.status !== "closed" &&
                                    item.status !== "cancelled" ? (
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="rounded-2xl"
                                        disabled={
                                          actionBusy ===
                                          `communication:${item.id}:closed`
                                        }
                                        onClick={() =>
                                          handleCommunicationStatusUpdate(
                                            item.id,
                                            "closed",
                                          )
                                        }
                                      >
                                        {actionBusy ===
                                        `communication:${item.id}:closed` ? (
                                          <LoaderCircle className="size-4 animate-spin" />
                                        ) : null}
                                        Close
                                      </Button>
                                    ) : null}
                                    {item.status !== "cancelled" ? (
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="rounded-2xl"
                                        disabled={
                                          actionBusy ===
                                          `communication:${item.id}:cancelled`
                                        }
                                        onClick={() =>
                                          handleCommunicationStatusUpdate(
                                            item.id,
                                            "cancelled",
                                          )
                                        }
                                      >
                                        {actionBusy ===
                                        `communication:${item.id}:cancelled` ? (
                                          <LoaderCircle className="size-4 animate-spin" />
                                        ) : null}
                                        Cancel
                                      </Button>
                                    ) : null}
                                  </div>
                                ) : null}
                              </div>
                            ))}
                            {permissions.canViewReminders &&
                            (externalHandoffReminders.length > 0 ||
                              externalHandoffTasks.length > 0) ? (
                              <div className="rounded-2xl border border-dashed border-slate-200 bg-white/70 p-4">
                                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                                  Internal follow-up trail
                                </p>
                                <div className="mt-3 space-y-3">
                                  {externalHandoffReminders.map((item) => (
                                    <div
                                      key={item.id}
                                      className="rounded-2xl border border-slate-200/80 bg-slate-50/80 px-4 py-3"
                                    >
                                      <p className="text-sm font-medium text-slate-900">
                                        {item.title.replace(
                                          `${EXTERNAL_HANDOFF_PREFIX} `,
                                          "",
                                        )}
                                      </p>
                                      <p className="mt-1 text-xs text-slate-500">
                                        {item.user_name} ·{" "}
                                        {formatDateTimeLabel(item.remind_at)}
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
                                          {task.title.replace(
                                            `${EXTERNAL_HANDOFF_PREFIX} `,
                                            "",
                                          )}
                                        </p>
                                        <span className="text-xs text-slate-500">
                                          {taskStatusLabel(task.status)} ·{" "}
                                          {taskPriorityLabel(task.priority)}
                                        </span>
                                      </div>
                                      <p className="mt-1 text-xs text-slate-500">
                                        {task.assigned_to_name}
                                        {task.due_date
                                          ? ` · ${formatDateTimeLabel(task.due_date)}`
                                          : ""}
                                      </p>
                                      {task.description ? (
                                        <p className="mt-3 whitespace-pre-line text-sm text-slate-600">
                                          {task.description}
                                        </p>
                                      ) : null}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                          </>
                        )}
                      </div>
                      {permissions.canManageCommunications ? (
                        <form
                          onSubmit={handleExternalHandoffSubmit}
                          className="space-y-4 rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4"
                        >
                          <div className="grid gap-4 md:grid-cols-2">
                            <Field label={tr.patients_assign_owner}>
                              <select
                                value={externalHandoffForm.target}
                                onChange={(event) =>
                                  setExternalHandoffForm((current) => ({
                                    ...current,
                                    target: event.target
                                      .value as ExternalHandoffFormState["target"],
                                  }))
                                }
                                className={selectClassName}
                              >
                                <option
                                  value="clinic"
                                  disabled={!detail.provider_id}
                                >
                                  Clinic
                                </option>
                                <option
                                  value="service_provider"
                                  disabled={!detail.provider_id}
                                >
                                  Service provider
                                </option>
                                <option
                                  value="doctor"
                                  disabled={!detail.doctor_id}
                                >
                                  Doctor
                                </option>
                              </select>
                            </Field>
                            <Field label={tr.documents_source}>
                              <select
                                value={externalHandoffForm.channel}
                                onChange={(event) =>
                                  setExternalHandoffForm((current) => ({
                                    ...current,
                                    channel: event.target
                                      .value as AppointmentCommunicationChannel,
                                  }))
                                }
                                className={selectClassName}
                              >
                                {COMMUNICATION_CHANNEL_OPTIONS.map((value) => (
                                  <option key={value} value={value}>
                                    {communicationChannelLabel(value)}
                                  </option>
                                ))}
                              </select>
                            </Field>
                          </div>
                          <div className="grid gap-4 md:grid-cols-3">
                            <Field label={tr.documents_source}>
                              <select
                                value={externalHandoffForm.direction}
                                onChange={(event) =>
                                  setExternalHandoffForm((current) => ({
                                    ...current,
                                    direction: event.target
                                      .value as AppointmentCommunicationDirection,
                                  }))
                                }
                                className={selectClassName}
                              >
                                <option value="outbound">
                                  {tr.common_active}
                                </option>
                                <option value="inbound">
                                  {tr.common_active}
                                </option>
                              </select>
                            </Field>
                            <Field label={t.users_status}>
                              <select
                                value={externalHandoffForm.status}
                                onChange={(event) =>
                                  setExternalHandoffForm((current) => ({
                                    ...current,
                                    status: event.target
                                      .value as AppointmentCommunicationStatus,
                                  }))
                                }
                                className={selectClassName}
                              >
                                {COMMUNICATION_STATUS_OPTIONS.map((value) => (
                                  <option key={value} value={value}>
                                    {communicationStatusLabel(value)}
                                  </option>
                                ))}
                              </select>
                            </Field>
                            <Field label={t.patients_assign_owner}>
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
                                <option value="">{tr.common_not_set}</option>
                                {doctorFollowUpAssignees.map((member) => (
                                  <option key={member.id} value={member.id}>
                                    {member.name} · {roleLabel(member.role)}
                                  </option>
                                ))}
                              </select>
                            </Field>
                          </div>
                          <Field label={tr.appointments_title_col}>
                            <Input
                              value={externalHandoffForm.title}
                              onChange={(event) =>
                                setExternalHandoffForm((current) => ({
                                  ...current,
                                  title: event.target.value,
                                }))
                              }
                              placeholder={tr.appointments_title_col}
                              className="h-10 rounded-xl bg-white"
                              required
                            />
                          </Field>
                          <Field label={tr.field_phone}>
                            <Input
                              value={externalHandoffForm.contactName}
                              onChange={(event) =>
                                setExternalHandoffForm((current) => ({
                                  ...current,
                                  contactName: event.target.value,
                                }))
                              }
                              placeholder={tr.common_doctor}
                              className="h-10 rounded-xl bg-white"
                            />
                          </Field>
                          <Field label={tr.invoices_due_at}>
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
                            />
                          </Field>
                          <Field label={tr.patients_notes}>
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
                              placeholder={tr.patients_notes}
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
                              <span>
                                Mirror this communication as an internal task
                                when assignee and due date are set.
                              </span>
                            </label>
                            <Field label={tr.appointments_title_col}>
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
                                !externalHandoffForm.title.trim()
                              }
                            >
                              {externalHandoffBusy ? (
                                <LoaderCircle className="size-4 animate-spin" />
                              ) : null}
                              Log communication
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
                          Track missing findings, translation needs and patient
                          dispatch from the appointment itself.
                        </p>
                      </div>
                      <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                        {openFindingsChecklistCount === 0 &&
                        findingsChecklist.length > 0
                          ? "Follow-up ready"
                          : `${openFindingsChecklistCount} open`}
                      </span>
                    </div>
                    <div className="mt-4 grid gap-4 md:grid-cols-3">
                      <ContextCard
                        label={t.cases_status}
                        value={
                          findingsChecklist.length === 0
                            ? "Not started"
                            : `${findingsChecklist.length} item(s)`
                        }
                        meta={
                          findingsChecklist.length === 0
                            ? "No document follow-up checklist yet."
                            : `${openFindingsChecklistCount} item(s) still open.`
                        }
                      />
                      <ContextCard
                        label={t.common_search}
                        value={
                          findingsReminders.length === 0
                            ? "0"
                            : String(findingsReminders.length)
                        }
                        meta="Timing control for missing findings and document handling."
                      />
                      <ContextCard
                        label={t.cases_title}
                        value={
                          findingsTasks.length === 0
                            ? "0"
                            : String(findingsTasks.length)
                        }
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
                              <EmptyState text={tr.common_not_set} />
                            ) : (
                              findingsChecklist.map((item) => (
                                <div
                                  key={item.id}
                                  className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 md:flex-row md:items-center md:justify-between"
                                >
                                  <div>
                                    <p className="text-sm font-medium text-slate-900">
                                      {item.item_text.replace(
                                        `${FINDINGS_CHECKLIST_PREFIX} `,
                                        "",
                                      )}
                                    </p>
                                    <p className="mt-1 text-xs uppercase tracking-[0.12em] text-slate-500">
                                      {item.phase}
                                    </p>
                                  </div>
                                  {item.is_completed ? (
                                    <span className="text-xs font-medium text-emerald-700">
                                      Completed{" "}
                                      {formatDateTimeLabel(item.completed_at)}
                                    </span>
                                  ) : (
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="rounded-2xl"
                                      disabled={Boolean(actionBusy)}
                                      onClick={() =>
                                        handleChecklistComplete(item.id)
                                      }
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
                            {findingsReminders.length === 0 &&
                            findingsTasks.length === 0 ? (
                              <EmptyState text={tr.common_not_set} />
                            ) : (
                              <>
                                {findingsReminders.map((item) => (
                                  <div
                                    key={item.id}
                                    className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
                                  >
                                    <p className="text-sm font-medium text-slate-900">
                                      {item.title.replace(
                                        `${FINDINGS_FOLLOW_UP_PREFIX} `,
                                        "",
                                      )}
                                    </p>
                                    <p className="mt-1 text-xs text-slate-500">
                                      {item.user_name} ·{" "}
                                      {formatDateTimeLabel(item.remind_at)}
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
                                        {task.title.replace(
                                          `${FINDINGS_FOLLOW_UP_PREFIX} `,
                                          "",
                                        )}
                                      </p>
                                      <span className="text-xs text-slate-500">
                                        {taskStatusLabel(task.status)} ·{" "}
                                        {taskPriorityLabel(task.priority)}
                                      </span>
                                    </div>
                                    <p className="mt-1 text-xs text-slate-500">
                                      {task.assigned_to_name}
                                      {task.due_date
                                        ? ` · ${formatDateTimeLabel(task.due_date)}`
                                        : ""}
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
                            <Field label={tr.documents_filename}>
                              <select
                                value={findingsFollowUpForm.artifact}
                                onChange={(event) =>
                                  setFindingsFollowUpForm((current) => ({
                                    ...current,
                                    artifact: event.target
                                      .value as FindingsFollowUpArtifact,
                                  }))
                                }
                                className={selectClassName}
                              >
                                <option value="arztbrief">Arztbrief</option>
                                <option value="written_findings">
                                  Written findings
                                </option>
                                <option value="both">
                                  Arztbrief + written findings
                                </option>
                              </select>
                            </Field>
                            <Field label={t.patients_assign_owner}>
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
                                <option value="">{tr.common_not_set}</option>
                                {doctorFollowUpAssignees.map((member) => (
                                  <option key={member.id} value={member.id}>
                                    {member.name} · {roleLabel(member.role)}
                                  </option>
                                ))}
                              </select>
                            </Field>
                          </div>
                          <Field label={tr.invoices_due_at}>
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
                          <Field label={tr.patients_notes}>
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
                              placeholder={tr.patients_notes}
                            />
                          </Field>
                          <div className="grid gap-3 md:grid-cols-2">
                            <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                              <input
                                type="checkbox"
                                checked={
                                  findingsFollowUpForm.translationRequired
                                }
                                onChange={(event) =>
                                  setFindingsFollowUpForm((current) => ({
                                    ...current,
                                    translationRequired: event.target.checked,
                                  }))
                                }
                                className="mt-0.5 size-4 rounded border-slate-300 text-slate-950"
                              />
                              <span>{tr.common_loading}</span>
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
                              <span>
                                Patient dispatch required after processing.
                              </span>
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
                              <span>
                                Create a linked task for the findings workflow.
                              </span>
                            </label>
                            <Field label={tr.appointments_title_col}>
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
                          Review operational blockers before closing the
                          appointment and launching standard post-care
                          follow-up.
                        </p>
                      </div>
                      <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                        {detail.status === "completed"
                          ? "Completed"
                          : statusLabel(detail.status)}
                      </span>
                    </div>
                    <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                      <ContextCard
                        label={t.cases_status}
                        value={
                          openChecklistCount === 0
                            ? "Ready"
                            : `${openChecklistCount} open`
                        }
                        meta={
                          openChecklistCount === 0
                            ? "No pending checklist items."
                            : "Finish outstanding preparation or follow-up steps."
                        }
                      />
                      <ContextCard
                        label={t.cases_title}
                        value={
                          openTaskCount === 0
                            ? "Ready"
                            : `${openTaskCount} open`
                        }
                        meta={
                          openTaskCount === 0
                            ? "No open operational tasks."
                            : "Resolve active PM, interpreter or concierge tasks."
                        }
                      />
                      <ContextCard
                        label={t.common_search}
                        value={appointmentText(
                          `${pendingReminderCount} ausstehend`,
                          `${pendingReminderCount} ожидает`,
                          `${pendingReminderCount} pending`,
                        )}
                        meta={
                          pendingReminderCount === 0
                            ? appointmentText(
                                "Keine offenen Erinnerungen.",
                                "Нет активных напоминаний.",
                                "No outstanding reminders.",
                              )
                            : appointmentText(
                                "Offene Erinnerungen bleiben auch nach dem Abschluss aktiv.",
                                "Ожидающие напоминания остаются активными и после закрытия.",
                                "Pending reminders stay active after closure.",
                              )
                        }
                      />
                      <ContextCard
                        label={tr.role_interpreter}
                        value={
                          !detail.interpreter_id
                            ? appointmentText("Nicht erforderlich", "Не требуется", "Not required")
                            : interpreterReportReady
                              ? appointmentText("Freigegeben", "Согласовано", "Approved")
                              : appointmentText("Ausstehend", "Ожидается", "Pending")
                        }
                        meta={
                          !detail.interpreter_id
                            ? appointmentText(
                                "Kein Dolmetscher verknupft.",
                                "Переводчик не привязан.",
                                "No interpreter linked.",
                              )
                            : detailReport
                              ? detailReport.approval_status
                              : appointmentText(
                                  "Noch kein Bericht eingereicht.",
                                  "Отчёт ещё не отправлен.",
                                  "No report submitted yet.",
                                )
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
                    {detail.status !== "completed" &&
                    detail.status !== "cancelled" ? (
                      <div className="mt-5 space-y-4">
                        <Field label={tr.patients_assign_owner}>
                          <select
                            value={followUpAssigneeId}
                            onChange={(event) =>
                              setFollowUpAssigneeId(event.target.value)
                            }
                            className={selectClassName}
                          >
                            <option value="">{tr.common_not_set}</option>
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
                              variant={
                                completionPlan[preset.id]
                                  ? "default"
                                  : "outline"
                              }
                              size="sm"
                              className={cn(
                                "rounded-2xl",
                                completionPlan[preset.id]
                                  ? "bg-slate-950 text-white hover:bg-slate-800"
                                  : "",
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
                            {t.appointments_complete_only}
                          </Button>
                          <Button
                            type="button"
                            className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
                            disabled={
                              completionBusy ||
                              Boolean(actionBusy) ||
                              (selectedCompletionPresetCount > 0 &&
                                !followUpAssigneeId)
                            }
                            onClick={handleCompleteWithFollowUp}
                          >
                            {completionBusy ? (
                              <LoaderCircle className="size-4 animate-spin" />
                            ) : null}
                            {t.appointments_complete_and_schedule}
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </section>
                ) : null}
                {permissions.canManageStatus ? (
                  <section className={sectionCardClass("p-5")}>
                    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-950">
                          {t.users_status}
                        </h3>
                        {detail.recurrence_frequency ? (
                          <p className="mt-1 text-xs text-slate-500">
                            {t.appointments_scope_bulk_status_hint}
                          </p>
                        ) : null}
                      </div>
                      {detail.recurrence_frequency ? (
                        <div className="w-full md:w-[240px]">
                          <Field label={t.appointments_scope_apply_status}>
                            <select
                              value={statusRecurrenceScope}
                              onChange={(event) =>
                                setStatusRecurrenceScope(
                                  event.target
                                    .value as AppointmentRecurringActionScope,
                                )
                              }
                              className={selectClassName}
                            >
                              <option value="single">
                                {t.appointments_scope_single}
                              </option>
                              <option value="following">
                                {t.appointments_scope_following}
                              </option>
                              <option value="series">
                                {t.appointments_scope_series}
                              </option>
                            </select>
                          </Field>
                        </div>
                      ) : null}
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {STATUS_OPTIONS.map((status) => (
                        <Button
                          key={status}
                          variant={
                            detail.status === status ? "default" : "outline"
                          }
                          className={cn(
                            "rounded-2xl",
                            detail.status === status
                              ? "bg-slate-950 text-white hover:bg-slate-800"
                              : "",
                          )}
                          disabled={Boolean(actionBusy)}
                          onClick={() =>
                            handleStatusChange(
                              status,
                              detail.recurrence_frequency
                                ? statusRecurrenceScope
                                : "single",
                            )
                          }
                        >
                          {actionBusy ===
                          statusActionKey(
                            detail.id,
                            status,
                            detail.recurrence_frequency
                              ? statusRecurrenceScope
                              : "single",
                          ) ? (
                            <LoaderCircle className="size-4 animate-spin" />
                          ) : null}
                          {detail.recurrence_frequency && status === "cancelled"
                            ? statusRecurrenceScope === "following"
                              ? t.appointments_cancel_this_and_following
                              : statusRecurrenceScope === "series"
                                ? t.appointments_cancel_whole_series
                                : "Cancel this occurrence"
                            : statusLabel(status)}
                        </Button>
                      ))}
                    </div>
                    {detail.recurrence_frequency ? (
                      <div className="mt-4 space-y-3">
                        <p className="text-xs text-slate-500">
                          {t.appointments_scope_targets}{" "}
                          <span className="font-semibold text-slate-700">
                            {selectedRecurringStatusTargets.length}
                          </span>{" "}
                          {selectedRecurringStatusTargets.length === 1
                            ? t.appointments_active_occurrence
                            : t.appointments_active_occurrences}
                          .
                        </p>
                        {completionScopeBlockers.length > 0 ? (
                          <Banner tone="warning">
                            Completing this scope is currently blocked by{" "}
                            {completionScopeBlockers.length} occurrence
                            {completionScopeBlockers.length === 1
                              ? ""
                              : "s"}:{" "}
                            {completionScopeBlockers
                              .map((item) => recurringOccurrenceLabel(item, t))
                              .join("; ")}
                          </Banner>
                        ) : null}
                      </div>
                    ) : null}
                  </section>
                ) : null}
                {permissions.canEditSchedule && editForm ? (
                  <section className={sectionCardClass("p-5")}>
                    <h3 className="text-sm font-semibold text-slate-950">
                      {t.appointments_title}
                    </h3>
                    {editError ? (
                      <div className="mt-4">
                        <Banner tone="error">{editError}</Banner>
                      </div>
                    ) : null}
                    <form
                      onSubmit={handleEditSubmit}
                      className="mt-4 space-y-4"
                    >
                      <Field label={t.appointments_title_col}>
                        <Input
                          value={editForm.title}
                          onChange={(event) =>
                            setEditForm((current) =>
                              current
                                ? { ...current, title: event.target.value }
                                : current,
                            )
                          }
                          className="h-10 rounded-xl bg-slate-50"
                        />
                      </Field>
                      <Field label={appointmentText("Versorgungspfad", "Траектория лечения", "Care path")}>
                        <select
                          value={editForm.carePathKind}
                          onChange={(event) =>
                            setEditForm((current) =>
                              current
                                ? {
                                    ...current,
                                    carePathKind: event.target
                                      .value as AppointmentCarePathKind,
                                  }
                                : current,
                            )
                          }
                          className={selectClassName}
                          disabled={detail.type !== "medical"}
                        >
                          {CARE_PATH_KIND_OPTIONS.map((value) => (
                            <option key={value} value={value}>
                              {carePathKindLabel(value)}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <div className="grid gap-4 md:grid-cols-3">
                        <Field label={t.appointments_date}>
                          <Input
                            type="date"
                            value={editForm.date}
                            onChange={(event) =>
                              setEditForm((current) =>
                                current
                                  ? { ...current, date: event.target.value }
                                  : current,
                              )
                            }
                            className="h-10 rounded-xl bg-slate-50"
                          />
                        </Field>
                        <Field label={t.appointments_time}>
                          <Input
                            type="time"
                            value={editForm.timeStart}
                            onChange={(event) =>
                              setEditForm((current) =>
                                current
                                  ? {
                                      ...current,
                                      timeStart: event.target.value,
                                    }
                                  : current,
                              )
                            }
                            className="h-10 rounded-xl bg-slate-50"
                          />
                        </Field>
                        <Field label={t.appointments_time}>
                          <Input
                            type="time"
                            value={editForm.timeEnd}
                            onChange={(event) =>
                              setEditForm((current) =>
                                current
                                  ? { ...current, timeEnd: event.target.value }
                                  : current,
                              )
                            }
                            className="h-10 rounded-xl bg-slate-50"
                          />
                        </Field>
                      </div>
                      <div className="grid gap-4 md:grid-cols-2">
                        <Field label={t.common_provider}>
                          <select
                            value={editForm.providerId}
                            onChange={(event) =>
                              setEditForm((current) =>
                                current
                                  ? {
                                      ...current,
                                      providerId: event.target.value,
                                      doctorId: "",
                                    }
                                  : current,
                              )
                            }
                            className={selectClassName}
                            disabled={detail.type === "internal"}
                          >
                            <option value="">{t.common_not_set}</option>
                            {providers.map((provider) => (
                              <option key={provider.id} value={provider.id}>
                                {provider.name}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label={t.common_doctor}>
                          <select
                            value={editForm.doctorId}
                            onChange={(event) =>
                              setEditForm((current) =>
                                current
                                  ? { ...current, doctorId: event.target.value }
                                  : current,
                              )
                            }
                            className={selectClassName}
                            disabled={!editForm.providerId}
                          >
                            <option value="">{t.common_not_set}</option>
                            {editDoctors.map((doctor) => (
                              <option key={doctor.id} value={doctor.id}>
                                {doctorLabel(doctor)}
                              </option>
                            ))}
                          </select>
                        </Field>
                      </div>
                      <div className="grid gap-4 md:grid-cols-2">
                        <Field label={t.patients_assign_owner}>
                          <select
                            value={editForm.ownerUserId}
                            onChange={(event) =>
                              setEditForm((current) =>
                                current
                                  ? {
                                      ...current,
                                      ownerUserId: event.target.value,
                                    }
                                  : current,
                              )
                            }
                            className={selectClassName}
                          >
                            <option value="">{t.common_not_set}</option>
                            {staff.map((member) => (
                              <option key={member.id} value={member.id}>
                                {member.name} · {roleLabel(member.role)}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label={t.common_doctor}>
                          <select
                            value={editForm.interpreterId}
                            onChange={(event) =>
                              setEditForm((current) =>
                                current
                                  ? {
                                      ...current,
                                      interpreterId: event.target.value,
                                    }
                                  : current,
                              )
                            }
                            className={selectClassName}
                          >
                            <option value="">{t.common_not_set}</option>
                            {interpreters.map((member) => (
                              <option key={member.id} value={member.id}>
                                {member.name} · {roleLabel(member.role)}
                              </option>
                            ))}
                          </select>
                        </Field>
                      </div>
                      <Field label={t.appointments_location}>
                        <Input
                          value={editForm.location}
                          onChange={(event) =>
                            setEditForm((current) =>
                              current
                                ? { ...current, location: event.target.value }
                                : current,
                            )
                          }
                          className="h-10 rounded-xl bg-slate-50"
                        />
                      </Field>
                      {detail.recurrence_frequency ? (
                        <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3">
                          <Field label={t.appointments_scope_apply_schedule}>
                            <select
                              value={editRecurrenceScope}
                              onChange={(event) =>
                                setEditRecurrenceScope(
                                  event.target
                                    .value as AppointmentRecurringActionScope,
                                )
                              }
                              className={selectClassName}
                            >
                              <option value="single">
                                {t.appointments_scope_single}
                              </option>
                              <option value="following">
                                {t.appointments_scope_following}
                              </option>
                              <option value="series">
                                {t.appointments_scope_series}
                              </option>
                            </select>
                          </Field>
                          <p className="mt-2 text-xs text-sky-800">
                            {t.appointments_scope_following_hint}
                          </p>
                          <div className="mt-4 grid gap-4 md:grid-cols-2">
                            <Field label={appointmentText("Wiederholungsrhythmus", "Частота повторения", "Repeat frequency")}>
                              <select
                                value={editForm.repeatFrequency}
                                onChange={(event) =>
                                  setEditForm((current) =>
                                    current
                                      ? {
                                          ...current,
                                          repeatFrequency: event.target
                                            .value as AppointmentRecurrenceFrequency,
                                        }
                                      : current,
                                  )
                                }
                                className={selectClassName}
                                disabled={editRecurrenceScope === "single"}
                              >
                                <option value="daily">{recurrenceFrequencyLabel("daily")}</option>
                                <option value="weekly">{recurrenceFrequencyLabel("weekly")}</option>
                                <option value="monthly">{recurrenceFrequencyLabel("monthly")}</option>
                              </select>
                            </Field>
                            <Field label={appointmentText("Wiederholen alle", "Повторять каждые", "Repeat every")}>
                              <Input
                                inputMode="numeric"
                                pattern="[0-9]*"
                                value={editForm.repeatInterval}
                                onChange={(event) =>
                                  setEditForm((current) =>
                                    current
                                      ? {
                                          ...current,
                                          repeatInterval: event.target.value,
                                        }
                                      : current,
                                  )
                                }
                                className="h-10 rounded-xl bg-white/80"
                                disabled={editRecurrenceScope === "single"}
                              />
                            </Field>
                            <Field label={appointmentText("Anzahl Termine", "Всего повторов", "Total occurrences")}>
                              <Input
                                inputMode="numeric"
                                pattern="[0-9]*"
                                value={editForm.repeatCount}
                                onChange={(event) =>
                                  setEditForm((current) =>
                                    current
                                      ? {
                                          ...current,
                                          repeatCount: event.target.value,
                                        }
                                      : current,
                                  )
                                }
                                className="h-10 rounded-xl bg-white/80"
                                placeholder={appointmentText(
                                  "Optional, wenn ein Enddatum gesetzt ist",
                                  "Необязательно, если указана дата окончания",
                                  "Optional when repeat-until is set",
                                )}
                                disabled={editRecurrenceScope === "single"}
                              />
                            </Field>
                            <Field label={appointmentText("Wiederholen bis", "Повторять до", "Repeat until")}>
                              <Input
                                type="date"
                                value={editForm.repeatUntil}
                                onChange={(event) =>
                                  setEditForm((current) =>
                                    current
                                      ? {
                                          ...current,
                                          repeatUntil: event.target.value,
                                        }
                                      : current,
                                  )
                                }
                                className="h-10 rounded-xl bg-white/80"
                                disabled={editRecurrenceScope === "single"}
                              />
                            </Field>
                          </div>
                          <p className="mt-3 text-xs text-sky-800">
                            Recurrence rule edits only apply when you target
                            <span className="font-semibold">
                              {" "}
                              this and following
                            </span>{" "}
                            or the{" "}
                            <span className="font-semibold">whole series</span>.
                            Single-occurrence updates keep the current slot
                            detached from rule changes.
                          </p>
                        </div>
                      ) : null}
                      <ConflictPanel conflicts={editConflicts} />
                      <ScheduleWarningsPanel warnings={editLocalWarnings} />
                      <div className="flex justify-end">
                        <Button
                          type="submit"
                          className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
                          disabled={editBusy}
                        >
                          {editBusy ? (
                            <LoaderCircle className="size-4 animate-spin" />
                          ) : null}
                          {editBusy ? t.patients_saving : t.common_save}
                        </Button>
                      </div>
                    </form>
                  </section>
                ) : null}
                {permissions.canAssignInterpreter && !detail.is_blocked ? (
                  <section className={sectionCardClass("p-5")}>
                    <h3 className="text-sm font-semibold text-slate-950">
                      {t.role_interpreter}
                    </h3>
                    <form
                      onSubmit={handleAssignInterpreter}
                      className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]"
                    >
                      <Field label={t.common_doctor}>
                        <select
                          value={editForm?.interpreterId ?? ""}
                          onChange={(event) =>
                            setEditForm((current) =>
                              current
                                ? {
                                    ...current,
                                    interpreterId: event.target.value,
                                  }
                                : current,
                            )
                          }
                          className={selectClassName}
                        >
                          <option value="">{t.common_not_set}</option>
                          {interpreters.map((member) => (
                            <option key={member.id} value={member.id}>
                              {member.name} · {roleLabel(member.role)}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <div className="flex items-end">
                        <Button
                          type="submit"
                          className="rounded-2xl"
                          disabled={
                            !editForm?.interpreterId || actionBusy === "assign"
                          }
                        >
                          {actionBusy === "assign" ? (
                            <LoaderCircle className="size-4 animate-spin" />
                          ) : null}
                          Assign interpreter
                        </Button>
                      </div>
                    </form>
                  </section>
                ) : null}
                {permissions.canRespondToAssignment &&
                detail.interpreter_id === user?.id ? (
                  <section className={sectionCardClass("p-5")}>
                    <h3 className="text-sm font-semibold text-slate-950">
                      {t.role_interpreter}
                    </h3>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {INTERPRETER_RESPONSE_OPTIONS.map((value) => (
                        <Button
                          key={value}
                          variant={
                            detail.interpreter_response === value
                              ? "default"
                              : "outline"
                          }
                          className="rounded-2xl"
                          disabled={Boolean(actionBusy)}
                          onClick={() => handleInterpreterResponse(value)}
                        >
                          {actionBusy === `response:${value}` ? (
                            <LoaderCircle className="size-4 animate-spin" />
                          ) : null}
                          {responseLabel(value)}
                        </Button>
                      ))}
                    </div>
                  </section>
                ) : null}
                {permissions.canManageChecklist ? (
                  <section className={sectionCardClass("p-5")}>
                    <h3 className="text-sm font-semibold text-slate-950">
                      {t.orders_phase}
                    </h3>
                    <div className="mt-4 space-y-3">
                      {detailChecklist.length === 0 ? (
                        <EmptyState text={t.common_not_set} />
                      ) : (
                        detailChecklist.map((item) => (
                          <div
                            key={item.id}
                            className="flex flex-col gap-3 rounded-2xl border border-slate-200/80 bg-slate-50/80 px-4 py-3 md:flex-row md:items-center md:justify-between"
                          >
                            <div>
                              <p className="text-sm font-medium text-slate-900">
                                {item.item_text}
                              </p>
                              <p className="mt-1 text-xs uppercase tracking-[0.12em] text-slate-500">
                                {item.phase}
                              </p>
                            </div>
                            {item.is_completed ? (
                              <span className="text-xs font-medium text-emerald-700">
                                {t.common_completed}{" "}
                                {formatDateTimeLabel(item.completed_at)}
                              </span>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                className="rounded-2xl"
                                disabled={Boolean(actionBusy)}
                                onClick={() => handleChecklistComplete(item.id)}
                              >
                                {actionBusy === `check:${item.id}` ? (
                                  <LoaderCircle className="size-4 animate-spin" />
                                ) : null}
                                {t.common_active}
                              </Button>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                    <form
                      onSubmit={handleChecklistSubmit}
                      className="mt-5 grid gap-4 md:grid-cols-[180px_minmax(0,1fr)_auto]"
                    >
                      <Field label={t.orders_phase}>
                        <select
                          value={checklistForm.phase}
                          onChange={(event) =>
                            setChecklistForm((current) => ({
                              ...current,
                              phase: event.target.value,
                            }))
                          }
                          className={selectClassName}
                        >
                          {CHECKLIST_PHASES.map((phase) => (
                            <option key={phase} value={phase}>
                              {phase}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label={t.orders_phase}>
                        <Input
                          value={checklistForm.itemText}
                          onChange={(event) =>
                            setChecklistForm((current) => ({
                              ...current,
                              itemText: event.target.value,
                            }))
                          }
                          placeholder={tr.appointments_title_col}
                          className="h-10 rounded-xl bg-slate-50"
                          required
                        />
                      </Field>
                      <div className="flex items-end">
                        <Button
                          type="submit"
                          className="rounded-2xl"
                          disabled={
                            checklistBusy || !checklistForm.itemText.trim()
                          }
                        >
                          {checklistBusy ? (
                            <LoaderCircle className="size-4 animate-spin" />
                          ) : null}
                          Add checklist item
                        </Button>
                      </div>
                    </form>
                  </section>
                ) : null}
                {permissions.canViewReminders ? (
                  <section className={sectionCardClass("p-5")}>
                    <h3 className="text-sm font-semibold text-slate-950">
                      {t.patients_notes}
                    </h3>
                    <div className="mt-4 space-y-3">
                      {detailReminders.length === 0 ? (
                        <EmptyState text={t.common_not_set} />
                      ) : (
                        detailReminders.map((item) => (
                          <div
                            key={item.id}
                            className="flex flex-col gap-3 rounded-2xl border border-slate-200/80 bg-slate-50/80 px-4 py-3 md:flex-row md:items-center md:justify-between"
                          >
                            <div>
                              <p className="text-sm font-medium text-slate-900">
                                {item.title}
                              </p>
                              <p className="mt-1 text-xs text-slate-500">
                                {item.user_name} ·{" "}
                                {formatDateTimeLabel(item.remind_at)}
                              </p>
                              {item.description ? (
                                <p className="mt-2 text-sm text-slate-600">
                                  {item.description}
                                </p>
                              ) : null}
                            </div>
                            {item.is_completed ? (
                              <span className="text-xs font-medium text-emerald-700">
                                Completed{" "}
                                {formatDateTimeLabel(item.completed_at)}
                              </span>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                className="rounded-2xl"
                                disabled={Boolean(actionBusy)}
                                onClick={() => handleReminderComplete(item.id)}
                              >
                                {actionBusy === `reminder:${item.id}` ? (
                                  <LoaderCircle className="size-4 animate-spin" />
                                ) : null}
                                {t.common_active}
                              </Button>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                    {permissions.canManageReminders ? (
                      <form
                        onSubmit={handleReminderSubmit}
                        className="mt-5 grid gap-4 md:grid-cols-2"
                      >
                        <Field label={t.patients_assign_owner}>
                          <select
                            value={reminderForm.userId}
                            onChange={(event) =>
                              setReminderForm((current) => ({
                                ...current,
                                userId: event.target.value,
                              }))
                            }
                            className={selectClassName}
                            required
                          >
                            <option value="">{t.common_not_set}</option>
                            {staff.map((member) => (
                              <option key={member.id} value={member.id}>
                                {member.name} · {roleLabel(member.role)}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label={t.appointments_date}>
                          <Input
                            type="datetime-local"
                            value={reminderForm.remindAt}
                            onChange={(event) =>
                              setReminderForm((current) => ({
                                ...current,
                                remindAt: event.target.value,
                              }))
                            }
                            className="h-10 rounded-xl bg-slate-50"
                            required
                          />
                        </Field>
                        <Field label={t.appointments_title_col}>
                          <Input
                            value={reminderForm.title}
                            onChange={(event) =>
                              setReminderForm((current) => ({
                                ...current,
                                title: event.target.value,
                              }))
                            }
                            className="h-10 rounded-xl bg-slate-50"
                            required
                          />
                        </Field>
                        <Field label={t.providers_service_desc}>
                          <textarea
                            value={reminderForm.description}
                            onChange={(event) =>
                              setReminderForm((current) => ({
                                ...current,
                                description: event.target.value,
                              }))
                            }
                            className={textareaClassName}
                            rows={3}
                          />
                        </Field>
                        <div className="md:col-span-2 flex justify-end">
                          <Button
                            type="submit"
                            className="rounded-2xl"
                            disabled={
                              reminderBusy ||
                              !reminderForm.userId ||
                              !reminderForm.remindAt ||
                              !reminderForm.title.trim()
                            }
                          >
                            {reminderBusy ? (
                              <LoaderCircle className="size-4 animate-spin" />
                            ) : null}
                            {t.appointments_add_reminder}
                          </Button>
                        </div>
                      </form>
                    ) : null}
                  </section>
                ) : null}
                {permissions.canViewReport ? (
                  <section className={sectionCardClass("p-5")}>
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-950">
                          {t.appointments_interpreter_report_title}
                        </h3>
                        <p className="text-xs text-slate-500">
                          {t.appointments_interpreter_report_subtitle}
                        </p>
                      </div>
                      {detailReport ? (
                        <span
                          className={cn(
                            "rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]",
                            reportApprovalBadgeClass(
                              detailReport.approval_status,
                            ),
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
                            label={t.common_doctor}
                            value={detailReport.interpreter_name}
                            meta={`${t.appointments_report_submitted_prefix} ${formatDateTimeLabel(detailReport.created_at)}`}
                          />
                          <ContextCard
                            label={t.appointments_time}
                            value={`${detailReport.hours} h`}
                            meta={
                              detailReport.approval_status === "approved"
                                ? interpreterReportBillingSyncLabel(
                                    detailReport.billing_sync_status,
                                    t,
                                  )
                                : detailReport.approval_status === "rejected"
                                  ? t.appointments_report_needs_interpreter_revision
                                  : t.appointments_report_waiting_teamlead_review
                            }
                          />
                          <ContextCard
                            label={tr.patients_notes}
                            value={
                              detailReport.approved_by_name ??
                              (detailReport.approval_status === "pending"
                                ? t.common_pending
                                : t.appointments_report_no_reviewer_recorded)
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
                            <span className="font-medium">
                              {t.appointments_report_reviewer_notes}:
                            </span>{" "}
                            {detailReport.notes}
                          </Banner>
                        ) : null}

                        {detailReport.approval_status === "approved" ? (
                          <div
                            className={cn(
                              "rounded-2xl border px-4 py-3 text-sm",
                              interpreterReportBillingSyncClass(
                                detailReport.billing_sync_status,
                              ),
                            )}
                          >
                            <div className="font-medium">
                              {t.appointments_report_billing_sync}
                            </div>
                            <div className="mt-1">
                              {interpreterReportBillingSyncLabel(
                                detailReport.billing_sync_status,
                                t,
                              )}
                            </div>
                            <div className="mt-1 text-xs opacity-80">
                              {detailReport.billing_service_key ? (
                                <span>
                                  Catalog key:{" "}
                                  {detailReport.billing_service_key}
                                </span>
                              ) : null}
                              {detailReport.billing_service_key &&
                              detailReport.billing_leistung_id
                                ? " · "
                                : null}
                              {detailReport.billing_leistung_id ? (
                                <span>
                                  Order line: {detailReport.billing_leistung_id}
                                </span>
                              ) : null}
                            </div>
                          </div>
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
                        <EmptyState text={tr.common_not_set} />
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
                              The latest report was returned. Update the hours
                              or report text and resubmit it for teamlead
                              approval.
                            </Banner>
                          </div>
                        ) : null}
                        <Field label={t.appointments_time}>
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
                        <Field label={tr.patients_notes}>
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
                            placeholder={tr.patients_notes}
                          />
                        </Field>
                        <div className="md:col-span-2 flex justify-end">
                          <Button
                            type="submit"
                            className="rounded-2xl"
                            disabled={
                              actionBusy === "report-submit" ||
                              !reportForm.hours
                            }
                          >
                            {actionBusy === "report-submit" ? (
                              <LoaderCircle className="size-4 animate-spin" />
                            ) : null}
                            {canResubmitRejectedReport
                              ? "Resubmit report"
                              : t.common_save}
                          </Button>
                        </div>
                      </form>
                    ) : null}

                    {showReportReviewActions ? (
                      <div className="mt-5 grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
                        <Field label={tr.patients_notes}>
                          <textarea
                            value={reportRejectReason}
                            onChange={(event) =>
                              setReportRejectReason(event.target.value)
                            }
                            className={textareaClassName}
                            rows={3}
                            placeholder={tr.patients_notes}
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
                          Appointment-linked follow-up for PM, teamlead,
                          interpreter and concierge.
                        </p>
                      </div>
                      <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                        {detailTasks.length} linked
                      </span>
                    </div>
                    <div className="mt-4 space-y-3">
                      {detailTasks.length === 0 ? (
                        <EmptyState text={tr.common_not_set} />
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
                                  {task.assigned_to_name} ·{" "}
                                  {roleLabel(task.assigned_to_role)}
                                  {task.due_date
                                    ? appointmentText(
                                        ` · Fallig ${formatDateTimeLabel(task.due_date)}`,
                                        ` · Срок ${formatDateTimeLabel(task.due_date)}`,
                                        ` · Due ${formatDateTimeLabel(task.due_date)}`,
                                      )
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
                                    variant={
                                      task.status === status
                                        ? "default"
                                        : "outline"
                                    }
                                    size="sm"
                                    className={cn(
                                      "rounded-2xl",
                                      task.status === status
                                        ? "bg-slate-950 text-white hover:bg-slate-800"
                                        : "",
                                    )}
                                    disabled={
                                      Boolean(actionBusy) ||
                                      task.status === status
                                    }
                                    onClick={() =>
                                      handleTaskStatus(task.id, status)
                                    }
                                  >
                                    {actionBusy ===
                                    `task:${task.id}:${status}` ? (
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
                        <Field label={tr.appointments_title_col}>
                          <Input
                            value={taskForm.title}
                            onChange={(event) =>
                              setTaskForm((current) => ({
                                ...current,
                                title: event.target.value,
                              }))
                            }
                            placeholder={tr.appointments_title_col}
                            className="h-10 rounded-xl bg-slate-50"
                            required
                          />
                        </Field>
                        <Field label={tr.patients_assign_owner}>
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
                            <option value="">{tr.common_not_set}</option>
                            {taskAssignableStaff.map((member) => (
                              <option key={member.id} value={member.id}>
                                {member.name} · {roleLabel(member.role)}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label={tr.invoices_due_at}>
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
                        <Field label={t.users_status}>
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
                        <Field label={t.providers_service_desc}>
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
                            placeholder={tr.patients_notes}
                          />
                        </Field>
                        <div className="flex items-end justify-end md:col-span-2">
                          <Button
                            type="submit"
                            className="rounded-2xl"
                            disabled={
                              taskBusy ||
                              !taskForm.title.trim() ||
                              !taskForm.assignedTo
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
                          Travel, transfer and VIP execution linked to this
                          appointment.
                        </p>
                      </div>
                      <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                        {detailServices.length} service
                        {detailServices.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="mt-4 space-y-4">
                      {detailServices.length === 0 ? (
                        <EmptyState text={tr.common_not_set} />
                      ) : (
                        detailServices.map((service) => {
                          const draft =
                            serviceDrafts[service.id] ??
                            buildServiceDraft(service);
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
                                        {billingStatusLabel(
                                          service.billing_status,
                                        )}
                                      </span>
                                    </div>
                                    <p className="mt-1 text-xs text-slate-500">
                                      {service.assigned_concierge_name ||
                                        tr.common_not_set}
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
                                        draft.currency || service.currency,
                                      )}
                                    </div>
                                    <div>
                                      Actual{" "}
                                      {formatMoneyLabel(
                                        draft.actualCost || service.actual_cost,
                                        draft.currency || service.currency,
                                      )}
                                    </div>
                                  </div>
                                </div>
                                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                                  {permissions.canManageConciergeBilling ? (
                                    <>
                                      <Field label={t.appointments_title_col}>
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
                                      <Field label={t.common_provider}>
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
                                          {nonMedicalProviders.map(
                                            (provider) => (
                                              <option
                                                key={provider.id}
                                                value={provider.id}
                                              >
                                                {provider.name}
                                              </option>
                                            ),
                                          )}
                                        </select>
                                      </Field>
                                      <Field label={tr.role_concierge}>
                                        <select
                                          value={draft.assignedConciergeId}
                                          onChange={(event) =>
                                            updateServiceDraft(service.id, {
                                              assignedConciergeId:
                                                event.target.value,
                                            })
                                          }
                                          className={selectClassName}
                                        >
                                          <option value="">No concierge</option>
                                          {conciergeStaff.map((member) => (
                                            <option
                                              key={member.id}
                                              value={member.id}
                                            >
                                              {member.name}
                                            </option>
                                          ))}
                                        </select>
                                      </Field>
                                    </>
                                  ) : null}
                                  <Field label={tr.users_status}>
                                    <select
                                      value={draft.status}
                                      onChange={(event) =>
                                        updateServiceDraft(service.id, {
                                          status: event.target.value,
                                        })
                                      }
                                      className={selectClassName}
                                    >
                                      {CONCIERGE_SERVICE_STATUS_OPTIONS.map(
                                        (status) => (
                                          <option key={status} value={status}>
                                            {taskStatusLabel(status)}
                                          </option>
                                        ),
                                      )}
                                    </select>
                                  </Field>
                                  <Field label={tr.appointments_title_col}>
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
                                  <Field label={tr.contracts_total}>
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
                                  <Field label={tr.common_provider}>
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
                                  <Field label={tr.field_phone}>
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
                                  <Field
                                    label={tr.providers_service_valid_from}
                                  >
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
                                  <Field label={tr.providers_service_valid_to}>
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
                                      <Field label={tr.users_status}>
                                        <select
                                          value={draft.billingStatus}
                                          onChange={(event) =>
                                            updateServiceDraft(service.id, {
                                              billingStatus: event.target.value,
                                            })
                                          }
                                          className={selectClassName}
                                        >
                                          {CONCIERGE_BILLING_STATUS_OPTIONS.map(
                                            (status) => (
                                              <option
                                                key={status}
                                                value={status}
                                              >
                                                {billingStatusLabel(status)}
                                              </option>
                                            ),
                                          )}
                                        </select>
                                      </Field>
                                      <Field label={tr.contracts_total}>
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
                                  <Field label={tr.patients_notes}>
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
                                    <Field label={tr.patients_notes}>
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
                                    disabled={
                                      actionBusy === `service:${service.id}`
                                    }
                                    onClick={() =>
                                      handleServiceSave(service.id)
                                    }
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
                        <Field label={tr.documents_category}>
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
                        <Field label={tr.appointments_title_col}>
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
                        <Field label={t.common_provider}>
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
                        <Field label={tr.role_concierge}>
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
                        <Field label={tr.providers_service_valid_from}>
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
                        <Field label={tr.providers_service_valid_to}>
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
                        <Field label={tr.common_provider}>
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
                        <Field label={tr.field_phone}>
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
                        <Field label={tr.contracts_total}>
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
                        <Field label={tr.contracts_total}>
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
                        <Field label={tr.patients_notes}>
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
                          {appointmentText(
                            "Ubergabe an Abrechnung und Settlement",
                            "Передача в биллинг и расчёты",
                            "Billing and settlement handoff",
                          )}
                        </h3>
                        <p className="text-xs text-slate-500">
                          {appointmentText(
                            "Strukturierte Ubergabe an die Abrechnung, bevor die Dokumentenschicht nachzieht.",
                            "Структурированная передача в биллинг до того, как подключится документный слой.",
                            "Structured transfer to billing before the document layer lands.",
                          )}
                        </p>
                      </div>
                      <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                        {billingHandoffTasks.length +
                          billingHandoffReminders.length}{" "}
                        {appointmentText("verknupft", "связано", "linked")}
                      </span>
                    </div>

                    <div className="mt-4 grid gap-3 xl:grid-cols-3">
                      <ContextCard
                        label={tr.role_interpreter}
                        value={
                          detail?.interpreter_id
                            ? interpreterReportReady && detailReport
                              ? appointmentText(
                                  `${detailReport.hours} Std. freigegeben`,
                                  `${detailReport.hours} ч согласовано`,
                                  `${detailReport.hours} h approved`,
                                )
                              : appointmentText(
                                  "Freigabe ausstehend",
                                  "Ожидает согласования",
                                  "Pending approval",
                                )
                            : appointmentText("Nicht erforderlich", "Не требуется", "Not required")
                        }
                        meta={
                          detail?.interpreter_id
                            ? detailReport
                              ? reportReviewMeta ||
                                reportApprovalLabel(
                                  detailReport.approval_status,
                                )
                              : appointmentText(
                                  "Kein Bericht eingereicht",
                                  "Отчёт не отправлен",
                                  "No report submitted",
                                )
                            : appointmentText(
                                "Kein Dolmetscher fur diesen Termin",
                                "Для этого приёма нет переводчика",
                                "No interpreter on this appointment",
                              )
                        }
                      />
                      <ContextCard
                        label={tr.role_concierge}
                        value={
                          detail?.type === "non_medical"
                            ? appointmentText(
                                `${readyConciergeServices.length} bereit / ${settledConciergeServices.length} abgerechnet`,
                                `${readyConciergeServices.length} готово / ${settledConciergeServices.length} выставлено`,
                                `${readyConciergeServices.length} ready / ${settledConciergeServices.length} billed`,
                              )
                            : appointmentText("Nicht anwendbar", "Не применимо", "Not applicable")
                        }
                        meta={
                          detail?.type === "non_medical"
                            ? appointmentText(
                                `${detailServices.length} Leistung(en) verknupft`,
                                `${detailServices.length} услуг(а) связано`,
                                `${detailServices.length} service(s) linked`,
                              )
                            : appointmentText(
                                "Medizinischer Termin",
                                "Медицинский приём",
                                "Medical appointment",
                              )
                        }
                      />
                      <ContextCard
                        label={tr.role_billing}
                        value={appointmentText(
                          `${openBillingHandoffTasks.length} offene Aufgabe(n)`,
                          `${openBillingHandoffTasks.length} открытых задач`,
                          `${openBillingHandoffTasks.length} open task(s)`,
                        )}
                        meta={appointmentText(
                          `${billingHandoffReminders.length} Erinnerung(en) verknupft`,
                          `${billingHandoffReminders.length} напоминаний связано`,
                          `${billingHandoffReminders.length} reminder(s) linked`,
                        )}
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
                            {appointmentText(
                              "Billing-Erinnerungen",
                              "Напоминания для биллинга",
                              "Billing reminders",
                            )}
                          </h4>
                          <span className="text-xs text-slate-500">
                            {billingHandoffReminders.length}{" "}
                            {appointmentText("verknupft", "связано", "linked")}
                          </span>
                        </div>
                        <div className="mt-3 space-y-3">
                          {billingHandoffReminders.length === 0 ? (
                            <EmptyState text={tr.common_not_set} />
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
                                  {item.user_name} ·{" "}
                                  {formatDateTimeLabel(item.remind_at)}
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
                            {appointmentText(
                              "Billing-Aufgaben",
                              "Задачи биллинга",
                              "Billing tasks",
                            )}
                          </h4>
                          <span className="text-xs text-slate-500">
                            {billingHandoffTasks.length}{" "}
                            {appointmentText("verknupft", "связано", "linked")}
                          </span>
                        </div>
                        <div className="mt-3 space-y-3">
                          {billingHandoffTasks.length === 0 ? (
                            <EmptyState text={tr.common_not_set} />
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
                                  {task.assigned_to_name} ·{" "}
                                  {roleLabel(task.assigned_to_role)}
                                  {task.due_date
                                    ? appointmentText(
                                        ` · Fallig ${formatDateTimeLabel(task.due_date)}`,
                                        ` · Срок ${formatDateTimeLabel(task.due_date)}`,
                                        ` · Due ${formatDateTimeLabel(task.due_date)}`,
                                      )
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
                        <Field label={tr.role_billing}>
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
                        <Field label={tr.role_billing}>
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
                            <option value="">
                              {appointmentText(
                                "Billing-Zustandigen auswahlen",
                                "Выберите ответственного из биллинга",
                                "Select billing assignee",
                              )}
                            </option>
                            {billingStaff.map((member) => (
                              <option key={member.id} value={member.id}>
                                {member.name} · {roleLabel(member.role)}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label={tr.invoices_due_at}>
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
                        <Field label={tr.appointments_title_col}>
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
                        <Field label={tr.appointments_title_col}>
                          <Input
                            value={billingHandoffForm.title}
                            onChange={(event) =>
                              setBillingHandoffForm((current) => ({
                                ...current,
                                title: event.target.value,
                              }))
                            }
                            className="h-10 rounded-xl bg-slate-50"
                            placeholder={tr.appointments_title_col}
                          />
                        </Field>
                        <Field label={t.patients_notes}>
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
                            placeholder={tr.patients_notes}
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
                {permissions.canViewNotes && !detail.is_blocked ? (
                  <section className={sectionCardClass("p-5")}>
                    <h3 className="text-sm font-semibold text-slate-950">
                      {t.patients_notes}
                    </h3>
                    <div className="mt-4 grid gap-4 md:grid-cols-3">
                      <TextPanel
                        title={t.phase_discovery}
                        text={detail.preparation_notes}
                      />
                      <TextPanel
                        title={t.phase_followup}
                        text={detail.followup_notes}
                      />
                      <TextPanel title={t.patients_notes} text={detail.notes} />
                    </div>
                  </section>
                ) : null}
              </div>
            ) : (
              <div className="flex min-h-[320px] items-center justify-center text-muted-foreground">
                Select an appointment from the calendar or list.
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

export function AppointmentsPage() {
  const { user } = useAuth();

  if (user?.role === "patient") {
    return <PatientAppointmentsPage />;
  }

  return <StaffAppointmentsPage />;
}

function StatsCard({
  icon: Icon,
  label,
  value,
  tone,
  compact = false,
  hideIcon = false,
  largeValue = false,
  valueRight = false,
}: {
  icon: typeof CalendarDays;
  label: string;
  value: string;
  tone: "sky" | "emerald" | "amber" | "rose" | "slate";
  compact?: boolean;
  hideIcon?: boolean;
  largeValue?: boolean;
  valueRight?: boolean;
}) {
  const toneClass =
    tone === "sky"
      ? "bg-sky-100 text-sky-700"
      : tone === "emerald"
        ? "bg-emerald-100 text-emerald-700"
        : tone === "amber"
          ? "bg-amber-100 text-amber-700"
          : tone === "rose"
            ? "bg-rose-100 text-rose-700"
            : "bg-slate-100 text-slate-700";
  return (
    <div
      className={cn(
        "relative flex h-full min-w-0 flex-col backdrop-blur",
        compact
          ? "min-h-[5.4rem] rounded-xl border border-slate-200 bg-slate-50 p-2"
          : "rounded-[1.2rem] border border-white/90 bg-white/88 p-3 pr-10",
      )}
    >
      {valueRight ? (
        <div className="flex items-end justify-between gap-2">
          <span
            className={cn(
              "block min-w-0 whitespace-normal break-words text-left font-semibold uppercase leading-tight text-slate-600",
              compact
                ? "text-[9px] tracking-[0.05em]"
                : "text-[11px] tracking-[0.08em]",
            )}
          >
            {label}
          </span>
          <p
            className={cn(
              "shrink-0 leading-none font-semibold tracking-tight text-slate-950",
              compact
                ? largeValue
                  ? "text-[1.9rem]"
                  : "text-xl"
                : "text-[2rem]",
            )}
          >
            {value}
          </p>
        </div>
      ) : (
        <>
          <span
            className={cn(
              "block w-full whitespace-normal break-words text-left font-semibold uppercase leading-tight text-slate-600",
              compact
                ? "min-h-[1.9rem] text-[9px] tracking-[0.05em]"
                : "text-[11px] tracking-[0.08em]",
            )}
          >
            {label}
          </span>
          <p
            className={cn(
              "leading-none font-semibold tracking-tight text-slate-950",
              compact
                ? largeValue
                  ? "mt-auto pt-1 text-[1.9rem]"
                  : "mt-auto pt-1 text-xl"
                : "mt-auto pt-2 text-[2rem]",
            )}
          >
            {value}
          </p>
        </>
      )}
      {hideIcon ? null : (
        <span
          className={cn(
            "absolute right-2 bottom-2 shrink-0",
            compact ? "rounded-lg p-1" : "rounded-xl p-1.5",
            toneClass,
          )}
        >
          <Icon className={compact ? "size-3" : "size-3.5"} />
        </span>
      )}
    </div>
  );
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
        "h-8 rounded-full px-3 text-xs",
        active ? "bg-slate-950 text-white hover:bg-slate-800" : "bg-white/80",
      )}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function MobileAgendaCard({
  item,
  onOpen,
}: {
  item: AppointmentListItem;
  onOpen: () => void;
}) {
  const summary =
    item.doctor_name ||
    item.provider_name ||
    item.location ||
    item.owner_name ||
    "Operational slot";

  return (
    <div className="rounded-[1.5rem] border border-slate-200/80 bg-slate-50/85 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <button
            type="button"
            onClick={onOpen}
            className="truncate text-left text-sm font-semibold text-slate-950 hover:text-sky-700"
          >
            {item.title}
          </button>
          <p className="mt-1 truncate text-xs text-slate-500">
            {item.patient_pid} · {item.patient_name}
          </p>
        </div>
        <span
          className={cn(
            "rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]",
            statusBadgeClass(item.status),
          )}
        >
          {statusLabel(item.status)}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1">
          <Clock3 className="size-3.5" />
          {slotLabel(item)}
        </span>
        {item.location ? (
          <span className="inline-flex items-center gap-1">
            <MapPin className="size-3.5" />
            {item.location}
          </span>
        ) : null}
      </div>

      <p className="mt-3 text-xs font-medium text-slate-600">{summary}</p>

      <div className="mt-3 flex flex-wrap gap-2">
        {item.interpreter_response ? (
          <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-sky-700">
            Interpreter {responseLabel(item.interpreter_response)}
          </span>
        ) : null}
        {item.recurrence_frequency ? (
          <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600">
            {recurrenceCadenceLabel(item)}
          </span>
        ) : null}
        {item.is_blocked ? (
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-700">
            {appointmentText("Blockierte Sicht", "Заблокированная видимость", "Blocked visibility")}
          </span>
        ) : null}
      </div>

      <div className="mt-4 flex justify-end">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="rounded-2xl"
          onClick={onOpen}
        >
          Open
        </Button>
      </div>
    </div>
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
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">
        {label}
      </p>
      <p className="mt-3 text-sm font-semibold text-slate-950">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{meta}</p>
    </div>
  );
}

function InfoLine({
  icon: Icon,
  label,
}: {
  icon: typeof Clock3;
  label: string;
}) {
  return (
    <div className="inline-flex items-center gap-2">
      <Icon className="size-4 text-slate-400" />
      <span>{label}</span>
    </div>
  );
}

function TextPanel({ title, text }: { title: string; text: string | null }) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">
        {title}
      </p>
      <p className="mt-3 text-sm leading-6 text-slate-700">
        {text?.trim() || "No notes captured yet."}
      </p>
    </div>
  );
}

function ConflictPanel({ conflicts }: { conflicts: ConflictSummary | null }) {
  if (!conflicts) return null;
  const items = [
    ...conflicts.patient_conflicts.map((item) => ({
      ...item,
      scope: "Patient",
    })),
    ...conflicts.interpreter_conflicts.map((item) => ({
      ...item,
      scope: "Interpreter",
    })),
  ].slice(0, 6);
  if (!conflicts.has_conflicts)
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
        No patient or interpreter overlaps detected for the current slot.
      </div>
    );
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0">
          <p className="font-semibold">
            {conflicts.patient_conflict_count +
              conflicts.interpreter_conflict_count}{" "}
            overlap(s) detected
          </p>
          <div className="mt-3 space-y-2">
            {items.map((item) => (
              <div
                key={`${item.scope}-${item.id}`}
                className="rounded-xl border border-amber-200/70 bg-white/75 px-3 py-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]">
                    {item.scope}
                  </span>
                  <span className="text-sm font-medium text-amber-900">
                    {item.title}
                  </span>
                </div>
                <p className="mt-1 text-xs text-amber-800">
                  {slotLabel(item)} · {item.patient_pid}
                  {item.interpreter_name ? ` · ${item.interpreter_name}` : ""}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ScheduleWarningsPanel({
  warnings,
}: {
  warnings: LocalScheduleWarning[];
}) {
  if (warnings.length === 0) return null;
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0">
          <p className="font-semibold">
            {appointmentText(
              "Lokaler Termindruck erkannt",
              "Обнаружен локальный конфликт расписания",
              "Local schedule pressure detected",
            )}
          </p>
          <div className="mt-3 space-y-2">
            {warnings.map((warning) => (
              <div
                key={warning.scope}
                className="rounded-xl border border-amber-200/70 bg-white/75 px-3 py-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]">
                    {warning.label}
                  </span>
                  <span className="text-sm font-medium text-amber-900">
                    {warning.label}
                  </span>
                </div>
                <p className="mt-1 text-xs text-amber-800">
                  {warning.items
                    .slice(0, 2)
                    .map((item) => `${item.title} · ${slotLabel(item)}`)
                    .join(" | ")}
                  {warning.items.length > 2
                    ? ` | +${warning.items.length - 2} more`
                    : ""}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
