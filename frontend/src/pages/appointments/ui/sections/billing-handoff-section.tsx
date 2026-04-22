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
import {
  Banner,
  selectClass,
} from "@/components/ui-shell";
import { useLang } from "@/lib/i18n";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { apiFetch } from "@/lib/api";
import { shiftLocalDateTime } from "@/pages/appointments/model/date-time";
import {
  formatAppointmentDateTimeLabel as formatDateTimeLabel,
  formatAppointmentSlotLabel as slotLabel,
} from "@/pages/appointments/model/runtime-formatters";
import { blankBillingHandoffForm } from "@/pages/appointments/model/form-factories";
import {
  appointmentText,
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

const sectionCardClass = "rounded-3xl border border-slate-200/80 bg-white p-5 shadow-[0_20px_50px_-35px_rgba(15,23,42,0.35)]";
const textareaClassName =
  "w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200";

function withEllipsis(text: string) {
  return text.trim().endsWith("...") ? text : `${text.trim()}...`;
}

function AppointmentBillingHandoffSection({
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

  useEffect(() => {
    setForm(buildDefaultForm());
    setSubmitBusy(false);
  }, [buildDefaultForm]);

  function openBillingChatDraft() {
    if (!form.assigneeId) return;
    const assignee = billingStaff.find((item) => item.id === form.assigneeId);
    if (!assignee) return;

    const draftParts = [
      `Billing handoff: ${detail.patient_pid} · ${detail.title}`,
      `Track: ${billingHandoffKindLabel(form.kind)}`,
      `Slot: ${slotLabel(detail)}`,
      form.kind === "interpreter_hours" && detailReport
        ? `Interpreter hours: ${detailReport.hours}h · ${reportApprovalLabel(detailReport.approval_status)}`
        : "",
      form.kind === "concierge_settlement"
        ? `Concierge services: ${readyServices.length} ready · ${settledServices.length} billed/settled`
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
      `Track: ${billingHandoffKindLabel(form.kind)}`,
      `Appointment: ${detail.patient_pid} · ${detail.title} · ${slotLabel(detail)}`,
      detail.provider_name ? `Clinic: ${detail.provider_name}` : "",
      detail.doctor_name ? `Doctor: ${detail.doctor_name}` : "",
      form.kind === "interpreter_hours" && detailReport
        ? `Interpreter hours: ${detailReport.hours}h · ${reportApprovalLabel(detailReport.approval_status)}`
        : "",
      form.kind === "concierge_settlement"
        ? `Concierge services ready: ${readyServices.length}; billed or settled: ${settledServices.length}`
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
      onError(error instanceof Error ? error.message : tr.common_failed_create);
    } finally {
      setSubmitBusy(false);
    }
  }

  return (
    <section className={sectionCardClass}>
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-950">
            {appointmentText(
              "Ubergabe an Abrechnung und Settlement",
              "Передача в биллинг и расчёты",
              "Billing and settlement handoff",
            )}
          </h3>
          <p className="text-xs text-slate-500">
            {appointmentText(
              "Strukturierte Ubergabe an die Abrechnung, bevor die Dokumentenschicht nachzieht.",
              "Структурированная передача в биллинг до того, как подключится документный слой.",
              "Structured transfer to billing before the document layer lands.",
            )}
          </p>
        </div>
        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
          {tasks.length + reminders.length}{" "}
          {appointmentText("verknupft", "связано", "linked")}
        </span>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-3">
        <ContextCard
          label={tr.role_interpreter}
          value={
            detail.interpreter_id
              ? interpreterReportReady && detailReport
                ? appointmentText(
                    `${detailReport.hours} Std. freigegeben`,
                    `${detailReport.hours} ч согласовано`,
                    `${detailReport.hours} h approved`,
                  )
                : appointmentText(
                    "Freigabe ausstehend",
                    "Ожидает согласования",
                    "Pending approval",
                  )
              : appointmentText("Nicht erforderlich", "Не требуется", "Not required")
          }
          meta={
            detail.interpreter_id
              ? detailReport
                ? reportReviewMeta || reportApprovalLabel(detailReport.approval_status)
                : appointmentText(
                    "Kein Bericht eingereicht",
                    "Отчёт не отправлен",
                    "No report submitted",
                  )
              : appointmentText(
                  "Kein Dolmetscher fur diesen Termin",
                  "Для этого приёма нет переводчика",
                  "No interpreter on this appointment",
                )
          }
        />
        <ContextCard
          label={tr.role_concierge}
          value={
            detail.type === "non_medical"
              ? appointmentText(
                  `${readyServices.length} bereit / ${settledServices.length} abgerechnet`,
                  `${readyServices.length} готово / ${settledServices.length} выставлено`,
                  `${readyServices.length} ready / ${settledServices.length} billed`,
                )
              : appointmentText("Nicht anwendbar", "Не применимо", "Not applicable")
          }
          meta={
            detail.type === "non_medical"
              ? appointmentText(
                  `${serviceCount} Leistung(en) verknupft`,
                  `${serviceCount} услуг(а) связано`,
                  `${serviceCount} service(s) linked`,
                )
              : appointmentText(
                  "Medizinischer Termin",
                  "Медицинский приём",
                  "Medical appointment",
                )
          }
        />
        <ContextCard
          label={tr.role_billing}
          value={appointmentText(
            `${openTasks.length} offene Aufgabe(n)`,
            `${openTasks.length} открытых задач`,
            `${openTasks.length} open task(s)`,
          )}
          meta={appointmentText(
            `${reminders.length} Erinnerung(en) verknupft`,
            `${reminders.length} напоминаний связано`,
            `${reminders.length} reminder(s) linked`,
          )}
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
        <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4">
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-sm font-semibold text-slate-950">
              {appointmentText(
                "Billing-Erinnerungen",
                "Напоминания для биллинга",
                "Billing reminders",
              )}
            </h4>
            <span className="text-xs text-slate-500">
              {reminders.length} {appointmentText("verknupft", "связано", "linked")}
            </span>
          </div>
          <div className="mt-3 space-y-3">
            {reminders.length === 0 ? (
              <EmptyState text={tr.common_not_set} />
            ) : (
              reminders.map((item) => (
                <div
                  key={item.id}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
                >
                  <p className="text-sm font-medium text-slate-900">{item.title}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {item.user_name} · {formatDateTimeLabel(item.remind_at)}
                  </p>
                  {item.description ? (
                    <p className="mt-2 text-sm text-slate-600">{item.description}</p>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4">
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-sm font-semibold text-slate-950">
              {appointmentText(
                "Billing-Aufgaben",
                "Задачи биллинга",
                "Billing tasks",
              )}
            </h4>
            <span className="text-xs text-slate-500">
              {tasks.length} {appointmentText("verknupft", "связано", "linked")}
            </span>
          </div>
          <div className="mt-3 space-y-3">
            {tasks.length === 0 ? (
              <EmptyState text={tr.common_not_set} />
            ) : (
              tasks.map((task) => (
                <div
                  key={task.id}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-slate-900">{task.title}</p>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                      {taskStatusLabel(task.status)}
                    </span>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                      {taskPriorityLabel(task.priority)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {task.assigned_to_name} · {roleLabel(task.assigned_to_role)}
                    {task.due_date
                      ? appointmentText(
                          ` · Fallig ${formatDateTimeLabel(task.due_date)}`,
                          ` · Срок ${formatDateTimeLabel(task.due_date)}`,
                          ` · Due ${formatDateTimeLabel(task.due_date)}`,
                        )
                      : ""}
                  </p>
                  {task.description ? (
                    <p className="mt-2 text-sm text-slate-600">{task.description}</p>
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
            <select
              value={form.kind}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  kind: event.target.value as BillingHandoffKind,
                }))
              }
              className={selectClass}
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
            </select>
          </Field>
          <Field label={tr.role_billing}>
            <select
              value={form.assigneeId}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  assigneeId: event.target.value,
                }))
              }
              className={selectClass}
              required
            >
              <option value="">
                {appointmentText(
                  "Billing-Zustandigen auswahlen",
                  "Выберите ответственного из биллинга",
                  "Select billing assignee",
                )}
              </option>
              {billingStaff.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name} · {roleLabel(member.role)}
                </option>
              ))}
            </select>
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
              className="h-10 rounded-xl bg-slate-50"
              required
            />
          </Field>
          <Field label={tr.appointments_title_col}>
            <select
              value={form.taskPriority}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  taskPriority: event.target.value,
                }))
              }
              className={selectClass}
            >
              {TASK_PRIORITY_OPTIONS.map((priority) => (
                <option key={priority} value={priority}>
                  {taskPriorityLabel(priority)}
                </option>
              ))}
            </select>
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
              className="h-10 rounded-xl bg-slate-50"
              placeholder={withEllipsis(tr.appointments_title_col)}
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
            />
          </Field>
          <div className="md:col-span-2 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={form.createTask}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    createTask: event.target.checked,
                  }))
                }
                className="size-4 rounded border-slate-300"
              />
              Mirror this billing handoff as a task
            </label>
            <div className="flex flex-wrap justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                className="rounded-2xl"
                disabled={!form.assigneeId}
                onClick={openBillingChatDraft}
              >
                {appointmentText(
                  "Billing-Chatentwurf öffnen",
                  "Открыть черновик billing-чата",
                  "Open billing chat draft",
                )}
              </Button>
              <Button
                type="submit"
                className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
                disabled={
                  submitBusy ||
                  !form.assigneeId ||
                  !form.dueAt ||
                  billingStaff.length === 0
                }
              >
                {submitBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {appointmentText(
                  "Billing-Handoff erstellen",
                  "Создать billing-handoff",
                  "Create billing handoff",
                )}
              </Button>
            </div>
          </div>
        </form>
      ) : null}
    </section>
  );
}

const MemoizedAppointmentBillingHandoffSection = memo(
  AppointmentBillingHandoffSection,
);

export { MemoizedAppointmentBillingHandoffSection };
