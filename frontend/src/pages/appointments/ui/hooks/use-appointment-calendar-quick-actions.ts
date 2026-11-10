import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type MouseEvent as ReactMouseEvent,
} from "react";

import { CALENDAR_EVENT_MENU_BUTTON_ATTRIBUTE } from "@/pages/appointments/model/calendar-event-content";
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

const CALENDAR_QUICK_ACTION_MENU_WIDTH = 224;
const CALENDAR_QUICK_ACTION_MENU_HEIGHT = 300;
const CALENDAR_QUICK_ACTION_MENU_MARGIN = 16;

/** Where the menu opens: at the given point, kept inside the window. */
export function calendarQuickActionMenuPosition(
  appointmentId: string,
  left: number,
  top: number,
  viewport: { width: number; height: number } = {
    width: window.innerWidth,
    height: window.innerHeight,
  },
): CalendarQuickActionMenuState {
  return {
    appointmentId,
    top: Math.max(
      CALENDAR_QUICK_ACTION_MENU_MARGIN,
      Math.min(
        top,
        viewport.height -
          CALENDAR_QUICK_ACTION_MENU_HEIGHT -
          CALENDAR_QUICK_ACTION_MENU_MARGIN,
      ),
    ),
    left: Math.max(
      CALENDAR_QUICK_ACTION_MENU_MARGIN,
      Math.min(
        left,
        viewport.width -
          CALENDAR_QUICK_ACTION_MENU_WIDTH -
          CALENDAR_QUICK_ACTION_MENU_MARGIN,
      ),
    ),
  };
}

export function calendarQuickActionsReducer(
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

  // The «⋯» button of the tile the menu was opened from, to give the focus
  // back on Escape; null when the menu came from a right click.
  const calendarQuickActionAnchorRef = useRef<HTMLElement | null>(null);

  // Opened by a right click (context menu) on a calendar event: the menu
  // appears at the pointer.
  const openCalendarQuickActionLayer = useCallback(
    (
      event: ReactMouseEvent<HTMLElement>,
      appointmentId: string,
    ) => {
      event.preventDefault();
      event.stopPropagation();
      calendarQuickActionAnchorRef.current = null;
      dispatchCalendarQuickActions({
        type: "toggle-menu",
        appointmentId,
        menu: calendarQuickActionMenuPosition(
          appointmentId,
          event.clientX,
          event.clientY + 4,
        ),
      });
    },
    [],
  );

  // Opened by the «⋯» button of an event tile (mouse, touch or keyboard):
  // the menu appears under the button; a second press closes it.
  const openCalendarQuickActionLayerAt = useCallback(
    (anchor: HTMLElement, appointmentId: string) => {
      const rect = anchor.getBoundingClientRect();
      calendarQuickActionAnchorRef.current = anchor;
      dispatchCalendarQuickActions({
        type: "toggle-menu",
        appointmentId,
        menu: calendarQuickActionMenuPosition(
          appointmentId,
          rect.left,
          rect.bottom + 4,
        ),
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
      // The tile's «⋯» button toggles the menu itself on the click that
      // follows; closing here would make that click open it again.
      if (
        event.target instanceof Element &&
        event.target.closest(`[${CALENDAR_EVENT_MENU_BUTTON_ATTRIBUTE}]`)
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
        const anchor = calendarQuickActionAnchorRef.current;
        if (anchor?.isConnected) anchor.focus();
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
    openCalendarQuickActionLayerAt,
  };
}
