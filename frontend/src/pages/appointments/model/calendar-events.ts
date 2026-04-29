import type { EventInput } from "@fullcalendar/core";

import type {
  AppointmentListItem,
  CalendarEventExtendedProps,
} from "@/pages/appointments/model/types";

export function appointmentEventClass(item: AppointmentListItem) {
  if (item.is_blocked) return "fc-apt-event-blocked";
  if (item.status === "completed") return "fc-apt-event-completed";
  if (item.status === "cancelled") return "fc-apt-event-cancelled";
  if (item.type === "non_medical") return "fc-apt-event-concierge";
  if (item.type === "internal") return "fc-apt-event-internal";
  return "fc-apt-event-medical";
}

export function toCalendarEvent(
  item: AppointmentListItem,
  canEditSchedule: boolean,
): EventInput {
  const timed = Boolean(item.time_start);
  return {
    id: item.id,
    title: `${item.patient_pid} · ${item.title}`,
    start: timed ? `${item.date}T${item.time_start}` : item.date,
    end: timed && item.time_end ? `${item.date}T${item.time_end}` : undefined,
    allDay: !timed,
    editable: canEditSchedule && !item.is_blocked,
    classNames: [appointmentEventClass(item)],
    extendedProps: {
      patientName: item.patient_name,
      patientPid: item.patient_pid,
      providerName: item.provider_name,
      doctorName: item.doctor_name,
      interpreterName: item.interpreter_name,
      ownerName: item.owner_name,
      location: item.location,
      appointmentType: item.type,
      appointmentStatus: item.status,
      recurrenceFrequency: item.recurrence_frequency,
      isBlocked: item.is_blocked,
    } satisfies CalendarEventExtendedProps,
  };
}
