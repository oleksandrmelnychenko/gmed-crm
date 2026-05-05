import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import {
  memo,
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from "react";

import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { checkboxClass } from "@/components/ui-shell";
import { useLang } from "@/lib/i18n";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  appointmentElevatedSectionCardClassName,
  appointmentMetaPillClassName,
  appointmentSelectControlClassName,
  appointmentSlateInputClassName,
  appointmentSoftPanelClassName,
  appointmentSoftRowClassName,
  appointmentTextareaControlClassName,
  appointmentToggleCardClassName,
  appointmentWhiteInputClassName,
  appointmentWhiteRowClassName,
} from "@/pages/appointments/appearance/surface-appearance";
import { shiftLocalDateTime } from "@/pages/appointments/model/date-time";
import {
  formatAppointmentDateLabel as formatDateLabel,
  formatAppointmentDateTimeLabel as formatDateTimeLabel,
  formatAppointmentSlotLabel as slotLabel,
} from "@/pages/appointments/model/runtime-formatters";
import {
  blankDoctorFollowUpForm,
  blankPackageEndFollowUpForm,
} from "@/pages/appointments/model/form-factories";
import {
  roleLabel,
  taskPriorityLabel,
  taskStatusLabel,
} from "@/pages/appointments/model/labels";
import {
  appointmentAnchorDateTime,
  toRfc3339,
} from "@/pages/appointments/model/workflow-helpers";
import type {
  AppointmentDetail,
  DoctorFollowUpFormState,
  PackageEndFollowUpFormState,
  ReminderEntry,
  StaffOption,
  TaskEntry,
} from "@/pages/appointments/model/types";
import {
  DOCTOR_FOLLOW_UP_PREFIX,
  PACKAGE_END_FOLLOW_UP_PREFIX,
  TASK_PRIORITY_OPTIONS,
} from "@/pages/appointments/model/constants";
import {
  AppointmentDotLabel,
  AppointmentSectionHeading,
  EmptyState,
  Field,
} from "@/pages/appointments/ui/shared/workspace-primitives";

type AppointmentDoctorFollowUpSectionProps = {
  detail: AppointmentDetail;
  reminders: ReminderEntry[];
  tasks: TaskEntry[];
  assignees: StaffOption[];
  defaultAssigneeId: string;
  canManageReminders: boolean;
  canCreateTasks: boolean;
  onRefresh: () => void;
  onError: (message: string) => void;
};

type AppointmentPackageEndSectionProps = {
  detail: AppointmentDetail;
  reminders: ReminderEntry[];
  tasks: TaskEntry[];
  assignees: StaffOption[];
  defaultAssigneeId: string;
  defaultTitle: string;
  canManageReminders: boolean;
  canCreateTasks: boolean;
  onRefresh: () => void;
  onError: (message: string) => void;
};

const sectionCardClass = appointmentElevatedSectionCardClassName;
const selectClassName = appointmentSelectControlClassName;
const textareaClassName = appointmentTextareaControlClassName;

function withEllipsis(text: string) {
  return text.trim().endsWith("...") ? text : `${text.trim()}...`;
}

function AppointmentDoctorFollowUpSection({
  detail,
  reminders,
  tasks,
  assignees,
  defaultAssigneeId,
  canManageReminders,
  canCreateTasks,
  onRefresh,
  onError,
}: AppointmentDoctorFollowUpSectionProps) {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const buildDefaultForm = useCallback(
    (
      assigneeId = defaultAssigneeId,
      dueAt = shiftLocalDateTime(appointmentAnchorDateTime(detail), {
        days: 7,
      }),
    ) => blankDoctorFollowUpForm(assigneeId, dueAt),
    [defaultAssigneeId, detail],
  );
  const [form, setForm] = useState<DoctorFollowUpFormState>(() =>
    buildDefaultForm(),
  );
  const [submitBusy, setSubmitBusy] = useState(false);

  useEffect(() => {
    setForm(buildDefaultForm());
    setSubmitBusy(false);
  }, [buildDefaultForm]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.assigneeId || !form.dueAt) return;

    const followUpTitle = `${DOCTOR_FOLLOW_UP_PREFIX} ${form.title.trim()}`;
    const description = [
      detail.doctor_name ? `Doctor: ${detail.doctor_name}` : "",
      detail.provider_name ? `Clinic: ${detail.provider_name}` : "",
      `Appointment: ${detail.patient_pid} · ${detail.title} · ${slotLabel(detail)}`,
      form.notes.trim() || "",
    ]
      .filter(Boolean)
      .join("\n");

    setSubmitBusy(true);
    try {
      const requests: Array<Promise<unknown>> = [
        apiFetch<{ id: string }>(`/appointments/${detail.id}/reminders`, {
          method: "POST",
          body: JSON.stringify({
            user_id: form.assigneeId,
            remind_at: toRfc3339(form.dueAt),
            title: followUpTitle,
            description,
          }),
        }),
      ];

      if (form.createTask && canCreateTasks) {
        requests.push(
          apiFetch<{ id: string }>("/tasks", {
            method: "POST",
            body: JSON.stringify({
              title: followUpTitle,
              description,
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

      await Promise.all(requests);
      setForm(
        buildDefaultForm(
          form.assigneeId,
          shiftLocalDateTime(form.dueAt, { days: 7 }),
        ),
      );
      onRefresh();
    } catch (error) {
      onError(error instanceof Error ? error.message : tr.common_failed_create);
    } finally {
      setSubmitBusy(false);
    }
  }

  return (
    <section className={sectionCardClass}>
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <AppointmentSectionHeading
          title={t.appointments_doctor_directed_followup_title}
          description={t.appointments_doctor_directed_followup_subtitle}
        />
        <span className={appointmentMetaPillClassName}>
          {reminders.length + tasks.length}{" "}
          {reminders.length + tasks.length === 1
            ? t.appointments_directed_item_singular
            : t.appointments_directed_item_plural}
        </span>
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <div className="space-y-4">
          <div className={appointmentSoftPanelClassName}>
            <AppointmentDotLabel>{t.common_search}</AppointmentDotLabel>
            <div className="mt-3 space-y-3">
              {reminders.length === 0 ? (
                <EmptyState text={tr.common_not_set} />
              ) : (
                reminders.map((item) => (
                  <div
                    key={item.id}
                    className={appointmentWhiteRowClassName}
                  >
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="text-sm font-medium text-slate-900">
                          {item.title.replace(`${DOCTOR_FOLLOW_UP_PREFIX} `, "")}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {item.user_name} · {formatDateTimeLabel(item.remind_at)}
                        </p>
                      </div>
                      {item.is_completed ? (
                        <span className="text-xs font-medium text-emerald-700">
                          {t.common_completed} {formatDateTimeLabel(item.completed_at)}
                        </span>
                      ) : (
                        <span className="text-xs font-medium text-amber-700">
                          {t.common_pending}
                        </span>
                      )}
                    </div>
                    {item.description ? (
                      <p className="mt-3 whitespace-pre-line text-sm text-slate-600">
                        {item.description}
                      </p>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </div>
          <div className={appointmentSoftPanelClassName}>
            <AppointmentDotLabel>{t.appointments_task_trail}</AppointmentDotLabel>
            <div className="mt-3 space-y-3">
              {tasks.length === 0 ? (
                <EmptyState text={tr.common_not_set} />
              ) : (
                tasks.map((task) => (
                  <div
                    key={task.id}
                    className={appointmentWhiteRowClassName}
                  >
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="text-sm font-medium text-slate-900">
                          {task.title.replace(`${DOCTOR_FOLLOW_UP_PREFIX} `, "")}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {task.assigned_to_name} · {taskStatusLabel(task.status)} ·{" "}
                          {taskPriorityLabel(task.priority)}
                        </p>
                      </div>
                      <span className="text-xs text-slate-500">
                        {task.due_date ? formatDateTimeLabel(task.due_date) : t.common_not_set}
                      </span>
                    </div>
                    {task.description ? (
                      <p className="mt-3 whitespace-pre-line text-sm text-slate-600">
                        {task.description}
                      </p>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
        {canManageReminders ? (
          <form
            onSubmit={handleSubmit}
            className={`space-y-4 ${appointmentSoftPanelClassName}`}
          >
            <Field label={tr.appointments_title_col}>
              <Input
                value={form.title}
                onChange={(event) =>
                  setForm((current) => ({ ...current, title: event.target.value }))
                }
                placeholder={withEllipsis(tr.appointments_title_col)}
                className={appointmentSlateInputClassName}
                required
              />
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
            <Field label={tr.invoices_due_at}>
              <Input
                type="datetime-local"
                value={form.dueAt}
                onChange={(event) =>
                  setForm((current) => ({ ...current, dueAt: event.target.value }))
                }
                className={appointmentSlateInputClassName}
                required
              />
            </Field>
            <Field label={tr.patients_notes}>
              <textarea
                value={form.notes}
                onChange={(event) =>
                  setForm((current) => ({ ...current, notes: event.target.value }))
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
                  {t.appointments_doctor_follow_up_mirror_task}
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
            <div className="flex justify-end">
              <Button
                type="submit"
                disabled={
                  submitBusy ||
                  !form.title.trim() ||
                  !form.assigneeId ||
                  !form.dueAt
                }
              >
                {submitBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {t.appointments_doctor_follow_up_create}
              </Button>
            </div>
          </form>
        ) : (
          <div className={appointmentSoftPanelClassName}>
            <EmptyState text={tr.common_not_set} />
          </div>
        )}
      </div>
    </section>
  );
}

function AppointmentPackageEndSection({
  detail,
  reminders,
  tasks,
  assignees,
  defaultAssigneeId,
  defaultTitle,
  canManageReminders,
  canCreateTasks,
  onRefresh,
  onError,
}: AppointmentPackageEndSectionProps) {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const buildDefaultForm = useCallback(
    (assigneeId = defaultAssigneeId, title = defaultTitle) =>
      blankPackageEndFollowUpForm(assigneeId, title),
    [defaultAssigneeId, defaultTitle],
  );
  const [form, setForm] = useState<PackageEndFollowUpFormState>(() =>
    buildDefaultForm(),
  );
  const [submitBusy, setSubmitBusy] = useState(false);

  useEffect(() => {
    setForm(buildDefaultForm());
    setSubmitBusy(false);
  }, [buildDefaultForm]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.assigneeId || !form.packageEndDate) return;

    const remindAt = shiftLocalDateTime(`${form.packageEndDate}T09:00`, {
      months: -1,
    });
    if (!remindAt) return;

    const followUpTitle = `${PACKAGE_END_FOLLOW_UP_PREFIX} ${form.title.trim()}`;
    const description = [
      `Package target end date: ${formatDateLabel(form.packageEndDate)}`,
      detail.order_id ? `Order: ${detail.order_id}` : "",
      detail.provider_name ? `Clinic: ${detail.provider_name}` : "",
      detail.doctor_name ? `Doctor: ${detail.doctor_name}` : "",
      `Appointment: ${detail.patient_pid} · ${detail.title} · ${slotLabel(detail)}`,
      form.notes.trim() || "",
    ]
      .filter(Boolean)
      .join("\n");

    setSubmitBusy(true);
    try {
      const requests: Array<Promise<unknown>> = [
        apiFetch<{ id: string }>(`/appointments/${detail.id}/reminders`, {
          method: "POST",
          body: JSON.stringify({
            user_id: form.assigneeId,
            remind_at: toRfc3339(remindAt),
            title: followUpTitle,
            description,
          }),
        }),
      ];

      if (form.createTask && canCreateTasks) {
        requests.push(
          apiFetch<{ id: string }>("/tasks", {
            method: "POST",
            body: JSON.stringify({
              title: followUpTitle,
              description,
              assigned_to: form.assigneeId,
              patient_id: detail.patient_id,
              order_id: detail.order_id,
              appointment_id: detail.id,
              due_date: toRfc3339(remindAt),
              priority: form.taskPriority,
            }),
          }),
        );
      }

      await Promise.all(requests);
      setForm(buildDefaultForm(form.assigneeId, defaultTitle));
      onRefresh();
    } catch (error) {
      onError(error instanceof Error ? error.message : tr.common_failed_create);
    } finally {
      setSubmitBusy(false);
    }
  }

  const scheduledReminder = form.packageEndDate
    ? shiftLocalDateTime(`${form.packageEndDate}T09:00`, { months: -1 })
    : "";

  return (
    <section className={sectionCardClass}>
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <AppointmentSectionHeading
          title={t.appointments_package_follow_up_title}
          description={t.appointments_package_follow_up_description}
        />
        <span className={appointmentMetaPillClassName}>
          {reminders.length + tasks.length}{" "}
          {reminders.length + tasks.length === 1
            ? t.appointments_common_package_item
            : t.appointments_common_package_items}
        </span>
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <div className="space-y-3">
          {reminders.length === 0 && tasks.length === 0 ? (
            <EmptyState text={tr.common_not_set} />
          ) : (
            <>
              {reminders.map((item) => (
                <div
                  key={item.id}
                  className={appointmentSoftRowClassName}
                >
                  <p className="text-sm font-medium text-slate-900">
                    {item.title.replace(`${PACKAGE_END_FOLLOW_UP_PREFIX} `, "")}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {item.user_name} · {formatDateTimeLabel(item.remind_at)}
                  </p>
                  {item.description ? (
                    <p className="mt-3 whitespace-pre-line text-sm text-slate-600">
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
                    <p className="text-sm font-medium text-slate-900">
                      {task.title.replace(`${PACKAGE_END_FOLLOW_UP_PREFIX} `, "")}
                    </p>
                    <span className="text-xs text-slate-500">
                      {taskStatusLabel(task.status)} · {taskPriorityLabel(task.priority)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {task.assigned_to_name}
                    {task.due_date ? ` · ${formatDateTimeLabel(task.due_date)}` : ""}
                  </p>
                  {task.description ? (
                    <p className="mt-3 whitespace-pre-line text-sm text-slate-600">
                      {task.description}
                    </p>
                  ) : null}
                </div>
              ))}
            </>
          )}
        </div>
        {canManageReminders ? (
          <form
            onSubmit={handleSubmit}
            className={`space-y-4 ${appointmentSoftPanelClassName}`}
          >
            <Field label={t.appointments_date}>
              <Input
                type="date"
                value={form.packageEndDate}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    packageEndDate: event.target.value,
                  }))
                }
                className={appointmentSlateInputClassName}
                required
              />
            </Field>
            <Field label={tr.appointments_title_col}>
              <Input
                value={form.title}
                onChange={(event) =>
                  setForm((current) => ({ ...current, title: event.target.value }))
                }
                className={appointmentWhiteInputClassName}
                required
              />
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
            {scheduledReminder ? (
              <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-700">
                {t.appointments_package_follow_up_reminder_scheduled_for}{" "}
                {formatDateTimeLabel(toRfc3339(scheduledReminder))}.
              </div>
            ) : null}
            <Field label={t.patients_notes}>
              <textarea
                value={form.notes}
                onChange={(event) =>
                  setForm((current) => ({ ...current, notes: event.target.value }))
                }
                className={textareaClassName}
                rows={4}
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
                <span>{t.appointments_package_follow_up_create_task}</span>
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
            <div className="flex justify-end">
              <Button
                type="submit"
                disabled={
                  submitBusy ||
                  !form.title.trim() ||
                  !form.assigneeId ||
                  !form.packageEndDate
                }
              >
                {submitBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {t.appointments_package_follow_up_schedule}
              </Button>
            </div>
          </form>
        ) : null}
      </div>
    </section>
  );
}

const MemoizedAppointmentDoctorFollowUpSection = memo(
  AppointmentDoctorFollowUpSection,
);
const MemoizedAppointmentPackageEndSection = memo(
  AppointmentPackageEndSection,
);

export {
  MemoizedAppointmentDoctorFollowUpSection,
  MemoizedAppointmentPackageEndSection,
};
