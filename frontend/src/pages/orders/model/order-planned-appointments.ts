import { dateKeyWeekday, formatAppDate } from "@/lib/app-time-zone";

import type { OrderPipelineAppointment } from "./order-pipeline";

export type PlannedAppointmentGroup = {
  key: string;
  date: string | null;
  doctorName: string | null;
  providerName: string | null;
  appointments: OrderPipelineAppointment[];
};

const WEEKDAYS = {
  de: ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"],
  ru: ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"],
};

function appendToGroup(
  groups: Map<string, PlannedAppointmentGroup>,
  key: string,
  group: Omit<PlannedAppointmentGroup, "key" | "appointments">,
  appointment: OrderPipelineAppointment,
) {
  const current = groups.get(key);
  if (current) {
    current.appointments.push(appointment);
  } else {
    groups.set(key, { key, ...group, appointments: [appointment] });
  }
}

/** A cancelled appointment is not part of the plan, as in the plan PDF. */
function plannedAppointments(appointments: readonly OrderPipelineAppointment[]) {
  return appointments.filter((appointment) => appointment.status !== "cancelled");
}

/** Days in calendar order: the server sends the appointments sorted by date and time. */
export function groupAppointmentsByDay(
  appointments: readonly OrderPipelineAppointment[],
): PlannedAppointmentGroup[] {
  const groups = new Map<string, PlannedAppointmentGroup>();
  for (const appointment of plannedAppointments(appointments)) {
    appendToGroup(
      groups,
      appointment.date,
      { date: appointment.date, doctorName: null, providerName: null },
      appointment,
    );
  }
  return [...groups.values()];
}

/**
 * Doctors in the order of their first appointment. Doctors are told apart with
 * their provider, because the pipeline gives names only; appointments without
 * a doctor stay under their provider, and those without either come last.
 */
export function groupAppointmentsByDoctor(
  appointments: readonly OrderPipelineAppointment[],
): PlannedAppointmentGroup[] {
  const groups = new Map<string, PlannedAppointmentGroup>();
  for (const appointment of plannedAppointments(appointments)) {
    const doctorName = appointment.doctor_name?.trim() || null;
    const providerName = appointment.provider_name?.trim() || null;
    appendToGroup(
      groups,
      `${providerName ?? ""}\u0000${doctorName ?? ""}`,
      { date: null, doctorName, providerName },
      appointment,
    );
  }
  const all = [...groups.values()];
  return [
    ...all.filter((group) => group.doctorName || group.providerName),
    ...all.filter((group) => !group.doctorName && !group.providerName),
  ];
}

export function plannedDayLabel(date: string, lang: string) {
  const weekdays = lang === "de" ? WEEKDAYS.de : WEEKDAYS.ru;
  return `${weekdays[dateKeyWeekday(date)]}, ${formatAppDate(date)}`;
}

/** "10:00–11:00", the start alone, or empty for a day without a time. */
export function plannedTimeLabel(appointment: OrderPipelineAppointment) {
  const start = appointment.time_start?.slice(0, 5) ?? "";
  const end = appointment.time_end?.slice(0, 5) ?? "";
  return start && end ? `${start}–${end}` : start;
}
