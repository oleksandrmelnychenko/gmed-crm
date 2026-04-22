import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";

import type {
  AppointmentListItem,
  AppointmentRecurringActionScope,
  CalendarQuickActionMenuState,
} from "@/pages/appointments/model/types";

type UseAppointmentCalendarQuickActionsOptions = {
  appointmentsIndex: Map<string, AppointmentListItem>;
};

export function useAppointmentCalendarQuickActions({
  appointmentsIndex,
}: UseAppointmentCalendarQuickActionsOptions) {
  const [calendarQuickActionMenu, setCalendarQuickActionMenu] =
    useState<CalendarQuickActionMenuState | null>(null);
  const [calendarQuickActionScope, setCalendarQuickActionScope] =
    useState<AppointmentRecurringActionScope>("single");
  const calendarQuickActionMenuRef = useRef<HTMLDivElement | null>(null);

  const activeCalendarQuickActionItem = useMemo(
    () =>
      calendarQuickActionMenu
        ? (appointmentsIndex.get(calendarQuickActionMenu.appointmentId) ?? null)
        : null,
    [appointmentsIndex, calendarQuickActionMenu],
  );
  const activeCalendarQuickActionScope =
    activeCalendarQuickActionItem?.recurrence_frequency
      ? calendarQuickActionScope
      : "single";

  const dismissCalendarQuickActionMenu = useCallback(() => {
    setCalendarQuickActionMenu(null);
  }, []);

  const handleCalendarQuickActionScopeChange = useCallback(
    (scope: AppointmentRecurringActionScope) => {
      setCalendarQuickActionScope(scope);
    },
    [],
  );

  const openCalendarQuickActionLayer = useCallback(
    (
      event: ReactMouseEvent<HTMLButtonElement>,
      appointmentId: string,
    ) => {
      event.preventDefault();
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      const menuWidth = 220;
      if (calendarQuickActionMenu?.appointmentId !== appointmentId) {
        setCalendarQuickActionScope("single");
      }
      setCalendarQuickActionMenu((current) =>
        current?.appointmentId === appointmentId
          ? null
          : {
              appointmentId,
              top: Math.min(rect.bottom + 8, window.innerHeight - 16),
              left: Math.min(
                Math.max(16, rect.right - menuWidth),
                Math.max(16, window.innerWidth - menuWidth - 16),
              ),
            },
      );
    },
    [calendarQuickActionMenu?.appointmentId],
  );

  useEffect(() => {
    if (!calendarQuickActionMenu) return;

    function handlePointerDown(event: PointerEvent) {
      if (
        calendarQuickActionMenuRef.current &&
        event.target instanceof Node &&
        calendarQuickActionMenuRef.current.contains(event.target)
      ) {
        return;
      }
      setCalendarQuickActionMenu(null);
    }

    function dismissMenu() {
      setCalendarQuickActionMenu(null);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setCalendarQuickActionMenu(null);
      }
    }

    calendarQuickActionMenuRef.current?.focus();
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("resize", dismissMenu);
    window.addEventListener("scroll", dismissMenu, true);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("resize", dismissMenu);
      window.removeEventListener("scroll", dismissMenu, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [calendarQuickActionMenu]);

  return {
    calendarQuickActionMenu,
    calendarQuickActionMenuRef,
    calendarQuickActionScope,
    activeCalendarQuickActionItem,
    activeCalendarQuickActionScope,
    dismissCalendarQuickActionMenu,
    handleCalendarQuickActionScopeChange,
    openCalendarQuickActionLayer,
  };
}
