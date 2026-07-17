import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import {
  memo,
  useState,
} from "react";

import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatUiText, useLang } from "@/lib/i18n";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { apiFetch } from "@/lib/api";
import {
  appointmentElevatedSectionCardClassName,
  appointmentMetaPillClassName,
  appointmentMiniPillClassName,
  appointmentSelectControlClassName,
  appointmentSoftSplitRowClassName,
} from "@/pages/appointments/appearance/surface-appearance";
import { shiftLocalDateTime } from "@/pages/appointments/model/date-time";
import { appointmentActionErrorMessage } from "@/pages/appointments/model/error-message";
import { formatAppointmentSlotLabel as slotLabel } from "@/pages/appointments/model/runtime-formatters";
import {
  appointmentText,
  followUpPresetLabel,
  followUpPresetTitle,
  roleLabel,
} from "@/pages/appointments/model/labels";
import { appointmentAnchorDateTime, toRfc3339 } from "@/pages/appointments/model/workflow-helpers";
import type {
  AppointmentDetail,
  HandoffStakeholder,
} from "@/pages/appointments/model/types";
import { FOLLOW_UP_PRESETS } from "@/pages/appointments/model/constants";
import {
  AppointmentSectionHeading,
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

const sectionCardClass = appointmentElevatedSectionCardClassName;
const selectClassName = appointmentSelectControlClassName;

function AppointmentHandoffSection(props: AppointmentHandoffSectionProps) {
  return (
    <AppointmentHandoffSectionContent
      key={`${props.detail.id}:${props.followUpAssigneeId}`}
      {...props}
    />
  );
}

function AppointmentHandoffSectionContent({
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

  function openChat(peer: HandoffStakeholder) {
    const params = new URLSearchParams({
      peer: peer.id,
      name: peer.name,
      role: peer.role,
      draft: appointmentText("appointments_handoff_chat_draft", {
        patientPid: detail.patient_pid,
        title: detail.title,
        slot: slotLabel(detail),
      }),
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
          title: followUpPresetTitle(preset.id),
          description: formatUiText(t.appointments_auto_planned_from_appointment, {
            patientPid: detail.patient_pid,
            title: detail.title,
          }),
        }),
      });
      onRefresh();
    } catch (error) {
      onError(appointmentActionErrorMessage(error, tr.common_failed_create));
    } finally {
      setFollowUpBusy(false);
    }
  }

  return (
    <section className={sectionCardClass}>
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <AppointmentSectionHeading
          title={t.appointments_handoff_title}
          description={t.appointments_handoff_description}
        />
        <span className={appointmentMetaPillClassName}>
          {handoffStakeholders.length}{" "}
          {handoffStakeholders.length === 1
            ? t.appointments_common_stakeholder
            : t.appointments_common_stakeholders}
        </span>
      </div>
      <div className="mt-4 space-y-3">
        {handoffStakeholders.length === 0 ? (
          <EmptyState text={tr.common_not_set} />
        ) : (
          handoffStakeholders.map((peer) => (
            <div
              key={peer.id}
              className={appointmentSoftSplitRowClassName}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-zinc-950">
                    {peer.name}
                  </p>
                  <span className={appointmentMiniPillClassName}>
                    {roleLabel(peer.role)}
                  </span>
                  {peer.badges.map((badge) => (
                    <span
                      key={badge}
                      className={appointmentMiniPillClassName}
                    >
                      {badge}
                    </span>
                  ))}
                </div>
                <p className="mt-1 text-xs text-zinc-500">
                  {detail.patient_pid} · {slotLabel(detail)}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => openChat(peer)}
              >
                {t.appointments_common_open_chat}
              </Button>
            </div>
          ))
        )}
      </div>
      {canManageReminders ? (
        <div className="mt-5 grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
          <Field label={tr.patients_assign_owner}>
            <NativeComboboxSelect
              value={followUpAssigneeId}
              onChange={(event) => setFollowUpAssigneeId(event.target.value)}
              className={selectClassName}
            >
              <option value="">{tr.common_not_set}</option>
              {handoffStakeholders.map((peer) => (
                <option key={peer.id} value={peer.id}>
                  {peer.name} · {roleLabel(peer.role)}
                </option>
              ))}
            </NativeComboboxSelect>
          </Field>
          <div className="flex flex-wrap items-end gap-2">
            {FOLLOW_UP_PRESETS.map((preset) => (
              <Button
                key={preset.id}
                type="button"
                variant="outline"
                disabled={followUpBusy || !followUpAssigneeId}
                onClick={() => void handlePreset(preset)}
              >
                {followUpBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {followUpPresetLabel(preset.id)}
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
