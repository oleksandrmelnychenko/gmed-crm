import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import {
  memo,
  useMemo,
  useState,
} from "react";

import { LoaderCircle, MessageSquare } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DataTableSurface } from "@/components/data-table/data-table-surface";
import { ToolbarField } from "@/components/data-table/toolbar-field";
import type { ColumnDef } from "@/components/data-table/types";
import { formatUiText, useLang } from "@/lib/i18n";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
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
import { EmptyState } from "@/pages/appointments/ui/shared/workspace-primitives";

const HANDOFF_BADGE_CHIP_TONES = [
  "border-sky-200 bg-sky-50 text-sky-700",
  "border-emerald-200 bg-emerald-50 text-emerald-700",
  "border-amber-200 bg-amber-50 text-amber-700",
  "border-violet-200 bg-violet-50 text-violet-700",
  "border-rose-200 bg-rose-50 text-rose-700",
  "border-teal-200 bg-teal-50 text-teal-700",
  "border-indigo-200 bg-indigo-50 text-indigo-700",
  "border-orange-200 bg-orange-50 text-orange-700",
] as const;

function handoffBadgeChipTone(text: string) {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) | 0;
  }
  return HANDOFF_BADGE_CHIP_TONES[Math.abs(hash) % HANDOFF_BADGE_CHIP_TONES.length];
}

type AppointmentHandoffSectionProps = {
  detail: AppointmentDetail;
  handoffStakeholders: HandoffStakeholder[];
  followUpAssigneeId: string;
  setFollowUpAssigneeId: (value: string) => void;
  canManageReminders: boolean;
  onRefresh: () => void;
  onError: (message: string) => void;
};

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
    });
    const chatDraft = appointmentText("appointments_handoff_chat_draft", {
        patientPid: detail.patient_pid,
        title: detail.title,
        slot: slotLabel(detail),
    });
    staffGo(`/chat?${params.toString()}`, {
      state: { chatDraft, chatDraftPeerId: peer.id },
    });
  }

  const stakeholderColumns = useMemo<ColumnDef<HandoffStakeholder>[]>(
    () => [
      {
        id: "name",
        label: tr.users_name ?? tr.common_name,
        accessor: (peer) => peer.name,
        filterType: "text",
        sortable: true,
        required: true,
        width: 220,
        render: (peer) => (
          <span className="block truncate font-mono text-xs font-medium text-foreground">
            {peer.name}
          </span>
        ),
      },
      {
        id: "role",
        label: tr.users_role,
        accessor: (peer) => roleLabel(peer.role),
        filterType: "enum",
        filterOptions: (rows) =>
          [...new Set(rows.map((peer) => roleLabel(peer.role)))].map((label) => ({
            value: label,
            label,
          })),
        sortable: true,
        width: 180,
        render: (peer) => (
          <span className="inline-flex rounded-full border border-border/60 bg-muted/25 px-2 py-0.5 font-mono text-[10px] font-medium text-foreground">
            {roleLabel(peer.role)}
          </span>
        ),
      },
      {
        id: "badges",
        label: tr.patients_functional_labels ?? tr.common_status,
        accessor: (peer) => peer.badges.join(" "),
        filterType: "text",
        width: 240,
        render: (peer) =>
          peer.badges.length > 0 ? (
            <span className="flex flex-wrap items-center gap-1">
              {peer.badges.map((badge) => (
                <span
                  key={badge}
                  className={cn(
                    "inline-flex rounded-full border px-2 py-0.5 font-mono text-[10px] font-medium",
                    handoffBadgeChipTone(badge),
                  )}
                >
                  {badge}
                </span>
              ))}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">{tr.common_not_set}</span>
          ),
      },
      {
        id: "context",
        label: tr.appointments_title ?? tr.appointments_date,
        accessor: () => `${detail.patient_pid} · ${slotLabel(detail)}`,
        width: 260,
        render: () => (
          <span className="block truncate font-mono text-xs text-foreground">
            {detail.patient_pid} · {slotLabel(detail)}
          </span>
        ),
      },
    ],
    [detail, tr],
  );

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
    <section className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm">
      <div className="relative z-30 flex flex-nowrap items-end gap-1.5 overflow-x-auto border-b border-border/70 bg-card px-3 py-2">
        <span className="flex shrink-0 items-center gap-2 self-center text-[13px] font-semibold tracking-tight text-foreground">
              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
          {t.appointments_handoff_title}
        </span>
        {canManageReminders ? (
          <>
            <span aria-hidden className="mx-1 h-4 w-px shrink-0 self-center bg-border" />
            <ToolbarField label={tr.patients_assign_owner} className="w-[240px]">
              <NativeComboboxSelect
                value={followUpAssigneeId}
                onChange={(event) => setFollowUpAssigneeId(event.target.value)}
                className="h-8 w-full rounded-md bg-field text-xs"
              >
                <option value="">{tr.common_not_set}</option>
                {handoffStakeholders.map((peer) => (
                  <option key={peer.id} value={peer.id}>
                    {peer.name} · {roleLabel(peer.role)}
                  </option>
                ))}
              </NativeComboboxSelect>
            </ToolbarField>
            {FOLLOW_UP_PRESETS.map((preset) => (
              <Button
                key={preset.id}
                type="button"
                variant="outline"
                size="sm"
                className="h-8 shrink-0 rounded-lg"
                disabled={followUpBusy || !followUpAssigneeId}
                onClick={() => void handlePreset(preset)}
              >
                {followUpBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {followUpPresetLabel(preset.id)}
              </Button>
            ))}
          </>
        ) : null}
      </div>

      <DataTableSurface
        rows={handoffStakeholders}
        columns={stakeholderColumns}
        rowId={(peer) => peer.id}
        dictionary={tr}
        emptyState={<EmptyState text={tr.common_not_set} />}
        rowActions={(peer) => (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-7 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
            onClick={() => openChat(peer)}
            aria-label={t.appointments_common_open_chat}
            title={t.appointments_common_open_chat}
          >
            <MessageSquare className="size-3.5" />
          </Button>
        )}
        rowActionsWidth={44}
        surfaceClassName="rounded-none border-0 shadow-none"
      />
    </section>
  );
}

const MemoizedAppointmentHandoffSection = memo(AppointmentHandoffSection);

export { MemoizedAppointmentHandoffSection };
