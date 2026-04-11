export type AppointmentTimelineKind =
  | "workflow"
  | "interpreter"
  | "clinical"
  | "followup"
  | "concierge"
  | "communication";

export type AppointmentTimelineTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger";

export type AppointmentTimelineEvent = {
  id: string;
  occurredAt: string;
  title: string;
  detail: string;
  kind: AppointmentTimelineKind;
  tone: AppointmentTimelineTone;
};

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
  if (title.startsWith(INCOMING_DATA_PREFIX) || title.startsWith(INCOMING_DATA_CHECKLIST_PREFIX)) {
    return "clinical";
  }
  if (title.startsWith(EXTERNAL_HANDOFF_PREFIX) || title.startsWith(FINDINGS_CHECKLIST_PREFIX)) {
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
  status: TimelineCommunicationEntry["status"]
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
  switch (entry.target_type) {
    case "doctor":
      return entry.doctor_name || "Doctor";
    case "service_provider":
      return entry.provider_name || "Service provider";
    default:
      return entry.provider_name || "Clinic";
  }
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

export function buildAppointmentTimelineEvents(args: {
  detail: TimelineDetail | null;
  checklist: TimelineChecklistItem[];
  reminders: TimelineReminderEntry[];
  tasks: TimelineTaskEntry[];
  services: TimelineServiceEntry[];
  report: TimelineReportSummary | null;
  communications: TimelineCommunicationEntry[];
}) {
  const { detail, checklist, reminders, tasks, services, report, communications } = args;
  if (!detail) return [] as AppointmentTimelineEvent[];

  const events: AppointmentTimelineEvent[] = [
    {
      id: `created:${detail.id}`,
      occurredAt: detail.created_at,
      title: "Appointment created",
      detail: `${detail.patient_pid} · ${detail.title}`,
      kind: "workflow",
      tone: "info",
    },
    {
      id: `slot:${detail.id}`,
      occurredAt: `${detail.date}T${detail.time_start ?? "09:00"}`,
      title: "Scheduled slot",
      detail: [
        buildSlotLabel(detail),
        detail.provider_name ? `Clinic: ${detail.provider_name}` : "",
        detail.doctor_name ? `Doctor: ${detail.doctor_name}` : "",
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
      title: detail.interpreter_name
        ? `Interpreter ${detail.interpreter_response || "assigned"}`
        : "Interpreter pending",
      detail: [detail.interpreter_name, detail.interpreter_response].filter(Boolean).join(" · "),
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
      title: item.is_completed ? "Checklist completed" : "Checklist pending",
      detail: item.item_text,
      kind: kindFromTitle(item.item_text),
      tone: item.is_completed ? "success" : "warning",
    });
  }

  for (const item of reminders) {
    events.push({
      id: `reminder:${item.id}`,
      occurredAt: item.completed_at ?? item.remind_at,
      title: item.title,
      detail: [item.user_name, item.description ?? ""].filter(Boolean).join(" · "),
      kind: kindFromTitle(item.title),
      tone: item.is_completed ? "success" : "info",
    });
  }

  for (const task of tasks) {
    events.push({
      id: `task:${task.id}`,
      occurredAt: task.completed_at ?? task.due_date ?? task.created_at,
      title: task.title,
      detail: [task.assigned_to_name, task.assigned_to_role, task.description ?? ""]
        .filter(Boolean)
        .join(" · "),
      kind: kindFromTitle(task.title),
      tone: toneFromTaskStatus(task.status),
    });
  }

  for (const service of services) {
    events.push({
      id: `service:${service.id}`,
      occurredAt: service.completed_at ?? service.starts_at ?? service.created_at,
      title: service.title,
      detail: [service.assigned_concierge_name, service.status].filter(Boolean).join(" · "),
      kind: "concierge",
      tone: service.status === "completed" ? "success" : "info",
    });
  }

  for (const item of communications) {
    events.push({
      id: `communication:${item.id}:created`,
      occurredAt: item.created_at,
      title: item.subject,
      detail: [
        `${item.direction} via ${item.channel}`,
        communicationTargetLabel(item),
        item.contact_name ?? "",
        item.message ?? "",
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
        title: "External response logged",
        detail: [communicationTargetLabel(item), item.created_by_name, item.message ?? ""]
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
            ? "External communication cancelled"
            : "External communication closed",
        detail: [communicationTargetLabel(item), item.created_by_name].filter(Boolean).join(" · "),
        kind: "communication",
        tone: item.status === "cancelled" ? "danger" : "success",
      });
    }
  }

  if (report) {
    events.push({
      id: `report:${report.id}:submitted`,
      occurredAt: report.created_at,
      title: "Interpreter report submitted",
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
            ? "Interpreter report approved"
            : "Interpreter report rejected",
        detail: [report.approved_by_name, report.notes ?? ""].filter(Boolean).join(" · "),
        kind: "interpreter",
        tone: report.approval_status === "approved" ? "success" : "danger",
      });
    }
  }

  return events
    .filter((item) => Boolean(item.occurredAt))
    .toSorted((left, right) => right.occurredAt.localeCompare(left.occurredAt));
}
