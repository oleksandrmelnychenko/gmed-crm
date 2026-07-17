import { normalizeCarePathKindForAppointmentType } from "./labels";
import {
  hasPairedAppointmentTimes,
  hasValidAppointmentTimeRange,
  serializeAppointmentTimes,
} from "./date-time";
import type {
  AppointmentDetail,
  AppointmentFormState,
  AppointmentRecurringActionScope,
} from "./types";
import { parsePositiveIntegerInput } from "./workflow-helpers";

export type EditAppointmentValidationMessages = {
  titleRequired: string;
  dateRequired: string;
  medicalProviderRequired: string;
  timePairError: string;
  timeRangeError: string;
  repeatIntervalError: string;
  repeatRequireEndError: string;
};

export function defaultEditAppointmentRecurrenceScope(): AppointmentRecurringActionScope {
  return "single";
}

export function shouldApplyAppointmentRecurrenceRule(
  detail: AppointmentDetail,
  form: AppointmentFormState,
  recurrenceScope: AppointmentRecurringActionScope,
) {
  if (!detail.recurrence_frequency || recurrenceScope === "single") {
    return false;
  }

  const interval = parsePositiveIntegerInput(form.repeatInterval);
  const count = parsePositiveIntegerInput(form.repeatCount);
  const totalOccurrences =
    detail.recurrence_series_size || detail.recurrence_count;
  const detailEndMode = detail.recurrence_end_mode ?? "count";
  return (
    form.repeatFrequency !== detail.recurrence_frequency ||
    interval !== detail.recurrence_interval ||
    form.repeatEndMode !== detailEndMode ||
    (form.repeatEndMode === "count" && count !== totalOccurrences) ||
    (form.repeatEndMode === "until" &&
      (form.repeatUntil || null) !== detail.recurrence_until)
  );
}

export function validateEditAppointmentForm(
  detail: AppointmentDetail,
  form: AppointmentFormState,
  recurrenceScope: AppointmentRecurringActionScope,
  messages: EditAppointmentValidationMessages,
) {
  const applyRecurrenceRule = shouldApplyAppointmentRecurrenceRule(
    detail,
    form,
    recurrenceScope,
  );
  const repeatInterval = parsePositiveIntegerInput(form.repeatInterval);
  const repeatCount = parsePositiveIntegerInput(form.repeatCount);

  if (!form.title.trim()) {
    return { error: messages.titleRequired };
  }
  if (!form.date) {
    return { error: messages.dateRequired };
  }
  if (!hasPairedAppointmentTimes(form.timeStart, form.timeEnd)) {
    return { error: messages.timePairError };
  }
  if (!hasValidAppointmentTimeRange(form.timeStart, form.timeEnd)) {
    return { error: messages.timeRangeError };
  }
  if (
    form.appointmentType === "medical" &&
    !form.providerId &&
    !form.skipMedicalProviderBinding
  ) {
    return { error: messages.medicalProviderRequired };
  }
  if (applyRecurrenceRule && !repeatInterval) {
    return { error: messages.repeatIntervalError };
  }
  if (
    applyRecurrenceRule &&
    ((form.repeatEndMode === "count" && !repeatCount) ||
      (form.repeatEndMode === "until" && !form.repeatUntil))
  ) {
    return { error: messages.repeatRequireEndError };
  }

  return { error: "" };
}

export function buildEditAppointmentUpdatePayload({
  detail,
  form,
  recurrenceScope,
  canEditAppointmentType,
  canManageChecklist,
}: {
  detail: AppointmentDetail;
  form: AppointmentFormState;
  recurrenceScope: AppointmentRecurringActionScope;
  canEditAppointmentType: boolean;
  canManageChecklist: boolean;
}) {
  const applyRecurrenceRule = shouldApplyAppointmentRecurrenceRule(
    detail,
    form,
    recurrenceScope,
  );
  const repeatInterval = parsePositiveIntegerInput(form.repeatInterval);
  const repeatCount = parsePositiveIntegerInput(form.repeatCount);
  const times = serializeAppointmentTimes(form.timeStart, form.timeEnd);
  const payload: Record<string, unknown> = {
    provider_id: form.providerId || null,
    doctor_id: form.doctorId || null,
    owner_user_id: form.ownerUserId || null,
    interpreter_id: form.interpreterId || null,
    care_path_kind: normalizeCarePathKindForAppointmentType(
      form.appointmentType,
      form.carePathKind,
    ),
    title: form.title.trim(),
    date: form.date,
    time_start: times.timeStart,
    time_end: times.timeEnd,
    location: form.location.trim() || null,
    category: form.category.trim() || null,
    notes: form.notes.trim() || null,
    skip_medical_provider_binding:
      form.appointmentType === "medical" &&
      !form.providerId &&
      form.skipMedicalProviderBinding,
    recurrence_scope: detail.recurrence_frequency ? recurrenceScope : "single",
  };

  if (applyRecurrenceRule) {
    payload.recurrence_frequency = form.repeatFrequency;
    payload.recurrence_interval = repeatInterval;
    payload.recurrence_count =
      form.repeatEndMode === "count" ? repeatCount : null;
    payload.recurrence_until =
      form.repeatEndMode === "until" ? form.repeatUntil || null : null;
  }
  if (canEditAppointmentType) {
    payload.appointment_type = form.appointmentType;
  }
  if (canManageChecklist) {
    payload.checklist_phase = form.checklistPhase;
  }

  return {
    applyRecurrenceRule,
    payload,
    repeatCount,
    repeatInterval,
  };
}
