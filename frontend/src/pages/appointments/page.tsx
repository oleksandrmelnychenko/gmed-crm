import {
  Suspense,
  lazy,
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
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
  UsersRound,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  type CaseRosterItem,
} from "@/components/cases-roster-section";
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
  inputClass,
  tokens,
} from "@/components/ui-shell";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  buildInterpreterMobileAgendaSections,
  buildAppointmentTimelineEvents,
  canResubmitInterpreterReport,
  normalizeAppointmentWorkspaceTab,
  shouldUseInterpreterMobileAgenda,
} from "@/pages/appointments.helpers";
import {
  appointmentPermissions,
  linkedPatientPermissions,
} from "@/pages/appointments/model/selectors";
import {
  currentDateInput,
  endOfWeekInput,
  readStoredCalendarDate,
  readStoredCalendarView,
  startOfWeekInput,
  toDateInput,
  toTimeInput,
} from "@/pages/appointments/model/date-time";
import {
  APPOINTMENT_DETAIL_RESOURCE_GROUPS,
  getRequiredAppointmentDetailResourceGroups,
  type AppointmentDetailResourceGroup,
} from "@/pages/appointments/model/detail-resource-needs";
import {
  formatAppointmentDateTimeLabel as formatDateTimeLabel,
  formatAppointmentSlotLabel as slotLabel,
} from "@/pages/appointments/model/runtime-formatters";
import {
  blankAppointmentForm,
  resolveFollowUpDefaultAssignee,
  statusActionKey,
} from "@/pages/appointments/model/form-factories";
import {
  buildAppointmentsQuery,
  sortLinkedDocuments,
} from "@/pages/appointments/model/query-builders";
import { fetchAppointmentDetailResourceGroup } from "@/pages/appointments/data/detail-resource-groups";
import { getProviderDoctors } from "@/pages/appointments/data/provider-doctors";
import { normalizeLinkedPreviewPayload } from "@/pages/appointments/model/linked-preview";
import {
  matchesOperationalScope,
  operationalScopeOptions,
} from "@/pages/appointments/model/operational-scopes";
import {
  appointmentText,
  appointmentTypeLabel,
  responseLabel,
  statusLabel,
} from "@/pages/appointments/model/labels";
import {
  buildLocalScheduleWarnings,
  buildScheduleNotice,
} from "@/pages/appointments/model/schedule-warnings";
import {
  buildHandoffStakeholders,
} from "@/pages/appointments/model/workflow-helpers";
import {
  recurrenceCadenceLabel,
} from "@/pages/appointments/model/recurrence";
import { appointmentStatusBadgeClassName } from "@/pages/appointments/appearance/status-appearance";
import {
  AppointmentPreviewSheetLoadingState,
  AptKpi,
  EmptyState,
  Field,
} from "@/pages/appointments/ui/shared/workspace-primitives";
import type {
  AppointmentAttentionItem,
  AppointmentCommunicationEntry,
  AppointmentDetail,
  AppointmentFormState,
  AppointmentListItem,
  AppointmentRecurringActionScope,
  AppointmentStatus,
  CalendarEventExtendedProps,
  CalendarQuickActionMenuState,
  CalendarView,
  ChecklistItem,
  ConciergeServiceEntry,
  ConflictSummary,
  DoctorOption,
  FiltersState,
  HandoffStakeholder,
  InterpreterOption,
  LinkedDocumentItem,
  LinkedPreviewKind,
  LinkedPreviewPayload,
  OperationalScope,
  PatientAssignment,
  PatientSummary,
  ProviderSummary,
  ReminderEntry,
  ReportSummary,
  SchedulerQuickScope,
  StaffOption,
  TaskEntry,
} from "@/pages/appointments/model/types";
import {
  BILLING_HANDOFF_PREFIX,
  CALENDAR_STORAGE_DATE_KEY,
  CALENDAR_STORAGE_VIEW_KEY,
  DOCTOR_FOLLOW_UP_PREFIX,
  EXTERNAL_HANDOFF_PREFIX,
  FINDINGS_CHECKLIST_PREFIX,
  FINDINGS_FOLLOW_UP_PREFIX,
  INCOMING_DATA_CHECKLIST_PREFIX,
  INCOMING_DATA_PREFIX,
  PACKAGE_END_FOLLOW_UP_PREFIX,
} from "@/pages/appointments/model/constants";
import {
  type PatientAssignment as PatientSheetAssignment,
  type PatientDetail as PatientSheetDetail,
  type PatientsDictionary,
  type StaffOption as PatientSheetStaffOption,
} from "@/pages/patients";
import { type ProviderDetail as ProviderSheetDetail } from "@/pages/providers";

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
const EMPTY_DETAIL_DERIVED_STATE = {
  handoffStakeholders: [] as HandoffStakeholder[],
  openChecklistCount: 0,
  openTaskCount: 0,
  pendingReminderCount: 0,
  doctorDirectedReminders: [] as ReminderEntry[],
  doctorDirectedTasks: [] as TaskEntry[],
  packageEndReminders: [] as ReminderEntry[],
  packageEndTasks: [] as TaskEntry[],
  externalCommunicationEntries: [] as AppointmentCommunicationEntry[],
  externalHandoffReminders: [] as ReminderEntry[],
  externalHandoffTasks: [] as TaskEntry[],
  billingHandoffReminders: [] as ReminderEntry[],
  billingHandoffTasks: [] as TaskEntry[],
  canShowBillingHandoffSection: false,
  findingsChecklist: [] as ChecklistItem[],
  findingsReminders: [] as ReminderEntry[],
  findingsTasks: [] as TaskEntry[],
  incomingDataChecklist: [] as ChecklistItem[],
  incomingDataReminders: [] as ReminderEntry[],
  incomingDataTasks: [] as TaskEntry[],
  doctorFollowUpAssignees: [] as StaffOption[],
  interpreterReportReady: true,
  readyConciergeServices: [] as ConciergeServiceEntry[],
  settledConciergeServices: [] as ConciergeServiceEntry[],
  openBillingHandoffTasks: [] as TaskEntry[],
  billingReadinessWarnings: [] as string[],
  completionWarnings: [] as string[],
};

function createDetailResourceKeyState() {
  return APPOINTMENT_DETAIL_RESOURCE_GROUPS.reduce<
    Record<AppointmentDetailResourceGroup, string>
  >(
    (state, group) => {
      state[group] = "";
      return state;
    },
    {
      checklist: "",
      reminders: "",
      report: "",
      tasks: "",
      services: "",
      communications: "",
    },
  );
}

const loadLinkedProviderSheet = () =>
  import("@/pages/appointments/ui/sheets/linked-provider-sheet");
const loadLinkedCasesSheet = () =>
  import("@/pages/appointments/ui/sheets/linked-cases-sheet");
const loadLinkedDocumentsSheet = () =>
  import("@/pages/appointments/ui/sheets/linked-documents-sheet");
const loadLinkedRecordsSheet = () =>
  import("@/pages/appointments/ui/sheets/linked-records-sheet");
const loadCreateAppointmentSheet = () =>
  import("@/pages/appointments/ui/sheets/create-appointment-sheet");
const loadDesktopDetailWorkspaceContent = () =>
  import("@/pages/appointments/ui/workspace/desktop-detail-workspace-content");
const loadMobileDetailSheetContent = () =>
  import("@/pages/appointments/ui/sheets/mobile-detail-sheet-content");
const loadSearchSheet = () =>
  import("@/pages/appointments/ui/sheets/search-sheet");
const loadQueueSheet = () =>
  import("@/pages/appointments/ui/sheets/queue-sheet");
const loadPatientDetailSheet = () => import("@/pages/patients");
const loadPatientAppointmentsPage = () =>
  import("@/pages/patient-appointments");

const LazyLinkedProviderSheet = lazy(async () => {
  const mod = await loadLinkedProviderSheet();
  return { default: mod.MemoizedLinkedProviderSheet };
});

const LazyLinkedCasesSheet = lazy(async () => {
  const mod = await loadLinkedCasesSheet();
  return { default: mod.MemoizedLinkedCasesSheet };
});

const LazyLinkedDocumentsSheet = lazy(async () => {
  const mod = await loadLinkedDocumentsSheet();
  return { default: mod.MemoizedLinkedDocumentsSheet };
});

const LazyLinkedRecordsSheet = lazy(async () => {
  const mod = await loadLinkedRecordsSheet();
  return { default: mod.MemoizedLinkedRecordsSheet };
});

const LazyCreateAppointmentSheet = lazy(async () => {
  const mod = await loadCreateAppointmentSheet();
  return { default: mod.MemoizedCreateAppointmentSheet };
});

const LazyDesktopDetailWorkspaceContent = lazy(async () => {
  const mod = await loadDesktopDetailWorkspaceContent();
  return { default: mod.MemoizedAppointmentDesktopDetailWorkspaceContent };
});

const LazyMobileDetailSheetContent = lazy(async () => {
  const mod = await loadMobileDetailSheetContent();
  return { default: mod.MemoizedAppointmentMobileDetailSheetContent };
});

const LazySearchSheet = lazy(async () => {
  const mod = await loadSearchSheet();
  return { default: mod.MemoizedSearchSheet };
});

const LazyQueueSheet = lazy(async () => {
  const mod = await loadQueueSheet();
  return { default: mod.MemoizedQueueSheet };
});

const LazyPatientDetailSheet = lazy(async () => {
  const mod = await loadPatientDetailSheet();
  return { default: mod.MemoizedPatientDetailSheet };
});

const LazyPatientAppointmentsPage = lazy(async () => {
  const mod = await loadPatientAppointmentsPage();
  return { default: mod.PatientAppointmentsPage };
});

const createSheetInputClassName = inputClass;

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
  const [detailResourceKeys, setDetailResourceKeys] = useState(() =>
    createDetailResourceKeyState(),
  );
  const detailResourceRequestKeysRef = useRef(createDetailResourceKeyState());
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
  const currentDetailResourceKey = useMemo(
    () => (selectedId ? `${selectedId}:${detailVersion}` : ""),
    [detailVersion, selectedId],
  );
  const requiredDetailResourceGroups = getRequiredAppointmentDetailResourceGroups(
    detailTab,
    isMobile,
    permissions,
  );
  const missingDetailResourceGroups = useMemo(
    () =>
      requiredDetailResourceGroups.filter(
        (group) => detailResourceKeys[group] !== currentDetailResourceKey,
      ),
    [currentDetailResourceKey, detailResourceKeys, requiredDetailResourceGroups],
  );
  const requiresExtendedDetailResources =
    detailOpen && Boolean(selectedId) && requiredDetailResourceGroups.length > 0;
  const detailExtendedLoading =
    requiresExtendedDetailResources && missingDetailResourceGroups.length > 0;
  const detailExtendedResourcesReady =
    !requiresExtendedDetailResources || missingDetailResourceGroups.length === 0;
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
  const [linkedDocumentsOpen, setLinkedDocumentsOpen] = useState(false);
  const [linkedDocumentsLoading, setLinkedDocumentsLoading] = useState(false);
  const [linkedDocumentsError, setLinkedDocumentsError] = useState("");
  const [linkedDocumentsItems, setLinkedDocumentsItems] = useState<
    LinkedDocumentItem[]
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
  const shouldBuildExtendedDetailDerivedState =
    Boolean(detail) &&
    (isMobile ||
      detailTab === "coordination" ||
      detailTab === "clinical" ||
      detailTab === "workflow" ||
      detailTab === "services");
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
    if (!shouldBuildExtendedDetailDerivedState) {
      return EMPTY_DETAIL_DERIVED_STATE;
    }

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
      detail?.interpreter_id && !interpreterReportReady
        ? appointmentText(
            "Die Abrechnung wartet auf einen freigegebenen Dolmetscherbericht.",
            "Биллинг ждёт согласованный отчёт переводчика.",
            "Billing is waiting for an approved interpreter report.",
          )
        : "",
      detail?.type === "non_medical" && serviceInFlightCount > 0
        ? appointmentText(
            `${serviceInFlightCount} Concierge-Leistung(en) sind operativ noch offen.`,
            `${serviceInFlightCount} concierge-услуг(а) ещё операционно открыты.`,
            `${serviceInFlightCount} concierge service(s) are still operationally open.`,
          )
        : "",
      detail?.type === "non_medical" &&
      detailServices.length > 0 &&
      readyConciergeServices.length === 0 &&
      settledConciergeServices.length === 0
        ? appointmentText(
            "Concierge-Leistungen sind noch keinem Billing-Status zugeordnet.",
            "У concierge-услуг ещё нет статуса биллинга.",
            "Concierge services are not assigned to a billing status yet.",
          )
        : "",
      billingStaff.length === 0
        ? appointmentText(
            "Kein Billing-Team für die Übergabe verfügbar.",
            "Нет команды биллинга для handoff.",
            "No billing team is available for handoff.",
          )
        : "",
    ].filter(Boolean);
    const completionWarnings = [
      openChecklistCount > 0
        ? appointmentText(
            `${openChecklistCount} Checklistenpunkt(e) sind noch offen.`,
            `${openChecklistCount} пункт(ов) чек-листа ещё открыты.`,
            `${openChecklistCount} checklist item(s) are still open.`,
          )
        : "",
      openIncomingDataChecklistCount > 0
        ? appointmentText(
            `${openIncomingDataChecklistCount} Intake-Punkt(e) brauchen noch Triage.`,
            `${openIncomingDataChecklistCount} intake-пункт(ов) ещё ждут triage.`,
            `${openIncomingDataChecklistCount} incoming data item(s) still need triage.`,
          )
        : "",
      openTaskCount > 0
        ? appointmentText(
            `${openTaskCount} operative Aufgabe(n) sind noch offen.`,
            `${openTaskCount} операционных задач(и) ещё открыты.`,
            `${openTaskCount} operational task(s) are still open.`,
          )
        : "",
      !interpreterReportReady && detail?.interpreter_id
        ? appointmentText(
            "Dolmetscherbericht oder Freigabe ist noch ausstehend.",
            "Отчёт переводчика или согласование ещё ожидается.",
            "Interpreter report or approval is still pending.",
          )
        : "",
      detail?.type === "non_medical" && serviceInFlightCount > 0
        ? appointmentText(
            `${serviceInFlightCount} Concierge-Leistung(en) laufen noch.`,
            `${serviceInFlightCount} concierge-услуг(а) ещё в работе.`,
            `${serviceInFlightCount} concierge service(s) are still in progress.`,
          )
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
      tr.patients_assign_owner,
      tr.role_interpreter,
      shouldBuildExtendedDetailDerivedState,
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
  const shouldBuildTimelineEvents =
    detailOpen && (isMobile || detailTab === "timeline");
  const timelineEvents = useMemo(
    () =>
      shouldBuildTimelineEvents
        ? buildAppointmentTimelineEvents({
            detail,
            checklist: detailChecklist,
            reminders: detailReminders,
            tasks: detailTasks,
            services: detailServices,
            report: detailReport,
            communications: detailCommunications,
            labels: timelineLabels,
          })
        : [],
    [
      detail,
      detailChecklist,
      detailCommunications,
      detailReminders,
      detailReport,
      detailServices,
      detailTasks,
      shouldBuildTimelineEvents,
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
  const resetSearchFilters = useCallback(() => {
    setOperationalScope("all");
    setFilters(DEFAULT_FILTERS);
    syncQuery({
      patient: null,
      provider: null,
      doctor: null,
      appointment: null,
      detailTab: null,
    });
  }, [syncQuery]);
  const handleSearchPatientChange = useCallback(
    (patientId: string) => {
      setFilters((current) => ({ ...current, patientId }));
      syncQuery({ patient: patientId || null });
    },
    [syncQuery],
  );
  const handleSearchProviderChange = useCallback(
    (providerId: string) => {
      setFilters((current) => ({
        ...current,
        providerId,
        doctorId: "",
      }));
      syncQuery({
        provider: providerId || null,
        doctor: null,
      });
    },
    [syncQuery],
  );
  const handleSearchDoctorChange = useCallback(
    (doctorId: string) => {
      setFilters((current) => ({ ...current, doctorId }));
      syncQuery({ doctor: doctorId || null });
    },
    [syncQuery],
  );

  const closeDetailWorkspace = useCallback(
    (clearQuery = true) => {
      setDetailOpen(false);
      setSelectedId("");
      setDetailLoading(false);
      detailResourceRequestKeysRef.current = createDetailResourceKeyState();
      setDetailResourceKeys(createDetailResourceKeyState());
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
      void loadCreateAppointmentSheet();
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
      detailResourceRequestKeysRef.current = createDetailResourceKeyState();
      setDetailResourceKeys(createDetailResourceKeyState());
      setDetailError("");
      try {
        const appointmentDetail = await apiFetch<AppointmentDetail>(
          `/appointments/${selectedId}`,
        );
        const assignments =
          appointmentDetail.is_blocked || !permissions.canViewNotes
            ? []
            : await apiFetch<PatientAssignment[]>(
                `/patients/${appointmentDetail.patient_id}/assignments`,
              ).catch(() => []);
        if (!active) return;
        setDetail(appointmentDetail);
        setDetailAssignments(assignments);
        setDetailChecklist([]);
        setDetailReminders([]);
        setDetailReport(null);
        setDetailTasks([]);
        setDetailServices([]);
        setDetailCommunications([]);
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
    permissions.canViewNotes,
  ]);

  useEffect(() => {
    if (
      !selectedId ||
      !detailOpen ||
      detailLoading ||
      detailError ||
      !detail ||
      !requiresExtendedDetailResources ||
      missingDetailResourceGroups.length === 0
    ) {
      return;
    }

    const pendingGroups = missingDetailResourceGroups.filter(
      (group) =>
        detailResourceRequestKeysRef.current[group] !== currentDetailResourceKey,
    );
    if (pendingGroups.length === 0) {
      return;
    }

    let active = true;

    async function loadExtendedDetailResources() {
      for (const group of pendingGroups) {
        detailResourceRequestKeysRef.current[group] = currentDetailResourceKey;
      }

      const results = await Promise.allSettled(
        pendingGroups.map((group) =>
          fetchAppointmentDetailResourceGroup(group, selectedId),
        ),
      );

      if (!active) {
        return;
      }

      const loadedGroups: AppointmentDetailResourceGroup[] = [];
      let firstErrorMessage = "";

      for (const [index, result] of results.entries()) {
        const group = pendingGroups[index];
        if (result.status === "fulfilled") {
          loadedGroups.push(group);
          switch (result.value.group) {
            case "checklist":
              setDetailChecklist(result.value.value);
              break;
            case "reminders":
              setDetailReminders(result.value.value);
              break;
            case "report":
              setDetailReport(result.value.value);
              break;
            case "tasks":
              setDetailTasks(result.value.value);
              break;
            case "services":
              setDetailServices(result.value.value);
              break;
            case "communications":
              setDetailCommunications(result.value.value);
              break;
          }
          continue;
        }

        if (!firstErrorMessage) {
          firstErrorMessage =
            result.reason instanceof Error
              ? result.reason.message
              : appointmentText(
                  "Erweiterte Termindaten konnten nicht geladen werden.",
                  "Не удалось загрузить расширенные данные приёма.",
                  "Failed to load extended appointment data.",
                );
        }

        switch (group) {
          case "checklist":
            setDetailChecklist([]);
            break;
          case "reminders":
            setDetailReminders([]);
            break;
          case "report":
            setDetailReport(null);
            break;
          case "tasks":
            setDetailTasks([]);
            break;
          case "services":
            setDetailServices([]);
            break;
          case "communications":
            setDetailCommunications([]);
            break;
        }
      }

      if (loadedGroups.length > 0) {
        setDetailResourceKeys((current) => {
          const next = { ...current };
          for (const group of loadedGroups) {
            next[group] = currentDetailResourceKey;
          }
          return next;
        });
      }
      for (const group of pendingGroups) {
        detailResourceRequestKeysRef.current[group] = "";
      }
      if (firstErrorMessage) {
        setDetailError(firstErrorMessage);
      }
    }

    void loadExtendedDetailResources();
    return () => {
      active = false;
      for (const group of pendingGroups) {
        if (detailResourceRequestKeysRef.current[group] === currentDetailResourceKey) {
          detailResourceRequestKeysRef.current[group] = "";
        }
      }
    };
  }, [
    currentDetailResourceKey,
    detail,
    detailError,
    detailLoading,
    detailOpen,
    missingDetailResourceGroups,
    requiresExtendedDetailResources,
    selectedId,
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
    void loadCreateAppointmentSheet();
    setCreateOpen(true);
  }

  useEffect(() => {
    const handleRefreshRequest = () => {
      refreshAppointments();
    };
    const handleCreateRequest = () => {
      if (!permissions.canCreate) return;
      setCreateSeed(blankAppointmentForm());
      void loadCreateAppointmentSheet();
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
    void (isMobile
      ? loadMobileDetailSheetContent()
      : loadDesktopDetailWorkspaceContent());
    setCalendarQuickActionMenu(null);
    startTransition(() => {
      setSelectedId(id);
      setDetailOpen(true);
    });
    syncQuery({
      appointment: id,
      detailTab: "overview",
    });
  }, [isMobile, syncQuery]);

  const openLinkedPreview = useCallback(
    (kind: LinkedPreviewKind, label: string) => {
      if (kind === "patient") {
        const patientId = detail?.patient_id ?? "";
        if (!patientId) return;
        void loadPatientDetailSheet();
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
        void loadLinkedProviderSheet();
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
        void loadLinkedCasesSheet();
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
        void loadLinkedDocumentsSheet();
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
      void loadLinkedRecordsSheet();
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
    }
  }, []);

  const handleLinkedDocumentsOpenChange = useCallback((open: boolean) => {
    setLinkedDocumentsOpen(open);
    if (!open) {
      setLinkedDocumentsLoading(false);
      setLinkedDocumentsError("");
      setLinkedDocumentsItems([]);
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

  return (
    <>
      {showInlineDetailWorkspace ? (
        <Suspense
          fallback={
            <div className="flex min-h-[320px] items-center justify-center text-muted-foreground">
              <LoaderCircle className="mr-2 size-4 animate-spin" />
              {appointmentText(
                "Arbeitsbereich wird geladen",
                "Загрузка workspace",
                "Loading workspace",
              )}
            </div>
          }
        >
          <LazyDesktopDetailWorkspaceContent
            detailLoading={detailLoading}
            detailError={detailError}
            detail={detail}
            detailVersion={detailVersion}
            detailTab={detailTab}
            extendedResourcesReady={detailExtendedResourcesReady}
            appointmentsNotice={appointmentsNotice}
            detailAttention={detailAttention}
            timelineEvents={timelineEvents}
            appointments={appointments}
            providers={providers}
            staff={staff}
            interpreters={interpreters}
            permissions={permissions}
            currentUserId={user?.id}
            detailDefaultAssigneeId={detailDefaultAssigneeId}
            doctorFollowUpAssignees={doctorFollowUpAssignees}
            handoffStakeholders={handoffStakeholders}
            followUpAssigneeId={followUpAssigneeId}
            setFollowUpAssigneeId={setFollowUpAssigneeId}
            detailChecklist={detailChecklist}
            detailReminders={detailReminders}
            detailTasks={detailTasks}
            taskAssignableStaff={taskAssignableStaff}
            detailServices={detailServices}
            detailReport={detailReport}
            doctorDirectedReminders={doctorDirectedReminders}
            doctorDirectedTasks={doctorDirectedTasks}
            incomingDataChecklist={incomingDataChecklist}
            incomingDataReminders={incomingDataReminders}
            incomingDataTasks={incomingDataTasks}
            packageEndReminders={packageEndReminders}
            packageEndTasks={packageEndTasks}
            externalCommunicationEntries={externalCommunicationEntries}
            externalHandoffReminders={externalHandoffReminders}
            externalHandoffTasks={externalHandoffTasks}
            findingsChecklist={findingsChecklist}
            findingsReminders={findingsReminders}
            findingsTasks={findingsTasks}
            openChecklistCount={openChecklistCount}
            openTaskCount={openTaskCount}
            pendingReminderCount={pendingReminderCount}
            interpreterReportReady={interpreterReportReady}
            completionWarnings={completionWarnings}
            reportReviewMeta={reportReviewMeta}
            canSubmitInterpreterReport={canSubmitInterpreterReport}
            canResubmitRejectedReport={canResubmitRejectedReport}
            showReportReviewActions={showReportReviewActions}
            canShowConciergeSection={canShowConciergeSection}
            canShowBillingHandoffSection={canShowBillingHandoffSection}
            nonMedicalProviders={nonMedicalProviders}
            conciergeStaff={conciergeStaff}
            billingStaff={billingStaff}
            billingHandoffReminders={billingHandoffReminders}
            billingHandoffTasks={billingHandoffTasks}
            openBillingHandoffTasks={openBillingHandoffTasks}
            readyConciergeServices={readyConciergeServices}
            settledConciergeServices={settledConciergeServices}
            billingReadinessWarnings={billingReadinessWarnings}
            onOpenDetail={openDetailSheet}
            onOpenPreview={openLinkedPreview}
            onRefresh={refreshDetail}
            onError={reportDetailError}
            onNotice={reportAppointmentsNotice}
            onEditSaved={handleEditSaved}
            onFollowUpVisitCreated={handleFollowUpVisitCreated}
          />
        </Suspense>
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
                <Suspense
                  fallback={
                    <AppointmentPreviewSheetLoadingState
                      open={searchModalOpen}
                      onOpenChange={setSearchModalOpen}
                      title={t.common_search}
                      maxWidthClassName="sm:max-w-[460px]"
                      loadingLabel={appointmentText(
                        "Suchfilter werden geladen",
                        "Загрузка фильтров поиска",
                        "Loading search filters",
                      )}
                    />
                  }
                >
                  <LazySearchSheet
                    open={searchModalOpen}
                    onOpenChange={setSearchModalOpen}
                    filters={filters}
                    setFilters={setFilters}
                    patients={patients}
                    providers={providers}
                    filterDoctors={filterDoctors}
                    staff={staff}
                    interpreters={interpreters}
                    onReset={resetSearchFilters}
                    onPatientChange={handleSearchPatientChange}
                    onProviderChange={handleSearchProviderChange}
                    onDoctorChange={handleSearchDoctorChange}
                  />
                </Suspense>
              ) : null}

              {shouldRenderQueueSheet ? (
                <Suspense
                  fallback={
                    <AppointmentPreviewSheetLoadingState
                      open={queueModalOpen}
                      onOpenChange={setQueueModalOpen}
                      title={t.appointments_title}
                      maxWidthClassName="sm:max-w-[640px]"
                      loadingLabel={appointmentText(
                        "Auftragswarteschlange wird geladen",
                        "Загрузка очереди приёмов",
                        "Loading appointment queue",
                      )}
                    />
                  }
                >
                  <LazyQueueSheet
                    open={queueModalOpen}
                    onOpenChange={setQueueModalOpen}
                    appointmentsLoading={appointmentsLoading}
                    metadataLoading={metadataLoading}
                    items={queueAppointments}
                    openDetailSheet={openDetailSheet}
                    operationalScope={operationalScope}
                    userRole={user?.role}
                    attentionIndex={attentionIndex}
                    canManageStatus={permissions.canManageStatus}
                    actionBusy={actionBusy}
                    onStatusChange={performStatusChange}
                  />
                </Suspense>
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
                      onClick={() => {
                        void loadSearchSheet();
                        setSearchModalOpen(true);
                      }}
                    >
                      {t.common_search.replace(/[.…]+$/u, "")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 shrink-0 rounded-full bg-transparent px-3 hover:cursor-pointer hover:bg-transparent"
                      onClick={() => {
                        void loadQueueSheet();
                        setQueueModalOpen(true);
                      }}
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

      {createOpen ? (
        <Suspense
          fallback={
            <AppointmentPreviewSheetLoadingState
              open={createOpen}
              onOpenChange={setCreateOpen}
              title={tr.appointments_new}
              maxWidthClassName="sm:max-w-[760px]"
              loadingLabel={appointmentText(
                "Terminformular wird geladen",
                "Загрузка формы приёма",
                "Loading appointment form",
              )}
            />
          }
        >
          <Sheet open={createOpen} onOpenChange={setCreateOpen}>
            <SheetContent side="right" className="w-full gap-0 sm:max-w-[760px]">
              <SheetHeader className="px-4 py-3">
                <SheetTitle>{tr.appointments_new}</SheetTitle>
              </SheetHeader>
              <LazyCreateAppointmentSheet
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
            </SheetContent>
          </Sheet>
        </Suspense>
      ) : null}

      {linkedPatientOpen ? (
        <Suspense
          fallback={
            <AppointmentPreviewSheetLoadingState
              open={linkedPatientOpen}
              onOpenChange={handleLinkedPatientOpenChange}
              title={appointmentText("Patient", "Пациент", "Patient")}
              maxWidthClassName="sm:max-w-[860px]"
              loadingLabel={appointmentText(
                "Patient wird geladen",
                "Загрузка пациента",
                "Loading patient",
              )}
            />
          }
        >
          <LazyPatientDetailSheet
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
        </Suspense>
      ) : null}

      {linkedProviderOpen ? (
        <Suspense
          fallback={
            <AppointmentPreviewSheetLoadingState
              open={linkedProviderOpen}
              onOpenChange={handleLinkedProviderOpenChange}
              title={linkedProviderDetail?.name || t.providers_detail}
              maxWidthClassName="sm:max-w-[920px]"
              loadingLabel={appointmentText(
                "Anbieter wird geladen",
                "Загрузка провайдера",
                "Loading provider",
              )}
            />
          }
        >
          <LazyLinkedProviderSheet
            open={linkedProviderOpen}
            onOpenChange={handleLinkedProviderOpenChange}
            detail={linkedProviderDetail}
            loading={linkedProviderDetailLoading}
            error={linkedProviderDetailError}
            fallbackTitle={t.providers_detail}
            formatDateTimeLabel={formatDateTimeLabel}
            onOpenPatient={(patientId) => {
              void loadPatientDetailSheet();
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
        </Suspense>
      ) : null}

      {linkedCasesOpen ? (
        <Suspense
          fallback={
            <AppointmentPreviewSheetLoadingState
              open={linkedCasesOpen}
              onOpenChange={handleLinkedCasesOpenChange}
              title={t.cases_roster}
              description={`${t.cases_subtitle} · ${t.patients_syncing}`}
              maxWidthClassName="sm:max-w-[980px]"
              loadingLabel={appointmentText(
                "Falle werden geladen",
                "Загрузка кейсов",
                "Loading cases",
              )}
            />
          }
        >
          <LazyLinkedCasesSheet
            open={linkedCasesOpen}
            onOpenChange={handleLinkedCasesOpenChange}
            loading={linkedCasesLoading}
            error={linkedCasesError}
            items={linkedCasesItems}
            patientId={detail?.patient_id ?? null}
            formatDateTimeLabel={formatDateTimeLabel}
          />
        </Suspense>
      ) : null}

      {linkedDocumentsOpen ? (
        <Suspense
          fallback={
            <AppointmentPreviewSheetLoadingState
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
              loadingLabel={appointmentText(
                "Dokumente werden geladen",
                "Загрузка документов",
                "Loading documents",
              )}
            />
          }
        >
          <LazyLinkedDocumentsSheet
            open={linkedDocumentsOpen}
            onOpenChange={handleLinkedDocumentsOpenChange}
            loading={linkedDocumentsLoading}
            error={linkedDocumentsError}
            items={linkedDocumentsItems}
            formatDateTime={formatDateTimeLabel}
          />
        </Suspense>
      ) : null}

      {linkedPreviewOpen ? (
        <Suspense
          fallback={
            <AppointmentPreviewSheetLoadingState
              open={linkedPreviewOpen}
              onOpenChange={handleLinkedPreviewOpenChange}
              title={
                linkedPreviewLabel ||
                appointmentText(
                  "Verknupfte Daten",
                  "Связанные данные",
                  "Linked records",
                )
              }
              maxWidthClassName="sm:max-w-[540px]"
              bodyClassName="px-4 pb-6 pt-4"
              loadingLabel={appointmentText(
                "Verknupfte Daten werden geladen…",
                "Загрузка связанных данных…",
                "Loading linked records…",
              )}
            />
          }
        >
          <LazyLinkedRecordsSheet
            open={linkedPreviewOpen}
            onOpenChange={handleLinkedPreviewOpenChange}
            title={
              linkedPreviewLabel ||
              appointmentText(
                "Verknupfte Daten",
                "Связанные данные",
                "Linked records",
              )
            }
            loading={linkedPreviewLoading}
            error={linkedPreviewError}
            payload={linkedPreviewPayload}
            kind={linkedPreviewKind}
          />
        </Suspense>
      ) : null}

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
          <Suspense
            fallback={
              <SheetContent side="right" className="w-full gap-0 sm:max-w-[860px]">
                <div className="flex flex-col flex-1 min-h-0">
                  <SheetHeader className="px-4 py-3">
                    <SheetTitle>{tr.appointments_title}</SheetTitle>
                  </SheetHeader>
                  <div className="flex flex-1 items-center justify-center px-4 pb-6 pt-4 text-muted-foreground">
                    <LoaderCircle className="mr-2 size-4 animate-spin" />
                    {appointmentText(
                      "Detailbereich wird geladen",
                      "Загрузка detail-блока",
                      "Loading detail workspace",
                    )}
                  </div>
                </div>
              </SheetContent>
            }
          >
            <LazyMobileDetailSheetContent
              detailLoading={
                detailLoading ||
                (requiresExtendedDetailResources && detailExtendedLoading)
              }
              detailError={detailError}
              detail={detail}
              detailVersion={detailVersion}
              detailAttention={detailAttention}
              timelineEvents={timelineEvents}
              appointments={appointments}
              providers={providers}
              staff={staff}
              interpreters={interpreters}
              permissions={permissions}
              currentUserId={user?.id}
              detailDefaultAssigneeId={detailDefaultAssigneeId}
              doctorFollowUpAssignees={doctorFollowUpAssignees}
              handoffStakeholders={handoffStakeholders}
              followUpAssigneeId={followUpAssigneeId}
              setFollowUpAssigneeId={setFollowUpAssigneeId}
              detailChecklist={detailChecklist}
              detailReminders={detailReminders}
              detailTasks={detailTasks}
              detailServices={detailServices}
              detailReport={detailReport}
              doctorDirectedReminders={doctorDirectedReminders}
              doctorDirectedTasks={doctorDirectedTasks}
              incomingDataChecklist={incomingDataChecklist}
              incomingDataReminders={incomingDataReminders}
              incomingDataTasks={incomingDataTasks}
              packageEndReminders={packageEndReminders}
              packageEndTasks={packageEndTasks}
              externalCommunicationEntries={externalCommunicationEntries}
              externalHandoffReminders={externalHandoffReminders}
              externalHandoffTasks={externalHandoffTasks}
              findingsChecklist={findingsChecklist}
              findingsReminders={findingsReminders}
              findingsTasks={findingsTasks}
              openChecklistCount={openChecklistCount}
              openTaskCount={openTaskCount}
              pendingReminderCount={pendingReminderCount}
              interpreterReportReady={interpreterReportReady}
              completionWarnings={completionWarnings}
              taskAssignableStaff={taskAssignableStaff}
              reportReviewMeta={reportReviewMeta}
              canSubmitInterpreterReport={canSubmitInterpreterReport}
              canResubmitRejectedReport={canResubmitRejectedReport}
              showReportReviewActions={showReportReviewActions}
              canShowConciergeSection={canShowConciergeSection}
              nonMedicalProviders={nonMedicalProviders}
              conciergeStaff={conciergeStaff}
              canShowBillingHandoffSection={canShowBillingHandoffSection}
              billingStaff={billingStaff}
              billingHandoffReminders={billingHandoffReminders}
              billingHandoffTasks={billingHandoffTasks}
              openBillingHandoffTasks={openBillingHandoffTasks}
              readyConciergeServices={readyConciergeServices}
              settledConciergeServices={settledConciergeServices}
              billingReadinessWarnings={billingReadinessWarnings}
              openDetailSheet={openDetailSheet}
              openLinkedPreview={openLinkedPreview}
              onRefresh={refreshDetail}
              onError={reportDetailError}
              onNotice={reportAppointmentsNotice}
              onFollowUpVisitCreated={handleFollowUpVisitCreated}
              onEditSaved={handleEditSaved}
            />
          </Suspense>
        ) : null}
      </Sheet>
      ) : null}
    </>
  );
}

export function AppointmentsPage() {
  const { user } = useAuth();

  if (user?.role === "patient") {
    return (
      <Suspense
        fallback={
          <div className="flex min-h-[320px] items-center justify-center text-muted-foreground">
            <LoaderCircle className="mr-2 size-4 animate-spin" />
            {appointmentText(
              "Termine werden geladen…",
              "Загрузка записей…",
              "Loading appointments…",
            )}
          </div>
        }
      >
        <LazyPatientAppointmentsPage />
      </Suspense>
    );
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
            appointmentStatusBadgeClassName(item.status),
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
