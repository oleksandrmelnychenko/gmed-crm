import { memo } from "react";

import {
  attentionIssueLabel,
  appointmentText,
  attentionReasonLabel,
} from "@/pages/appointments/model/labels";
import { formatAppointmentDateTimeLabel } from "@/pages/appointments/model/runtime-formatters";
import type { AppointmentAttentionItem } from "@/pages/appointments/model/types";

function AppointmentAttentionSection({
  attention,
}: {
  attention: AppointmentAttentionItem;
}) {
  const title = appointmentText("appointments_operational_follow_up_open");
  const subtitle = appointmentText("appointments_this_appointment_still_has_unresolved_operational_follow");
  const nextCheckpointLabel = appointmentText("appointments_next_due_checkpoint");

  return (
    <section className="space-y-3 rounded-xl p-3.5 border border-border/50 bg-card/40">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <div className="size-2 shrink-0 rounded-full bg-amber-500" />
            <h3 className="text-[13px] font-semibold tracking-tight text-foreground">
              {title}
            </h3>
          </div>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-800">
          {attention.attention_score}{" "}
          {attentionIssueLabel(attention.attention_score)}
        </span>
      </div>
      <div className="mt-4 space-y-3">
        {attention.reasons.map((reason, index) => {
          const reasonDetail = attention.reason_details?.[index];
          return (
            <div
              key={`${reason}:${reasonDetail ?? ""}`}
              className="rounded-xl border border-amber-200/80 bg-amber-50/80 px-4 py-3 text-sm text-amber-900"
            >
              {attentionReasonLabel(reason, reasonDetail)}
            </div>
          );
        })}
      </div>
      {attention.next_due_at ? (
        <p className="mt-4 text-xs text-muted-foreground">
          {nextCheckpointLabel}:{" "}
          {formatAppointmentDateTimeLabel(attention.next_due_at)}
        </p>
      ) : null}
    </section>
  );
}

export const MemoizedAppointmentAttentionSection = memo(
  AppointmentAttentionSection,
);
