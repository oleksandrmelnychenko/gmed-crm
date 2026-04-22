import {
  memo,
  useEffect,
  useState,
} from "react";

import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { selectClass } from "@/components/ui-shell";
import { useLang } from "@/lib/i18n";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { apiFetch } from "@/lib/api";
import { shiftLocalDateTime } from "@/pages/appointments/model/date-time";
import { formatAppointmentSlotLabel as slotLabel } from "@/pages/appointments/model/runtime-formatters";
import { appointmentText, roleLabel } from "@/pages/appointments/model/labels";
import { appointmentAnchorDateTime, toRfc3339 } from "@/pages/appointments/model/workflow-helpers";
import type {
  AppointmentDetail,
  HandoffStakeholder,
} from "@/pages/appointments/model/types";
import { FOLLOW_UP_PRESETS } from "@/pages/appointments/model/constants";
import {
  EmptyState,
  Field,
} from "@/pages/appointments/ui/shared/workspace-primitives";

type AppointmentHandoffSectionProps = {
  detail: AppointmentDetail;
  handoffStakeholders: HandoffStakeholder[];
  followUpAssigneeId: string;
  setFollowUpAssigneeId: (value: string) => void;
  canManageReminders: boolean;
  onRefresh: () => void;
  onError: (message: string) => void;
};

const sectionCardClass =
  "rounded-3xl border border-slate-200/80 bg-white p-5 shadow-[0_20px_50px_-35px_rgba(15,23,42,0.35)]";

function AppointmentHandoffSection({
  detail,
  handoffStakeholders,
  followUpAssigneeId,
  setFollowUpAssigneeId,
  canManageReminders,
  onRefresh,
  onError,
}: AppointmentHandoffSectionProps) {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const { staffGo } = useStaffNavigate();
  const [followUpBusy, setFollowUpBusy] = useState(false);

  useEffect(() => {
    setFollowUpBusy(false);
  }, [detail.id, followUpAssigneeId]);

  function openChat(peer: HandoffStakeholder) {
    const params = new URLSearchParams({
      peer: peer.id,
      name: peer.name,
      role: peer.role,
      draft: appointmentText(
        `Termin-Handoff: ${detail.patient_pid} · ${detail.title} · ${slotLabel(detail)}.`,
        `Хэнд-офф приёма: ${detail.patient_pid} · ${detail.title} · ${slotLabel(detail)}.`,
        `Appointment handoff: ${detail.patient_pid} · ${detail.title} · ${slotLabel(detail)}.`,
      ),
    });
    staffGo(`/chat?${params.toString()}`);
  }

  async function handlePreset(preset: (typeof FOLLOW_UP_PRESETS)[number]) {
    if (!followUpAssigneeId) return;
    const anchor = appointmentAnchorDateTime(detail);
    const remindAt = shiftLocalDateTime(anchor, {
      days: "offsetDays" in preset ? preset.offsetDays : undefined,
      months: "offsetMonths" in preset ? preset.offsetMonths : undefined,
    });
    if (!remindAt) return;

    setFollowUpBusy(true);
    try {
      await apiFetch<{ id: string }>(`/appointments/${detail.id}/reminders`, {
        method: "POST",
        body: JSON.stringify({
          user_id: followUpAssigneeId,
          remind_at: toRfc3339(remindAt),
          title: preset.title,
          description: `Auto-planned from appointment ${detail.patient_pid} · ${detail.title}.`,
        }),
      });
      onRefresh();
    } catch (error) {
      onError(error instanceof Error ? error.message : tr.common_failed_create);
    } finally {
      setFollowUpBusy(false);
    }
  }

  return (
    <section className={sectionCardClass}>
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-950">
            Handoff and follow-up
          </h3>
          <p className="text-xs text-slate-500">
            Coordinate the assigned team and schedule post-care follow-up from
            the appointment itself.
          </p>
        </div>
        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
          {handoffStakeholders.length} stakeholder
          {handoffStakeholders.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="mt-4 space-y-3">
        {handoffStakeholders.length === 0 ? (
          <EmptyState text={tr.common_not_set} />
        ) : (
          handoffStakeholders.map((peer) => (
            <div
              key={peer.id}
              className="flex flex-col gap-3 rounded-2xl border border-slate-200/80 bg-slate-50/80 px-4 py-3 md:flex-row md:items-center md:justify-between"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-slate-950">
                    {peer.name}
                  </p>
                  <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                    {roleLabel(peer.role)}
                  </span>
                  {peer.badges.map((badge) => (
                    <span
                      key={badge}
                      className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600"
                    >
                      {badge}
                    </span>
                  ))}
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {detail.patient_pid} · {slotLabel(detail)}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                className="rounded-2xl"
                onClick={() => openChat(peer)}
              >
                Open chat
              </Button>
            </div>
          ))
        )}
      </div>
      {canManageReminders ? (
        <div className="mt-5 grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
          <Field label={tr.patients_assign_owner}>
            <select
              value={followUpAssigneeId}
              onChange={(event) => setFollowUpAssigneeId(event.target.value)}
              className={selectClass}
            >
              <option value="">{tr.common_not_set}</option>
              {handoffStakeholders.map((peer) => (
                <option key={peer.id} value={peer.id}>
                  {peer.name} · {roleLabel(peer.role)}
                </option>
              ))}
            </select>
          </Field>
          <div className="flex flex-wrap items-end gap-2">
            {FOLLOW_UP_PRESETS.map((preset) => (
              <Button
                key={preset.id}
                type="button"
                variant="outline"
                className="rounded-2xl"
                disabled={followUpBusy || !followUpAssigneeId}
                onClick={() => void handlePreset(preset)}
              >
                {followUpBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {preset.label}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

const MemoizedAppointmentHandoffSection = memo(AppointmentHandoffSection);

export { MemoizedAppointmentHandoffSection };
