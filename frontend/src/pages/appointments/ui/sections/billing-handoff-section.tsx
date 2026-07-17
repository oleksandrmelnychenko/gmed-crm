import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import {
  memo,
  useCallback,
  useState,
  type FormEvent,
} from "react";

import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Banner, checkboxClass } from "@/components/ui-shell";
import { useLang } from "@/lib/i18n";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { apiFetch } from "@/lib/api";
import {
  appointmentElevatedSectionCardClassName,
  appointmentMetaPillClassName,
  appointmentMiniPillClassName,
  appointmentSelectControlClassName,
  appointmentSlateInputClassName,
  appointmentSlateTextareaControlClassName,
  appointmentSoftPanelClassName,
  appointmentWhiteRowClassName,
} from "@/pages/appointments/appearance/surface-appearance";
import { shiftLocalDateTime } from "@/pages/appointments/model/date-time";
import { appointmentActionErrorMessage } from "@/pages/appointments/model/error-message";
import {
  formatAppointmentDateTimeLabel as formatDateTimeLabel,
  formatAppointmentSlotLabel as slotLabel,
} from "@/pages/appointments/model/runtime-formatters";
import { blankBillingHandoffForm } from "@/pages/appointments/model/form-factories";
import {
  appointmentText as appointmentTextBase,
  billingHandoffKindLabel,
  reportApprovalLabel,
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
  BillingHandoffFormState,
  BillingHandoffKind,
  ConciergeServiceEntry,
  ReminderEntry,
  ReportSummary,
  StaffOption,
  TaskEntry,
} from "@/pages/appointments/model/types";
import {
  BILLING_HANDOFF_PREFIX,
  TASK_PRIORITY_OPTIONS,
} from "@/pages/appointments/model/constants";
import { ContextCard } from "@/pages/appointments/ui/shared/context-card";
import {
  AppointmentDotLabel,
  AppointmentSectionHeading,
  EmptyState,
  Field,
} from "@/pages/appointments/ui/shared/workspace-primitives";

type AppointmentBillingHandoffSectionProps = {
  detail: AppointmentDetail;
  detailReport: ReportSummary | null;
  reportReviewMeta: string;
  interpreterReportReady: boolean;
  serviceCount: number;
  billingStaff: StaffOption[];
  reminders: ReminderEntry[];
  tasks: TaskEntry[];
  openTasks: TaskEntry[];
  readyServices: ConciergeServiceEntry[];
  settledServices: ConciergeServiceEntry[];
  warnings: string[];
  canManageConciergeBilling: boolean;
  canCreateTasks: boolean;
  onRefresh: () => void;
  onError: (message: string) => void;
};

const sectionCardClass = appointmentElevatedSectionCardClassName;
const selectClassName = appointmentSelectControlClassName;
const inputClassName = appointmentSlateInputClassName;
const textareaClassName = appointmentSlateTextareaControlClassName;

function withEllipsis(text: string) {
  return text.trim().endsWith("...") ? text : `${text.trim()}...`;
}

function AppointmentBillingHandoffSection(props: AppointmentBillingHandoffSectionProps) {
  const defaultDueAtKey = appointmentAnchorDateTime(props.detail);
  return (
    <AppointmentBillingHandoffSectionContent
      key={[
        props.detail.id,
        props.detail.type,
        props.detail.interpreter_id ?? "",
        props.billingStaff[0]?.id ?? "",
        defaultDueAtKey,
      ].join(":")}
      {...props}
    />
  );
}

function useAppointmentBillingHandoffSectionContentContent({
  detail,
  detailReport,
  reportReviewMeta,
  interpreterReportReady,
  serviceCount,
  billingStaff,
  reminders,
  tasks,
  openTasks,
  readyServices,
  settledServices,
  warnings,
  canManageConciergeBilling,
  canCreateTasks,
  onRefresh,
  onError,
}: AppointmentBillingHandoffSectionProps) {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const appointmentText = appointmentTextBase;
  const { staffGo } = useStaffNavigate();

  const buildDefaultForm = useCallback(
    (
      defaultAssignee = billingStaff[0]?.id ?? "",
      defaultDueAt = shiftLocalDateTime(appointmentAnchorDateTime(detail), {
        days: 1,
      }),
      defaultKind: BillingHandoffKind =
        detail.type === "non_medical"
          ? "concierge_settlement"
          : detail.interpreter_id
            ? "interpreter_hours"
            : "patient_invoice",
    ) => blankBillingHandoffForm(defaultAssignee, defaultDueAt, defaultKind),
    [billingStaff, detail],
  );

  const [form, setForm] = useState<BillingHandoffFormState>(() =>
    buildDefaultForm(),
  );
  const [submitBusy, setSubmitBusy] = useState(false);

  function openBillingChatDraft() {
    if (!form.assigneeId) return;
    const assignee = billingStaff.find((item) => item.id === form.assigneeId);
    if (!assignee) return;

    const draftParts = [
      appointmentText("appointments_billing_chat_title", {
        patientPid: detail.patient_pid,
        title: detail.title,
      }),
      appointmentText("appointments_description_track", {
        track: billingHandoffKindLabel(form.kind),
      }),
      appointmentText("appointments_description_slot", {
        slot: slotLabel(detail),
      }),
      form.kind === "interpreter_hours" && detailReport
        ? appointmentText("appointments_description_interpreter_hours", {
            hours: detailReport.hours,
            status: reportApprovalLabel(detailReport.approval_status),
          })
        : "",
      form.kind === "concierge_settlement"
        ? appointmentText("appointments_description_concierge_services", {
            ready: readyServices.length,
            settled: settledServices.length,
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
    if (!form.assigneeId || !form.dueAt) return;

    const titleSuffix = form.title.trim() || billingHandoffKindLabel(form.kind);
    const handoffTitle = `${BILLING_HANDOFF_PREFIX} ${titleSuffix}`;
    const descriptionParts = [
      appointmentText("appointments_description_track", {
        track: billingHandoffKindLabel(form.kind),
      }),
      appointmentText("appointments_description_appointment", {
        patientPid: detail.patient_pid,
        title: detail.title,
        slot: slotLabel(detail),
      }),
      detail.provider_name
        ? appointmentText("appointments_description_clinic", {
            clinic: detail.provider_name,
          })
        : "",
      detail.doctor_name
        ? appointmentText("appointments_description_doctor", {
            doctor: detail.doctor_name,
          })
        : "",
      form.kind === "interpreter_hours" && detailReport
        ? appointmentText("appointments_description_interpreter_hours", {
            hours: detailReport.hours,
            status: reportApprovalLabel(detailReport.approval_status),
          })
        : "",
      form.kind === "concierge_settlement"
        ? appointmentText("appointments_description_concierge_services_detailed", {
            ready: readyServices.length,
            settled: settledServices.length,
          })
        : "",
      form.notes.trim() || "",
    ].filter(Boolean);

    setSubmitBusy(true);
    try {
      const requests: Array<Promise<unknown>> = [
        apiFetch<{ id: string }>(`/appointments/${detail.id}/reminders`, {
          method: "POST",
          body: JSON.stringify({
            user_id: form.assigneeId,
            remind_at: toRfc3339(form.dueAt),
            title: handoffTitle,
            description: descriptionParts.join("\n"),
          }),
        }),
      ];

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

      await Promise.all(requests);
      setForm(
        buildDefaultForm(
          form.assigneeId,
          shiftLocalDateTime(form.dueAt, { days: 1 }),
          form.kind,
        ),
      );
      onRefresh();
    } catch (error) {
      onError(appointmentActionErrorMessage(error, tr.common_failed_create));
    } finally {
      setSubmitBusy(false);
    }
  }

  const noBillingStaff = billingStaff.length === 0;
  const handoffBlockedReason = noBillingStaff
    ? appointmentText("appointments_billing_handoff_blocked_no_staff")
    : !form.assigneeId
      ? appointmentText("appointments_billing_handoff_blocked_no_assignee")
      : !form.dueAt
        ? appointmentText("appointments_billing_handoff_blocked_no_due")
        : null;

  return (
    <section className={sectionCardClass}>
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <AppointmentSectionHeading
          title={appointmentText("appointments_billing_and_settlement_handoff")}
          description={appointmentText("appointments_structured_transfer_to_billing_before_the_document_layer")}
        />
        <span className={appointmentMetaPillClassName}>
          {tasks.length + reminders.length}{" "}
          {appointmentText("appointments_linked")}
        </span>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-3">
        <ContextCard
          label={tr.role_interpreter}
          value={
            detail.interpreter_id
              ? interpreterReportReady && detailReport
                ? appointmentText("appointments_report_hours_approved", {
                    hours: detailReport.hours,
                  })
                : appointmentText("appointments_pending_approval")
              : appointmentText("appointments_not_required")
          }
          meta={
            detail.interpreter_id
              ? detailReport
                ? reportReviewMeta || reportApprovalLabel(detailReport.approval_status)
                : appointmentText("appointments_no_report_submitted")
              : appointmentText("appointments_no_interpreter_on_this_appointment")
          }
        />
        <ContextCard
          label={tr.role_concierge}
          value={
            detail.type === "non_medical"
              ? appointmentText("appointments_billing_services_status_summary", {
                  ready: readyServices.length,
                  settled: settledServices.length,
                })
              : appointmentText("appointments_not_applicable")
          }
          meta={
            detail.type === "non_medical"
              ? appointmentText("appointments_services_linked_count", {
                  count: serviceCount,
                })
              : appointmentText("appointments_medical_appointment")
          }
        />
        <ContextCard
          label={tr.role_billing}
          value={appointmentText("appointments_open_tasks_count", {
            count: openTasks.length,
          })}
          meta={appointmentText("appointments_reminders_linked_count", {
            count: reminders.length,
          })}
        />
      </div>

      {warnings.length > 0 ? (
        <div className="mt-4 space-y-2">
          {warnings.map((warning) => (
            <Banner key={warning} tone="warning">
              {warning}
            </Banner>
          ))}
        </div>
      ) : null}

      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        <div className={appointmentSoftPanelClassName}>
          <div className="flex items-center justify-between gap-3">
            <AppointmentDotLabel>
              {appointmentText("appointments_billing_reminders")}
            </AppointmentDotLabel>
            <span className="text-xs text-zinc-500">
              {reminders.length} {appointmentText("appointments_linked")}
            </span>
          </div>
          <div className="mt-3 space-y-3">
            {reminders.length === 0 ? (
              <EmptyState text={tr.common_not_set} />
            ) : (
              reminders.map((item) => (
                <div
                  key={item.id}
                  className={appointmentWhiteRowClassName}
                >
                  <p className="text-sm font-medium text-zinc-900">{item.title}</p>
                  <p className="mt-1 text-xs text-zinc-500">
                    {item.user_name} · {formatDateTimeLabel(item.remind_at)}
                  </p>
                  {item.description ? (
                    <p className="mt-2 text-sm text-zinc-600">{item.description}</p>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>

        <div className={appointmentSoftPanelClassName}>
          <div className="flex items-center justify-between gap-3">
            <AppointmentDotLabel>
              {appointmentText("appointments_billing_tasks")}
            </AppointmentDotLabel>
            <span className="text-xs text-zinc-500">
              {tasks.length} {appointmentText("appointments_linked")}
            </span>
          </div>
          <div className="mt-3 space-y-3">
            {tasks.length === 0 ? (
              <EmptyState text={tr.common_not_set} />
            ) : (
              tasks.map((task) => (
                <div
                  key={task.id}
                  className={appointmentWhiteRowClassName}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-zinc-900">{task.title}</p>
                    <span className={appointmentMiniPillClassName}>
                      {taskStatusLabel(task.status)}
                    </span>
                    <span className={appointmentMiniPillClassName}>
                      {taskPriorityLabel(task.priority)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">
                    {task.assigned_to_name} · {roleLabel(task.assigned_to_role)}
                    {task.due_date
                      ? appointmentText("appointments_due_date_suffix", {
                          date: formatDateTimeLabel(task.due_date),
                        })
                      : ""}
                  </p>
                  {task.description ? (
                    <p className="mt-2 text-sm text-zinc-600">{task.description}</p>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {canManageConciergeBilling ? (
        <form onSubmit={handleSubmit} className="mt-5 grid gap-4 md:grid-cols-2">
          <Field label={tr.role_billing}>
            <NativeComboboxSelect
              value={form.kind}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  kind: event.target.value as BillingHandoffKind,
                }))
              }
              className={selectClassName}
              disabled={noBillingStaff}
            >
              {(
                [
                  "interpreter_hours",
                  "concierge_settlement",
                  "patient_invoice",
                  "provider_invoice",
                  "payment_confirmation",
                  "other",
                ] as BillingHandoffKind[]
              ).map((kind) => (
                <option key={kind} value={kind}>
                  {billingHandoffKindLabel(kind)}
                </option>
              ))}
            </NativeComboboxSelect>
          </Field>
          <Field label={tr.role_billing}>
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
              disabled={noBillingStaff}
            >
              <option value="">
                {appointmentText("appointments_select_billing_assignee")}
              </option>
              {billingStaff.map((member) => (
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
                setForm((current) => ({
                  ...current,
                  dueAt: event.target.value,
                }))
              }
              className={inputClassName}
              required
              disabled={noBillingStaff}
            />
          </Field>
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
              disabled={noBillingStaff}
            >
              {TASK_PRIORITY_OPTIONS.map((priority) => (
                <option key={priority} value={priority}>
                  {taskPriorityLabel(priority)}
                </option>
              ))}
            </NativeComboboxSelect>
          </Field>
          <Field label={tr.appointments_title_col}>
            <Input
              value={form.title}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  title: event.target.value,
                }))
              }
              className={inputClassName}
              placeholder={withEllipsis(tr.appointments_title_col)}
              disabled={noBillingStaff}
            />
          </Field>
          <Field label={t.patients_notes}>
            <textarea
              value={form.notes}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  notes: event.target.value,
                }))
              }
              className={textareaClassName}
              rows={3}
              placeholder={withEllipsis(tr.patients_notes)}
              disabled={noBillingStaff}
            />
          </Field>
          <div className="md:col-span-2 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={form.createTask}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    createTask: event.target.checked,
                  }))
                }
                className={checkboxClass}
                disabled={noBillingStaff}
              />
              {t.appointments_billing_mirror_task}
            </label>
            <div className="flex flex-wrap justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                disabled={!form.assigneeId}
                onClick={openBillingChatDraft}
              >
                {appointmentText("appointments_open_billing_chat_draft")}
              </Button>
              <Button
                type="submit"
                disabled={
                  submitBusy ||
                  !form.assigneeId ||
                  !form.dueAt ||
                  billingStaff.length === 0
                }
              >
                {submitBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {appointmentText("appointments_create_billing_handoff")}
              </Button>
            </div>
          </div>
          {handoffBlockedReason ? (
            <p className="md:col-span-2 text-right text-xs text-amber-600">
              {handoffBlockedReason}
            </p>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}

function AppointmentBillingHandoffSectionContent(...args: Parameters<typeof useAppointmentBillingHandoffSectionContentContent>) {
  return useAppointmentBillingHandoffSectionContentContent(...args);
}

const MemoizedAppointmentBillingHandoffSection = memo(
  AppointmentBillingHandoffSection,
);

export { MemoizedAppointmentBillingHandoffSection };
