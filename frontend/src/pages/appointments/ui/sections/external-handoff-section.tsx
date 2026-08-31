import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type FormEvent,
  type SetStateAction,
} from "react";

import { LoaderCircle, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { checkboxClass } from "@/components/ui-shell";
import { DataTableSurface } from "@/components/data-table/data-table-surface";
import { DEFAULT_DATA_TABLE_PAGE_SIZE } from "@/components/data-table/data-table-pager";
import type { ColumnDef } from "@/components/data-table/types";
import { formatUiText, useLang, type UiTextValues } from "@/lib/i18n";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  appointmentSelectControlClassName,
  appointmentTextareaControlClassName,
  appointmentToggleCardClassName,
  appointmentWhiteInputClassName,
} from "@/pages/appointments/appearance/surface-appearance";
import { shiftLocalDateTime } from "@/pages/appointments/model/date-time";
import { appointmentActionErrorMessage } from "@/pages/appointments/model/error-message";
import {
  formatAppointmentDateTimeLabel as formatDateTimeLabel,
  formatAppointmentSlotLabel as slotLabel,
} from "@/pages/appointments/model/runtime-formatters";
import { blankExternalHandoffForm } from "@/pages/appointments/model/form-factories";
import {
  appointmentText as appointmentTextBase,
  communicationChannelLabel,
  communicationDirectionLabel,
  communicationStatusLabel,
  communicationTargetLabel,
  roleLabel,
  taskPriorityLabel,
} from "@/pages/appointments/model/labels";
import {
  appointmentAnchorDateTime,
  toRfc3339,
} from "@/pages/appointments/model/workflow-helpers";
import type {
  AppointmentCommunicationChannel,
  AppointmentCommunicationDirection,
  AppointmentCommunicationEntry,
  AppointmentCommunicationStatus,
  AppointmentDetail,
  ExternalHandoffFormState,
  ReminderEntry,
  StaffOption,
  TaskEntry,
} from "@/pages/appointments/model/types";
import {
  COMMUNICATION_CHANNEL_OPTIONS,
  COMMUNICATION_STATUS_OPTIONS,
  EXTERNAL_HANDOFF_PREFIX,
  TASK_PRIORITY_OPTIONS,
} from "@/pages/appointments/model/constants";
import { appointmentCommunicationStatusBadgeClassName } from "@/pages/appointments/appearance/status-appearance";
import {
  AppointmentRemindersTable,
  AppointmentTasksTable,
} from "@/pages/appointments/ui/shared/follow-up-tables";
import {
  AppointmentEditorSheet,
  EmptyState,
  Field,
} from "@/pages/appointments/ui/shared/workspace-primitives";

type AppointmentExternalHandoffSectionProps = {
  detail: AppointmentDetail;
  communications: AppointmentCommunicationEntry[];
  reminders: ReminderEntry[];
  tasks: TaskEntry[];
  assignees: StaffOption[];
  defaultAssigneeId: string;
  canManageCommunications: boolean;
  canViewReminders: boolean;
  canCreateTasks: boolean;
  onRefresh: () => void;
  onError: (message: string) => void;
};

const selectClassName = appointmentSelectControlClassName;
const textareaClassName = appointmentTextareaControlClassName;

type ExternalHandoffSectionState = {
  form: ExternalHandoffFormState;
  submitBusy: boolean;
  actionBusy: string;
};

type ExternalHandoffSectionAction =
  | { type: "patch"; value: Partial<ExternalHandoffSectionState> }
  | {
      type: "update";
      updater: (state: ExternalHandoffSectionState) => ExternalHandoffSectionState;
    };

function externalHandoffSectionReducer(
  state: ExternalHandoffSectionState,
  action: ExternalHandoffSectionAction,
): ExternalHandoffSectionState {
  switch (action.type) {
    case "patch":
      return { ...state, ...action.value };
    case "update":
      return action.updater(state);
    default:
      return state;
  }
}

function createExternalHandoffFieldAction<K extends keyof ExternalHandoffSectionState>(
  field: K,
  value: SetStateAction<ExternalHandoffSectionState[K]>,
): ExternalHandoffSectionAction {
  return {
    type: "update",
    updater: (state) => {
      const currentValue = state[field];
      const nextValue =
        typeof value === "function"
          ? (value as (
              current: ExternalHandoffSectionState[K],
            ) => ExternalHandoffSectionState[K])(currentValue)
          : value;

      if (Object.is(currentValue, nextValue)) return state;
      return { ...state, [field]: nextValue };
    },
  };
}

function withEllipsis(text: string) {
  return text.trim().endsWith("...") ? text : `${text.trim()}...`;
}

function useAppointmentExternalHandoffSectionContent({
  detail,
  communications,
  reminders,
  tasks,
  assignees,
  defaultAssigneeId,
  canManageCommunications,
  canViewReminders,
  canCreateTasks,
  onRefresh,
  onError,
}: AppointmentExternalHandoffSectionProps) {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const appointmentText = (key: string, values?: UiTextValues) =>
    formatUiText(t.uiText[key] ?? appointmentTextBase(key), values);
  const { staffGo } = useStaffNavigate();

  const assigneeIndex = useMemo(
    () => new Map(assignees.map((item) => [item.id, item])),
    [assignees],
  );
  const initialAssigneeId = useMemo(
    () => defaultAssigneeId || assignees[0]?.id || "",
    [assignees, defaultAssigneeId],
  );
  const buildDefaultForm = useCallback(
    (
      formAssigneeId = initialAssigneeId,
      formDueAt = shiftLocalDateTime(appointmentAnchorDateTime(detail), {
        days: 1,
      }),
      formTarget: ExternalHandoffFormState["target"] = detail.doctor_id
        ? "doctor"
        : detail.type === "non_medical"
          ? "service_provider"
          : "clinic",
    ) => blankExternalHandoffForm(formAssigneeId, formDueAt, formTarget),
    [detail, initialAssigneeId],
  );

  const [{ form, submitBusy, actionBusy }, dispatchExternalHandoffState] =
    useReducer(
      externalHandoffSectionReducer,
      undefined,
      () => ({
        form: buildDefaultForm(),
        submitBusy: false,
        actionBusy: "",
      }),
    );
  const setForm = (value: SetStateAction<ExternalHandoffFormState>) =>
    dispatchExternalHandoffState(
      createExternalHandoffFieldAction("form", value),
    );
  const setSubmitBusy = (value: SetStateAction<boolean>) =>
    dispatchExternalHandoffState(
      createExternalHandoffFieldAction("submitBusy", value),
    );
  const setActionBusy = (value: SetStateAction<string>) =>
    dispatchExternalHandoffState(
      createExternalHandoffFieldAction("actionBusy", value),
    );

  useEffect(() => {
    dispatchExternalHandoffState({
      type: "patch",
      value: {
        form: buildDefaultForm(),
        submitBusy: false,
        actionBusy: "",
      },
    });
  }, [buildDefaultForm]);

  function openChatDraft() {
    if (!form.assigneeId) return;
    const assignee = assigneeIndex.get(form.assigneeId);
    if (!assignee) return;

    const targetLabel = communicationTargetLabel(form.target, detail);
    const draftParts = [
      appointmentText("appointments_external_handoff_chat_title", {
        patientPid: detail.patient_pid,
        title: detail.title,
      }),
      appointmentText("appointments_external_handoff_chat_target", {
        target: targetLabel,
        direction: communicationDirectionLabel(form.direction),
        via: t.appointments_common_via,
        channel: communicationChannelLabel(form.channel),
      }),
      appointmentText("appointments_description_slot", {
        slot: slotLabel(detail),
      }),
      form.contactName.trim()
        ? appointmentText("appointments_description_contact", {
            contact: form.contactName.trim(),
          })
        : "",
      form.notes.trim() || "",
    ].filter(Boolean);

    const params = new URLSearchParams({
      peer: assignee.id,
      name: assignee.name,
      role: assignee.role,
    });
    staffGo(`/chat?${params.toString()}`, {
      state: { chatDraft: draftParts.join("\n"), chatDraftPeerId: assignee.id },
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.title.trim()) return;

    const targetLabel = communicationTargetLabel(form.target, detail);
    const handoffTitle = `${EXTERNAL_HANDOFF_PREFIX} ${form.title.trim()}`;
    const descriptionParts = [
      appointmentText("appointments_description_owner", {
        owner: targetLabel,
      }),
      appointmentText("appointments_external_handoff_description_source", {
        source: tr.documents_source,
        direction: communicationDirectionLabel(form.direction),
        via: t.appointments_common_via,
        channel: communicationChannelLabel(form.channel),
      }),
      appointmentText("appointments_description_appointment", {
        patientPid: detail.patient_pid,
        title: detail.title,
        slot: slotLabel(detail),
      }),
      form.contactName.trim()
        ? appointmentText("appointments_description_contact", {
            contact: form.contactName.trim(),
          })
        : "",
      form.notes.trim() || "",
    ].filter(Boolean);

    setSubmitBusy(true);
    try {
      const requests: Array<Promise<unknown>> = [
        apiFetch<{ id: string }>(`/appointments/${detail.id}/communications`, {
          method: "POST",
          body: JSON.stringify({
            target_type: form.target,
            direction: form.direction,
            channel: form.channel,
            status: form.status,
            subject: form.title.trim(),
            message: form.notes.trim() || null,
            contact_name: form.contactName.trim() || null,
            due_at: form.dueAt ? toRfc3339(form.dueAt) : null,
          }),
        }),
      ];

      if (form.assigneeId && form.dueAt) {
        requests.push(
          apiFetch<{ id: string }>(`/appointments/${detail.id}/reminders`, {
            method: "POST",
            body: JSON.stringify({
              user_id: form.assigneeId,
              remind_at: toRfc3339(form.dueAt),
              title: handoffTitle,
              description: descriptionParts.join("\n"),
            }),
          }),
        );

        if (form.createTask && canCreateTasks) {
          requests.push(
            apiFetch<{ id: string }>("/tasks", {
              method: "POST",
              body: JSON.stringify({
                title: handoffTitle,
                description: descriptionParts.join("\n"),
                assigned_to: form.assigneeId,
                patient_id: detail.patient_id,
                order_id: detail.order_id,
                appointment_id: detail.id,
                due_date: toRfc3339(form.dueAt),
                priority: form.taskPriority,
              }),
            }),
          );
        }
      }

      await Promise.all(requests);
      setForm(
        buildDefaultForm(
          form.assigneeId,
          form.dueAt ? shiftLocalDateTime(form.dueAt, { days: 1 }) : "",
          form.target,
        ),
      );
      setSheetOpen(false);
      onRefresh();
    } catch (error) {
      onError(appointmentActionErrorMessage(error, tr.common_failed_create));
    } finally {
      setSubmitBusy(false);
    }
  }

  async function handleCommunicationStatusUpdate(
    communicationId: string,
    status: AppointmentCommunicationStatus,
  ) {
    setActionBusy(`communication:${communicationId}:${status}`);
    try {
      await apiFetch(
        `/appointments/${detail.id}/communications/${communicationId}/status`,
        {
          method: "POST",
          body: JSON.stringify({ status }),
        },
      );
      onRefresh();
    } catch (error) {
      onError(appointmentActionErrorMessage(error, tr.common_failed_update));
    } finally {
      setActionBusy("");
    }
  }

  const [sheetOpen, setSheetOpen] = useState(false);

  const trailReminders = useMemo(
    () =>
      reminders.map((item) => ({
        ...item,
        title: item.title.replace(`${EXTERNAL_HANDOFF_PREFIX} `, ""),
      })),
    [reminders],
  );
  const trailTasks = useMemo(
    () =>
      tasks.map((task) => ({
        ...task,
        title: task.title.replace(`${EXTERNAL_HANDOFF_PREFIX} `, ""),
      })),
    [tasks],
  );

  const communicationColumns = useMemo<ColumnDef<AppointmentCommunicationEntry>[]>(
    () => [
      {
        id: "subject",
        label: tr.appointments_title_col ?? tr.appointments_title,
        accessor: (item) => item.subject,
        filterType: "text",
        searchable: true,
        sortable: true,
        required: true,
        width: 260,
        render: (item) => (
          <span className="block truncate text-xs font-medium text-foreground" title={item.subject}>
            {item.subject}
          </span>
        ),
      },
      {
        id: "target",
        label: appointmentText("appointments_communication_target"),
        accessor: (item) => communicationTargetLabel(item.target_type, detail),
        filterType: "enum",
        filterOptions: (rows) =>
          [...new Set(rows.map((item) => communicationTargetLabel(item.target_type, detail)))].map(
            (label) => ({ value: label, label }),
          ),
        sortable: true,
        width: 190,
        render: (item) => (
          <span className="inline-flex rounded-full border border-border/60 bg-muted/25 px-2 py-0.5 font-mono text-[10px] font-medium text-foreground">
            {communicationTargetLabel(item.target_type, detail)}
          </span>
        ),
      },
      {
        id: "channel",
        label: tr.documents_source,
        accessor: (item) =>
          `${communicationDirectionLabel(item.direction)} · ${communicationChannelLabel(item.channel)}`,
        filterType: "text",
        sortable: true,
        width: 200,
        render: (item) => (
          <span className="block truncate font-mono text-xs text-foreground">
            {communicationDirectionLabel(item.direction)} · {communicationChannelLabel(item.channel)}
          </span>
        ),
      },
      {
        id: "contact",
        label: appointmentText("appointments_contact_person"),
        accessor: (item) => item.contact_name ?? "",
        filterType: "text",
        width: 170,
        render: (item) =>
          item.contact_name?.trim() ? (
            <span className="block truncate font-mono text-xs text-foreground">
              {item.contact_name}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">{tr.common_not_set}</span>
          ),
      },
      {
        id: "created_by",
        label: appointmentText("appointments_communication_author"),
        accessor: (item) => item.created_by_name,
        filterType: "text",
        sortable: true,
        width: 180,
        render: (item) => (
          <span className="block truncate font-mono text-xs text-foreground">
            {item.created_by_name}
          </span>
        ),
      },
      {
        id: "due_at",
        label: t.appointments_common_due,
        accessor: (item) => item.due_at ?? "",
        filterType: "date",
        sortable: true,
        width: 170,
        render: (item) =>
          item.due_at ? (
            <span className="whitespace-nowrap font-mono text-xs tabular-nums text-foreground">
              {formatDateTimeLabel(item.due_at)}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">{tr.common_not_set}</span>
          ),
      },
      {
        id: "status",
        label: tr.users_status,
        accessor: (item) => communicationStatusLabel(item.status),
        filterType: "enum",
        filterOptions: () =>
          COMMUNICATION_STATUS_OPTIONS.map((value) => ({
            value: communicationStatusLabel(value),
            label: communicationStatusLabel(value),
          })),
        sortable: true,
        width: 150,
        render: (item) => (
          <span
            className={cn(
              "inline-flex rounded-full border px-2 py-0.5 font-mono text-[10px] font-medium",
              appointmentCommunicationStatusBadgeClassName(item.status),
            )}
          >
            {communicationStatusLabel(item.status)}
          </span>
        ),
      },
      {
        id: "message",
        label: tr.patients_notes,
        accessor: (item) => item.message ?? "",
        filterType: "text",
        searchable: true,
        width: 280,
        render: (item) => (
          <span className="block truncate text-xs text-foreground" title={item.message ?? undefined}>
            {item.message?.trim() || tr.common_not_set}
          </span>
        ),
      },
    ],
    [appointmentText, detail, t, tr],
  );

  return (
    <div className="space-y-4">
      <DataTableSurface
        rows={communications}
        columns={communicationColumns}
        rowId={(item) => item.id}
        dictionary={tr}
        pagination={{
          pageSize: DEFAULT_DATA_TABLE_PAGE_SIZE,
          resetKey: String(communications.length),
        }}
        emptyState={<EmptyState text={tr.common_not_set} />}
        toolbarStart={
          <>
            <span className="flex shrink-0 items-center gap-2 self-center text-[13px] font-semibold tracking-tight text-foreground">
              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
              {t.appointments_external_handoff_title}
            </span>
            {canManageCommunications ? (
              <Button
                type="button"
                size="sm"
                className="h-8 shrink-0 self-center rounded-lg gap-1.5"
                onClick={() => setSheetOpen(true)}
              >
                <Plus className="size-3.5" />
                {appointmentText("appointments_log_communication")}
              </Button>
            ) : null}
            <span aria-hidden className="mx-1 h-4 w-px shrink-0 self-center bg-border" />
          </>
        }
        rowActions={
          canManageCommunications
            ? (item) => (
                <NativeComboboxSelect
                  value={item.status}
                  onChange={(event) =>
                    void handleCommunicationStatusUpdate(
                      item.id,
                      event.target.value as AppointmentCommunicationStatus,
                    )
                  }
                  className="h-7 w-[150px] rounded-md bg-field text-xs"
                  disabled={actionBusy.startsWith(`communication:${item.id}:`)}
                >
                  {COMMUNICATION_STATUS_OPTIONS.map((value) => (
                    <option key={value} value={value}>
                      {communicationStatusLabel(value)}
                    </option>
                  ))}
                </NativeComboboxSelect>
              )
            : undefined
        }
        rowActionsWidth={canManageCommunications ? 170 : undefined}
      />

      {canViewReminders ? (
        <>
          <AppointmentRemindersTable
            reminders={trailReminders}
            title={`${t.appointments_external_handoff_internal_trail} · ${appointmentText("appointments_reminders")}`}
            emptyText={tr.common_not_set}
          />
          <AppointmentTasksTable
            tasks={trailTasks}
            title={`${t.appointments_external_handoff_internal_trail} · ${appointmentText("appointments_tasks")}`}
            emptyText={tr.common_not_set}
          />
        </>
      ) : null}

      {canManageCommunications ? (
        <AppointmentEditorSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          title={t.appointments_external_handoff_title}
          description={t.appointments_external_handoff_description}
          maxWidthClassName="sm:max-w-[720px]"
          footer={
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-lg"
              onClick={() => setSheetOpen(false)}
            >
              {t.common_cancel}
            </Button>
          }
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={appointmentText("appointments_communication_target")}>
                <NativeComboboxSelect
                  value={form.target}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      target: event.target.value as ExternalHandoffFormState["target"],
                    }))
                  }
                  className={selectClassName}
                >
                  <option value="clinic" disabled={!detail.provider_id}>
                    {communicationTargetLabel("clinic", detail)}
                  </option>
                  <option value="service_provider" disabled={!detail.provider_id}>
                    {communicationTargetLabel("service_provider", detail)}
                  </option>
                  <option value="doctor" disabled={!detail.doctor_id}>
                    {communicationTargetLabel("doctor", detail)}
                  </option>
                </NativeComboboxSelect>
              </Field>
              <Field label={appointmentText("appointments_communication_channel")}>
                <NativeComboboxSelect
                  value={form.channel}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      channel: event.target.value as AppointmentCommunicationChannel,
                    }))
                  }
                  className={selectClassName}
                >
                  {COMMUNICATION_CHANNEL_OPTIONS.map((value) => (
                    <option key={value} value={value}>
                      {communicationChannelLabel(value)}
                    </option>
                  ))}
                </NativeComboboxSelect>
              </Field>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <Field label={appointmentText("appointments_communication_direction")}>
                <NativeComboboxSelect
                  value={form.direction}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      direction:
                        event.target.value as AppointmentCommunicationDirection,
                    }))
                  }
                  className={selectClassName}
                >
                  <option value="outbound">{communicationDirectionLabel("outbound")}</option>
                  <option value="inbound">{communicationDirectionLabel("inbound")}</option>
                </NativeComboboxSelect>
              </Field>
              <Field label={t.users_status}>
                <NativeComboboxSelect
                  value={form.status}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      status: event.target.value as AppointmentCommunicationStatus,
                    }))
                  }
                  className={selectClassName}
                >
                  {COMMUNICATION_STATUS_OPTIONS.map((value) => (
                    <option key={value} value={value}>
                      {communicationStatusLabel(value)}
                    </option>
                  ))}
                </NativeComboboxSelect>
              </Field>
              <Field label={t.patients_assign_owner}>
                <NativeComboboxSelect
                  value={form.assigneeId}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      assigneeId: event.target.value,
                    }))
                  }
                  className={selectClassName}
                  required
                >
                  <option value="">{tr.common_not_set}</option>
                  {assignees.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name} · {roleLabel(member.role)}
                    </option>
                  ))}
                </NativeComboboxSelect>
              </Field>
            </div>
            <Field label={tr.appointments_title_col}>
              <Input
                value={form.title}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
                placeholder={withEllipsis(tr.appointments_title_col)}
                className={appointmentWhiteInputClassName}
                required
              />
            </Field>
            <Field label={appointmentText("appointments_contact_person")}>
              <Input
                value={form.contactName}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    contactName: event.target.value,
                  }))
                }
                placeholder={withEllipsis(
                  appointmentText("appointments_contact_person"),
                )}
                className={appointmentWhiteInputClassName}
              />
            </Field>
            <Field label={t.appointments_common_due}>
              <Input
                type="datetime-local"
                value={form.dueAt}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    dueAt: event.target.value,
                  }))
                }
                className={appointmentWhiteInputClassName}
              />
            </Field>
            <Field label={tr.patients_notes}>
              <textarea
                value={form.notes}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    notes: event.target.value,
                  }))
                }
                className={textareaClassName}
                rows={5}
                placeholder={withEllipsis(tr.patients_notes)}
              />
            </Field>
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px]">
              <label className={appointmentToggleCardClassName}>
                <input
                  type="checkbox"
                  checked={form.createTask}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      createTask: event.target.checked,
                    }))
                  }
                  className={cn(checkboxClass, "mt-0.5")}
                />
                <span>
                  {t.appointments_external_handoff_mirror_task}
                </span>
              </label>
              <Field label={appointmentText("appointments_task_priority")}>
                <NativeComboboxSelect
                  value={form.taskPriority}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      taskPriority: event.target.value,
                    }))
                  }
                  className={selectClassName}
                  disabled={!form.createTask}
                >
                  {TASK_PRIORITY_OPTIONS.map((value) => (
                    <option key={value} value={value}>
                      {taskPriorityLabel(value)}
                    </option>
                  ))}
                </NativeComboboxSelect>
              </Field>
            </div>
            <div className="flex flex-wrap justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                disabled={!form.assigneeId}
                onClick={openChatDraft}
              >
                {appointmentText("appointments_open_internal_chat_draft")}
              </Button>
              <Button
                type="submit"
                disabled={submitBusy || !form.title.trim()}
              >
                {submitBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {appointmentText("appointments_log_communication")}
              </Button>
            </div>
          </form>
        </AppointmentEditorSheet>
      ) : null}
    </div>
  );
}

function AppointmentExternalHandoffSection(...args: Parameters<typeof useAppointmentExternalHandoffSectionContent>) {
  return useAppointmentExternalHandoffSectionContent(...args);
}

const MemoizedAppointmentExternalHandoffSection = memo(
  AppointmentExternalHandoffSection,
);

export { MemoizedAppointmentExternalHandoffSection };
