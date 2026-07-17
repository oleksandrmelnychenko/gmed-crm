import {
  formatUiText,
  getLang,
  t as translateCatalog,
  type Translations,
} from "@/lib/i18n";
import {
  communicationChannelLabel,
  communicationDirectionLabel,
} from "@/pages/appointments/model/labels";
import type {
  AppointmentPermissions,
  AppointmentTimelineEvent,
  AppointmentTimelineKind,
  AppointmentTimelineTone,
  AppointmentWorkflowSummary,
  InterpreterMobileAgendaItem,
  InterpreterMobileAgendaSection,
  LinkedPatientPermissions,
} from "@/pages/appointments/model/types";

export type {
  AppointmentTimelineEvent,
  AppointmentTimelineKind,
  AppointmentTimelineTone,
  AppointmentWorkflowSummary,
  InterpreterMobileAgendaItem,
  InterpreterMobileAgendaSection,
} from "@/pages/appointments/model/types";
export { normalizeAppointmentWorkspaceTab } from "@/pages/appointments/model/workspace-tabs";

const LEGACY_CONCIERGE_TRANSFER_COMPLETED_SOURCES = [
  "Completed airport arrival step. Driver waited at hotel lobby and escorted patient to admission desk. Completed concierge-linked transfer.",
] as const;

export function appointmentPermissions(
  role?: string,
): AppointmentPermissions {
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
    case "it_admin":
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

export function linkedPatientPermissions(
  role?: string,
): LinkedPatientPermissions {
  return {
    canCreateEdit:
      role === "ceo" || role === "patient_manager" || role === "it_admin",
    canViewAssignments: [
      "ceo",
      "patient_manager",
      "teamlead_interpreter",
      "interpreter",
      "concierge",
      "it_admin",
    ].includes(role ?? ""),
    canManageAssignments:
      role === "ceo" ||
      role === "patient_manager" ||
      role === "teamlead_interpreter" ||
      role === "it_admin",
  };
}

type TimelineDetail = {
  id: string;
  title: string;
  date: string;
  time_start: string | null;
  time_end: string | null;
  patient_pid: string;
  patient_name: string;
  provider_name: string | null;
  doctor_name: string | null;
  interpreter_name: string | null;
  interpreter_response: string | null;
  created_at: string;
};

type TimelineChecklistItem = {
  id: string;
  phase: string;
  item_text: string;
  is_completed: boolean;
  completed_at: string | null;
};

type TimelineReminderEntry = {
  id: string;
  title: string;
  description: string | null;
  remind_at: string;
  is_completed: boolean;
  completed_at: string | null;
  user_name: string;
};

type TimelineTaskEntry = {
  id: string;
  title: string;
  description: string | null;
  assigned_to_name: string;
  assigned_to_role: string;
  due_date: string | null;
  status: string;
  priority: string;
  completed_at: string | null;
  created_at: string;
};

type TimelineServiceEntry = {
  id: string;
  title: string;
  status: string;
  assigned_concierge_name: string | null;
  starts_at: string | null;
  completed_at: string | null;
  created_at: string;
};

type TimelineReportSummary = {
  id: string;
  interpreter_name: string;
  hours: string;
  report_text: string | null;
  approval_status: string;
  approved_by_name: string | null;
  approved_at: string | null;
  created_at: string;
  notes?: string | null;
};

type TimelineCommunicationEntry = {
  id: string;
  target_type: "clinic" | "doctor" | "service_provider";
  direction: "outbound" | "inbound";
  channel: "phone" | "email" | "portal" | "fax" | "whatsapp" | "other";
  status: "planned" | "sent" | "answered" | "closed" | "cancelled";
  subject: string;
  message: string | null;
  contact_name: string | null;
  due_at: string | null;
  responded_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  created_by_name: string;
  provider_name: string | null;
  doctor_name: string | null;
};

const FINDINGS_PREFIX = "Findings:";
const INCOMING_DATA_PREFIX = "Incoming data:";
const DOCTOR_FOLLOW_UP_PREFIX = "Doctor-directed:";
const PACKAGE_END_PREFIX = "Package-end:";
const EXTERNAL_HANDOFF_PREFIX = "External handoff:";
const BILLING_HANDOFF_PREFIX = "Billing handoff:";
const FINDINGS_CHECKLIST_PREFIX = "[Findings]";
const INCOMING_DATA_CHECKLIST_PREFIX = "[Incoming data]";
const INTERPRETER_MOBILE_AGENDA_DATE_FORMATTERS = {
  de: new Intl.DateTimeFormat("de-DE", {
    weekday: "long",
    day: "2-digit",
    month: "short",
  }),
  default: new Intl.DateTimeFormat("ru-RU", {
    weekday: "long",
    day: "2-digit",
    month: "short",
  }),
} as const;

function buildSlotLabel(detail: TimelineDetail) {
  return detail.time_start
    ? `${detail.date} ${detail.time_start}${detail.time_end ? `-${detail.time_end}` : ""}`
    : detail.date;
}

function kindFromTitle(title: string): AppointmentTimelineKind {
  if (
    title.startsWith(FINDINGS_PREFIX) ||
    title.startsWith(DOCTOR_FOLLOW_UP_PREFIX) ||
    title.startsWith(PACKAGE_END_PREFIX)
  ) {
    return "followup";
  }
  if (
    title.startsWith(INCOMING_DATA_PREFIX) ||
    title.startsWith(INCOMING_DATA_CHECKLIST_PREFIX)
  ) {
    return "clinical";
  }
  if (
    title.startsWith(EXTERNAL_HANDOFF_PREFIX) ||
    title.startsWith(FINDINGS_CHECKLIST_PREFIX)
  ) {
    return "workflow";
  }
  if (title.startsWith(BILLING_HANDOFF_PREFIX)) {
    return "workflow";
  }
  return "workflow";
}

function toneFromTaskStatus(status: string): AppointmentTimelineTone {
  switch (status) {
    case "completed":
      return "success";
    case "cancelled":
      return "danger";
    case "blocked":
      return "warning";
    default:
      return "info";
  }
}

function toneFromCommunicationStatus(
  status: TimelineCommunicationEntry["status"],
): AppointmentTimelineTone {
  switch (status) {
    case "answered":
    case "closed":
      return "success";
    case "cancelled":
      return "danger";
    case "planned":
      return "warning";
    default:
      return "info";
  }
}

function communicationTargetLabel(entry: TimelineCommunicationEntry) {
  const dictionary = translateCatalog(getLang());
  switch (entry.target_type) {
    case "doctor":
      return entry.doctor_name || dictionary.common_doctor;
    case "service_provider":
      return entry.provider_name || dictionary.common_provider;
    default:
      return entry.provider_name || dictionary.common_provider;
  }
}

function localizeKnownTimelineText(
  value: string | null | undefined,
  labels: {
    appointments_legacy_concierge_transfer_completed_source: string;
    appointments_timeline_concierge_transfer_completed: string;
  },
  prefixLabels: ReadonlyArray<{ source: string; label: string }> = [],
) {
  if (!value) return value ?? "";
  const normalized = value.trim();
  const conciergeTransferSources = [
    labels.appointments_legacy_concierge_transfer_completed_source,
    ...LEGACY_CONCIERGE_TRANSFER_COMPLETED_SOURCES,
  ];
  if (conciergeTransferSources.some((source) => normalized === source.trim())) {
    return labels.appointments_timeline_concierge_transfer_completed;
  }
  for (const item of prefixLabels) {
    const prefixWithSpace = `${item.source} `;
    if (normalized.startsWith(prefixWithSpace)) {
      return `${item.label}: ${normalized.slice(prefixWithSpace.length).trim()}`;
    }
    if (normalized === item.source) {
      return item.label;
    }
  }
  return value;
}

function formatInterpreterMobileAgendaDateLabel(
  date: string,
  todayDate: string,
  todayLabel = translateCatalog(getLang()).dash_patients_today,
) {
  if (date === todayDate) return todayLabel;
  try {
    const formatter =
      getLang() === "de"
        ? INTERPRETER_MOBILE_AGENDA_DATE_FORMATTERS.de
        : INTERPRETER_MOBILE_AGENDA_DATE_FORMATTERS.default;
    return formatter.format(new Date(`${date}T00:00:00`));
  } catch {
    return date;
  }
}

export function shouldUseInterpreterMobileAgenda(
  role: string | undefined,
  isMobile: boolean,
) {
  return (
    isMobile && (role === "interpreter" || role === "teamlead_interpreter")
  );
}

export function buildInterpreterMobileAgendaSections<
  T extends InterpreterMobileAgendaItem,
>(
  items: T[],
  todayDate: string,
  todayLabel = translateCatalog(getLang()).dash_patients_today,
): InterpreterMobileAgendaSection<T>[] {
  const grouped = new Map<string, T[]>();
  const sorted = items
    .filter((item) => item.status !== "cancelled")
    .toSorted((left, right) =>
      `${left.date}T${left.time_start ?? "23:59"}${left.id}`.localeCompare(
        `${right.date}T${right.time_start ?? "23:59"}${right.id}`,
      ),
    );

  for (const item of sorted) {
    const existing = grouped.get(item.date);
    if (existing) {
      existing.push(item);
    } else {
      grouped.set(item.date, [item]);
    }
  }

  return [...grouped.entries()].map(([date, groupItems]) => ({
    date,
    label: formatInterpreterMobileAgendaDateLabel(date, todayDate, todayLabel),
    itemCount: groupItems.length,
    pendingResponseCount: groupItems.filter(
      (item) => item.interpreter_response === "pending",
    ).length,
    items: groupItems,
  }));
}

export function canResubmitInterpreterReport(params: {
  approvalStatus?: string | null;
  currentUserId?: string | null;
  interpreterId?: string | null;
}) {
  return (
    params.approvalStatus === "rejected" &&
    Boolean(params.currentUserId) &&
    params.currentUserId === params.interpreterId
  );
}

export function buildAppointmentWorkflowSummary(args: {
  showCompletionSection: boolean;
  showStatusSection: boolean;
  showScheduleSection: boolean;
  showInterpreterSection: boolean;
  showChecklistSection: boolean;
  showReminderSection: boolean;
  showTaskSection: boolean;
  checklistTotalCount: number;
  openChecklistCount: number;
  openTaskCount: number;
  pendingReminderCount: number;
  interpreterRequired: boolean;
  interpreterReady: boolean;
}): AppointmentWorkflowSummary {
  const transitionSurfaceCount =
    Number(args.showCompletionSection) + Number(args.showStatusSection);
  const logisticsSurfaceCount =
    Number(args.showScheduleSection) + Number(args.showInterpreterSection);
  const backlogSurfaceCount =
    Number(args.showChecklistSection) +
    Number(args.showReminderSection) +
    Number(args.showTaskSection);

  return {
    visibleSurfaceCount:
      transitionSurfaceCount + logisticsSurfaceCount + backlogSurfaceCount,
    transitionSurfaceCount,
    logisticsSurfaceCount,
    backlogSurfaceCount,
    openIssueCount:
      args.openChecklistCount + args.openTaskCount + args.pendingReminderCount,
    checklistCompletedCount: Math.max(
      args.checklistTotalCount - args.openChecklistCount,
      0,
    ),
    followUpQueueCount: args.openTaskCount + args.pendingReminderCount,
    interpreterGate: !args.interpreterRequired
      ? "not_required"
      : args.interpreterReady
        ? "ready"
        : "pending",
  };
}

export function buildAppointmentTimelineEvents(args: {
  detail: TimelineDetail | null;
  checklist: TimelineChecklistItem[];
  reminders: TimelineReminderEntry[];
  tasks: TimelineTaskEntry[];
  services: TimelineServiceEntry[];
  report: TimelineReportSummary | null;
  communications: TimelineCommunicationEntry[];
  labels?: Pick<
    Translations,
    | "appointments_timeline_appointment_created"
    | "appointments_timeline_scheduled_slot"
    | "appointments_timeline_interpreter_pending"
    | "appointments_timeline_interpreter_assigned"
    | "appointments_timeline_interpreter_accepted"
    | "appointments_timeline_interpreter_declined"
    | "appointments_timeline_interpreter_discussion"
    | "appointments_timeline_checklist_completed"
    | "appointments_timeline_checklist_pending"
    | "appointments_timeline_external_response_logged"
    | "appointments_timeline_external_communication_cancelled"
    | "appointments_timeline_external_communication_closed"
    | "appointments_timeline_interpreter_report_submitted"
    | "appointments_timeline_interpreter_report_approved"
    | "appointments_timeline_interpreter_report_rejected"
    | "appointments_timeline_concierge_transfer_completed"
  >;
}) {
  const {
    detail,
    checklist,
    reminders,
    tasks,
    services,
    report,
    communications,
  } = args;
  if (!detail) return [] as AppointmentTimelineEvent[];
  const dictionary = translateCatalog(getLang());
  const ui = (
    key: string,
    values?: Record<string, string | number | boolean | null | undefined>,
  ) => formatUiText(dictionary.uiText[key] ?? key, values);
  const labels = {
    appointments_legacy_concierge_transfer_completed_source:
      dictionary.uiText.appointments_legacy_concierge_transfer_completed_source,
    appointments_timeline_appointment_created:
      dictionary.appointments_timeline_appointment_created,
    appointments_timeline_scheduled_slot:
      dictionary.appointments_timeline_scheduled_slot,
    appointments_timeline_interpreter_pending:
      dictionary.appointments_timeline_interpreter_pending,
    appointments_timeline_interpreter_assigned:
      dictionary.appointments_timeline_interpreter_assigned,
    appointments_timeline_interpreter_accepted:
      dictionary.appointments_timeline_interpreter_accepted,
    appointments_timeline_interpreter_declined:
      dictionary.appointments_timeline_interpreter_declined,
    appointments_timeline_interpreter_discussion:
      dictionary.appointments_timeline_interpreter_discussion,
    appointments_timeline_checklist_completed:
      dictionary.appointments_timeline_checklist_completed,
    appointments_timeline_checklist_pending:
      dictionary.appointments_timeline_checklist_pending,
    appointments_timeline_external_response_logged:
      dictionary.appointments_timeline_external_response_logged,
    appointments_timeline_external_communication_cancelled:
      dictionary.appointments_timeline_external_communication_cancelled,
    appointments_timeline_external_communication_closed:
      dictionary.appointments_timeline_external_communication_closed,
    appointments_timeline_interpreter_report_submitted:
      dictionary.appointments_timeline_interpreter_report_submitted,
    appointments_timeline_interpreter_report_approved:
      dictionary.appointments_timeline_interpreter_report_approved,
    appointments_timeline_interpreter_report_rejected:
      dictionary.appointments_timeline_interpreter_report_rejected,
    appointments_timeline_concierge_transfer_completed:
      dictionary.appointments_timeline_concierge_transfer_completed,
    ...args.labels,
  };
  const timelinePrefixLabels = [
    {
      source: DOCTOR_FOLLOW_UP_PREFIX,
      label: ui("appointments_timeline_prefix_doctor_directed"),
    },
    {
      source: PACKAGE_END_PREFIX,
      label: ui("appointments_timeline_prefix_package_end"),
    },
    {
      source: EXTERNAL_HANDOFF_PREFIX,
      label: ui("appointments_timeline_prefix_external_handoff"),
    },
    {
      source: BILLING_HANDOFF_PREFIX,
      label: ui("appointments_timeline_prefix_billing_handoff"),
    },
    {
      source: FINDINGS_PREFIX,
      label: ui("appointments_timeline_prefix_findings"),
    },
    {
      source: FINDINGS_CHECKLIST_PREFIX,
      label: ui("appointments_timeline_prefix_findings"),
    },
    {
      source: INCOMING_DATA_PREFIX,
      label: ui("appointments_timeline_prefix_incoming_data"),
    },
    {
      source: INCOMING_DATA_CHECKLIST_PREFIX,
      label: ui("appointments_timeline_prefix_incoming_data"),
    },
  ];

  const events: AppointmentTimelineEvent[] = [
    {
      id: `created:${detail.id}`,
      occurredAt: detail.created_at,
      title: labels.appointments_timeline_appointment_created,
      detail: `${detail.patient_pid} · ${detail.title}`,
      kind: "workflow",
      tone: "info",
    },
    {
      id: `slot:${detail.id}`,
      occurredAt: `${detail.date}T${detail.time_start ?? "09:00"}`,
      title: labels.appointments_timeline_scheduled_slot,
      detail: [
        buildSlotLabel(detail),
        detail.provider_name
          ? ui("appointments_description_clinic", {
              clinic: detail.provider_name,
            })
          : "",
        detail.doctor_name
          ? ui("appointments_description_doctor", {
              doctor: detail.doctor_name,
            })
          : "",
      ]
        .filter(Boolean)
        .join(" · "),
      kind: "workflow",
      tone: "neutral",
    },
  ];

  if (detail.interpreter_name || detail.interpreter_response) {
    events.push({
      id: `interpreter:${detail.id}`,
      occurredAt: `${detail.date}T${detail.time_start ?? "09:00"}`,
      title: !detail.interpreter_name
        ? labels.appointments_timeline_interpreter_pending
        : detail.interpreter_response === "accepted"
          ? labels.appointments_timeline_interpreter_accepted
          : detail.interpreter_response === "declined"
            ? labels.appointments_timeline_interpreter_declined
            : detail.interpreter_response === "discussion"
              ? labels.appointments_timeline_interpreter_discussion
              : labels.appointments_timeline_interpreter_assigned,
      detail: [detail.interpreter_name, detail.interpreter_response]
        .filter(Boolean)
        .join(" · "),
      kind: "interpreter",
      tone:
        detail.interpreter_response === "accepted"
          ? "success"
          : detail.interpreter_response === "declined"
            ? "danger"
            : detail.interpreter_response === "discussion"
              ? "warning"
              : "info",
    });
  }

  for (const item of checklist) {
    events.push({
      id: `checklist:${item.id}`,
      occurredAt: item.completed_at ?? detail.created_at,
      title: item.is_completed
        ? labels.appointments_timeline_checklist_completed
        : labels.appointments_timeline_checklist_pending,
      detail: localizeKnownTimelineText(item.item_text, labels, timelinePrefixLabels),
      kind: kindFromTitle(item.item_text),
      tone: item.is_completed ? "success" : "warning",
    });
  }

  for (const item of reminders) {
    events.push({
      id: `reminder:${item.id}`,
      occurredAt: item.completed_at ?? item.remind_at,
      title: localizeKnownTimelineText(item.title, labels, timelinePrefixLabels),
      detail: [item.user_name, localizeKnownTimelineText(item.description, labels, timelinePrefixLabels)]
        .filter(Boolean)
        .join(" · "),
      kind: kindFromTitle(item.title),
      tone: item.is_completed ? "success" : "info",
    });
  }

  for (const task of tasks) {
    events.push({
      id: `task:${task.id}`,
      occurredAt: task.completed_at ?? task.due_date ?? task.created_at,
      title: localizeKnownTimelineText(task.title, labels, timelinePrefixLabels),
      detail: [
        task.assigned_to_name,
        task.assigned_to_role,
        localizeKnownTimelineText(task.description, labels, timelinePrefixLabels),
      ]
        .filter(Boolean)
        .join(" · "),
      kind: kindFromTitle(task.title),
      tone: toneFromTaskStatus(task.status),
    });
  }

  for (const service of services) {
    events.push({
      id: `service:${service.id}`,
      occurredAt:
        service.completed_at ?? service.starts_at ?? service.created_at,
      title: localizeKnownTimelineText(service.title, labels, timelinePrefixLabels),
      detail: [service.assigned_concierge_name, service.status]
        .filter(Boolean)
        .join(" · "),
      kind: "concierge",
      tone: service.status === "completed" ? "success" : "info",
    });
  }

  for (const item of communications) {
    events.push({
      id: `communication:${item.id}:created`,
      occurredAt: item.created_at,
      title: localizeKnownTimelineText(item.subject, labels, timelinePrefixLabels),
      detail: [
        formatUiText("{direction} {via} {channel}", {
          direction: communicationDirectionLabel(item.direction),
          via: dictionary.appointments_common_via,
          channel: communicationChannelLabel(item.channel),
        }),
        communicationTargetLabel(item),
        item.contact_name ?? "",
        localizeKnownTimelineText(item.message, labels, timelinePrefixLabels),
      ]
        .filter(Boolean)
        .join(" · "),
      kind: "communication",
      tone: toneFromCommunicationStatus(item.status),
    });

    if (item.responded_at) {
      events.push({
        id: `communication:${item.id}:answered`,
        occurredAt: item.responded_at,
        title: labels.appointments_timeline_external_response_logged,
        detail: [
          communicationTargetLabel(item),
          item.created_by_name,
          localizeKnownTimelineText(item.message, labels, timelinePrefixLabels),
        ]
          .filter(Boolean)
          .join(" · "),
        kind: "communication",
        tone: "success",
      });
    }

    if (item.closed_at) {
      events.push({
        id: `communication:${item.id}:closed`,
        occurredAt: item.closed_at,
        title:
          item.status === "cancelled"
            ? labels.appointments_timeline_external_communication_cancelled
            : labels.appointments_timeline_external_communication_closed,
        detail: [communicationTargetLabel(item), item.created_by_name]
          .filter(Boolean)
          .join(" · "),
        kind: "communication",
        tone: item.status === "cancelled" ? "danger" : "success",
      });
    }
  }

  if (report) {
    events.push({
      id: `report:${report.id}:submitted`,
      occurredAt: report.created_at,
      title: labels.appointments_timeline_interpreter_report_submitted,
      detail: `${report.interpreter_name} · ${report.hours}h`,
      kind: "interpreter",
      tone: report.approval_status === "approved" ? "success" : "info",
    });

    if (report.approval_status !== "pending") {
      events.push({
        id: `report:${report.id}:reviewed`,
        occurredAt: report.approved_at ?? report.created_at,
        title:
          report.approval_status === "approved"
            ? labels.appointments_timeline_interpreter_report_approved
            : labels.appointments_timeline_interpreter_report_rejected,
        detail: [report.approved_by_name, localizeKnownTimelineText(report.notes, labels, timelinePrefixLabels)]
          .filter(Boolean)
          .join(" · "),
        kind: "interpreter",
        tone: report.approval_status === "approved" ? "success" : "danger",
      });
    }
  }

  return events
    .filter((item) => Boolean(item.occurredAt))
    .toSorted((left, right) => right.occurredAt.localeCompare(left.occurredAt));
}
