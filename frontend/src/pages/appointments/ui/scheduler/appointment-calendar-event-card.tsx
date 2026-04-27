import type { EventContentArg } from "@fullcalendar/core";
import { MoreHorizontal } from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";

import { cn } from "@/lib/utils";
import {
  appointmentText,
  appointmentTypeLabel,
  statusLabel,
} from "@/pages/appointments/model/labels";
import type {
  AppointmentRecurringActionScope,
  AppointmentStatus,
  CalendarEventExtendedProps,
} from "@/pages/appointments/model/types";

type AppointmentCalendarEventCardProps = {
  arg: EventContentArg;
  lang: string;
  canManageStatus: boolean;
  activeQuickActionAppointmentId: string | null;
  dictionary: Record<string, string>;
  onOpenQuickActions: (
    event: ReactMouseEvent<HTMLButtonElement>,
    appointmentId: string,
  ) => void;
  onStatusChange: (
    appointmentId: string,
    status: AppointmentStatus,
    recurrenceScope?: AppointmentRecurringActionScope,
  ) => Promise<void> | void;
};

function resolveCalendarLocale(lang: string): string {
  if (lang === "de") return "de-DE";
  if (lang === "ru") return "ru-RU";
  return "en-GB";
}

function formatEventTime(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatEventTimeRange(arg: EventContentArg, lang: string): string {
  const start = arg.event.start;
  if (!start) return arg.timeText ?? "";

  const locale = resolveCalendarLocale(lang);
  const startLabel = formatEventTime(start, locale);
  const end = arg.event.end;
  if (!end) return arg.timeText || startLabel;

  const endLabel = formatEventTime(end, locale);
  if (startLabel === endLabel) return startLabel;

  return `${startLabel} - ${endLabel}`;
}

function resolveEventDurationMinutes(arg: EventContentArg): number {
  const { start, end } = arg.event;
  if (!start || !end) return 30;

  const diffMs = end.getTime() - start.getTime();
  const diffMinutes = Math.round(diffMs / (60 * 1000));
  return diffMinutes > 0 ? diffMinutes : 30;
}

export function AppointmentCalendarEventCard({
  arg,
  lang,
  canManageStatus,
  activeQuickActionAppointmentId,
  dictionary,
  onOpenQuickActions,
  onStatusChange,
}: AppointmentCalendarEventCardProps) {
  const props = arg.event.extendedProps as CalendarEventExtendedProps;
  const secondaryLine =
    props.doctorName ||
    props.providerName ||
    props.location ||
    props.ownerName ||
    appointmentText("Termin", "Прием", "Appointment");
  const isListView = arg.view.type.startsWith("list");
  const canQuickManage =
    canManageStatus &&
    !props.isBlocked &&
    props.appointmentStatus !== "completed" &&
    props.appointmentStatus !== "cancelled";
  const eventTimeRange = formatEventTimeRange(arg, lang);
  const eventDurationMinutes = resolveEventDurationMinutes(arg);
  const canListQuickManage = isListView && canQuickManage;
  const canGridQuickManage = !isListView && canQuickManage;

  return (
    <div
      className={cn(
        "fc-apt-event-card relative",
        isListView && "fc-apt-event-card-list",
      )}
      data-event-duration-minutes={eventDurationMinutes}
    >
      {canGridQuickManage ? (
        <button
          type="button"
          aria-label={appointmentText(
            "Schnellaktionen fur Termin offnen",
            "Открыть быстрые действия по приёму",
            "Open quick appointment actions",
          )}
          aria-haspopup="menu"
          aria-expanded={activeQuickActionAppointmentId === arg.event.id}
          aria-controls={`appointment-quick-actions-${arg.event.id}`}
          className="absolute top-1 right-1 inline-flex size-6 items-center justify-center rounded-full border border-slate-300/80 bg-white/90 text-slate-600 shadow-sm transition hover:bg-white hover:text-slate-950"
          onClick={(event) => onOpenQuickActions(event, arg.event.id)}
        >
          <MoreHorizontal className="size-3.5" />
        </button>
      ) : null}
      <div className="fc-apt-event-head">
        <span className="fc-apt-event-tag">
          {props.isBlocked
            ? appointmentText("Blockiert", "Заблокировано", "Blocked")
            : props.appointmentStatus === "completed"
              ? statusLabel("completed")
              : props.appointmentStatus === "cancelled"
                ? statusLabel("cancelled")
                : appointmentTypeLabel(props.appointmentType, dictionary)}
        </span>
        {eventTimeRange ? (
          <span className="fc-apt-event-time">{eventTimeRange}</span>
        ) : null}
      </div>
      <div className="fc-apt-event-title">{arg.event.title}</div>
      <div className="fc-apt-event-meta">{props.patientName}</div>
      <div className="fc-apt-event-submeta">{secondaryLine}</div>
      {props.isBlocked ? (
        <div className="fc-apt-event-note">
          {appointmentText(
            "Blockierte Sicht",
            "Заблокированная видимость",
            "Blocked visibility",
          )}
        </div>
      ) : props.interpreterName ? (
        <div className="fc-apt-event-note">
          {appointmentText("Dolmetscher", "Переводчик", "Interpreter")}:{" "}
          {props.interpreterName}
        </div>
      ) : null}
      {canListQuickManage ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {props.appointmentStatus !== "confirmed" ? (
            <button
              type="button"
              className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-700"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void onStatusChange(arg.event.id, "confirmed");
              }}
            >
              {dictionary.common_confirm}
            </button>
          ) : null}
          <button
            type="button"
            className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-700"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void onStatusChange(arg.event.id, "completed");
            }}
          >
            {dictionary.dash_completed}
          </button>
          {props.recurrenceFrequency ? (
            <button
              type="button"
              className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-rose-700"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void onStatusChange(arg.event.id, "cancelled", "following");
              }}
            >
              {dictionary.appointments_cancel_this_and_following}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
