import FullCalendar, {
  type CalendarRef,
  type EventInput,
  type LocaleInput,
} from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import timeGridPlugin from "@fullcalendar/react/timegrid";
import listPlugin from "@fullcalendar/react/list";
import interactionPlugin from "@fullcalendar/react/interaction";
import classicThemePlugin from "@fullcalendar/react/themes/classic";
import deLocale from "@fullcalendar/react/locales/de";
import ruLocale from "@fullcalendar/react/locales/ru";
import "@fullcalendar/react/skeleton.css";
import "@fullcalendar/react/themes/classic/theme.css";
import clsx from "clsx";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from "react";

import { berlinNowNaive } from "@/lib/app-time-zone";
import { appointmentCalendarTitleViews } from "@/pages/appointments/model/calendar-title";
import { resolveTimeGridHours } from "@/pages/appointments/model/calendar-hours";
import {
  CALENDAR_FIRST_DAY,
  CALENDAR_WEEK_NUMBER_CALCULATION,
} from "@/lib/calendar-standards";
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
  classicThemePlugin,
];
const FULL_CALENDAR_EVENT_TIME_FORMAT = {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  omitZeroMinute: false,
} as const;
const WEEK_DAY_HEADER_FORMAT = {
  weekday: "short",
  month: "numeric",
  day: "numeric",
  omitCommas: true,
} as const;
const DAY_HEADER_FORMAT = { weekday: "long" } as const;
// FullCalendar's Russian locale has no accessibility texts: the hints of the
// arrows, views and event groups were English (QA 2026-11-10, C S3 30). The
// German locale has its own.
const RU_CALENDAR_LOCALE: LocaleInput = {
  ...ruLocale,
  prevHint: "Предыдущий период",
  nextHint: "Следующий период",
  todayHint: "Сегодня",
  viewHint: "Вид: $0",
  navLinkHint: "Перейти к $0",
  moreLinkHint: (count: number) => `Показать ещё ${count}`,
  closeHint: "Закрыть",
  viewChangeHint: "Вид календаря",
  eventsHint: "Приёмы",
  timedText: "По времени",
};
const DE_CALENDAR_LOCALE: LocaleInput = {
  ...deLocale,
  timedText: "Mit Uhrzeit",
};

// FullCalendar 7 puts no stable class names into the DOM (its own are hashed);
// these hooks give the parts our stylesheet (index.css, «appointments
// calendar») and the e2e specs address a fixed `apt-cal-*` name. The classic
// theme keeps its own classes next to them.
const weekendClass = (dow: number) => (dow === 0 || dow === 6 ? "apt-cal-weekend" : undefined);
const FULL_CALENDAR_CLASS_HOOKS = {
  className: "apt-cal-root",
  viewClass: (info) => `apt-cal-view apt-cal-view-${info.view.type}`,
  toolbarClass: "apt-cal-toolbar",
  toolbarTitleClass: "apt-cal-toolbar-title",
  buttonGroupClass: "apt-cal-button-group",
  buttonClass: (info) =>
    clsx(
      "apt-cal-button",
      `apt-cal-button-${info.name}`,
      info.buttonGroup && "apt-cal-button-in-group",
      info.isSelected && "apt-cal-button-active",
    ),
  tableHeaderClass: "apt-cal-table-header",
  dayHeaderClass: "apt-cal-day-header",
  dayHeaderInnerClass: "apt-cal-day-header-inner",
  dayCellClass: (info) =>
    clsx(
      "apt-cal-day-cell",
      info.isToday && "apt-cal-today",
      info.isOther && "apt-cal-day-other",
      weekendClass(info.dow),
    ),
  dayCellTopClass: "apt-cal-day-top",
  dayCellTopInnerClass: "apt-cal-day-number",
  dayCellInnerClass: "apt-cal-day-events",
  dayLaneClass: (info) =>
    clsx("apt-cal-day-lane", info.isToday && "apt-cal-today", weekendClass(info.dow)),
  slotLaneClass: "apt-cal-slot-lane",
  slotHeaderClass: "apt-cal-slot-header",
  slotHeaderInnerClass: "apt-cal-slot-label",
  allDayHeaderClass: "apt-cal-all-day-header",
  allDayHeaderInnerClass: "apt-cal-axis-label",
  weekNumberHeaderClass: "apt-cal-week-number-header",
  weekNumberHeaderInnerClass: "apt-cal-axis-label",
  inlineWeekNumberClass: "apt-cal-week-number",
  eventClass: "apt-cal-event",
  eventInnerClass: "apt-cal-event-main",
  columnEventClass: "apt-cal-column-event",
  blockEventClass: "apt-cal-block-event",
  rowEventClass: "apt-cal-row-event",
  listItemEventClass: "apt-cal-list-event",
  listItemEventBeforeClass: "apt-cal-list-event-dot",
  moreLinkClass: "apt-cal-more-link",
  nowIndicatorLineClass: "apt-cal-now-line",
  nowIndicatorHeaderClass: "apt-cal-now-arrow",
  listDayHeaderClass: "apt-cal-list-day-header",
  listDayHeaderInnerClass: "apt-cal-list-day-text",
  highlightClass: "apt-cal-highlight",
} satisfies Partial<FullCalendarProps>;

// The calendar keeps FullCalendar's "local" zone and gets naive Berlin wall
// times (events are `${date}T${time}` without an offset), so they render
// unshifted in any browser zone. "Now" must be naive Berlin time as well, or
// the today column and the now indicator follow the browser's clock.
const berlinCalendarNow = () => berlinNowNaive();

// The calendar runs in the browser's "local" zone on naive Berlin wall times,
// so the period's dates are read with local getters.
function localDateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

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

  // The height of 15 minutes (a slot is 30): a short visit is drawn as one
  // line and no taller than its time, so back-to-back 15-minute visits never
  // cover each other (QA 2026-11-11, B-01). Longer visits are taller anyway.
  const eventMinHeight = Math.max(18, Math.round(slotHeightPx / 2));
  const eventShortHeight = Math.round(
    Math.max(eventMinHeight + 8, clamp(slotHeightPx * 0.98, 44, 92)),
  );

  return { eventMinHeight, eventShortHeight };
}

function resolveSlotHeightCeiling(view: CalendarView): number {
  return view === "timeGridDay" ? 320 : 280;
}

type DesktopCalendarSurfaceProps = {
  calendarRef: RefObject<CalendarRef | null>;
  lang: string;
  dictionary: Record<string, string>;
  calendarView: CalendarView;
  calendarDate: string;
  canEditSchedule: boolean;
  dateClick: FullCalendarProps["dateClick"];
  /** A click or a dragged range on free time: the quick create popover. */
  select?: FullCalendarProps["select"];
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
  /**
   * Opens the quick-action menu of an event on a right click. Left out for
   * roles that cannot change an appointment's status: their right click keeps
   * the browser's own menu.
   */
  onOpenQuickActions?: (
    event: ReactMouseEvent<HTMLElement>,
    appointmentId: string,
  ) => void;
  onOpenDetail: (appointmentId: string) => void;
  onStatusChange: (
    appointmentId: string,
    status: AppointmentStatus,
    recurrenceScope?: AppointmentRecurringActionScope,
  ) => Promise<void> | void;
};

// The event element carries its appointment id so that one delegated
// context-menu handler on the calendar shell can find the event.
const markCalendarEventElement: NonNullable<FullCalendarProps["eventDidMount"]> = (info) => {
  info.el.dataset.appointmentId = info.event.id;
};

export function DesktopCalendarSurface({
  calendarRef,
  lang,
  dictionary,
  calendarView,
  calendarDate,
  canEditSchedule,
  dateClick,
  select,
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
  onOpenQuickActions,
  onOpenDetail,
  onStatusChange,
}: DesktopCalendarSurfaceProps) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const handleEventContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!onOpenQuickActions || !(event.target instanceof Element)) return;
    const appointmentId = event.target
      .closest<HTMLElement>("[data-appointment-id]")
      ?.dataset.appointmentId;
    if (appointmentId) onOpenQuickActions(event, appointmentId);
  };
  const isTimeGridView = isTimeGridCalendarView(calendarView);
  // The shown period, to fit the visible hours to its visits (E F1).
  const [visibleRange, setVisibleRange] = useState<{
    start: string;
    end: string;
  } | null>(null);
  const handleDatesSet = useCallback<NonNullable<FullCalendarProps["datesSet"]>>(
    (info) => {
      const start = localDateKey(info.start);
      const end = localDateKey(info.end);
      setVisibleRange((current) =>
        current?.start === start && current.end === end ? current : { start, end },
      );
      datesSet?.(info);
    },
    [datesSet],
  );
  const timeGridHours = useMemo(
    () => resolveTimeGridHours(events, visibleRange?.start, visibleRange?.end),
    [events, visibleRange],
  );
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
  const headerToolbar = useMemo(
    () => ({
      left: "prev,next today",
      center: "title",
      right: "dayGridMonth,timeGridWeek,timeGridDay,listWeek",
    }),
    [],
  );
  // "Октябрь 2026" / "5–11 октября 2026" instead of the browser's "Окт. 2026 Г.".
  // The day headers keep FullCalendar 6's defaults: "пн 12.10" in the week,
  // "Montag" in the day view (7 shows "пн 12" and "Montag 12").
  const calendarViews = useMemo(() => {
    const titleViews = appointmentCalendarTitleViews(lang === "de" ? "de" : "ru");
    return {
      ...titleViews,
      timeGridWeek: { ...titleViews.timeGridWeek, dayHeaderFormat: WEEK_DAY_HEADER_FORMAT },
      timeGridDay: { ...titleViews.timeGridDay, dayHeaderFormat: DAY_HEADER_FORMAT },
    };
  }, [lang]);

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
          ? ".apt-cal-view-timeGridDay .apt-cal-column-event .fc-apt-event-card"
          : ".apt-cal-view-timeGridWeek .apt-cal-column-event .fc-apt-event-card";
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
    <section className="bg-card">
      <div
        ref={shellRef}
        className="appointments-calendar-shell p-3"
        onContextMenu={handleEventContextMenu}
      >
        <FullCalendar
          ref={calendarRef}
          plugins={FULL_CALENDAR_PLUGINS}
          {...FULL_CALENDAR_CLASS_HOOKS}
          locale={lang === "de" ? DE_CALENDAR_LOCALE : RU_CALENDAR_LOCALE}
          views={calendarViews}
          eventTimeFormat={FULL_CALENDAR_EVENT_TIME_FORMAT}
          eventDisplay="block"
          displayEventEnd={false}
          initialView={calendarView}
          initialDate={calendarDate}
          headerToolbar={headerToolbar}
          height="auto"
          firstDay={CALENDAR_FIRST_DAY}
          weekNumbers
          weekNumberCalculation={CALENDAR_WEEK_NUMBER_CALCULATION}
          weekTextShort={lang === "de" ? "KW" : "Нед."}
          slotDuration="00:30:00"
          slotMinHeight={slotHeightPx}
          slotMinTime={timeGridHours.slotMinTime}
          slotMaxTime={timeGridHours.slotMaxTime}
          dayMaxEvents={3}
          // Visits at the same time sit side by side in their own columns,
          // never cascading over each other; beyond four a «+N» link opens
          // the rest instead of 1–3 px tiles (QA 2026-11-16 verify-D F1/F2).
          slotEventOverlap={false}
          eventMaxStack={4}
          now={berlinCalendarNow}
          nowIndicator
          eventMinHeight={eventHeights.eventMinHeight}
          eventShortHeight={eventHeights.eventShortHeight}
          editable={canEditSchedule}
          eventStartEditable={canEditSchedule}
          eventDurationEditable={canEditSchedule}
          eventResizableFromStart={canEditSchedule}
          dateClick={dateClick}
          selectable={Boolean(select)}
          selectMirror
          select={select}
          eventClick={eventClick}
          eventDrop={eventDrop}
          eventResize={eventResize}
          eventContent={eventContent}
          eventDidMount={markCalendarEventElement}
          datesSet={handleDatesSet}
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
