import { memo } from "react";

import { useLang } from "@/lib/i18n";
import {
  appointmentText,
  appointmentTypeLabel,
  responseLabel,
  roleLabel,
} from "@/pages/appointments/model/labels";
import { formatAppointmentDateTimeLabel } from "@/pages/appointments/model/runtime-formatters";
import type { AppointmentDetail } from "@/pages/appointments/model/types";
import { ContextCard } from "@/pages/appointments/ui/shared/context-card";

function AppointmentSnapshotSection({
  detail,
}: {
  detail: AppointmentDetail;
}) {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const summaryTitle = appointmentText("appointments_status_and_responsibilities");
  const orderLabel = appointmentText("appointments_order");
  const snapshotCards = [
    {
      label: t.orders_phase,
      value: detail.checklist_phase || tr.phase_discovery,
      meta: appointmentTypeLabel(detail.type, tr),
    },
    {
      label: t.patients_assign_owner,
      value: detail.owner_name || tr.common_not_set,
      meta: detail.owner_role ? roleLabel(detail.owner_role) : tr.common_not_set,
    },
  ];

  if (detail.doctor_name || detail.type === "medical") {
    snapshotCards.push({
      label: t.common_doctor,
      value: detail.doctor_name || tr.common_not_set,
      meta: detail.provider_name || tr.common_not_set,
    });
  }

  if (detail.interpreter_name || detail.interpreter_response) {
    snapshotCards.push({
      label: t.role_interpreter,
      value: detail.interpreter_name || tr.common_not_set,
      meta: detail.interpreter_response
        ? responseLabel(detail.interpreter_response)
        : tr.common_not_set,
    });
  }

  if (detail.order_id) {
    snapshotCards.push({
      label: orderLabel,
      value: detail.order_id,
      meta: detail.category || formatAppointmentDateTimeLabel(detail.created_at),
    });
  }

  return (
    <section className="space-y-3 rounded-xl p-3.5 border border-border/50 bg-card/40">
      <div className="flex items-center gap-2">
        <div className="size-2 shrink-0 rounded-full bg-[var(--brand)]" />
        <h3 className="text-sm font-semibold text-foreground">
          {summaryTitle}
        </h3>
      </div>
      <div className="mt-4 grid gap-x-8 gap-y-3 md:grid-cols-2 xl:grid-cols-4">
        {snapshotCards.map((card) => (
          <ContextCard
            key={`${card.label}:${card.value}`}
            variant="snapshot"
            label={card.label}
            value={card.value}
            meta={card.meta}
          />
        ))}
      </div>
    </section>
  );
}

export const MemoizedAppointmentSnapshotSection = memo(
  AppointmentSnapshotSection,
);
