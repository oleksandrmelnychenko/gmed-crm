import { appointmentText } from "@/pages/appointments/model/labels";
import { formatAppointmentSlotLabel } from "@/pages/appointments/model/runtime-formatters";
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
      label: tr?.patients_assign_owner ?? appointmentText("appointments_schedule_scope_owner"),
      match: (item) =>
        Boolean(payload.ownerUserId) &&
        item.owner_user_id === payload.ownerUserId,
    },
    {
      scope: "doctor",
      label: tr?.common_doctor ?? appointmentText("appointments_schedule_scope_doctor"),
      match: (item) =>
        Boolean(payload.doctorId) && item.doctor_id === payload.doctorId,
    },
    {
      scope: "clinic",
      label: tr?.common_provider ?? appointmentText("appointments_schedule_scope_clinic"),
      match: (item) =>
        Boolean(payload.providerId) && item.provider_id === payload.providerId,
    },
  ];

  const warnings: LocalScheduleWarning[] = [];
  for (const scope of scopes) {
    const scopeItems = items.filter((item) => {
        if (item.id === payload.appointmentId || item.status === "cancelled") {
          return false;
        }
        if (!scope.match(item)) return false;
        return overlaps(
          slotWindow(item.date, item.time_start, item.time_end),
          targetWindow,
        );
      });
    if (scopeItems.length > 0) {
      warnings.push({
        scope: scope.scope,
        label: scope.label,
        items: scopeItems,
      });
    }
  }
  return warnings;
}

export function buildScheduleNotice(
  conflicts: ConflictSummary | null | undefined,
  warnings: LocalScheduleWarning[],
) {
  const parts: string[] = [];
  if (conflicts?.patient_conflict_count) {
    parts.push(
      appointmentText("appointments_patient_overlap_count", {
        count: conflicts.patient_conflict_count,
      }),
    );
  }
  if (conflicts?.interpreter_conflict_count) {
    parts.push(
      appointmentText("appointments_interpreter_overlap_count", {
        count: conflicts.interpreter_conflict_count,
      }),
    );
  }
  if (conflicts?.doctor_conflict_count) {
    parts.push(
      appointmentText("appointments_scope_overlap_count", {
        count: conflicts.doctor_conflict_count,
        scope: appointmentText("appointments_doctor").toLowerCase(),
      }),
    );
  }
  for (const warning of warnings) {
    const itemCount = warning.items.length;
    parts.push(
      appointmentText("appointments_scope_overlap_count", {
        count: itemCount,
        scope: warning.label.toLowerCase(),
      }),
    );
  }
  return parts.length
    ? appointmentText("appointments_scheduling_warning", {
        parts: parts.join(", "),
      })
    : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isConflictItem(value: unknown): value is ConflictSummary["patient_conflicts"][number] {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.date === "string" &&
    (typeof value.time_start === "string" || value.time_start === null) &&
    (typeof value.time_end === "string" || value.time_end === null)
  );
}

function conflictItemArray(value: unknown) {
  return Array.isArray(value) ? value.filter(isConflictItem) : [];
}

function conflictCount(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function conflictSummaryFromUnknown(value: unknown): ConflictSummary | null {
  if (!isRecord(value)) return null;
  const patientConflicts = conflictItemArray(value.patient_conflicts);
  const interpreterConflicts = conflictItemArray(value.interpreter_conflicts);
  const doctorConflicts = conflictItemArray(value.doctor_conflicts);
  const patientCount = conflictCount(
    value.patient_conflict_count,
    patientConflicts.length,
  );
  const interpreterCount = conflictCount(
    value.interpreter_conflict_count,
    interpreterConflicts.length,
  );
  const doctorCount = conflictCount(
    value.doctor_conflict_count,
    doctorConflicts.length,
  );
  const hasConflicts =
    value.has_conflicts === true ||
    patientCount > 0 ||
    interpreterCount > 0 ||
    doctorCount > 0;

  if (!hasConflicts) return null;

  return {
    patient_conflict_count: patientCount,
    interpreter_conflict_count: interpreterCount,
    doctor_conflict_count: doctorCount,
    has_conflicts: true,
    patient_conflicts: patientConflicts,
    interpreter_conflicts: interpreterConflicts,
    doctor_conflicts: doctorConflicts,
  };
}

function conflictSummaryFromError(error: unknown) {
  if (!isRecord(error) || !isRecord(error.body)) return null;
  return conflictSummaryFromUnknown(error.body.conflicts);
}

type ScopedConflictItem = ConflictSummary["patient_conflicts"][number] & {
  scopes: string[];
};

function scopedConflictItems(conflicts: ConflictSummary) {
  const byId = new Map<string, ScopedConflictItem>();
  const add = (
    item: ConflictSummary["patient_conflicts"][number],
    scope: string,
  ) => {
    const existing = byId.get(item.id);
    if (existing) {
      if (!existing.scopes.includes(scope)) existing.scopes.push(scope);
      return;
    }
    byId.set(item.id, { ...item, scopes: [scope] });
  };

  for (const item of conflicts.patient_conflicts) {
    add(item, appointmentText("appointments_patient"));
  }
  for (const item of conflicts.interpreter_conflicts) {
    add(item, appointmentText("appointments_interpreter"));
  }
  for (const item of conflicts.doctor_conflicts ?? []) {
    add(item, appointmentText("appointments_doctor"));
  }

  return [...byId.values()];
}

function formatConflictDetail(item: ScopedConflictItem) {
  const patient = [item.patient_pid, item.patient_name].filter(Boolean).join(" · ");
  return [
    item.scopes.join("/"),
    item.title,
    formatAppointmentSlotLabel(item),
    patient,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function formatScheduleConflictError(error: unknown, fallback: string) {
  const conflicts = conflictSummaryFromError(error);
  if (conflicts) {
    const details = scopedConflictItems(conflicts)
      .slice(0, 3)
      .map(formatConflictDetail)
      .join("; ");
    if (details) {
      return appointmentText("appointments_schedule_conflict_error", {
        details,
      });
    }
  }

  const message = error instanceof Error ? error.message : "";
  if (message.toLowerCase().includes("appointment conflict")) {
    return appointmentText("appointments_schedule_conflict_generic");
  }
  return message || fallback;
}
