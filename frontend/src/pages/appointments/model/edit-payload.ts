import { normalizeCarePathKindForAppointmentType } from "./labels";
import type {
  AppointmentDetail,
  AppointmentFormState,
  AppointmentRecurringActionScope,
} from "./types";
import { parsePositiveIntegerInput } from "./workflow-helpers";

export function shouldApplyAppointmentRecurrenceRule(
  detail: AppointmentDetail,
  recurrenceScope: AppointmentRecurringActionScope,
) {
  return Boolean(detail.recurrence_frequency) && recurrenceScope !== "single";
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
    recurrenceScope,
  );
  const repeatInterval = parsePositiveIntegerInput(form.repeatInterval);
  const repeatCount = parsePositiveIntegerInput(form.repeatCount);
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
    time_start: form.timeStart || null,
    time_end: form.timeEnd || null,
    location: form.location.trim() || null,
    category: form.category.trim() || null,
    notes: form.notes.trim() || null,
    recurrence_scope: detail.recurrence_frequency ? recurrenceScope : "single",
  };

  if (applyRecurrenceRule) {
    payload.recurrence_frequency = form.repeatFrequency;
    payload.recurrence_interval = repeatInterval;
    payload.recurrence_count = repeatCount;
    payload.recurrence_until = form.repeatUntil || null;
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
