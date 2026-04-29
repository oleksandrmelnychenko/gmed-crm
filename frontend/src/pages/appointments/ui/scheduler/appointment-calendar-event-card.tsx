import type { EventContentArg } from "@fullcalendar/core";
import { MoreHorizontal } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { Badge } from "@/components/ui/badge";
import { appointmentText, appointmentTypeLabel, statusLabel } from "@/pages/appointments/model/labels";
import type {
  AppointmentRecurringActionScope,
  AppointmentStatus,
  CalendarEventExtendedProps,
} from "@/pages/appointments/model/types";

type AppointmentCalendarEventCardProps = {
  arg: EventContentArg;
  lang: string;
  canManageStatus: boolean;
  dictionary: Record<string, string>;
  onOpenDetail: (appointmentId: string) => void;
  onStatusChange: (
    appointmentId: string,
    status: AppointmentStatus,
    recurrenceScope?: AppointmentRecurringActionScope,
  ) => Promise<void> | void;
};

const MONTH_TOOLTIP_WIDTH_PX = 432;

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

function formatEventDate(arg: EventContentArg, lang: string): string {
  const start = arg.event.start;
  if (!start) return "";

  const locale = resolveCalendarLocale(lang);
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(start);
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
  dictionary,
  onOpenDetail,
  onStatusChange,
}: AppointmentCalendarEventCardProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const monthTooltipRef = useRef<HTMLDivElement | null>(null);
  const monthTooltipTriggerRef = useRef<HTMLButtonElement | null>(null);

  const props = arg.event.extendedProps as CalendarEventExtendedProps;
  const statusOrTypeLabel = props.isBlocked
    ? appointmentText("Blockiert", "Заблокировано", "Blocked")
    : props.appointmentStatus === "completed"
      ? statusLabel("completed")
      : props.appointmentStatus === "cancelled"
        ? statusLabel("cancelled")
        : appointmentTypeLabel(props.appointmentType, dictionary);
  const secondaryLine =
    props.doctorName ||
    props.providerName ||
    props.location ||
    props.ownerName ||
    appointmentText("Termin", "Прием", "Appointment");
  const noteLine = props.isBlocked
    ? appointmentText(
        "Blockierte Sicht",
        "Заблокированная видимость",
        "Blocked visibility",
      )
    : props.interpreterName
      ? `${appointmentText("Dolmetscher", "Переводчик", "Interpreter")}: ${props.interpreterName}`
      : null;

  const isListView = arg.view.type.startsWith("list");
  const isMonthView = arg.view.type === "dayGridMonth";
  const canQuickManage =
    canManageStatus &&
    !props.isBlocked &&
    props.appointmentStatus !== "completed" &&
    props.appointmentStatus !== "cancelled";

  const eventTimeRange = formatEventTimeRange(arg, lang);
  const eventDurationMinutes = resolveEventDurationMinutes(arg);
  const canListQuickManage = isListView && canQuickManage;
  const canGridQuickManage = !isListView && canQuickManage;
  const canOpenMonthTooltip = !isListView && isMonthView;
  const [isMonthTooltipOpen, setIsMonthTooltipOpen] = useState(false);
  const [monthActionScope, setMonthActionScope] =
    useState<AppointmentRecurringActionScope>("single");
  const [monthTooltipPosition, setMonthTooltipPosition] = useState({
    top: 0,
    left: 0,
  });

  const dayPrimaryLine = arg.event.title;
  const normalizedEventTitle = arg.event.title.startsWith(`${props.patientPid} · `)
    ? arg.event.title.slice(`${props.patientPid} · `.length)
    : arg.event.title;
  const eventDateLabel = formatEventDate(arg, lang);
  const eventTimeAndDate = [eventTimeRange, eventDateLabel]
    .filter((value) => Boolean(value && value.trim()))
    .join("  ");
  const personLine = props.doctorName || props.providerName || props.ownerName || "";
  const daySecondaryLine = [
    statusOrTypeLabel,
    eventTimeRange,
    props.patientName,
    secondaryLine,
    noteLine,
  ]
    .filter((value): value is string => Boolean(value && value.trim()))
    .join(" • ");

  useEffect(() => {
    if (!isMonthTooltipOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (cardRef.current?.contains(target)) return;
      if (monthTooltipRef.current?.contains(target)) return;
      setIsMonthTooltipOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [isMonthTooltipOpen]);

  useEffect(() => {
    if (!isMonthTooltipOpen) return;

    const updateTooltipPosition = () => {
      const triggerElement = monthTooltipTriggerRef.current;
      if (!triggerElement) return;

      const triggerRect = triggerElement.getBoundingClientRect();
      const tooltipWidth = monthTooltipRef.current?.offsetWidth ?? MONTH_TOOLTIP_WIDTH_PX;
      const viewportWidth = window.innerWidth;
      const desiredLeft = triggerRect.right - tooltipWidth;
      const minLeft = 8;
      const maxLeft = Math.max(minLeft, viewportWidth - tooltipWidth - 8);
      const nextLeft = Math.min(maxLeft, Math.max(minLeft, desiredLeft));
      const nextTop = triggerRect.bottom + 8;

      setMonthTooltipPosition({ top: nextTop, left: nextLeft });
    };

    updateTooltipPosition();
    window.addEventListener("resize", updateTooltipPosition);
    window.addEventListener("scroll", updateTooltipPosition, true);

    return () => {
      window.removeEventListener("resize", updateTooltipPosition);
      window.removeEventListener("scroll", updateTooltipPosition, true);
    };
  }, [isMonthTooltipOpen]);

  return (
    <div
      ref={cardRef}
      className="fc-apt-event-card group relative"
      data-event-duration-minutes={eventDurationMinutes}
    >
      {canOpenMonthTooltip ? (
        <button
          ref={monthTooltipTriggerRef}
          type="button"
          aria-label={appointmentText(
            "Schnellaktionen öffnen",
            "Быстрые действия",
            "Open quick appointment actions",
          )}
          aria-haspopup="menu"
          aria-expanded={isMonthTooltipOpen}
          aria-controls={`appointment-quick-actions-${arg.event.id}`}
          className={`absolute top-1 right-1 z-10 inline-flex size-5 items-center justify-center rounded-md border border-border/60 bg-background/85 text-muted-foreground transition-[opacity,color,background-color] hover:bg-background hover:text-foreground ${
            isMonthTooltipOpen
              ? "opacity-100 pointer-events-auto"
              : "opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto"
          }`}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setIsMonthTooltipOpen((current) => !current);
          }}
        >
          <MoreHorizontal className="size-3" />
        </button>
      ) : null}

      <div className="fc-apt-event-row-primary">{dayPrimaryLine}</div>
      {daySecondaryLine ? (
        <div className="fc-apt-event-row-secondary">{daySecondaryLine}</div>
      ) : null}

      {canOpenMonthTooltip && isMonthTooltipOpen
        ? createPortal(
            <div
              ref={monthTooltipRef}
              className="fixed z-[9999] min-w-[27rem] w-max max-w-[calc(100vw-16px)] rounded-xl border border-border/80 bg-card p-3 shadow-lg"
              style={{
                top: `${monthTooltipPosition.top}px`,
                left: `${monthTooltipPosition.left}px`,
              }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="inline-flex items-center gap-1.5 font-mono text-[12px] font-semibold uppercase tracking-[0.03em] text-foreground truncate">
                    {eventTimeAndDate}
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className="rounded-full text-[10px] w-fit border-emerald-200 bg-emerald-50 text-emerald-700"
                >
                  {statusOrTypeLabel}
                </Badge>
              </div>
              <div className="mt-2 text-[0.8rem] font-semibold text-foreground">
                {normalizedEventTitle}
              </div>
              <div className="mb-3 inline-flex items-center gap-1.5 text-[0.72rem] text-foreground">
                <span className="inline-block size-1.5 rounded-full bg-emerald-500" />
                <span>{props.patientPid}</span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <div className="min-w-0">
                  <div className="text-[11.5px] font-medium leading-tight text-muted-foreground">
                    {appointmentText("Patient", "Patient", "Patient")}
                  </div>
                  <div className="mt-0.5 truncate text-[0.74rem] font-medium text-foreground">
                    {props.patientName}
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="text-[11.5px] font-medium leading-tight text-muted-foreground">
                    {appointmentText("Arzt/Provider", "Doctor/Provider", "Doctor/Provider")}
                  </div>
                  <div className="mt-0.5 truncate text-[0.72rem] text-foreground">
                    {personLine}
                  </div>
                </div>
              </div>
              {props.recurrenceFrequency ? (
                <div className="mt-2 rounded-lg border border-border/70 bg-muted/25 p-2">
                  <label className="block text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                    {dictionary.appointments_scope_apply_status}
                  </label>
                  <select
                    value={monthActionScope}
                    className="mt-1 h-8 w-full rounded-md border border-border/70 bg-background px-2 text-xs text-foreground"
                    onChange={(event) =>
                      setMonthActionScope(
                        event.target.value as AppointmentRecurringActionScope,
                      )
                    }
                  >
                    <option value="single">{dictionary.appointments_scope_single}</option>
                    <option value="following">
                      {dictionary.appointments_scope_following}
                    </option>
                    <option value="series">{dictionary.appointments_scope_series}</option>
                  </select>
                </div>
              ) : null}
              <div className="mt-3 -mx-3 -mb-3 h-10 flex flex-nowrap items-stretch border-t border-border/70">
                <button
                  type="button"
                  className="h-10 flex-1 border-r border-border/70 bg-background px-2 text-[11px] font-medium text-foreground whitespace-nowrap transition-colors hover:bg-muted/60 cursor-pointer last:border-r-0"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onOpenDetail(arg.event.id);
                  }}
                >
                  {dictionary.appointments_open_detail}
                </button>
                {canGridQuickManage && props.appointmentStatus !== "confirmed" ? (
                  <button
                    type="button"
                    className="h-10 flex-1 border-r border-border/70 bg-background px-2 text-[11px] font-medium text-foreground whitespace-nowrap transition-colors hover:bg-muted/60 cursor-pointer last:border-r-0"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      void onStatusChange(arg.event.id, "confirmed", monthActionScope);
                    }}
                  >
                    {dictionary.common_confirm}
                  </button>
                ) : null}
                {canGridQuickManage ? (
                  <button
                    type="button"
                    className="h-10 flex-1 border-r border-border/70 bg-background px-2 text-[11px] font-medium text-foreground whitespace-nowrap transition-colors hover:bg-muted/60 cursor-pointer last:border-r-0"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      void onStatusChange(arg.event.id, "completed", monthActionScope);
                    }}
                  >
                    {dictionary.dash_completed}
                  </button>
                ) : null}
                {canGridQuickManage && props.recurrenceFrequency ? (
                  <button
                    type="button"
                    className="h-10 flex-1 border-r border-border/70 bg-destructive/10 px-2 text-[11px] font-medium text-destructive whitespace-nowrap transition-colors hover:bg-destructive/20 cursor-pointer last:border-r-0"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      void onStatusChange(arg.event.id, "cancelled", monthActionScope);
                    }}
                  >
                    {monthActionScope === "following"
                      ? dictionary.appointments_cancel_this_and_following
                      : monthActionScope === "series"
                        ? dictionary.appointments_cancel_whole_series
                        : statusLabel("cancelled")}
                  </button>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}

      {canListQuickManage ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {props.appointmentStatus !== "confirmed" ? (
            <button
              type="button"
              className="rounded-full border border-border/60 bg-background px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground"
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
            className="rounded-full border border-border/60 bg-background px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground"
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
              className="rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-destructive"
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
