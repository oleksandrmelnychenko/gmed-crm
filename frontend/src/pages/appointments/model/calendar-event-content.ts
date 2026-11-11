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
import { useLanguageBound } from "@/lib/i18n";

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

/** Marks the «⋯» button of an event tile that opens its quick-action menu. */
export const CALENDAR_EVENT_MENU_BUTTON_ATTRIBUTE = "data-appointment-menu";

export type CalendarEventContentOptions = {
  /**
   * Accessible name of the «⋯» button that opens the event's quick-action
   * menu. Left out for roles that cannot change a status: no button then.
   */
  quickActionsLabel?: string;
};

export function renderStaticCalendarEventContent(
  arg: EventContentArg,
  dictionary: CalendarEventContentDictionary,
  options: CalendarEventContentOptions = {},
) {
  const props = arg.event.extendedProps as CalendarEventRuntimeProps;
  const statusOrTypeLabel = resolveCalendarEventStatusOrTypeLabel(props, dictionary);
  const interpreterName = calendarText(props.interpreterName).trim();
  const quickActionsLabel = calendarText(options.quickActionsLabel).trim();
  // Doctor, provider, place or curator — whatever is known. A visit with none
  // of them prints nothing there (the word «Приём» used to stand in).
  const secondaryLine = [
    arg.timeText,
    props.patientName,
    props.doctorName || props.providerName || props.location || props.ownerName || "",
    interpreterName
      ? `${appointmentText("appointments_interpreter_2")}: ${interpreterName}`
      : "",
  ]
    .map(calendarText)
    .filter((value) => value.trim())
    .join(" - ");

  const durationMinutes = resolveCalendarEventDurationMinutes(arg);
  // A visit of 15 minutes or less gets one line in the week and day view:
  // the start time (`data-event-time`, drawn by CSS) and the title, so the
  // tile fits its 15 minutes and never runs under the next one (QA
  // 2026-11-11, B-01/B-02).
  const compact = durationMinutes <= 15;
  return {
    html: [
      `<div class="fc-apt-event-card group relative${compact ? " fc-apt-event-card-compact" : ""}" data-event-duration-minutes="${durationMinutes}">`,
      `<div class="fc-apt-event-row-primary"${compact && arg.timeText ? ` data-event-time="${escapeCalendarEventHtml(arg.timeText)}"` : ""}>${escapeCalendarEventHtml(resolveCalendarEventPrimaryTitle(arg.event.title, props))}</div>`,
      secondaryLine
        ? `<div class="fc-apt-event-row-secondary">${escapeCalendarEventHtml(secondaryLine)}</div>`
        : "",
      `<div class="mt-auto pt-1"><div class="fc-apt-event-tag">${escapeCalendarEventHtml(statusOrTypeLabel)}</div></div>`,
      // Sits in the tile's top right corner and takes no room of its own;
      // the same menu opens on a right click.
      quickActionsLabel
        ? `<button type="button" class="fc-apt-event-menu-button" ${CALENDAR_EVENT_MENU_BUTTON_ATTRIBUTE} aria-haspopup="menu" aria-label="${escapeCalendarEventHtml(quickActionsLabel)}" title="${escapeCalendarEventHtml(quickActionsLabel)}"><span aria-hidden="true">⋯</span></button>`
        : "",
      "</div>",
    ].join(""),
  };
}

/**
 * The helpers of this module that read the UI language themselves.
 * Components and hooks take them from `useCalendarEventContent()`, which binds them to
 * the current language, so their text follows a live language switch.
 */
export const CALENDAR_EVENT_LANGUAGE_HELPERS = {
  renderStaticCalendarEventContent,
};

export function useCalendarEventContent() {
  return useLanguageBound(CALENDAR_EVENT_LANGUAGE_HELPERS);
}
