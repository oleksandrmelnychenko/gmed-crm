import type { EventInput } from "@fullcalendar/core";

import type {
  AppointmentListItem,
  CalendarEventExtendedProps,
} from "@/pages/appointments/model/types";

function appointmentEventClass(item: AppointmentListItem) {
  if (item.is_blocked) return "fc-apt-event-blocked";
  switch (item.status) {
    case "completed":
      return "fc-apt-event-status-completed";
    case "cancelled":
      return "fc-apt-event-status-cancelled";
    case "in_progress":
      return "fc-apt-event-status-in-progress";
    case "confirmed":
      return "fc-apt-event-status-confirmed";
    default:
      return "fc-apt-event-status-planned";
  }
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
