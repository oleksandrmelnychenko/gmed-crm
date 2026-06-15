import { useCallback, useState } from "react";
import type { EventDropArg } from "@fullcalendar/core";
import type { EventResizeDoneArg } from "@fullcalendar/interaction";

import {
  updateAppointmentSchedule,
  updateAppointmentStatus,
} from "@/pages/appointments/data/appointment-mutations";
import { appointmentText } from "@/pages/appointments/model/labels";
import { statusActionKey } from "@/pages/appointments/model/form-factories";
import {
  buildLocalScheduleWarnings,
  buildScheduleNotice,
  formatScheduleConflictError,
} from "@/pages/appointments/model/schedule-warnings";
import { toDateInput, toTimeInput } from "@/pages/appointments/model/date-time";
import type {
  AppointmentListItem,
  AppointmentRecurringActionScope,
  AppointmentStatus,
} from "@/pages/appointments/model/types";

type UseAppointmentSchedulerActionsOptions = {
  appointments: AppointmentListItem[];
  appointmentsIndex: Map<string, AppointmentListItem>;
  canEditSchedule: boolean;
  selectedId: string;
  dictionary: Record<string, string>;
  onNotice: (notice: string) => void;
  onAppointmentsError: (message: string) => void;
  onDetailError: (message: string) => void;
  onRefreshAppointments: () => void;
  onRefreshDetail: () => void;
  onDismissQuickActionMenu: () => void;
};

export function useAppointmentSchedulerActions({
  appointments,
  appointmentsIndex,
  canEditSchedule,
  selectedId,
  dictionary,
  onNotice,
  onAppointmentsError,
  onDetailError,
  onRefreshAppointments,
  onRefreshDetail,
  onDismissQuickActionMenu,
}: UseAppointmentSchedulerActionsOptions) {
  const [actionBusy, setActionBusy] = useState("");

  const resetAppointmentSchedulerActionState = useCallback(() => {
    setActionBusy("");
  }, []);

  const handleInlineReschedule = useCallback(
    async (info: EventDropArg | EventResizeDoneArg) => {
      const source = appointmentsIndex.get(info.event.id);
      if (!source || !canEditSchedule || source.is_blocked || !info.event.start) {
        info.revert();
        return;
      }

      const nextDate = toDateInput(info.event.start);
      const nextTimeStart = info.event.allDay
        ? ""
        : toTimeInput(info.event.start);
      const nextTimeEnd = info.event.allDay
        ? ""
        : info.event.end
          ? toTimeInput(info.event.end)
          : source.time_end || "";
      const localWarnings = buildLocalScheduleWarnings(
        appointments,
        {
          appointmentId: source.id,
          date: nextDate,
          timeStart: nextTimeStart,
          timeEnd: nextTimeEnd,
          ownerUserId: source.owner_user_id,
          providerId: source.provider_id,
          doctorId: source.doctor_id,
        },
        dictionary,
      );

      try {
        const result = await updateAppointmentSchedule({
          appointmentId: source.id,
          providerId: source.provider_id,
          doctorId: source.doctor_id,
          ownerUserId: source.owner_user_id,
          interpreterId: source.interpreter_id,
          title: source.title,
          date: nextDate,
          timeStart: nextTimeStart || null,
          timeEnd: nextTimeEnd || null,
          location: source.location,
        });
        onNotice(buildScheduleNotice(result.conflicts, localWarnings));
        onRefreshAppointments();
        if (selectedId === source.id) onRefreshDetail();
      } catch (error) {
        info.revert();
        onAppointmentsError(
          formatScheduleConflictError(error, dictionary.common_failed_update),
        );
      }
    },
    [
      appointments,
      appointmentsIndex,
      canEditSchedule,
      dictionary,
      onAppointmentsError,
      onNotice,
      onRefreshAppointments,
      onRefreshDetail,
      selectedId,
    ],
  );

  const performStatusChange = useCallback(
    async (
      appointmentId: string,
      status: AppointmentStatus,
      recurrenceScope: AppointmentRecurringActionScope = "single",
    ) => {
      onDismissQuickActionMenu();
      setActionBusy(statusActionKey(appointmentId, status, recurrenceScope));
      try {
        await updateAppointmentStatus(appointmentId, status, recurrenceScope);
        if (selectedId === appointmentId) {
          onRefreshDetail();
        } else {
          onRefreshAppointments();
        }
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : appointmentText("appointments_failed_to_change_status");
        if (selectedId === appointmentId) {
          onDetailError(message);
        } else {
          onAppointmentsError(message);
        }
      } finally {
        setActionBusy("");
      }
    },
    [
      onAppointmentsError,
      onDetailError,
      onDismissQuickActionMenu,
      onRefreshAppointments,
      onRefreshDetail,
      selectedId,
    ],
  );

  return {
    actionBusy,
    resetAppointmentSchedulerActionState,
    handleInlineReschedule,
    performStatusChange,
  };
}
