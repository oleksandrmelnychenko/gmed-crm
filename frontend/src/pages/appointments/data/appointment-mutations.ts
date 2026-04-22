import { apiFetch } from "@/lib/api";
import type {
  AppointmentRecurringActionScope,
  AppointmentStatus,
  ConflictSummary,
} from "@/pages/appointments/model/types";

type UpdateAppointmentScheduleInput = {
  appointmentId: string;
  providerId: string | null;
  doctorId: string | null;
  ownerUserId: string | null;
  interpreterId: string | null;
  title: string;
  date: string;
  timeStart: string | null;
  timeEnd: string | null;
  location: string | null;
};

type UpdateAppointmentScheduleResult = {
  ok: boolean;
  conflicts?: ConflictSummary;
};

export function assignLinkedPatient(
  patientId: string,
  userId: string,
) {
  return apiFetch(`/patients/${patientId}/assign`, {
    method: "POST",
    body: JSON.stringify({ user_id: userId }),
  });
}

export function updateAppointmentSchedule({
  appointmentId,
  providerId,
  doctorId,
  ownerUserId,
  interpreterId,
  title,
  date,
  timeStart,
  timeEnd,
  location,
}: UpdateAppointmentScheduleInput) {
  return apiFetch<UpdateAppointmentScheduleResult>(
    `/appointments/${appointmentId}/update`,
    {
      method: "POST",
      body: JSON.stringify({
        provider_id: providerId,
        doctor_id: doctorId,
        owner_user_id: ownerUserId,
        interpreter_id: interpreterId,
        title,
        date,
        time_start: timeStart,
        time_end: timeEnd,
        location,
      }),
    },
  );
}

export function updateAppointmentStatus(
  appointmentId: string,
  status: AppointmentStatus,
  recurrenceScope: AppointmentRecurringActionScope = "single",
) {
  return apiFetch<{ ok: boolean }>(`/appointments/${appointmentId}/status`, {
    method: "POST",
    body: JSON.stringify({
      status,
      recurrence_scope: recurrenceScope,
    }),
  });
}
