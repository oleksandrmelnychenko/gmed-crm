import type { EventContentArg } from "@fullcalendar/core";

import {
  appointmentText,
  appointmentTypeLabel,
  statusLabel,
} from "@/pages/appointments/model/labels";
import type {
  AppointmentKind,
  CalendarEventExtendedProps,
} from "@/pages/appointments/model/types";

type CalendarEventContentDictionary = Record<string, string>;
type CalendarEventRuntimeProps = Partial<CalendarEventExtendedProps>;

function calendarText(value: unknown): string {
  return typeof value === "string"
    ? value
    : value == null
      ? ""
      : String(value);
}

export function escapeCalendarEventHtml(value: unknown): string {
  return calendarText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function resolveCalendarEventDurationMinutes(arg: EventContentArg): number {
  const { start, end } = arg.event;
  if (!start || !end) return 30;

  const diffMinutes = Math.round((end.getTime() - start.getTime()) / 60_000);
  return diffMinutes > 0 ? diffMinutes : 30;
}

function resolveCalendarEventPrimaryTitle(
  rawTitle: unknown,
  props: CalendarEventRuntimeProps,
) {
  const title = calendarText(rawTitle).trim();
  if (title) return title;

  const patientPid = calendarText(props.patientPid).trim();
  const patientName = calendarText(props.patientName).trim();
  if (patientPid && patientName) return `${patientPid} · ${patientName}`;
  if (patientName) return patientName;
  if (patientPid) return patientPid;
  return appointmentText("appointments_appointment_2");
}

function resolveCalendarEventStatusOrTypeLabel(
  props: CalendarEventRuntimeProps,
  dictionary: CalendarEventContentDictionary,
) {
  if (props.isBlocked) return appointmentText("appointments_blocked");
  if (props.appointmentStatus === "completed") return statusLabel("completed");
  if (props.appointmentStatus === "cancelled") return statusLabel("cancelled");
  if (props.appointmentType) {
    return appointmentTypeLabel(props.appointmentType as AppointmentKind, dictionary);
  }
  return appointmentText("appointments_appointment_2");
}

export function renderStaticCalendarEventContent(
  arg: EventContentArg,
  dictionary: CalendarEventContentDictionary,
) {
  const props = arg.event.extendedProps as CalendarEventRuntimeProps;
  const statusOrTypeLabel = resolveCalendarEventStatusOrTypeLabel(props, dictionary);
  const interpreterName = calendarText(props.interpreterName).trim();
  const secondaryLine = [
    arg.timeText,
    props.patientName,
    props.doctorName ||
      props.providerName ||
      props.location ||
      props.ownerName ||
      appointmentText("appointments_appointment_2"),
    interpreterName
      ? `${appointmentText("appointments_interpreter_2")}: ${interpreterName}`
      : "",
  ]
    .map(calendarText)
    .filter((value) => value.trim())
    .join(" - ");

  return {
    html: [
      `<div class="fc-apt-event-card group relative" data-event-duration-minutes="${resolveCalendarEventDurationMinutes(arg)}">`,
      `<div class="fc-apt-event-row-primary">${escapeCalendarEventHtml(resolveCalendarEventPrimaryTitle(arg.event.title, props))}</div>`,
      secondaryLine
        ? `<div class="fc-apt-event-row-secondary">${escapeCalendarEventHtml(secondaryLine)}</div>`
        : "",
      `<div class="mt-auto pt-1"><div class="fc-apt-event-tag">${escapeCalendarEventHtml(statusOrTypeLabel)}</div></div>`,
      "</div>",
    ].join(""),
  };
}
