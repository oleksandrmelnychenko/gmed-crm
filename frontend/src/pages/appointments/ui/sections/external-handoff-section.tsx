import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  type FormEvent,
  type SetStateAction,
} from "react";

import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { checkboxClass } from "@/components/ui-shell";
import { formatUiText, useLang, type UiTextValues } from "@/lib/i18n";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  appointmentElevatedSectionCardClassName,
  appointmentMetaPillClassName,
  appointmentSelectControlClassName,
  appointmentSoftPanelClassName,
  appointmentSoftRowClassName,
  appointmentTextareaControlClassName,
  appointmentToggleCardClassName,
  appointmentWhiteInputClassName,
} from "@/pages/appointments/appearance/surface-appearance";
import { shiftLocalDateTime } from "@/pages/appointments/model/date-time";
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
  taskStatusLabel,
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
  AppointmentDotLabel,
  AppointmentSectionHeading,
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

const sectionCardClass = appointmentElevatedSectionCardClassName;
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
      draft: draftParts.join("\n"),
    });
    staffGo(`/chat?${params.toString()}`);
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
      onRefresh();
    } catch (error) {
      onError(error instanceof Error ? error.message : tr.common_failed_create);
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
      onError(error instanceof Error ? error.message : tr.common_failed_update);
    } finally {
      setActionBusy("");
    }
  }

  return (
    <section className={sectionCardClass}>
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <AppointmentSectionHeading
          title={t.appointments_external_handoff_title}
          description={t.appointments_external_handoff_description}
        />
        <span className={appointmentMetaPillClassName}>
          {communications.length}{" "}
          {communications.length === 1
            ? t.appointments_common_communication
            : t.appointments_common_communications}
        </span>
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <div className="space-y-3">
          {communications.length === 0 &&
          reminders.length === 0 &&
          tasks.length === 0 ? (
            <EmptyState text={tr.common_not_set} />
          ) : (
            <>
              {communications.map((item) => (
                <div
                  key={item.id}
                  className={appointmentSoftRowClassName}
                >
                  <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-zinc-900">
                        {item.subject}
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">
                        {item.created_by_name} · {communicationDirectionLabel(item.direction)}{" "}
                        {t.appointments_common_via}{" "}
                        {communicationChannelLabel(item.channel)} ·{" "}
                        {communicationTargetLabel(item.target_type, detail)}
                        {item.contact_name ? ` · ${item.contact_name}` : ""}
                        {item.due_at
                          ? ` · ${t.appointments_common_due} ${formatDateTimeLabel(item.due_at)}`
                          : ""}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em]",
                        appointmentCommunicationStatusBadgeClassName(item.status),
                      )}
                    >
                      {communicationStatusLabel(item.status)}
                    </span>
                  </div>
                  {item.message ? (
                    <p className="mt-3 whitespace-pre-line text-sm text-zinc-600">
                      {item.message}
                    </p>
                  ) : null}
                  {canManageCommunications ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {item.status !== "answered" &&
                      item.status !== "closed" &&
                      item.status !== "cancelled" ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={
                            actionBusy === `communication:${item.id}:answered`
                          }
                          onClick={() =>
                            void handleCommunicationStatusUpdate(
                              item.id,
                              "answered",
                            )
                          }
                        >
                          {actionBusy === `communication:${item.id}:answered` ? (
                            <LoaderCircle className="size-4 animate-spin" />
                          ) : null}
                          {t.appointments_external_handoff_mark_answered}
                        </Button>
                      ) : null}
                      {item.status !== "closed" && item.status !== "cancelled" ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={actionBusy === `communication:${item.id}:closed`}
                          onClick={() =>
                            void handleCommunicationStatusUpdate(item.id, "closed")
                          }
                        >
                          {actionBusy === `communication:${item.id}:closed` ? (
                            <LoaderCircle className="size-4 animate-spin" />
                          ) : null}
                          {t.appointments_external_handoff_close}
                        </Button>
                      ) : null}
                      {item.status !== "cancelled" ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={
                            actionBusy === `communication:${item.id}:cancelled`
                          }
                          onClick={() =>
                            void handleCommunicationStatusUpdate(
                              item.id,
                              "cancelled",
                            )
                          }
                        >
                          {actionBusy === `communication:${item.id}:cancelled` ? (
                            <LoaderCircle className="size-4 animate-spin" />
                          ) : null}
                          {t.appointments_external_handoff_cancel}
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ))}
              {canViewReminders && (reminders.length > 0 || tasks.length > 0) ? (
                <div className="rounded-2xl border border-dashed border-zinc-200 bg-white/70 p-4">
                  <AppointmentDotLabel>
                    {t.appointments_external_handoff_internal_trail}
                  </AppointmentDotLabel>
                  <div className="mt-3 space-y-3">
                    {reminders.map((item) => (
                      <div
                        key={item.id}
                        className={appointmentSoftRowClassName}
                      >
                        <p className="text-sm font-medium text-zinc-900">
                          {item.title.replace(`${EXTERNAL_HANDOFF_PREFIX} `, "")}
                        </p>
                        <p className="mt-1 text-xs text-zinc-500">
                          {item.user_name} · {formatDateTimeLabel(item.remind_at)}
                        </p>
                        {item.description ? (
                          <p className="mt-3 whitespace-pre-line text-sm text-zinc-600">
                            {item.description}
                          </p>
                        ) : null}
                      </div>
                    ))}
                    {tasks.map((task) => (
                      <div
                        key={task.id}
                        className={appointmentSoftRowClassName}
                      >
                        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                          <p className="text-sm font-medium text-zinc-900">
                            {task.title.replace(`${EXTERNAL_HANDOFF_PREFIX} `, "")}
                          </p>
                          <span className="text-xs text-zinc-500">
                            {taskStatusLabel(task.status)} ·{" "}
                            {taskPriorityLabel(task.priority)}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-zinc-500">
                          {task.assigned_to_name}
                          {task.due_date
                            ? ` · ${formatDateTimeLabel(task.due_date)}`
                            : ""}
                        </p>
                        {task.description ? (
                          <p className="mt-3 whitespace-pre-line text-sm text-zinc-600">
                            {task.description}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
        {canManageCommunications ? (
          <form
            onSubmit={handleSubmit}
            className={cn("space-y-4", appointmentSoftPanelClassName)}
          >
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={tr.patients_assign_owner}>
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
              <Field label={tr.documents_source}>
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
              <Field label={tr.documents_source}>
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
            <Field label={tr.field_phone}>
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
            <Field label={tr.invoices_due_at}>
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
              <Field label={tr.appointments_title_col}>
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
        ) : null}
      </div>
    </section>
  );
}

function AppointmentExternalHandoffSection(...args: Parameters<typeof useAppointmentExternalHandoffSectionContent>) {
  return useAppointmentExternalHandoffSectionContent(...args);
}

const MemoizedAppointmentExternalHandoffSection = memo(
  AppointmentExternalHandoffSection,
);

export { MemoizedAppointmentExternalHandoffSection };
