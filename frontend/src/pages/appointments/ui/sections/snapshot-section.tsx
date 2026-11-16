import { ClipboardList } from "lucide-react";
import { memo } from "react";

import { Section } from "@/components/ui-shell";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { visibleInterpreterResponse } from "@/pages/appointments/model/completion-rules";
import {
  useAppointmentLabels,
} from "@/pages/appointments/model/labels";
import { useAppointmentFormatters } from "@/pages/appointments/model/runtime-formatters";
import type { AppointmentDetail } from "@/pages/appointments/model/types";

function AppointmentSnapshotSection({
  detail,
}: {
  detail: AppointmentDetail;
}) {
  const {
    appointmentText,
    appointmentTypeLabel,
    carePathKindLabel,
    checklistPhaseLabel,
    responseLabel,
    roleLabel,
  } = useAppointmentLabels();
  const { formatAppointmentDateTimeLabel } = useAppointmentFormatters();
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

  // A cancelled visit waits for no answer: its «pending» is hidden here as in
  // the overview badge, the agenda and the table (release QA 2026-11-13, A1).
  const interpreterResponse = visibleInterpreterResponse(
    detail.status,
    detail.interpreter_response,
  );
  if (detail.interpreter_name || interpreterResponse) {
    snapshotCards.push({
      label: appointmentText("appointments_interpreter"),
      value: detail.interpreter_name || tr.common_not_set,
      meta: interpreterResponse
        ? [
            responseLabel(interpreterResponse),
            detail.interpreter_response_comment,
          ].filter(Boolean).join(" · ")
        : tr.common_not_set,
    });
  } else if (detail.interpreter_needed) {
    // The visit is marked «an interpreter is needed» and has none yet.
    snapshotCards.push({
      label: appointmentText("appointments_interpreter"),
      value: tr.common_not_set,
      meta: appointmentText("appointments_interpreter_needed"),
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
    <Section icon={ClipboardList} title={summaryTitle} className="rounded-xl border border-border/70 bg-card px-3.5 py-3">
      <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
        {snapshotCards.map((card) => (
          <div key={`${card.label}:${card.value}`} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{card.label}</dt>
            <dd
              className={cn(
                "mt-0.5 min-w-0 break-words text-sm leading-snug",
                card.value === tr.common_not_set ? "text-muted-foreground" : "font-medium text-foreground",
              )}
            >
              {card.value}
            </dd>
            {card.meta ? (
              <dd className="min-w-0 break-words text-xs leading-snug text-muted-foreground">
                {card.meta}
              </dd>
            ) : null}
          </div>
        ))}
      </dl>
    </Section>
  );
}

export const MemoizedAppointmentSnapshotSection = memo(
  AppointmentSnapshotSection,
);
