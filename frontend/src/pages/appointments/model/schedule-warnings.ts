import { appointmentText } from "@/pages/appointments/model/labels";
import type {
  AppointmentListItem,
  ConflictSummary,
  LocalScheduleWarning,
  LocalScheduleWarningScope,
} from "@/pages/appointments/model/types";

type ScheduleWarningPayload = {
  appointmentId?: string;
  date: string;
  timeStart: string;
  timeEnd: string;
  ownerUserId?: string | null;
  providerId?: string | null;
  doctorId?: string | null;
};

function addHourToTime(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  const total = (hours * 60 + minutes + 60) % (24 * 60);
  const nextHours = Math.floor(total / 60)
    .toString()
    .padStart(2, "0");
  const nextMinutes = (total % 60).toString().padStart(2, "0");
  return `${nextHours}:${nextMinutes}`;
}

function slotWindow(
  date: string,
  timeStart: string | null,
  timeEnd: string | null,
) {
  if (!date) return null;
  const start = new Date(`${date}T${timeStart || "00:00"}:00`);
  const end = new Date(
    `${date}T${timeEnd || (timeStart ? addHourToTime(timeStart) : "23:59")}:00`,
  );
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return {
    startMs: start.getTime(),
    endMs: Math.max(end.getTime(), start.getTime() + 60_000),
  };
}

function overlaps(
  left: { startMs: number; endMs: number } | null,
  right: { startMs: number; endMs: number } | null,
) {
  if (!left || !right) return false;
  return left.startMs < right.endMs && right.startMs < left.endMs;
}

export function buildLocalScheduleWarnings(
  items: AppointmentListItem[],
  payload: ScheduleWarningPayload,
  tr?: Record<string, string>,
): LocalScheduleWarning[] {
  if (!payload.date) return [];

  const targetWindow = slotWindow(
    payload.date,
    payload.timeStart || null,
    payload.timeEnd || null,
  );

  const scopes: Array<{
    scope: LocalScheduleWarningScope;
    label: string;
    match: (item: AppointmentListItem) => boolean;
  }> = [
    {
      scope: "owner",
      label: tr?.patients_assign_owner ?? "Owner",
      match: (item) =>
        Boolean(payload.ownerUserId) &&
        item.owner_user_id === payload.ownerUserId,
    },
    {
      scope: "doctor",
      label: tr?.common_doctor ?? "Doctor",
      match: (item) =>
        Boolean(payload.doctorId) && item.doctor_id === payload.doctorId,
    },
    {
      scope: "clinic",
      label: tr?.common_provider ?? "Clinic",
      match: (item) =>
        Boolean(payload.providerId) && item.provider_id === payload.providerId,
    },
  ];

  return scopes
    .map((scope) => ({
      scope: scope.scope,
      label: scope.label,
      items: items.filter((item) => {
        if (item.id === payload.appointmentId || item.status === "cancelled") {
          return false;
        }
        if (!scope.match(item)) return false;
        return overlaps(
          slotWindow(item.date, item.time_start, item.time_end),
          targetWindow,
        );
      }),
    }))
    .filter((warning) => warning.items.length > 0);
}

export function buildScheduleNotice(
  conflicts: ConflictSummary | null | undefined,
  warnings: LocalScheduleWarning[],
) {
  const parts: string[] = [];
  if (conflicts?.patient_conflict_count) {
    parts.push(
      appointmentText(
        `${conflicts.patient_conflict_count} Patientenuberschneidung`,
        `${conflicts.patient_conflict_count} пересечение по пациенту`,
        `${conflicts.patient_conflict_count} patient overlap`,
      ),
    );
  }
  if (conflicts?.interpreter_conflict_count) {
    parts.push(
      appointmentText(
        `${conflicts.interpreter_conflict_count} Dolmetscheruberschneidung`,
        `${conflicts.interpreter_conflict_count} пересечение по переводчику`,
        `${conflicts.interpreter_conflict_count} interpreter overlap`,
      ),
    );
  }
  for (const warning of warnings) {
    parts.push(
      appointmentText(
        `${warning.items.length} Konflikt bei ${warning.label.toLowerCase()}`,
        `${warning.items.length} конфликт по ${warning.label.toLowerCase()}`,
        `${warning.items.length} ${warning.scope} overlap`,
      ),
    );
  }
  return parts.length
    ? appointmentText(
        `Planungshinweis: ${parts.join(", ")}.`,
        `Предупреждение по расписанию: ${parts.join(", ")}.`,
        `Scheduling warning: ${parts.join(", ")}.`,
      )
    : "";
}
