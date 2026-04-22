import {
  startTransition,
  useCallback,
  useEffect,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import type FullCalendar from "@fullcalendar/react";
import type { DateClickArg } from "@fullcalendar/interaction";
import type { DatesSetArg } from "@fullcalendar/core";

import { blankAppointmentForm } from "@/pages/appointments/model/form-factories";
import { toDateInput, toTimeInput } from "@/pages/appointments/model/date-time";
import type {
  AppointmentFormState,
  CalendarView,
  FiltersState,
  OperationalScope,
  SchedulerQuickScope,
} from "@/pages/appointments/model/types";

type UseAppointmentSchedulerControlsOptions = {
  calendarRef: RefObject<FullCalendar | null>;
  canCreate: boolean;
  currentUserId?: string;
  currentUserRole?: string;
  todayDate: string;
  weekStart: string;
  weekEnd: string;
  defaultFilters: FiltersState;
  setFilters: Dispatch<SetStateAction<FiltersState>>;
  setOperationalScope: Dispatch<SetStateAction<OperationalScope>>;
  setCalendarView: Dispatch<SetStateAction<CalendarView>>;
  setCalendarDate: Dispatch<SetStateAction<string>>;
  syncQuery: (next: Record<string, string | null>) => void;
  onRefreshAppointments: () => void;
  onOpenCreateSeed: (seed: AppointmentFormState) => void;
  onDismissQuickActionMenu: () => void;
};

export function useAppointmentSchedulerControls({
  calendarRef,
  canCreate,
  currentUserId,
  currentUserRole,
  todayDate,
  weekStart,
  weekEnd,
  defaultFilters,
  setFilters,
  setOperationalScope,
  setCalendarView,
  setCalendarDate,
  syncQuery,
  onRefreshAppointments,
  onOpenCreateSeed,
  onDismissQuickActionMenu,
}: UseAppointmentSchedulerControlsOptions) {
  const syncCalendar = useCallback(
    (nextView?: CalendarView, nextDate?: string) => {
      const api = calendarRef.current?.getApi();
      if (api && nextView && api.view.type !== nextView) {
        api.changeView(nextView);
      }
      if (api && nextDate) {
        api.gotoDate(nextDate);
      }
      if (nextView) setCalendarView(nextView);
      if (nextDate) setCalendarDate(nextDate);
    },
    [calendarRef, setCalendarDate, setCalendarView],
  );

  const handleDatesSet = useCallback(
    (arg: DatesSetArg) => {
      const nextView = arg.view.type as CalendarView;
      const nextDate = toDateInput(arg.view.calendar.getDate());
      onDismissQuickActionMenu();
      setCalendarView((current) => (current === nextView ? current : nextView));
      setCalendarDate((current) => (current === nextDate ? current : nextDate));
    },
    [onDismissQuickActionMenu, setCalendarDate, setCalendarView],
  );

  const applyTodayScope = useCallback(() => {
    startTransition(() => {
      setFilters((current) => ({
        ...current,
        dateFrom: todayDate,
        dateTo: todayDate,
      }));
    });
    syncCalendar("timeGridDay", todayDate);
  }, [setFilters, syncCalendar, todayDate]);

  const applyWeekScope = useCallback(() => {
    startTransition(() => {
      setFilters((current) => ({
        ...current,
        dateFrom: weekStart,
        dateTo: weekEnd,
      }));
    });
    syncCalendar("timeGridWeek", weekStart);
  }, [setFilters, syncCalendar, weekEnd, weekStart]);

  const applyMineScope = useCallback(() => {
    if (!currentUserId) return;
    setOperationalScope("all");
    startTransition(() => {
      setFilters((current) => ({
        ...current,
        ownerUserId: currentUserRole === "interpreter" ? "" : currentUserId,
        interpreterId: currentUserRole === "interpreter" ? currentUserId : "",
      }));
    });
  }, [
    currentUserId,
    currentUserRole,
    setFilters,
    setOperationalScope,
  ]);

  const applyOperationalScope = useCallback(
    (scope: OperationalScope) => {
      setOperationalScope(scope);
    },
    [setOperationalScope],
  );

  const applySchedulerQuickScope = useCallback(
    (scope: SchedulerQuickScope) => {
      if (scope === "today") {
        startTransition(() => {
          setFilters((current) => ({
            ...current,
            dateFrom: todayDate,
            dateTo: todayDate,
            ownerUserId: "",
            interpreterId: "",
            appointmentType: "",
          }));
        });
        syncCalendar("timeGridDay", todayDate);
        return;
      }
      if (scope === "week") {
        startTransition(() => {
          setFilters((current) => ({
            ...current,
            dateFrom: weekStart,
            dateTo: weekEnd,
            ownerUserId: "",
            interpreterId: "",
            appointmentType: "",
          }));
        });
        syncCalendar("timeGridWeek", weekStart);
        return;
      }
      if (scope === "mine") {
        if (!currentUserId) return;
        setOperationalScope("all");
        startTransition(() => {
          setFilters((current) => ({
            ...current,
            dateFrom: "",
            dateTo: "",
            appointmentType: "",
            ownerUserId:
              currentUserRole === "interpreter" ? "" : currentUserId,
            interpreterId:
              currentUserRole === "interpreter" ? currentUserId : "",
          }));
        });
        return;
      }
      if (
        scope === "medical" ||
        scope === "non_medical" ||
        scope === "internal"
      ) {
        setOperationalScope("all");
        startTransition(() => {
          setFilters((current) => ({
            ...current,
            dateFrom: "",
            dateTo: "",
            ownerUserId: "",
            interpreterId: "",
            appointmentType: scope,
          }));
        });
        return;
      }
      startTransition(() => {
        setFilters((current) => ({
          ...current,
          dateFrom: "",
          dateTo: "",
          ownerUserId: "",
          interpreterId: "",
          appointmentType: "",
        }));
      });
    },
    [
      currentUserId,
      currentUserRole,
      setFilters,
      setOperationalScope,
      syncCalendar,
      todayDate,
      weekEnd,
      weekStart,
    ],
  );

  const resetQuickScopes = useCallback(() => {
    setOperationalScope("all");
    startTransition(() => setFilters(defaultFilters));
    syncCalendar("timeGridWeek", todayDate);
    syncQuery({
      patient: null,
      provider: null,
      doctor: null,
      appointment: null,
      detailTab: null,
    });
  }, [
    defaultFilters,
    setFilters,
    setOperationalScope,
    syncCalendar,
    syncQuery,
    todayDate,
  ]);

  const openCreateSheetFromDate = useCallback(
    (info?: DateClickArg) => {
      if (!canCreate) return;
      const next = blankAppointmentForm();
      if (info) {
        next.date = toDateInput(info.date);
        if (!info.allDay) {
          next.timeStart = toTimeInput(info.date);
          next.timeEnd = toTimeInput(
            new Date(info.date.getTime() + 60 * 60 * 1000),
          );
        }
      }
      onOpenCreateSeed(next);
    },
    [canCreate, onOpenCreateSeed],
  );

  useEffect(() => {
    const handleRefreshRequest = () => {
      onRefreshAppointments();
    };
    const handleCreateRequest = () => {
      if (!canCreate) return;
      onOpenCreateSeed(blankAppointmentForm());
    };

    window.addEventListener(
      "appointments:refresh-request",
      handleRefreshRequest as EventListener,
    );
    window.addEventListener(
      "appointments:create-request",
      handleCreateRequest as EventListener,
    );

    return () => {
      window.removeEventListener(
        "appointments:refresh-request",
        handleRefreshRequest as EventListener,
      );
      window.removeEventListener(
        "appointments:create-request",
        handleCreateRequest as EventListener,
      );
    };
  }, [canCreate, onOpenCreateSeed, onRefreshAppointments]);

  return {
    handleDatesSet,
    applyTodayScope,
    applyWeekScope,
    applyMineScope,
    applyOperationalScope,
    applySchedulerQuickScope,
    resetQuickScopes,
    openCreateSheetFromDate,
  };
}
