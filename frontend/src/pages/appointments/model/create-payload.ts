import { normalizeCarePathKindForAppointmentType } from "./labels";
import {
  hasPairedAppointmentTimes,
  hasValidAppointmentTimeRange,
  serializeAppointmentTimes,
} from "./date-time";
import type { AppointmentFormState } from "./types";
import { parsePositiveIntegerInput } from "./workflow-helpers";

export type CreateAppointmentValidationMessages = {
  patientRequired: string;
  titleRequired: string;
  dateRequired: string;
  medicalProviderRequired: string;
  timePairError: string;
  timeRangeError: string;
  repeatIntervalError: string;
  repeatRequireEndError: string;
};

export function validateCreateAppointmentForm(
  form: AppointmentFormState,
  messages: CreateAppointmentValidationMessages,
) {
  const repeatInterval = parsePositiveIntegerInput(form.repeatInterval);
  const repeatCount = parsePositiveIntegerInput(form.repeatCount);

  if (!form.patientId) {
    return { error: messages.patientRequired, repeatCount, repeatInterval };
  }
  if (!form.title.trim()) {
    return { error: messages.titleRequired, repeatCount, repeatInterval };
  }
  if (!form.date) {
    return { error: messages.dateRequired, repeatCount, repeatInterval };
  }
  if (!hasPairedAppointmentTimes(form.timeStart, form.timeEnd)) {
    return { error: messages.timePairError, repeatCount, repeatInterval };
  }
  if (!hasValidAppointmentTimeRange(form.timeStart, form.timeEnd)) {
    return { error: messages.timeRangeError, repeatCount, repeatInterval };
  }
  if (
    form.appointmentType === "medical" &&
    !form.providerId &&
    !form.skipMedicalProviderBinding
  ) {
    return { error: messages.medicalProviderRequired, repeatCount, repeatInterval };
  }
  if (form.repeatEnabled) {
    if (!repeatInterval) {
      return { error: messages.repeatIntervalError, repeatCount, repeatInterval };
    }
    if (
      (form.repeatEndMode === "count" && !repeatCount) ||
      (form.repeatEndMode === "until" && !form.repeatUntil)
    ) {
      return { error: messages.repeatRequireEndError, repeatCount, repeatInterval };
    }
  }

  return { error: "", repeatCount, repeatInterval };
}

export function buildCreateAppointmentPayload(
  form: AppointmentFormState,
  repeatInterval = parsePositiveIntegerInput(form.repeatInterval),
  repeatCount = parsePositiveIntegerInput(form.repeatCount),
) {
  const times = serializeAppointmentTimes(form.timeStart, form.timeEnd);
  const recurrenceUntil =
    form.repeatEnabled &&
    form.repeatEndMode === "until" &&
    form.repeatUntil
      ? form.repeatUntil
      : null;
  const recurrenceCount =
    form.repeatEnabled && form.repeatEndMode === "count"
      ? repeatCount
      : null;

  return {
    patient_id: form.patientId,
    provider_id: form.providerId || null,
    doctor_id: form.doctorId || null,
    owner_user_id: form.ownerUserId || null,
    interpreter_id: form.interpreterId || null,
    appointment_type: form.appointmentType,
    skip_medical_provider_binding:
      form.appointmentType === "medical" &&
      !form.providerId &&
      form.skipMedicalProviderBinding,
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
    recurrence_frequency: form.repeatEnabled ? form.repeatFrequency : null,
    recurrence_interval: form.repeatEnabled ? repeatInterval : null,
    recurrence_count: recurrenceCount,
    recurrence_until: recurrenceUntil,
  };
}
