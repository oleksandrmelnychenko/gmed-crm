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
import {
  CountBadge,
  EmptyCell,
  Section,
  StatCard,
  StatusBadge,
} from "@/components/ui-shell";
import { apiFetch } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { cn } from "@/lib/utils";
import {
  appointmentFilterControlClassName,
  appointmentPreviewInfoCardClassName,
  appointmentSelectControlClassName,
  appointmentSoftPanelClassName,
  appointmentTextareaControlClassName,
} from "@/pages/appointments/appearance/surface-appearance";
import { shiftLocalDateTime } from "@/pages/appointments/model/date-time";
import {
  blankFindingsFollowUpForm,
  blankIncomingDataForm,
} from "@/pages/appointments/model/form-factories";
import {
  FINDINGS_CHECKLIST_PREFIX,
  FINDINGS_FOLLOW_UP_PREFIX,
  INCOMING_DATA_CHECKLIST_PREFIX,
  INCOMING_DATA_PREFIX,
  TASK_PRIORITY_OPTIONS,
} from "@/pages/appointments/model/constants";
import {
  appointmentText,
  findingsArtifactLabel,
  incomingDataCategoryLabel,
  incomingDataSourceLabel,
  roleLabel,
  taskPriorityLabel,
  taskStatusLabel,
} from "@/pages/appointments/model/labels";
import {
  formatAppointmentDateTimeLabel as formatDateTimeLabel,
  formatAppointmentSlotLabel as slotLabel,
} from "@/pages/appointments/model/runtime-formatters";
import {
  appointmentAnchorDateTime,
  toRfc3339,
} from "@/pages/appointments/model/workflow-helpers";
import type {
  AppointmentDetail,
  ChecklistItem,
  FindingsFollowUpArtifact,
  FindingsFollowUpFormState,
  IncomingDataCategory,
  IncomingDataFormState,
  IncomingDataSource,
  ReminderEntry,
  StaffOption,
  TaskEntry,
} from "@/pages/appointments/model/types";
import {
  AppointmentClinicalToggleCard,
  AppointmentEditorSheet,
  Field,
} from "@/pages/appointments/ui/shared/workspace-primitives";

const clinicalInputClassName = appointmentFilterControlClassName;
const clinicalSelectClassName = appointmentSelectControlClassName;
const clinicalTextareaClassName = appointmentTextareaControlClassName;

function withEllipsis(value: string) {
  return value.endsWith("...") || value.endsWith("…") ? value : `${value}…`;
}

type AppointmentIncomingDataSectionProps = {
  detail: AppointmentDetail;
  checklist: ChecklistItem[];
  reminders: ReminderEntry[];
  tasks: TaskEntry[];
  assignees: StaffOption[];
  defaultAssigneeId: string;
  canCreateTasks: boolean;
  onRefresh: () => void;
  onError: (message: string) => void;
};

function AppointmentIncomingDataSection({
  detail,
  checklist,
  reminders,
  tasks,
  assignees,
  defaultAssigneeId,
  canCreateTasks,
  onRefresh,
  onError,
}: AppointmentIncomingDataSectionProps) {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const { staffGo } = useStaffNavigate();
  const buildDefaultForm = useCallback(
    (
      assigneeId = defaultAssigneeId,
      dueAt = shiftLocalDateTime(appointmentAnchorDateTime(detail), {
        days: 2,
      }),
      source: IncomingDataSource = detail.interpreter_id ? "interpreter" : "doctor",
    ) => blankIncomingDataForm(assigneeId, dueAt, source),
    [defaultAssigneeId, detail],
  );
  const [form, setForm] = useState<IncomingDataFormState>(() =>
    buildDefaultForm(),
  );
  const [submitBusy, setSubmitBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const openChecklistCount = checklist.filter((item) => !item.is_completed).length;
  const intakeStateLabel =
    openChecklistCount === 0 && checklist.length > 0
      ? appointmentText("Intake bereit", "Интейк готов", "Intake clear")
      : appointmentText(
          `${openChecklistCount} offen`,
          `${openChecklistCount} открыто`,
          `${openChecklistCount} open`,
        );
  const followUpItemCount = reminders.length + tasks.length;
  const caseUpdateLabel = appointmentText(
    "Fallaktualisierung erforderlich",
    "Нужно обновление кейса",
    "Case update required",
  );
  const patientFollowUpLabel = appointmentText(
    "Patienten-Follow-up erforderlich",
    "Нужен фоллоу-ап с пациентом",
    "Patient follow-up required",
  );
  const intakeComposerTitle = appointmentText(
    "Intake-Follow-up anlegen",
    "Создать intake follow-up",
    "Create intake follow-up",
  );

  useEffect(() => {
    setForm(buildDefaultForm());
    setSubmitBusy(false);
    setActionBusy("");
    setComposerOpen(false);
  }, [buildDefaultForm]);

  async function completeChecklistItem(itemId: string) {
    setActionBusy(`check:${itemId}`);
    try {
      await apiFetch<{ ok: boolean }>(
        `/appointments/${detail.id}/checklist/${itemId}/complete`,
        { method: "POST" },
      );
      onRefresh();
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : appointmentText(
              "Element konnte nicht abgeschlossen werden.",
              "Не удалось завершить элемент.",
              "Failed to complete item",
            ),
      );
    } finally {
      setActionBusy("");
    }
  }

  function openChatDraft() {
    if (!form.assigneeId) return;
    const assignee = assignees.find((item) => item.id === form.assigneeId);
    if (!assignee) return;

    const draftParts = [
      `Incoming data intake: ${detail.patient_pid} · ${detail.title}`,
      `Source: ${incomingDataSourceLabel(form.source)}`,
      `Category: ${incomingDataCategoryLabel(form.category)}`,
      form.requiresCaseUpdate ? caseUpdateLabel : "",
      form.requiresPatientFollowUp ? patientFollowUpLabel : "",
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

    const title = `${INCOMING_DATA_PREFIX} ${incomingDataCategoryLabel(
      form.category,
    )} from ${incomingDataSourceLabel(form.source)}`;
    const description = [
      detail.provider_name ? `Clinic: ${detail.provider_name}` : "",
      detail.doctor_name ? `Doctor: ${detail.doctor_name}` : "",
      `Appointment: ${detail.patient_pid} · ${detail.title} · ${slotLabel(detail)}`,
      `Source: ${incomingDataSourceLabel(form.source)}`,
      `Category: ${incomingDataCategoryLabel(form.category)}`,
      form.requiresCaseUpdate ? caseUpdateLabel : "",
      form.requiresPatientFollowUp ? patientFollowUpLabel : "",
      form.notes.trim() || "",
    ]
      .filter(Boolean)
      .join("\n");
    const checklistItems = [
      `${INCOMING_DATA_CHECKLIST_PREFIX} Review and categorize incoming data`,
      form.requiresCaseUpdate
        ? `${INCOMING_DATA_CHECKLIST_PREFIX} Apply update to case/anamnesis`
        : "",
      form.requiresPatientFollowUp
        ? `${INCOMING_DATA_CHECKLIST_PREFIX} Patient follow-up after data triage`
        : "",
    ].filter(Boolean);

    setSubmitBusy(true);
    try {
      const requests: Array<Promise<unknown>> = [
        apiFetch<{ id: string }>(`/appointments/${detail.id}/reminders`, {
          method: "POST",
          body: JSON.stringify({
            user_id: form.assigneeId,
            remind_at: toRfc3339(form.dueAt),
            title,
            description,
          }),
        }),
        ...checklistItems.map((item) =>
          apiFetch<{ id: string }>(`/appointments/${detail.id}/checklist`, {
            method: "POST",
            body: JSON.stringify({
              phase: "followup",
              item_text: item,
            }),
          }),
        ),
      ];

      if (form.createTask && canCreateTasks) {
        requests.push(
          apiFetch<{ id: string }>("/tasks", {
            method: "POST",
            body: JSON.stringify({
              title,
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
          shiftLocalDateTime(form.dueAt, { days: 2 }),
          form.source,
        ),
      );
      setComposerOpen(false);
      onRefresh();
    } catch (error) {
      onError(error instanceof Error ? error.message : tr.common_failed_create);
    } finally {
      setSubmitBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Section
        title={appointmentText(
          "Eingehende medizinische Daten",
          "Входящие медицинские данные",
          "Incoming medical data",
        )}
        accessory={<CountBadge>{intakeStateLabel}</CountBadge>}
      >
        <p className="text-sm text-muted-foreground">
          {appointmentText(
            "Erfassen Sie neue medizinische Updates von Patienten, Ärzten, Dolmetschern oder Kliniken, die noch triagiert und in den Fall übernommen werden müssen.",
            "Фиксируйте новые медицинские обновления от пациентов, врачей, переводчиков или клиник, которые ещё нужно протриажить и внести в кейс.",
            "Capture new medical updates from patients, doctors, interpreters or clinics that still need triage and case updates.",
          )}
        </p>
        <div className="grid gap-3 md:grid-cols-3">
          <StatCard
            label={appointmentText("Checkliste", "Чек-лист", "Checklist")}
            value={checklist.length}
            description={
              checklist.length === 0
                ? appointmentText(
                    "Noch nicht gestartet",
                    "Ещё не запущен",
                    "Not started yet",
                  )
                : intakeStateLabel
            }
          />
          <StatCard
            label={appointmentText("Reminder", "Напоминания", "Reminders")}
            value={reminders.length}
            description={appointmentText(
              "Zeitfenster für Triage und Verarbeitung.",
              "Сроки для триажа и обработки.",
              "Timing for triage and processing.",
            )}
          />
          <StatCard
            label={appointmentText("Aufgaben", "Задачи", "Tasks")}
            value={tasks.length}
            description={appointmentText(
              "Operative Verantwortung für Kategorisierung und Fall-Update.",
              "Операционная ответственность за категоризацию и обновление кейса.",
              "Operational ownership for categorization and case updates.",
            )}
          />
        </div>
      </Section>

      <div className="space-y-4">
        <Section
          title={appointmentText(
            "Intake-Checkliste",
            "Чек-лист intake",
            "Intake checklist",
          )}
          accessory={<CountBadge>{checklist.length}</CountBadge>}
        >
          {checklist.length === 0 ? (
            <EmptyCell>
              {appointmentText(
                "Für diesen Termin wurde noch keine Intake-Checkliste angelegt.",
                "Для этого приёма пока не создан intake-чек-лист.",
                "No intake checklist has been created for this appointment yet.",
              )}
            </EmptyCell>
          ) : (
            <div className="space-y-2">
              {checklist.map((item) => (
                <div
                  key={item.id}
                  className={cn(
                    "flex flex-col gap-3 md:flex-row md:items-start md:justify-between",
                    appointmentPreviewInfoCardClassName,
                  )}
                >
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-foreground">
                      {item.item_text.replace(
                        `${INCOMING_DATA_CHECKLIST_PREFIX} `,
                        "",
                      )}
                    </p>
                    <p className="text-[11.5px] uppercase tracking-[0.12em] text-muted-foreground">
                      {item.phase}
                    </p>
                  </div>
                  {item.is_completed ? (
                    <StatusBadge tone="success">
                      {appointmentText(
                        "Abgeschlossen",
                        "Завершено",
                        "Completed",
                      )}{" "}
                      {formatDateTimeLabel(item.completed_at)}
                    </StatusBadge>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 rounded-lg gap-1.5"
                      disabled={Boolean(actionBusy)}
                      onClick={() => void completeChecklistItem(item.id)}
                    >
                      {actionBusy === `check:${item.id}` ? (
                        <LoaderCircle className="size-4 animate-spin" />
                      ) : null}
                      {appointmentText("Abschließen", "Завершить", "Complete")}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section
          title={appointmentText(
            "Reminder und Aufgaben",
            "Напоминания и задачи",
            "Reminders and tasks",
          )}
          accessory={
            <div className="flex items-center gap-2">
              <CountBadge>{followUpItemCount}</CountBadge>
              <Button
                type="button"
                size="sm"
                className="h-8 rounded-lg gap-1.5"
                onClick={() => setComposerOpen(true)}
              >
                {intakeComposerTitle}
              </Button>
            </div>
          }
        >
          {followUpItemCount === 0 ? (
            <EmptyCell>
              {appointmentText(
                "Für diesen Termin gibt es noch keine Reminder oder Aufgaben im Intake-Flow.",
                "Для этого приёма пока нет напоминаний или задач в intake-flow.",
                "No reminders or tasks exist in this intake flow yet.",
              )}
            </EmptyCell>
          ) : (
            <div className="space-y-2">
              {reminders.map((item) => (
                <div
                  key={item.id}
                  className={cn("space-y-2.5", appointmentPreviewInfoCardClassName)}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-foreground">
                        {item.title.replace(`${INCOMING_DATA_PREFIX} `, "")}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {item.user_name} · {formatDateTimeLabel(item.remind_at)}
                      </p>
                    </div>
                    <CountBadge>
                      {appointmentText("Reminder", "Напоминание", "Reminder")}
                    </CountBadge>
                  </div>
                  {item.description ? (
                    <p className="whitespace-pre-line text-sm text-muted-foreground">
                      {item.description}
                    </p>
                  ) : null}
                </div>
              ))}
              {tasks.map((task) => (
                <div
                  key={task.id}
                  className={cn("space-y-2.5", appointmentPreviewInfoCardClassName)}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-foreground">
                        {task.title.replace(`${INCOMING_DATA_PREFIX} `, "")}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {task.assigned_to_name}
                        {task.due_date
                          ? ` · ${formatDateTimeLabel(task.due_date)}`
                          : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={task.status}>
                        {taskStatusLabel(task.status)}
                      </StatusBadge>
                      <CountBadge>{taskPriorityLabel(task.priority)}</CountBadge>
                    </div>
                  </div>
                  {task.description ? (
                    <p className="whitespace-pre-line text-sm text-muted-foreground">
                      {task.description}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      <AppointmentEditorSheet
        open={composerOpen}
        onOpenChange={(open) => {
          setComposerOpen(open);
          if (!open) {
            setForm(buildDefaultForm());
            setSubmitBusy(false);
          }
        }}
        title={intakeComposerTitle}
        description={appointmentText(
          "Erstellen Sie Reminder, Checklistenpunkte und bei Bedarf eine verknüpfte Aufgabe direkt aus dem Termin.",
          "Создавайте напоминания, пункты чек-листа и при необходимости связанную задачу прямо из приёма.",
          "Create reminders, checklist items and, if needed, a linked task directly from the appointment.",
        )}
        onSubmit={handleSubmit}
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-lg"
              onClick={() => setComposerOpen(false)}
            >
              {t.common_cancel}
            </Button>
            <Button
              type="submit"
              size="sm"
              className="h-8 rounded-lg gap-1.5"
              disabled={submitBusy || !form.assigneeId || !form.dueAt}
            >
              {submitBusy ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : null}
              {appointmentText(
                "Intake-Flow starten",
                "Запустить intake-flow",
                "Start intake flow",
              )}
            </Button>
          </>
        }
      >
        <div
          className={cn("text-sm text-muted-foreground", appointmentSoftPanelClassName)}
        >
          {appointmentText(
            "Alle Änderungen werden direkt am Termin gespeichert und danach sofort in der klinischen Übersicht angezeigt.",
            "Все изменения сохраняются прямо в приёме и сразу отображаются в клиническом блоке.",
            "All changes are saved directly on the appointment and shown immediately in the clinical view.",
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label={tr.documents_source}>
            <NativeComboboxSelect
              value={form.source}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  source: event.target.value as IncomingDataSource,
                }))
              }
              className={clinicalSelectClassName}
            >
              <option value="patient">{tr.orders_patient}</option>
              <option value="doctor">{tr.common_doctor}</option>
              <option value="clinic">{tr.common_provider}</option>
              <option value="interpreter">{tr.role_interpreter}</option>
              <option value="external_lab">{tr.common_provider}</option>
              <option value="other">{tr.common_not_set}</option>
            </NativeComboboxSelect>
          </Field>
          <Field label={tr.documents_category}>
            <NativeComboboxSelect
              value={form.category}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  category: event.target.value as IncomingDataCategory,
                }))
              }
              className={clinicalSelectClassName}
            >
              <option value="medical_update">Medical update</option>
              <option value="diagnosis">{tr.cases_preconditions}</option>
              <option value="medication">{tr.cases_medications}</option>
              <option value="symptom">{tr.cases_symptoms}</option>
              <option value="lab_result">{tr.cases_title}</option>
              <option value="imaging">{tr.documents_title}</option>
              <option value="recommendation">Recommendation</option>
              <option value="risk_flag">{tr.common_error}</option>
              <option value="other">{tr.common_not_set}</option>
            </NativeComboboxSelect>
          </Field>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t.patients_assign_owner}>
            <NativeComboboxSelect
              value={form.assigneeId}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  assigneeId: event.target.value,
                }))
              }
              className={clinicalSelectClassName}
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
          <Field label={appointmentText("Fällig am", "Срок", "Due at")}>
            <Input
              type="datetime-local"
              value={form.dueAt}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  dueAt: event.target.value,
                }))
              }
              className={clinicalInputClassName}
              required
            />
          </Field>
        </div>

        <Field label={tr.patients_notes}>
          <textarea
            value={form.notes}
            onChange={(event) =>
              setForm((current) => ({ ...current, notes: event.target.value }))
            }
            className={clinicalTextareaClassName}
            rows={5}
            placeholder={withEllipsis(tr.patients_notes)}
          />
        </Field>

        <div className="grid gap-3 md:grid-cols-2">
          <AppointmentClinicalToggleCard
            checked={form.requiresCaseUpdate}
            title={caseUpdateLabel}
            description={appointmentText(
              "Erzeugt einen separaten Checklistenschritt zur Übernahme in Fall oder Anamnese.",
              "Создаёт отдельный шаг чек-листа для переноса в кейс или анамнез.",
              "Creates a separate checklist step to apply the update to the case or anamnesis.",
            )}
            onChange={(checked) =>
              setForm((current) => ({
                ...current,
                requiresCaseUpdate: checked,
              }))
            }
          />
          <AppointmentClinicalToggleCard
            checked={form.requiresPatientFollowUp}
            title={patientFollowUpLabel}
            description={appointmentText(
              "Erzeugt einen separaten Schritt für die Rückmeldung an den Patienten nach der Datentriage.",
              "Добавляет отдельный шаг для связи с пациентом после триажа данных.",
              "Adds a separate step to contact the patient after data triage.",
            )}
            onChange={(checked) =>
              setForm((current) => ({
                ...current,
                requiresPatientFollowUp: checked,
              }))
            }
          />
        </div>

        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px]">
          <AppointmentClinicalToggleCard
            checked={form.createTask}
            title={appointmentText(
              "Zusätzliche Aufgabe erstellen",
              "Создать дополнительную задачу",
              "Create linked task",
            )}
            description={appointmentText(
              "Legt zusätzlich eine verknüpfte operative Aufgabe für den Verantwortlichen an.",
              "Дополнительно создаёт связанную операционную задачу для ответственного.",
              "Also creates a linked operational task for the assignee.",
            )}
            onChange={(checked) =>
              setForm((current) => ({
                ...current,
                createTask: checked,
              }))
            }
          />
          <Field
            label={appointmentText(
              "Aufgabenpriorität",
              "Приоритет задачи",
              "Task priority",
            )}
          >
            <NativeComboboxSelect
              value={form.taskPriority}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  taskPriority: event.target.value,
                }))
              }
              className={clinicalSelectClassName}
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
            type="button"
            variant="outline"
            size="sm"
            className="h-8 rounded-lg"
            disabled={!form.assigneeId}
            onClick={openChatDraft}
          >
            {appointmentText(
              "Chat-Entwurf öffnen",
              "Открыть черновик чата",
              "Open chat draft",
            )}
          </Button>
        </div>
      </AppointmentEditorSheet>
    </div>
  );
}

type AppointmentFindingsSectionProps = {
  detail: AppointmentDetail;
  checklist: ChecklistItem[];
  reminders: ReminderEntry[];
  tasks: TaskEntry[];
  assignees: StaffOption[];
  defaultAssigneeId: string;
  canCreateTasks: boolean;
  onRefresh: () => void;
  onError: (message: string) => void;
};

function AppointmentFindingsSection({
  detail,
  checklist,
  reminders,
  tasks,
  assignees,
  defaultAssigneeId,
  canCreateTasks,
  onRefresh,
  onError,
}: AppointmentFindingsSectionProps) {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const { staffGo } = useStaffNavigate();
  const buildDefaultForm = useCallback(
    (
      assigneeId = defaultAssigneeId,
      dueAt = shiftLocalDateTime(appointmentAnchorDateTime(detail), {
        days: 3,
      }),
      artifact: FindingsFollowUpArtifact = detail.doctor_id
        ? "arztbrief"
        : "written_findings",
    ) => blankFindingsFollowUpForm(assigneeId, dueAt, artifact),
    [defaultAssigneeId, detail],
  );
  const [form, setForm] = useState<FindingsFollowUpFormState>(() =>
    buildDefaultForm(),
  );
  const [submitBusy, setSubmitBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const openChecklistCount = checklist.filter((item) => !item.is_completed).length;
  const findingsStateLabel =
    openChecklistCount === 0 && checklist.length > 0
      ? appointmentText(
          "Follow-up bereit",
          "Фоллоу-ап готов",
          "Follow-up ready",
        )
      : appointmentText(
          `${openChecklistCount} offen`,
          `${openChecklistCount} открыто`,
          `${openChecklistCount} open`,
        );
  const followUpItemCount = reminders.length + tasks.length;
  const translationRequiredLabel = appointmentText(
    "Schriftliche Übersetzung erforderlich",
    "Нужен письменный перевод",
    "Written translation required",
  );
  const sendToPatientLabel = appointmentText(
    "Paket an Patienten senden",
    "Отправить пакет пациенту",
    "Send package to patient",
  );
  const findingsComposerTitle = appointmentText(
    "Befund-Follow-up anlegen",
    "Создать follow-up по заключениям",
    "Create findings follow-up",
  );

  useEffect(() => {
    setForm(buildDefaultForm());
    setSubmitBusy(false);
    setActionBusy("");
    setComposerOpen(false);
  }, [buildDefaultForm]);

  async function completeChecklistItem(itemId: string) {
    setActionBusy(`check:${itemId}`);
    try {
      await apiFetch<{ ok: boolean }>(
        `/appointments/${detail.id}/checklist/${itemId}/complete`,
        { method: "POST" },
      );
      onRefresh();
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : appointmentText(
              "Element konnte nicht abgeschlossen werden.",
              "Не удалось завершить элемент.",
              "Failed to complete item",
            ),
      );
    } finally {
      setActionBusy("");
    }
  }

  function openChatDraft() {
    if (!form.assigneeId) return;
    const assignee = assignees.find((item) => item.id === form.assigneeId);
    if (!assignee) return;

    const draftParts = [
      `Findings follow-up: ${detail.patient_pid} · ${detail.title}`,
      `Expected: ${findingsArtifactLabel(form.artifact)}`,
      detail.provider_name ? `Clinic: ${detail.provider_name}` : "",
      detail.doctor_name ? `Doctor: ${detail.doctor_name}` : "",
      form.translationRequired ? translationRequiredLabel : "",
      form.sendToPatient ? sendToPatientLabel : "",
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

    const artifactLabel = findingsArtifactLabel(form.artifact);
    const title = `${FINDINGS_FOLLOW_UP_PREFIX} ${artifactLabel}`;
    const description = [
      detail.provider_name ? `Clinic: ${detail.provider_name}` : "",
      detail.doctor_name ? `Doctor: ${detail.doctor_name}` : "",
      `Appointment: ${detail.patient_pid} · ${detail.title} · ${slotLabel(detail)}`,
      form.translationRequired ? translationRequiredLabel : "",
      form.sendToPatient ? sendToPatientLabel : "",
      form.notes.trim() || "",
    ]
      .filter(Boolean)
      .join("\n");
    const checklistItems = [
      `${FINDINGS_CHECKLIST_PREFIX} Await ${artifactLabel}`,
      `${FINDINGS_CHECKLIST_PREFIX} Review and categorize ${artifactLabel}`,
      form.translationRequired
        ? `${FINDINGS_CHECKLIST_PREFIX} Written translation completed`
        : "",
      form.sendToPatient
        ? `${FINDINGS_CHECKLIST_PREFIX} Findings package sent to patient`
        : "",
    ].filter(Boolean);

    setSubmitBusy(true);
    try {
      const requests: Array<Promise<unknown>> = [
        apiFetch<{ id: string }>(`/appointments/${detail.id}/reminders`, {
          method: "POST",
          body: JSON.stringify({
            user_id: form.assigneeId,
            remind_at: toRfc3339(form.dueAt),
            title,
            description,
          }),
        }),
        ...checklistItems.map((item) =>
          apiFetch<{ id: string }>(`/appointments/${detail.id}/checklist`, {
            method: "POST",
            body: JSON.stringify({
              phase: "followup",
              item_text: item,
            }),
          }),
        ),
      ];

      if (form.createTask && canCreateTasks) {
        requests.push(
          apiFetch<{ id: string }>("/tasks", {
            method: "POST",
            body: JSON.stringify({
              title,
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
          form.artifact,
        ),
      );
      setComposerOpen(false);
      onRefresh();
    } catch (error) {
      onError(error instanceof Error ? error.message : tr.common_failed_create);
    } finally {
      setSubmitBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Section
        title={appointmentText(
          "Arztbrief und schriftliche Befunde",
          "Arztbrief и письменные заключения",
          "Arztbrief and written findings",
        )}
        accessory={<CountBadge>{findingsStateLabel}</CountBadge>}
      >
        <p className="text-sm text-muted-foreground">
          {appointmentText(
            "Verfolgen Sie ausstehende Befunde, Übersetzungsbedarf und den Versand an Patienten direkt aus dem Termin-Kontext.",
            "Отслеживайте недостающие заключения, потребность в переводе и отправку пациенту прямо из контекста приёма.",
            "Track missing findings, translation needs and patient delivery directly from the appointment context.",
          )}
        </p>
        <div className="grid gap-3 md:grid-cols-3">
          <StatCard
            label={appointmentText("Checkliste", "Чек-лист", "Checklist")}
            value={checklist.length}
            description={
              checklist.length === 0
                ? appointmentText(
                    "Noch nicht gestartet",
                    "Ещё не запущен",
                    "Not started yet",
                  )
                : findingsStateLabel
            }
          />
          <StatCard
            label={appointmentText("Reminder", "Напоминания", "Reminders")}
            value={reminders.length}
            description={appointmentText(
              "Timing für Rückfragen, Übersetzung und Dokumentenhandling.",
              "Сроки для запросов, перевода и работы с документами.",
              "Timing for requests, translation and document handling.",
            )}
          />
          <StatCard
            label={appointmentText("Aufgaben", "Задачи", "Tasks")}
            value={tasks.length}
            description={appointmentText(
              "Operative Verantwortung für Anforderung, Übersetzung und Versand von Befunden.",
              "Операционная ответственность за запрос, перевод и отправку заключений.",
              "Operational ownership for requesting, translating and sending findings.",
            )}
          />
        </div>
      </Section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
        <div className="space-y-4">
          <Section
            title={appointmentText(
              "Follow-up-Checkliste",
              "Чек-лист follow-up",
              "Follow-up checklist",
            )}
            accessory={<CountBadge>{checklist.length}</CountBadge>}
          >
            {checklist.length === 0 ? (
              <EmptyCell>
                {appointmentText(
                  "Für diesen Termin wurde noch keine Befund-Checkliste angelegt.",
                  "Для этого приёма пока не создан чек-лист по заключениям.",
                  "No findings checklist has been created for this appointment yet.",
                )}
              </EmptyCell>
            ) : (
              <div className="space-y-2">
                {checklist.map((item) => (
                  <div
                    key={item.id}
                    className={cn(
                      "flex flex-col gap-3 md:flex-row md:items-start md:justify-between",
                      appointmentPreviewInfoCardClassName,
                    )}
                  >
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-foreground">
                        {item.item_text.replace(`${FINDINGS_CHECKLIST_PREFIX} `, "")}
                      </p>
                      <p className="text-[11.5px] uppercase tracking-[0.12em] text-muted-foreground">
                        {item.phase}
                      </p>
                    </div>
                    {item.is_completed ? (
                      <StatusBadge tone="success">
                        {appointmentText(
                          "Abgeschlossen",
                          "Завершено",
                          "Completed",
                        )}{" "}
                        {formatDateTimeLabel(item.completed_at)}
                      </StatusBadge>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-lg gap-1.5"
                        disabled={Boolean(actionBusy)}
                        onClick={() => void completeChecklistItem(item.id)}
                      >
                        {actionBusy === `check:${item.id}` ? (
                          <LoaderCircle className="size-4 animate-spin" />
                        ) : null}
                        {appointmentText("Abschließen", "Завершить", "Complete")}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section
            title={appointmentText(
              "Reminder und Aufgaben",
              "Напоминания и задачи",
              "Reminders and tasks",
            )}
            accessory={
              <div className="flex items-center gap-2">
                <CountBadge>{followUpItemCount}</CountBadge>
                <Button
                  type="button"
                  size="sm"
                  className="h-8 rounded-lg gap-1.5"
                  onClick={() => setComposerOpen(true)}
                >
                  {findingsComposerTitle}
                </Button>
              </div>
            }
          >
            {followUpItemCount === 0 ? (
              <EmptyCell>
                {appointmentText(
                  "Für diesen Termin gibt es noch keine Reminder oder Aufgaben im Befund-Follow-up.",
                  "Для этого приёма пока нет напоминаний или задач в follow-up по заключениям.",
                  "No reminders or tasks exist in this findings follow-up yet.",
                )}
              </EmptyCell>
            ) : (
              <div className="space-y-2">
                {reminders.map((item) => (
                  <div
                    key={item.id}
                    className={cn("space-y-2.5", appointmentPreviewInfoCardClassName)}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-foreground">
                          {item.title.replace(`${FINDINGS_FOLLOW_UP_PREFIX} `, "")}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {item.user_name} · {formatDateTimeLabel(item.remind_at)}
                        </p>
                      </div>
                      <CountBadge>
                        {appointmentText("Reminder", "Напоминание", "Reminder")}
                      </CountBadge>
                    </div>
                    {item.description ? (
                      <p className="whitespace-pre-line text-sm text-muted-foreground">
                        {item.description}
                      </p>
                    ) : null}
                  </div>
                ))}
                {tasks.map((task) => (
                  <div
                    key={task.id}
                    className={cn("space-y-2.5", appointmentPreviewInfoCardClassName)}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-foreground">
                          {task.title.replace(`${FINDINGS_FOLLOW_UP_PREFIX} `, "")}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {task.assigned_to_name}
                          {task.due_date
                            ? ` · ${formatDateTimeLabel(task.due_date)}`
                            : ""}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge status={task.status}>
                          {taskStatusLabel(task.status)}
                        </StatusBadge>
                        <CountBadge>{taskPriorityLabel(task.priority)}</CountBadge>
                      </div>
                    </div>
                    {task.description ? (
                      <p className="whitespace-pre-line text-sm text-muted-foreground">
                        {task.description}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
      </div>

      <AppointmentEditorSheet
        open={composerOpen}
        onOpenChange={(open) => {
          setComposerOpen(open);
          if (!open) {
            setForm(buildDefaultForm());
            setSubmitBusy(false);
          }
        }}
        title={findingsComposerTitle}
        description={appointmentText(
          "Steuern Sie Anforderung, Übersetzung und Versand von Befunden direkt aus dem Termin.",
          "Управляйте запросом, переводом и отправкой заключений прямо из приёма.",
          "Control the request, translation and delivery of findings directly from the appointment.",
        )}
        onSubmit={handleSubmit}
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-lg"
              onClick={() => setComposerOpen(false)}
            >
              {t.common_cancel}
            </Button>
            <Button
              type="submit"
              size="sm"
              className="h-8 rounded-lg gap-1.5"
              disabled={submitBusy || !form.assigneeId || !form.dueAt}
            >
              {submitBusy ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : null}
              {appointmentText(
                "Follow-up starten",
                "Запустить follow-up",
                "Start follow-up",
              )}
            </Button>
          </>
        }
      >
        <div
          className={cn("text-sm text-muted-foreground", appointmentSoftPanelClassName)}
        >
          {appointmentText(
            "Die erstellten Reminder, Aufgaben und Checklisteneinträge erscheinen sofort im klinischen Befundblock dieses Termins.",
            "Созданные напоминания, задачи и пункты чек-листа сразу появятся в клиническом блоке заключений этого приёма.",
            "Created reminders, tasks and checklist items appear immediately in this appointment's findings block.",
          )}
        </div>

        <Field
          label={appointmentText(
            "Erwartetes Dokument",
            "Ожидаемый документ",
            "Expected document",
          )}
        >
          <NativeComboboxSelect
            value={form.artifact}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                artifact: event.target.value as FindingsFollowUpArtifact,
              }))
            }
            className={clinicalSelectClassName}
          >
            <option value="arztbrief">Arztbrief</option>
            <option value="written_findings">Written findings</option>
            <option value="both">Both</option>
          </NativeComboboxSelect>
        </Field>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t.patients_assign_owner}>
            <NativeComboboxSelect
              value={form.assigneeId}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  assigneeId: event.target.value,
                }))
              }
              className={clinicalSelectClassName}
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
          <Field label={appointmentText("Fällig am", "Срок", "Due at")}>
            <Input
              type="datetime-local"
              value={form.dueAt}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  dueAt: event.target.value,
                }))
              }
              className={clinicalInputClassName}
              required
            />
          </Field>
        </div>

        <Field label={tr.patients_notes}>
          <textarea
            value={form.notes}
            onChange={(event) =>
              setForm((current) => ({ ...current, notes: event.target.value }))
            }
            className={clinicalTextareaClassName}
            rows={5}
            placeholder={withEllipsis(tr.patients_notes)}
          />
        </Field>

        <div className="grid gap-3 md:grid-cols-2">
          <AppointmentClinicalToggleCard
            checked={form.translationRequired}
            title={translationRequiredLabel}
            description={appointmentText(
              "Fügt einen separaten Schritt für die schriftliche Übersetzung hinzu.",
              "Добавляет отдельный шаг для письменного перевода.",
              "Adds a separate step for written translation.",
            )}
            onChange={(checked) =>
              setForm((current) => ({
                ...current,
                translationRequired: checked,
              }))
            }
          />
          <AppointmentClinicalToggleCard
            checked={form.sendToPatient}
            title={sendToPatientLabel}
            description={appointmentText(
              "Plant einen zusätzlichen Schritt für den Versand des Befundpakets an den Patienten.",
              "Планирует дополнительный шаг для отправки пакета заключений пациенту.",
              "Plans an additional step to send the findings package to the patient.",
            )}
            onChange={(checked) =>
              setForm((current) => ({
                ...current,
                sendToPatient: checked,
              }))
            }
          />
        </div>

        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px]">
          <AppointmentClinicalToggleCard
            checked={form.createTask}
            title={appointmentText(
              "Zusätzliche Aufgabe erstellen",
              "Создать дополнительную задачу",
              "Create linked task",
            )}
            description={appointmentText(
              "Legt zusätzlich eine verknüpfte operative Aufgabe für das Befund-Follow-up an.",
              "Дополнительно создаёт связанную операционную задачу для follow-up по заключениям.",
              "Also creates a linked operational task for findings follow-up.",
            )}
            onChange={(checked) =>
              setForm((current) => ({
                ...current,
                createTask: checked,
              }))
            }
          />
          <Field
            label={appointmentText(
              "Aufgabenpriorität",
              "Приоритет задачи",
              "Task priority",
            )}
          >
            <NativeComboboxSelect
              value={form.taskPriority}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  taskPriority: event.target.value,
                }))
              }
              className={clinicalSelectClassName}
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
            type="button"
            variant="outline"
            size="sm"
            className="h-8 rounded-lg"
            disabled={!form.assigneeId}
            onClick={openChatDraft}
          >
            {appointmentText(
              "Chat-Entwurf öffnen",
              "Открыть черновик чата",
              "Open chat draft",
            )}
          </Button>
        </div>
      </AppointmentEditorSheet>
    </div>
  );
}

export const MemoizedAppointmentIncomingDataSection = memo(
  AppointmentIncomingDataSection,
);
export const MemoizedAppointmentFindingsSection = memo(
  AppointmentFindingsSection,
);
