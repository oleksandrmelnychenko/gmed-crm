import { useCallback, useState } from "react";
import type { EventDropArg } from "@fullcalendar/core";
import type { EventResizeDoneArg } from "@fullcalendar/interaction";

import {
  updateAppointmentSchedule,
  updateAppointmentStatus,
} from "@/pages/appointments/data/appointment-mutations";
import { useAppointmentLabels } from "@/pages/appointments/model/labels";
import {
  billingReversalRequestFromError,
  requestAppointmentBillingReversal,
} from "@/pages/appointments/model/billing-reversal-request";
import { statusActionKey } from "@/pages/appointments/model/form-factories";
import {
  useScheduleWarnings,
} from "@/pages/appointments/model/schedule-warnings";
import { toDateInput, toTimeInput } from "@/pages/appointments/model/date-time";
import { canRescheduleAppointmentItem } from "@/pages/appointments/model/selectors";
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
  const {
    buildLocalScheduleWarnings,
    buildScheduleNotice,
    formatScheduleConflictError,
  } = useScheduleWarnings();
  const { appointmentText } = useAppointmentLabels();
  const [actionBusy, setActionBusy] = useState("");

  const resetAppointmentSchedulerActionState = useCallback(() => {
    setActionBusy("");
  }, []);

  const handleInlineReschedule = useCallback(
    async (info: EventDropArg | EventResizeDoneArg) => {
      const source = appointmentsIndex.get(info.event.id);
      if (
        !source ||
        !canRescheduleAppointmentItem(canEditSchedule, source) ||
        !info.event.start
      ) {
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
          appointmentType: source.type,
          providerId: source.provider_id,
          doctorId: source.doctor_id,
          ownerUserId: source.owner_user_id,
          interpreterId: source.interpreter_id,
          title: source.title,
          date: nextDate,
          timeStart: nextTimeStart || null,
          timeEnd: nextTimeEnd || null,
          location: source.location,
          skipMedicalProviderBinding:
            source.type === "medical" && !source.provider_id,
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
        onRefreshAppointments();
        if (selectedId === appointmentId) {
          onRefreshDetail();
        }
      } catch (error) {
        // A visit with a billed interpreter report: offer the cancellation
        // with billing reversal instead of an error (decision 2026-09-29).
        const reversal =
          status === "cancelled"
            ? billingReversalRequestFromError(error, appointmentId, recurrenceScope, () => {
                onRefreshAppointments();
                if (selectedId === appointmentId) onRefreshDetail();
              })
            : null;
        if (reversal) {
          requestAppointmentBillingReversal(reversal);
          return;
        }
        const message = formatScheduleConflictError(
          error,
          appointmentText("appointments_failed_to_change_status"),
        );
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

  // A cancellation from a list row or the calendar menu asks first, like the
  // one in the appointment's own status block (QA 2026-11-10, C-F5 / S3 30):
  // it closes checklists, tasks and reminders and tells the interpreter.
  const [pendingCancellation, setPendingCancellation] =
    useState<PendingAppointmentCancellation | null>(null);

  const requestStatusChange = useCallback(
    async (
      appointmentId: string,
      status: AppointmentStatus,
      recurrenceScope: AppointmentRecurringActionScope = "single",
    ) => {
      if (status !== "cancelled") {
        await performStatusChange(appointmentId, status, recurrenceScope);
        return;
      }
      onDismissQuickActionMenu();
      setPendingCancellation({
        appointmentId,
        recurrenceScope,
        title: appointmentsIndex.get(appointmentId)?.title ?? "",
      });
    },
    [appointmentsIndex, onDismissQuickActionMenu, performStatusChange],
  );

  const dismissPendingCancellation = useCallback(() => {
    setPendingCancellation(null);
  }, []);

  const confirmPendingCancellation = useCallback(() => {
    const pending = pendingCancellation;
    setPendingCancellation(null);
    if (pending) {
      void performStatusChange(pending.appointmentId, "cancelled", pending.recurrenceScope);
    }
  }, [pendingCancellation, performStatusChange]);

  return {
    actionBusy,
    resetAppointmentSchedulerActionState,
    handleInlineReschedule,
    performStatusChange,
    requestStatusChange,
    pendingCancellation,
    dismissPendingCancellation,
    confirmPendingCancellation,
  };
}

/** A cancellation that waits for the user's confirmation. */
export type PendingAppointmentCancellation = {
  appointmentId: string;
  recurrenceScope: AppointmentRecurringActionScope;
  /** Title of the appointment the action was started on. */
  title: string;
};

/** Title and text of the confirmation of a cancellation, by its scope. */
export function appointmentCancellationConfirmation(
  pending: Pick<PendingAppointmentCancellation, "recurrenceScope" | "title">,
  text: (key: string, values?: Record<string, string | number>) => string,
): { title: string; message: string } {
  const values = { title: pending.title };
  if (pending.recurrenceScope === "following") {
    return {
      title: text("appointments_cancel_following_confirmation_title"),
      message: text("appointments_cancel_following_confirmation_message", values),
    };
  }
  if (pending.recurrenceScope === "series") {
    return {
      title: text("appointments_cancel_series_confirmation_title"),
      message: text("appointments_cancel_series_confirmation_message", values),
    };
  }
  return {
    title: text("appointments_cancel_confirmation_title"),
    message: text("appointments_cancel_single_confirmation_message", values),
  };
}
