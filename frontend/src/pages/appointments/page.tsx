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
} from "react";
import { useSearchParams } from "react-router-dom";
import type FullCalendar from "@fullcalendar/react";
import type { EventClickArg, EventContentArg } from "@fullcalendar/core";
import {
  LoaderCircle,
} from "lucide-react";
import {
} from "@/components/ui-shell";
import { clearApiCache } from "@/lib/api";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { useDebouncedRealtimeSubscription } from "@/lib/realtime";
import {
  buildInterpreterMobileAgendaSections,
  buildAppointmentTimelineEvents,
  canResubmitInterpreterReport,
  normalizeAppointmentWorkspaceTab,
  shouldUseInterpreterMobileAgenda,
} from "@/pages/appointments/model/selectors";
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
} from "@/pages/appointments/model/date-time";
import {
  formatAppointmentDateTimeLabel as formatDateTimeLabel,
} from "@/pages/appointments/model/runtime-formatters";
import {
  blankAppointmentForm,
} from "@/pages/appointments/model/form-factories";
import {
  buildAppointmentsQuery,
} from "@/pages/appointments/model/query-builders";
import { toCalendarEvent } from "@/pages/appointments/model/calendar-events";
import { useAppointmentDetail } from "@/pages/appointments/data/use-appointment-detail";
import { useAppointmentLinkedPatientAssignment } from "@/pages/appointments/data/use-appointment-linked-patient-assignment";
import { useAppointmentLinkedRecords } from "@/pages/appointments/data/use-appointment-linked-records";
import { useAppointmentLinkedPatient } from "@/pages/appointments/data/use-appointment-linked-patient";
import { useAppointmentsMetadata } from "@/pages/appointments/data/use-appointments-metadata";
import { useAppointmentSchedulerActions } from "@/pages/appointments/data/use-appointment-scheduler-actions";
import { useAppointmentRequestsQueue } from "@/pages/appointments/data/use-appointment-requests-queue";
import { useAppointmentsSchedulerData } from "@/pages/appointments/data/use-appointments-scheduler-data";
import { useProviderDoctorOptions } from "@/pages/appointments/data/use-provider-doctor-options";
import {
  convertAppointmentRequest,
  reviewAppointmentRequest,
  type ConvertAppointmentRequestInput,
} from "@/pages/appointments/data/appointment-mutations";
import {
  matchesOperationalScope,
  operationalScopeOptions,
} from "@/pages/appointments/model/operational-scopes";
import {
  appointmentFilterControlClassName,
  appointmentSectionCardClassName,
} from "@/pages/appointments/appearance/surface-appearance";
import {
  appointmentText,
  appointmentTypeLabel,
} from "@/pages/appointments/model/labels";
import {
  buildHandoffStakeholders,
} from "@/pages/appointments/model/workflow-helpers";
import {
  useAppointmentQueryActions,
  useAppointmentRouteHydration,
} from "@/pages/appointments/ui/hooks/use-appointment-route-sync";
import { useAppointmentCalendarQuickActions } from "@/pages/appointments/ui/hooks/use-appointment-calendar-quick-actions";
import { useAppointmentLinkedSheetState } from "@/pages/appointments/ui/hooks/use-appointment-linked-sheet-state";
import { useAppointmentOverlayState } from "@/pages/appointments/ui/hooks/use-appointment-overlay-state";
import { useAppointmentSchedulerControls } from "@/pages/appointments/ui/hooks/use-appointment-scheduler-controls";
import { useAppointmentWorkspaceSession } from "@/pages/appointments/ui/hooks/use-appointment-workspace-session";
import { AppointmentCalendarEventCard } from "@/pages/appointments/ui/scheduler/appointment-calendar-event-card";
import { AppointmentsPageChrome } from "@/pages/appointments/ui/scheduler/appointments-page-chrome";
import {
  AppointmentsSchedulerSurface,
  preloadSchedulerQueueSheet,
  preloadSchedulerSearchSheet,
} from "@/pages/appointments/ui/scheduler/appointments-scheduler-surface";
import { CreateSheetLayer, preloadCreateSheetLayer } from "@/pages/appointments/ui/sheets/create-sheet-layer";
import {
  LinkedCasesSheetLayer,
  LinkedDocumentsSheetLayer,
  LinkedPatientSheetLayer,
  LinkedProviderSheetLayer,
  LinkedRecordsSheetLayer,
  preloadLinkedCasesSheet,
  preloadLinkedDocumentsSheet,
  preloadLinkedPatientSheet,
  preloadLinkedProviderSheet,
  preloadLinkedRecordsSheet,
} from "@/pages/appointments/ui/sheets/linked-sheet-layers";
import { MobileDetailSheet, preloadMobileDetailSheet } from "@/pages/appointments/ui/sheets/mobile-detail-sheet";
import type {
  AppointmentCommunicationEntry,
  AppointmentWorkspaceTab,
  AppointmentListItem,
  CalendarEventExtendedProps,
  CalendarView,
  ChecklistItem,
  ConciergeServiceEntry,
  FiltersState,
  HandoffStakeholder,
  OperationalScope,
  ReminderEntry,
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
  type PatientsDictionary,
} from "@/pages/patients";

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
const APPOINTMENT_REALTIME_EVENTS = [
  "appointment.created",
  "appointment.updated",
  "appointment.status_changed",
  "appointment_checklist.created",
  "appointment_checklist.completed",
  "appointment_request.created",
  "appointment_request.reviewed",
  "appointment_request.converted",
  "concierge_service.created",
  "concierge_service.updated",
  "concierge_service.cancelled",
  "concierge_service.billing_ready",
  "reminder.created",
  "reminder.completed",
  "task.created",
  "task.status_changed",
] as const;

const loadDesktopDetailWorkspaceContent = () =>
  import("@/pages/appointments/ui/workspace/desktop-detail-workspace-content");
const loadPatientAppointmentsPage = () =>
  import("@/pages/patients/portal-appointments-page");

const LazyDesktopDetailWorkspaceContent = lazy(async () => {
  const mod = await loadDesktopDetailWorkspaceContent();
  return { default: mod.MemoizedAppointmentDesktopDetailWorkspaceContent };
});

const LazyPatientAppointmentsPage = lazy(async () => {
  const mod = await loadPatientAppointmentsPage();
  return { default: mod.PatientAppointmentsPage };
});

const createSheetInputClassName = appointmentFilterControlClassName;

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
  const canReviewAppointmentRequests =
    user?.role === "ceo" || user?.role === "patient_manager";
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
  const [requestActionBusy, setRequestActionBusy] = useState("");
  const deferredSearch = useDeferredValue(filters.search);
  const {
    appointmentsNotice,
    appointmentsVersion,
    detailOpen,
    setDetailOpen,
    selectedId,
    setSelectedId,
    detailVersion,
    followUpAssigneeId,
    setFollowUpAssigneeId,
    bumpAppointmentsVersion,
    bumpDetailVersion,
    reportAppointmentsNotice,
  } = useAppointmentWorkspaceSession();
  const {
    patients,
    providers,
    interpreters,
    staff,
    metadataLoading,
    metadataError,
  } = useAppointmentsMetadata({
    failedLoadMessage: tr.common_failed_load,
  });
  const filterDoctors = useProviderDoctorOptions(filters.providerId);
  const {
    filtersModalOpen,
    searchModalOpen,
    queueModalOpen,
    createOpen,
    createSeed,
    handleFiltersModalOpenChange,
    openFiltersModal,
    handleSearchModalOpenChange,
    openSearchModal,
    handleQueueModalOpenChange,
    openQueueModal,
    handleCreateOpenChange,
    openCreateSeedSheet,
  } = useAppointmentOverlayState({
    createBlankAppointmentForm: blankAppointmentForm,
    preloadCreateSheet: preloadCreateSheetLayer,
    preloadSearchSheet: preloadSchedulerSearchSheet,
    preloadQueueSheet: preloadSchedulerQueueSheet,
  });
  const {
    detailLoading,
    detailError,
    setDetailError,
    detail,
    detailAssignments,
    detailChecklist,
    detailReminders,
    detailReport,
    detailTasks,
    detailServices,
    detailCommunications,
    detailExtendedLoading,
    detailExtendedResourcesReady,
    detailDefaultAssigneeId,
    resetAppointmentDetailState,
  } = useAppointmentDetail({
    detailOpen,
    selectedId,
    detailVersion,
    detailTab,
    isMobile,
    permissions,
  });
  const requiresExtendedDetailResources =
    detailOpen && isMobile && Boolean(selectedId);
  const {
    linkedPreviewOpen,
    linkedPreviewKind,
    linkedPreviewLabel,
    linkedPatientOpen,
    linkedPatientId,
    linkedPatientVersion,
    linkedProviderOpen,
    linkedProviderId,
    linkedCasesOpen,
    linkedDocumentsOpen,
    refreshLinkedPatient,
    resetLinkedSheetState,
    openLinkedPreview,
    openLinkedPatientById,
    handleLinkedPreviewOpenChange,
    handleLinkedPatientOpenChange,
    handleLinkedProviderOpenChange,
    handleLinkedCasesOpenChange,
    handleLinkedDocumentsOpenChange,
  } = useAppointmentLinkedSheetState({
    detailId: detail?.id ?? null,
    detailPatientId: detail?.patient_id ?? null,
    detailProviderId: detail?.provider_id ?? null,
    preloadPatientSheet: preloadLinkedPatientSheet,
    preloadProviderSheet: preloadLinkedProviderSheet,
    preloadCasesSheet: preloadLinkedCasesSheet,
    preloadDocumentsSheet: preloadLinkedDocumentsSheet,
    preloadLinkedRecordsSheet,
  });
  const {
    linkedPatientDetailLoading,
    linkedPatientDetailError,
    linkedPatientDetail,
    linkedPatientAssignments,
    linkedPatientAssignableStaff,
  } = useAppointmentLinkedPatient({
    linkedPatientOpen,
    linkedPatientId,
    linkedPatientVersion,
    canViewAssignments: patientSheetPermissions.canViewAssignments,
    canManageAssignments: patientSheetPermissions.canManageAssignments,
    failedLoadMessage: t.common_failed_load,
  });
  const {
    linkedPatientSelectedAssignee,
    setLinkedPatientSelectedAssignee,
    linkedPatientAssignmentBusy,
    linkedPatientAssignmentError,
    handleAssignLinkedPatient,
  } = useAppointmentLinkedPatientAssignment({
    linkedPatientDetailId: linkedPatientDetail?.id ?? null,
    failedAssignMessage: t.common_failed_assign,
    onAssigned: refreshLinkedPatient,
  });
  const {
    linkedPreviewLoading,
    linkedPreviewError,
    linkedPreviewPayload,
    linkedProviderDetailLoading,
    linkedProviderDetailError,
    linkedProviderDetail,
    linkedCasesLoading,
    linkedCasesError,
    linkedCasesItems,
    linkedDocumentsLoading,
    linkedDocumentsError,
    linkedDocumentsItems,
  } = useAppointmentLinkedRecords({
    detail,
    linkedPreviewOpen,
    linkedPreviewKind,
    linkedProviderOpen,
    linkedProviderId,
    linkedCasesOpen,
    linkedDocumentsOpen,
    failedLoadMessage: t.common_failed_load,
  });

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
  const {
    appointments,
    attentionItems,
    appointmentsLoading,
    appointmentsError,
    setAppointmentsError,
  } = useAppointmentsSchedulerData({
    appointmentsQuery,
    attentionQuery,
    appointmentsVersion,
    failedLoadMessage: tr.common_failed_load,
  });
  const {
    appointmentRequests,
    appointmentRequestsLoading,
    appointmentRequestsError,
    setAppointmentRequestsError,
  } = useAppointmentRequestsQueue({
    enabled: canReviewAppointmentRequests,
    appointmentsVersion,
    failedLoadMessage: tr.common_failed_load,
  });
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
  const activeOperationalScope = scopeOptions.some(
    (option) => option.id === operationalScope,
  )
    ? operationalScope
    : "all";
  const selectedOperationalScopeLabel =
    scopeOptions.find((option) => option.id === activeOperationalScope)?.label ??
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
  const {
    calendarQuickActionMenu,
    calendarQuickActionMenuRef,
    activeCalendarQuickActionItem,
    activeCalendarQuickActionScope,
    dismissCalendarQuickActionMenu,
    handleCalendarQuickActionScopeChange,
    openCalendarQuickActionLayer,
  } = useAppointmentCalendarQuickActions({
    appointmentsIndex,
  });
  const resolvedFollowUpAssigneeId =
    followUpAssigneeId || detailDefaultAssigneeId;
  const {
    syncQuery,
    resetSearchFilters,
    handleSearchPatientChange,
    handleSearchProviderChange,
    handleSearchDoctorChange,
  } = useAppointmentQueryActions({
    searchParams,
    setSearchParams,
    defaultFilters: DEFAULT_FILTERS,
    setFilters,
    setOperationalScope,
  });

  const defaultDetailTabForAppointment = useCallback(
    (appointmentId: string): AppointmentWorkspaceTab => {
      const appointment = appointmentsIndex.get(appointmentId);
      return appointment?.type === "non_medical" ? "services" : "overview";
    },
    [appointmentsIndex],
  );

  useEffect(() => {
    const appointmentParam = searchParams.get("appointment");
    if (!appointmentParam || searchParams.get("detailTab")) return;
    if (defaultDetailTabForAppointment(appointmentParam) !== "services") return;
    syncQuery({ detailTab: "services" });
  }, [defaultDetailTabForAppointment, searchParams, syncQuery]);

  const closeDetailWorkspace = useCallback(
    (clearQuery = true) => {
      setDetailOpen(false);
      setSelectedId("");
      resetAppointmentDetailState();
      setFollowUpAssigneeId("");
      resetLinkedSheetState();
      if (clearQuery) {
        syncQuery({
          appointment: null,
          detailTab: null,
        });
      }
    },
    [
      resetAppointmentDetailState,
      resetLinkedSheetState,
      setDetailOpen,
      setFollowUpAssigneeId,
      setSelectedId,
      syncQuery,
    ],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(CALENDAR_STORAGE_VIEW_KEY, calendarView);
    window.localStorage.setItem(CALENDAR_STORAGE_DATE_KEY, calendarDate);
  }, [calendarDate, calendarView]);

  useAppointmentRouteHydration({
    searchParams,
    setSearchParams,
    selectedId,
    detailOpen,
    canCreate: permissions.canCreate,
    closeDetailWorkspace,
    setFilters,
    setSelectedId,
    setDetailOpen,
    onOpenCreateFromPatient: (patientId) => {
      const next = blankAppointmentForm();
      next.patientId = patientId;
      openCreateSeedSheet(next);
    },
  });

  const scopedAppointments = useMemo(
    () =>
      appointments.filter((item) =>
        matchesOperationalScope(
          item,
          activeOperationalScope,
          user?.id,
          user?.role,
          attentionIds,
        ),
      ),
    [activeOperationalScope, appointments, attentionIds, user?.id, user?.role],
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
      if (activeOperationalScope === "all" ? item.status !== "cancelled" : true) {
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
  }, [activeOperationalScope, scopedAppointments, todayDate, weekEnd, weekStart]);
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
    dismissCalendarQuickActionMenu();
    bumpAppointmentsVersion();
  }, [bumpAppointmentsVersion, dismissCalendarQuickActionMenu]);

  const refreshDetail = useCallback(() => {
    dismissCalendarQuickActionMenu();
    bumpDetailVersion();
  }, [bumpDetailVersion, dismissCalendarQuickActionMenu]);

  const handleReviewAppointmentRequest = useCallback(
    async (requestId: string, status: "approved" | "rejected") => {
      const busyKey = `${requestId}:${status}`;
      setRequestActionBusy(busyKey);
      setAppointmentRequestsError("");

      try {
        await reviewAppointmentRequest(requestId, status);
        clearApiCache("/appointments/requests");
        reportAppointmentsNotice(
          status === "approved"
            ? appointmentText(
                "Portal-Anfrage freigegeben.",
                "Запрос портала согласован.",
                "Portal request approved.",
              )
            : appointmentText(
                "Portal-Anfrage abgelehnt.",
                "Запрос портала отклонён.",
                "Portal request rejected.",
              ),
        );
        refreshAppointments();
      } catch (error) {
        setAppointmentRequestsError(
          error instanceof Error ? error.message : tr.common_failed_save,
        );
      } finally {
        setRequestActionBusy((current) => (current === busyKey ? "" : current));
      }
    },
    [
      refreshAppointments,
      reportAppointmentsNotice,
      setAppointmentRequestsError,
      tr.common_failed_save,
    ],
  );
  const {
    handleDatesSet,
    applyTodayScope,
    applyWeekScope,
    applyMineScope,
    applyOperationalScope,
    applySchedulerQuickScope,
    resetQuickScopes,
    openCreateSheetFromDate,
  } = useAppointmentSchedulerControls({
    calendarRef,
    canCreate: permissions.canCreate,
    currentUserId: user?.id,
    currentUserRole: user?.role,
    todayDate,
    weekStart,
    weekEnd,
    defaultFilters: DEFAULT_FILTERS,
    setFilters,
    setOperationalScope,
    setCalendarView,
    setCalendarDate,
    syncQuery,
    onRefreshAppointments: refreshAppointments,
    onOpenCreateSeed: openCreateSeedSheet,
    onDismissQuickActionMenu: dismissCalendarQuickActionMenu,
  });

  const reportDetailError = useCallback((message: string) => {
    setDetailError(message);
  }, [setDetailError]);
  const {
    actionBusy,
    resetAppointmentSchedulerActionState,
    handleInlineReschedule,
    performStatusChange,
  } = useAppointmentSchedulerActions({
    appointments,
    appointmentsIndex,
    canEditSchedule: permissions.canEditSchedule,
    selectedId,
    dictionary: tr,
    onNotice: reportAppointmentsNotice,
    onAppointmentsError: setAppointmentsError,
    onDetailError: setDetailError,
    onRefreshAppointments: refreshAppointments,
    onRefreshDetail: refreshDetail,
    onDismissQuickActionMenu: dismissCalendarQuickActionMenu,
  });

  useEffect(() => {
    if (detailOpen) return;
    resetAppointmentSchedulerActionState();
  }, [detailOpen, resetAppointmentSchedulerActionState]);

  const handleEditSaved = useCallback((notice: string) => {
    reportAppointmentsNotice(notice);
    refreshDetail();
  }, [refreshDetail, reportAppointmentsNotice]);

  const openDetailSheet = useCallback((id: string, detailTabOverride?: AppointmentWorkspaceTab) => {
    const nextDetailTab = detailTabOverride ?? defaultDetailTabForAppointment(id);
    void (isMobile
      ? preloadMobileDetailSheet()
      : loadDesktopDetailWorkspaceContent());
    dismissCalendarQuickActionMenu();
    startTransition(() => {
      setSelectedId(id);
      setDetailOpen(true);
    });
    syncQuery({
      appointment: id,
      detailTab: nextDetailTab,
    });
  }, [
    defaultDetailTabForAppointment,
    dismissCalendarQuickActionMenu,
    isMobile,
    setDetailOpen,
    setSelectedId,
    syncQuery,
  ]);

  const handleConvertAppointmentRequest = useCallback(
    async (requestId: string, input: ConvertAppointmentRequestInput) => {
      const busyKey = `${requestId}:convert`;
      setRequestActionBusy(busyKey);
      setAppointmentRequestsError("");

      try {
        const result = await convertAppointmentRequest(requestId, input);
        clearApiCache("/appointments");
        clearApiCache("/appointments/requests");
        reportAppointmentsNotice(
          appointmentText(
            "Portal-Anfrage als Termin geplant.",
            "Запрос портала запланирован как приём.",
            "Portal request scheduled as appointment.",
          ),
        );
        refreshAppointments();
        openDetailSheet(result.appointment_id);
      } catch (error) {
        setAppointmentRequestsError(
          error instanceof Error ? error.message : tr.common_failed_save,
        );
      } finally {
        setRequestActionBusy((current) => (current === busyKey ? "" : current));
      }
    },
    [
      openDetailSheet,
      refreshAppointments,
      reportAppointmentsNotice,
      setAppointmentRequestsError,
      tr.common_failed_save,
    ],
  );

  const handleFollowUpVisitCreated = useCallback(
    ({ id, notice }: { id?: string; notice: string }) => {
      reportAppointmentsNotice(notice);
      refreshAppointments();
      if (id) {
        openDetailSheet(id);
      } else {
        refreshDetail();
      }
    },
    [openDetailSheet, refreshAppointments, refreshDetail, reportAppointmentsNotice],
  );

  useDebouncedRealtimeSubscription(APPOINTMENT_REALTIME_EVENTS, (_event, events) => {
    clearApiCache("/appointments");

    let shouldRefreshAppointments = false;
    let shouldRefreshDetail = false;

    for (const event of events) {
      const eventAppointmentId =
        typeof event.payload?.appointment_id === "string"
          ? event.payload.appointment_id
          : null;

      if (event.entity_type === "concierge_service") {
        clearApiCache("/concierge-services");
        if (detailOpen) {
          shouldRefreshDetail = true;
        }
        continue;
      }

      if (
        event.entity_type === "appointment_checklist" ||
        event.entity_type === "reminder" ||
        event.entity_type === "task"
      ) {
        clearApiCache("/tasks");
        if (eventAppointmentId) {
          clearApiCache(`/appointments/${eventAppointmentId}/checklist`);
          clearApiCache(`/appointments/${eventAppointmentId}/reminders`);
        }
        if (detailOpen && selectedId && eventAppointmentId === selectedId) {
          shouldRefreshDetail = true;
        }
        shouldRefreshAppointments = true;
        continue;
      }

      if (
        event.entity_type === "appointment" &&
        detailOpen &&
        selectedId &&
        event.entity_id === selectedId
      ) {
        shouldRefreshDetail = true;
        continue;
      }

      shouldRefreshAppointments = true;
    }

    if (shouldRefreshDetail) {
      refreshDetail();
    }
    if (shouldRefreshAppointments) {
      refreshAppointments();
    }
  }, 250);

  function handleEventClick(info: EventClickArg) {
    const props = info.event.extendedProps as CalendarEventExtendedProps;
    openDetailSheet(
      info.event.id,
      props.appointmentType === "non_medical" ? "services" : undefined,
    );
  }

  const renderCalendarEventContent = useCallback(
    (arg: EventContentArg) => (
      <AppointmentCalendarEventCard
        arg={arg}
        lang={lang}
        canManageStatus={permissions.canManageStatus}
        activeQuickActionAppointmentId={
          calendarQuickActionMenu?.appointmentId ?? null
        }
        dictionary={tr}
        onOpenQuickActions={openCalendarQuickActionLayer}
        onStatusChange={performStatusChange}
      />
    ),
    [
      calendarQuickActionMenu?.appointmentId,
      openCalendarQuickActionLayer,
      performStatusChange,
      permissions.canManageStatus,
      lang,
      tr,
    ],
  );

  if (!permissions.canViewPage) {
    return (
      <div className={appointmentSectionCardClassName("p-8 text-sm text-muted-foreground")}>
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
            followUpAssigneeId={resolvedFollowUpAssigneeId}
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
        <AppointmentsPageChrome
          title={tr.appointments_title ?? "Appointments"}
          createLabel={tr.appointments_new ?? "New appointment"}
          refreshTitle={appointmentText("Aktualisieren", "Обновить", "Refresh")}
          canCreate={permissions.canCreate}
          onCreate={() => openCreateSheetFromDate()}
          onRefresh={refreshAppointments}
          todayLabel={tr.dash_patients_today ?? "Today"}
          activeLabel={tr.common_active ?? "Active"}
          pendingLabel={tr.mfa_pending ?? "Pending"}
          requestLabel={appointmentText(
            "Portal-Anfragen",
            "Запросы портала",
            "Portal requests",
          )}
          attentionLabel={tr.common_error ?? "Attention"}
          totalLabel={tr.providers_all ?? "All"}
          todayAppointments={todayAppointments}
          activeAppointments={activeAppointments}
          pendingInterpreterResponses={pendingInterpreterResponses}
          appointmentRequestCount={appointmentRequests.length}
          attentionCount={attentionCount}
          totalAppointments={scopedAppointments.length}
          appointmentsError={appointmentsError}
          appointmentsNotice={appointmentsNotice}
          metadataError={metadataError}
        />

        <AppointmentsSchedulerSurface
          useMobileAgenda={useInterpreterMobileAgenda}
          mobileAgenda={{
            todayLabel: t.dash_patients_today,
            pendingLabel: tr.mfa_pending ?? "Pending interpreter",
            weekLabel: tr.dash_this_week ?? "This week",
            searchLabel: t.common_search,
            searchPlaceholder: tr.common_search,
            resetLabel: t.common_reset,
            todayScopeLabel: "Today",
            weekScopeLabel: "This week",
            mineScopeLabel: "Mine",
            todayAppointments,
            mobileAgendaPendingCount,
            mobileAgendaWeekCount,
            searchValue: filters.search,
            onSearchChange: (value) =>
              setFilters((current) => ({
                ...current,
                search: value,
              })),
            todayScopeActive:
              filters.dateFrom === todayDate && filters.dateTo === todayDate,
            weekScopeActive:
              filters.dateFrom === weekStart && filters.dateTo === weekEnd,
            mineScopeActive: mineFilterActive,
            onApplyTodayScope: applyTodayScope,
            onApplyWeekScope: applyWeekScope,
            onApplyMineScope: applyMineScope,
            scopeOptions,
            activeOperationalScope,
            onApplyOperationalScope: applyOperationalScope,
            onResetQuickScopes: resetQuickScopes,
            sections: mobileAgendaSections,
            emptyText: appointmentText(
              "Im aktuellen mobilen Scope sind keine Termine vorhanden.",
              "В текущем мобильном scope нет приёмов.",
              "No appointments in the current mobile scope.",
            ),
            onOpenDetail: openDetailSheet,
          }}
          filtersDialog={{
            open: filtersModalOpen && shouldRenderFiltersDialog,
            onOpenChange: handleFiltersModalOpenChange,
            title: appointmentText("Filter", "Фильтры", "Filters"),
            operationalScopeLabel: appointmentText(
              "Operativer Bereich",
              "Операционная область",
              "Operational scope",
            ),
            quickScopeLabel: appointmentText(
              "Schnellbereich",
              "Быстрая область",
              "Quick scope",
            ),
            activeOperationalScope,
            onApplyOperationalScope: applyOperationalScope,
            selectedOperationalScopeLabel,
            schedulerQuickScopeValue,
            onApplySchedulerQuickScope: applySchedulerQuickScope,
            selectedSchedulerQuickScopeLabel,
            scopeOptions,
            schedulerQuickScopeOptions,
            controlClassName: createSheetInputClassName,
          }}
          searchSheet={{
            shouldRender: shouldRenderSearchSheet,
            loadingTitle: t.common_search,
            loadingLabel: appointmentText(
              "Suchfilter werden geladen",
              "Загрузка фильтров поиска",
              "Loading search filters",
            ),
            open: searchModalOpen,
            onOpenChange: handleSearchModalOpenChange,
            filters,
            setFilters,
            patients,
            providers,
            filterDoctors,
            staff,
            interpreters,
            onReset: resetSearchFilters,
            onPatientChange: handleSearchPatientChange,
            onProviderChange: handleSearchProviderChange,
            onDoctorChange: handleSearchDoctorChange,
          }}
          queueSheet={{
            shouldRender: shouldRenderQueueSheet,
            loadingTitle: t.appointments_title,
            loadingLabel: appointmentText(
              "Auftragswarteschlange wird geladen",
              "Загрузка очереди приёмов",
              "Loading appointment queue",
            ),
            open: queueModalOpen,
            onOpenChange: handleQueueModalOpenChange,
            appointmentsLoading,
            metadataLoading,
            items: queueAppointments,
            appointmentRequests,
            appointmentRequestsLoading,
            appointmentRequestsError,
            currentUserId: user?.id,
            staff,
            interpreters,
            openDetailSheet,
            operationalScope: activeOperationalScope,
            userRole: user?.role,
            attentionIndex,
            canManageStatus: permissions.canManageStatus,
            actionBusy,
            requestActionBusy,
            onStatusChange: performStatusChange,
            onReviewRequest: handleReviewAppointmentRequest,
            onConvertRequest: handleConvertAppointmentRequest,
          }}
          toolbar={{
            searchAriaLabel: t.common_search,
            searchPlaceholder: t.common_search.replace(/[.…]+$/u, ""),
            queueLabel:
              appointmentRequests.length > 0
                ? `${appointmentText("Queue", "Очередь", "Queue")} (${appointmentRequests.length})`
                : appointmentText("Queue", "Очередь", "Queue"),
            onOpenFilters: openFiltersModal,
            onOpenSearch: openSearchModal,
            onOpenQueue: openQueueModal,
          }}
          calendarSurface={{
            calendarRef,
            lang,
            dictionary: tr,
            calendarView,
            calendarDate,
            canEditSchedule: permissions.canEditSchedule,
            dateClick: openCreateSheetFromDate,
            eventClick: handleEventClick,
            eventDrop: handleInlineReschedule,
            eventResize: handleInlineReschedule,
            eventContent: renderCalendarEventContent,
            datesSet: handleDatesSet,
            events: calendarEvents,
            calendarQuickActionMenu,
            calendarQuickActionMenuRef,
            activeCalendarQuickActionItem,
            activeCalendarQuickActionScope,
            actionBusy,
            onCalendarQuickActionScopeChange:
              handleCalendarQuickActionScopeChange,
            onOpenDetail: openDetailSheet,
            onStatusChange: performStatusChange,
          }}
        />
      </div>
      )}

      <CreateSheetLayer
        open={createOpen}
        title={tr.appointments_new}
        loadingLabel={appointmentText(
          "Terminformular wird geladen",
          "Загрузка формы приёма",
          "Loading appointment form",
        )}
        seed={createSeed}
        appointments={appointments}
        patients={patients}
        providers={providers}
        interpreters={interpreters}
        staff={staff}
        userId={user?.id}
        onOpenChange={handleCreateOpenChange}
        onCreated={({ id, notice }) => {
          reportAppointmentsNotice(notice);
          refreshAppointments();
          if (id) {
            openDetailSheet(id);
          }
        }}
      />

      <LinkedPatientSheetLayer
        open={linkedPatientOpen}
        onOpenChange={handleLinkedPatientOpenChange}
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
        onRefresh={refreshLinkedPatient}
        hideWorkspaceActions
        onOpenCases={() => undefined}
        onOpenOrders={() => undefined}
        onOpenAppointments={() => undefined}
        onOpenContracts={() => undefined}
        onOpenDocuments={() => undefined}
      />

      <LinkedProviderSheetLayer
        open={linkedProviderOpen}
        onOpenChange={handleLinkedProviderOpenChange}
        detail={linkedProviderDetail}
        loading={linkedProviderDetailLoading}
        error={linkedProviderDetailError}
        fallbackTitle={t.providers_detail}
        formatDateTimeLabel={formatDateTimeLabel}
        onOpenPatient={openLinkedPatientById}
        onOpenAppointment={(appointmentId) => {
          handleLinkedProviderOpenChange(false);
          openDetailSheet(appointmentId);
        }}
      />

      <LinkedCasesSheetLayer
        open={linkedCasesOpen}
        onOpenChange={handleLinkedCasesOpenChange}
        loading={linkedCasesLoading}
        error={linkedCasesError}
        items={linkedCasesItems}
        patientId={detail?.patient_id ?? null}
        formatDateTimeLabel={formatDateTimeLabel}
      />

      <LinkedDocumentsSheetLayer
        open={linkedDocumentsOpen}
        onOpenChange={handleLinkedDocumentsOpenChange}
        loading={linkedDocumentsLoading}
        error={linkedDocumentsError}
        items={linkedDocumentsItems}
        formatDateTime={formatDateTimeLabel}
      />

      <LinkedRecordsSheetLayer
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

      {isMobile ? (
        <MobileDetailSheet
          open={detailOpen}
          onOpenChange={(open) => {
            if (open) {
              setDetailOpen(true);
              return;
            }
            closeDetailWorkspace();
          }}
          shouldRenderContent={shouldRenderDetailSheetContent}
          title={tr.appointments_title}
          loadingLabel={appointmentText(
            "Detailbereich wird geladen",
            "Загрузка detail-блока",
            "Loading detail workspace",
          )}
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
          followUpAssigneeId={resolvedFollowUpAssigneeId}
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
