import { ShieldAlert } from "lucide-react";

import { appointmentText } from "@/pages/appointments/model/labels";
import { formatAppointmentSlotLabel as slotLabel } from "@/pages/appointments/model/runtime-formatters";
import type {
  ConflictSummary,
  LocalScheduleWarning,
} from "@/pages/appointments/model/types";

export function ConflictPanel({
  conflicts,
}: {
  conflicts: ConflictSummary | null;
}) {
  if (!conflicts) return null;
  const items = [
    ...conflicts.patient_conflicts.map((item) => ({
      ...item,
      scope: appointmentText("Patient", "Пациент", "Patient"),
    })),
    ...conflicts.interpreter_conflicts.map((item) => ({
      ...item,
      scope: appointmentText("Dolmetscher", "Переводчик", "Interpreter"),
    })),
  ].slice(0, 6);
  if (!conflicts.has_conflicts) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
        {appointmentText(
          "Für dieses Zeitfenster wurden keine Patienten- oder Dolmetscherüberschneidungen gefunden.",
          "Для этого слота не найдено пересечений по пациенту или переводчику.",
          "No patient or interpreter overlaps detected for the current slot.",
        )}
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0">
          <p className="font-semibold">
            {conflicts.patient_conflict_count +
              conflicts.interpreter_conflict_count}{" "}
            {appointmentText(
              "Überschneidung(en) erkannt",
              "Обнаружены пересечения",
              "Overlap(s) detected",
            )}
          </p>
          <div className="mt-3 space-y-2">
            {items.map((item) => (
              <div
                key={`${item.scope}-${item.id}`}
                className="rounded-xl border border-amber-200/70 bg-white/75 px-3 py-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]">
                    {item.scope}
                  </span>
                  <span className="text-sm font-medium text-amber-900">
                    {item.title}
                  </span>
                </div>
                <p className="mt-1 text-xs text-amber-800">
                  {slotLabel(item)} · {item.patient_pid}
                  {item.interpreter_name ? ` · ${item.interpreter_name}` : ""}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ScheduleWarningsPanel({
  warnings,
}: {
  warnings: LocalScheduleWarning[];
}) {
  if (warnings.length === 0) return null;
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0">
          <p className="font-semibold">
            {appointmentText(
              "Lokaler Termindruck erkannt",
              "Обнаружен локальный конфликт расписания",
              "Local schedule pressure detected",
            )}
          </p>
          <div className="mt-3 space-y-2">
            {warnings.map((warning) => (
              <div
                key={warning.scope}
                className="rounded-xl border border-amber-200/70 bg-white/75 px-3 py-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]">
                    {warning.label}
                  </span>
                  <span className="text-sm font-medium text-amber-900">
                    {warning.label}
                  </span>
                </div>
                <p className="mt-1 text-xs text-amber-800">
                  {warning.items
                    .slice(0, 2)
                    .map((item) => `${item.title} · ${slotLabel(item)}`)
                    .join(" | ")}
                  {warning.items.length > 2
                    ? ` | +${warning.items.length - 2} more`
                    : ""}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
