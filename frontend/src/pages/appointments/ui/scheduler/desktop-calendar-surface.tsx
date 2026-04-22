import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import deLocale from "@fullcalendar/core/locales/de";
import ruLocale from "@fullcalendar/core/locales/ru";
import type { EventInput } from "@fullcalendar/core";
import type { ComponentProps, RefObject } from "react";

import { AppointmentCalendarQuickActionsMenu } from "@/pages/appointments/ui/scheduler/appointment-calendar-quick-actions-menu";
import type {
  AppointmentListItem,
  AppointmentRecurringActionScope,
  AppointmentStatus,
  CalendarQuickActionMenuState,
  CalendarView,
} from "@/pages/appointments/model/types";

type FullCalendarProps = ComponentProps<typeof FullCalendar>;

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
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="appointments-calendar-shell p-3">
        <FullCalendar
          ref={calendarRef}
          plugins={[
            dayGridPlugin,
            timeGridPlugin,
            listPlugin,
            interactionPlugin,
          ]}
          locale={lang === "de" ? deLocale : ruLocale}
          eventTimeFormat={{
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
            omitZeroMinute: false,
          }}
          displayEventEnd={false}
          initialView={calendarView}
          initialDate={calendarDate}
          headerToolbar={{
            left: "prev,next today",
            center: "title",
            right: "dayGridMonth,timeGridWeek,timeGridDay,listWeek",
          }}
          buttonText={{
            today: dictionary.dash_patients_today ?? "Today",
            month: dictionary.dash_this_month ?? "Month",
            week: dictionary.dash_this_week ?? "Week",
            day: dictionary.appointments_date ?? "Day",
            list: dictionary.providers_all ?? "List",
          }}
          height="auto"
          firstDay={1}
          slotMinTime="06:00:00"
          slotMaxTime="22:00:00"
          dayMaxEvents={3}
          nowIndicator
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
