import type {
  AppointmentCarePathKind,
  AppointmentCommunicationChannel,
  AppointmentCommunicationStatus,
  AppointmentKind,
  AppointmentRecurrenceFrequency,
  AppointmentStatus,
  InterpreterResponse,
} from "./types";

export const STATUS_OPTIONS: AppointmentStatus[] = [
  "planned",
  "confirmed",
  "in_progress",
  "completed",
  "cancelled",
];

export const TYPE_OPTIONS: AppointmentKind[] = [
  "medical",
  "non_medical",
  "internal",
];

export const CARE_PATH_KIND_OPTIONS: AppointmentCarePathKind[] = [
  "regular",
  "preventive",
  "control",
  "followup",
];

export const RECURRENCE_FREQUENCY_OPTIONS: AppointmentRecurrenceFrequency[] = [
  "daily",
  "weekly",
  "monthly",
];

export const INTERPRETER_RESPONSE_OPTIONS: InterpreterResponse[] = [
  "pending",
  "accepted",
  "declined",
  "discussion",
];

export const CHECKLIST_PHASES = ["preparation", "execution", "followup"] as const;

export const TASK_STATUS_OPTIONS = [
  "open",
  "in_progress",
  "completed",
  "cancelled",
] as const;

export const TASK_PRIORITY_OPTIONS = [
  "low",
  "normal",
  "high",
  "urgent",
] as const;

export const COMMUNICATION_STATUS_OPTIONS: AppointmentCommunicationStatus[] = [
  "planned",
  "sent",
  "answered",
  "closed",
  "cancelled",
];

export const COMMUNICATION_CHANNEL_OPTIONS: AppointmentCommunicationChannel[] = [
  "phone",
  "email",
  "portal",
  "fax",
  "whatsapp",
  "other",
];

export const CONCIERGE_SERVICE_KIND_OPTIONS = [
  "hotel",
  "transfer",
  "vip_terminal",
  "flight",
  "chauffeur",
  "translation_support",
  "other",
] as const;

export const CONCIERGE_SERVICE_STATUS_OPTIONS = [
  "planned",
  "booked",
  "confirmed",
  "in_service",
  "completed",
  "cancelled",
] as const;

export const CONCIERGE_BILLING_STATUS_OPTIONS = [
  "draft",
  "ready",
  "billed",
  "settled",
  "waived",
] as const;

export const DOCTOR_FOLLOW_UP_PREFIX = "Doctor-directed:";
export const PACKAGE_END_FOLLOW_UP_PREFIX = "Package-end:";
export const EXTERNAL_HANDOFF_PREFIX = "External handoff:";
export const BILLING_HANDOFF_PREFIX = "Billing handoff:";
export const FINDINGS_FOLLOW_UP_PREFIX = "Findings:";
export const FINDINGS_CHECKLIST_PREFIX = "[Findings]";
export const INCOMING_DATA_PREFIX = "Incoming data:";
export const INCOMING_DATA_CHECKLIST_PREFIX = "[Incoming data]";

export const FOLLOW_UP_PRESETS = [
  {
    id: "post_1w",
    offsetDays: 7,
  },
  {
    id: "post_1m",
    offsetMonths: 1,
  },
  {
    id: "post_6m",
    offsetMonths: 6,
  },
] as const;

export const CALENDAR_STORAGE_VIEW_KEY = "gmed_appointments_calendar_view";
export const CALENDAR_STORAGE_DATE_KEY = "gmed_appointments_calendar_date";
