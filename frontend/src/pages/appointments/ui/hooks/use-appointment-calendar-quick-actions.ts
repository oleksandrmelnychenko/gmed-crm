import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
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

type CalendarQuickActionsState = {
  menu: CalendarQuickActionMenuState | null;
  scope: AppointmentRecurringActionScope;
};

type CalendarQuickActionsAction =
  | { type: "dismiss" }
  | { type: "set-scope"; scope: AppointmentRecurringActionScope }
  | {
      type: "toggle-menu";
      appointmentId: string;
      menu: CalendarQuickActionMenuState;
    };

const CALENDAR_QUICK_ACTIONS_INITIAL_STATE: CalendarQuickActionsState = {
  menu: null,
  scope: "single",
};

function calendarQuickActionsReducer(
  state: CalendarQuickActionsState,
  action: CalendarQuickActionsAction,
): CalendarQuickActionsState {
  switch (action.type) {
    case "dismiss":
      return { ...state, menu: null };
    case "set-scope":
      return { ...state, scope: action.scope };
    case "toggle-menu":
      if (state.menu?.appointmentId === action.appointmentId) {
        return { ...state, menu: null };
      }
      return { menu: action.menu, scope: "single" };
    default:
      return state;
  }
}

export function useAppointmentCalendarQuickActions({
  appointmentsIndex,
}: UseAppointmentCalendarQuickActionsOptions) {
  const [
    {
      menu: calendarQuickActionMenu,
      scope: calendarQuickActionScope,
    },
    dispatchCalendarQuickActions,
  ] = useReducer(
    calendarQuickActionsReducer,
    CALENDAR_QUICK_ACTIONS_INITIAL_STATE,
  );
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
    dispatchCalendarQuickActions({ type: "dismiss" });
  }, []);

  const handleCalendarQuickActionScopeChange = useCallback(
    (scope: AppointmentRecurringActionScope) => {
      dispatchCalendarQuickActions({ type: "set-scope", scope });
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
      dispatchCalendarQuickActions({
        type: "toggle-menu",
        appointmentId,
        menu: {
          appointmentId,
          top: Math.min(rect.bottom + 8, window.innerHeight - 16),
          left: Math.min(
            Math.max(16, rect.right - menuWidth),
            Math.max(16, window.innerWidth - menuWidth - 16),
          ),
        },
      });
    },
    [],
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
      dispatchCalendarQuickActions({ type: "dismiss" });
    }

    function dismissMenu() {
      dispatchCalendarQuickActions({ type: "dismiss" });
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        dispatchCalendarQuickActions({ type: "dismiss" });
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
