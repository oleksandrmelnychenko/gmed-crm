import { apiFetch } from "@/lib/api";
import type {
  AppointmentRequestItem,
  AppointmentRequestStatus,
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

export type ConvertAppointmentRequestInput = {
  providerId: string | null;
  doctorId: string | null;
  ownerUserId: string | null;
  interpreterId: string | null;
  orderId: string | null;
  title: string;
  date: string;
  timeStart: string | null;
  timeEnd: string | null;
  location: string | null;
  category: string | null;
  notes: string | null;
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

export function reviewAppointmentRequest(
  requestId: string,
  status: Extract<AppointmentRequestStatus, "approved" | "rejected">,
  reviewNote?: string,
) {
  return apiFetch<AppointmentRequestItem>(
    `/appointments/requests/${requestId}/review`,
    {
      method: "POST",
      body: JSON.stringify({
        status,
        review_note: reviewNote?.trim() || undefined,
      }),
    },
  );
}

export function convertAppointmentRequest(
  requestId: string,
  input: ConvertAppointmentRequestInput,
) {
  return apiFetch<{
    ok: boolean;
    request_id: string;
    appointment_id: string;
    status: "converted";
  }>(`/appointments/requests/${requestId}/convert`, {
    method: "POST",
    body: JSON.stringify({
      provider_id: input.providerId,
      doctor_id: input.doctorId,
      owner_user_id: input.ownerUserId,
      interpreter_id: input.interpreterId,
      order_id: input.orderId,
      title: input.title.trim(),
      date: input.date,
      time_start: input.timeStart,
      time_end: input.timeEnd,
      location: input.location?.trim() || null,
      category: input.category?.trim() || null,
      notes: input.notes?.trim() || null,
    }),
  });
}
