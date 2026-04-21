import {
  memo,
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type SetStateAction,
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
import { DocumentsGrid } from "@/components/documents-grid";
import {
  CasesRosterSection,
  type CaseRosterItem,
} from "@/components/cases-roster-section";
import { CaseWorkspaceModal } from "@/components/case-workspace-modal";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  Banner,
  CountBadge,
  EmptyCell,
  InfoRow,
  inputClass,
  ListItem,
  Section,
  selectClass,
  StatCard,
  StatusBadge,
  textareaClass,
  tokens,
} from "@/components/ui-shell";
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
import { localizeDocumentCode } from "@/lib/required-document-labels";
import { cn } from "@/lib/utils";
import {
  buildInterpreterMobileAgendaSections,
  buildAppointmentTimelineEvents,
  canResubmitInterpreterReport,
  normalizeAppointmentWorkspaceTab,
  shouldUseInterpreterMobileAgenda,
  type AppointmentTimelineEvent,
  type AppointmentTimelineKind,
} from "@/pages/appointments.helpers";
import { PatientAppointmentsPage } from "@/pages/patient-appointments";
import {
  MemoizedPatientDetailSheet,
  type PatientAssignment as PatientSheetAssignment,
  type PatientDetail as PatientSheetDetail,
  type PatientsDictionary,
  type StaffOption as PatientSheetStaffOption,
} from "@/pages/patients";
import {
  type ProviderDetail as ProviderSheetDetail,
} from "@/pages/providers";

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
type LinkedPreviewKind =
  | "patient"
  | "order"
  | "provider"
  | "documents"
  | "cases";
type LinkedPreviewRecord = Record<string, unknown>;
type LinkedPreviewPayload = LinkedPreviewRecord | LinkedPreviewRecord[];
type LinkedDocumentItem = {
  id: string;
  patient_id: string | null;
  order_id: string | null;
  appointment_id: string | null;
  patient_pid: string | null;
  patient_name: string | null;
  order_number: string | null;
  appointment_title: string | null;
  auto_name: string;
  original_filename: string | null;
  art: string;
  category: string | null;
  status: string;
  visibility: string;
  mime_type: string | null;
  file_size: number | null;
  notes: string | null;
  uploaded_by_name: string | null;
  version_number: number;
  version_count: number;
  created_at: string;
  updated_at: string;
  share_count: number;
};

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

type LinkedPatientPermissions = {
  canCreateEdit: boolean;
  canViewAssignments: boolean;
  canManageAssignments: boolean;
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

type CreateAppointmentSheetProps = {
  open: boolean;
  seed: AppointmentFormState;
  appointments: AppointmentListItem[];
  patients: PatientSummary[];
  providers: ProviderSummary[];
  interpreters: InterpreterOption[];
  staff: StaffOption[];
  userId?: string;
  onOpenChange: (open: boolean) => void;
  onCreated: (result: { id: string; notice: string }) => void;
};

type EditAppointmentSectionProps = {
  detail: AppointmentDetail;
  appointments: AppointmentListItem[];
  providers: ProviderSummary[];
  staff: StaffOption[];
  interpreters: InterpreterOption[];
  onSaved: (notice: string) => void;
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
const TASK_ASSIGNABLE_ROLES = new Set([
  "patient_manager",
  "teamlead_interpreter",
  "interpreter",
  "concierge",
]);
const MAX_PROVIDER_DOCTORS_CACHE = 24;
const providerDoctorsCache = new Map<string, DoctorOption[]>();
const providerDoctorsInFlight = new Map<string, Promise<DoctorOption[]>>();

function rememberProviderDoctors(providerId: string, rows: DoctorOption[]) {
  if (providerDoctorsCache.has(providerId)) {
    providerDoctorsCache.delete(providerId);
  }
  providerDoctorsCache.set(providerId, rows);
  if (providerDoctorsCache.size > MAX_PROVIDER_DOCTORS_CACHE) {
    const oldestKey = providerDoctorsCache.keys().next().value;
    if (oldestKey) providerDoctorsCache.delete(oldestKey);
  }
}

async function getProviderDoctors(providerId: string) {
  const cached = providerDoctorsCache.get(providerId);
  if (cached) {
    rememberProviderDoctors(providerId, cached);
    return cached;
  }

  const inFlight = providerDoctorsInFlight.get(providerId);
  if (inFlight) return inFlight;

  const request = apiFetch<DoctorOption[]>(`/providers/${providerId}/doctors`)
    .then((rows) => {
      rememberProviderDoctors(providerId, rows);
      providerDoctorsInFlight.delete(providerId);
      return rows;
    })
    .catch((error) => {
      providerDoctorsInFlight.delete(providerId);
      throw error;
    });

  providerDoctorsInFlight.set(providerId, request);
  return request;
}

function useDebouncedValue<T>(value: T, delayMs = 180) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedValue(value);
    }, delayMs);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [delayMs, value]);

  return debouncedValue;
}

const selectClassName = cn(selectClass, "h-10 rounded-xl");
const textareaClassName = cn(textareaClass, "min-h-[96px]");
const createSheetInputClassName = inputClass;
const createSheetTextareaClassName = textareaClass;

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

function buildEditAppointmentForm(detail: AppointmentDetail): AppointmentFormState {
  return {
    patientId: detail.patient_id,
    providerId: detail.provider_id ?? "",
    doctorId: detail.doctor_id ?? "",
    ownerUserId: detail.owner_user_id ?? "",
    interpreterId: detail.interpreter_id ?? "",
    appointmentType: detail.type,
    carePathKind: detail.care_path_kind ?? "regular",
    title: detail.title,
    date: detail.date,
    timeStart: detail.time_start ?? "",
    timeEnd: detail.time_end ?? "",
    location: detail.location ?? "",
    category: detail.category ?? "",
    notes: detail.notes ?? "",
    repeatEnabled: Boolean(detail.recurrence_frequency),
    repeatFrequency: detail.recurrence_frequency ?? "weekly",
    repeatInterval: String(detail.recurrence_interval ?? 1),
    repeatCount: detail.recurrence_count ? String(detail.recurrence_count) : "",
    repeatUntil: detail.recurrence_until ?? "",
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

function resolveFollowUpDefaultAssignee(
  detail: AppointmentDetail,
  assignments: PatientAssignment[],
) {
  return (
    assignments.find(
      (item) =>
        !item.revoked_at &&
        item.user_active &&
        item.user_role === "patient_manager",
    )?.user_id ??
    detail.owner_user_id ??
    assignments.find((item) => !item.revoked_at && item.user_active)?.user_id ??
    ""
  );
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

function statusActionKey(
  appointmentId: string,
  status: AppointmentStatus,
  recurrenceScope: AppointmentRecurringActionScope = "single",
) {
  return recurrenceScope === "single"
    ? `status:${appointmentId}:${status}`
    : `status:${appointmentId}:${status}:${recurrenceScope}`;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeLinkedPreviewPayload(
  payload: unknown,
): LinkedPreviewPayload | null {
  if (Array.isArray(payload)) {
    return payload.filter(isRecord);
  }
  if (!isRecord(payload)) return null;
  if (Array.isArray(payload.items)) {
    return payload.items.filter(isRecord);
  }
  return payload;
}

function linkedPreviewText(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => linkedPreviewText(item)).join(", ");
  }
  return JSON.stringify(value);
}

function readLinkedPreviewValue(
  record: LinkedPreviewRecord,
  keys: string[],
): string {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && value !== "") {
      return linkedPreviewText(value);
    }
  }
  return "—";
}

function appointmentText(de: string, ru: string, _en: string) {
  void _en;
  return getLang() === "ru" ? ru : de;
}

function appointmentTypeLabel(
  type: AppointmentKind,
  tr?: Record<string, string>,
) {
  if (type === "non_medical")
    return tr?.apt_type_non_medical ??
      appointmentText("Nicht-medizinisch", "Немедицинский", "Non-medical");
  if (type === "internal")
    return tr?.apt_type_internal ??
      appointmentText("Intern", "Внутренний", "Internal");
  return tr?.apt_type_medical ??
    appointmentText("Medizinisch", "Медицинский", "Medical");
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

function attentionIssueLabel(count: number) {
  return count === 1
    ? appointmentText("offener Punkt", "открытый пункт", "open issue")
    : appointmentText("offene Punkte", "открытые пункты", "open issues");
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

function linkedPatientPermissions(role?: string): LinkedPatientPermissions {
  return {
    canCreateEdit: role === "ceo" || role === "patient_manager",
    canViewAssignments: [
      "ceo",
      "patient_manager",
      "teamlead_interpreter",
      "interpreter",
      "concierge",
    ].includes(role ?? ""),
    canManageAssignments:
      role === "ceo" || role === "patient_manager" || role === "teamlead_interpreter",
  };
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
    return new Intl.DateTimeFormat(runtimeLocale(), {
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

function formatDocumentFileSize(size: number | null | undefined) {
  if (!size || size <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"] as const;
  const index = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
  const value = size / 1024 ** index;
  const precision = index === 0 ? 0 : value < 10 ? 1 : 0;
  return `${value.toFixed(precision)} ${units[index]}`;
}

function linkedDocumentStatusBadge(status: string) {
  if (status === "active") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "archived") return "border-slate-200 bg-slate-50 text-slate-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function linkedDocumentVisibilityBadge(visibility: string) {
  if (visibility === "patient_visible")
    return "border-blue-200 bg-blue-50 text-blue-700";
  if (visibility === "released_external")
    return "border-cyan-200 bg-cyan-50 text-cyan-700";
  if (visibility === "released_internal")
    return "border-violet-200 bg-violet-50 text-violet-700";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function linkedDocumentSensitivityBadge(value: string) {
  void value;
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function toTimestamp(value: string | null | undefined) {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function sortLinkedDocuments(items: LinkedDocumentItem[]) {
  return [...items].sort((left, right) => {
    const updatedDiff = toTimestamp(right.updated_at) - toTimestamp(left.updated_at);
    if (updatedDiff !== 0) return updatedDiff;

    const createdDiff = toTimestamp(right.created_at) - toTimestamp(left.created_at);
    if (createdDiff !== 0) return createdDiff;

    if (right.version_number !== left.version_number) {
      return right.version_number - left.version_number;
    }

    return (left.auto_name || "").localeCompare(right.auto_name || "");
  });
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
    "rounded-[1.75rem] border-border/70",
    tokens.surface.card,
    extra,
  );
}

function withEllipsis(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  return /[.…]$/u.test(normalized) ? normalized : `${normalized}…`;
}

function AppointmentWorkspaceSectionIntro({
  title,
  description,
  accessory,
}: {
  title: ReactNode;
  description: ReactNode;
  accessory?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-muted/20 px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <p className="max-w-3xl text-xs text-muted-foreground">{description}</p>
      </div>
      {accessory ? <div className="shrink-0">{accessory}</div> : null}
    </div>
  );
}

function AppointmentClinicalToggleCard({
  checked,
  disabled = false,
  title,
  description,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  title: string;
  description: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={cn(
        "flex items-start gap-3 rounded-xl px-4 py-3",
        tokens.surface.card,
        disabled && "opacity-60",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-4 rounded border-border/60 text-[var(--brand)] focus:ring-[var(--brand)]/30"
      />
      <span className="min-w-0 space-y-1">
        <span className="block text-sm font-medium text-foreground">{title}</span>
        <span className="block text-xs text-muted-foreground">
          {description}
        </span>
      </span>
    </label>
  );
}

function AppointmentEditorSheet({
  open,
  onOpenChange,
  title,
  description,
  maxWidthClassName = "sm:max-w-[560px]",
  onSubmit,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  maxWidthClassName?: string;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
  footer: ReactNode;
}) {
  const content = (
    <>
      <SheetHeader className="px-4 py-3">
        <SheetTitle>{title}</SheetTitle>
        {description ? <SheetDescription>{description}</SheetDescription> : null}
      </SheetHeader>
      <div className="flex-1 overflow-y-auto overscroll-y-contain px-4 py-4 space-y-4">
        {children}
      </div>
      <div className="flex shrink-0 justify-end gap-2 px-4 py-3 bg-popover">
        {footer}
      </div>
    </>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className={cn("w-full gap-0", maxWidthClassName)}>
        {onSubmit ? (
          <form className="flex flex-col flex-1 min-h-0" onSubmit={onSubmit}>
            {content}
          </form>
        ) : (
          <div className="flex flex-col flex-1 min-h-0">{content}</div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function AppointmentPreviewSheet({
  open,
  onOpenChange,
  title,
  description,
  maxWidthClassName = "sm:max-w-[560px]",
  headerClassName,
  bodyClassName,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  maxWidthClassName?: string;
  headerClassName?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className={cn("w-full gap-0", maxWidthClassName)}>
        <div className="flex flex-col flex-1 min-h-0">
          <SheetHeader className={cn("px-4 py-3", headerClassName)}>
            <SheetTitle>{title}</SheetTitle>
            {description ? <SheetDescription>{description}</SheetDescription> : null}
          </SheetHeader>
          <div
            className={cn(
              "flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4",
              "overscroll-y-contain",
              bodyClassName,
            )}
          >
            {children}
          </div>
        </div>
      </SheetContent>
    </Sheet>
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

function appointmentTimelineSurfaceClass(
  tone: AppointmentTimelineEvent["tone"],
) {
  switch (tone) {
    case "success":
      return "border-emerald-200/80 bg-emerald-50/35";
    case "warning":
      return "border-amber-200/80 bg-amber-50/40";
    case "danger":
      return "border-rose-200/80 bg-rose-50/40";
    case "info":
      return "border-sky-200/80 bg-sky-50/40";
    default:
      return "border-border/50 bg-background";
  }
}

function appointmentTimelineKindDotClass(kind: AppointmentTimelineKind) {
  switch (kind) {
    case "workflow":
      return "bg-sky-500";
    case "communication":
      return "bg-amber-500";
    case "interpreter":
      return "bg-violet-500";
    case "clinical":
      return "bg-emerald-500";
    case "followup":
      return "bg-rose-500";
    case "concierge":
      return "bg-cyan-500";
    default:
      return "bg-[var(--brand)]";
  }
}

function appointmentTimelineKindBadgeClass(kind: AppointmentTimelineKind) {
  switch (kind) {
    case "workflow":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "communication":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "interpreter":
      return "border-violet-200 bg-violet-50 text-violet-700";
    case "clinical":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "followup":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "concierge":
      return "border-cyan-200 bg-cyan-50 text-cyan-700";
    default:
      return "border-border/60 bg-muted/25 text-muted-foreground";
  }
}

function appointmentTimelineKindLabel(kind: AppointmentTimelineKind) {
  switch (kind) {
    case "workflow":
      return appointmentText("Workflow", "Воркфлоу", "Workflow");
    case "communication":
      return appointmentText("Kommunikation", "Коммуникация", "Communication");
    case "interpreter":
      return appointmentText("Dolmetscher", "Переводчик", "Interpreter");
    case "clinical":
      return appointmentText("Klinisch", "Клиническое", "Clinical");
    case "followup":
      return appointmentText("Follow-up", "Фоллоу-ап", "Follow-up");
    case "concierge":
      return "Concierge";
    default:
      return kind;
  }
}

function appointmentTimelineToneLabel(tone: AppointmentTimelineEvent["tone"]) {
  switch (tone) {
    case "success":
      return appointmentText("Erledigt", "Готово", "Done");
    case "warning":
      return appointmentText("Aufmerksamkeit", "Внимание", "Attention");
    case "danger":
      return appointmentText("Kritisch", "Критично", "Critical");
    case "info":
      return appointmentText("Info", "Инфо", "Info");
    default:
      return appointmentText("Geplant", "Запланировано", "Planned");
  }
}

function appointmentTimelineDateGroupKey(value?: string | null) {
  if (!value) return "unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function appointmentTimelineDateGroupLabel(
  value: string | null | undefined,
  lang: string,
) {
  const key = appointmentTimelineDateGroupKey(value);
  if (key === "unknown") {
    if (lang === "de") return "Unbekanntes Datum";
    if (lang === "ru") return "Дата не указана";
    return "Unknown date";
  }

  const date = new Date(value!);
  const today = new Date();
  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const startOfTarget = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );
  const diffInDays = Math.round(
    (startOfToday.getTime() - startOfTarget.getTime()) / (1000 * 60 * 60 * 24),
  );

  if (diffInDays === 0) {
    if (lang === "de") return "Heute";
    if (lang === "ru") return "Сегодня";
    return "Today";
  }
  if (diffInDays === 1) {
    if (lang === "de") return "Gestern";
    if (lang === "ru") return "Вчера";
    return "Yesterday";
  }

  try {
    return new Intl.DateTimeFormat(runtimeLocale(), {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: startOfTarget.getFullYear() === startOfToday.getFullYear() ? undefined : "numeric",
    }).format(date);
  } catch {
    return key;
  }
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
  compact?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11.5px] font-medium text-muted-foreground leading-tight">
        {label}
      </span>
      {children}
    </label>
  );
}

function EmptyState({ text }: { text: string }) {
  return <EmptyCell>{text}</EmptyCell>;
}

function CreateAppointmentSheet({
  open,
  seed,
  appointments,
  patients,
  providers,
  interpreters,
  staff,
  userId,
  onOpenChange,
  onCreated,
}: CreateAppointmentSheetProps) {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const interpreterFieldLabel =
    tr.role_interpreter ??
    appointmentText("Dolmetscher", "Переводчик", "Interpreter");
  const [form, setForm] = useState<AppointmentFormState>(seed);
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [conflicts, setConflicts] = useState<ConflictSummary | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(seed);
    setDoctors([]);
    setConflicts(null);
    setError("");
    setBusy(false);
  }, [open, seed]);

  const scheduleWarningLabels = useMemo(
    () => ({
      patients_assign_owner: tr.patients_assign_owner,
      common_doctor: tr.common_doctor,
      common_provider: tr.common_provider,
    }),
    [tr.common_doctor, tr.common_provider, tr.patients_assign_owner],
  );
  const patientLabelIndex = useMemo(
    () =>
      new Map(
        patients.map((item) => [
          item.id,
          `${item.patient_id} · ${patientName(item)}`,
        ]),
      ),
    [patients],
  );
  const providerLabelIndex = useMemo(
    () => new Map(providers.map((item) => [item.id, providerLabel(item)])),
    [providers],
  );
  const doctorLabelIndex = useMemo(
    () => new Map(doctors.map((item) => [item.id, doctorLabel(item)])),
    [doctors],
  );
  const staffLabelIndex = useMemo(
    () => new Map(staff.map((item) => [item.id, staffLabel(item)])),
    [staff],
  );
  const interpreterLabelIndex = useMemo(
    () => new Map(interpreters.map((item) => [item.id, staffLabel(item)])),
    [interpreters],
  );
  const localWarnings = useMemo(
    () =>
      buildLocalScheduleWarnings(
        appointments,
        {
          date: form.date,
          timeStart: form.timeStart,
          timeEnd: form.timeEnd,
          ownerUserId: form.ownerUserId || userId || null,
          providerId: form.providerId || null,
          doctorId: form.doctorId || null,
        },
        scheduleWarningLabels,
      ),
    [
      appointments,
      form.date,
      form.timeStart,
      form.timeEnd,
      form.ownerUserId,
      form.providerId,
      form.doctorId,
      scheduleWarningLabels,
      userId,
    ],
  );
  const conflictQuery = useMemo(() => {
    if (!open || !form.patientId || !form.date) return "";
    return buildConflictQuery(
      form.patientId,
      "",
      form.date,
      form.timeStart,
      form.timeEnd,
      form.interpreterId,
    );
  }, [
    open,
    form.patientId,
    form.date,
    form.timeStart,
    form.timeEnd,
    form.interpreterId,
  ]);
  const debouncedConflictQuery = useDebouncedValue(conflictQuery);
  const selectedPatientLabel =
    (form.patientId ? patientLabelIndex.get(form.patientId) : undefined) ??
    t.orders_patient;
  const selectedProviderLabel =
    (form.providerId ? providerLabelIndex.get(form.providerId) : undefined) ??
    t.common_not_set;
  const selectedDoctorLabel =
    (form.doctorId ? doctorLabelIndex.get(form.doctorId) : undefined) ??
    t.common_not_set;
  const selectedOwnerLabel =
    (form.ownerUserId ? staffLabelIndex.get(form.ownerUserId) : undefined) ??
    t.common_not_set;
  const selectedInterpreterLabel =
    (form.interpreterId
      ? interpreterLabelIndex.get(form.interpreterId)
      : undefined) ?? t.common_not_set;

  useEffect(() => {
    if (!form.providerId) {
      setDoctors([]);
      setForm((current) =>
        current.doctorId ? { ...current, doctorId: "" } : current,
      );
      return;
    }
    let active = true;
    getProviderDoctors(form.providerId)
      .then((rows) => {
        if (active) setDoctors(rows);
      })
      .catch(() => {
        if (active) setDoctors([]);
      });
    return () => {
      active = false;
    };
  }, [form.providerId]);

  useEffect(() => {
    if (!debouncedConflictQuery) {
      setConflicts(null);
      return;
    }
    let active = true;
    apiFetch<ConflictSummary>(debouncedConflictQuery)
      .then((value) => {
        if (active) setConflicts(value);
      })
      .catch(() => {
        if (active) setConflicts(null);
      });
    return () => {
      active = false;
    };
  }, [debouncedConflictQuery]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (!form.patientId) {
        setError(`${t.orders_patient}: ${t.cf_required}`);
        return;
      }
      const repeatInterval = parsePositiveIntegerInput(form.repeatInterval);
      const repeatCount = parsePositiveIntegerInput(form.repeatCount);
      if (form.repeatEnabled) {
        if (!repeatInterval) {
          setError(t.appointments_repeat_interval_error);
          return;
        }
        if (!repeatCount && !form.repeatUntil) {
          setError(t.appointments_repeat_require_end_error);
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
          patient_id: form.patientId,
          provider_id: form.providerId || null,
          doctor_id: form.doctorId || null,
          owner_user_id: form.ownerUserId || null,
          interpreter_id: form.interpreterId || null,
          appointment_type: form.appointmentType,
          care_path_kind: normalizeCarePathKindForAppointmentType(
            form.appointmentType,
            form.carePathKind,
          ),
          title: form.title.trim(),
          date: form.date,
          time_start: form.timeStart || null,
          time_end: form.timeEnd || null,
          location: form.location.trim() || null,
          category: form.category.trim() || null,
          notes: form.notes.trim() || null,
          recurrence_frequency: form.repeatEnabled
            ? form.repeatFrequency
            : null,
          recurrence_interval: form.repeatEnabled ? repeatInterval : null,
          recurrence_count: form.repeatEnabled ? repeatCount : null,
          recurrence_until:
            form.repeatEnabled && form.repeatUntil ? form.repeatUntil : null,
        }),
      });
      const notice = buildScheduleNotice(result.conflicts, localWarnings);
      onOpenChange(false);
      onCreated({ id: result.id, notice });
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : appointmentText(
              "Termin konnte nicht erstellt werden.",
              "Не удалось создать приём.",
              "Failed to create appointment",
            ),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {open ? (
        <SheetContent side="right" className="w-full gap-0 sm:max-w-[760px]">
          <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
            <SheetHeader className="px-4 py-3">
              <SheetTitle>{tr.appointments_new}</SheetTitle>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto overscroll-y-contain px-4 py-4">
              <div className="space-y-4">
                {error ? <Banner tone="error" withIcon>{error}</Banner> : null}
                <section className="space-y-3 rounded-xl border border-border/50 bg-card/40 p-3.5">
                  <div className="grid gap-4 md:grid-cols-3">
                    <Field compact label={t.orders_patient}>
                      <ShadSelect
                        value={form.patientId}
                        onValueChange={(value) =>
                          setForm((current) => ({
                            ...current,
                            patientId: value ?? "",
                          }))
                        }
                      >
                        <SelectTrigger className={cn("w-full", createSheetInputClassName)}>
                          <SelectValue>{selectedPatientLabel}</SelectValue>
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
                        value={form.appointmentType}
                        onValueChange={(value) =>
                          setForm((current) => ({
                            ...current,
                            appointmentType:
                              (value as AppointmentKind) ?? current.appointmentType,
                            carePathKind:
                              value === "medical" ? current.carePathKind : "regular",
                            providerId: value === "internal" ? "" : current.providerId,
                            doctorId: value === "internal" ? "" : current.doctorId,
                          }))
                        }
                      >
                        <SelectTrigger className={cn("w-full", createSheetInputClassName)}>
                          <SelectValue>
                            {appointmentTypeLabel(form.appointmentType, tr)}
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
                        value={form.carePathKind}
                        onValueChange={(value) =>
                          setForm((current) => ({
                            ...current,
                            carePathKind:
                              (value as AppointmentCarePathKind) ?? current.carePathKind,
                          }))
                        }
                        disabled={form.appointmentType !== "medical"}
                      >
                        <SelectTrigger className={cn("w-full", createSheetInputClassName)}>
                          <SelectValue>{carePathKindLabel(form.carePathKind)}</SelectValue>
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
                      value={form.title}
                      onChange={(event) =>
                        setForm((current) => ({
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
                        value={form.date}
                        onChange={(event) =>
                          setForm((current) => ({
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
                        value={form.timeStart}
                        onChange={(event) =>
                          setForm((current) => ({
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
                        value={form.timeEnd}
                        onChange={(event) =>
                          setForm((current) => ({
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
                        checked={form.repeatEnabled}
                        onChange={(event) =>
                          setForm((current) => ({
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
                          {t.appointments_repeat_this}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {t.appointments_repeat_hint}
                        </span>
                      </span>
                    </label>
                    {form.repeatEnabled ? (
                      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                        <Field compact label="Frequency">
                          <ShadSelect
                            value={form.repeatFrequency}
                            onValueChange={(value) =>
                              setForm((current) => ({
                                ...current,
                                repeatFrequency:
                                  (value as AppointmentRecurrenceFrequency) ??
                                  current.repeatFrequency,
                              }))
                            }
                          >
                            <SelectTrigger className={cn("w-full", createSheetInputClassName)}>
                              <SelectValue>
                                {recurrenceFrequencyLabel(form.repeatFrequency)}
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
                            value={form.repeatInterval}
                            onChange={(event) =>
                              setForm((current) => ({
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
                            value={form.repeatCount}
                            onChange={(event) =>
                              setForm((current) => ({
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
                            value={form.repeatUntil}
                            onChange={(event) =>
                              setForm((current) => ({
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
                        value={form.providerId}
                        onValueChange={(value) =>
                          setForm((current) => ({
                            ...current,
                            providerId: value ?? "",
                            doctorId: "",
                          }))
                        }
                        disabled={form.appointmentType === "internal"}
                      >
                        <SelectTrigger className={cn("w-full", createSheetInputClassName)}>
                          <SelectValue>{selectedProviderLabel}</SelectValue>
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
                        value={form.doctorId}
                        onValueChange={(value) =>
                          setForm((current) => ({
                            ...current,
                            doctorId: value ?? "",
                          }))
                        }
                        disabled={!form.providerId}
                      >
                        <SelectTrigger className={cn("w-full", createSheetInputClassName)}>
                          <SelectValue>{selectedDoctorLabel}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">{t.common_not_set}</SelectItem>
                          {doctors.map((doctor) => (
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
                        value={form.ownerUserId}
                        onValueChange={(value) =>
                          setForm((current) => ({
                            ...current,
                            ownerUserId: value ?? "",
                          }))
                        }
                      >
                        <SelectTrigger className={cn("w-full", createSheetInputClassName)}>
                          <SelectValue>{selectedOwnerLabel}</SelectValue>
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
                    <Field compact label={interpreterFieldLabel}>
                      <ShadSelect
                        value={form.interpreterId}
                        onValueChange={(value) =>
                          setForm((current) => ({
                            ...current,
                            interpreterId: value ?? "",
                          }))
                        }
                      >
                        <SelectTrigger className={cn("w-full", createSheetInputClassName)}>
                          <SelectValue>{selectedInterpreterLabel}</SelectValue>
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
                        value={form.location}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            location: event.target.value,
                          }))
                        }
                        className={createSheetInputClassName}
                      />
                    </Field>
                    <Field compact label={tr.documents_category}>
                      <Input
                        value={form.category}
                        onChange={(event) =>
                          setForm((current) => ({
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
                      value={form.notes}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          notes: event.target.value,
                        }))
                      }
                      className={createSheetTextareaClassName}
                      rows={4}
                    />
                  </Field>
                </section>
                <ConflictPanel conflicts={conflicts} />
                <ScheduleWarningsPanel warnings={localWarnings} />
              </div>
            </div>
            <div className="shrink-0 flex justify-end gap-2 px-4 py-3 bg-popover">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 rounded-lg"
                onClick={() => onOpenChange(false)}
              >
                {tr.common_cancel}
              </Button>
              <Button
                type="submit"
                size="sm"
                className="h-8 rounded-lg gap-1.5 px-3.5"
                disabled={busy}
              >
                {busy ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <Plus className="size-3.5" />
                )}
                {busy ? t.patients_creating : t.appointments_new}
              </Button>
            </div>
          </form>
        </SheetContent>
      ) : null}
    </Sheet>
  );
}

const MemoizedCreateAppointmentSheet = memo(
  CreateAppointmentSheet,
  (prev, next) =>
    prev.open === next.open &&
    prev.seed === next.seed &&
    prev.appointments === next.appointments &&
    prev.patients === next.patients &&
    prev.providers === next.providers &&
    prev.interpreters === next.interpreters &&
    prev.staff === next.staff &&
    prev.userId === next.userId,
);

function EditAppointmentSection({
  detail,
  appointments,
  providers,
  staff,
  interpreters,
  onSaved,
}: EditAppointmentSectionProps) {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const interpreterFieldLabel =
    tr.role_interpreter ??
    appointmentText("Dolmetscher", "Переводчик", "Interpreter");
  const [form, setForm] = useState<AppointmentFormState>(() =>
    buildEditAppointmentForm(detail),
  );
  const [recurrenceScope, setRecurrenceScope] =
    useState<AppointmentRecurringActionScope>("single");
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [conflicts, setConflicts] = useState<ConflictSummary | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setForm(buildEditAppointmentForm(detail));
    setRecurrenceScope("single");
    setDoctors([]);
    setConflicts(null);
    setError("");
    setBusy(false);
  }, [detail]);

  const scheduleWarningLabels = useMemo(
    () => ({
      patients_assign_owner: tr.patients_assign_owner,
      common_doctor: tr.common_doctor,
      common_provider: tr.common_provider,
    }),
    [tr.common_doctor, tr.common_provider, tr.patients_assign_owner],
  );
  const localWarnings = useMemo(
    () =>
      buildLocalScheduleWarnings(
        appointments,
        {
          appointmentId: detail.id,
          date: form.date,
          timeStart: form.timeStart,
          timeEnd: form.timeEnd,
          ownerUserId: form.ownerUserId || detail.owner_user_id || null,
          providerId: form.providerId || null,
          doctorId: form.doctorId || null,
        },
        scheduleWarningLabels,
      ),
    [
      appointments,
      detail.id,
      detail.owner_user_id,
      form.date,
      form.timeStart,
      form.timeEnd,
      form.ownerUserId,
      form.providerId,
      form.doctorId,
      scheduleWarningLabels,
    ],
  );
  const conflictQuery = useMemo(() => {
    if (!detail.patient_id || !form.date) return "";
    return buildConflictQuery(
      detail.patient_id,
      detail.id,
      form.date,
      form.timeStart,
      form.timeEnd,
      form.interpreterId,
    );
  }, [
    detail.id,
    detail.patient_id,
    form.date,
    form.timeStart,
    form.timeEnd,
    form.interpreterId,
  ]);
  const debouncedConflictQuery = useDebouncedValue(conflictQuery);

  useEffect(() => {
    if (!form.providerId) {
      setDoctors([]);
      setForm((current) =>
        current.doctorId ? { ...current, doctorId: "" } : current,
      );
      return;
    }
    let active = true;
    getProviderDoctors(form.providerId)
      .then((rows) => {
        if (active) setDoctors(rows);
      })
      .catch(() => {
        if (active) setDoctors([]);
      });
    return () => {
      active = false;
    };
  }, [form.providerId]);

  useEffect(() => {
    if (!debouncedConflictQuery) {
      setConflicts(null);
      return;
    }
    let active = true;
    apiFetch<ConflictSummary>(debouncedConflictQuery)
      .then((value) => {
        if (active) setConflicts(value);
      })
      .catch(() => {
        if (active) setConflicts(null);
      });
    return () => {
      active = false;
    };
  }, [debouncedConflictQuery]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const applyRecurrenceRule =
        Boolean(detail.recurrence_frequency) && recurrenceScope !== "single";
      const repeatInterval = parsePositiveIntegerInput(form.repeatInterval);
      const repeatCount = parsePositiveIntegerInput(form.repeatCount);
      if (applyRecurrenceRule) {
        if (!repeatInterval) {
          setError(t.appointments_repeat_interval_error);
          return;
        }
        if (!repeatCount && !form.repeatUntil) {
          setError(t.appointments_repeat_require_end_error);
          return;
        }
      }
      const result = await apiFetch<{
        ok: boolean;
        conflicts?: ConflictSummary;
      }>(`/appointments/${detail.id}/update`, {
        method: "POST",
        body: JSON.stringify({
          provider_id: form.providerId || null,
          doctor_id: form.doctorId || null,
          owner_user_id: form.ownerUserId || null,
          interpreter_id: form.interpreterId || null,
          care_path_kind: normalizeCarePathKindForAppointmentType(
            detail.type,
            form.carePathKind,
          ),
          title: form.title.trim(),
          date: form.date,
          time_start: form.timeStart || null,
          time_end: form.timeEnd || null,
          location: form.location.trim() || null,
          recurrence_frequency: applyRecurrenceRule ? form.repeatFrequency : null,
          recurrence_interval: applyRecurrenceRule ? repeatInterval : null,
          recurrence_count: applyRecurrenceRule ? repeatCount : null,
          recurrence_until:
            applyRecurrenceRule && form.repeatUntil ? form.repeatUntil : null,
          recurrence_scope: detail.recurrence_frequency
            ? recurrenceScope
            : "single",
        }),
      });
      onSaved(buildScheduleNotice(result.conflicts, localWarnings));
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : appointmentText(
              "Terminplan konnte nicht gespeichert werden.",
              "Не удалось сохранить расписание приёма.",
              "Failed to save schedule",
            ),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3 rounded-xl p-3.5 border border-border/50 bg-card/40">
      <h3 className="text-sm font-semibold text-foreground">
        {t.appointments_title}
      </h3>
      {error ? (
        <div className="mt-4">
          <Banner tone="error" withIcon>{error}</Banner>
        </div>
      ) : null}
      <form onSubmit={handleSubmit} className="mt-4 space-y-4">
        <Field label={t.appointments_title_col}>
          <Input
            value={form.title}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                title: event.target.value,
              }))
            }
            className="h-10 rounded-xl bg-slate-50"
          />
        </Field>
        <Field
          label={appointmentText(
            "Versorgungspfad",
            "Траектория лечения",
            "Care path",
          )}
        >
          <select
            value={form.carePathKind}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                carePathKind: event.target.value as AppointmentCarePathKind,
              }))
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
              value={form.date}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  date: event.target.value,
                }))
              }
              className="h-10 rounded-xl bg-slate-50"
            />
          </Field>
          <Field label={t.appointments_time}>
            <Input
              type="time"
              value={form.timeStart}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  timeStart: event.target.value,
                }))
              }
              className="h-10 rounded-xl bg-slate-50"
            />
          </Field>
          <Field label={t.appointments_time}>
            <Input
              type="time"
              value={form.timeEnd}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  timeEnd: event.target.value,
                }))
              }
              className="h-10 rounded-xl bg-slate-50"
            />
          </Field>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t.common_provider}>
            <select
              value={form.providerId}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  providerId: event.target.value,
                  doctorId: "",
                }))
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
              value={form.doctorId}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  doctorId: event.target.value,
                }))
              }
              className={selectClassName}
              disabled={!form.providerId}
            >
              <option value="">{t.common_not_set}</option>
              {doctors.map((doctor) => (
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
              value={form.ownerUserId}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  ownerUserId: event.target.value,
                }))
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
          <Field label={interpreterFieldLabel}>
            <select
              value={form.interpreterId}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  interpreterId: event.target.value,
                }))
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
            value={form.location}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                location: event.target.value,
              }))
            }
            className="h-10 rounded-xl bg-slate-50"
          />
        </Field>
        {detail.recurrence_frequency ? (
          <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3">
            <Field label={t.appointments_scope_apply_schedule}>
              <select
                value={recurrenceScope}
                onChange={(event) =>
                  setRecurrenceScope(
                    event.target.value as AppointmentRecurringActionScope,
                  )
                }
                className={selectClassName}
              >
                <option value="single">{t.appointments_scope_single}</option>
                <option value="following">
                  {t.appointments_scope_following}
                </option>
                <option value="series">{t.appointments_scope_series}</option>
              </select>
            </Field>
            <p className="mt-2 text-xs text-sky-800">
              {t.appointments_scope_following_hint}
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Field
                label={appointmentText(
                  "Wiederholungsrhythmus",
                  "Частота повторения",
                  "Repeat frequency",
                )}
              >
                <select
                  value={form.repeatFrequency}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      repeatFrequency:
                        event.target.value as AppointmentRecurrenceFrequency,
                    }))
                  }
                  className={selectClassName}
                  disabled={recurrenceScope === "single"}
                >
                  <option value="daily">{recurrenceFrequencyLabel("daily")}</option>
                  <option value="weekly">
                    {recurrenceFrequencyLabel("weekly")}
                  </option>
                  <option value="monthly">
                    {recurrenceFrequencyLabel("monthly")}
                  </option>
                </select>
              </Field>
              <Field
                label={appointmentText(
                  "Wiederholen alle",
                  "Повторять каждые",
                  "Repeat every",
                )}
              >
                <Input
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={form.repeatInterval}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      repeatInterval: event.target.value,
                    }))
                  }
                  className="h-10 rounded-xl bg-white/80"
                  disabled={recurrenceScope === "single"}
                />
              </Field>
              <Field
                label={appointmentText(
                  "Anzahl Termine",
                  "Всего повторов",
                  "Total occurrences",
                )}
              >
                <Input
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={form.repeatCount}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      repeatCount: event.target.value,
                    }))
                  }
                  className="h-10 rounded-xl bg-white/80"
                  placeholder={withEllipsis(
                    appointmentText(
                      "Optional, wenn ein Enddatum gesetzt ist",
                      "Необязательно, если указана дата окончания",
                      "Optional when repeat-until is set",
                    ),
                  )}
                  disabled={recurrenceScope === "single"}
                />
              </Field>
              <Field
                label={appointmentText(
                  "Wiederholen bis",
                  "Повторять до",
                  "Repeat until",
                )}
              >
                <Input
                  type="date"
                  value={form.repeatUntil}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      repeatUntil: event.target.value,
                    }))
                  }
                  className="h-10 rounded-xl bg-white/80"
                  disabled={recurrenceScope === "single"}
                />
              </Field>
            </div>
            <p className="mt-3 text-xs text-sky-800">
              Recurrence rule edits only apply when you target
              <span className="font-semibold"> this and following</span> or the{" "}
              <span className="font-semibold">whole series</span>. Single-
              occurrence updates keep the current slot detached from rule
              changes.
            </p>
          </div>
        ) : null}
        <ConflictPanel conflicts={conflicts} />
        <ScheduleWarningsPanel warnings={localWarnings} />
        <div className="flex justify-end">
          <Button
            type="submit"
            className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
            disabled={busy}
          >
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
            {busy ? t.patients_saving : t.common_save}
          </Button>
        </div>
      </form>
    </section>
  );
}

const MemoizedEditAppointmentSection = memo(EditAppointmentSection);

function AppointmentOverviewSection({
  detail,
  onOpenDetail,
}: {
  detail: AppointmentDetail;
  onOpenDetail: (id: string) => void;
}) {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const detailLineageText = recurrenceLineageText(detail, t);
  const detailLineageBadge = recurrenceLineageBadge(detail, t);
  const detailCurrentLineageHistory = currentRecurringLineageHistory(detail);
  const detailRelatedLineageCount = Math.max(
    0,
    detail.recurring_lineage_history.length - 1,
  );
  const patientInitials = detail.patient_name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <section className="space-y-3 rounded-xl p-3.5 border border-border/50 bg-card/40">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--brand)] text-[12px] font-semibold text-white">
          {patientInitials || "AP"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="truncate text-xl font-semibold tracking-tight text-foreground">
              {detail.title}
            </h2>
            <span
              className={cn(
                "rounded-full border px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.12em]",
                statusBadgeClass(detail.status),
              )}
            >
              {statusLabel(detail.status)}
            </span>
          </div>
          <p className="mt-0.5 text-[12px] font-mono text-muted-foreground">
            {detail.patient_pid} · {detail.patient_name}
          </p>
          <p className="text-[11px] font-mono text-muted-foreground/80">
            {detail.id}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 sm:max-w-[40%] sm:justify-end">
          <span
            className={cn(
              "rounded-full border px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.12em]",
              typeBadgeClass(detail.type),
            )}
          >
            {appointmentTypeLabel(detail.type, tr)}
          </span>
          {detail.care_path_kind ? (
            <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-violet-700">
              {carePathKindLabel(detail.care_path_kind)}
            </span>
          ) : null}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {detail.recurrence_frequency ? (
          <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-sky-700">
            {recurrenceFrequencyLabel(detail.recurrence_frequency)} series
          </span>
        ) : null}
        {detailLineageBadge ? (
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-amber-700">
            {detailLineageBadge}
          </span>
        ) : null}
        {detail.interpreter_response ? (
          <span className="rounded-full border border-border/60 bg-muted/25 px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {(tr.role_interpreter ??
              appointmentText("Dolmetscher", "Переводчик", "Interpreter"))}{" "}
            {responseLabel(detail.interpreter_response)}
          </span>
        ) : null}
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-border/50 bg-muted/25 px-4 py-3 text-sm text-muted-foreground">
          <InfoLine icon={Clock3} label={slotLabel(detail)} />
        </div>
        <div className="rounded-xl border border-border/50 bg-muted/25 px-4 py-3 text-sm text-muted-foreground">
          <InfoLine
            icon={MapPin}
            label={detail.location || tr.common_not_set}
          />
        </div>
        <div className="rounded-xl border border-border/50 bg-muted/25 px-4 py-3 text-sm text-muted-foreground">
          <InfoLine
            icon={Stethoscope}
            label={detail.provider_name || tr.common_not_set}
          />
        </div>
      </div>
      {detail.is_blocked ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Concierge view is intentionally limited for medical slots. Clinical
          notes and provider specifics stay hidden here.
        </div>
      ) : null}
      {!detail.is_blocked && detail.recurrence_frequency ? (
        <div className="mt-4 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
          {t.appointments_recurring_series}:{" "}
          {t.appointments_occurrence.toLowerCase()} {detail.recurrence_index + 1}/
          {detail.recurrence_series_size}. {recurrenceCadenceLabel(detail)}
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
                  {detailCurrentLineageHistory.completed_occurrences}
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
                          onClick={() => onOpenDetail(item.series_id)}
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
  );
}

const MemoizedAppointmentOverviewSection = memo(AppointmentOverviewSection);

function AppointmentSnapshotSection({ detail }: { detail: AppointmentDetail }) {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const summaryTitle = appointmentText(
    "Status und Zuständigkeiten",
    "Статус и ответственные",
    "Status and responsibilities",
  );
  const orderLabel = appointmentText("Auftrag", "Заказ", "Order");
  const snapshotCards = [
    {
      label: t.orders_phase,
      value: detail.checklist_phase || tr.phase_discovery,
      meta: appointmentTypeLabel(detail.type, tr),
    },
    {
      label: t.patients_assign_owner,
      value: detail.owner_name || tr.common_not_set,
      meta: detail.owner_role
        ? roleLabel(detail.owner_role)
        : tr.common_not_set,
    },
  ];

  if (detail.doctor_name || detail.type === "medical") {
    snapshotCards.push({
      label: t.common_doctor,
      value: detail.doctor_name || tr.common_not_set,
      meta: detail.provider_name || tr.common_not_set,
    });
  }

  if (detail.interpreter_name || detail.interpreter_response) {
    snapshotCards.push({
      label: t.role_interpreter,
      value: detail.interpreter_name || tr.common_not_set,
      meta: detail.interpreter_response
        ? responseLabel(detail.interpreter_response)
        : tr.common_not_set,
    });
  }

  if (detail.order_id) {
    snapshotCards.push({
      label: orderLabel,
      value: detail.order_id,
      meta: detail.category || formatDateTimeLabel(detail.created_at),
    });
  }

  return (
    <section className="space-y-3 rounded-xl p-3.5 border border-border/50 bg-card/40">
      <div className="flex items-center gap-2">
        <div className="size-2 shrink-0 rounded-full bg-[var(--brand)]" />
        <h3 className="text-sm font-semibold text-foreground">
          {summaryTitle}
        </h3>
      </div>
      <div className="mt-4 grid gap-x-8 gap-y-3 md:grid-cols-2 xl:grid-cols-4">
        {snapshotCards.map((card) => (
          <ContextCard
            key={`${card.label}:${card.value}`}
            variant="snapshot"
            label={card.label}
            value={card.value}
            meta={card.meta}
          />
        ))}
      </div>
    </section>
  );
}

const MemoizedAppointmentSnapshotSection = memo(AppointmentSnapshotSection);

function AppointmentAttentionSection({
  attention,
}: {
  attention: AppointmentAttentionItem;
}) {
  const title = appointmentText(
    "Operativer Follow-up offen",
    "Открыт операционный follow-up",
    "Operational follow-up open",
  );
  const subtitle = appointmentText(
    "Dieser Termin hat noch offene operative Folgepunkte.",
    "У этого приёма остались незакрытые операционные follow-up пункты.",
    "This appointment still has unresolved operational follow-up.",
  );
  const nextCheckpointLabel = appointmentText(
    "Nächster Prüfpunkt",
    "Следующая контрольная точка",
    "Next due checkpoint",
  );

  return (
    <section className="space-y-3 rounded-xl p-3.5 border border-border/50 bg-card/40">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <div className="size-2 shrink-0 rounded-full bg-amber-500" />
            <h3 className="text-sm font-semibold text-foreground">
              {title}
            </h3>
          </div>
          <p className="text-xs text-muted-foreground">
            {subtitle}
          </p>
        </div>
        <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-800">
          {attention.attention_score} {attentionIssueLabel(attention.attention_score)}
        </span>
      </div>
      <div className="mt-4 space-y-3">
        {attention.reasons.map((reason) => (
          <div
            key={reason}
            className="rounded-xl border border-amber-200/80 bg-amber-50/80 px-4 py-3 text-sm text-amber-900"
          >
            {reason}
          </div>
        ))}
      </div>
      {attention.next_due_at ? (
        <p className="mt-4 text-xs text-muted-foreground">
          {nextCheckpointLabel}: {formatDateTimeLabel(attention.next_due_at)}
        </p>
      ) : null}
    </section>
  );
}

const MemoizedAppointmentAttentionSection = memo(AppointmentAttentionSection);

function AppointmentLinksSection({
  detail,
  onOpenPreview,
}: {
  detail: AppointmentDetail;
  onOpenPreview: (kind: LinkedPreviewKind, label: string) => void;
}) {
  const { t } = useLang();
  const previewButtonClass =
    "h-8 rounded-lg gap-1.5 border-orange-500 bg-orange-500 px-3 text-xs font-medium text-white transition-colors hover:cursor-pointer hover:border-orange-600 hover:bg-orange-600";
  const patientLabel = appointmentText("Patient", "Пациент", "Patient");
  const orderLabel = appointmentText("Auftrag", "Заказ", "Order");
  const clinicLabel = appointmentText("Klinik", "Клиника", "Clinic");
  const documentsLabel = appointmentText("Dokumente", "Документы", "Documents");
  const casesLabel = appointmentText("Fälle", "Кейсы", "Cases");
  const linkedCount =
    3 + Number(Boolean(detail.order_id)) + Number(Boolean(detail.provider_id));

  return (
    <Section
      title={t.compliance_col_linked_records}
      accessory={<CountBadge>{linkedCount}</CountBadge>}
    >
      <div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            className={previewButtonClass}
            onClick={() => onOpenPreview("patient", patientLabel)}
          >
            {patientLabel}
          </Button>
          {detail.order_id ? (
            <Button
              type="button"
              className={previewButtonClass}
              onClick={() => onOpenPreview("order", orderLabel)}
            >
              {orderLabel}
            </Button>
          ) : null}
          {detail.provider_id ? (
            <Button
              type="button"
              className={previewButtonClass}
              onClick={() => onOpenPreview("provider", clinicLabel)}
            >
              {clinicLabel}
            </Button>
          ) : null}
          <Button
            type="button"
            className={previewButtonClass}
            onClick={() => onOpenPreview("documents", documentsLabel)}
          >
            {documentsLabel}
          </Button>
          <Button
            type="button"
            className={previewButtonClass}
            onClick={() => onOpenPreview("cases", casesLabel)}
          >
            {casesLabel}
          </Button>
        </div>
      </div>
    </Section>
  );
}

const MemoizedAppointmentLinksSection = memo(AppointmentLinksSection);

function humanizeLinkedCode(value: string | null | undefined) {
  if (!value) {
    return appointmentText("Nicht festgelegt", "Не указано", "Not set");
  }
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function linkedProviderAddress(detail: ProviderSheetDetail) {
  const notSet = appointmentText("Nicht festgelegt", "Не указано", "Not set");
  const cityLine = [detail.address_zip, detail.address_city]
    .filter(Boolean)
    .join(" ")
    .trim();
  return [detail.address_street, cityLine, detail.address_country]
    .filter(Boolean)
    .join(", ") || notSet;
}

function linkedProviderPatientLabel(
  patient: ProviderSheetDetail["linked_patients"][number],
) {
  return (
    [patient.first_name, patient.last_name].filter(Boolean).join(" ").trim() ||
    patient.patient_id
  );
}

function AppointmentLinkedProviderOverviewSection({
  detail,
  formatDateTimeLabel,
}: {
  detail: ProviderSheetDetail;
  formatDateTimeLabel: (value?: string | null) => string;
}) {
  const providerTypeLabel =
    detail.provider_type === "medical"
      ? appointmentText("Medizinisch", "Медицинская", "Medical")
      : appointmentText("Nicht medizinisch", "Немедицинская", "Non-medical");
  const notSet = appointmentText("Nicht festgelegt", "Не указано", "Not set");

  return (
    <Section
      title={appointmentText("Klinikprofil", "Профиль клиники", "Clinic profile")}
      accessory={<CountBadge>{providerTypeLabel}</CountBadge>}
    >
      <div className="flex flex-wrap gap-2">
        <StatusBadge tone={detail.is_active ? "success" : "neutral"}>
          {detail.is_active
            ? appointmentText("Aktiv", "Активна", "Active")
            : appointmentText("Inaktiv", "Неактивна", "Inactive")}
        </StatusBadge>
        {detail.kooperationsvertrag ? (
          <StatusBadge tone="warning">
            {appointmentText(
              "Vertrag verknüpft",
              "Договор привязан",
              "Contract linked",
            )}
          </StatusBadge>
        ) : null}
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={appointmentText("Kontakte", "Контакты", "Contacts")}
          value={detail.doctors.length}
        />
        <StatCard
          label={appointmentText("Services", "Сервисы", "Services")}
          value={detail.services.length}
        />
        <StatCard
          label={appointmentText(
            "Verknüpfte Patienten",
            "Связанные пациенты",
            "Linked patients",
          )}
          value={detail.linked_patients.length}
        />
        <StatCard
          label={appointmentText("Aktivität", "Активность", "Activity")}
          value={detail.interactions.length}
        />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className={cn("rounded-xl px-4 py-3", tokens.surface.card)}>
          <InfoRow
            label={appointmentText("Name", "Название", "Name")}
            value={detail.name || notSet}
          />
        </div>
        <div className={cn("rounded-xl px-4 py-3", tokens.surface.card)}>
          <InfoRow
            label={appointmentText("Rechtsträger", "Юрлицо", "Legal name")}
            value={detail.legal_name || notSet}
          />
        </div>
        <div className={cn("rounded-xl px-4 py-3", tokens.surface.card)}>
          <InfoRow
            label={appointmentText("Standort", "Локация", "Location")}
            value={linkedProviderAddress(detail)}
          />
        </div>
        <div className={cn("rounded-xl px-4 py-3", tokens.surface.card)}>
          <InfoRow
            label={appointmentText("Fachbereich", "Специализация", "Specialty")}
            value={detail.fachbereich || notSet}
          />
        </div>
        <div className={cn("rounded-xl px-4 py-3", tokens.surface.card)}>
          <InfoRow
            label={appointmentText("Telefon", "Телефон", "Phone")}
            value={detail.phone || notSet}
          />
        </div>
        <div className={cn("rounded-xl px-4 py-3", tokens.surface.card)}>
          <InfoRow label="Email" value={detail.email || notSet} />
        </div>
      </div>

      {detail.notes ? (
        <ListItem className="space-y-1">
          <p className={tokens.text.label}>
            {appointmentText("Notizen", "Заметки", "Notes")}
          </p>
          <p className="text-sm leading-6 text-foreground">{detail.notes}</p>
        </ListItem>
      ) : null}

      <p className="text-xs text-muted-foreground">
        {appointmentText("Aktualisiert", "Обновлено", "Updated")}:{" "}
        {formatDateTimeLabel(detail.updated_at)}
      </p>
    </Section>
  );
}

function AppointmentLinkedProviderPatientsSection({
  detail,
  formatDateTimeLabel,
  onOpenPatient,
}: {
  detail: ProviderSheetDetail;
  formatDateTimeLabel: (value?: string | null) => string;
  onOpenPatient: (patientId: string) => void;
}) {
  return (
    <Section
      title={appointmentText(
        "Verknüpfte Patienten",
        "Связанные пациенты",
        "Linked patients",
      )}
      accessory={<CountBadge>{detail.linked_patients.length}</CountBadge>}
    >
      {detail.linked_patients.length === 0 ? (
        <EmptyCell>
          {appointmentText(
            "Für diese Klinik sind noch keine Patienten verknüpft.",
            "Для этой клиники пока нет связанных пациентов.",
            "No patients are linked to this clinic yet.",
          )}
        </EmptyCell>
      ) : (
        <div className="space-y-3">
          {detail.linked_patients.map((patient) => (
            <ListItem key={patient.id} className="space-y-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">
                    {linkedProviderPatientLabel(patient)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {patient.patient_id}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {appointmentText(
                      "Letzte Aktivität",
                      "Последняя активность",
                      "Last activity",
                    )}
                    : {formatDateTimeLabel(patient.last_interaction_at)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <CountBadge>
                    {patient.appointment_count}{" "}
                    {appointmentText("Termine", "записи", "appointments")}
                  </CountBadge>
                  <CountBadge>
                    {patient.leistung_count}{" "}
                    {appointmentText("Services", "сервисы", "services")}
                  </CountBadge>
                  <CountBadge>
                    {patient.concierge_count} Concierge
                  </CountBadge>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-lg"
                  onClick={() => onOpenPatient(patient.id)}
                >
                  {appointmentText("Patient", "Пациент", "Patient")}
                </Button>
              </div>
            </ListItem>
          ))}
        </div>
      )}
    </Section>
  );
}

function AppointmentLinkedProviderInteractionsSection({
  detail,
  formatDateTimeLabel,
  onOpenPatient,
  onOpenAppointment,
}: {
  detail: ProviderSheetDetail;
  formatDateTimeLabel: (value?: string | null) => string;
  onOpenPatient: (patientId: string) => void;
  onOpenAppointment: (appointmentId: string) => void;
}) {
  const notSet = appointmentText("Nicht festgelegt", "Не указано", "Not set");

  return (
    <Section
      title={appointmentText(
        "Interaktionsverlauf",
        "История взаимодействий",
        "Interaction history",
      )}
      accessory={<CountBadge>{detail.interactions.length}</CountBadge>}
    >
      {detail.interactions.length === 0 ? (
        <EmptyCell>
          {appointmentText(
            "Für diese Klinik gibt es noch keine Interaktionen.",
            "Для этой клиники пока нет взаимодействий.",
            "No interactions for this clinic yet.",
          )}
        </EmptyCell>
      ) : (
        <div className="space-y-3">
          {detail.interactions.map((item) => (
            <ListItem key={item.id} className="space-y-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap gap-2">
                    <StatusBadge tone="neutral">
                      {humanizeLinkedCode(item.kind)}
                    </StatusBadge>
                    <StatusBadge status={item.status}>
                      {humanizeLinkedCode(item.status)}
                    </StatusBadge>
                    {item.appointment_type ? (
                      <StatusBadge tone="info">
                        {humanizeLinkedCode(item.appointment_type)}
                      </StatusBadge>
                    ) : null}
                  </div>
                  <p className="mt-3 text-sm font-semibold text-foreground">
                    {item.title}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {item.patient_id} · {item.patient_name}
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatDateTimeLabel(item.occurred_at)}
                </p>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className={cn("rounded-xl px-4 py-3", tokens.surface.card)}>
                  <InfoRow
                    label={appointmentText("Arzt", "Врач", "Doctor")}
                    value={item.doctor_name || notSet}
                  />
                </div>
                <div className={cn("rounded-xl px-4 py-3", tokens.surface.card)}>
                  <InfoRow
                    label={appointmentText("Standort", "Локация", "Location")}
                    value={item.location || notSet}
                  />
                </div>
              </div>

              {item.notes ? (
                <div
                  className={cn(
                    "rounded-xl px-4 py-3 text-sm leading-6 text-foreground",
                    tokens.surface.mutedCard,
                  )}
                >
                  {item.notes}
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-lg"
                  onClick={() => onOpenPatient(item.patient_id)}
                >
                  {appointmentText("Patient", "Пациент", "Patient")}
                </Button>
                {item.kind === "appointment" ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-lg"
                    onClick={() => onOpenAppointment(item.id)}
                  >
                    {appointmentText("Termin", "Запись", "Appointment")}
                  </Button>
                ) : null}
              </div>
            </ListItem>
          ))}
        </div>
      )}
    </Section>
  );
}

function AppointmentTimelineSection({
  timelineEvents,
}: {
  timelineEvents: AppointmentTimelineEvent[];
}) {
  const { lang } = useLang();
  const [timelineFilter, setTimelineFilter] = useState<
    "all" | AppointmentTimelineKind
  >("all");

  const visibleTimelineEvents = useMemo(
    () =>
      timelineFilter === "all"
        ? timelineEvents
        : timelineEvents.filter((item) => item.kind === timelineFilter),
    [timelineEvents, timelineFilter],
  );

  const groupedTimeline = useMemo(() => {
    const groups: Array<{
      key: string;
      label: string;
      items: AppointmentTimelineEvent[];
    }> = [];
    const byKey = new Map<
      string,
      { key: string; label: string; items: AppointmentTimelineEvent[] }
    >();

    for (const item of visibleTimelineEvents) {
      const key = appointmentTimelineDateGroupKey(item.occurredAt);
      const existing = byKey.get(key);
      if (existing) {
        existing.items.push(item);
        continue;
      }

      const group = {
        key,
        label: appointmentTimelineDateGroupLabel(item.occurredAt, lang),
        items: [item],
      };
      byKey.set(key, group);
      groups.push(group);
    }

    return groups;
  }, [lang, visibleTimelineEvents]);

  const filters = [
    "all",
    "workflow",
    "communication",
    "interpreter",
    "clinical",
    "followup",
    "concierge",
  ] as const;
  const matchesLabel = appointmentText("Treffer", "совпадений", "matches");
  const eventsLabel = appointmentText("Ereignisse", "события", "events");
  const emptyLabel = appointmentText(
    "Für diesen Termin gibt es noch keine Timeline-Ereignisse.",
    "Для этого приёма пока нет событий таймлайна.",
    "No timeline events have been recorded for this appointment yet.",
  );
  const noMatchesLabel = appointmentText(
    "Ни одно событие не соответствует текущему фильтру.",
    "Текущему фильтру не соответствует ни одно событие.",
    "No timeline events match the current filter.",
  );

  return (
    <Section
      title={appointmentText("Timeline", "Таймлайн", "Timeline")}
      accessory={
        <CountBadge>
          {visibleTimelineEvents.length} {eventsLabel}
        </CountBadge>
      }
    >
      <div className="flex flex-wrap gap-1.5">
        {filters.map((filter) => (
          <Button
            key={filter}
            type="button"
            size="sm"
            variant={timelineFilter === filter ? "default" : "outline"}
            className="h-6 rounded-full px-2.5 text-[11px]"
            onClick={() => setTimelineFilter(filter)}
          >
            {filter === "all"
              ? appointmentText("Alle", "Все", "All")
              : appointmentTimelineKindLabel(filter)}
            <span className="text-muted-foreground/60 text-[6px] leading-none align-middle">
              ●
            </span>
            {filter === "all"
              ? timelineEvents.length
              : timelineEvents.filter((item) => item.kind === filter).length}
          </Button>
        ))}
      </div>

      {timelineEvents.length === 0 ? (
        <EmptyCell>{emptyLabel}</EmptyCell>
      ) : visibleTimelineEvents.length === 0 ? (
        <EmptyCell>{noMatchesLabel}</EmptyCell>
      ) : (
        <div className="rounded-2xl border border-border/50 bg-card px-4 py-3 sm:px-5">
          <div className="space-y-5">
            {groupedTimeline.map((group) => (
              <div key={group.key} className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="shrink-0 rounded-full border border-border/60 bg-muted/35 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                    {group.label}
                  </span>
                  <span className="h-px flex-1 bg-border/60" />
                </div>

                <div className="space-y-0">
                  {group.items.map((item, idx) => (
                    <div
                      key={item.id}
                      className={cn(
                        "grid grid-cols-[16px_minmax(0,1fr)] gap-3",
                        idx < group.items.length - 1 && "pb-3",
                      )}
                    >
                      <div className="relative flex justify-center">
                        {idx < group.items.length - 1 ? (
                          <span className="absolute top-3 bottom-[-0.75rem] w-px bg-gradient-to-b from-border/90 via-border/60 to-transparent" />
                        ) : null}
                        <span
                          className={cn(
                            "relative mt-1.5 size-2 rounded-full border border-card shadow-[0_0_0_2px_rgba(255,255,255,0.92)]",
                            appointmentTimelineKindDotClass(item.kind),
                          )}
                        />
                      </div>

                      <div
                        className={cn(
                          "rounded-2xl border px-4 py-3",
                          appointmentTimelineSurfaceClass(item.tone),
                        )}
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={cn(
                                  "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]",
                                  appointmentTimelineKindBadgeClass(item.kind),
                                )}
                              >
                                {appointmentTimelineKindLabel(item.kind)}
                              </span>
                              <span
                                className={cn(
                                  "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]",
                                  timelineToneClass(item.tone),
                                )}
                              >
                                {appointmentTimelineToneLabel(item.tone)}
                              </span>
                            </div>
                            <p className="mt-2 text-sm font-semibold text-foreground">
                              {item.title}
                            </p>
                            {item.detail ? (
                              <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">
                                {item.detail}
                              </p>
                            ) : null}
                          </div>

                          <div className="shrink-0">
                            <p className="text-xs font-medium text-muted-foreground/80">
                              {formatDateTimeLabel(item.occurredAt)}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {visibleTimelineEvents.length} {matchesLabel}
      </p>
    </Section>
  );
}

const MemoizedAppointmentTimelineSection = memo(AppointmentTimelineSection);

function AppointmentInterpreterSection({
  detail,
  interpreters,
  currentUserId,
  canAssign,
  canRespond,
  onRefresh,
  onError,
}: {
  detail: AppointmentDetail;
  interpreters: InterpreterOption[];
  currentUserId?: string;
  canAssign: boolean;
  canRespond: boolean;
  onRefresh: () => void;
  onError: (message: string) => void;
}) {
  const { t } = useLang();
  const [assignInterpreterId, setAssignInterpreterId] = useState(
    detail.interpreter_id ?? "",
  );
  const [busyAction, setBusyAction] = useState<string>("");

  useEffect(() => {
    setAssignInterpreterId(detail.interpreter_id ?? "");
    setBusyAction("");
  }, [detail.id, detail.interpreter_id]);

  async function handleAssignInterpreter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!assignInterpreterId) return;
    setBusyAction("assign");
    try {
      await apiFetch<{ ok: boolean }>(
        `/appointments/${detail.id}/assign-interpreter`,
        {
          method: "POST",
          body: JSON.stringify({ interpreter_id: assignInterpreterId }),
        },
      );
      onRefresh();
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : appointmentText(
              "Dolmetscher konnte nicht zugewiesen werden.",
              "Не удалось назначить переводчика.",
              "Failed to assign interpreter",
            ),
      );
    } finally {
      setBusyAction("");
    }
  }

  async function handleInterpreterResponse(response: InterpreterResponse) {
    setBusyAction(`response:${response}`);
    try {
      await apiFetch<{ ok: boolean }>(
        `/appointments/${detail.id}/interpreter-response`,
        {
          method: "POST",
          body: JSON.stringify({ response }),
        },
      );
      onRefresh();
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : appointmentText(
              "Antwort konnte nicht gesendet werden.",
              "Не удалось отправить ответ.",
              "Failed to submit response",
            ),
      );
    } finally {
      setBusyAction("");
    }
  }

  return (
    <>
      {canAssign && !detail.is_blocked ? (
        <section className={sectionCardClass("p-5")}>
          <h3 className="text-sm font-semibold text-slate-950">
            {t.role_interpreter}
          </h3>
          <form
            onSubmit={handleAssignInterpreter}
            className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]"
          >
            <Field label={t.role_interpreter}>
              <select
                value={assignInterpreterId}
                onChange={(event) => setAssignInterpreterId(event.target.value)}
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
                disabled={!assignInterpreterId || busyAction === "assign"}
              >
                {busyAction === "assign" ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : null}
                Assign interpreter
              </Button>
            </div>
          </form>
        </section>
      ) : null}
      {canRespond && detail.interpreter_id === currentUserId ? (
        <section className={sectionCardClass("p-5")}>
          <h3 className="text-sm font-semibold text-slate-950">
            {t.role_interpreter}
          </h3>
          <div className="mt-4 flex flex-wrap gap-2">
            {INTERPRETER_RESPONSE_OPTIONS.map((value) => (
              <Button
                key={value}
                variant={
                  detail.interpreter_response === value ? "default" : "outline"
                }
                className="rounded-2xl"
                disabled={Boolean(busyAction)}
                onClick={() => void handleInterpreterResponse(value)}
              >
                {busyAction === `response:${value}` ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : null}
                {responseLabel(value)}
              </Button>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

const MemoizedAppointmentInterpreterSection = memo(
  AppointmentInterpreterSection,
);

function AppointmentChecklistSection({
  detail,
  items,
  onRefresh,
  onError,
}: {
  detail: AppointmentDetail;
  items: ChecklistItem[];
  onRefresh: () => void;
  onError: (message: string) => void;
}) {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const [form, setForm] = useState<ChecklistFormState>(blankChecklistForm());
  const [submitBusy, setSubmitBusy] = useState(false);
  const [completingId, setCompletingId] = useState("");

  useEffect(() => {
    setForm(blankChecklistForm());
    setSubmitBusy(false);
    setCompletingId("");
  }, [detail.id]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitBusy(true);
    try {
      await apiFetch<{ id: string }>(`/appointments/${detail.id}/checklist`, {
        method: "POST",
        body: JSON.stringify({
          phase: form.phase,
          item_text: form.itemText.trim(),
        }),
      });
      setForm(blankChecklistForm());
      onRefresh();
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : appointmentText(
              "Checklisteneintrag konnte nicht hinzugefügt werden.",
              "Не удалось добавить пункт чек-листа.",
              "Failed to add checklist item",
            ),
      );
    } finally {
      setSubmitBusy(false);
    }
  }

  async function handleComplete(itemId: string) {
    setCompletingId(itemId);
    try {
      await apiFetch<{ ok: boolean }>(
        `/appointments/${detail.id}/checklist/${itemId}/complete`,
        { method: "POST" },
      );
      onRefresh();
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : appointmentText(
              "Element konnte nicht abgeschlossen werden.",
              "Не удалось завершить элемент.",
              "Failed to complete item",
            ),
      );
    } finally {
      setCompletingId("");
    }
  }

  return (
    <section className={sectionCardClass("p-5")}>
      <h3 className="text-sm font-semibold text-slate-950">{t.orders_phase}</h3>
      <div className="mt-4 space-y-3">
        {items.length === 0 ? (
          <EmptyState text={t.common_not_set} />
        ) : (
          items.map((item) => (
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
                  {t.common_completed} {formatDateTimeLabel(item.completed_at)}
                </span>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-2xl"
                  disabled={Boolean(completingId)}
                  onClick={() => void handleComplete(item.id)}
                >
                  {completingId === item.id ? (
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
        onSubmit={handleSubmit}
        className="mt-5 grid gap-4 md:grid-cols-[180px_minmax(0,1fr)_auto]"
      >
        <Field label={t.orders_phase}>
          <select
            value={form.phase}
            onChange={(event) =>
              setForm((current) => ({
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
            value={form.itemText}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                itemText: event.target.value,
              }))
            }
            placeholder={withEllipsis(tr.appointments_title_col)}
            className="h-10 rounded-xl bg-slate-50"
            required
          />
        </Field>
        <div className="flex items-end">
          <Button
            type="submit"
            className="rounded-2xl"
            disabled={submitBusy || !form.itemText.trim()}
          >
            {submitBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
            Add checklist item
          </Button>
        </div>
      </form>
    </section>
  );
}

const MemoizedAppointmentChecklistSection = memo(AppointmentChecklistSection);

function AppointmentRemindersSection({
  detail,
  reminders,
  staff,
  canManageReminders,
  onRefresh,
  onError,
}: {
  detail: AppointmentDetail;
  reminders: ReminderEntry[];
  staff: StaffOption[];
  canManageReminders: boolean;
  onRefresh: () => void;
  onError: (message: string) => void;
}) {
  const { t } = useLang();
  const [form, setForm] = useState<ReminderFormState>(blankReminderForm());
  const [submitBusy, setSubmitBusy] = useState(false);
  const [completingId, setCompletingId] = useState("");

  useEffect(() => {
    setForm(blankReminderForm());
    setSubmitBusy(false);
    setCompletingId("");
  }, [detail.id]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitBusy(true);
    try {
      await apiFetch<{ id: string }>(`/appointments/${detail.id}/reminders`, {
        method: "POST",
        body: JSON.stringify({
          user_id: form.userId,
          remind_at: toRfc3339(form.remindAt),
          title: form.title.trim(),
          description: form.description.trim() || null,
        }),
      });
      setForm(blankReminderForm());
      onRefresh();
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : appointmentText(
              "Erinnerung konnte nicht hinzugefügt werden.",
              "Не удалось добавить напоминание.",
              "Failed to add reminder",
            ),
      );
    } finally {
      setSubmitBusy(false);
    }
  }

  async function handleComplete(reminderId: string) {
    setCompletingId(reminderId);
    try {
      await apiFetch<{ ok: boolean }>(
        `/appointments/${detail.id}/reminders/${reminderId}/complete`,
        { method: "POST" },
      );
      onRefresh();
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : appointmentText(
              "Erinnerung konnte nicht abgeschlossen werden.",
              "Не удалось завершить напоминание.",
              "Failed to complete reminder",
            ),
      );
    } finally {
      setCompletingId("");
    }
  }

  return (
    <section className={sectionCardClass("p-5")}>
      <h3 className="text-sm font-semibold text-slate-950">
        {t.patients_notes}
      </h3>
      <div className="mt-4 space-y-3">
        {reminders.length === 0 ? (
          <EmptyState text={t.common_not_set} />
        ) : (
          reminders.map((item) => (
            <div
              key={item.id}
              className="flex flex-col gap-3 rounded-2xl border border-slate-200/80 bg-slate-50/80 px-4 py-3 md:flex-row md:items-center md:justify-between"
            >
              <div>
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
              {item.is_completed ? (
                <span className="text-xs font-medium text-emerald-700">
                  Completed {formatDateTimeLabel(item.completed_at)}
                </span>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-2xl"
                  disabled={Boolean(completingId)}
                  onClick={() => void handleComplete(item.id)}
                >
                  {completingId === item.id ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : null}
                  {t.common_active}
                </Button>
              )}
            </div>
          ))
        )}
      </div>
      {canManageReminders ? (
        <form onSubmit={handleSubmit} className="mt-5 grid gap-4 md:grid-cols-2">
          <Field label={t.patients_assign_owner}>
            <select
              value={form.userId}
              onChange={(event) =>
                setForm((current) => ({
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
              value={form.remindAt}
              onChange={(event) =>
                setForm((current) => ({
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
              value={form.title}
              onChange={(event) =>
                setForm((current) => ({
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
              value={form.description}
              onChange={(event) =>
                setForm((current) => ({
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
                submitBusy ||
                !form.userId ||
                !form.remindAt ||
                !form.title.trim()
              }
            >
              {submitBusy ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : null}
              {t.appointments_add_reminder}
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

const MemoizedAppointmentRemindersSection = memo(AppointmentRemindersSection);

function AppointmentCompletionSection({
  detail,
  detailReport,
  handoffStakeholders,
  openChecklistCount,
  openTaskCount,
  pendingReminderCount,
  interpreterReportReady,
  completionWarnings,
  followUpAssigneeId,
  setFollowUpAssigneeId,
  onRefresh,
  onError,
  onNotice,
}: {
  detail: AppointmentDetail;
  detailReport: ReportSummary | null;
  handoffStakeholders: HandoffStakeholder[];
  openChecklistCount: number;
  openTaskCount: number;
  pendingReminderCount: number;
  interpreterReportReady: boolean;
  completionWarnings: string[];
  followUpAssigneeId: string;
  setFollowUpAssigneeId: (value: string) => void;
  onRefresh: () => void;
  onError: (message: string) => void;
  onNotice: (notice: string) => void;
}) {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const [completionPlan, setCompletionPlan] = useState<Record<string, boolean>>(
    () => defaultCompletionPlan(),
  );
  const [busyAction, setBusyAction] = useState<"" | "complete" | "follow-up">("");
  const selectedCompletionPresetCount = useMemo(() => {
    let count = 0;
    for (const preset of FOLLOW_UP_PRESETS) {
      if (completionPlan[preset.id]) {
        count += 1;
      }
    }
    return count;
  }, [completionPlan]);

  useEffect(() => {
    setCompletionPlan(defaultCompletionPlan());
    setBusyAction("");
  }, [detail.id, detail.status]);

  async function handleCompleteOnly() {
    setBusyAction("complete");
    try {
      await apiFetch<{ ok: boolean }>(`/appointments/${detail.id}/status`, {
        method: "POST",
        body: JSON.stringify({ status: "completed" }),
      });
      onRefresh();
    } catch (error) {
      onError(error instanceof Error ? error.message : tr.common_failed_update);
    } finally {
      setBusyAction("");
    }
  }

  async function handleCompleteWithFollowUp() {
    const selectedPresets = FOLLOW_UP_PRESETS.filter(
      (preset) => completionPlan[preset.id],
    );
    if (selectedPresets.length > 0 && !followUpAssigneeId) return;

    setBusyAction("follow-up");
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
            return apiFetch<{ id: string }>(`/appointments/${detail.id}/reminders`, {
              method: "POST",
              body: JSON.stringify({
                user_id: followUpAssigneeId,
                remind_at: toRfc3339(remindAt),
                title: preset.title,
                description: `Auto-planned during appointment completion for ${detail.patient_pid} · ${detail.title}.`,
              }),
            });
          }),
        );
      }

      onNotice(
        selectedPresets.length > 0
          ? `Appointment completed. ${selectedPresets.length} follow-up reminder(s) scheduled.`
          : t.common_active,
      );
      onRefresh();
    } catch (error) {
      if (completed) {
        onError(
          error instanceof Error
            ? `Appointment completed, but follow-up scheduling failed: ${error.message}`
            : tr.common_error,
        );
        onRefresh();
      } else {
        onError(error instanceof Error ? error.message : tr.common_failed_update);
      }
    } finally {
      setBusyAction("");
    }
  }

  return (
    <section className={sectionCardClass("p-5")}>
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-950">
            Completion readiness
          </h3>
          <p className="text-xs text-slate-500">
            Review operational blockers before closing the appointment and
            launching standard post-care follow-up.
          </p>
        </div>
        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
          {detail.status === "completed" ? "Completed" : statusLabel(detail.status)}
        </span>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <ContextCard
          label={t.cases_status}
          value={
            openChecklistCount === 0 ? "Ready" : `${openChecklistCount} open`
          }
          meta={
            openChecklistCount === 0
              ? "No pending checklist items."
              : "Finish outstanding preparation or follow-up steps."
          }
        />
        <ContextCard
          label={t.cases_title}
          value={openTaskCount === 0 ? "Ready" : `${openTaskCount} open`}
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
          <Banner tone="warning" withIcon>
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
          <Field label={tr.patients_assign_owner}>
            <select
              value={followUpAssigneeId}
              onChange={(event) => setFollowUpAssigneeId(event.target.value)}
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
                variant={completionPlan[preset.id] ? "default" : "outline"}
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
              disabled={Boolean(busyAction)}
              onClick={handleCompleteOnly}
            >
              {t.appointments_complete_only}
            </Button>
            <Button
              type="button"
              className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
              disabled={
                Boolean(busyAction) ||
                (selectedCompletionPresetCount > 0 && !followUpAssigneeId)
              }
              onClick={handleCompleteWithFollowUp}
            >
              {busyAction === "follow-up" ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : null}
              {t.appointments_complete_and_schedule}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

const MemoizedAppointmentCompletionSection = memo(
  AppointmentCompletionSection,
);

function AppointmentStatusSection({
  detail,
  openChecklistCount,
  onRefresh,
  onError,
}: {
  detail: AppointmentDetail;
  openChecklistCount: number;
  onRefresh: () => void;
  onError: (message: string) => void;
}) {
  const { t } = useLang();
  const [statusRecurrenceScope, setStatusRecurrenceScope] =
    useState<AppointmentRecurringActionScope>("single");
  const [busyAction, setBusyAction] = useState("");
  const selectedRecurringStatusTargets = useMemo(
    () =>
      detail.recurrence_frequency
        ? recurringStatusTargetsForScope(detail, statusRecurrenceScope)
        : [
            {
              id: detail.id,
              date: detail.date,
              status: detail.status,
              recurrence_index: detail.recurrence_index,
              open_checklist_count: openChecklistCount,
            },
          ],
    [detail, openChecklistCount, statusRecurrenceScope],
  );
  const completionScopeBlockers = useMemo(
    () =>
      selectedRecurringStatusTargets.filter(
        (item) =>
          !["completed", "cancelled"].includes(item.status) &&
          item.open_checklist_count > 0,
      ),
    [selectedRecurringStatusTargets],
  );

  useEffect(() => {
    setStatusRecurrenceScope("single");
    setBusyAction("");
  }, [detail.id, detail.recurrence_frequency]);

  async function handleStatusChange(
    status: AppointmentStatus,
    recurrenceScope: AppointmentRecurringActionScope = "single",
  ) {
    const nextBusyAction = statusActionKey(detail.id, status, recurrenceScope);
    setBusyAction(nextBusyAction);
    try {
      await apiFetch<{ ok: boolean }>(`/appointments/${detail.id}/status`, {
        method: "POST",
        body: JSON.stringify({
          status,
          recurrence_scope: recurrenceScope,
        }),
      });
      onRefresh();
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : appointmentText(
              "Status konnte nicht geändert werden.",
              "Не удалось изменить статус.",
              "Failed to change status",
            ),
      );
    } finally {
      setBusyAction("");
    }
  }

  return (
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
                    event.target.value as AppointmentRecurringActionScope,
                  )
                }
                className={selectClassName}
              >
                <option value="single">{t.appointments_scope_single}</option>
                <option value="following">{t.appointments_scope_following}</option>
                <option value="series">{t.appointments_scope_series}</option>
              </select>
            </Field>
          </div>
        ) : null}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {STATUS_OPTIONS.map((status) => {
          const recurrenceScope = detail.recurrence_frequency
            ? statusRecurrenceScope
            : "single";
          const nextBusyAction = statusActionKey(detail.id, status, recurrenceScope);
          return (
            <Button
              key={status}
              variant={detail.status === status ? "default" : "outline"}
              className={cn(
                "rounded-2xl",
                detail.status === status
                  ? "bg-slate-950 text-white hover:bg-slate-800"
                  : "",
              )}
              disabled={Boolean(busyAction)}
              onClick={() => handleStatusChange(status, recurrenceScope)}
            >
              {busyAction === nextBusyAction ? (
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
          );
        })}
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
            <Banner tone="warning" withIcon>
              Completing this scope is currently blocked by{" "}
              {completionScopeBlockers.length} occurrence
              {completionScopeBlockers.length === 1 ? "" : "s"}:{" "}
              {completionScopeBlockers
                .map((item) => recurringOccurrenceLabel(item, t))
                .join("; ")}
            </Banner>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

const MemoizedAppointmentStatusSection = memo(AppointmentStatusSection);

function AppointmentReportSection({
  detail,
  detailReport,
  reportReviewMeta,
  canSubmitInterpreterReport,
  canResubmitRejectedReport,
  showReportReviewActions,
  canApproveReport,
  canRejectReport,
  onRefresh,
  onError,
}: {
  detail: AppointmentDetail;
  detailReport: ReportSummary | null;
  reportReviewMeta: string;
  canSubmitInterpreterReport: boolean;
  canResubmitRejectedReport: boolean;
  showReportReviewActions: boolean;
  canApproveReport: boolean;
  canRejectReport: boolean;
  onRefresh: () => void;
  onError: (message: string) => void;
}) {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const [form, setForm] = useState<ReportFormState>(() => blankReportForm());
  const [rejectReason, setRejectReason] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);

  useEffect(() => {
    setForm(
      detailReport && detailReport.approval_status === "rejected"
        ? {
            hours: detailReport.hours,
            reportText: detailReport.report_text ?? "",
          }
        : blankReportForm(),
    );
    setRejectReason("");
    setBusyAction("");
    setEditorOpen(false);
  }, [detail.id, detailReport]);

  async function handleReportSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusyAction("report-submit");
    try {
      await apiFetch<{ id: string }>(`/appointments/${detail.id}/report`, {
        method: "POST",
        body: JSON.stringify({
          hours: Number(form.hours),
          report_text: form.reportText.trim() || null,
        }),
      });
      setForm(blankReportForm());
      setEditorOpen(false);
      onRefresh();
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : appointmentText(
              "Bericht konnte nicht eingereicht werden.",
              "Не удалось отправить отчёт.",
              "Failed to submit report",
            ),
      );
    } finally {
      setBusyAction("");
    }
  }

  async function handleApproveReport() {
    setBusyAction("report-approve");
    try {
      await apiFetch<{ ok: boolean }>(`/appointments/${detail.id}/report/approve`, {
        method: "POST",
      });
      setEditorOpen(false);
      onRefresh();
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : appointmentText(
              "Bericht konnte nicht freigegeben werden.",
              "Не удалось согласовать отчёт.",
              "Failed to approve report",
            ),
      );
    } finally {
      setBusyAction("");
    }
  }

  async function handleRejectReport() {
    setBusyAction("report-reject");
    try {
      await apiFetch<{ ok: boolean }>(`/appointments/${detail.id}/report/reject`, {
        method: "POST",
        body: JSON.stringify({ notes: rejectReason.trim() || null }),
      });
      setRejectReason("");
      setEditorOpen(false);
      onRefresh();
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : appointmentText(
              "Bericht konnte nicht zurückgewiesen werden.",
              "Не удалось отклонить отчёт.",
              "Failed to reject report",
            ),
      );
    } finally {
      setBusyAction("");
    }
  }

  const reportStatusTone =
    detailReport?.approval_status === "approved"
      ? "success"
      : detailReport?.approval_status === "rejected"
        ? "error"
        : "warning";
  const canOpenReportEditor = canSubmitInterpreterReport || showReportReviewActions;
  const reportEditorTitle = showReportReviewActions
    ? appointmentText(
        "Review-Entscheidung",
        "Решение по проверке",
        "Review decision",
      )
    : canResubmitRejectedReport
      ? appointmentText(
          "Bericht überarbeiten",
          "Доработать отчёт",
          "Revise report",
        )
      : appointmentText(
          "Bericht einreichen",
          "Отправить отчёт",
          "Submit report",
        );
  const reportOpenButtonLabel = showReportReviewActions
    ? appointmentText("Review öffnen", "Открыть review", "Open review")
    : appointmentText("Bericht öffnen", "Открыть отчёт", "Open report");

  return (
    <div className="space-y-4">
      <Section
        title={t.appointments_interpreter_report_title}
        accessory={
          <div className="flex items-center gap-2">
            {detailReport ? (
              <StatusBadge tone={reportStatusTone}>
                {reportApprovalLabel(detailReport.approval_status)}
              </StatusBadge>
            ) : (
              <CountBadge>
                {appointmentText("Nicht eingereicht", "Не отправлен", "Not submitted")}
              </CountBadge>
            )}
            {canOpenReportEditor ? (
              <Button
                type="button"
                size="sm"
                className="h-8 rounded-lg gap-1.5"
                onClick={() => setEditorOpen(true)}
              >
                {reportOpenButtonLabel}
              </Button>
            ) : null}
          </div>
        }
      >
        <p className="text-sm text-muted-foreground">
          {t.appointments_interpreter_report_subtitle}
        </p>

        {detailReport ? (
          <>
            <div className="grid gap-3 xl:grid-cols-3">
              <StatCard
                label={appointmentText("Dolmetscher", "Переводчик", "Interpreter")}
                value={
                  detailReport.interpreter_name ??
                  appointmentText("Nicht festgelegt", "Не указано", "Not set")
                }
                description={`${t.appointments_report_submitted_prefix} ${formatDateTimeLabel(detailReport.created_at)}`}
              />
              <StatCard
                label={t.appointments_time}
                value={`${detailReport.hours} h`}
                description={
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
              <StatCard
                label={tr.patients_notes}
                value={
                  detailReport.approved_by_name ??
                  (detailReport.approval_status === "pending"
                    ? t.common_pending
                    : t.appointments_report_no_reviewer_recorded)
                }
                description={
                  reportReviewMeta ||
                  appointmentText(
                    "Noch keine Review-Metadaten.",
                    "Метаданные проверки пока отсутствуют.",
                    "No review metadata recorded yet.",
                  )
                }
              />
            </div>

            {detailReport.notes ? (
              <Banner
                tone={detailReport.approval_status === "rejected" ? "error" : "warning"}
                withIcon
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
                  "rounded-xl border px-4 py-3 text-sm",
                  interpreterReportBillingSyncClass(detailReport.billing_sync_status),
                )}
              >
                <p className="font-medium">{t.appointments_report_billing_sync}</p>
                <p className="mt-1">
                  {interpreterReportBillingSyncLabel(
                    detailReport.billing_sync_status,
                    t,
                  )}
                </p>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs opacity-80">
                  {detailReport.billing_service_key ? (
                    <span>
                      {appointmentText(
                        "Katalogschlüssel",
                        "Ключ каталога",
                        "Catalog key",
                      )}
                      : {detailReport.billing_service_key}
                    </span>
                  ) : null}
                  {detailReport.billing_leistung_id ? (
                    <span>
                      {appointmentText(
                        "Auftragsposition",
                        "Строка заказа",
                        "Order line",
                      )}
                      : {detailReport.billing_leistung_id}
                    </span>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className={cn("rounded-xl px-4 py-4", tokens.surface.card)}>
              <p className={tokens.text.label}>
                {appointmentText("Berichtstext", "Текст отчёта", "Report text")}
              </p>
              {detailReport.report_text ? (
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">
                  {detailReport.report_text}
                </p>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  {appointmentText(
                    "Kein Freitext-Bericht eingereicht.",
                    "Свободный текст отчёта не отправлен.",
                    "No free-text report submitted.",
                  )}
                </p>
              )}
            </div>
          </>
        ) : (
          <EmptyCell>
            {appointmentText(
              "Für diesen Termin liegt noch kein Dolmetscherbericht vor.",
              "Для этого приёма пока нет отчёта переводчика.",
              "No interpreter report has been submitted for this appointment yet.",
            )}
          </EmptyCell>
        )}
      </Section>

      {canOpenReportEditor ? (
        <AppointmentEditorSheet
          open={editorOpen}
          onOpenChange={setEditorOpen}
          title={reportEditorTitle}
          description={
            showReportReviewActions
              ? appointmentText(
                  "Prüfen Sie Stunden und Bericht direkt im Kontext dieses Termins.",
                  "Проверьте часы и текст отчёта прямо в контексте этого приёма.",
                  "Review the hours and report directly in the context of this appointment.",
                )
              : appointmentText(
                  "Pflegen Sie Stunden und Freitextbericht direkt im rechten Bearbeitungsbereich dieses Termins.",
                  "Заполняйте часы и текстовый отчёт прямо в правой панели редактирования этого приёма.",
                  "Manage hours and free-text report directly in this appointment's right-side editor.",
                )
          }
          onSubmit={
            canSubmitInterpreterReport ? handleReportSubmit : (event) => event.preventDefault()
          }
          footer={
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 rounded-lg"
                onClick={() => setEditorOpen(false)}
              >
                {t.common_cancel}
              </Button>
              {showReportReviewActions && canRejectReport ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-lg gap-1.5 border-rose-200 text-rose-700 hover:bg-rose-50"
                  disabled={busyAction === "report-reject"}
                  onClick={handleRejectReport}
                >
                  {busyAction === "report-reject" ? (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  ) : null}
                  {appointmentText(
                    "Zur Überarbeitung zurückgeben",
                    "Вернуть на доработку",
                    "Return for revision",
                  )}
                </Button>
              ) : null}
              {showReportReviewActions && canApproveReport ? (
                <Button
                  type="button"
                  size="sm"
                  className="h-8 rounded-lg gap-1.5"
                  disabled={busyAction === "report-approve"}
                  onClick={handleApproveReport}
                >
                  {busyAction === "report-approve" ? (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  ) : null}
                  {appointmentText(
                    "Stunden und Bericht freigeben",
                    "Согласовать часы и отчёт",
                    "Approve hours and report",
                  )}
                </Button>
              ) : null}
              {canSubmitInterpreterReport ? (
                <Button
                  type="submit"
                  size="sm"
                  className="h-8 rounded-lg gap-1.5"
                  disabled={busyAction === "report-submit" || !form.hours}
                >
                  {busyAction === "report-submit" ? (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  ) : null}
                  {canResubmitRejectedReport
                    ? appointmentText(
                        "Bericht erneut einreichen",
                        "Повторно отправить отчёт",
                        "Resubmit report",
                      )
                    : t.common_save}
                </Button>
              ) : null}
            </>
          }
        >
          {canResubmitRejectedReport ? (
            <Banner tone="warning" withIcon>
              {appointmentText(
                "Der letzte Bericht wurde zurückgegeben. Passen Sie Stunden oder Text an und reichen Sie ihn erneut zur Freigabe ein.",
                "Последний отчёт вернули на доработку. Обновите часы или текст и отправьте его повторно на согласование.",
                "The latest report was returned. Update the hours or text and resubmit it for approval.",
              )}
            </Banner>
          ) : null}

          {canSubmitInterpreterReport ? (
            <>
              <div className="grid gap-4 md:grid-cols-[180px_minmax(0,1fr)]">
                <Field label={t.appointments_time}>
                  <Input
                    type="number"
                    min="0"
                    step="0.25"
                    value={form.hours}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        hours: event.target.value,
                      }))
                    }
                    className={cn(inputClass, "h-10 rounded-xl")}
                    required
                  />
                </Field>
                <Field label={tr.patients_notes}>
                  <textarea
                    value={form.reportText}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        reportText: event.target.value,
                      }))
                    }
                    className={textareaClassName}
                    rows={5}
                    placeholder={withEllipsis(tr.patients_notes)}
                  />
                </Field>
              </div>
            </>
          ) : null}

          {showReportReviewActions ? (
            <>
              <div className={cn("rounded-xl px-4 py-3", tokens.surface.mutedCard)}>
                <p className={tokens.text.label}>
                  {appointmentText("Bericht", "Отчёт", "Report")}
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">
                  {detailReport?.report_text ||
                    appointmentText(
                      "Kein Freitext-Bericht eingereicht.",
                      "Свободный текст отчёта не отправлен.",
                      "No free-text report submitted.",
                    )}
                </p>
              </div>
              <Field label={tr.patients_notes}>
                <textarea
                  value={rejectReason}
                  onChange={(event) => setRejectReason(event.target.value)}
                  className={textareaClassName}
                  rows={4}
                  placeholder={withEllipsis(tr.patients_notes)}
                />
              </Field>
            </>
          ) : null}
        </AppointmentEditorSheet>
      ) : null}
    </div>
  );
}

const MemoizedAppointmentReportSection = memo(AppointmentReportSection);

function AppointmentTasksSection({
  detail,
  tasks,
  assignableStaff,
  canCreateTasks,
  onRefresh,
  onError,
}: {
  detail: AppointmentDetail;
  tasks: TaskEntry[];
  assignableStaff: StaffOption[];
  canCreateTasks: boolean;
  onRefresh: () => void;
  onError: (message: string) => void;
}) {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const [form, setForm] = useState<TaskFormState>(() =>
    blankTaskForm(
      detail.interpreter_id ?? detail.owner_user_id ?? assignableStaff[0]?.id ?? "",
      buildTaskDefaultDueDate(detail),
    ),
  );
  const [submitBusy, setSubmitBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState("");

  useEffect(() => {
    setForm(
      blankTaskForm(
        detail.interpreter_id ??
          detail.owner_user_id ??
          assignableStaff[0]?.id ??
          "",
        buildTaskDefaultDueDate(detail),
      ),
    );
    setSubmitBusy(false);
    setActionBusy("");
  }, [assignableStaff, detail]);

  async function handleTaskSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitBusy(true);
    try {
      await apiFetch<{ id: string }>("/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: form.title.trim(),
          description: form.description.trim() || null,
          assigned_to: form.assignedTo,
          patient_id: detail.patient_id,
          order_id: detail.order_id,
          appointment_id: detail.id,
          due_date: form.dueDate ? toRfc3339(form.dueDate) : null,
          priority: form.priority,
        }),
      });
      setForm(
        blankTaskForm(
          detail.interpreter_id ??
            detail.owner_user_id ??
            assignableStaff[0]?.id ??
            "",
          buildTaskDefaultDueDate(detail),
        ),
      );
      onRefresh();
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : appointmentText(
              "Aufgabe konnte nicht erstellt werden.",
              "Не удалось создать задачу.",
              "Failed to create task",
            ),
      );
    } finally {
      setSubmitBusy(false);
    }
  }

  async function handleTaskStatus(taskId: string, status: string) {
    setActionBusy(`task:${taskId}:${status}`);
    try {
      await apiFetch<{ ok: boolean }>(`/tasks/${taskId}/status`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      onRefresh();
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : appointmentText(
              "Aufgabe konnte nicht aktualisiert werden.",
              "Не удалось обновить задачу.",
              "Failed to update task",
            ),
      );
    } finally {
      setActionBusy("");
    }
  }

  return (
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
          {tasks.length} linked
        </span>
      </div>
      <div className="mt-4 space-y-3">
        {tasks.length === 0 ? (
          <EmptyState text={tr.common_not_set} />
        ) : (
          tasks.map((task) => (
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
                      variant={task.status === status ? "default" : "outline"}
                      size="sm"
                      className={cn(
                        "rounded-2xl",
                        task.status === status
                          ? "bg-slate-950 text-white hover:bg-slate-800"
                          : "",
                      )}
                      disabled={Boolean(actionBusy) || task.status === status}
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
      {canCreateTasks ? (
        <form onSubmit={handleTaskSubmit} className="mt-5 grid gap-4 md:grid-cols-2">
          <Field label={tr.appointments_title_col}>
            <Input
              value={form.title}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  title: event.target.value,
                }))
              }
              placeholder={withEllipsis(tr.appointments_title_col)}
              className="h-10 rounded-xl bg-slate-50"
              required
            />
          </Field>
          <Field label={tr.patients_assign_owner}>
            <select
              value={form.assignedTo}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  assignedTo: event.target.value,
                }))
              }
              className={selectClassName}
              required
            >
              <option value="">{tr.common_not_set}</option>
              {assignableStaff.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name} · {roleLabel(member.role)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={tr.invoices_due_at}>
            <Input
              type="datetime-local"
              value={form.dueDate}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  dueDate: event.target.value,
                }))
              }
              className="h-10 rounded-xl bg-slate-50"
            />
          </Field>
          <Field label={t.users_status}>
            <select
              value={form.priority}
              onChange={(event) =>
                setForm((current) => ({
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
              value={form.description}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
              className={textareaClassName}
              rows={3}
              placeholder={withEllipsis(tr.patients_notes)}
            />
          </Field>
          <div className="flex items-end justify-end md:col-span-2">
            <Button
              type="submit"
              className="rounded-2xl"
              disabled={submitBusy || !form.title.trim() || !form.assignedTo}
            >
              {submitBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
              Add task
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

const MemoizedAppointmentTasksSection = memo(AppointmentTasksSection);

function AppointmentConciergeSection({
  detail,
  services,
  nonMedicalProviders,
  conciergeStaff,
  canManageConciergeServices,
  canManageConciergeBilling,
  onRefresh,
  onError,
}: {
  detail: AppointmentDetail;
  services: ConciergeServiceEntry[];
  nonMedicalProviders: ProviderSummary[];
  conciergeStaff: StaffOption[];
  canManageConciergeServices: boolean;
  canManageConciergeBilling: boolean;
  onRefresh: () => void;
  onError: (message: string) => void;
}) {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;

  const buildCreateForm = useCallback(
    () =>
      blankConciergeServiceForm({
        providerId:
          detail.provider_id &&
          nonMedicalProviders.some((provider) => provider.id === detail.provider_id)
            ? detail.provider_id
            : "",
        assignedConciergeId:
          detail.owner_role === "concierge"
            ? (detail.owner_user_id ?? "")
            : (conciergeStaff[0]?.id ?? ""),
        serviceKind: detail.category?.toLowerCase().includes("transfer")
          ? "transfer"
          : "other",
        title: detail.title,
        startsAt: detail.time_start
          ? `${detail.date}T${detail.time_start.slice(0, 5)}`
          : "",
        endsAt: detail.time_end ? `${detail.date}T${detail.time_end.slice(0, 5)}` : "",
        currency: "EUR",
      }),
    [conciergeStaff, detail, nonMedicalProviders],
  );

  const [form, setForm] = useState<ConciergeServiceFormState>(() =>
    buildCreateForm(),
  );
  const [drafts, setDrafts] = useState<Record<string, ConciergeServiceDraftState>>(
    () => Object.fromEntries(services.map((service) => [service.id, buildServiceDraft(service)])),
  );
  const [submitBusy, setSubmitBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState("");

  useEffect(() => {
    setForm(buildCreateForm());
    setDrafts(
      Object.fromEntries(
        services.map((service) => [service.id, buildServiceDraft(service)]),
      ),
    );
    setSubmitBusy(false);
    setActionBusy("");
  }, [buildCreateForm, services]);

  function updateDraft(
    serviceId: string,
    patch: Partial<ConciergeServiceDraftState>,
  ) {
    setDrafts((current) => {
      const existingDraft = current[serviceId];
      if (existingDraft) {
        return {
          ...current,
          [serviceId]: { ...existingDraft, ...patch },
        };
      }
      const service = services.find((item) => item.id === serviceId);
      if (!service) return current;
      return {
        ...current,
        [serviceId]: { ...buildServiceDraft(service), ...patch },
      };
    });
  }

  async function handleServiceSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitBusy(true);
    try {
      await apiFetch<ConciergeServiceEntry>("/concierge-services", {
        method: "POST",
        body: JSON.stringify({
          patient_id: detail.patient_id,
          appointment_id: detail.id,
          provider_id: form.providerId || null,
          assigned_concierge_id: form.assignedConciergeId || null,
          service_kind: form.serviceKind,
          title: form.title.trim(),
          vendor_name: form.vendorName.trim() || null,
          vendor_contact: form.vendorContact.trim() || null,
          starts_at: form.startsAt ? toRfc3339(form.startsAt) : null,
          ends_at: form.endsAt ? toRfc3339(form.endsAt) : null,
          cost_estimate: form.costEstimate ? Number(form.costEstimate) : null,
          currency: form.currency.trim().toUpperCase() || "EUR",
          service_notes: form.serviceNotes.trim() || null,
        }),
      });
      setForm(buildCreateForm());
      onRefresh();
    } catch (error) {
      onError(
        error instanceof Error ? error.message : tr.common_failed_create,
      );
    } finally {
      setSubmitBusy(false);
    }
  }

  async function handleServiceSave(serviceId: string) {
    const draft = drafts[serviceId];
    if (!draft) return;
    setActionBusy(`service:${serviceId}`);
    try {
      const payload = canManageConciergeBilling
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
      onRefresh();
    } catch (error) {
      onError(
        error instanceof Error ? error.message : tr.common_failed_update,
      );
    } finally {
      setActionBusy("");
    }
  }

  return (
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
          {services.length} service{services.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="mt-4 space-y-4">
        {services.length === 0 ? (
          <EmptyState text={tr.common_not_set} />
        ) : (
          services.map((service) => {
            const draft = drafts[service.id] ?? buildServiceDraft(service);
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
                        {service.assigned_concierge_name || tr.common_not_set}
                        {service.provider_name ? ` · ${service.provider_name}` : ""}
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
                    {canManageConciergeBilling ? (
                      <>
                        <Field label={t.appointments_title_col}>
                          <Input
                            value={draft.title}
                            onChange={(event) =>
                              updateDraft(service.id, { title: event.target.value })
                            }
                            className="h-10 rounded-xl bg-white"
                          />
                        </Field>
                        <Field label={t.common_provider}>
                          <select
                            value={draft.providerId}
                            onChange={(event) =>
                              updateDraft(service.id, {
                                providerId: event.target.value,
                              })
                            }
                            className={selectClassName}
                          >
                            <option value="">
                              {appointmentText(
                                "Kein Anbieter",
                                "Без провайдера",
                                "No provider",
                              )}
                            </option>
                            {nonMedicalProviders.map((provider) => (
                              <option key={provider.id} value={provider.id}>
                                {provider.name}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label={tr.role_concierge}>
                          <select
                            value={draft.assignedConciergeId}
                            onChange={(event) =>
                              updateDraft(service.id, {
                                assignedConciergeId: event.target.value,
                              })
                            }
                            className={selectClassName}
                          >
                            <option value="">
                              {appointmentText(
                                "Ohne Concierge",
                                "Без concierge",
                                "No concierge",
                              )}
                            </option>
                            {conciergeStaff.map((member) => (
                              <option key={member.id} value={member.id}>
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
                          updateDraft(service.id, { status: event.target.value })
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
                    <Field label={tr.appointments_title_col}>
                      <Input
                        value={draft.bookingReference}
                        onChange={(event) =>
                          updateDraft(service.id, {
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
                          updateDraft(service.id, { actualCost: event.target.value })
                        }
                        className="h-10 rounded-xl bg-white"
                      />
                    </Field>
                    <Field label={tr.common_provider}>
                      <Input
                        value={draft.vendorName}
                        onChange={(event) =>
                          updateDraft(service.id, { vendorName: event.target.value })
                        }
                        className="h-10 rounded-xl bg-white"
                      />
                    </Field>
                    <Field label={tr.field_phone}>
                      <Input
                        value={draft.vendorContact}
                        onChange={(event) =>
                          updateDraft(service.id, {
                            vendorContact: event.target.value,
                          })
                        }
                        className="h-10 rounded-xl bg-white"
                      />
                    </Field>
                    <Field label={tr.providers_service_valid_from}>
                      <Input
                        type="datetime-local"
                        value={draft.startsAt}
                        onChange={(event) =>
                          updateDraft(service.id, { startsAt: event.target.value })
                        }
                        className="h-10 rounded-xl bg-white"
                      />
                    </Field>
                    <Field label={tr.providers_service_valid_to}>
                      <Input
                        type="datetime-local"
                        value={draft.endsAt}
                        onChange={(event) =>
                          updateDraft(service.id, { endsAt: event.target.value })
                        }
                        className="h-10 rounded-xl bg-white"
                      />
                    </Field>
                    {canManageConciergeBilling ? (
                      <>
                        <Field label={tr.users_status}>
                          <select
                            value={draft.billingStatus}
                            onChange={(event) =>
                              updateDraft(service.id, {
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
                        <Field label={tr.contracts_total}>
                          <Input
                            value={draft.currency}
                            onChange={(event) =>
                              updateDraft(service.id, { currency: event.target.value })
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
                          updateDraft(service.id, {
                            serviceNotes: event.target.value,
                          })
                        }
                        className={textareaClassName}
                        rows={3}
                      />
                    </Field>
                    {canManageConciergeBilling ? (
                      <Field label={tr.patients_notes}>
                        <textarea
                          value={draft.billingNotes}
                          onChange={(event) =>
                            updateDraft(service.id, {
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
      {canManageConciergeServices ? (
        <form onSubmit={handleServiceSubmit} className="mt-5 grid gap-4 md:grid-cols-2">
          <Field label={tr.documents_category}>
            <select
              value={form.serviceKind}
              onChange={(event) =>
                setForm((current) => ({
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
              value={form.title}
              onChange={(event) =>
                setForm((current) => ({
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
              value={form.providerId}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  providerId: event.target.value,
                }))
              }
              className={selectClassName}
            >
              <option value="">
                {appointmentText(
                  "Kein Anbieter",
                  "Без провайдера",
                  "No provider",
                )}
              </option>
              {nonMedicalProviders.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={tr.role_concierge}>
            <select
              value={form.assignedConciergeId}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  assignedConciergeId: event.target.value,
                }))
              }
              className={selectClassName}
            >
              <option value="">
                {appointmentText(
                  "Ohne Concierge",
                  "Без concierge",
                  "No concierge",
                )}
              </option>
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
              value={form.startsAt}
              onChange={(event) =>
                setForm((current) => ({
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
              value={form.endsAt}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  endsAt: event.target.value,
                }))
              }
              className="h-10 rounded-xl bg-slate-50"
            />
          </Field>
          <Field label={tr.common_provider}>
            <Input
              value={form.vendorName}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  vendorName: event.target.value,
                }))
              }
              className="h-10 rounded-xl bg-slate-50"
            />
          </Field>
          <Field label={tr.field_phone}>
            <Input
              value={form.vendorContact}
              onChange={(event) =>
                setForm((current) => ({
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
              value={form.costEstimate}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  costEstimate: event.target.value,
                }))
              }
              className="h-10 rounded-xl bg-slate-50"
            />
          </Field>
          <Field label={tr.contracts_total}>
            <Input
              value={form.currency}
              onChange={(event) =>
                setForm((current) => ({
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
              value={form.serviceNotes}
              onChange={(event) =>
                setForm((current) => ({
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
              disabled={submitBusy || !form.title.trim()}
            >
              {submitBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
              Add service
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

const MemoizedAppointmentConciergeSection = memo(AppointmentConciergeSection);

function AppointmentBillingHandoffSection({
  detail,
  detailReport,
  reportReviewMeta,
  interpreterReportReady,
  serviceCount,
  billingStaff,
  reminders,
  tasks,
  openTasks,
  readyServices,
  settledServices,
  warnings,
  canManageConciergeBilling,
  canCreateTasks,
  onRefresh,
  onError,
}: {
  detail: AppointmentDetail;
  detailReport: ReportSummary | null;
  reportReviewMeta: string;
  interpreterReportReady: boolean;
  serviceCount: number;
  billingStaff: StaffOption[];
  reminders: ReminderEntry[];
  tasks: TaskEntry[];
  openTasks: TaskEntry[];
  readyServices: ConciergeServiceEntry[];
  settledServices: ConciergeServiceEntry[];
  warnings: string[];
  canManageConciergeBilling: boolean;
  canCreateTasks: boolean;
  onRefresh: () => void;
  onError: (message: string) => void;
}) {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const { staffGo } = useStaffNavigate();

  const buildDefaultForm = useCallback(
    (
      defaultAssignee = billingStaff[0]?.id ?? "",
      defaultDueAt = shiftLocalDateTime(appointmentAnchorDateTime(detail), {
        days: 1,
      }),
      defaultKind: BillingHandoffKind =
        detail.type === "non_medical"
          ? "concierge_settlement"
          : detail.interpreter_id
            ? "interpreter_hours"
            : "patient_invoice",
    ) => blankBillingHandoffForm(defaultAssignee, defaultDueAt, defaultKind),
    [billingStaff, detail],
  );

  const [form, setForm] = useState<BillingHandoffFormState>(() =>
    buildDefaultForm(),
  );
  const [submitBusy, setSubmitBusy] = useState(false);

  useEffect(() => {
    setForm(buildDefaultForm());
    setSubmitBusy(false);
  }, [buildDefaultForm]);

  function openBillingChatDraft() {
    if (!form.assigneeId) return;
    const assignee = billingStaff.find((item) => item.id === form.assigneeId);
    if (!assignee) return;

    const draftParts = [
      `Billing handoff: ${detail.patient_pid} · ${detail.title}`,
      `Track: ${billingHandoffKindLabel(form.kind)}`,
      `Slot: ${slotLabel(detail)}`,
      form.kind === "interpreter_hours" && detailReport
        ? `Interpreter hours: ${detailReport.hours}h · ${reportApprovalLabel(detailReport.approval_status)}`
        : "",
      form.kind === "concierge_settlement"
        ? `Concierge services: ${readyServices.length} ready · ${settledServices.length} billed/settled`
        : "",
      form.notes.trim() || "",
    ].filter(Boolean);

    const params = new URLSearchParams({
      peer: assignee.id,
      name: assignee.name,
      role: assignee.role,
      draft: draftParts.join("\n"),
    });
    staffGo(`/chat?${params.toString()}`);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.assigneeId || !form.dueAt) return;

    const titleSuffix = form.title.trim() || billingHandoffKindLabel(form.kind);
    const handoffTitle = `${BILLING_HANDOFF_PREFIX} ${titleSuffix}`;
    const descriptionParts = [
      `Track: ${billingHandoffKindLabel(form.kind)}`,
      `Appointment: ${detail.patient_pid} · ${detail.title} · ${slotLabel(detail)}`,
      detail.provider_name ? `Clinic: ${detail.provider_name}` : "",
      detail.doctor_name ? `Doctor: ${detail.doctor_name}` : "",
      form.kind === "interpreter_hours" && detailReport
        ? `Interpreter hours: ${detailReport.hours}h · ${reportApprovalLabel(detailReport.approval_status)}`
        : "",
      form.kind === "concierge_settlement"
        ? `Concierge services ready: ${readyServices.length}; billed or settled: ${settledServices.length}`
        : "",
      form.notes.trim() || "",
    ].filter(Boolean);

    setSubmitBusy(true);
    try {
      const requests: Array<Promise<unknown>> = [
        apiFetch<{ id: string }>(`/appointments/${detail.id}/reminders`, {
          method: "POST",
          body: JSON.stringify({
            user_id: form.assigneeId,
            remind_at: toRfc3339(form.dueAt),
            title: handoffTitle,
            description: descriptionParts.join("\n"),
          }),
        }),
      ];

      if (form.createTask && canCreateTasks) {
        requests.push(
          apiFetch<{ id: string }>("/tasks", {
            method: "POST",
            body: JSON.stringify({
              title: handoffTitle,
              description: descriptionParts.join("\n"),
              assigned_to: form.assigneeId,
              patient_id: detail.patient_id,
              order_id: detail.order_id,
              appointment_id: detail.id,
              due_date: toRfc3339(form.dueAt),
              priority: form.taskPriority,
            }),
          }),
        );
      }

      await Promise.all(requests);
      setForm(
        buildDefaultForm(
          form.assigneeId,
          shiftLocalDateTime(form.dueAt, { days: 1 }),
          form.kind,
        ),
      );
      onRefresh();
    } catch (error) {
      onError(error instanceof Error ? error.message : tr.common_failed_create);
    } finally {
      setSubmitBusy(false);
    }
  }

  return (
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
          {tasks.length + reminders.length}{" "}
          {appointmentText("verknupft", "связано", "linked")}
        </span>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-3">
        <ContextCard
          label={tr.role_interpreter}
          value={
            detail.interpreter_id
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
            detail.interpreter_id
              ? detailReport
                ? reportReviewMeta || reportApprovalLabel(detailReport.approval_status)
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
            detail.type === "non_medical"
              ? appointmentText(
                  `${readyServices.length} bereit / ${settledServices.length} abgerechnet`,
                  `${readyServices.length} готово / ${settledServices.length} выставлено`,
                  `${readyServices.length} ready / ${settledServices.length} billed`,
                )
              : appointmentText("Nicht anwendbar", "Не применимо", "Not applicable")
          }
          meta={
            detail.type === "non_medical"
              ? appointmentText(
                  `${serviceCount} Leistung(en) verknupft`,
                  `${serviceCount} услуг(а) связано`,
                  `${serviceCount} service(s) linked`,
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
            `${openTasks.length} offene Aufgabe(n)`,
            `${openTasks.length} открытых задач`,
            `${openTasks.length} open task(s)`,
          )}
          meta={appointmentText(
            `${reminders.length} Erinnerung(en) verknupft`,
            `${reminders.length} напоминаний связано`,
            `${reminders.length} reminder(s) linked`,
          )}
        />
      </div>

      {warnings.length > 0 ? (
        <div className="mt-4 space-y-2">
          {warnings.map((warning) => (
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
              {reminders.length} {appointmentText("verknupft", "связано", "linked")}
            </span>
          </div>
          <div className="mt-3 space-y-3">
            {reminders.length === 0 ? (
              <EmptyState text={tr.common_not_set} />
            ) : (
              reminders.map((item) => (
                <div
                  key={item.id}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
                >
                  <p className="text-sm font-medium text-slate-900">{item.title}</p>
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
              {appointmentText(
                "Billing-Aufgaben",
                "Задачи биллинга",
                "Billing tasks",
              )}
            </h4>
            <span className="text-xs text-slate-500">
              {tasks.length} {appointmentText("verknupft", "связано", "linked")}
            </span>
          </div>
          <div className="mt-3 space-y-3">
            {tasks.length === 0 ? (
              <EmptyState text={tr.common_not_set} />
            ) : (
              tasks.map((task) => (
                <div
                  key={task.id}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-slate-900">{task.title}</p>
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
                      ? appointmentText(
                          ` · Fallig ${formatDateTimeLabel(task.due_date)}`,
                          ` · Срок ${formatDateTimeLabel(task.due_date)}`,
                          ` · Due ${formatDateTimeLabel(task.due_date)}`,
                        )
                      : ""}
                  </p>
                  {task.description ? (
                    <p className="mt-2 text-sm text-slate-600">{task.description}</p>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {canManageConciergeBilling ? (
        <form onSubmit={handleSubmit} className="mt-5 grid gap-4 md:grid-cols-2">
          <Field label={tr.role_billing}>
            <select
              value={form.kind}
              onChange={(event) =>
                setForm((current) => ({
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
              value={form.assigneeId}
              onChange={(event) =>
                setForm((current) => ({
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
              value={form.dueAt}
              onChange={(event) =>
                setForm((current) => ({
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
              value={form.taskPriority}
              onChange={(event) =>
                setForm((current) => ({
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
              value={form.title}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  title: event.target.value,
                }))
              }
              className="h-10 rounded-xl bg-slate-50"
              placeholder={withEllipsis(tr.appointments_title_col)}
            />
          </Field>
          <Field label={t.patients_notes}>
            <textarea
              value={form.notes}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  notes: event.target.value,
                }))
              }
              className={textareaClassName}
              rows={3}
              placeholder={withEllipsis(tr.patients_notes)}
            />
          </Field>
          <div className="md:col-span-2 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={form.createTask}
                onChange={(event) =>
                  setForm((current) => ({
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
                disabled={!form.assigneeId}
                onClick={openBillingChatDraft}
              >
                {appointmentText(
                  "Billing-Chatentwurf öffnen",
                  "Открыть черновик billing-чата",
                  "Open billing chat draft",
                )}
              </Button>
              <Button
                type="submit"
                className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
                disabled={
                  submitBusy ||
                  !form.assigneeId ||
                  !form.dueAt ||
                  billingStaff.length === 0
                }
              >
                {submitBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {appointmentText(
                  "Billing-Handoff erstellen",
                  "Создать billing-handoff",
                  "Create billing handoff",
                )}
              </Button>
            </div>
          </div>
        </form>
      ) : null}
    </section>
  );
}

const MemoizedAppointmentBillingHandoffSection = memo(
  AppointmentBillingHandoffSection,
);

void MemoizedAppointmentBillingHandoffSection;

function AppointmentExternalHandoffSection({
  detail,
  communications,
  reminders,
  tasks,
  assignees,
  defaultAssigneeId,
  canManageCommunications,
  canViewReminders,
  canCreateTasks,
  onRefresh,
  onError,
}: {
  detail: AppointmentDetail;
  communications: AppointmentCommunicationEntry[];
  reminders: ReminderEntry[];
  tasks: TaskEntry[];
  assignees: StaffOption[];
  defaultAssigneeId: string;
  canManageCommunications: boolean;
  canViewReminders: boolean;
  canCreateTasks: boolean;
  onRefresh: () => void;
  onError: (message: string) => void;
}) {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const { staffGo } = useStaffNavigate();

  const assigneeIndex = useMemo(
    () => new Map(assignees.map((item) => [item.id, item])),
    [assignees],
  );
  const initialAssigneeId = useMemo(
    () => defaultAssigneeId || assignees[0]?.id || "",
    [assignees, defaultAssigneeId],
  );
  const buildDefaultForm = useCallback(
    (
      formAssigneeId = initialAssigneeId,
      formDueAt = shiftLocalDateTime(appointmentAnchorDateTime(detail), {
        days: 1,
      }),
      formTarget: ExternalHandoffFormState["target"] = detail.doctor_id
        ? "doctor"
        : detail.type === "non_medical"
          ? "service_provider"
          : "clinic",
    ) => blankExternalHandoffForm(formAssigneeId, formDueAt, formTarget),
    [detail, initialAssigneeId],
  );

  const [form, setForm] = useState<ExternalHandoffFormState>(() =>
    buildDefaultForm(),
  );
  const [submitBusy, setSubmitBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState("");

  useEffect(() => {
    setForm(buildDefaultForm());
    setSubmitBusy(false);
    setActionBusy("");
  }, [buildDefaultForm]);

  function openChatDraft() {
    if (!form.assigneeId) return;
    const assignee = assigneeIndex.get(form.assigneeId);
    if (!assignee) return;

    const targetLabel = communicationTargetLabel(form.target, detail);
    const draftParts = [
      `External handoff: ${detail.patient_pid} · ${detail.title}`,
      `Target: ${targetLabel} · ${form.direction} via ${communicationChannelLabel(form.channel)}`,
      `Slot: ${slotLabel(detail)}`,
      form.contactName.trim() ? `Contact: ${form.contactName.trim()}` : "",
      form.notes.trim() || "",
    ].filter(Boolean);

    const params = new URLSearchParams({
      peer: assignee.id,
      name: assignee.name,
      role: assignee.role,
      draft: draftParts.join("\n"),
    });
    staffGo(`/chat?${params.toString()}`);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.title.trim()) return;

    const targetLabel = communicationTargetLabel(form.target, detail);
    const handoffTitle = `${EXTERNAL_HANDOFF_PREFIX} ${form.title.trim()}`;
    const descriptionParts = [
      `Target: ${form.target} · ${targetLabel}`,
      `Direction: ${form.direction} via ${communicationChannelLabel(form.channel)}`,
      `Appointment: ${detail.patient_pid} · ${detail.title} · ${slotLabel(detail)}`,
      form.contactName.trim() ? `Contact: ${form.contactName.trim()}` : "",
      form.notes.trim() || "",
    ].filter(Boolean);

    setSubmitBusy(true);
    try {
      const requests: Array<Promise<unknown>> = [
        apiFetch<{ id: string }>(`/appointments/${detail.id}/communications`, {
          method: "POST",
          body: JSON.stringify({
            target_type: form.target,
            direction: form.direction,
            channel: form.channel,
            status: form.status,
            subject: form.title.trim(),
            message: form.notes.trim() || null,
            contact_name: form.contactName.trim() || null,
            due_at: form.dueAt ? toRfc3339(form.dueAt) : null,
          }),
        }),
      ];

      if (form.assigneeId && form.dueAt) {
        requests.push(
          apiFetch<{ id: string }>(`/appointments/${detail.id}/reminders`, {
            method: "POST",
            body: JSON.stringify({
              user_id: form.assigneeId,
              remind_at: toRfc3339(form.dueAt),
              title: handoffTitle,
              description: descriptionParts.join("\n"),
            }),
          }),
        );

        if (form.createTask && canCreateTasks) {
          requests.push(
            apiFetch<{ id: string }>("/tasks", {
              method: "POST",
              body: JSON.stringify({
                title: handoffTitle,
                description: descriptionParts.join("\n"),
                assigned_to: form.assigneeId,
                patient_id: detail.patient_id,
                order_id: detail.order_id,
                appointment_id: detail.id,
                due_date: toRfc3339(form.dueAt),
                priority: form.taskPriority,
              }),
            }),
          );
        }
      }

      await Promise.all(requests);
      setForm(
        buildDefaultForm(
          form.assigneeId,
          form.dueAt ? shiftLocalDateTime(form.dueAt, { days: 1 }) : "",
          form.target,
        ),
      );
      onRefresh();
    } catch (error) {
      onError(error instanceof Error ? error.message : tr.common_failed_create);
    } finally {
      setSubmitBusy(false);
    }
  }

  async function handleCommunicationStatusUpdate(
    communicationId: string,
    status: AppointmentCommunicationStatus,
  ) {
    setActionBusy(`communication:${communicationId}:${status}`);
    try {
      await apiFetch(
        `/appointments/${detail.id}/communications/${communicationId}/status`,
        {
          method: "POST",
          body: JSON.stringify({ status }),
        },
      );
      onRefresh();
    } catch (error) {
      onError(error instanceof Error ? error.message : tr.common_failed_update);
    } finally {
      setActionBusy("");
    }
  }

  return (
    <section className={sectionCardClass("p-5")}>
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-950">
            Clinic and doctor handoff trail
          </h3>
          <p className="text-xs text-slate-500">
            External communication log for clinics, doctors and service
            providers, plus linked internal follow-up.
          </p>
        </div>
        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
          {communications.length} communication
          {communications.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <div className="space-y-3">
          {communications.length === 0 &&
          reminders.length === 0 &&
          tasks.length === 0 ? (
            <EmptyState text={tr.common_not_set} />
          ) : (
            <>
              {communications.map((item) => (
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
                        {item.created_by_name} · {item.direction} via{" "}
                        {communicationChannelLabel(item.channel)} ·{" "}
                        {communicationTargetLabel(item.target_type, detail)}
                        {item.contact_name ? ` · ${item.contact_name}` : ""}
                        {item.due_at
                          ? ` · due ${formatDateTimeLabel(item.due_at)}`
                          : ""}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em]",
                        communicationStatusBadgeClass(item.status),
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
                  {canManageCommunications ? (
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
                            actionBusy === `communication:${item.id}:answered`
                          }
                          onClick={() =>
                            void handleCommunicationStatusUpdate(
                              item.id,
                              "answered",
                            )
                          }
                        >
                          {actionBusy === `communication:${item.id}:answered` ? (
                            <LoaderCircle className="size-4 animate-spin" />
                          ) : null}
                          Mark answered
                        </Button>
                      ) : null}
                      {item.status !== "closed" && item.status !== "cancelled" ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="rounded-2xl"
                          disabled={
                            actionBusy === `communication:${item.id}:closed`
                          }
                          onClick={() =>
                            void handleCommunicationStatusUpdate(
                              item.id,
                              "closed",
                            )
                          }
                        >
                          {actionBusy === `communication:${item.id}:closed` ? (
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
                            actionBusy === `communication:${item.id}:cancelled`
                          }
                          onClick={() =>
                            void handleCommunicationStatusUpdate(
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
              {canViewReminders && (reminders.length > 0 || tasks.length > 0) ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-white/70 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Internal follow-up trail
                  </p>
                  <div className="mt-3 space-y-3">
                    {reminders.map((item) => (
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
                    {tasks.map((task) => (
                      <div
                        key={task.id}
                        className="rounded-2xl border border-slate-200/80 bg-slate-50/80 px-4 py-3"
                      >
                        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                          <p className="text-sm font-medium text-slate-900">
                            {task.title.replace(`${EXTERNAL_HANDOFF_PREFIX} `, "")}
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
        {canManageCommunications ? (
          <form
            onSubmit={handleSubmit}
            className="space-y-4 rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4"
          >
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={tr.patients_assign_owner}>
                <select
                  value={form.target}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      target: event.target
                        .value as ExternalHandoffFormState["target"],
                    }))
                  }
                  className={selectClassName}
                >
                  <option value="clinic" disabled={!detail.provider_id}>
                    Clinic
                  </option>
                  <option
                    value="service_provider"
                    disabled={!detail.provider_id}
                  >
                    Service provider
                  </option>
                  <option value="doctor" disabled={!detail.doctor_id}>
                    Doctor
                  </option>
                </select>
              </Field>
              <Field label={tr.documents_source}>
                <select
                  value={form.channel}
                  onChange={(event) =>
                    setForm((current) => ({
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
                  value={form.direction}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      direction: event.target
                        .value as AppointmentCommunicationDirection,
                    }))
                  }
                  className={selectClassName}
                >
                  <option value="outbound">{tr.common_active}</option>
                  <option value="inbound">{tr.common_active}</option>
                </select>
              </Field>
              <Field label={t.users_status}>
                <select
                  value={form.status}
                  onChange={(event) =>
                    setForm((current) => ({
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
                  value={form.assigneeId}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      assigneeId: event.target.value,
                    }))
                  }
                  className={selectClassName}
                  required
                >
                  <option value="">{tr.common_not_set}</option>
                  {assignees.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name} · {roleLabel(member.role)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label={tr.appointments_title_col}>
              <Input
                value={form.title}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
                placeholder={withEllipsis(tr.appointments_title_col)}
                className="h-10 rounded-xl bg-white"
                required
              />
            </Field>
            <Field label={tr.field_phone}>
              <Input
                value={form.contactName}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    contactName: event.target.value,
                  }))
                }
                placeholder={withEllipsis(
                  appointmentText(
                    "Kontaktperson",
                    "Контактное лицо",
                    "Contact person",
                  ),
                )}
                className="h-10 rounded-xl bg-white"
              />
            </Field>
            <Field label={tr.invoices_due_at}>
              <Input
                type="datetime-local"
                value={form.dueAt}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    dueAt: event.target.value,
                  }))
                }
                className="h-10 rounded-xl bg-white"
              />
            </Field>
            <Field label={tr.patients_notes}>
              <textarea
                value={form.notes}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    notes: event.target.value,
                  }))
                }
                className={textareaClassName}
                rows={5}
                placeholder={withEllipsis(tr.patients_notes)}
              />
            </Field>
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px]">
              <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={form.createTask}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      createTask: event.target.checked,
                    }))
                  }
                  className="mt-0.5 size-4 rounded border-slate-300 text-slate-950"
                />
                <span>
                  Mirror this communication as an internal task when assignee
                  and due date are set.
                </span>
              </label>
              <Field label={tr.appointments_title_col}>
                <select
                  value={form.taskPriority}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      taskPriority: event.target.value,
                    }))
                  }
                  className={selectClassName}
                  disabled={!form.createTask}
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
                disabled={!form.assigneeId}
                onClick={openChatDraft}
              >
                {appointmentText(
                  "Internen Chatentwurf öffnen",
                  "Открыть черновик внутреннего чата",
                  "Open internal chat draft",
                )}
              </Button>
              <Button
                type="submit"
                className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
                disabled={submitBusy || !form.title.trim()}
              >
                {submitBusy ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : null}
                {appointmentText(
                  "Kommunikation protokollieren",
                  "Зафиксировать коммуникацию",
                  "Log communication",
                )}
              </Button>
            </div>
          </form>
        ) : null}
      </div>
    </section>
  );
}

const MemoizedAppointmentExternalHandoffSection = memo(
  AppointmentExternalHandoffSection,
);

function AppointmentHandoffSection({
  detail,
  handoffStakeholders,
  followUpAssigneeId,
  setFollowUpAssigneeId,
  canManageReminders,
  onRefresh,
  onError,
}: {
  detail: AppointmentDetail;
  handoffStakeholders: HandoffStakeholder[];
  followUpAssigneeId: string;
  setFollowUpAssigneeId: Dispatch<SetStateAction<string>>;
  canManageReminders: boolean;
  onRefresh: () => void;
  onError: (message: string) => void;
}) {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const { staffGo } = useStaffNavigate();
  const [followUpBusy, setFollowUpBusy] = useState(false);

  useEffect(() => {
    setFollowUpBusy(false);
  }, [detail.id, followUpAssigneeId]);

  function openChat(peer: HandoffStakeholder) {
    const params = new URLSearchParams({
      peer: peer.id,
      name: peer.name,
      role: peer.role,
      draft: appointmentText(
        `Termin-Handoff: ${detail.patient_pid} · ${detail.title} · ${slotLabel(detail)}.`,
        `Хэнд-офф приёма: ${detail.patient_pid} · ${detail.title} · ${slotLabel(detail)}.`,
        `Appointment handoff: ${detail.patient_pid} · ${detail.title} · ${slotLabel(detail)}.`,
      ),
    });
    staffGo(`/chat?${params.toString()}`);
  }

  async function handlePreset(preset: (typeof FOLLOW_UP_PRESETS)[number]) {
    if (!followUpAssigneeId) return;
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
      onRefresh();
    } catch (error) {
      onError(error instanceof Error ? error.message : tr.common_failed_create);
    } finally {
      setFollowUpBusy(false);
    }
  }

  return (
    <section className={sectionCardClass("p-5")}>
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-950">
            Handoff and follow-up
          </h3>
          <p className="text-xs text-slate-500">
            Coordinate the assigned team and schedule post-care follow-up from
            the appointment itself.
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
                onClick={() => openChat(peer)}
              >
                Open chat
              </Button>
            </div>
          ))
        )}
      </div>
      {canManageReminders ? (
        <div className="mt-5 grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
          <Field label={tr.patients_assign_owner}>
            <select
              value={followUpAssigneeId}
              onChange={(event) => setFollowUpAssigneeId(event.target.value)}
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
                onClick={() => void handlePreset(preset)}
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
  );
}

const MemoizedAppointmentHandoffSection = memo(AppointmentHandoffSection);

function AppointmentFollowUpVisitSection({
  detail,
  appointments,
  providers,
  staff,
  interpreters,
  defaultReminderUserId,
  onCreated,
}: {
  detail: AppointmentDetail;
  appointments: AppointmentListItem[];
  providers: ProviderSummary[];
  staff: StaffOption[];
  interpreters: InterpreterOption[];
  defaultReminderUserId: string;
  onCreated: (result: { id?: string; notice: string }) => void;
}) {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const interpreterFieldLabel =
    tr.role_interpreter ??
    appointmentText("Dolmetscher", "Переводчик", "Interpreter");
  const scheduleWarningLabels = useMemo(
    () => ({
      patients_assign_owner: tr.patients_assign_owner,
      common_doctor: tr.common_doctor,
      common_provider: tr.common_provider,
    }),
    [tr.common_doctor, tr.common_provider, tr.patients_assign_owner],
  );
  const [form, setForm] = useState<FollowUpVisitFormState>(() =>
    buildFollowUpVisitForm(detail, defaultReminderUserId, tr.phase_followup),
  );
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [conflicts, setConflicts] = useState<ConflictSummary | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setForm(buildFollowUpVisitForm(detail, defaultReminderUserId, tr.phase_followup));
    setDoctors([]);
    setConflicts(null);
    setError("");
    setBusy(false);
  }, [defaultReminderUserId, detail, tr.phase_followup]);

  useEffect(() => {
    if (!form.providerId) {
      setDoctors([]);
      return;
    }
    let active = true;
    getProviderDoctors(form.providerId)
      .then((rows) => {
        if (active) setDoctors(rows);
      })
      .catch(() => {
        if (active) setDoctors([]);
      });
    return () => {
      active = false;
    };
  }, [form.providerId]);

  const conflictQuery = useMemo(() => {
    if (!detail.patient_id || !form.date) return "";
    return buildConflictQuery(
      detail.patient_id,
      "",
      form.date,
      form.timeStart,
      form.timeEnd,
      form.interpreterId,
    );
  }, [
    detail.patient_id,
    form.date,
    form.interpreterId,
    form.timeEnd,
    form.timeStart,
  ]);
  const debouncedConflictQuery = useDebouncedValue(conflictQuery);

  useEffect(() => {
    if (!debouncedConflictQuery) {
      setConflicts(null);
      return;
    }
    let active = true;
    apiFetch<ConflictSummary>(debouncedConflictQuery)
      .then((value) => {
        if (active) setConflicts(value);
      })
      .catch(() => {
        if (active) setConflicts(null);
      });
    return () => {
      active = false;
    };
  }, [debouncedConflictQuery]);

  const localWarnings = useMemo(() => {
    if (!detail.id || !form.date) return [];
    return buildLocalScheduleWarnings(
      appointments,
      {
        date: form.date,
        timeStart: form.timeStart,
        timeEnd: form.timeEnd,
        ownerUserId: form.ownerUserId || detail.owner_user_id,
        providerId: form.providerId || null,
        doctorId: form.doctorId || null,
      },
      scheduleWarningLabels,
    );
  }, [
    appointments,
    detail.id,
    detail.owner_user_id,
    form.date,
    form.doctorId,
    form.ownerUserId,
    form.providerId,
    form.timeEnd,
    form.timeStart,
    scheduleWarningLabels,
  ]);

  function applyPreset(preset: (typeof FOLLOW_UP_PRESETS)[number]) {
    const anchor = appointmentAnchorDateTime(detail);
    const shifted = shiftLocalDateTime(anchor, {
      days: "offsetDays" in preset ? preset.offsetDays : undefined,
      months: "offsetMonths" in preset ? preset.offsetMonths : undefined,
    });
    if (!shifted) return;
    const nextReminderAt = shiftLocalDateTime(shifted, { days: -3 });
    setForm((current) => ({
      ...current,
      date: shifted.slice(0, 10),
      timeStart: shifted.slice(11, 16),
      timeEnd: current.timeEnd
        ? shiftLocalDateTime(
            `${detail.date}T${detail.time_end?.slice(0, 5) ?? current.timeEnd}`,
            {
              days: "offsetDays" in preset ? preset.offsetDays : undefined,
              months:
                "offsetMonths" in preset ? preset.offsetMonths : undefined,
            },
          ).slice(11, 16)
        : current.timeEnd,
      title:
        current.title.trim() === "" || current.title.startsWith(t.phase_followup)
          ? preset.title
          : current.title,
      reminderAt: nextReminderAt || current.reminderAt,
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await apiFetch<{
        id: string;
        conflicts?: ConflictSummary;
      }>("/appointments", {
        method: "POST",
        body: JSON.stringify({
          patient_id: detail.patient_id,
          provider_id: form.providerId || null,
          doctor_id: form.doctorId || null,
          owner_user_id: form.ownerUserId || null,
          interpreter_id: form.interpreterId || null,
          order_id: form.linkOrder ? detail.order_id : null,
          appointment_type: form.appointmentType,
          care_path_kind: normalizeCarePathKindForAppointmentType(
            form.appointmentType,
            form.carePathKind,
          ),
          title: form.title.trim(),
          date: form.date,
          time_start: form.timeStart || null,
          time_end: form.timeEnd || null,
          location: form.location.trim() || null,
          category: form.category.trim() || null,
          notes: form.notes.trim() || null,
        }),
      });

      if (result.id && form.createReminder && form.reminderUserId && form.reminderAt) {
        await apiFetch<{ id: string }>(`/appointments/${result.id}/reminders`, {
          method: "POST",
          body: JSON.stringify({
            user_id: form.reminderUserId,
            remind_at: toRfc3339(form.reminderAt),
            title: `Prepare follow-up visit: ${form.title.trim()}`,
            description: `Planned from appointment ${detail.patient_pid} · ${detail.title} · ${slotLabel(detail)}.`,
          }),
        });
      }

      const notice = result.conflicts
        ? `${buildScheduleNotice(result.conflicts, localWarnings)} Follow-up visit created.`
        : tr.common_active;
      setForm(buildFollowUpVisitForm(detail, form.reminderUserId, tr.phase_followup));
      onCreated({ id: result.id, notice });
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : tr.common_failed_create,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={sectionCardClass("p-5")}>
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-950">
            Follow-up visit planning
          </h3>
          <p className="text-xs text-slate-500">
            Schedule the next control visit or examination directly from the
            current appointment context.
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
              onClick={() => applyPreset(preset)}
            >
              {preset.label}
            </Button>
          ))}
        </div>
      </div>
      {error ? (
        <div className="mt-4">
          <Banner tone="error" withIcon>{error}</Banner>
        </div>
      ) : null}
      <form onSubmit={handleSubmit} className="mt-4 space-y-4">
        <Field label={t.appointments_title_col}>
          <Input
            value={form.title}
            onChange={(event) =>
              setForm((current) => ({ ...current, title: event.target.value }))
            }
            className="h-10 rounded-xl bg-slate-50"
            required
          />
        </Field>
        <div className="grid gap-4 md:grid-cols-3">
          <Field label={t.appointments_date}>
            <Input
              type="date"
              value={form.date}
              onChange={(event) =>
                setForm((current) => ({ ...current, date: event.target.value }))
              }
              className="h-10 rounded-xl bg-slate-50"
              required
            />
          </Field>
          <Field label={t.appointments_time}>
            <Input
              type="time"
              value={form.timeStart}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  timeStart: event.target.value,
                }))
              }
              className="h-10 rounded-xl bg-slate-50"
            />
          </Field>
          <Field label={t.appointments_time}>
            <Input
              type="time"
              value={form.timeEnd}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  timeEnd: event.target.value,
                }))
              }
              className="h-10 rounded-xl bg-slate-50"
            />
          </Field>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t.common_provider}>
            <select
              value={form.providerId}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  providerId: event.target.value,
                  doctorId: "",
                }))
              }
              className={selectClassName}
              disabled={form.appointmentType === "internal"}
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
              value={form.doctorId}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  doctorId: event.target.value,
                }))
              }
              className={selectClassName}
              disabled={!form.providerId}
            >
              <option value="">{t.common_not_set}</option>
              {doctors.map((doctor) => (
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
              value={form.ownerUserId}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  ownerUserId: event.target.value,
                }))
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
          <Field label={interpreterFieldLabel}>
            <select
              value={form.interpreterId}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  interpreterId: event.target.value,
                }))
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
          <Field
            label={appointmentText(
              "Versorgungspfad",
              "Траектория лечения",
              "Care path",
            )}
          >
            <select
              value={form.carePathKind}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  carePathKind: event.target.value as AppointmentCarePathKind,
                }))
              }
              className={selectClassName}
              disabled={form.appointmentType !== "medical"}
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
              value={form.location}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  location: event.target.value,
                }))
              }
              className="h-10 rounded-xl bg-slate-50"
            />
          </Field>
          <Field label={tr.documents_category}>
            <Input
              value={form.category}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  category: event.target.value,
                }))
              }
              className="h-10 rounded-xl bg-slate-50"
            />
          </Field>
        </div>
        <Field label={t.patients_notes}>
          <textarea
            value={form.notes}
            onChange={(event) =>
              setForm((current) => ({ ...current, notes: event.target.value }))
            }
            className={textareaClassName}
            rows={4}
            placeholder={withEllipsis(tr.patients_notes)}
          />
        </Field>
        {detail.order_id ? (
          <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.linkOrder}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  linkOrder: event.target.checked,
                }))
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
              checked={form.createReminder}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  createReminder: event.target.checked,
                }))
              }
              className="mt-0.5 size-4 rounded border-slate-300 text-slate-950"
            />
            <span>Create a preparation reminder on the new follow-up visit.</span>
          </label>
          <Field label={tr.patients_assign_owner}>
            <select
              value={form.reminderUserId}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  reminderUserId: event.target.value,
                }))
              }
              className={selectClassName}
              disabled={!form.createReminder}
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
        {form.createReminder ? (
          <Field label={tr.appointments_date}>
            <Input
              type="datetime-local"
              value={form.reminderAt}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  reminderAt: event.target.value,
                }))
              }
              className="h-10 rounded-xl bg-slate-50"
            />
          </Field>
        ) : null}
        <ConflictPanel conflicts={conflicts} />
        <ScheduleWarningsPanel warnings={localWarnings} />
        <div className="flex justify-end">
          <Button
            type="submit"
            className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
            disabled={busy || !form.title.trim()}
          >
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
            {appointmentText(
              "Follow-up-Termin erstellen",
              "Создать follow-up приём",
              "Create follow-up visit",
            )}
          </Button>
        </div>
      </form>
    </section>
  );
}

const MemoizedAppointmentFollowUpVisitSection = memo(
  AppointmentFollowUpVisitSection,
);

function AppointmentDoctorFollowUpSection({
  detail,
  reminders,
  tasks,
  assignees,
  defaultAssigneeId,
  canManageReminders,
  canCreateTasks,
  onRefresh,
  onError,
}: {
  detail: AppointmentDetail;
  reminders: ReminderEntry[];
  tasks: TaskEntry[];
  assignees: StaffOption[];
  defaultAssigneeId: string;
  canManageReminders: boolean;
  canCreateTasks: boolean;
  onRefresh: () => void;
  onError: (message: string) => void;
}) {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const buildDefaultForm = useCallback(
    (
      assigneeId = defaultAssigneeId,
      dueAt = shiftLocalDateTime(appointmentAnchorDateTime(detail), {
        days: 7,
      }),
    ) => blankDoctorFollowUpForm(assigneeId, dueAt),
    [defaultAssigneeId, detail],
  );
  const [form, setForm] = useState<DoctorFollowUpFormState>(() =>
    buildDefaultForm(),
  );
  const [submitBusy, setSubmitBusy] = useState(false);

  useEffect(() => {
    setForm(buildDefaultForm());
    setSubmitBusy(false);
  }, [buildDefaultForm]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.assigneeId || !form.dueAt) return;

    const followUpTitle = `${DOCTOR_FOLLOW_UP_PREFIX} ${form.title.trim()}`;
    const description = [
      detail.doctor_name ? `Doctor: ${detail.doctor_name}` : "",
      detail.provider_name ? `Clinic: ${detail.provider_name}` : "",
      `Appointment: ${detail.patient_pid} · ${detail.title} · ${slotLabel(detail)}`,
      form.notes.trim() || "",
    ]
      .filter(Boolean)
      .join("\n");

    setSubmitBusy(true);
    try {
      const requests: Array<Promise<unknown>> = [
        apiFetch<{ id: string }>(`/appointments/${detail.id}/reminders`, {
          method: "POST",
          body: JSON.stringify({
            user_id: form.assigneeId,
            remind_at: toRfc3339(form.dueAt),
            title: followUpTitle,
            description,
          }),
        }),
      ];

      if (form.createTask && canCreateTasks) {
        requests.push(
          apiFetch<{ id: string }>("/tasks", {
            method: "POST",
            body: JSON.stringify({
              title: followUpTitle,
              description,
              assigned_to: form.assigneeId,
              patient_id: detail.patient_id,
              order_id: detail.order_id,
              appointment_id: detail.id,
              due_date: toRfc3339(form.dueAt),
              priority: form.taskPriority,
            }),
          }),
        );
      }

      await Promise.all(requests);
      setForm(
        buildDefaultForm(
          form.assigneeId,
          shiftLocalDateTime(form.dueAt, { days: 7 }),
        ),
      );
      onRefresh();
    } catch (error) {
      onError(error instanceof Error ? error.message : tr.common_failed_create);
    } finally {
      setSubmitBusy(false);
    }
  }

  return (
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
          {reminders.length + tasks.length}{" "}
          {reminders.length + tasks.length === 1 ? "item" : "items"}
        </span>
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              {t.common_search}
            </p>
            <div className="mt-3 space-y-3">
              {reminders.length === 0 ? (
                <EmptyState text={tr.common_not_set} />
              ) : (
                reminders.map((item) => (
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
              {tasks.length === 0 ? (
                <EmptyState text={tr.common_not_set} />
              ) : (
                tasks.map((task) => (
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
        {canManageReminders ? (
          <form
            onSubmit={handleSubmit}
            className="space-y-4 rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4"
          >
            <Field label={tr.appointments_title_col}>
              <Input
                value={form.title}
                onChange={(event) =>
                  setForm((current) => ({ ...current, title: event.target.value }))
                }
                placeholder={withEllipsis(tr.appointments_title_col)}
                className="h-10 rounded-xl bg-white"
                required
              />
            </Field>
            <Field label={t.patients_assign_owner}>
              <select
                value={form.assigneeId}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    assigneeId: event.target.value,
                  }))
                }
                className={selectClassName}
                required
              >
                <option value="">{tr.common_not_set}</option>
                {assignees.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name} · {roleLabel(member.role)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={tr.invoices_due_at}>
              <Input
                type="datetime-local"
                value={form.dueAt}
                onChange={(event) =>
                  setForm((current) => ({ ...current, dueAt: event.target.value }))
                }
                className="h-10 rounded-xl bg-white"
                required
              />
            </Field>
            <Field label={tr.patients_notes}>
              <textarea
                value={form.notes}
                onChange={(event) =>
                  setForm((current) => ({ ...current, notes: event.target.value }))
                }
                className={textareaClassName}
                rows={5}
                placeholder={withEllipsis(tr.patients_notes)}
              />
            </Field>
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px]">
              <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={form.createTask}
                  onChange={(event) =>
                    setForm((current) => ({
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
              <Field label={tr.appointments_title_col}>
                <select
                  value={form.taskPriority}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      taskPriority: event.target.value,
                    }))
                  }
                  className={selectClassName}
                  disabled={!form.createTask}
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
                  submitBusy ||
                  !form.title.trim() ||
                  !form.assigneeId ||
                  !form.dueAt
                }
              >
                {submitBusy ? (
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
  );
}

const MemoizedAppointmentDoctorFollowUpSection = memo(
  AppointmentDoctorFollowUpSection,
);

function AppointmentPackageEndSection({
  detail,
  reminders,
  tasks,
  assignees,
  defaultAssigneeId,
  defaultTitle,
  canManageReminders,
  canCreateTasks,
  onRefresh,
  onError,
}: {
  detail: AppointmentDetail;
  reminders: ReminderEntry[];
  tasks: TaskEntry[];
  assignees: StaffOption[];
  defaultAssigneeId: string;
  defaultTitle: string;
  canManageReminders: boolean;
  canCreateTasks: boolean;
  onRefresh: () => void;
  onError: (message: string) => void;
}) {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const buildDefaultForm = useCallback(
    (assigneeId = defaultAssigneeId, title = defaultTitle) =>
      blankPackageEndFollowUpForm(assigneeId, title),
    [defaultAssigneeId, defaultTitle],
  );
  const [form, setForm] = useState<PackageEndFollowUpFormState>(() =>
    buildDefaultForm(),
  );
  const [submitBusy, setSubmitBusy] = useState(false);

  useEffect(() => {
    setForm(buildDefaultForm());
    setSubmitBusy(false);
  }, [buildDefaultForm]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.assigneeId || !form.packageEndDate) return;

    const remindAt = shiftLocalDateTime(`${form.packageEndDate}T09:00`, {
      months: -1,
    });
    if (!remindAt) return;

    const followUpTitle = `${PACKAGE_END_FOLLOW_UP_PREFIX} ${form.title.trim()}`;
    const description = [
      `Package target end date: ${formatDateLabel(form.packageEndDate)}`,
      detail.order_id ? `Order: ${detail.order_id}` : "",
      detail.provider_name ? `Clinic: ${detail.provider_name}` : "",
      detail.doctor_name ? `Doctor: ${detail.doctor_name}` : "",
      `Appointment: ${detail.patient_pid} · ${detail.title} · ${slotLabel(detail)}`,
      form.notes.trim() || "",
    ]
      .filter(Boolean)
      .join("\n");

    setSubmitBusy(true);
    try {
      const requests: Array<Promise<unknown>> = [
        apiFetch<{ id: string }>(`/appointments/${detail.id}/reminders`, {
          method: "POST",
          body: JSON.stringify({
            user_id: form.assigneeId,
            remind_at: toRfc3339(remindAt),
            title: followUpTitle,
            description,
          }),
        }),
      ];

      if (form.createTask && canCreateTasks) {
        requests.push(
          apiFetch<{ id: string }>("/tasks", {
            method: "POST",
            body: JSON.stringify({
              title: followUpTitle,
              description,
              assigned_to: form.assigneeId,
              patient_id: detail.patient_id,
              order_id: detail.order_id,
              appointment_id: detail.id,
              due_date: toRfc3339(remindAt),
              priority: form.taskPriority,
            }),
          }),
        );
      }

      await Promise.all(requests);
      setForm(buildDefaultForm(form.assigneeId, defaultTitle));
      onRefresh();
    } catch (error) {
      onError(error instanceof Error ? error.message : tr.common_failed_create);
    } finally {
      setSubmitBusy(false);
    }
  }

  const scheduledReminder = form.packageEndDate
    ? shiftLocalDateTime(`${form.packageEndDate}T09:00`, { months: -1 })
    : "";

  return (
    <section className={sectionCardClass("p-5")}>
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-950">
            Package-end follow-up
          </h3>
          <p className="text-xs text-slate-500">
            Schedule the required reminder one month before the linked package
            or order window ends.
          </p>
        </div>
        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
          {reminders.length + tasks.length} package item
          {reminders.length + tasks.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <div className="space-y-3">
          {reminders.length === 0 && tasks.length === 0 ? (
            <EmptyState text={tr.common_not_set} />
          ) : (
            <>
              {reminders.map((item) => (
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
              {tasks.map((task) => (
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
        {canManageReminders ? (
          <form
            onSubmit={handleSubmit}
            className="space-y-4 rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4"
          >
            <Field label={t.appointments_date}>
              <Input
                type="date"
                value={form.packageEndDate}
                onChange={(event) =>
                  setForm((current) => ({
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
                value={form.title}
                onChange={(event) =>
                  setForm((current) => ({ ...current, title: event.target.value }))
                }
                className="h-10 rounded-xl bg-white"
                required
              />
            </Field>
            <Field label={t.patients_assign_owner}>
              <select
                value={form.assigneeId}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    assigneeId: event.target.value,
                  }))
                }
                className={selectClassName}
                required
              >
                <option value="">{tr.common_not_set}</option>
                {assignees.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name} · {roleLabel(member.role)}
                  </option>
                ))}
              </select>
            </Field>
            {scheduledReminder ? (
              <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-700">
                Reminder will be scheduled for{" "}
                {formatDateTimeLabel(toRfc3339(scheduledReminder))}.
              </div>
            ) : null}
            <Field label={t.patients_notes}>
              <textarea
                value={form.notes}
                onChange={(event) =>
                  setForm((current) => ({ ...current, notes: event.target.value }))
                }
                className={textareaClassName}
                rows={4}
                placeholder={withEllipsis(tr.patients_notes)}
              />
            </Field>
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px]">
              <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={form.createTask}
                  onChange={(event) =>
                    setForm((current) => ({
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
                  value={form.taskPriority}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      taskPriority: event.target.value,
                    }))
                  }
                  className={selectClassName}
                  disabled={!form.createTask}
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
                  submitBusy ||
                  !form.title.trim() ||
                  !form.assigneeId ||
                  !form.packageEndDate
                }
              >
                {submitBusy ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : null}
                Schedule package reminder
              </Button>
            </div>
          </form>
        ) : null}
      </div>
    </section>
  );
}

const MemoizedAppointmentPackageEndSection = memo(
  AppointmentPackageEndSection,
);

function AppointmentIncomingDataSection({
  detail,
  checklist,
  reminders,
  tasks,
  assignees,
  defaultAssigneeId,
  canCreateTasks,
  onRefresh,
  onError,
}: {
  detail: AppointmentDetail;
  checklist: ChecklistItem[];
  reminders: ReminderEntry[];
  tasks: TaskEntry[];
  assignees: StaffOption[];
  defaultAssigneeId: string;
  canCreateTasks: boolean;
  onRefresh: () => void;
  onError: (message: string) => void;
}) {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const { staffGo } = useStaffNavigate();
  const buildDefaultForm = useCallback(
    (
      assigneeId = defaultAssigneeId,
      dueAt = shiftLocalDateTime(appointmentAnchorDateTime(detail), {
        days: 2,
      }),
      source: IncomingDataSource = detail.interpreter_id ? "interpreter" : "doctor",
    ) => blankIncomingDataForm(assigneeId, dueAt, source),
    [defaultAssigneeId, detail],
  );
  const [form, setForm] = useState<IncomingDataFormState>(() =>
    buildDefaultForm(),
  );
  const [submitBusy, setSubmitBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const openChecklistCount = checklist.filter((item) => !item.is_completed).length;
  const intakeStateLabel =
    openChecklistCount === 0 && checklist.length > 0
      ? appointmentText("Intake bereit", "Интейк готов", "Intake clear")
      : appointmentText(
          `${openChecklistCount} offen`,
          `${openChecklistCount} открыто`,
          `${openChecklistCount} open`,
        );
  const followUpItemCount = reminders.length + tasks.length;
  const caseUpdateLabel = appointmentText(
    "Fallaktualisierung erforderlich",
    "Нужно обновление кейса",
    "Case update required",
  );
  const patientFollowUpLabel = appointmentText(
    "Patienten-Follow-up erforderlich",
    "Нужен фоллоу-ап с пациентом",
    "Patient follow-up required",
  );
  const intakeComposerTitle = appointmentText(
    "Intake-Follow-up anlegen",
    "Создать intake follow-up",
    "Create intake follow-up",
  );

  useEffect(() => {
    setForm(buildDefaultForm());
    setSubmitBusy(false);
    setActionBusy("");
    setComposerOpen(false);
  }, [buildDefaultForm]);

  async function completeChecklistItem(itemId: string) {
    setActionBusy(`check:${itemId}`);
    try {
      await apiFetch<{ ok: boolean }>(
        `/appointments/${detail.id}/checklist/${itemId}/complete`,
        { method: "POST" },
      );
      onRefresh();
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : appointmentText(
              "Element konnte nicht abgeschlossen werden.",
              "Не удалось завершить элемент.",
              "Failed to complete item",
            ),
      );
    } finally {
      setActionBusy("");
    }
  }

  function openChatDraft() {
    if (!form.assigneeId) return;
    const assignee = assignees.find((item) => item.id === form.assigneeId);
    if (!assignee) return;

    const draftParts = [
      `Incoming data intake: ${detail.patient_pid} · ${detail.title}`,
      `Source: ${incomingDataSourceLabel(form.source)}`,
      `Category: ${incomingDataCategoryLabel(form.category)}`,
      form.requiresCaseUpdate ? caseUpdateLabel : "",
      form.requiresPatientFollowUp ? patientFollowUpLabel : "",
      form.notes.trim() || "",
    ].filter(Boolean);

    const params = new URLSearchParams({
      peer: assignee.id,
      name: assignee.name,
      role: assignee.role,
      draft: draftParts.join("\n"),
    });
    staffGo(`/chat?${params.toString()}`);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.assigneeId || !form.dueAt) return;

    const title = `${INCOMING_DATA_PREFIX} ${incomingDataCategoryLabel(
      form.category,
    )} from ${incomingDataSourceLabel(form.source)}`;
    const description = [
      detail.provider_name ? `Clinic: ${detail.provider_name}` : "",
      detail.doctor_name ? `Doctor: ${detail.doctor_name}` : "",
      `Appointment: ${detail.patient_pid} · ${detail.title} · ${slotLabel(detail)}`,
      `Source: ${incomingDataSourceLabel(form.source)}`,
      `Category: ${incomingDataCategoryLabel(form.category)}`,
      form.requiresCaseUpdate ? caseUpdateLabel : "",
      form.requiresPatientFollowUp ? patientFollowUpLabel : "",
      form.notes.trim() || "",
    ]
      .filter(Boolean)
      .join("\n");
    const checklistItems = [
      `${INCOMING_DATA_CHECKLIST_PREFIX} Review and categorize incoming data`,
      form.requiresCaseUpdate
        ? `${INCOMING_DATA_CHECKLIST_PREFIX} Apply update to case/anamnesis`
        : "",
      form.requiresPatientFollowUp
        ? `${INCOMING_DATA_CHECKLIST_PREFIX} Patient follow-up after data triage`
        : "",
    ].filter(Boolean);

    setSubmitBusy(true);
    try {
      const requests: Array<Promise<unknown>> = [
        apiFetch<{ id: string }>(`/appointments/${detail.id}/reminders`, {
          method: "POST",
          body: JSON.stringify({
            user_id: form.assigneeId,
            remind_at: toRfc3339(form.dueAt),
            title,
            description,
          }),
        }),
        ...checklistItems.map((item) =>
          apiFetch<{ id: string }>(`/appointments/${detail.id}/checklist`, {
            method: "POST",
            body: JSON.stringify({
              phase: "followup",
              item_text: item,
            }),
          }),
        ),
      ];

      if (form.createTask && canCreateTasks) {
        requests.push(
          apiFetch<{ id: string }>("/tasks", {
            method: "POST",
            body: JSON.stringify({
              title,
              description,
              assigned_to: form.assigneeId,
              patient_id: detail.patient_id,
              order_id: detail.order_id,
              appointment_id: detail.id,
              due_date: toRfc3339(form.dueAt),
              priority: form.taskPriority,
            }),
          }),
        );
      }

      await Promise.all(requests);
      setForm(
        buildDefaultForm(
          form.assigneeId,
          shiftLocalDateTime(form.dueAt, { days: 2 }),
          form.source,
        ),
      );
      setComposerOpen(false);
      onRefresh();
    } catch (error) {
      onError(error instanceof Error ? error.message : tr.common_failed_create);
    } finally {
      setSubmitBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Section
        title={appointmentText(
          "Eingehende medizinische Daten",
          "Входящие медицинские данные",
          "Incoming medical data",
        )}
        accessory={<CountBadge>{intakeStateLabel}</CountBadge>}
      >
        <p className="text-sm text-muted-foreground">
          {appointmentText(
            "Erfassen Sie neue medizinische Updates von Patienten, Ärzten, Dolmetschern oder Kliniken, die noch triagiert und in den Fall übernommen werden müssen.",
            "Фиксируйте новые медицинские обновления от пациентов, врачей, переводчиков или клиник, которые ещё нужно протриажить и внести в кейс.",
            "Capture new medical updates from patients, doctors, interpreters or clinics that still need triage and case updates.",
          )}
        </p>
        <div className="grid gap-3 md:grid-cols-3">
          <StatCard
            label={appointmentText("Checkliste", "Чек-лист", "Checklist")}
            value={checklist.length}
            description={
              checklist.length === 0
                ? appointmentText(
                    "Noch nicht gestartet",
                    "Ещё не запущен",
                    "Not started yet",
                  )
                : intakeStateLabel
            }
          />
          <StatCard
            label={appointmentText("Reminder", "Напоминания", "Reminders")}
            value={reminders.length}
            description={appointmentText(
              "Zeitfenster für Triage und Verarbeitung.",
              "Сроки для триажа и обработки.",
              "Timing for triage and processing.",
            )}
          />
          <StatCard
            label={appointmentText("Aufgaben", "Задачи", "Tasks")}
            value={tasks.length}
            description={appointmentText(
              "Operative Verantwortung für Kategorisierung und Fall-Update.",
              "Операционная ответственность за категоризацию и обновление кейса.",
              "Operational ownership for categorization and case updates.",
            )}
          />
        </div>
      </Section>

      <div className="space-y-4">
        <Section
          title={appointmentText(
            "Intake-Checkliste",
            "Чек-лист intake",
            "Intake checklist",
          )}
          accessory={<CountBadge>{checklist.length}</CountBadge>}
        >
          {checklist.length === 0 ? (
            <EmptyCell>
              {appointmentText(
                "Für diesen Termin wurde noch keine Intake-Checkliste angelegt.",
                "Для этого приёма пока не создан intake-чек-лист.",
                "No intake checklist has been created for this appointment yet.",
              )}
            </EmptyCell>
          ) : (
            <div className="space-y-2">
              {checklist.map((item) => (
                <div
                  key={item.id}
                  className={cn(
                    "flex flex-col gap-3 rounded-xl px-4 py-3 md:flex-row md:items-start md:justify-between",
                    tokens.surface.card,
                  )}
                >
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-foreground">
                      {item.item_text.replace(
                        `${INCOMING_DATA_CHECKLIST_PREFIX} `,
                        "",
                      )}
                    </p>
                    <p className="text-[11.5px] uppercase tracking-[0.12em] text-muted-foreground">
                      {item.phase}
                    </p>
                  </div>
                  {item.is_completed ? (
                    <StatusBadge tone="success">
                      {appointmentText(
                        "Abgeschlossen",
                        "Завершено",
                        "Completed",
                      )}{" "}
                      {formatDateTimeLabel(item.completed_at)}
                    </StatusBadge>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 rounded-lg gap-1.5"
                      disabled={Boolean(actionBusy)}
                      onClick={() => void completeChecklistItem(item.id)}
                    >
                      {actionBusy === `check:${item.id}` ? (
                        <LoaderCircle className="size-4 animate-spin" />
                      ) : null}
                      {appointmentText("Abschließen", "Завершить", "Complete")}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section
          title={appointmentText(
            "Reminder und Aufgaben",
            "Напоминания и задачи",
            "Reminders and tasks",
          )}
          accessory={
            <div className="flex items-center gap-2">
              <CountBadge>{followUpItemCount}</CountBadge>
              <Button
                type="button"
                size="sm"
                className="h-8 rounded-lg gap-1.5"
                onClick={() => setComposerOpen(true)}
              >
                {intakeComposerTitle}
              </Button>
            </div>
          }
        >
          {followUpItemCount === 0 ? (
            <EmptyCell>
              {appointmentText(
                "Für diesen Termin gibt es noch keine Reminder oder Aufgaben im Intake-Flow.",
                "Для этого приёма пока нет напоминаний или задач в intake-flow.",
                "No reminders or tasks exist in this intake flow yet.",
              )}
            </EmptyCell>
          ) : (
            <div className="space-y-2">
              {reminders.map((item) => (
                <div
                  key={item.id}
                  className={cn("space-y-2.5 rounded-xl px-4 py-3", tokens.surface.card)}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-foreground">
                        {item.title.replace(`${INCOMING_DATA_PREFIX} `, "")}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {item.user_name} · {formatDateTimeLabel(item.remind_at)}
                      </p>
                    </div>
                    <CountBadge>
                      {appointmentText("Reminder", "Напоминание", "Reminder")}
                    </CountBadge>
                  </div>
                  {item.description ? (
                    <p className="whitespace-pre-line text-sm text-muted-foreground">
                      {item.description}
                    </p>
                  ) : null}
                </div>
              ))}
              {tasks.map((task) => (
                <div
                  key={task.id}
                  className={cn("space-y-2.5 rounded-xl px-4 py-3", tokens.surface.card)}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-foreground">
                        {task.title.replace(`${INCOMING_DATA_PREFIX} `, "")}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {task.assigned_to_name}
                        {task.due_date
                          ? ` · ${formatDateTimeLabel(task.due_date)}`
                          : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={task.status}>
                        {taskStatusLabel(task.status)}
                      </StatusBadge>
                      <CountBadge>{taskPriorityLabel(task.priority)}</CountBadge>
                    </div>
                  </div>
                  {task.description ? (
                    <p className="whitespace-pre-line text-sm text-muted-foreground">
                      {task.description}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      <AppointmentEditorSheet
        open={composerOpen}
        onOpenChange={(open) => {
          setComposerOpen(open);
          if (!open) {
            setForm(buildDefaultForm());
            setSubmitBusy(false);
          }
        }}
        title={intakeComposerTitle}
        description={appointmentText(
          "Erstellen Sie Reminder, Checklistenpunkte und bei Bedarf eine verknüpfte Aufgabe direkt aus dem Termin.",
          "Создавайте напоминания, пункты чек-листа и при необходимости связанную задачу прямо из приёма.",
          "Create reminders, checklist items and, if needed, a linked task directly from the appointment.",
        )}
        onSubmit={handleSubmit}
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-lg"
              onClick={() => setComposerOpen(false)}
            >
              {t.common_cancel}
            </Button>
            <Button
              type="submit"
              size="sm"
              className="h-8 rounded-lg gap-1.5"
              disabled={submitBusy || !form.assigneeId || !form.dueAt}
            >
              {submitBusy ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : null}
              {appointmentText(
                "Intake-Flow starten",
                "Запустить intake-flow",
                "Start intake flow",
              )}
            </Button>
          </>
        }
      >
        <div
          className={cn(
            "rounded-xl px-4 py-3 text-sm text-muted-foreground",
            tokens.surface.mutedCard,
          )}
        >
          {appointmentText(
            "Alle Änderungen werden direkt am Termin gespeichert und danach sofort in der klinischen Übersicht angezeigt.",
            "Все изменения сохраняются прямо в приёме и сразу отображаются в клиническом блоке.",
            "All changes are saved directly on the appointment and shown immediately in the clinical view.",
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label={tr.documents_source}>
            <select
              value={form.source}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  source: event.target.value as IncomingDataSource,
                }))
              }
              className={selectClassName}
            >
              <option value="patient">{tr.orders_patient}</option>
              <option value="doctor">{tr.common_doctor}</option>
              <option value="clinic">{tr.common_provider}</option>
              <option value="interpreter">{tr.role_interpreter}</option>
              <option value="external_lab">{tr.common_provider}</option>
              <option value="other">{tr.common_not_set}</option>
            </select>
          </Field>
          <Field label={tr.documents_category}>
            <select
              value={form.category}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  category: event.target.value as IncomingDataCategory,
                }))
              }
              className={selectClassName}
            >
              <option value="medical_update">Medical update</option>
              <option value="diagnosis">{tr.cases_preconditions}</option>
              <option value="medication">{tr.cases_medications}</option>
              <option value="symptom">{tr.cases_symptoms}</option>
              <option value="lab_result">{tr.cases_title}</option>
              <option value="imaging">{tr.documents_title}</option>
              <option value="recommendation">Recommendation</option>
              <option value="risk_flag">{tr.common_error}</option>
              <option value="other">{tr.common_not_set}</option>
            </select>
          </Field>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t.patients_assign_owner}>
            <select
              value={form.assigneeId}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  assigneeId: event.target.value,
                }))
              }
              className={selectClassName}
              required
            >
              <option value="">{tr.common_not_set}</option>
              {assignees.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name} · {roleLabel(member.role)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={appointmentText("Fällig am", "Срок", "Due at")}>
            <Input
              type="datetime-local"
              value={form.dueAt}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  dueAt: event.target.value,
                }))
              }
              className={cn(inputClass, "h-10 rounded-xl")}
              required
            />
          </Field>
        </div>

        <Field label={tr.patients_notes}>
          <textarea
            value={form.notes}
            onChange={(event) =>
              setForm((current) => ({ ...current, notes: event.target.value }))
            }
            className={textareaClassName}
            rows={5}
            placeholder={withEllipsis(tr.patients_notes)}
          />
        </Field>

        <div className="grid gap-3 md:grid-cols-2">
          <AppointmentClinicalToggleCard
            checked={form.requiresCaseUpdate}
            title={caseUpdateLabel}
            description={appointmentText(
              "Erzeugt einen separaten Checklistenschritt zur Übernahme in Fall oder Anamnese.",
              "Создаёт отдельный шаг чек-листа для переноса в кейс или анамнез.",
              "Creates a separate checklist step to apply the update to the case or anamnesis.",
            )}
            onChange={(checked) =>
              setForm((current) => ({
                ...current,
                requiresCaseUpdate: checked,
              }))
            }
          />
          <AppointmentClinicalToggleCard
            checked={form.requiresPatientFollowUp}
            title={patientFollowUpLabel}
            description={appointmentText(
              "Erzeugt einen separaten Schritt für die Rückmeldung an den Patienten nach der Datentriage.",
              "Добавляет отдельный шаг для связи с пациентом после триажа данных.",
              "Adds a separate step to contact the patient after data triage.",
            )}
            onChange={(checked) =>
              setForm((current) => ({
                ...current,
                requiresPatientFollowUp: checked,
              }))
            }
          />
        </div>

        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px]">
          <AppointmentClinicalToggleCard
            checked={form.createTask}
            title={appointmentText(
              "Zusätzliche Aufgabe erstellen",
              "Создать дополнительную задачу",
              "Create linked task",
            )}
            description={appointmentText(
              "Legt zusätzlich eine verknüpfte operative Aufgabe für den Verantwortlichen an.",
              "Дополнительно создаёт связанную операционную задачу для ответственного.",
              "Also creates a linked operational task for the assignee.",
            )}
            onChange={(checked) =>
              setForm((current) => ({
                ...current,
                createTask: checked,
              }))
            }
          />
          <Field
            label={appointmentText(
              "Aufgabenpriorität",
              "Приоритет задачи",
              "Task priority",
            )}
          >
            <select
              value={form.taskPriority}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  taskPriority: event.target.value,
                }))
              }
              className={selectClassName}
              disabled={!form.createTask}
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
            type="button"
            variant="outline"
            size="sm"
            className="h-8 rounded-lg"
            disabled={!form.assigneeId}
            onClick={openChatDraft}
          >
            {appointmentText(
              "Chat-Entwurf öffnen",
              "Открыть черновик чата",
              "Open chat draft",
            )}
          </Button>
        </div>
      </AppointmentEditorSheet>
    </div>
  );
}

const MemoizedAppointmentIncomingDataSection = memo(
  AppointmentIncomingDataSection,
);

function AppointmentFindingsSection({
  detail,
  checklist,
  reminders,
  tasks,
  assignees,
  defaultAssigneeId,
  canCreateTasks,
  onRefresh,
  onError,
}: {
  detail: AppointmentDetail;
  checklist: ChecklistItem[];
  reminders: ReminderEntry[];
  tasks: TaskEntry[];
  assignees: StaffOption[];
  defaultAssigneeId: string;
  canCreateTasks: boolean;
  onRefresh: () => void;
  onError: (message: string) => void;
}) {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const { staffGo } = useStaffNavigate();
  const buildDefaultForm = useCallback(
    (
      assigneeId = defaultAssigneeId,
      dueAt = shiftLocalDateTime(appointmentAnchorDateTime(detail), {
        days: 3,
      }),
      artifact: FindingsFollowUpArtifact = detail.doctor_id
        ? "arztbrief"
        : "written_findings",
    ) => blankFindingsFollowUpForm(assigneeId, dueAt, artifact),
    [defaultAssigneeId, detail],
  );
  const [form, setForm] = useState<FindingsFollowUpFormState>(() =>
    buildDefaultForm(),
  );
  const [submitBusy, setSubmitBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const openChecklistCount = checklist.filter((item) => !item.is_completed).length;
  const findingsStateLabel =
    openChecklistCount === 0 && checklist.length > 0
      ? appointmentText(
          "Follow-up bereit",
          "Фоллоу-ап готов",
          "Follow-up ready",
        )
      : appointmentText(
          `${openChecklistCount} offen`,
          `${openChecklistCount} открыто`,
          `${openChecklistCount} open`,
        );
  const followUpItemCount = reminders.length + tasks.length;
  const translationRequiredLabel = appointmentText(
    "Schriftliche Übersetzung erforderlich",
    "Нужен письменный перевод",
    "Written translation required",
  );
  const sendToPatientLabel = appointmentText(
    "Paket an Patienten senden",
    "Отправить пакет пациенту",
    "Send package to patient",
  );
  const findingsComposerTitle = appointmentText(
    "Befund-Follow-up anlegen",
    "Создать follow-up по заключениям",
    "Create findings follow-up",
  );

  useEffect(() => {
    setForm(buildDefaultForm());
    setSubmitBusy(false);
    setActionBusy("");
    setComposerOpen(false);
  }, [buildDefaultForm]);

  async function completeChecklistItem(itemId: string) {
    setActionBusy(`check:${itemId}`);
    try {
      await apiFetch<{ ok: boolean }>(
        `/appointments/${detail.id}/checklist/${itemId}/complete`,
        { method: "POST" },
      );
      onRefresh();
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : appointmentText(
              "Element konnte nicht abgeschlossen werden.",
              "Не удалось завершить элемент.",
              "Failed to complete item",
            ),
      );
    } finally {
      setActionBusy("");
    }
  }

  function openChatDraft() {
    if (!form.assigneeId) return;
    const assignee = assignees.find((item) => item.id === form.assigneeId);
    if (!assignee) return;

    const draftParts = [
      `Findings follow-up: ${detail.patient_pid} · ${detail.title}`,
      `Expected: ${findingsArtifactLabel(form.artifact)}`,
      detail.provider_name ? `Clinic: ${detail.provider_name}` : "",
      detail.doctor_name ? `Doctor: ${detail.doctor_name}` : "",
      form.translationRequired ? translationRequiredLabel : "",
      form.sendToPatient ? sendToPatientLabel : "",
      form.notes.trim() || "",
    ].filter(Boolean);

    const params = new URLSearchParams({
      peer: assignee.id,
      name: assignee.name,
      role: assignee.role,
      draft: draftParts.join("\n"),
    });
    staffGo(`/chat?${params.toString()}`);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.assigneeId || !form.dueAt) return;

    const artifactLabel = findingsArtifactLabel(form.artifact);
    const title = `${FINDINGS_FOLLOW_UP_PREFIX} ${artifactLabel}`;
    const description = [
      detail.provider_name ? `Clinic: ${detail.provider_name}` : "",
      detail.doctor_name ? `Doctor: ${detail.doctor_name}` : "",
      `Appointment: ${detail.patient_pid} · ${detail.title} · ${slotLabel(detail)}`,
      form.translationRequired ? translationRequiredLabel : "",
      form.sendToPatient ? sendToPatientLabel : "",
      form.notes.trim() || "",
    ]
      .filter(Boolean)
      .join("\n");
    const checklistItems = [
      `${FINDINGS_CHECKLIST_PREFIX} Await ${artifactLabel}`,
      `${FINDINGS_CHECKLIST_PREFIX} Review and categorize ${artifactLabel}`,
      form.translationRequired
        ? `${FINDINGS_CHECKLIST_PREFIX} Written translation completed`
        : "",
      form.sendToPatient
        ? `${FINDINGS_CHECKLIST_PREFIX} Findings package sent to patient`
        : "",
    ].filter(Boolean);

    setSubmitBusy(true);
    try {
      const requests: Array<Promise<unknown>> = [
        apiFetch<{ id: string }>(`/appointments/${detail.id}/reminders`, {
          method: "POST",
          body: JSON.stringify({
            user_id: form.assigneeId,
            remind_at: toRfc3339(form.dueAt),
            title,
            description,
          }),
        }),
        ...checklistItems.map((item) =>
          apiFetch<{ id: string }>(`/appointments/${detail.id}/checklist`, {
            method: "POST",
            body: JSON.stringify({
              phase: "followup",
              item_text: item,
            }),
          }),
        ),
      ];

      if (form.createTask && canCreateTasks) {
        requests.push(
          apiFetch<{ id: string }>("/tasks", {
            method: "POST",
            body: JSON.stringify({
              title,
              description,
              assigned_to: form.assigneeId,
              patient_id: detail.patient_id,
              order_id: detail.order_id,
              appointment_id: detail.id,
              due_date: toRfc3339(form.dueAt),
              priority: form.taskPriority,
            }),
          }),
        );
      }

      await Promise.all(requests);
      setForm(
        buildDefaultForm(
          form.assigneeId,
          shiftLocalDateTime(form.dueAt, { days: 7 }),
          form.artifact,
        ),
      );
      setComposerOpen(false);
      onRefresh();
    } catch (error) {
      onError(error instanceof Error ? error.message : tr.common_failed_create);
    } finally {
      setSubmitBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Section
        title={appointmentText(
          "Arztbrief und schriftliche Befunde",
          "Arztbrief и письменные заключения",
          "Arztbrief and written findings",
        )}
        accessory={<CountBadge>{findingsStateLabel}</CountBadge>}
      >
        <p className="text-sm text-muted-foreground">
          {appointmentText(
            "Verfolgen Sie ausstehende Befunde, Übersetzungsbedarf und den Versand an Patienten direkt aus dem Termin-Kontext.",
            "Отслеживайте недостающие заключения, потребность в переводе и отправку пациенту прямо из контекста приёма.",
            "Track missing findings, translation needs and patient delivery directly from the appointment context.",
          )}
        </p>
        <div className="grid gap-3 md:grid-cols-3">
          <StatCard
            label={appointmentText("Checkliste", "Чек-лист", "Checklist")}
            value={checklist.length}
            description={
              checklist.length === 0
                ? appointmentText(
                    "Noch nicht gestartet",
                    "Ещё не запущен",
                    "Not started yet",
                  )
                : findingsStateLabel
            }
          />
          <StatCard
            label={appointmentText("Reminder", "Напоминания", "Reminders")}
            value={reminders.length}
            description={appointmentText(
              "Timing für Rückfragen, Übersetzung und Dokumentenhandling.",
              "Сроки для запросов, перевода и работы с документами.",
              "Timing for requests, translation and document handling.",
            )}
          />
          <StatCard
            label={appointmentText("Aufgaben", "Задачи", "Tasks")}
            value={tasks.length}
            description={appointmentText(
              "Operative Verantwortung für Anforderung, Übersetzung und Versand von Befunden.",
              "Операционная ответственность за запрос, перевод и отправку заключений.",
              "Operational ownership for requesting, translating and sending findings.",
            )}
          />
        </div>
      </Section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
        <div className="space-y-4">
          <Section
            title={appointmentText(
              "Follow-up-Checkliste",
              "Чек-лист follow-up",
              "Follow-up checklist",
            )}
            accessory={<CountBadge>{checklist.length}</CountBadge>}
          >
            {checklist.length === 0 ? (
              <EmptyCell>
                {appointmentText(
                  "Für diesen Termin wurde noch keine Befund-Checkliste angelegt.",
                  "Для этого приёма пока не создан чек-лист по заключениям.",
                  "No findings checklist has been created for this appointment yet.",
                )}
              </EmptyCell>
            ) : (
              <div className="space-y-2">
                {checklist.map((item) => (
                  <div
                    key={item.id}
                    className={cn(
                      "flex flex-col gap-3 rounded-xl px-4 py-3 md:flex-row md:items-start md:justify-between",
                      tokens.surface.card,
                    )}
                  >
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-foreground">
                        {item.item_text.replace(`${FINDINGS_CHECKLIST_PREFIX} `, "")}
                      </p>
                      <p className="text-[11.5px] uppercase tracking-[0.12em] text-muted-foreground">
                        {item.phase}
                      </p>
                    </div>
                    {item.is_completed ? (
                      <StatusBadge tone="success">
                        {appointmentText(
                          "Abgeschlossen",
                          "Завершено",
                          "Completed",
                        )}{" "}
                        {formatDateTimeLabel(item.completed_at)}
                      </StatusBadge>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-lg gap-1.5"
                        disabled={Boolean(actionBusy)}
                        onClick={() => void completeChecklistItem(item.id)}
                      >
                        {actionBusy === `check:${item.id}` ? (
                          <LoaderCircle className="size-4 animate-spin" />
                        ) : null}
                        {appointmentText("Abschließen", "Завершить", "Complete")}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section
            title={appointmentText(
              "Reminder und Aufgaben",
              "Напоминания и задачи",
              "Reminders and tasks",
            )}
            accessory={
              <div className="flex items-center gap-2">
                <CountBadge>{followUpItemCount}</CountBadge>
                <Button
                  type="button"
                  size="sm"
                  className="h-8 rounded-lg gap-1.5"
                  onClick={() => setComposerOpen(true)}
                >
                  {findingsComposerTitle}
                </Button>
              </div>
            }
          >
            {followUpItemCount === 0 ? (
              <EmptyCell>
                {appointmentText(
                  "Für diesen Termin gibt es noch keine Reminder oder Aufgaben im Befund-Follow-up.",
                  "Для этого приёма пока нет напоминаний или задач в follow-up по заключениям.",
                  "No reminders or tasks exist in this findings follow-up yet.",
                )}
              </EmptyCell>
            ) : (
              <div className="space-y-2">
                {reminders.map((item) => (
                  <div
                    key={item.id}
                    className={cn("space-y-2.5 rounded-xl px-4 py-3", tokens.surface.card)}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-foreground">
                          {item.title.replace(`${FINDINGS_FOLLOW_UP_PREFIX} `, "")}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {item.user_name} · {formatDateTimeLabel(item.remind_at)}
                        </p>
                      </div>
                      <CountBadge>
                        {appointmentText("Reminder", "Напоминание", "Reminder")}
                      </CountBadge>
                    </div>
                    {item.description ? (
                      <p className="whitespace-pre-line text-sm text-muted-foreground">
                        {item.description}
                      </p>
                    ) : null}
                  </div>
                ))}
                {tasks.map((task) => (
                  <div
                    key={task.id}
                    className={cn("space-y-2.5 rounded-xl px-4 py-3", tokens.surface.card)}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-foreground">
                          {task.title.replace(`${FINDINGS_FOLLOW_UP_PREFIX} `, "")}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {task.assigned_to_name}
                          {task.due_date
                            ? ` · ${formatDateTimeLabel(task.due_date)}`
                            : ""}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge status={task.status}>
                          {taskStatusLabel(task.status)}
                        </StatusBadge>
                        <CountBadge>{taskPriorityLabel(task.priority)}</CountBadge>
                      </div>
                    </div>
                    {task.description ? (
                      <p className="whitespace-pre-line text-sm text-muted-foreground">
                        {task.description}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
      </div>

      <AppointmentEditorSheet
        open={composerOpen}
        onOpenChange={(open) => {
          setComposerOpen(open);
          if (!open) {
            setForm(buildDefaultForm());
            setSubmitBusy(false);
          }
        }}
        title={findingsComposerTitle}
        description={appointmentText(
          "Steuern Sie Anforderung, Übersetzung und Versand von Befunden direkt aus dem Termin.",
          "Управляйте запросом, переводом и отправкой заключений прямо из приёма.",
          "Control the request, translation and delivery of findings directly from the appointment.",
        )}
        onSubmit={handleSubmit}
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-lg"
              onClick={() => setComposerOpen(false)}
            >
              {t.common_cancel}
            </Button>
            <Button
              type="submit"
              size="sm"
              className="h-8 rounded-lg gap-1.5"
              disabled={submitBusy || !form.assigneeId || !form.dueAt}
            >
              {submitBusy ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : null}
              {appointmentText(
                "Follow-up starten",
                "Запустить follow-up",
                "Start follow-up",
              )}
            </Button>
          </>
        }
      >
        <div
          className={cn(
            "rounded-xl px-4 py-3 text-sm text-muted-foreground",
            tokens.surface.mutedCard,
          )}
        >
          {appointmentText(
            "Die erstellten Reminder, Aufgaben und Checklisteneinträge erscheinen sofort im klinischen Befundblock dieses Termins.",
            "Созданные напоминания, задачи и пункты чек-листа сразу появятся в клиническом блоке заключений этого приёма.",
            "Created reminders, tasks and checklist items appear immediately in this appointment's findings block.",
          )}
        </div>

        <Field
          label={appointmentText(
            "Erwartetes Dokument",
            "Ожидаемый документ",
            "Expected document",
          )}
        >
          <select
            value={form.artifact}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                artifact: event.target.value as FindingsFollowUpArtifact,
              }))
            }
            className={selectClassName}
          >
            <option value="arztbrief">Arztbrief</option>
            <option value="written_findings">Written findings</option>
            <option value="both">Both</option>
          </select>
        </Field>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t.patients_assign_owner}>
            <select
              value={form.assigneeId}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  assigneeId: event.target.value,
                }))
              }
              className={selectClassName}
              required
            >
              <option value="">{tr.common_not_set}</option>
              {assignees.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name} · {roleLabel(member.role)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={appointmentText("Fällig am", "Срок", "Due at")}>
            <Input
              type="datetime-local"
              value={form.dueAt}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  dueAt: event.target.value,
                }))
              }
              className={cn(inputClass, "h-10 rounded-xl")}
              required
            />
          </Field>
        </div>

        <Field label={tr.patients_notes}>
          <textarea
            value={form.notes}
            onChange={(event) =>
              setForm((current) => ({ ...current, notes: event.target.value }))
            }
            className={textareaClassName}
            rows={5}
            placeholder={withEllipsis(tr.patients_notes)}
          />
        </Field>

        <div className="grid gap-3 md:grid-cols-2">
          <AppointmentClinicalToggleCard
            checked={form.translationRequired}
            title={translationRequiredLabel}
            description={appointmentText(
              "Fügt einen separaten Schritt für die schriftliche Übersetzung hinzu.",
              "Добавляет отдельный шаг для письменного перевода.",
              "Adds a separate step for written translation.",
            )}
            onChange={(checked) =>
              setForm((current) => ({
                ...current,
                translationRequired: checked,
              }))
            }
          />
          <AppointmentClinicalToggleCard
            checked={form.sendToPatient}
            title={sendToPatientLabel}
            description={appointmentText(
              "Plant einen zusätzlichen Schritt für den Versand des Befundpakets an den Patienten.",
              "Планирует дополнительный шаг для отправки пакета заключений пациенту.",
              "Plans an additional step to send the findings package to the patient.",
            )}
            onChange={(checked) =>
              setForm((current) => ({
                ...current,
                sendToPatient: checked,
              }))
            }
          />
        </div>

        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px]">
          <AppointmentClinicalToggleCard
            checked={form.createTask}
            title={appointmentText(
              "Zusätzliche Aufgabe erstellen",
              "Создать дополнительную задачу",
              "Create linked task",
            )}
            description={appointmentText(
              "Legt zusätzlich eine verknüpfte operative Aufgabe für das Befund-Follow-up an.",
              "Дополнительно создаёт связанную операционную задачу для follow-up по заключениям.",
              "Also creates a linked operational task for findings follow-up.",
            )}
            onChange={(checked) =>
              setForm((current) => ({
                ...current,
                createTask: checked,
              }))
            }
          />
          <Field
            label={appointmentText(
              "Aufgabenpriorität",
              "Приоритет задачи",
              "Task priority",
            )}
          >
            <select
              value={form.taskPriority}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  taskPriority: event.target.value,
                }))
              }
              className={selectClassName}
              disabled={!form.createTask}
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
            type="button"
            variant="outline"
            size="sm"
            className="h-8 rounded-lg"
            disabled={!form.assigneeId}
            onClick={openChatDraft}
          >
            {appointmentText(
              "Chat-Entwurf öffnen",
              "Открыть черновик чата",
              "Open chat draft",
            )}
          </Button>
        </div>
      </AppointmentEditorSheet>
    </div>
  );
}

const MemoizedAppointmentFindingsSection = memo(
  AppointmentFindingsSection,
);

function StaffAppointmentsPage() {
  const { user } = useAuth();
  const { t, lang } = useLang();
  const tr = t as unknown as Record<string, string>;
  const [searchParams, setSearchParams] = useSearchParams();
  const detailTab = normalizeAppointmentWorkspaceTab(
    searchParams.get("detailTab"),
  );
  const permissions = appointmentPermissions(user?.role);
  const patientSheetPermissions = linkedPatientPermissions(user?.role);
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
  const [createSeed, setCreateSeed] = useState<AppointmentFormState>(
    blankAppointmentForm(),
  );

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
  const [linkedPreviewOpen, setLinkedPreviewOpen] = useState(false);
  const [linkedPreviewKind, setLinkedPreviewKind] =
    useState<LinkedPreviewKind | null>(null);
  const [linkedPreviewLabel, setLinkedPreviewLabel] = useState("");
  const [linkedPreviewLoading, setLinkedPreviewLoading] = useState(false);
  const [linkedPreviewError, setLinkedPreviewError] = useState("");
  const [linkedPreviewPayload, setLinkedPreviewPayload] =
    useState<LinkedPreviewPayload | null>(null);
  const [linkedPatientOpen, setLinkedPatientOpen] = useState(false);
  const [linkedPatientId, setLinkedPatientId] = useState("");
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
  const [linkedPatientSelectedAssignee, setLinkedPatientSelectedAssignee] =
    useState("");
  const [linkedPatientAssignmentBusy, setLinkedPatientAssignmentBusy] =
    useState(false);
  const [linkedPatientAssignmentError, setLinkedPatientAssignmentError] =
    useState("");
  const [linkedPatientVersion, setLinkedPatientVersion] = useState(0);
  const [linkedProviderOpen, setLinkedProviderOpen] = useState(false);
  const [linkedProviderId, setLinkedProviderId] = useState("");
  const [linkedProviderDetailLoading, setLinkedProviderDetailLoading] =
    useState(false);
  const [linkedProviderDetailError, setLinkedProviderDetailError] =
    useState("");
  const [linkedProviderDetail, setLinkedProviderDetail] =
    useState<ProviderSheetDetail | null>(null);
  const [linkedCasesOpen, setLinkedCasesOpen] = useState(false);
  const [linkedCasesLoading, setLinkedCasesLoading] = useState(false);
  const [linkedCasesError, setLinkedCasesError] = useState("");
  const [linkedCasesItems, setLinkedCasesItems] = useState<CaseRosterItem[]>(
    [],
  );
  const [linkedCasePreviewOpen, setLinkedCasePreviewOpen] = useState(false);
  const [linkedCasePreviewId, setLinkedCasePreviewId] = useState("");
  const [linkedDocumentsOpen, setLinkedDocumentsOpen] = useState(false);
  const [linkedDocumentsLoading, setLinkedDocumentsLoading] = useState(false);
  const [linkedDocumentsError, setLinkedDocumentsError] = useState("");
  const [linkedDocumentsItems, setLinkedDocumentsItems] = useState<
    LinkedDocumentItem[]
  >([]);
  const [linkedDocumentSelectedIds, setLinkedDocumentSelectedIds] = useState<
    string[]
  >([]);

  const [followUpAssigneeId, setFollowUpAssigneeId] = useState("");
  const [actionBusy, setActionBusy] = useState("");
  const [calendarQuickActionMenu, setCalendarQuickActionMenu] =
    useState<CalendarQuickActionMenuState | null>(null);
  const [calendarQuickActionScope, setCalendarQuickActionScope] =
    useState<AppointmentRecurringActionScope>("single");
  const calendarQuickActionMenuRef = useRef<HTMLDivElement | null>(null);

  const todayDate = currentDateInput();
  const weekStart = startOfWeekInput(todayDate);
  const weekEnd = endOfWeekInput(todayDate);
  const appointmentsQuery = useMemo(
    () =>
      buildAppointmentsQuery({
        search: deferredSearch,
        appointmentType: filters.appointmentType,
        carePathKind: filters.carePathKind,
        status: filters.status,
        patientId: filters.patientId,
        providerId: filters.providerId,
        doctorId: filters.doctorId,
        ownerUserId: filters.ownerUserId,
        interpreterId: filters.interpreterId,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
      }),
    [
      deferredSearch,
      filters.appointmentType,
      filters.carePathKind,
      filters.status,
      filters.patientId,
      filters.providerId,
      filters.doctorId,
      filters.ownerUserId,
      filters.interpreterId,
      filters.dateFrom,
      filters.dateTo,
    ],
  );
  const attentionQuery = useMemo(
    () =>
      appointmentsQuery.includes("?")
        ? appointmentsQuery.replace(
            "/appointments?",
            "/appointments/meta/attention?",
          )
        : `${appointmentsQuery}/meta/attention`,
    [appointmentsQuery],
  );
  const attentionIndex = useMemo(
    () => new Map(attentionItems.map((item) => [item.id, item])),
    [attentionItems],
  );
  const attentionIds = useMemo(
    () => new Set(attentionItems.map((item) => item.id)),
    [attentionItems],
  );
  const appointmentsIndex = useMemo(
    () => new Map(appointments.map((item) => [item.id, item])),
    [appointments],
  );
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
  const taskAssignableStaff = useMemo(
    () =>
      staff.filter((member) => TASK_ASSIGNABLE_ROLES.has(member.role)),
    [staff],
  );
  const billingStaff = useMemo(
    () => staff.filter((member) => member.role === "billing"),
    [staff],
  );
  const conciergeStaff = useMemo(
    () => staff.filter((member) => member.role === "concierge"),
    [staff],
  );
  const nonMedicalProviders = useMemo(
    () => providers.filter((provider) => provider.provider_type === "non_medical"),
    [providers],
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
  const detailDefaultAssigneeId = useMemo(
    () =>
      detail ? resolveFollowUpDefaultAssignee(detail, detailAssignments) : "",
    [detail, detailAssignments],
  );
  const {
    handoffStakeholders,
    openChecklistCount,
    openTaskCount,
    pendingReminderCount,
    doctorDirectedReminders,
    doctorDirectedTasks,
    packageEndReminders,
    packageEndTasks,
    externalCommunicationEntries,
    externalHandoffReminders,
    externalHandoffTasks,
    billingHandoffReminders,
    billingHandoffTasks,
    canShowBillingHandoffSection,
    findingsChecklist,
    findingsReminders,
    findingsTasks,
    incomingDataChecklist,
    incomingDataReminders,
    incomingDataTasks,
    doctorFollowUpAssignees,
    interpreterReportReady,
    readyConciergeServices,
    settledConciergeServices,
    openBillingHandoffTasks,
    billingReadinessWarnings,
    completionWarnings,
  } = useMemo(() => {
    const handoffStakeholders =
      detail && !detail.is_blocked
        ? buildHandoffStakeholders(detail, detailAssignments, {
            cases_title: tr.cases_title,
            patients_assign_owner: tr.patients_assign_owner,
            role_interpreter: tr.role_interpreter,
          })
        : [];

    let openChecklistCount = 0;
    let openTaskCount = 0;
    let pendingReminderCount = 0;
    let serviceInFlightCount = 0;
    let openIncomingDataChecklistCount = 0;

    const findingsChecklist: ChecklistItem[] = [];
    const incomingDataChecklist: ChecklistItem[] = [];
    const doctorDirectedReminders: ReminderEntry[] = [];
    const packageEndReminders: ReminderEntry[] = [];
    const externalHandoffReminders: ReminderEntry[] = [];
    const billingHandoffReminders: ReminderEntry[] = [];
    const findingsReminders: ReminderEntry[] = [];
    const incomingDataReminders: ReminderEntry[] = [];
    const doctorDirectedTasks: TaskEntry[] = [];
    const packageEndTasks: TaskEntry[] = [];
    const externalHandoffTasks: TaskEntry[] = [];
    const billingHandoffTasks: TaskEntry[] = [];
    const openBillingHandoffTasks: TaskEntry[] = [];
    const findingsTasks: TaskEntry[] = [];
    const incomingDataTasks: TaskEntry[] = [];
    const externalCommunicationEntries: AppointmentCommunicationEntry[] = [];
    const readyConciergeServices: ConciergeServiceEntry[] = [];
    const settledConciergeServices: ConciergeServiceEntry[] = [];

    for (const item of detailChecklist) {
      if (!item.is_completed) {
        openChecklistCount += 1;
      }
      if (item.item_text.startsWith(FINDINGS_CHECKLIST_PREFIX)) {
        findingsChecklist.push(item);
      }
      if (item.item_text.startsWith(INCOMING_DATA_CHECKLIST_PREFIX)) {
        incomingDataChecklist.push(item);
        if (!item.is_completed) {
          openIncomingDataChecklistCount += 1;
        }
      }
    }

    for (const item of detailReminders) {
      if (!item.is_completed) {
        pendingReminderCount += 1;
      }
      if (item.title.startsWith(DOCTOR_FOLLOW_UP_PREFIX)) {
        doctorDirectedReminders.push(item);
      }
      if (item.title.startsWith(PACKAGE_END_FOLLOW_UP_PREFIX)) {
        packageEndReminders.push(item);
      }
      if (item.title.startsWith(EXTERNAL_HANDOFF_PREFIX)) {
        externalHandoffReminders.push(item);
      }
      if (item.title.startsWith(BILLING_HANDOFF_PREFIX)) {
        billingHandoffReminders.push(item);
      }
      if (item.title.startsWith(FINDINGS_FOLLOW_UP_PREFIX)) {
        findingsReminders.push(item);
      }
      if (item.title.startsWith(INCOMING_DATA_PREFIX)) {
        incomingDataReminders.push(item);
      }
    }

    for (const item of detailTasks) {
      const isOpenTask =
        item.status !== "completed" && item.status !== "cancelled";
      if (isOpenTask) {
        openTaskCount += 1;
      }
      if (item.title.startsWith(DOCTOR_FOLLOW_UP_PREFIX)) {
        doctorDirectedTasks.push(item);
      }
      if (item.title.startsWith(PACKAGE_END_FOLLOW_UP_PREFIX)) {
        packageEndTasks.push(item);
      }
      if (item.title.startsWith(EXTERNAL_HANDOFF_PREFIX)) {
        externalHandoffTasks.push(item);
      }
      if (item.title.startsWith(BILLING_HANDOFF_PREFIX)) {
        billingHandoffTasks.push(item);
        if (isOpenTask) {
          openBillingHandoffTasks.push(item);
        }
      }
      if (item.title.startsWith(FINDINGS_FOLLOW_UP_PREFIX)) {
        findingsTasks.push(item);
      }
      if (item.title.startsWith(INCOMING_DATA_PREFIX)) {
        incomingDataTasks.push(item);
      }
    }

    for (const item of detailCommunications) {
      if (
        item.target_type === "clinic" ||
        item.target_type === "doctor" ||
        item.target_type === "service_provider"
      ) {
        externalCommunicationEntries.push(item);
      }
    }

    for (const item of detailServices) {
      if (item.status !== "completed" && item.status !== "cancelled") {
        serviceInFlightCount += 1;
      }
      if (item.billing_status === "ready") {
        readyConciergeServices.push(item);
      }
      if (
        item.billing_status === "billed" ||
        item.billing_status === "settled"
      ) {
        settledConciergeServices.push(item);
      }
    }

    const doctorFollowUpAssigneeMap = new Map<
      string,
      { id: string; name: string; role: string }
    >();
    for (const item of handoffStakeholders) {
      doctorFollowUpAssigneeMap.set(item.id, {
        id: item.id,
        name: item.name,
        role: item.role,
      });
    }
    for (const item of taskAssignableStaff) {
      if (!doctorFollowUpAssigneeMap.has(item.id)) {
        doctorFollowUpAssigneeMap.set(item.id, {
          id: item.id,
          name: item.name,
          role: item.role,
        });
      }
    }
    const doctorFollowUpAssignees = Array.from(
      doctorFollowUpAssigneeMap.values(),
    ).sort((left, right) =>
      `${left.role}:${left.name}`.localeCompare(`${right.role}:${right.name}`),
    );
    const interpreterReportReady = !detail?.interpreter_id
      ? true
      : detailReport?.approval_status === "approved";
    const canShowBillingHandoffSection =
      permissions.canManageConciergeBilling ||
      billingHandoffTasks.length > 0 ||
      billingHandoffReminders.length > 0;
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

    return {
      handoffStakeholders,
      openChecklistCount,
      openTaskCount,
      pendingReminderCount,
      doctorDirectedReminders,
      doctorDirectedTasks,
      packageEndReminders,
      packageEndTasks,
      externalCommunicationEntries,
      externalHandoffReminders,
      externalHandoffTasks,
      billingHandoffReminders,
      billingHandoffTasks,
      canShowBillingHandoffSection,
      findingsChecklist,
      findingsReminders,
      findingsTasks,
      incomingDataChecklist,
      incomingDataReminders,
      incomingDataTasks,
      doctorFollowUpAssignees,
      interpreterReportReady,
      readyConciergeServices,
      settledConciergeServices,
      openBillingHandoffTasks,
      billingReadinessWarnings,
      completionWarnings,
    };
  }, [
    billingStaff.length,
    detail,
    detailAssignments,
    detailChecklist,
    detailCommunications,
    detailReminders,
    detailReport?.approval_status,
    detailServices,
    detailTasks,
    permissions.canManageConciergeBilling,
    taskAssignableStaff,
    tr.cases_title,
    tr.common_error,
    tr.common_not_set,
    tr.patients_assign_owner,
    tr.role_interpreter,
  ]);
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
  const timelineLabels = useMemo(
    () => ({
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
      appointments_timeline_concierge_transfer_completed:
        t.appointments_timeline_concierge_transfer_completed,
    }),
    [
      t.appointments_timeline_appointment_created,
      t.appointments_timeline_scheduled_slot,
      t.appointments_timeline_interpreter_pending,
      t.appointments_timeline_interpreter_assigned,
      t.appointments_timeline_interpreter_accepted,
      t.appointments_timeline_interpreter_declined,
      t.appointments_timeline_interpreter_discussion,
      t.appointments_timeline_checklist_completed,
      t.appointments_timeline_checklist_pending,
      t.appointments_timeline_external_response_logged,
      t.appointments_timeline_external_communication_cancelled,
      t.appointments_timeline_external_communication_closed,
      t.appointments_timeline_interpreter_report_submitted,
      t.appointments_timeline_interpreter_report_approved,
      t.appointments_timeline_interpreter_report_rejected,
      t.appointments_timeline_concierge_transfer_completed,
    ],
  );
  const timelineEvents = useMemo(
    () =>
      buildAppointmentTimelineEvents({
        detail,
        checklist: detailChecklist,
        reminders: detailReminders,
        tasks: detailTasks,
        services: detailServices,
        report: detailReport,
        communications: detailCommunications,
        labels: timelineLabels,
      }),
    [
      detail,
      detailChecklist,
      detailReminders,
      detailTasks,
      detailServices,
      detailReport,
      detailCommunications,
      timelineLabels,
    ],
  );
  const detailAttention = detail
    ? (attentionIndex.get(detail.id) ?? null)
    : null;
  const activeCalendarQuickActionItem = calendarQuickActionMenu
    ? (appointmentsIndex.get(calendarQuickActionMenu.appointmentId) ?? null)
    : null;
  const activeCalendarQuickActionScope =
    activeCalendarQuickActionItem?.recurrence_frequency
      ? calendarQuickActionScope
      : "single";
  const syncQuery = useCallback((next: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams);
    Object.entries(next).forEach(([key, value]) => {
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    });
    setSearchParams(params, { replace: true });
  }, [searchParams, setSearchParams]);

  const closeDetailWorkspace = useCallback(
    (clearQuery = true) => {
      setDetailOpen(false);
      setSelectedId("");
      setDetailLoading(false);
      setDetailError("");
      setDetail(null);
      setDetailAssignments([]);
      setDetailCommunications([]);
      setDetailTasks([]);
      setDetailServices([]);
      setDetailChecklist([]);
      setDetailReminders([]);
      setDetailReport(null);
      setFollowUpAssigneeId("");
      setActionBusy("");
      setLinkedPreviewOpen(false);
      setLinkedPreviewKind(null);
      setLinkedPreviewLabel("");
      setLinkedPreviewLoading(false);
      setLinkedPreviewError("");
      setLinkedPreviewPayload(null);
      setLinkedPatientOpen(false);
      setLinkedPatientId("");
      setLinkedPatientDetailLoading(false);
      setLinkedPatientDetailError("");
      setLinkedPatientDetail(null);
      setLinkedPatientAssignments([]);
      setLinkedPatientAssignableStaff([]);
      setLinkedPatientSelectedAssignee("");
      setLinkedPatientAssignmentBusy(false);
      setLinkedPatientAssignmentError("");
      setLinkedPatientVersion(0);
      setLinkedProviderOpen(false);
      setLinkedProviderId("");
      setLinkedProviderDetailLoading(false);
      setLinkedProviderDetailError("");
      setLinkedProviderDetail(null);
      setLinkedCasesOpen(false);
      setLinkedCasesLoading(false);
      setLinkedCasesError("");
      setLinkedCasesItems([]);
      setLinkedCasePreviewOpen(false);
      setLinkedCasePreviewId("");
      setLinkedDocumentsOpen(false);
      setLinkedDocumentsLoading(false);
      setLinkedDocumentsError("");
      setLinkedDocumentsItems([]);
      if (clearQuery) {
        syncQuery({
          appointment: null,
          detailTab: null,
        });
      }
    },
    [syncQuery],
  );

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

    if (!appointmentParam && (selectedId || detailOpen)) {
      closeDetailWorkspace(false);
    }

    if (createParam && permissions.canCreate) {
      const next = blankAppointmentForm();
      next.patientId = patientParam;
      setCreateSeed(next);
      setCreateOpen(true);
      const params = new URLSearchParams(searchParams);
      params.delete("create");
      setSearchParams(params, { replace: true });
    }
  }, [
    closeDetailWorkspace,
    detailOpen,
    permissions.canCreate,
    searchParams,
    selectedId,
    setSearchParams,
  ]);

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
        const [rows, attention] = await Promise.all([
          apiFetch<AppointmentListItem[]>(appointmentsQuery),
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
  }, [
    appointmentsQuery,
    attentionQuery,
    appointmentsVersion,
    tr.common_failed_load,
  ]);

  useEffect(() => {
    if (!filters.providerId) {
      setFilterDoctors([]);
      setFilters((current) =>
        current.doctorId ? { ...current, doctorId: "" } : current,
      );
      return;
    }
    let active = true;
    getProviderDoctors(filters.providerId)
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
        setDetail(appointmentDetail);
        setDetailAssignments(assignments);
        setDetailChecklist(checklist);
        setDetailReminders(reminders);
        setDetailReport(report);
        setDetailTasks(tasks);
        setDetailServices(services);
        setDetailCommunications(communications);
        const followUpDefaultAssignee = resolveFollowUpDefaultAssignee(
          appointmentDetail,
          assignments,
        );
        setFollowUpAssigneeId(followUpDefaultAssignee);
      } catch (error) {
        if (!active) return;
        setDetail(null);
        setDetailAssignments([]);
        setDetailChecklist([]);
        setDetailReminders([]);
        setDetailReport(null);
        setDetailTasks([]);
        setDetailServices([]);
        setDetailCommunications([]);
        setFollowUpAssigneeId("");
        setDetailError(
        error instanceof Error
          ? error.message
          : appointmentText(
              "Termin konnte nicht geladen werden.",
              "Не удалось загрузить приём.",
              "Failed to load appointment",
            ),
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
    tr.appointments_new,
    tr.phase_followup,
  ]);

  useEffect(() => {
    if (!linkedPreviewOpen || !linkedPreviewKind || !detail) return;
    const currentDetail = detail;
    let active = true;

    async function loadLinkedPreview() {
      setLinkedPreviewLoading(true);
      setLinkedPreviewError("");
      setLinkedPreviewPayload(null);

      try {
        let endpoint = "";
        if (linkedPreviewKind === "order") {
          if (!currentDetail.order_id) {
            throw new Error(
              appointmentText(
                "Kein Auftrag mit diesem Termin verknupft.",
                "Для этого приёма нет связанного заказа.",
                "No linked order for this appointment.",
              ),
            );
          }
          endpoint = `/orders/${currentDetail.order_id}`;
        } else if (linkedPreviewKind === "provider") {
          if (!currentDetail.provider_id) {
            throw new Error(
              appointmentText(
                "Keine Klinik mit diesem Termin verknupft.",
                "Для этого приёма нет связанной клиники.",
                "No linked provider for this appointment.",
              ),
            );
          }
          endpoint = `/providers/${currentDetail.provider_id}`;
        } else if (linkedPreviewKind === "documents") {
          endpoint = `/documents?appointment=${currentDetail.id}&patient=${currentDetail.patient_id}`;
        } else {
          endpoint = `/cases?patient=${currentDetail.patient_id}`;
        }

        const payload = await apiFetch<unknown>(endpoint);
        if (!active) return;
        setLinkedPreviewPayload(normalizeLinkedPreviewPayload(payload));
      } catch (error) {
        if (!active) return;
        setLinkedPreviewError(
          error instanceof Error
            ? error.message
            : appointmentText(
                "Verknupfte Daten konnten nicht geladen werden.",
                "Не удалось загрузить связанные данные.",
                "Failed to load linked records",
              ),
        );
      } finally {
        if (active) {
          setLinkedPreviewLoading(false);
        }
      }
    }

    void loadLinkedPreview();
    return () => {
      active = false;
    };
  }, [
    detail,
    linkedPreviewKind,
    linkedPreviewOpen,
  ]);

  useEffect(() => {
    if (!linkedPatientOpen || !linkedPatientId) return;
    let active = true;
    setLinkedPatientDetailLoading(true);
    setLinkedPatientDetailError("");
    setLinkedPatientAssignmentError("");

    const detailRequest = apiFetch<PatientSheetDetail>(`/patients/${linkedPatientId}`);
    const assignmentsRequest = patientSheetPermissions.canViewAssignments
      ? apiFetch<PatientSheetAssignment[]>(`/patients/${linkedPatientId}/assignments`).catch(
          () => [],
        )
      : Promise.resolve([] as PatientSheetAssignment[]);
    const staffRequest = patientSheetPermissions.canManageAssignments
      ? apiFetch<PatientSheetStaffOption[]>("/appointments/meta/staff").catch(
          () => [],
        )
      : Promise.resolve([] as PatientSheetStaffOption[]);

    void Promise.all([detailRequest, assignmentsRequest, staffRequest])
      .then(([patientDetail, assignments, assignableStaff]) => {
        if (!active) return;
        setLinkedPatientDetail(patientDetail);
        setLinkedPatientAssignments(assignments);
        setLinkedPatientAssignableStaff(assignableStaff);
      })
      .catch((error) => {
        if (!active) return;
        setLinkedPatientDetail(null);
        setLinkedPatientAssignments([]);
        setLinkedPatientAssignableStaff([]);
        setLinkedPatientDetailError(
          error instanceof Error ? error.message : t.common_failed_load,
        );
      })
      .finally(() => {
        if (active) {
          setLinkedPatientDetailLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [
    linkedPatientId,
    linkedPatientOpen,
    linkedPatientVersion,
    patientSheetPermissions.canManageAssignments,
    patientSheetPermissions.canViewAssignments,
    t.common_failed_load,
  ]);

  useEffect(() => {
    if (!linkedProviderOpen || !linkedProviderId) return;
    let active = true;
    setLinkedProviderDetailLoading(true);
    setLinkedProviderDetailError("");

    void apiFetch<ProviderSheetDetail>(`/providers/${linkedProviderId}`)
      .then((providerDetail) => {
        if (!active) return;
        setLinkedProviderDetail(providerDetail);
      })
      .catch((error) => {
        if (!active) return;
        setLinkedProviderDetail(null);
        setLinkedProviderDetailError(
          error instanceof Error ? error.message : t.common_failed_load,
        );
      })
      .finally(() => {
        if (active) {
          setLinkedProviderDetailLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [linkedProviderId, linkedProviderOpen, t.common_failed_load]);

  useEffect(() => {
    if (!linkedCasesOpen || !detail?.patient_id) return;
    let active = true;
    setLinkedCasesLoading(true);
    setLinkedCasesError("");

    void apiFetch<CaseRosterItem[]>(`/cases?patient_id=${detail.patient_id}`)
      .then((items) => {
        if (!active) return;
        setLinkedCasesItems(items);
      })
      .catch((error) => {
        if (!active) return;
        setLinkedCasesItems([]);
        setLinkedCasesError(
          error instanceof Error ? error.message : t.common_failed_load,
        );
      })
      .finally(() => {
        if (active) {
          setLinkedCasesLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [detail?.patient_id, linkedCasesOpen, t.common_failed_load]);

  useEffect(() => {
    if (!linkedDocumentsOpen || !detail?.id || !detail.patient_id) return;
    let active = true;
    setLinkedDocumentsLoading(true);
    setLinkedDocumentsError("");

    void apiFetch<LinkedDocumentItem[]>(
      `/documents?appointment_id=${detail.id}&patient_id=${detail.patient_id}`,
    )
      .then((items) => {
        if (!active) return;
        const patientScoped = items.filter(
          (item) => item.patient_id === detail.patient_id,
        );
        setLinkedDocumentsItems(sortLinkedDocuments(patientScoped));
      })
      .catch((error) => {
        if (!active) return;
        setLinkedDocumentsItems([]);
        setLinkedDocumentsError(
          error instanceof Error ? error.message : t.common_failed_load,
        );
      })
      .finally(() => {
        if (active) {
          setLinkedDocumentsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [detail?.id, detail?.patient_id, linkedDocumentsOpen, t.common_failed_load]);

  useEffect(() => {
    setLinkedDocumentSelectedIds((current) =>
      current.filter((id) => linkedDocumentsItems.some((item) => item.id === id)),
    );
  }, [linkedDocumentsItems]);

  const scopedAppointments = useMemo(
    () =>
      appointments.filter((item) =>
        matchesOperationalScope(
          item,
          operationalScope,
          user?.id,
          user?.role,
          attentionIds,
        ),
      ),
    [appointments, operationalScope, user?.id, user?.role, attentionIds],
  );
  const attentionCount = attentionItems.length;
  const {
    todayAppointments,
    activeAppointments,
    pendingInterpreterResponses,
    queueAppointments,
    mobileAgendaPendingCount,
    mobileAgendaWeekCount,
  } = useMemo(() => {
    const queueCandidates: AppointmentListItem[] = [];
    let todayCount = 0;
    let activeCount = 0;
    let pendingCount = 0;
    let mobilePendingCount = 0;
    let mobileWeekCount = 0;

    for (const item of scopedAppointments) {
      if (item.date === todayDate) todayCount += 1;
      if (["planned", "confirmed", "in_progress"].includes(item.status)) {
        activeCount += 1;
      }
      if (item.interpreter_response === "pending") pendingCount += 1;
      if (operationalScope === "all" ? item.status !== "cancelled" : true) {
        queueCandidates.push(item);
      }
      if (item.status !== "cancelled" && item.interpreter_response === "pending") {
        mobilePendingCount += 1;
      }
      if (
        item.status !== "cancelled" &&
        item.date >= weekStart &&
        item.date <= weekEnd
      ) {
        mobileWeekCount += 1;
      }
    }

    return {
      todayAppointments: todayCount,
      activeAppointments: activeCount,
      pendingInterpreterResponses: pendingCount,
      queueAppointments: queueCandidates
        .toSorted((left, right) =>
          `${left.date}${left.time_start ?? ""}`.localeCompare(
            `${right.date}${right.time_start ?? ""}`,
          ),
        )
        .slice(0, 10),
      mobileAgendaPendingCount: mobilePendingCount,
      mobileAgendaWeekCount: mobileWeekCount,
    };
  }, [operationalScope, scopedAppointments, todayDate, weekEnd, weekStart]);
  const useInterpreterMobileAgenda = shouldUseInterpreterMobileAgenda(
    user?.role,
    isMobile,
  );
  const mobileAgendaSections = useMemo(
    () =>
      useInterpreterMobileAgenda
        ? buildInterpreterMobileAgendaSections(
            scopedAppointments,
            todayDate,
            t.appointments_today,
          ).slice(0, 8)
        : [],
    [scopedAppointments, t.appointments_today, todayDate, useInterpreterMobileAgenda],
  );
  const calendarEvents = useMemo(
    () =>
      scopedAppointments.map((item) =>
        toCalendarEvent(item, permissions.canEditSchedule),
      ),
    [permissions.canEditSchedule, scopedAppointments],
  );
  const shouldRenderFiltersDialog = filtersModalOpen;
  const shouldRenderSearchSheet = searchModalOpen;
  const shouldRenderQueueSheet = queueModalOpen;
  const shouldRenderDetailSheetContent =
    detailOpen || detailLoading || Boolean(detailError) || Boolean(detail);
  const showInlineDetailWorkspace = detailOpen && !isMobile;

  const refreshAppointments = useCallback(() => {
    startTransition(() => setAppointmentsVersion((current) => current + 1));
  }, []);

  const refreshDetail = useCallback(() => {
    startTransition(() => {
      setDetailVersion((current) => current + 1);
      setAppointmentsVersion((current) => current + 1);
    });
  }, []);

  const refreshLinkedPatient = useCallback(() => {
    setLinkedPatientVersion((current) => current + 1);
  }, []);

  const reportDetailError = useCallback((message: string) => {
    setDetailError(message);
  }, []);

  const reportAppointmentsNotice = useCallback((notice: string) => {
    setAppointmentsNotice(notice);
  }, []);

  const handleEditSaved = useCallback((notice: string) => {
    setAppointmentsNotice(notice);
    refreshDetail();
  }, [refreshDetail]);

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
      detailTab: null,
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
    setCreateSeed(next);
    setCreateOpen(true);
  }

  useEffect(() => {
    const handleRefreshRequest = () => {
      refreshAppointments();
    };
    const handleCreateRequest = () => {
      if (!permissions.canCreate) return;
      setCreateSeed(blankAppointmentForm());
      setCreateOpen(true);
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
  }, [permissions.canCreate, refreshAppointments]);

  const openDetailSheet = useCallback((id: string) => {
    setCalendarQuickActionMenu(null);
    startTransition(() => {
      setSelectedId(id);
      setDetailOpen(true);
    });
    syncQuery({
      appointment: id,
      detailTab: "overview",
    });
  }, [syncQuery]);

  const openLinkedPreview = useCallback(
    (kind: LinkedPreviewKind, label: string) => {
      if (kind === "patient") {
        const patientId = detail?.patient_id ?? "";
        if (!patientId) return;
        setLinkedPreviewOpen(false);
        setLinkedPreviewKind(null);
        setLinkedPreviewLabel("");
        setLinkedProviderOpen(false);
        setLinkedProviderId("");
        setLinkedCasesOpen(false);
        setLinkedDocumentsOpen(false);
        setLinkedPatientId(patientId);
        setLinkedPatientVersion((current) => current + 1);
        setLinkedPatientOpen(true);
        return;
      }
      if (kind === "provider") {
        const providerId = detail?.provider_id ?? "";
        if (!providerId) return;
        setLinkedPreviewOpen(false);
        setLinkedPreviewKind(null);
        setLinkedPreviewLabel("");
        setLinkedPatientOpen(false);
        setLinkedPatientId("");
        setLinkedCasesOpen(false);
        setLinkedDocumentsOpen(false);
        setLinkedProviderId(providerId);
        setLinkedProviderOpen(true);
        return;
      }
      if (kind === "cases") {
        setLinkedPreviewOpen(false);
        setLinkedPreviewKind(null);
        setLinkedPreviewLabel("");
        setLinkedPatientOpen(false);
        setLinkedPatientId("");
        setLinkedProviderOpen(false);
        setLinkedProviderId("");
        setLinkedDocumentsOpen(false);
        setLinkedCasesOpen(true);
        return;
      }
      if (kind === "documents") {
        if (!detail?.id || !detail.patient_id) return;
        setLinkedPreviewOpen(false);
        setLinkedPreviewKind(null);
        setLinkedPreviewLabel("");
        setLinkedPatientOpen(false);
        setLinkedPatientId("");
        setLinkedProviderOpen(false);
        setLinkedProviderId("");
        setLinkedCasesOpen(false);
        setLinkedDocumentsOpen(true);
        return;
      }
      setLinkedPatientOpen(false);
      setLinkedPatientId("");
      setLinkedProviderOpen(false);
      setLinkedProviderId("");
      setLinkedCasesOpen(false);
      setLinkedDocumentsOpen(false);
      setLinkedPreviewKind(kind);
      setLinkedPreviewLabel(label);
      setLinkedPreviewOpen(true);
    },
    [detail?.id, detail?.patient_id, detail?.provider_id],
  );

  const handleLinkedPreviewOpenChange = useCallback((open: boolean) => {
    setLinkedPreviewOpen(open);
    if (!open) {
      setLinkedPreviewKind(null);
      setLinkedPreviewLabel("");
      setLinkedPreviewLoading(false);
      setLinkedPreviewError("");
      setLinkedPreviewPayload(null);
    }
  }, []);

  const handleLinkedPatientOpenChange = useCallback((open: boolean) => {
    setLinkedPatientOpen(open);
    if (!open) {
      setLinkedPatientId("");
      setLinkedPatientDetailLoading(false);
      setLinkedPatientDetailError("");
      setLinkedPatientDetail(null);
      setLinkedPatientAssignments([]);
      setLinkedPatientAssignableStaff([]);
      setLinkedPatientSelectedAssignee("");
      setLinkedPatientAssignmentBusy(false);
      setLinkedPatientAssignmentError("");
      setLinkedPatientVersion(0);
    }
  }, []);

  const handleLinkedProviderOpenChange = useCallback((open: boolean) => {
    setLinkedProviderOpen(open);
    if (!open) {
      setLinkedProviderId("");
      setLinkedProviderDetailLoading(false);
      setLinkedProviderDetailError("");
      setLinkedProviderDetail(null);
    }
  }, []);

  const handleLinkedCasesOpenChange = useCallback((open: boolean) => {
    setLinkedCasesOpen(open);
    if (!open) {
      setLinkedCasesLoading(false);
      setLinkedCasesError("");
      setLinkedCasesItems([]);
      setLinkedCasePreviewOpen(false);
      setLinkedCasePreviewId("");
    }
  }, []);

  const handleLinkedDocumentsOpenChange = useCallback((open: boolean) => {
    setLinkedDocumentsOpen(open);
    if (!open) {
      setLinkedDocumentsLoading(false);
      setLinkedDocumentsError("");
      setLinkedDocumentsItems([]);
      setLinkedDocumentSelectedIds([]);
    }
  }, []);

  const handleLinkedCasePreviewOpenChange = useCallback((open: boolean) => {
    setLinkedCasePreviewOpen(open);
    if (!open) {
      setLinkedCasePreviewId("");
    }
  }, []);

  const handleAssignLinkedPatient = useCallback(async () => {
    if (!linkedPatientDetail || !linkedPatientSelectedAssignee) return;
    setLinkedPatientAssignmentBusy(true);
    setLinkedPatientAssignmentError("");
    try {
      await apiFetch(`/patients/${linkedPatientDetail.id}/assign`, {
        method: "POST",
        body: JSON.stringify({ user_id: linkedPatientSelectedAssignee }),
      });
      setLinkedPatientSelectedAssignee("");
      refreshLinkedPatient();
    } catch (error) {
      setLinkedPatientAssignmentError(
        error instanceof Error ? error.message : t.common_failed_assign,
      );
    } finally {
      setLinkedPatientAssignmentBusy(false);
    }
  }, [linkedPatientDetail, linkedPatientSelectedAssignee, refreshLinkedPatient, t.common_failed_assign]);

  const handleFollowUpVisitCreated = useCallback(
    ({ id, notice }: { id?: string; notice: string }) => {
      setAppointmentsNotice(notice);
      refreshAppointments();
      if (id) {
        openDetailSheet(id);
      } else {
        refreshDetail();
      }
    },
    [openDetailSheet, refreshAppointments, refreshDetail],
  );

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

  async function handleInlineReschedule(
    info: EventDropArg | EventResizeDoneArg,
  ) {
    const source = appointmentsIndex.get(info.event.id);
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
        error instanceof Error
          ? error.message
          : appointmentText(
              "Status konnte nicht geändert werden.",
              "Не удалось изменить статус.",
              "Failed to change status",
            );
      if (selectedId === appointmentId) {
        setDetailError(message);
      } else {
        setAppointmentsError(message);
      }
    } finally {
      setActionBusy("");
    }
  }

  function renderLinkedPreviewContent() {
    if (linkedPreviewLoading) {
      return (
        <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
          <LoaderCircle className="mr-2 size-4 animate-spin" />
          {appointmentText(
            "Verknupfte Daten werden geladen…",
            "Загрузка связанных данных…",
            "Loading linked records…",
          )}
        </div>
      );
    }

    if (linkedPreviewError) {
      return <Banner tone="error" withIcon>{linkedPreviewError}</Banner>;
    }

    if (
      !linkedPreviewPayload ||
      (Array.isArray(linkedPreviewPayload) && linkedPreviewPayload.length === 0)
    ) {
      return (
        <EmptyCell>
          {appointmentText(
            "Keine verknupften Daten gefunden.",
            "Связанные данные не найдены.",
            "No linked records found.",
          )}
        </EmptyCell>
      );
    }

    if (!Array.isArray(linkedPreviewPayload)) {
      const record = linkedPreviewPayload;
      const fields: Array<{ label: string; value: string }> =
        linkedPreviewKind === "patient"
          ? [
              {
                label: appointmentText("Name", "Имя", "Name"),
                value: readLinkedPreviewValue(record, [
                  "name",
                  "full_name",
                  "display_name",
                ]),
              },
              {
                label: "Patient ID",
                value: readLinkedPreviewValue(record, ["patient_id", "id"]),
              },
              {
                label: "PID",
                value: readLinkedPreviewValue(record, ["pid"]),
              },
              {
                label: appointmentText("Telefon", "Телефон", "Phone"),
                value: readLinkedPreviewValue(record, [
                  "phone",
                  "phone_number",
                  "mobile",
                ]),
              },
              {
                label: "Email",
                value: readLinkedPreviewValue(record, ["email"]),
              },
            ]
          : linkedPreviewKind === "order"
            ? [
                {
                  label: appointmentText("Auftrag", "Заказ", "Order"),
                  value: readLinkedPreviewValue(record, [
                    "order_number",
                    "number",
                    "id",
                  ]),
                },
                {
                  label: appointmentText("Status", "Статус", "Status"),
                  value: readLinkedPreviewValue(record, ["status"]),
                },
                {
                  label: appointmentText("Typ", "Тип", "Type"),
                  value: readLinkedPreviewValue(record, ["order_type", "type"]),
                },
                {
                  label: appointmentText("Patient", "Пациент", "Patient"),
                  value: readLinkedPreviewValue(record, [
                    "patient_name",
                    "patient_id",
                  ]),
                },
                {
                  label: appointmentText("Erstellt", "Создано", "Created"),
                  value: readLinkedPreviewValue(record, [
                    "created_at",
                    "updated_at",
                  ]),
                },
              ]
            : [
                {
                  label: appointmentText("Name", "Название", "Name"),
                  value: readLinkedPreviewValue(record, ["name"]),
                },
                {
                  label: appointmentText("Typ", "Тип", "Type"),
                  value: readLinkedPreviewValue(record, [
                    "provider_type",
                    "type",
                  ]),
                },
                {
                  label: appointmentText("Stadt", "Город", "City"),
                  value: readLinkedPreviewValue(record, [
                    "address_city",
                    "city",
                  ]),
                },
                {
                  label: appointmentText(
                    "Fachbereich",
                    "Специализация",
                    "Specialty",
                  ),
                  value: readLinkedPreviewValue(record, ["fachbereich", "specialty"]),
                },
                {
                  label: appointmentText("Adresse", "Адрес", "Address"),
                  value: readLinkedPreviewValue(record, [
                    "address",
                    "address_line1",
                  ]),
                },
              ];

      return (
        <div className="grid gap-3 md:grid-cols-2">
          {fields.map((field) => (
            <div
              key={field.label}
              className={cn("rounded-xl px-4 py-3", tokens.surface.card)}
            >
              <InfoRow label={field.label} value={field.value} />
            </div>
          ))}
        </div>
      );
    }

    const items = linkedPreviewPayload.slice(0, 20);
    const hiddenCount = linkedPreviewPayload.length - items.length;
    return (
      <div className="space-y-2">
        {items.map((item, index) => {
          const title =
            linkedPreviewKind === "documents"
              ? readLinkedPreviewValue(item, [
                  "filename",
                  "title",
                  "document_id",
                  "id",
                ])
              : linkedPreviewKind === "cases"
                ? readLinkedPreviewValue(item, [
                    "case_id",
                    "title",
                    "hauptanfragegrund",
                    "id",
                  ])
                : readLinkedPreviewValue(item, ["title", "name", "id"]);
          const meta = [item.status, item.category, item.created_at]
            .filter((part) => part !== undefined && part !== null && part !== "")
            .map((part) => linkedPreviewText(part))
            .join(" • ");

          return (
            <ListItem
              key={readLinkedPreviewValue(item, ["id"]) + String(index)}
              className="space-y-1"
            >
              <p className="text-sm font-medium text-foreground">{title}</p>
              {meta ? (
                <p className="text-xs text-muted-foreground">{meta}</p>
              ) : null}
            </ListItem>
          );
        })}
        {hiddenCount > 0 ? (
          <p className="pt-1 text-xs text-muted-foreground">
            {appointmentText(
              `+${hiddenCount} weitere`,
              `+${hiddenCount} еще`,
              `+${hiddenCount} more`,
            )}
          </p>
        ) : null}
      </div>
    );
  }

  if (!permissions.canViewPage) {
    return (
      <div className={sectionCardClass("p-8 text-sm text-muted-foreground")}>
        {appointmentText(
          "Ihre aktuelle Rolle hat keinen Zugriff auf Termine.",
          "У вашей текущей роли нет доступа к приёмам.",
          "Your current role does not have access to appointments.",
        )}
      </div>
    );
  }

  function renderInlineDetailWorkspace() {
    if (detailLoading) {
      return (
        <div className="flex min-h-[320px] items-center justify-center text-muted-foreground">
          <LoaderCircle className="mr-2 size-4 animate-spin" />
          {appointmentText(
            "Termin wird geladen",
            "Загрузка приёма",
            "Loading appointment",
          )}
        </div>
      );
    }

    if (detailError) {
      return <Banner tone="error" withIcon>{detailError}</Banner>;
    }

    if (!detail) {
      return (
        <section className={sectionCardClass("p-5")}>
          <EmptyState
            text={appointmentText(
              "Termin im Kalender oder in der Liste auswahlen.",
              "Выберите приём в календаре или списке.",
              "Select an appointment from the calendar or list.",
            )}
          />
        </section>
      );
    }

    const coordinationEmpty = appointmentText(
      "Für diesen Termin sind keine Koordinationsflächen verfügbar.",
      "Для этого приёма нет координационных блоков.",
      "No coordination surfaces are available for this appointment.",
    );
    const clinicalEmpty = appointmentText(
      "Für diesen Termin sind keine klinischen Blöcke verfügbar.",
      "Для этого приёма нет клинических блоков.",
      "No clinical surfaces are available for this appointment.",
    );
    const workflowEmpty = appointmentText(
      "Für diesen Termin sind keine Workflow-Blöcke verfügbar.",
      "Для этого приёма нет workflow-блоков.",
      "No workflow surfaces are available for this appointment.",
    );
    const servicesEmpty = appointmentText(
      "Für diesen Termin sind keine Service- oder Billing-Blöcke verfügbar.",
      "Для этого приёма нет сервисных или billing-блоков.",
      "No service or billing surfaces are available for this appointment.",
    );
    const notesEmpty = appointmentText(
      "Für diesen Termin sind keine Notizen verfügbar.",
      "Для этого приёма нет заметок.",
      "No notes are available for this appointment.",
    );

    const showOverviewDetails = detailTab === "overview";
    const showTimelineTab = detailTab === "timeline";
    const showCoordinationTab = detailTab === "coordination";
    const showClinicalTab = detailTab === "clinical";
    const showWorkflowTab = detailTab === "workflow";
    const showServicesTab = detailTab === "services";
    const showNotesTab = detailTab === "notes";

    const hasCoordinationContent = !detail.is_blocked;
    const showClinicalIncomingSection =
      !detail.is_blocked &&
      permissions.canManageChecklist &&
      permissions.canViewReminders;
    const showClinicalFindingsSection =
      showClinicalIncomingSection &&
      Boolean(detail.provider_id || detail.doctor_id);
    const showClinicalReportSection = permissions.canViewReport;
    const hasClinicalContent =
      showClinicalIncomingSection ||
      showClinicalFindingsSection ||
      showClinicalReportSection;
    const clinicalSurfaceItemCount =
      Number(showClinicalIncomingSection) +
      Number(showClinicalFindingsSection) +
      Number(showClinicalReportSection);
    const incomingDataOpenCount = incomingDataChecklist.filter(
      (item) => !item.is_completed,
    ).length;
    const findingsOpenCount = findingsChecklist.filter(
      (item) => !item.is_completed,
    ).length;
    const clinicalOpenCount = incomingDataOpenCount + findingsOpenCount;
    const clinicalFollowUpCount =
      incomingDataReminders.length +
      incomingDataTasks.length +
      findingsReminders.length +
      findingsTasks.length;
    const hasWorkflowContent =
      permissions.canManageStatus ||
      permissions.canEditSchedule ||
      permissions.canAssignInterpreter ||
      permissions.canRespondToAssignment ||
      permissions.canManageChecklist ||
      permissions.canViewReminders ||
      permissions.canViewTasks;
    const hasServicesContent =
      canShowConciergeSection || canShowBillingHandoffSection;

    return (
      <div className="space-y-6">
        {appointmentsNotice ? (
          <Banner tone="warning" withIcon>{appointmentsNotice}</Banner>
        ) : null}
        <MemoizedAppointmentOverviewSection
          detail={detail}
          onOpenDetail={openDetailSheet}
        />

        {showOverviewDetails ? (
          <>
            <MemoizedAppointmentSnapshotSection detail={detail} />
            {detailAttention ? (
              <MemoizedAppointmentAttentionSection attention={detailAttention} />
            ) : null}
            <MemoizedAppointmentLinksSection
              detail={detail}
              onOpenPreview={openLinkedPreview}
            />
          </>
        ) : null}

        {showTimelineTab ? (
          <MemoizedAppointmentTimelineSection
            key={`${detail.id}:${detailVersion}:workspace`}
            timelineEvents={timelineEvents}
          />
        ) : null}

        {showCoordinationTab ? (
          hasCoordinationContent ? (
            <>
              {!detail.is_blocked ? (
                <MemoizedAppointmentHandoffSection
                  detail={detail}
                  handoffStakeholders={handoffStakeholders}
                  followUpAssigneeId={followUpAssigneeId}
                  setFollowUpAssigneeId={setFollowUpAssigneeId}
                  canManageReminders={permissions.canManageReminders}
                  onRefresh={refreshDetail}
                  onError={reportDetailError}
                />
              ) : null}
              {!detail.is_blocked && permissions.canCreate ? (
                <MemoizedAppointmentFollowUpVisitSection
                  detail={detail}
                  appointments={appointments}
                  providers={providers}
                  staff={staff}
                  interpreters={interpreters}
                  defaultReminderUserId={detailDefaultAssigneeId}
                  onCreated={handleFollowUpVisitCreated}
                />
              ) : null}
              {!detail.is_blocked && permissions.canViewReminders ? (
                <MemoizedAppointmentDoctorFollowUpSection
                  detail={detail}
                  reminders={doctorDirectedReminders}
                  tasks={doctorDirectedTasks}
                  assignees={doctorFollowUpAssignees}
                  defaultAssigneeId={detailDefaultAssigneeId}
                  canManageReminders={permissions.canManageReminders}
                  canCreateTasks={permissions.canCreateTasks}
                  onRefresh={refreshDetail}
                  onError={reportDetailError}
                />
              ) : null}
              {!detail.is_blocked &&
              permissions.canViewReminders &&
              detail.order_id ? (
                <MemoizedAppointmentPackageEndSection
                  detail={detail}
                  reminders={packageEndReminders}
                  tasks={packageEndTasks}
                  assignees={doctorFollowUpAssignees}
                  defaultAssigneeId={detailDefaultAssigneeId}
                  defaultTitle={tr.appointments_new ?? ""}
                  canManageReminders={permissions.canManageReminders}
                  canCreateTasks={permissions.canCreateTasks}
                  onRefresh={refreshDetail}
                  onError={reportDetailError}
                />
              ) : null}
              {!detail.is_blocked &&
              permissions.canViewCommunications &&
              (detail.provider_id || detail.doctor_id) ? (
                <MemoizedAppointmentExternalHandoffSection
                  detail={detail}
                  communications={externalCommunicationEntries}
                  reminders={externalHandoffReminders}
                  tasks={externalHandoffTasks}
                  assignees={doctorFollowUpAssignees}
                  defaultAssigneeId={detailDefaultAssigneeId}
                  canManageCommunications={permissions.canManageCommunications}
                  canViewReminders={permissions.canViewReminders}
                  canCreateTasks={permissions.canCreateTasks}
                  onRefresh={refreshDetail}
                  onError={reportDetailError}
                />
              ) : null}
            </>
          ) : (
            <section className={sectionCardClass("p-5")}>
              <EmptyState text={coordinationEmpty} />
            </section>
          )
        ) : null}

        {showClinicalTab ? (
          <>
            <AppointmentWorkspaceSectionIntro
              title={appointmentText(
                "Klinische Oberfläche",
                "Клинический блок",
                "Clinical surface",
              )}
              description={appointmentText(
                "Eingehende medizinische Daten, Befunde und Dolmetscherbericht direkt im Termin-Kontext.",
                "Входящие медицинские данные, заключения и отчёт переводчика прямо в контексте приёма.",
                "Incoming medical data, findings and interpreter reporting in the appointment context.",
              )}
              accessory={<CountBadge>{clinicalSurfaceItemCount}</CountBadge>}
            />

            {hasClinicalContent ? (
              <>
                <Section
                  title={appointmentText(
                    "Klinische Übersicht",
                    "Клиническая сводка",
                    "Clinical summary",
                  )}
                  accessory={<CountBadge>{clinicalOpenCount}</CountBadge>}
                >
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <StatCard
                      label={appointmentText(
                        "Intake offen",
                        "Открытый intake",
                        "Open intake",
                      )}
                      value={incomingDataOpenCount}
                      description={appointmentText(
                        "Checklistenpunkte für Eingangsdaten.",
                        "Пункты чек-листа по входящим данным.",
                        "Checklist items for incoming data.",
                      )}
                    />
                    <StatCard
                      label={appointmentText(
                        "Befunde offen",
                        "Открытые заключения",
                        "Open findings",
                      )}
                      value={findingsOpenCount}
                      description={appointmentText(
                        "Punkte rund um Arztbrief und Befunde.",
                        "Пункты по Arztbrief и заключениям.",
                        "Items related to Arztbrief and findings.",
                      )}
                    />
                    <StatCard
                      label={appointmentText(
                        "Follow-up-Last",
                        "Нагрузка follow-up",
                        "Follow-up load",
                      )}
                      value={clinicalFollowUpCount}
                      description={appointmentText(
                        "Reminder und Aufgaben im klinischen Flow.",
                        "Напоминания и задачи в клиническом flow.",
                        "Reminders and tasks in the clinical flow.",
                      )}
                    />
                    <StatCard
                      label={appointmentText(
                        "Bericht",
                        "Отчёт",
                        "Report",
                      )}
                      value={
                        detailReport
                          ? reportApprovalLabel(detailReport.approval_status)
                          : appointmentText(
                              "Offen",
                              "Ожидается",
                              "Pending",
                            )
                      }
                      description={
                        detailReport
                          ? `${detailReport.hours} h`
                          : appointmentText(
                              "Noch nicht eingereicht.",
                              "Пока не отправлен.",
                              "Not submitted yet.",
                            )
                      }
                    />
                  </div>
                </Section>

                {showClinicalIncomingSection ? (
                  <MemoizedAppointmentIncomingDataSection
                    detail={detail}
                    checklist={incomingDataChecklist}
                    reminders={incomingDataReminders}
                    tasks={incomingDataTasks}
                    assignees={doctorFollowUpAssignees}
                    defaultAssigneeId={detailDefaultAssigneeId}
                    canCreateTasks={permissions.canCreateTasks}
                    onRefresh={refreshDetail}
                    onError={reportDetailError}
                  />
                ) : null}
                {showClinicalFindingsSection ? (
                  <MemoizedAppointmentFindingsSection
                    detail={detail}
                    checklist={findingsChecklist}
                    reminders={findingsReminders}
                    tasks={findingsTasks}
                    assignees={doctorFollowUpAssignees}
                    defaultAssigneeId={detailDefaultAssigneeId}
                    canCreateTasks={permissions.canCreateTasks}
                    onRefresh={refreshDetail}
                    onError={reportDetailError}
                  />
                ) : null}
                {showClinicalReportSection ? (
                  <MemoizedAppointmentReportSection
                    detail={detail}
                    detailReport={detailReport}
                    reportReviewMeta={reportReviewMeta}
                    canSubmitInterpreterReport={canSubmitInterpreterReport}
                    canResubmitRejectedReport={canResubmitRejectedReport}
                    showReportReviewActions={showReportReviewActions}
                    canApproveReport={permissions.canApproveReport}
                    canRejectReport={permissions.canRejectReport}
                    onRefresh={refreshDetail}
                    onError={reportDetailError}
                  />
                ) : null}
              </>
            ) : (
              <Section
                title={appointmentText(
                  "Klinische Oberfläche",
                  "Клинический блок",
                  "Clinical surface",
                )}
              >
                <EmptyCell>{clinicalEmpty}</EmptyCell>
              </Section>
            )}
          </>
        ) : null}

        {showWorkflowTab ? (
          hasWorkflowContent ? (
            <>
              {permissions.canManageStatus ? (
                <MemoizedAppointmentCompletionSection
                  detail={detail}
                  detailReport={detailReport}
                  handoffStakeholders={handoffStakeholders}
                  openChecklistCount={openChecklistCount}
                  openTaskCount={openTaskCount}
                  pendingReminderCount={pendingReminderCount}
                  interpreterReportReady={interpreterReportReady}
                  completionWarnings={completionWarnings}
                  followUpAssigneeId={followUpAssigneeId}
                  setFollowUpAssigneeId={setFollowUpAssigneeId}
                  onRefresh={refreshDetail}
                  onError={reportDetailError}
                  onNotice={reportAppointmentsNotice}
                />
              ) : null}
              {permissions.canManageStatus ? (
                <MemoizedAppointmentStatusSection
                  detail={detail}
                  openChecklistCount={openChecklistCount}
                  onRefresh={refreshDetail}
                  onError={reportDetailError}
                />
              ) : null}
              {permissions.canEditSchedule ? (
                <MemoizedEditAppointmentSection
                  detail={detail}
                  appointments={appointments}
                  providers={providers}
                  staff={staff}
                  interpreters={interpreters}
                  onSaved={handleEditSaved}
                />
              ) : null}
              <MemoizedAppointmentInterpreterSection
                detail={detail}
                interpreters={interpreters}
                currentUserId={user?.id}
                canAssign={permissions.canAssignInterpreter}
                canRespond={permissions.canRespondToAssignment}
                onRefresh={refreshDetail}
                onError={reportDetailError}
              />
              {permissions.canManageChecklist ? (
                <MemoizedAppointmentChecklistSection
                  detail={detail}
                  items={detailChecklist}
                  onRefresh={refreshDetail}
                  onError={reportDetailError}
                />
              ) : null}
              {permissions.canViewReminders ? (
                <MemoizedAppointmentRemindersSection
                  detail={detail}
                  reminders={detailReminders}
                  staff={staff}
                  canManageReminders={permissions.canManageReminders}
                  onRefresh={refreshDetail}
                  onError={reportDetailError}
                />
              ) : null}
              {permissions.canViewTasks ? (
                <MemoizedAppointmentTasksSection
                  detail={detail}
                  tasks={detailTasks}
                  assignableStaff={taskAssignableStaff}
                  canCreateTasks={permissions.canCreateTasks}
                  onRefresh={refreshDetail}
                  onError={reportDetailError}
                />
              ) : null}
            </>
          ) : (
            <section className={sectionCardClass("p-5")}>
              <EmptyState text={workflowEmpty} />
            </section>
          )
        ) : null}

        {showServicesTab ? (
          hasServicesContent ? (
            <>
              {canShowConciergeSection ? (
                <MemoizedAppointmentConciergeSection
                  detail={detail}
                  services={detailServices}
                  nonMedicalProviders={nonMedicalProviders}
                  conciergeStaff={conciergeStaff}
                  canManageConciergeServices={
                    permissions.canManageConciergeServices
                  }
                  canManageConciergeBilling={permissions.canManageConciergeBilling}
                  onRefresh={refreshDetail}
                  onError={reportDetailError}
                />
              ) : null}
              {canShowBillingHandoffSection ? (
                <MemoizedAppointmentBillingHandoffSection
                  detail={detail}
                  detailReport={detailReport}
                  reportReviewMeta={reportReviewMeta}
                  interpreterReportReady={interpreterReportReady}
                  serviceCount={detailServices.length}
                  billingStaff={billingStaff}
                  reminders={billingHandoffReminders}
                  tasks={billingHandoffTasks}
                  openTasks={openBillingHandoffTasks}
                  readyServices={readyConciergeServices}
                  settledServices={settledConciergeServices}
                  warnings={billingReadinessWarnings}
                  canManageConciergeBilling={permissions.canManageConciergeBilling}
                  canCreateTasks={permissions.canCreateTasks}
                  onRefresh={refreshDetail}
                  onError={reportDetailError}
                />
              ) : null}
            </>
          ) : (
            <section className={sectionCardClass("p-5")}>
              <EmptyState text={servicesEmpty} />
            </section>
          )
        ) : null}

        {showNotesTab ? (
          permissions.canViewNotes && !detail.is_blocked ? (
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
          ) : (
            <section className={sectionCardClass("p-5")}>
              <EmptyState text={notesEmpty} />
            </section>
          )
        ) : null}
      </div>
    );
  }

  return (
    <>
      {showInlineDetailWorkspace ? (
        renderInlineDetailWorkspace()
      ) : (
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
          <Banner tone="error" withIcon>{appointmentsError}</Banner>
        ) : null}
        {appointmentsNotice ? (
          <Banner tone="warning" withIcon>{appointmentsNotice}</Banner>
        ) : null}
        {metadataError ? <Banner tone="warning" withIcon>{metadataError}</Banner> : null}

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
                    placeholder={withEllipsis(tr.common_search)}
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
                    {t.common_reset}
                  </Button>
                </div>
              </div>
            </section>

            {mobileAgendaSections.length === 0 ? (
              <section className={sectionCardClass("p-5")}>
                <EmptyState
                  text={appointmentText(
                    "Im aktuellen mobilen Scope sind keine Termine vorhanden.",
                    "В текущем мобильном scope нет приёмов.",
                    "No appointments in the current mobile scope.",
                  )}
                />
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

              <Dialog open={filtersModalOpen} onOpenChange={setFiltersModalOpen}>
                {shouldRenderFiltersDialog ? (
                  <DialogContent className="sm:max-w-[420px]">
                    <DialogHeader className="space-y-0">
                      <DialogTitle className="text-sm font-semibold text-slate-950">
                        {appointmentText("Filter", "Фильтры", "Filters")}
                      </DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-3 pt-1">
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
                  </DialogContent>
                ) : null}
              </Dialog>

              {shouldRenderSearchSheet ? (
                <AppointmentEditorSheet
                  open={searchModalOpen}
                  onOpenChange={setSearchModalOpen}
                  title={t.common_search}
                  maxWidthClassName="sm:max-w-[460px]"
                  footer={
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-lg"
                        onClick={() => {
                          setOperationalScope("all");
                          setFilters(DEFAULT_FILTERS);
                          syncQuery({
                            patient: null,
                            provider: null,
                            doctor: null,
                            appointment: null,
                            detailTab: null,
                          });
                        }}
                      >
                        {t.common_reset}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        className="h-8 rounded-lg"
                        onClick={() => setSearchModalOpen(false)}
                      >
                        {t.common_cancel}
                      </Button>
                    </>
                  }
                >
                  <Field label={t.common_search}>
                    <Input
                      value={filters.search}
                      onChange={(event) =>
                        setFilters((current) => ({
                          ...current,
                          search: event.target.value,
                        }))
                      }
                      placeholder={withEllipsis(tr.common_search)}
                      autoComplete="off"
                      className={createSheetInputClassName}
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
                      className={selectClass}
                    >
                      <option value="">{t.providers_all}</option>
                      {TYPE_OPTIONS.map((value) => (
                        <option key={value} value={value}>
                          {appointmentTypeLabel(value, tr)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field
                    label={appointmentText(
                      "Versorgungspfad",
                      "Траектория лечения",
                      "Care path",
                    )}
                  >
                    <select
                      value={filters.carePathKind}
                      onChange={(event) =>
                        setFilters((current) => ({
                          ...current,
                          carePathKind: event.target.value,
                        }))
                      }
                      className={selectClass}
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
                      className={selectClass}
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
                      className={selectClass}
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
                      className={selectClass}
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
                      className={selectClass}
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
                      className={selectClass}
                    >
                      <option value="">{tr.providers_all}</option>
                      {staff.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.name} · {roleLabel(member.role)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field
                    label={
                      tr.role_interpreter ??
                      appointmentText("Dolmetscher", "Переводчик", "Interpreter")
                    }
                  >
                    <select
                      value={filters.interpreterId}
                      onChange={(event) =>
                        setFilters((current) => ({
                          ...current,
                          interpreterId: event.target.value,
                        }))
                      }
                      className={selectClass}
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
                        className={createSheetInputClassName}
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
                        className={createSheetInputClassName}
                      />
                    </Field>
                  </div>
                </AppointmentEditorSheet>
              ) : null}

              {shouldRenderQueueSheet ? (
                <AppointmentPreviewSheet
                  open={queueModalOpen}
                  onOpenChange={setQueueModalOpen}
                  title={t.appointments_title}
                  maxWidthClassName="sm:max-w-[640px]"
                >
                  {appointmentsLoading || metadataLoading ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <LoaderCircle className="size-3.5 animate-spin" />
                      {t.patients_syncing}
                    </div>
                  ) : null}
                  {queueAppointments.length === 0 ? (
                    <EmptyCell>{tr.common_not_set}</EmptyCell>
                  ) : (
                    <div className="space-y-3">
                      {queueAppointments.map((item) => (
                        <ListItem key={item.id} className="space-y-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <button
                                type="button"
                                onClick={() => openDetailSheet(item.id)}
                                className="truncate text-left text-sm font-semibold text-foreground transition-colors hover:text-[var(--brand)]"
                              >
                                {item.title}
                              </button>
                              <p className="truncate text-xs text-muted-foreground">
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
                          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
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
                          <p className="truncate text-xs font-medium text-muted-foreground">
                            {operationalScopeReason(
                              item,
                              operationalScope,
                              user?.role,
                              attentionIndex,
                              tr,
                            )}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-8 rounded-lg"
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
                                className="h-8 rounded-lg"
                                disabled={Boolean(actionBusy)}
                                onClick={() =>
                                  void performStatusChange(item.id, "confirmed")
                                }
                              >
                                {actionBusy ===
                                statusActionKey(item.id, "confirmed") ? (
                                  <LoaderCircle className="size-3.5 animate-spin" />
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
                                className="h-8 rounded-lg"
                                disabled={Boolean(actionBusy)}
                                onClick={() =>
                                  void performStatusChange(item.id, "completed")
                                }
                              >
                                {actionBusy ===
                                statusActionKey(item.id, "completed") ? (
                                  <LoaderCircle className="size-3.5 animate-spin" />
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
                                  className="h-8 rounded-lg border-rose-200 text-rose-700 hover:bg-rose-50"
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
                                    <LoaderCircle className="size-3.5 animate-spin" />
                                  ) : null}
                                  {t.appointments_cancel_this_and_following}
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-8 rounded-lg border-rose-200 text-rose-700 hover:bg-rose-50"
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
                                    <LoaderCircle className="size-3.5 animate-spin" />
                                  ) : null}
                                  {t.appointments_cancel_whole_series}
                                </Button>
                              </>
                            ) : null}
                          </div>
                        </ListItem>
                      ))}
                    </div>
                  )}
                </AppointmentPreviewSheet>
              ) : null}

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
                  events={calendarEvents}
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
                          className="mt-2 h-9 w-full rounded-xl border border-slate-200 bg-card px-3 text-sm text-foreground"
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
      )}

      <MemoizedCreateAppointmentSheet
        open={createOpen}
        seed={createSeed}
        appointments={appointments}
        patients={patients}
        providers={providers}
        interpreters={interpreters}
        staff={staff}
        userId={user?.id}
        onOpenChange={setCreateOpen}
        onCreated={({ id, notice }) => {
          setAppointmentsNotice(notice);
          refreshAppointments();
          if (id) {
            openDetailSheet(id);
          }
        }}
      />

      <MemoizedPatientDetailSheet
        open={linkedPatientOpen}
        detail={linkedPatientDetail}
        detailBusy={linkedPatientDetailLoading}
        detailError={linkedPatientDetailError}
        hideFooterActions
        dictionary={tr as unknown as PatientsDictionary}
        canCreateEdit={patientSheetPermissions.canCreateEdit}
        canViewAssignments={patientSheetPermissions.canViewAssignments}
        canManageAssignments={patientSheetPermissions.canManageAssignments}
        assignments={linkedPatientAssignments}
        assignableStaff={linkedPatientAssignableStaff}
        selectedAssignee={linkedPatientSelectedAssignee}
        assignmentBusy={linkedPatientAssignmentBusy}
        assignmentError={linkedPatientAssignmentError}
        onAssigneeChange={setLinkedPatientSelectedAssignee}
        onAssign={handleAssignLinkedPatient}
        onOpenChange={handleLinkedPatientOpenChange}
        onRefresh={refreshLinkedPatient}
        hideWorkspaceActions
        onOpenCases={() => undefined}
        onOpenOrders={() => undefined}
        onOpenAppointments={() => undefined}
        onOpenContracts={() => undefined}
        onOpenDocuments={() => undefined}
      />

      <AppointmentPreviewSheet
        open={linkedProviderOpen}
        onOpenChange={handleLinkedProviderOpenChange}
        title={linkedProviderDetail?.name || t.providers_detail}
        maxWidthClassName="sm:max-w-[920px]"
      >
        {linkedProviderDetailLoading ? (
          <div className="flex min-h-[220px] items-center justify-center text-sm text-muted-foreground">
            <LoaderCircle className="mr-2 size-4 animate-spin" />
            {appointmentText(
              "Anbieter wird geladen",
              "Загрузка провайдера",
              "Loading provider",
            )}
          </div>
        ) : linkedProviderDetail ? (
          <>
            {linkedProviderDetailError ? (
              <Banner tone="error" withIcon>{linkedProviderDetailError}</Banner>
            ) : null}
            <AppointmentLinkedProviderOverviewSection
              detail={linkedProviderDetail}
              formatDateTimeLabel={formatDateTimeLabel}
            />
            <AppointmentLinkedProviderPatientsSection
              detail={linkedProviderDetail}
              formatDateTimeLabel={formatDateTimeLabel}
              onOpenPatient={(patientId) => {
                setLinkedProviderOpen(false);
                setLinkedProviderId("");
                setLinkedPatientId(patientId);
                setLinkedPatientVersion((current) => current + 1);
                setLinkedPatientOpen(true);
              }}
            />
            <AppointmentLinkedProviderInteractionsSection
              detail={linkedProviderDetail}
              formatDateTimeLabel={formatDateTimeLabel}
              onOpenPatient={(patientId) => {
                setLinkedProviderOpen(false);
                setLinkedProviderId("");
                setLinkedPatientId(patientId);
                setLinkedPatientVersion((current) => current + 1);
                setLinkedPatientOpen(true);
              }}
              onOpenAppointment={(appointmentId) => {
                handleLinkedProviderOpenChange(false);
                openDetailSheet(appointmentId);
              }}
            />
          </>
        ) : linkedProviderDetailError ? (
          <Banner tone="error" withIcon>{linkedProviderDetailError}</Banner>
        ) : (
          <EmptyCell>
            {appointmentText(
              "Keine Klinikdaten verfügbar.",
              "Нет данных клиники.",
              "No provider data available.",
            )}
          </EmptyCell>
        )}
      </AppointmentPreviewSheet>

      <AppointmentPreviewSheet
        open={linkedCasesOpen}
        onOpenChange={handleLinkedCasesOpenChange}
        title={t.cases_roster}
        description={
          linkedCasesLoading
            ? `${t.cases_subtitle} · ${t.patients_syncing}`
            : `${t.cases_subtitle} · ${linkedCasesItems.length} ${t.patients_records}`
        }
        maxWidthClassName="sm:max-w-[980px]"
      >
        <CasesRosterSection
          title={t.cases_roster}
          subtitle={t.cases_subtitle}
          counterLabel={
            linkedCasesLoading
              ? t.patients_syncing
              : `${linkedCasesItems.length} ${t.patients_records}`
          }
          loading={linkedCasesLoading}
          loadingLabel={appointmentText(
            "Falle werden geladen",
            "Загрузка кейсов",
            "Loading cases",
          )}
          error={linkedCasesError}
          renderError={(message) => <Banner tone="error" withIcon>{message}</Banner>}
          items={linkedCasesItems}
          onCaseClick={(item) => {
            if (!item.id) return;
            setLinkedCasePreviewId(item.id);
            setLinkedCasePreviewOpen(true);
          }}
          emptyState={
            <EmptyCell>
              {appointmentText(
                "Keine Falle fur diesen Patienten.",
                "Для этого пациента нет кейсов.",
                "No cases for this patient.",
              )}
            </EmptyCell>
          }
          caseStatusLabel={(status) => status.replaceAll("_", " ")}
          reasonLabel={t.cases_reason}
          createdLabel={t.users_created}
          notSetLabel={t.common_not_set}
          formatDateTimeLabel={formatDateTimeLabel}
          showHeader={false}
        />
      </AppointmentPreviewSheet>

      <CaseWorkspaceModal
        caseId={linkedCasePreviewId || null}
        patientId={detail?.patient_id ?? null}
        open={linkedCasePreviewOpen}
        onOpenChange={handleLinkedCasePreviewOpenChange}
      />

      <AppointmentPreviewSheet
        open={linkedDocumentsOpen}
        onOpenChange={handleLinkedDocumentsOpenChange}
        title={appointmentText("Dokumente", "Документы", "Documents")}
        description={appointmentText(
          "Dokumente aus dem aktuellen Termin-Kontext.",
          "Документы из контекста текущего приёма.",
          "Documents from the current appointment context.",
        )}
        maxWidthClassName="sm:max-w-[760px]"
        bodyClassName="px-4 pb-6 pt-4"
      >
        {linkedDocumentsLoading ? (
          <div className="flex min-h-[220px] items-center justify-center text-sm text-muted-foreground">
            <LoaderCircle className="mr-2 size-4 animate-spin" />
            {appointmentText(
              "Dokumente werden geladen",
              "Загрузка документов",
              "Loading documents",
            )}
          </div>
        ) : linkedDocumentsError ? (
          <Banner tone="error" withIcon>{linkedDocumentsError}</Banner>
        ) : linkedDocumentsItems.length === 0 ? (
          <EmptyCell>
            {appointmentText(
              "Keine Dokumente im aktuellen Kontext.",
              "В текущем контексте нет документов.",
              "No documents in this context.",
            )}
          </EmptyCell>
        ) : (
          <DocumentsGrid
            documents={linkedDocumentsItems.map((item) => ({
              ...item,
              is_latest_version: item.version_number >= item.version_count,
              needs_categorization: false,
              data_sensitivity: "standard",
            }))}
            showSelection={false}
            selectedDocumentIds={linkedDocumentSelectedIds}
            selectedId={null}
            labels={{
              selectBulkShare: t.documents_select_bulk_share,
              filename: t.documents_filename,
              patient: t.orders_patient,
              category: t.documents_category,
              status: t.users_status,
              visibility: appointmentText("Sichtbarkeit", "Видимость", "Visibility"),
              size: t.documents_size,
              uploadedBy: t.documents_uploaded_by,
              unclassified: t.documents_unclassified,
              current: appointmentText("aktuell", "текущая", "current"),
              pidFallback: "PID",
              notSet: t.common_not_set,
              unknownUploader: t.documents_unknown_uploader,
              needsCategorization: appointmentText(
                "Kategorisierung erforderlich",
                "Требуется категоризация",
                "Needs categorization",
              ),
            }}
            localizeCode={(value) => localizeDocumentCode(value, appointmentText)}
            onSelectionChange={setLinkedDocumentSelectedIds}
            onToggleSelection={(id, checked) =>
              setLinkedDocumentSelectedIds((current) =>
                checked
                  ? current.includes(id)
                    ? current
                    : [...current, id]
                  : current.filter((itemId) => itemId !== id),
              )
            }
            onOpenDocument={() => {}}
            statusBadge={linkedDocumentStatusBadge}
            visibilityBadge={linkedDocumentVisibilityBadge}
            sensitivityBadge={linkedDocumentSensitivityBadge}
            formatStatusLabel={(value) => value}
            formatVisibilityLabel={(value) => value}
            formatSensitivityLabel={() =>
              appointmentText("Standard", "Стандарт", "Standard")
            }
            formatFileSize={formatDocumentFileSize}
            formatDateTime={formatDateTimeLabel}
          />
        )}
      </AppointmentPreviewSheet>

      <AppointmentPreviewSheet
        open={linkedPreviewOpen}
        onOpenChange={handleLinkedPreviewOpenChange}
        title={
          linkedPreviewLabel ||
          appointmentText("Verknupfte Daten", "Связанные данные", "Linked records")
        }
        maxWidthClassName="sm:max-w-[540px]"
        bodyClassName="px-4 pb-6 pt-4"
      >
        {renderLinkedPreviewContent()}
      </AppointmentPreviewSheet>

      {isMobile ? (
      <Sheet
        open={detailOpen}
        onOpenChange={(open) => {
          if (open) {
            setDetailOpen(true);
            return;
          }
          closeDetailWorkspace();
        }}
      >
        {shouldRenderDetailSheetContent ? (
        <SheetContent side="right" className="w-full gap-0 sm:max-w-[860px]">
          <div className="flex flex-col flex-1 min-h-0">
            <SheetHeader className="px-4 py-3">
              <SheetTitle>{tr.appointments_title}</SheetTitle>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto overscroll-y-contain px-4 pb-6 pt-4">
            {detailLoading ? (
              <div className="flex min-h-[320px] items-center justify-center text-muted-foreground">
                <LoaderCircle className="mr-2 size-4 animate-spin" />
                {appointmentText(
                  "Termin wird geladen",
                  "Загрузка приёма",
                  "Loading appointment",
                )}
              </div>
            ) : detailError ? (
              <div className="pt-5">
                <Banner tone="error" withIcon>{detailError}</Banner>
              </div>
            ) : detail ? (
              <div className="space-y-6 pt-5">
                <MemoizedAppointmentOverviewSection
                  detail={detail}
                  onOpenDetail={openDetailSheet}
                />
                <MemoizedAppointmentSnapshotSection detail={detail} />
                {detailAttention ? (
                  <MemoizedAppointmentAttentionSection
                    attention={detailAttention}
                  />
                ) : null}
                <MemoizedAppointmentLinksSection
                  detail={detail}
                  onOpenPreview={openLinkedPreview}
                />
                <MemoizedAppointmentTimelineSection
                  key={`${detail.id}:${detailVersion}`}
                  timelineEvents={timelineEvents}
                />
                {!detail.is_blocked ? (
                  <MemoizedAppointmentHandoffSection
                    detail={detail}
                    handoffStakeholders={handoffStakeholders}
                    followUpAssigneeId={followUpAssigneeId}
                    setFollowUpAssigneeId={setFollowUpAssigneeId}
                    canManageReminders={permissions.canManageReminders}
                    onRefresh={refreshDetail}
                    onError={reportDetailError}
                  />
                ) : null}
                {!detail.is_blocked && permissions.canCreate ? (
                  <MemoizedAppointmentFollowUpVisitSection
                    detail={detail}
                    appointments={appointments}
                    providers={providers}
                    staff={staff}
                    interpreters={interpreters}
                    defaultReminderUserId={detailDefaultAssigneeId}
                    onCreated={handleFollowUpVisitCreated}
                  />
                ) : null}
                {!detail.is_blocked && permissions.canViewReminders ? (
                  <MemoizedAppointmentDoctorFollowUpSection
                    detail={detail}
                    reminders={doctorDirectedReminders}
                    tasks={doctorDirectedTasks}
                    assignees={doctorFollowUpAssignees}
                    defaultAssigneeId={detailDefaultAssigneeId}
                    canManageReminders={permissions.canManageReminders}
                    canCreateTasks={permissions.canCreateTasks}
                    onRefresh={refreshDetail}
                    onError={reportDetailError}
                  />
                ) : null}
                {!detail.is_blocked &&
                permissions.canManageChecklist &&
                permissions.canViewReminders ? (
                  <MemoizedAppointmentIncomingDataSection
                    detail={detail}
                    checklist={incomingDataChecklist}
                    reminders={incomingDataReminders}
                    tasks={incomingDataTasks}
                    assignees={doctorFollowUpAssignees}
                    defaultAssigneeId={detailDefaultAssigneeId}
                    canCreateTasks={permissions.canCreateTasks}
                    onRefresh={refreshDetail}
                    onError={reportDetailError}
                  />
                ) : null}
                {!detail.is_blocked &&
                permissions.canViewReminders &&
                detail.order_id ? (
                  <MemoizedAppointmentPackageEndSection
                    detail={detail}
                    reminders={packageEndReminders}
                    tasks={packageEndTasks}
                    assignees={doctorFollowUpAssignees}
                    defaultAssigneeId={detailDefaultAssigneeId}
                    defaultTitle={tr.appointments_new ?? ""}
                    canManageReminders={permissions.canManageReminders}
                    canCreateTasks={permissions.canCreateTasks}
                    onRefresh={refreshDetail}
                    onError={reportDetailError}
                  />
                ) : null}
                {!detail.is_blocked &&
                permissions.canViewCommunications &&
                (detail.provider_id || detail.doctor_id) ? (
                  <MemoizedAppointmentExternalHandoffSection
                    detail={detail}
                    communications={externalCommunicationEntries}
                    reminders={externalHandoffReminders}
                    tasks={externalHandoffTasks}
                    assignees={doctorFollowUpAssignees}
                    defaultAssigneeId={detailDefaultAssigneeId}
                    canManageCommunications={permissions.canManageCommunications}
                    canViewReminders={permissions.canViewReminders}
                    canCreateTasks={permissions.canCreateTasks}
                    onRefresh={refreshDetail}
                    onError={reportDetailError}
                  />
                ) : null}
                {!detail.is_blocked &&
                permissions.canManageChecklist &&
                permissions.canViewReminders &&
                (detail.provider_id || detail.doctor_id) ? (
                  <MemoizedAppointmentFindingsSection
                    detail={detail}
                    checklist={findingsChecklist}
                    reminders={findingsReminders}
                    tasks={findingsTasks}
                    assignees={doctorFollowUpAssignees}
                    defaultAssigneeId={detailDefaultAssigneeId}
                    canCreateTasks={permissions.canCreateTasks}
                    onRefresh={refreshDetail}
                    onError={reportDetailError}
                  />
                ) : null}
                {permissions.canManageStatus ? (
                  <MemoizedAppointmentCompletionSection
                    detail={detail}
                    detailReport={detailReport}
                    handoffStakeholders={handoffStakeholders}
                    openChecklistCount={openChecklistCount}
                    openTaskCount={openTaskCount}
                    pendingReminderCount={pendingReminderCount}
                    interpreterReportReady={interpreterReportReady}
                    completionWarnings={completionWarnings}
                    followUpAssigneeId={followUpAssigneeId}
                    setFollowUpAssigneeId={setFollowUpAssigneeId}
                    onRefresh={refreshDetail}
                    onError={reportDetailError}
                    onNotice={reportAppointmentsNotice}
                  />
                ) : null}
                {permissions.canManageStatus ? (
                  <MemoizedAppointmentStatusSection
                    detail={detail}
                    openChecklistCount={openChecklistCount}
                    onRefresh={refreshDetail}
                    onError={reportDetailError}
                  />
                ) : null}
                {permissions.canEditSchedule ? (
                  <MemoizedEditAppointmentSection
                    detail={detail}
                    appointments={appointments}
                    providers={providers}
                    staff={staff}
                    interpreters={interpreters}
                    onSaved={handleEditSaved}
                  />
                ) : null}
                <MemoizedAppointmentInterpreterSection
                  detail={detail}
                  interpreters={interpreters}
                  currentUserId={user?.id}
                  canAssign={permissions.canAssignInterpreter}
                  canRespond={permissions.canRespondToAssignment}
                  onRefresh={refreshDetail}
                  onError={reportDetailError}
                />
                {permissions.canManageChecklist ? (
                  <MemoizedAppointmentChecklistSection
                    detail={detail}
                    items={detailChecklist}
                    onRefresh={refreshDetail}
                    onError={reportDetailError}
                  />
                ) : null}
                {permissions.canViewReminders ? (
                  <MemoizedAppointmentRemindersSection
                    detail={detail}
                    reminders={detailReminders}
                    staff={staff}
                    canManageReminders={permissions.canManageReminders}
                    onRefresh={refreshDetail}
                    onError={reportDetailError}
                  />
                ) : null}
                {permissions.canViewReport ? (
                  <MemoizedAppointmentReportSection
                    detail={detail}
                    detailReport={detailReport}
                    reportReviewMeta={reportReviewMeta}
                    canSubmitInterpreterReport={canSubmitInterpreterReport}
                    canResubmitRejectedReport={canResubmitRejectedReport}
                    showReportReviewActions={showReportReviewActions}
                    canApproveReport={permissions.canApproveReport}
                    canRejectReport={permissions.canRejectReport}
                    onRefresh={refreshDetail}
                    onError={reportDetailError}
                  />
                ) : null}
                {permissions.canViewTasks ? (
                  <MemoizedAppointmentTasksSection
                    detail={detail}
                    tasks={detailTasks}
                    assignableStaff={taskAssignableStaff}
                    canCreateTasks={permissions.canCreateTasks}
                    onRefresh={refreshDetail}
                    onError={reportDetailError}
                  />
                ) : null}
                {canShowConciergeSection ? (
                  <MemoizedAppointmentConciergeSection
                    detail={detail}
                    services={detailServices}
                    nonMedicalProviders={nonMedicalProviders}
                    conciergeStaff={conciergeStaff}
                    canManageConciergeServices={
                      permissions.canManageConciergeServices
                    }
                    canManageConciergeBilling={permissions.canManageConciergeBilling}
                    onRefresh={refreshDetail}
                    onError={reportDetailError}
                  />
                ) : null}
                {canShowBillingHandoffSection ? (
                  <MemoizedAppointmentBillingHandoffSection
                    detail={detail}
                    detailReport={detailReport}
                    reportReviewMeta={reportReviewMeta}
                    interpreterReportReady={interpreterReportReady}
                    serviceCount={detailServices.length}
                    billingStaff={billingStaff}
                    reminders={billingHandoffReminders}
                    tasks={billingHandoffTasks}
                    openTasks={openBillingHandoffTasks}
                    readyServices={readyConciergeServices}
                    settledServices={settledConciergeServices}
                    warnings={billingReadinessWarnings}
                    canManageConciergeBilling={permissions.canManageConciergeBilling}
                    canCreateTasks={permissions.canCreateTasks}
                    onRefresh={refreshDetail}
                    onError={reportDetailError}
                  />
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
                {appointmentText(
                  "Termin im Kalender oder in der Liste auswahlen.",
                  "Выберите приём в календаре или списке.",
                  "Select an appointment from the calendar or list.",
                )}
              </div>
            )}
            </div>
          </div>
        </SheetContent>
        ) : null}
      </Sheet>
      ) : null}
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
          {appointmentText("Öffnen", "Открыть", "Open")}
        </Button>
      </div>
    </div>
  );
}

function ContextCard({
  label,
  value,
  meta,
  variant = "default",
}: {
  label: string;
  value: string;
  meta: string;
  variant?: "default" | "snapshot";
}) {
  const isSnapshot = variant === "snapshot";
  return (
    <div
      className={cn(
        isSnapshot ? "min-w-0" : "rounded-xl border border-border/50 bg-card px-4 py-3",
      )}
    >
      <p
        className={cn(
          "font-medium text-muted-foreground",
          isSnapshot ? "text-[11.5px] leading-tight" : "text-[11.5px] leading-tight",
        )}
      >
        {label}
      </p>
      <p
        className={cn(
          "break-words",
          isSnapshot
            ? "mt-0.5 text-sm font-semibold text-slate-900 leading-tight"
            : "mt-2 text-sm font-semibold text-foreground",
        )}
      >
        {value}
      </p>
      <p
        className={cn(
          isSnapshot
            ? "mt-0.5 text-sm text-slate-600 leading-tight"
            : "mt-1 text-xs text-muted-foreground",
        )}
      >
        {meta}
      </p>
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
    <div className="inline-flex items-center gap-2 text-foreground">
      <Icon className="size-4 text-muted-foreground" />
      <span className="truncate">{label}</span>
    </div>
  );
}

function TextPanel({ title, text }: { title: string; text: string | null }) {
  return (
    <div className="rounded-xl border border-border/50 bg-card px-4 py-3">
      <p className="text-[11.5px] font-medium text-muted-foreground leading-tight">
        {title}
      </p>
      <p className="mt-2 text-sm leading-6 text-foreground">
        {text?.trim() ||
          appointmentText(
            "Noch keine Notizen erfasst.",
            "Заметки пока не зафиксированы.",
            "No notes captured yet.",
          )}
      </p>
    </div>
  );
}

function ConflictPanel({ conflicts }: { conflicts: ConflictSummary | null }) {
  if (!conflicts) return null;
  const items = [
    ...conflicts.patient_conflicts.map((item) => ({
      ...item,
      scope: appointmentText("Patient", "Пациент", "Patient"),
    })),
    ...conflicts.interpreter_conflicts.map((item) => ({
      ...item,
      scope: appointmentText("Dolmetscher", "Переводчик", "Interpreter"),
    })),
  ].slice(0, 6);
  if (!conflicts.has_conflicts)
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
        {appointmentText(
          "Für dieses Zeitfenster wurden keine Patienten- oder Dolmetscherüberschneidungen gefunden.",
          "Для этого слота не найдено пересечений по пациенту или переводчику.",
          "No patient or interpreter overlaps detected for the current slot.",
        )}
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
            {appointmentText(
              "Überschneidung(en) erkannt",
              "Обнаружены пересечения",
              "Overlap(s) detected",
            )}
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
