import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import deLocale from "@fullcalendar/core/locales/de";
import ruLocale from "@fullcalendar/core/locales/ru";
import type { EventInput } from "@fullcalendar/core";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ComponentProps,
  type RefObject,
} from "react";

import { AppointmentCalendarQuickActionsMenu } from "@/pages/appointments/ui/scheduler/appointment-calendar-quick-actions-menu";
import type {
  AppointmentListItem,
  AppointmentRecurringActionScope,
  AppointmentStatus,
  CalendarQuickActionMenuState,
  CalendarView,
} from "@/pages/appointments/model/types";

type FullCalendarProps = ComponentProps<typeof FullCalendar>;

const TIMEGRID_SLOT_MINUTES = 30;
const HEIGHT_DIFF_EPSILON_PX = 1;
const FULL_CALENDAR_PLUGINS = [
  dayGridPlugin,
  timeGridPlugin,
  listPlugin,
  interactionPlugin,
];
const FULL_CALENDAR_EVENT_TIME_FORMAT = {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  omitZeroMinute: false,
} as const;

type AdaptiveEventHeights = {
  eventMinHeight: number;
  eventShortHeight: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isTimeGridCalendarView(view: CalendarView): boolean {
  return view === "timeGridWeek" || view === "timeGridDay";
}

function computeBaseSlotHeight(view: CalendarView): number {
  if (typeof window === "undefined") {
    if (view === "timeGridDay") {
      return 64;
    }
    if (view === "timeGridWeek") {
      return 52;
    }
    return 36;
  }

  const viewportHeight = window.innerHeight;
  if (view === "timeGridDay") {
    return Math.round(clamp(viewportHeight * 0.05, 46, 92));
  }
  if (view === "timeGridWeek") {
    return Math.round(clamp(viewportHeight * 0.044, 40, 78));
  }
  return 36;
}

function computeAdaptiveEventHeights(
  view: CalendarView,
  slotHeightPx: number,
): AdaptiveEventHeights {
  if (!isTimeGridCalendarView(view)) {
    return {
      eventMinHeight: 34,
      eventShortHeight: 42,
    };
  }

  const eventMinHeight = Math.round(clamp(slotHeightPx * 0.72, 34, 72));
  const eventShortHeight = Math.round(
    Math.max(eventMinHeight + 8, clamp(slotHeightPx * 0.98, 44, 92)),
  );

  return { eventMinHeight, eventShortHeight };
}

function resolveSlotHeightCeiling(view: CalendarView): number {
  return view === "timeGridDay" ? 320 : 280;
}

type DesktopCalendarSurfaceProps = {
  calendarRef: RefObject<FullCalendar | null>;
  lang: string;
  dictionary: Record<string, string>;
  calendarView: CalendarView;
  calendarDate: string;
  canEditSchedule: boolean;
  dateClick: FullCalendarProps["dateClick"];
  eventClick: FullCalendarProps["eventClick"];
  eventDrop: FullCalendarProps["eventDrop"];
  eventResize: FullCalendarProps["eventResize"];
  eventContent: FullCalendarProps["eventContent"];
  datesSet: FullCalendarProps["datesSet"];
  events: EventInput[];
  calendarQuickActionMenu: CalendarQuickActionMenuState | null;
  calendarQuickActionMenuRef: RefObject<HTMLDivElement | null>;
  activeCalendarQuickActionItem: AppointmentListItem | null;
  activeCalendarQuickActionScope: AppointmentRecurringActionScope;
  actionBusy: string;
  onCalendarQuickActionScopeChange: (
    scope: AppointmentRecurringActionScope,
  ) => void;
  onOpenDetail: (appointmentId: string) => void;
  onStatusChange: (
    appointmentId: string,
    status: AppointmentStatus,
    recurrenceScope?: AppointmentRecurringActionScope,
  ) => Promise<void> | void;
};

export function DesktopCalendarSurface({
  calendarRef,
  lang,
  dictionary,
  calendarView,
  calendarDate,
  canEditSchedule,
  dateClick,
  eventClick,
  eventDrop,
  eventResize,
  eventContent,
  datesSet,
  events,
  calendarQuickActionMenu,
  calendarQuickActionMenuRef,
  activeCalendarQuickActionItem,
  activeCalendarQuickActionScope,
  actionBusy,
  onCalendarQuickActionScopeChange,
  onOpenDetail,
  onStatusChange,
}: DesktopCalendarSurfaceProps) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const isTimeGridView = isTimeGridCalendarView(calendarView);
  const eventLayoutKey = useMemo(
    () =>
      events
        .map((event) =>
          [
            event.id ?? "",
            event.title ?? "",
            event.start ?? "",
            event.end ?? "",
            event.allDay ? "1" : "0",
          ].join(":"),
        )
        .join("|"),
    [events],
  );
  const slotHeightResetKey = `${calendarDate}:${calendarView}:${eventLayoutKey}`;
  const baseSlotHeight = computeBaseSlotHeight(calendarView);
  const [slotHeightState, setSlotHeightState] = useState(() => ({
    resetKey: slotHeightResetKey,
    height: baseSlotHeight,
  }));
  const slotHeightPx =
    slotHeightState.resetKey === slotHeightResetKey
      ? slotHeightState.height
      : baseSlotHeight;
  const eventHeights = useMemo(
    () => computeAdaptiveEventHeights(calendarView, slotHeightPx),
    [calendarView, slotHeightPx],
  );
  const calendarShellStyle = useMemo<CSSProperties | undefined>(
    () =>
      isTimeGridView
        ? ({
            ["--apt-timegrid-slot-height" as string]: `${slotHeightPx}px`,
          } as CSSProperties)
        : undefined,
    [isTimeGridView, slotHeightPx],
  );
  const headerToolbar = useMemo(
    () => ({
      left: "prev,next today",
      center: "title",
      right: "dayGridMonth,timeGridWeek,timeGridDay,listWeek",
    }),
    [],
  );
  const buttonText = useMemo(
    () => ({
      today: dictionary.dash_patients_today ?? "Today",
      month: dictionary.dash_this_month ?? "Month",
      week: dictionary.dash_this_week ?? "Week",
      day: dictionary.appointments_date ?? "Day",
      list: dictionary.providers_all ?? "List",
    }),
    [
      dictionary.appointments_date,
      dictionary.dash_patients_today,
      dictionary.dash_this_month,
      dictionary.dash_this_week,
      dictionary.providers_all,
    ],
  );

  useEffect(() => {
    if (!isTimeGridView || typeof window === "undefined") return;

    const maxSlotHeight = resolveSlotHeightCeiling(calendarView);
    let rafId = 0;
    let timeoutId = 0;

    const measureAndSyncSlotHeight = () => {
      const shellElement = shellRef.current;
      const baseSlotHeight = computeBaseSlotHeight(calendarView);
      if (!shellElement) {
        setSlotHeightState((currentState) =>
          currentState.resetKey === slotHeightResetKey &&
          Math.abs(currentState.height - baseSlotHeight) <= HEIGHT_DIFF_EPSILON_PX
            ? currentState
            : { resetKey: slotHeightResetKey, height: baseSlotHeight },
        );
        return;
      }

      const cardSelector =
        calendarView === "timeGridDay"
          ? ".fc-timeGridDay-view .fc-timegrid-event .fc-apt-event-card"
          : ".fc-timeGridWeek-view .fc-timegrid-event .fc-apt-event-card";
      const cards = Array.from(
        shellElement.querySelectorAll<HTMLElement>(cardSelector),
      );

      let requiredSlotHeight = baseSlotHeight;
      let hasOverflowedCards = false;
      for (const cardElement of cards) {
        const visibleHeight = Math.max(1, cardElement.clientHeight);
        const fullHeight = Math.max(visibleHeight, cardElement.scrollHeight);
        const isOverflowed = fullHeight > visibleHeight + 0.5;
        cardElement.dataset.overflowed = isOverflowed ? "true" : "false";
        if (!isOverflowed) continue;
        hasOverflowedCards = true;

        const rawDurationMinutes = Number(
          cardElement.dataset.eventDurationMinutes ?? TIMEGRID_SLOT_MINUTES,
        );
        const safeDurationMinutes =
          Number.isFinite(rawDurationMinutes) && rawDurationMinutes > 0
            ? rawDurationMinutes
            : TIMEGRID_SLOT_MINUTES;
        const nextRequiredSlotHeight =
          (fullHeight / safeDurationMinutes) * TIMEGRID_SLOT_MINUTES + 2;
        requiredSlotHeight = Math.max(requiredSlotHeight, nextRequiredSlotHeight);
      }

      const normalizedHeight = Math.round(
        clamp(requiredSlotHeight, baseSlotHeight, maxSlotHeight),
      );
      setSlotHeightState((currentState) => {
        const currentHeight =
          currentState.resetKey === slotHeightResetKey
            ? currentState.height
            : baseSlotHeight;
        const nextHeight = hasOverflowedCards
          ? Math.max(currentHeight, normalizedHeight)
          : currentHeight;
        return currentState.resetKey === slotHeightResetKey &&
          Math.abs(currentHeight - nextHeight) <= HEIGHT_DIFF_EPSILON_PX
          ? currentState
          : { resetKey: slotHeightResetKey, height: nextHeight };
      });
    };

    const scheduleMeasurement = () => {
      cancelAnimationFrame(rafId);
      rafId = window.requestAnimationFrame(() => {
        measureAndSyncSlotHeight();
      });
    };

    scheduleMeasurement();
    timeoutId = window.setTimeout(scheduleMeasurement, 120);
    window.addEventListener("resize", scheduleMeasurement);

    return () => {
      cancelAnimationFrame(rafId);
      window.clearTimeout(timeoutId);
      window.removeEventListener("resize", scheduleMeasurement);
    };
  }, [baseSlotHeight, calendarView, isTimeGridView, slotHeightResetKey]);

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div
        ref={shellRef}
        className="appointments-calendar-shell p-3"
        style={calendarShellStyle}
      >
        <FullCalendar
          ref={calendarRef}
          plugins={FULL_CALENDAR_PLUGINS}
          locale={lang === "de" ? deLocale : ruLocale}
          eventTimeFormat={FULL_CALENDAR_EVENT_TIME_FORMAT}
          eventDisplay="block"
          displayEventEnd={false}
          initialView={calendarView}
          initialDate={calendarDate}
          headerToolbar={headerToolbar}
          buttonText={buttonText}
          height="auto"
          firstDay={1}
          slotDuration="00:30:00"
          slotMinTime="06:00:00"
          slotMaxTime="22:00:00"
          dayMaxEvents={3}
          nowIndicator
          eventMinHeight={eventHeights.eventMinHeight}
          eventShortHeight={eventHeights.eventShortHeight}
          editable={canEditSchedule}
          eventStartEditable={canEditSchedule}
          eventDurationEditable={canEditSchedule}
          eventResizableFromStart={canEditSchedule}
          dateClick={dateClick}
          eventClick={eventClick}
          eventDrop={eventDrop}
          eventResize={eventResize}
          eventContent={eventContent}
          datesSet={datesSet}
          events={events}
        />
      </div>
      {calendarQuickActionMenu && activeCalendarQuickActionItem ? (
        <AppointmentCalendarQuickActionsMenu
          menu={calendarQuickActionMenu}
          menuRef={calendarQuickActionMenuRef}
          item={activeCalendarQuickActionItem}
          dictionary={dictionary}
          actionBusy={actionBusy}
          activeScope={activeCalendarQuickActionScope}
          onScopeChange={onCalendarQuickActionScopeChange}
          onOpenDetail={onOpenDetail}
          onStatusChange={onStatusChange}
        />
      ) : null}
    </section>
  );
}
