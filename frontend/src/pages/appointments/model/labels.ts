import {
  formatEnumLabelFromKeys,
  formatUnknownValue,
  getLang,
  t as translateCatalog,
  uiText,
  type UiTextValues,
  type TranslationKey,
  type Translations,
} from "@/lib/i18n";
import type {
  AppointmentCarePathKind,
  AppointmentCommunicationChannel,
  AppointmentCommunicationStatus,
  AppointmentCommunicationTarget,
  AppointmentDetail,
  AppointmentRecurrenceFrequency,
  AppointmentKind,
  AppointmentStatus,
  BillingHandoffKind,
  DoctorOption,
  FindingsFollowUpArtifact,
  IncomingDataCategory,
  IncomingDataSource,
  InterpreterResponse,
  PatientSummary,
  ProviderSummary,
} from "@/pages/appointments/model/types";

type LabelKeyMap = Partial<Record<string, TranslationKey>>;

const APPOINTMENT_TYPE_LABEL_KEYS = {
  medical: "apt_type_medical",
  non_medical: "apt_type_non_medical",
  internal: "apt_type_internal",
} satisfies LabelKeyMap;

const CARE_PATH_KIND_LABEL_KEYS = {
  regular: "appointment_care_path_regular",
  preventive: "appointment_care_path_preventive",
  control: "appointment_care_path_control",
  followup: "appointment_care_path_followup",
} satisfies LabelKeyMap;

const APPOINTMENT_STATUS_LABEL_KEYS = {
  planned: "appointment_status_planned",
  confirmed: "appointment_status_confirmed",
  in_progress: "appointment_status_in_progress",
  completed: "appointment_status_completed",
  cancelled: "appointment_status_cancelled",
} satisfies LabelKeyMap;

const COMMUNICATION_STATUS_LABEL_KEYS = {
  planned: "appointment_communication_status_planned",
  sent: "appointment_communication_status_sent",
  answered: "appointment_communication_status_answered",
  closed: "appointment_communication_status_closed",
  cancelled: "appointment_communication_status_cancelled",
} satisfies LabelKeyMap;

const COMMUNICATION_CHANNEL_LABEL_KEYS = {
  phone: "appointment_communication_channel_phone",
  email: "appointment_communication_channel_email",
  portal: "appointment_communication_channel_portal",
  fax: "appointment_communication_channel_fax",
  whatsapp: "appointment_communication_channel_whatsapp",
  other: "appointment_communication_channel_other",
} satisfies LabelKeyMap;

const COMMUNICATION_TARGET_LABEL_KEYS = {
  doctor: "appointment_communication_target_doctor",
  service_provider: "appointment_communication_target_service_provider",
  clinic: "appointment_communication_target_clinic",
} satisfies LabelKeyMap;

const COMMUNICATION_DIRECTION_LABEL_KEYS = {
  inbound: "appointment_communication_direction_inbound",
  outbound: "appointment_communication_direction_outbound",
} satisfies LabelKeyMap;

const INTERPRETER_RESPONSE_LABEL_KEYS = {
  pending: "appointment_interpreter_response_pending",
  accepted: "appointment_interpreter_response_accepted",
  declined: "appointment_interpreter_response_declined",
  discussion: "appointment_interpreter_response_discussion",
} satisfies LabelKeyMap;

const RECURRENCE_FREQUENCY_LABEL_KEYS = {
  daily: "appointment_recurrence_frequency_daily",
  weekly: "appointment_recurrence_frequency_weekly",
  monthly: "appointment_recurrence_frequency_monthly",
} satisfies LabelKeyMap;

const FINDINGS_ARTIFACT_LABEL_KEYS = {
  arztbrief: "appointment_findings_artifact_arztbrief",
  written_findings: "appointment_findings_artifact_written_findings",
  both: "appointment_findings_artifact_both",
} satisfies LabelKeyMap;

const INCOMING_DATA_SOURCE_LABEL_KEYS = {
  patient: "appointment_incoming_source_patient",
  doctor: "appointment_incoming_source_doctor",
  clinic: "appointment_incoming_source_clinic",
  interpreter: "appointment_incoming_source_interpreter",
  external_lab: "appointment_incoming_source_external_lab",
  other: "appointment_incoming_source_other",
} satisfies LabelKeyMap;

const INCOMING_DATA_CATEGORY_LABEL_KEYS = {
  medical_update: "appointment_incoming_category_medical_update",
  diagnosis: "appointment_incoming_category_diagnosis",
  medication: "appointment_incoming_category_medication",
  symptom: "appointment_incoming_category_symptom",
  lab_result: "appointment_incoming_category_lab_result",
  imaging: "appointment_incoming_category_imaging",
  recommendation: "appointment_incoming_category_recommendation",
  risk_flag: "appointment_incoming_category_risk_flag",
  other: "appointment_incoming_category_other",
} satisfies LabelKeyMap;

const TASK_STATUS_LABEL_KEYS = {
  open: "appointment_task_status_open",
  in_progress: "appointment_task_status_in_progress",
  completed: "appointment_task_status_completed",
  cancelled: "appointment_task_status_cancelled",
} satisfies LabelKeyMap;

const TASK_PRIORITY_LABEL_KEYS = {
  low: "appointment_task_priority_low",
  normal: "appointment_task_priority_normal",
  medium: "appointment_task_priority_medium",
  high: "appointment_task_priority_high",
  urgent: "appointment_task_priority_urgent",
} satisfies LabelKeyMap;

const BILLING_HANDOFF_KIND_LABEL_KEYS = {
  interpreter_hours: "appointment_billing_handoff_kind_interpreter_hours",
  concierge_settlement: "appointment_billing_handoff_kind_concierge_settlement",
  patient_invoice: "appointment_billing_handoff_kind_patient_invoice",
  provider_invoice: "appointment_billing_handoff_kind_provider_invoice",
  payment_confirmation: "appointment_billing_handoff_kind_payment_confirmation",
  other: "appointment_billing_handoff_kind_other",
} satisfies LabelKeyMap;

const CONCIERGE_SERVICE_KIND_LABEL_KEYS = {
  hotel: "appointment_concierge_service_kind_hotel",
  transfer: "appointment_concierge_service_kind_transfer",
  vip_terminal: "appointment_concierge_service_kind_vip_terminal",
  flight: "appointment_concierge_service_kind_flight",
  chauffeur: "appointment_concierge_service_kind_chauffeur",
  translation_support: "appointment_concierge_service_kind_translation_support",
  other: "appointment_concierge_service_kind_other",
} satisfies LabelKeyMap;

const CONCIERGE_SERVICE_STATUS_LABEL_KEYS = {
  planned: "appointment_concierge_service_status_planned",
  booked: "appointment_concierge_service_status_booked",
  confirmed: "appointment_concierge_service_status_confirmed",
  in_service: "appointment_concierge_service_status_in_service",
  completed: "appointment_concierge_service_status_completed",
  cancelled: "appointment_concierge_service_status_cancelled",
} satisfies LabelKeyMap;

const BILLING_STATUS_LABEL_KEYS = {
  draft: "appointment_billing_status_draft",
  planned: "appointment_billing_status_planned",
  ready: "appointment_billing_status_ready",
  submitted: "appointment_billing_status_submitted",
  approved: "appointment_billing_status_approved",
  settled: "appointment_billing_status_settled",
  paid: "appointment_billing_status_paid",
  cancelled: "appointment_billing_status_cancelled",
  billed: "appointment_billing_status_billed",
  waived: "appointment_billing_status_waived",
} satisfies LabelKeyMap;

const FOLLOW_UP_PRESET_LABEL_KEYS = {
  post_1w: "appointment_follow_up_preset_post_1w_label",
  post_1m: "appointment_follow_up_preset_post_1m_label",
  post_6m: "appointment_follow_up_preset_post_6m_label",
} satisfies LabelKeyMap;

const FOLLOW_UP_PRESET_TITLE_KEYS = {
  post_1w: "appointment_follow_up_preset_post_1w_title",
  post_1m: "appointment_follow_up_preset_post_1m_title",
  post_6m: "appointment_follow_up_preset_post_6m_title",
} satisfies LabelKeyMap;

const INTERPRETER_PREFERENCE_LABEL_KEYS = {
  preferred: "appointment_interpreter_preference_preferred",
  neutral: "appointment_interpreter_preference_neutral",
  avoid: "appointment_interpreter_preference_avoid",
} satisfies LabelKeyMap;

const INTERPRETER_LANGUAGE_STATUS_LABEL_KEYS = {
  "language unknown": "appointment_interpreter_language_status_unknown",
  "language match": "appointment_interpreter_language_status_match",
  "language missing": "appointment_interpreter_language_status_missing",
  "missing language": "appointment_interpreter_language_status_missing",
} satisfies LabelKeyMap;

const INTERPRETER_REASON_LABEL_KEYS = {
  "preferred for this patient": "appointment_interpreter_reason_preferred_patient",
  "worked before": "appointment_interpreter_reason_worked_before",
  "high feedback": "appointment_interpreter_reason_high_feedback",
  "language match": "appointment_interpreter_reason_language_match",
} satisfies LabelKeyMap;

function runtimeTranslations() {
  return translateCatalog(getLang());
}

function translationsFromRecord(tr?: Record<string, string>) {
  return tr ? (tr as unknown as Translations) : runtimeTranslations();
}

function labelFromKeys(
  value: string | null | undefined,
  labelKeys: LabelKeyMap,
  translations: Translations = runtimeTranslations(),
) {
  return formatEnumLabelFromKeys(value, labelKeys, translations);
}

function unknownAppointmentValue(value: unknown) {
  return formatUnknownValue(value, runtimeTranslations());
}

export function appointmentText(key: string, values?: UiTextValues): string;
export function appointmentText(
  key: string,
  values?: UiTextValues,
) {
  return uiText(key, getLang(), values);
}

export function roleLabel(role?: string | null) {
  const tr = runtimeTranslations();
  if (!role) return "";
  const translated = tr[`role_${role}` as keyof typeof tr];
  return typeof translated === "string"
    ? translated
    : unknownAppointmentValue(role);
}

export function appointmentTypeLabel(
  type: AppointmentKind,
  tr?: Record<string, string>,
) {
  return labelFromKeys(type, APPOINTMENT_TYPE_LABEL_KEYS, translationsFromRecord(tr));
}

export function carePathKindLabel(value?: string | null) {
  return labelFromKeys(value, CARE_PATH_KIND_LABEL_KEYS);
}

export function normalizeCarePathKindForAppointmentType(
  appointmentType: AppointmentKind,
  carePathKind: AppointmentCarePathKind,
): AppointmentCarePathKind {
  return appointmentType === "medical" ? carePathKind : "regular";
}

export function statusLabel(status: AppointmentStatus | string | null | undefined) {
  return labelFromKeys(status, APPOINTMENT_STATUS_LABEL_KEYS);
}

export function communicationStatusLabel(
  status: AppointmentCommunicationStatus | string | null | undefined,
) {
  return labelFromKeys(status, COMMUNICATION_STATUS_LABEL_KEYS);
}

export function communicationChannelLabel(
  channel: AppointmentCommunicationChannel | string | null | undefined,
) {
  return labelFromKeys(channel, COMMUNICATION_CHANNEL_LABEL_KEYS);
}

export function communicationDirectionLabel(value?: string | null) {
  return labelFromKeys(value, COMMUNICATION_DIRECTION_LABEL_KEYS);
}

export function communicationTargetLabel(
  target: AppointmentCommunicationTarget,
  detail?: AppointmentDetail | null,
) {
  if (target === "doctor") {
    return detail?.doctor_name || labelFromKeys(target, COMMUNICATION_TARGET_LABEL_KEYS);
  }
  if (target === "service_provider") {
    return detail?.provider_name || labelFromKeys(target, COMMUNICATION_TARGET_LABEL_KEYS);
  }
  return detail?.provider_name || labelFromKeys("clinic", COMMUNICATION_TARGET_LABEL_KEYS);
}

export function responseLabel(value: InterpreterResponse | string | null | undefined) {
  return labelFromKeys(value, INTERPRETER_RESPONSE_LABEL_KEYS);
}

export function attentionIssueLabel(count: number) {
  return count === 1
    ? appointmentText("appointments_open_issue")
    : appointmentText("appointments_open_issues");
}

export function reportApprovalLabel(status: string) {
  switch (status) {
    case "approved":
      return appointmentText("appointments_approved");
    case "rejected":
      return appointmentText("appointments_rejected");
    case "pending_review":
      return appointmentText("appointments_pending_review");
    case "needs_interpreter_revision":
      return appointmentText("appointments_needs_interpreter_revision");
    default:
      return unknownAppointmentValue(status);
  }
}

export function interpreterReportBillingSyncLabel(
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

export function patientName(patient: PatientSummary) {
  const name = `${patient.first_name ?? ""} ${patient.last_name ?? ""}`.trim();
  return name || patient.patient_id;
}

export function doctorLabel(doctor: DoctorOption) {
  return doctor.fachbereich
    ? `${doctor.name} (${doctor.fachbereich})`
    : doctor.name;
}

export function providerLabel(provider: ProviderSummary) {
  return provider.address_city
    ? `${provider.name} · ${provider.address_city}`
    : provider.name;
}

export function staffLabel(option: { name: string; role: string }) {
  return `${option.name} · ${roleLabel(option.role)}`;
}

export function recurrenceFrequencyLabel(
  value: AppointmentRecurrenceFrequency | string | null | undefined,
) {
  return labelFromKeys(value, RECURRENCE_FREQUENCY_LABEL_KEYS);
}

export function findingsArtifactLabel(
  value: FindingsFollowUpArtifact | string | null | undefined,
) {
  return labelFromKeys(value, FINDINGS_ARTIFACT_LABEL_KEYS);
}

export function incomingDataSourceLabel(
  value: IncomingDataSource | string | null | undefined,
) {
  return labelFromKeys(value, INCOMING_DATA_SOURCE_LABEL_KEYS);
}

export function incomingDataCategoryLabel(
  value: IncomingDataCategory | string | null | undefined,
) {
  return labelFromKeys(value, INCOMING_DATA_CATEGORY_LABEL_KEYS);
}

export function taskStatusLabel(status: string | null | undefined) {
  return labelFromKeys(status, TASK_STATUS_LABEL_KEYS);
}

export function taskPriorityLabel(priority: string | null | undefined) {
  return labelFromKeys(priority, TASK_PRIORITY_LABEL_KEYS);
}

export function billingHandoffKindLabel(
  kind: BillingHandoffKind | string | null | undefined,
) {
  return labelFromKeys(kind, BILLING_HANDOFF_KIND_LABEL_KEYS);
}

export function serviceKindLabel(kind: string | null | undefined) {
  return labelFromKeys(kind, CONCIERGE_SERVICE_KIND_LABEL_KEYS);
}

export function serviceStatusLabel(status: string | null | undefined) {
  return labelFromKeys(status, CONCIERGE_SERVICE_STATUS_LABEL_KEYS);
}

export function billingStatusLabel(status: string | null | undefined) {
  return labelFromKeys(status, BILLING_STATUS_LABEL_KEYS);
}

export function followUpPresetLabel(presetId: string | null | undefined) {
  return labelFromKeys(presetId, FOLLOW_UP_PRESET_LABEL_KEYS);
}

export function followUpPresetTitle(presetId: string | null | undefined) {
  return labelFromKeys(presetId, FOLLOW_UP_PRESET_TITLE_KEYS);
}

export function interpreterPreferenceLabel(value?: string | null) {
  return labelFromKeys(value, INTERPRETER_PREFERENCE_LABEL_KEYS);
}

export function interpreterLanguageStatusLabel(value?: string | null) {
  return labelFromKeys(value, INTERPRETER_LANGUAGE_STATUS_LABEL_KEYS);
}

export function interpreterSuggestionReasonLabel(value: string) {
  const labelKey =
    INTERPRETER_REASON_LABEL_KEYS[
      value as keyof typeof INTERPRETER_REASON_LABEL_KEYS
    ];
  const tr = runtimeTranslations();
  return labelKey ? tr[labelKey] : value;
}
