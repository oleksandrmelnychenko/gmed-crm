import { memo } from "react";

import { useLang } from "@/lib/i18n";
import {
  appointmentText,
  appointmentTypeLabel,
  carePathKindLabel,
  checklistPhaseLabel,
  responseLabel,
  roleLabel,
} from "@/pages/appointments/model/labels";
import { formatAppointmentDateTimeLabel } from "@/pages/appointments/model/runtime-formatters";
import type { AppointmentDetail } from "@/pages/appointments/model/types";

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
      value: checklistPhaseLabel(detail.checklist_phase),
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
      value: detail.order_number || tr.common_not_set,
      meta: detail.care_path_kind
        ? carePathKindLabel(detail.care_path_kind)
        : formatAppointmentDateTimeLabel(detail.created_at),
    });
  }

  return (
    <section className="space-y-2.5 rounded-xl p-3.5 border border-border/50 bg-card/40">
      <div className="flex items-center gap-2">
        <div className="size-2 shrink-0 rounded-full bg-[var(--brand)]" />
        <h3 className="text-[13px] font-semibold tracking-tight text-foreground">
          {summaryTitle}
        </h3>
      </div>
      <div className="mt-5 grid gap-x-14 gap-y-3 lg:grid-cols-2">
        {snapshotCards.map((card, index) => (
          <SnapshotSummaryRow
            key={`${card.label}:${card.value}`}
            label={card.label}
            subLabel={card.meta}
            value={card.value}
            fullWidth={
              snapshotCards.length % 2 === 1 &&
              index === snapshotCards.length - 1
            }
          />
        ))}
      </div>
    </section>
  );
}

function SnapshotSummaryRow({
  label,
  subLabel,
  value,
  fullWidth = false,
}: {
  label: string;
  subLabel: string;
  value: string;
  fullWidth?: boolean;
}) {
  return (
    <div
      className={
        fullWidth
          ? "grid grid-cols-[minmax(96px,max-content)_minmax(24px,1fr)_minmax(0,auto)] items-start gap-2.5 lg:col-span-2"
          : "grid grid-cols-[minmax(96px,max-content)_minmax(24px,1fr)_auto] items-start gap-2.5"
      }
    >
      <div className="min-w-0 pt-0.5">
        <p className="break-words text-[12px] font-medium leading-tight text-muted-foreground">
          {label}
        </p>
        <p className="mt-0.5 break-words text-[11px] leading-tight text-muted-foreground/75">
          {subLabel}
        </p>
      </div>
      <span className="mt-3 h-px min-w-6 bg-border/70" />
      <p className="min-w-0 max-w-[420px] break-words text-right text-sm font-semibold leading-tight text-foreground">
        {value}
      </p>
    </div>
  );
}

export const MemoizedAppointmentSnapshotSection = memo(
  AppointmentSnapshotSection,
);
