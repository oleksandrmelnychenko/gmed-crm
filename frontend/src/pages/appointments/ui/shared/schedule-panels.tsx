import { ShieldAlert } from "lucide-react";

import { appointmentText } from "@/pages/appointments/model/labels";
import { formatAppointmentSlotLabel as slotLabel } from "@/pages/appointments/model/runtime-formatters";
import type {
  ConflictSummary,
  LocalScheduleWarning,
} from "@/pages/appointments/model/types";

type ScopedConflictItem = ConflictSummary["patient_conflicts"][number] & {
  scopes: string[];
};

function mergeScopedConflictItems(conflicts: ConflictSummary) {
  const byId = new Map<string, ScopedConflictItem>();
  const addItem = (
    item: ConflictSummary["patient_conflicts"][number],
    scope: string,
  ) => {
    const existing = byId.get(item.id);
    if (existing) {
      if (!existing.scopes.includes(scope)) {
        existing.scopes.push(scope);
      }
      return;
    }

    byId.set(item.id, { ...item, scopes: [scope] });
  };

  for (const item of conflicts.patient_conflicts) {
    addItem(item, appointmentText("appointments_patient"));
  }
  for (const item of conflicts.interpreter_conflicts) {
    addItem(item, appointmentText("appointments_interpreter"));
  }
  for (const item of conflicts.doctor_conflicts ?? []) {
    addItem(item, appointmentText("appointments_doctor"));
  }

  return [...byId.values()];
}

function conflictMetaLine(item: ScopedConflictItem) {
  const parts = [slotLabel(item)];
  const patient = [item.patient_pid, item.patient_name].filter(Boolean).join(" · ");

  if (patient) {
    parts.push(patient);
  }

  if (
    item.interpreter_name &&
    item.interpreter_name.trim().toLowerCase() !== item.patient_name.trim().toLowerCase()
  ) {
    parts.push(`${appointmentText("appointments_interpreter")}: ${item.interpreter_name}`);
  }

  return parts.join(" · ");
}

function localWarningItemLine(
  warning: LocalScheduleWarning,
  item: LocalScheduleWarning["items"][number],
) {
  const title = item.title.trim();
  const label = warning.label.trim();
  const repeatsScope =
    title.localeCompare(label, undefined, { sensitivity: "accent" }) === 0;

  return [repeatsScope ? "" : title, slotLabel(item)]
    .filter(Boolean)
    .join(" · ");
}

export function ConflictPanel({
  conflicts,
}: {
  conflicts: ConflictSummary | null;
}) {
  if (!conflicts) return null;
  const scopedItems = mergeScopedConflictItems(conflicts);
  const items = scopedItems.slice(0, 6);
  if (!conflicts.has_conflicts) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
        {appointmentText("appointments_no_patient_or_interpreter_overlaps_detected_for_the_curr")}
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0">
          <p className="font-semibold">
            {scopedItems.length}{" "}
            {appointmentText("appointments_overlap_s_detected")}
          </p>
          <div className="mt-3 space-y-2">
            {items.map((item) => (
              <div
                key={item.id}
                className="rounded-xl border border-amber-200/70 bg-white/75 px-3 py-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]">
                    {item.scopes.join(" / ")}
                  </span>
                  <span className="text-sm font-medium text-amber-900">
                    {item.title}
                  </span>
                </div>
                <p className="mt-1 text-xs text-amber-800">
                  {conflictMetaLine(item)}
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
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0">
          <p className="font-semibold">
            {appointmentText("appointments_local_schedule_pressure_detected")}
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
                </div>
                <p className="mt-1 text-xs text-amber-800">
                  {warning.items
                    .slice(0, 2)
                    .map((item) => localWarningItemLine(warning, item))
                    .join(" | ")}
                  {warning.items.length > 2
                    ? ` | ${appointmentText("appointments_hidden_more_count", {
                        count: warning.items.length - 2,
                      })}`
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
