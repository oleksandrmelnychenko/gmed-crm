import { FOLLOW_UP_PRESETS } from "./constants";
import { currentDateInput, shiftLocalDateTime } from "./date-time";
import type {
  AppointmentDetail,
  AppointmentFormState,
  AppointmentRecurringActionScope,
  AppointmentStatus,
  BillingHandoffFormState,
  BillingHandoffKind,
  ChecklistFormState,
  ConciergeServiceFormState,
  DoctorFollowUpFormState,
  ExternalHandoffFormState,
  FindingsFollowUpArtifact,
  FindingsFollowUpFormState,
  FollowUpVisitFormState,
  IncomingDataFormState,
  IncomingDataSource,
  PackageEndFollowUpFormState,
  PatientAssignment,
  ReminderFormState,
  ReportFormState,
  TaskFormState,
} from "./types";

export function blankAppointmentForm(): AppointmentFormState {
  const today = currentDateInput();
  return {
    patientId: "",
    providerId: "",
    providerTaxonomyNodeId: "",
    doctorId: "",
    ownerUserId: "",
    interpreterId: "",
    appointmentType: "medical",
    carePathKind: "regular",
    status: "planned",
    checklistPhase: "preparation",
    title: "",
    date: today,
    timeStart: "",
    timeEnd: "",
    location: "",
    category: "",
    notes: "",
    skipMedicalProviderBinding: false,
    repeatEnabled: false,
    repeatFrequency: "weekly",
    repeatInterval: "1",
    repeatCount: "4",
    repeatUntil: "",
  };
}

export function defaultAppointmentOwnerUserId(
  currentUserId?: string,
  currentUserRole?: string,
) {
  if (!currentUserId || currentUserRole === "interpreter") {
    return "";
  }

  return currentUserId;
}

export function blankAppointmentFormForCurrentUser(
  currentUserId?: string,
  currentUserRole?: string,
): AppointmentFormState {
  return {
    ...blankAppointmentForm(),
    ownerUserId: defaultAppointmentOwnerUserId(currentUserId, currentUserRole),
  };
}

const APPOINTMENT_FORM_DIRTY_FIELDS: Array<keyof AppointmentFormState> = [
  "patientId",
  "providerId",
  "doctorId",
  "ownerUserId",
  "interpreterId",
  "appointmentType",
  "carePathKind",
  "status",
  "checklistPhase",
  "title",
  "date",
  "timeStart",
  "timeEnd",
  "location",
  "category",
  "notes",
  "skipMedicalProviderBinding",
  "repeatEnabled",
  "repeatFrequency",
  "repeatInterval",
  "repeatCount",
  "repeatUntil",
];

export function hasAppointmentFormChanges(
  current: AppointmentFormState,
  initial: AppointmentFormState,
): boolean {
  return APPOINTMENT_FORM_DIRTY_FIELDS.some(
    (field) => !Object.is(current[field], initial[field]),
  );
}

export function buildEditAppointmentForm(
  detail: AppointmentDetail,
): AppointmentFormState {
  return {
    patientId: detail.patient_id,
    providerId: detail.provider_id ?? "",
    providerTaxonomyNodeId: "",
    doctorId: detail.doctor_id ?? "",
    ownerUserId: detail.owner_user_id ?? "",
    interpreterId: detail.interpreter_id ?? "",
    appointmentType: detail.type,
    carePathKind: detail.care_path_kind ?? "regular",
    status: detail.status,
    checklistPhase: detail.checklist_phase || "preparation",
    title: detail.title,
    date: detail.date,
    timeStart: detail.time_start ?? "",
    timeEnd: detail.time_end ?? "",
    location: detail.location ?? "",
    category: detail.category ?? "",
    notes: detail.notes ?? "",
    skipMedicalProviderBinding: detail.type === "medical" && !detail.provider_id,
    repeatEnabled: Boolean(detail.recurrence_frequency),
    repeatFrequency: detail.recurrence_frequency ?? "weekly",
    repeatInterval: String(detail.recurrence_interval ?? 1),
    repeatCount: detail.recurrence_count
      ? String(detail.recurrence_count)
      : "",
    repeatUntil: detail.recurrence_until ?? "",
  };
}

export function restoreEditAppointmentRecurrenceFields(
  form: AppointmentFormState,
  detail: AppointmentDetail,
): AppointmentFormState {
  const saved = buildEditAppointmentForm(detail);
  return {
    ...form,
    repeatEnabled: saved.repeatEnabled,
    repeatFrequency: saved.repeatFrequency,
    repeatInterval: saved.repeatInterval,
    repeatCount: saved.repeatCount,
    repeatUntil: saved.repeatUntil,
  };
}

export function buildFollowUpVisitForm(
  detail: AppointmentDetail,
  defaultReminderUserId = "",
  followUpLabel = "Follow-up",
  defaultOwnerUserId = detail.owner_user_id ?? "",
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
    providerTaxonomyNodeId: "",
    doctorId: detail.doctor_id ?? "",
    ownerUserId: defaultOwnerUserId,
    interpreterId: detail.interpreter_id ?? "",
    appointmentType: detail.type,
    carePathKind: "followup",
    status: "planned",
    checklistPhase: "preparation",
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
    skipMedicalProviderBinding: detail.type === "medical" && !detail.provider_id,
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

export function blankReminderForm(): ReminderFormState {
  return { userId: "", remindAt: "", title: "", description: "" };
}

export function blankDoctorFollowUpForm(
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

export function blankPackageEndFollowUpForm(
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

export function blankExternalHandoffForm(
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

export function resolveFollowUpDefaultAssignee(
  detail: AppointmentDetail,
  assignments: PatientAssignment[],
): string {
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

export function blankBillingHandoffForm(
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

export function blankFindingsFollowUpForm(
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

export function blankIncomingDataForm(
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

export function blankReportForm(): ReportFormState {
  return { hours: "", reportText: "" };
}

export function blankChecklistForm(): ChecklistFormState {
  return { phase: "preparation", itemText: "" };
}

export function defaultCompletionPlan(): Record<string, boolean> {
  return Object.fromEntries(
    FOLLOW_UP_PRESETS.map((preset) => [preset.id, true]),
  ) as Record<string, boolean>;
}

export function statusActionKey(
  appointmentId: string,
  status: AppointmentStatus,
  recurrenceScope: AppointmentRecurringActionScope = "single",
): string {
  return recurrenceScope === "single"
    ? `status:${appointmentId}:${status}`
    : `status:${appointmentId}:${status}:${recurrenceScope}`;
}

export function blankTaskForm(
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

export function blankConciergeServiceForm(
  defaults?: Partial<ConciergeServiceFormState>,
): ConciergeServiceFormState {
  return {
    providerId: defaults?.providerId ?? "",
    taxonomyNodeId: defaults?.taxonomyNodeId ?? "",
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
