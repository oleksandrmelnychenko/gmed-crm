import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import {
  memo,
  useCallback,
  useEffect,
  useReducer,
  type FormEvent,
  type SetStateAction,
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
  checklistPhaseLabel,
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

type SectionStateAction<TState> =
  | { type: "patch"; value: Partial<TState> }
  | { type: "update"; updater: (state: TState) => TState };

function sectionStateReducer<TState>(
  state: TState,
  action: SectionStateAction<TState>,
): TState {
  switch (action.type) {
    case "patch":
      return { ...state, ...action.value };
    case "update":
      return action.updater(state);
    default:
      return state;
  }
}

function createSectionFieldAction<TState, K extends keyof TState>(
  field: K,
  value: SetStateAction<TState[K]>,
): SectionStateAction<TState> {
  return {
    type: "update",
    updater: (state) => {
      const currentValue = state[field];
      const nextValue =
        typeof value === "function"
          ? (value as (current: TState[K]) => TState[K])(currentValue)
          : value;

      if (Object.is(currentValue, nextValue)) return state;
      return { ...state, [field]: nextValue };
    },
  };
}

type IncomingDataSectionState = {
  form: IncomingDataFormState;
  submitBusy: boolean;
  actionBusy: string;
  composerOpen: boolean;
};

type FindingsFollowUpSectionState = {
  form: FindingsFollowUpFormState;
  submitBusy: boolean;
  actionBusy: string;
  composerOpen: boolean;
};

function useAppointmentIncomingDataSectionContent({
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
  const [{ form, submitBusy, actionBusy, composerOpen }, dispatchIncomingState] =
    useReducer(
      sectionStateReducer<IncomingDataSectionState>,
      undefined,
      () => ({
        form: buildDefaultForm(),
        submitBusy: false,
        actionBusy: "",
        composerOpen: false,
      }),
    );
  const setForm = (value: SetStateAction<IncomingDataFormState>) =>
    dispatchIncomingState(
      createSectionFieldAction<IncomingDataSectionState, "form">("form", value),
    );
  const setSubmitBusy = (value: SetStateAction<boolean>) =>
    dispatchIncomingState(
      createSectionFieldAction<IncomingDataSectionState, "submitBusy">(
        "submitBusy",
        value,
      ),
    );
  const setActionBusy = (value: SetStateAction<string>) =>
    dispatchIncomingState(
      createSectionFieldAction<IncomingDataSectionState, "actionBusy">(
        "actionBusy",
        value,
      ),
    );
  const setComposerOpen = (value: SetStateAction<boolean>) =>
    dispatchIncomingState(
      createSectionFieldAction<IncomingDataSectionState, "composerOpen">(
        "composerOpen",
        value,
      ),
    );
  const openChecklistCount = checklist.filter((item) => !item.is_completed).length;
  const intakeStateLabel =
    openChecklistCount === 0 && checklist.length > 0
      ? appointmentText("appointments_intake_clear")
      : appointmentText("appointments_open_count", {
          count: openChecklistCount,
        });
  const followUpItemCount = reminders.length + tasks.length;
  const caseUpdateLabel = appointmentText("appointments_case_update_required");
  const patientFollowUpLabel = appointmentText("appointments_patient_follow_up_required");
  const intakeComposerTitle = appointmentText("appointments_create_intake_follow_up");

  useEffect(() => {
    dispatchIncomingState({
      type: "patch",
      value: {
        form: buildDefaultForm(),
        submitBusy: false,
        actionBusy: "",
        composerOpen: false,
      },
    });
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
          : appointmentText("appointments_failed_to_complete_item"),
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
      appointmentText("appointments_incoming_data_chat_title", {
        patientPid: detail.patient_pid,
        title: detail.title,
      }),
      appointmentText("appointments_description_source", {
        source: incomingDataSourceLabel(form.source),
      }),
      appointmentText("appointments_description_category", {
        category: incomingDataCategoryLabel(form.category),
      }),
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

    const title = `${INCOMING_DATA_PREFIX} ${appointmentText(
      "appointments_incoming_data_followup_title",
      {
        category: incomingDataCategoryLabel(form.category),
        source: incomingDataSourceLabel(form.source),
      },
    )}`;
    const description = [
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
      appointmentText("appointments_description_appointment", {
        patientPid: detail.patient_pid,
        title: detail.title,
        slot: slotLabel(detail),
      }),
      appointmentText("appointments_description_source", {
        source: incomingDataSourceLabel(form.source),
      }),
      appointmentText("appointments_description_category", {
        category: incomingDataCategoryLabel(form.category),
      }),
      form.requiresCaseUpdate ? caseUpdateLabel : "",
      form.requiresPatientFollowUp ? patientFollowUpLabel : "",
      form.notes.trim() || "",
    ]
      .filter(Boolean)
      .join("\n");
    const checklistItems = [
      `${INCOMING_DATA_CHECKLIST_PREFIX} ${appointmentText("appointments_incoming_data_checklist_review")}`,
      form.requiresCaseUpdate
        ? `${INCOMING_DATA_CHECKLIST_PREFIX} ${appointmentText("appointments_incoming_data_checklist_apply_update")}`
        : "",
      form.requiresPatientFollowUp
        ? `${INCOMING_DATA_CHECKLIST_PREFIX} ${appointmentText("appointments_incoming_data_checklist_patient_followup")}`
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
        title={appointmentText("appointments_incoming_medical_data")}
        accessory={<CountBadge>{intakeStateLabel}</CountBadge>}
      >
        <p className="text-sm text-muted-foreground">
          {appointmentText("appointments_capture_new_medical_updates_from_patients_doctors_interp")}
        </p>
        <div className="grid gap-3 md:grid-cols-3">
          <StatCard
            label={appointmentText("appointments_checklist")}
            value={checklist.length}
            description={
              checklist.length === 0
                ? appointmentText("appointments_not_started_yet")
                : intakeStateLabel
            }
          />
          <StatCard
            label={appointmentText("appointments_reminders")}
            value={reminders.length}
            description={appointmentText("appointments_timing_for_triage_and_processing")}
          />
          <StatCard
            label={appointmentText("appointments_tasks")}
            value={tasks.length}
            description={appointmentText("appointments_operational_ownership_for_categorization_and_case_update")}
          />
        </div>
      </Section>

      <div className="space-y-4">
        <Section
          title={appointmentText("appointments_intake_checklist")}
          accessory={<CountBadge>{checklist.length}</CountBadge>}
        >
          {checklist.length === 0 ? (
            <EmptyCell>
              {appointmentText("appointments_no_intake_checklist_has_been_created_for_this_appointmen")}
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
                      {checklistPhaseLabel(item.phase)}
                    </p>
                  </div>
                  {item.is_completed ? (
                    <StatusBadge tone="success">
                      {appointmentText("appointments_completed")}{" "}
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
                      {appointmentText("appointments_complete")}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section
          title={appointmentText("appointments_reminders_and_tasks")}
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
              {appointmentText("appointments_no_reminders_or_tasks_exist_in_this_intake_flow_yet")}
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
                      {appointmentText("appointments_reminder")}
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
        description={appointmentText("appointments_create_reminders_checklist_items_and_if_needed_a_linked")}
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
              {appointmentText("appointments_start_intake_flow")}
            </Button>
          </>
        }
      >
        <div
          className={cn("text-sm text-muted-foreground", appointmentSoftPanelClassName)}
        >
          {appointmentText("appointments_all_changes_are_saved_directly_on_the_appointment_and_sh")}
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
              <option value="patient">{incomingDataSourceLabel("patient")}</option>
              <option value="doctor">{incomingDataSourceLabel("doctor")}</option>
              <option value="clinic">{incomingDataSourceLabel("clinic")}</option>
              <option value="interpreter">
                {incomingDataSourceLabel("interpreter")}
              </option>
              <option value="external_lab">
                {incomingDataSourceLabel("external_lab")}
              </option>
              <option value="other">{incomingDataSourceLabel("other")}</option>
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
              <option value="medical_update">
                {incomingDataCategoryLabel("medical_update")}
              </option>
              <option value="diagnosis">{incomingDataCategoryLabel("diagnosis")}</option>
              <option value="medication">
                {incomingDataCategoryLabel("medication")}
              </option>
              <option value="symptom">{incomingDataCategoryLabel("symptom")}</option>
              <option value="lab_result">
                {incomingDataCategoryLabel("lab_result")}
              </option>
              <option value="imaging">{incomingDataCategoryLabel("imaging")}</option>
              <option value="recommendation">
                {incomingDataCategoryLabel("recommendation")}
              </option>
              <option value="risk_flag">
                {incomingDataCategoryLabel("risk_flag")}
              </option>
              <option value="other">{incomingDataCategoryLabel("other")}</option>
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
          <Field label={appointmentText("appointments_due_at")}>
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
            description={appointmentText("appointments_creates_a_separate_checklist_step_to_apply_the_update_to")}
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
            description={appointmentText("appointments_adds_a_separate_step_to_contact_the_patient_after_data_t")}
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
            title={appointmentText("appointments_create_linked_task")}
            description={appointmentText("appointments_also_creates_a_linked_operational_task_for_the_assignee")}
            onChange={(checked) =>
              setForm((current) => ({
                ...current,
                createTask: checked,
              }))
            }
          />
          <Field
            label={appointmentText("appointments_task_priority")}
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
            {appointmentText("appointments_open_chat_draft")}
          </Button>
        </div>
      </AppointmentEditorSheet>
    </div>
  );
}

function AppointmentIncomingDataSection(...args: Parameters<typeof useAppointmentIncomingDataSectionContent>) {
  return useAppointmentIncomingDataSectionContent(...args);
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

function useAppointmentFindingsSectionContent({
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
  const [{ form, submitBusy, actionBusy, composerOpen }, dispatchFindingsState] =
    useReducer(
      sectionStateReducer<FindingsFollowUpSectionState>,
      undefined,
      () => ({
        form: buildDefaultForm(),
        submitBusy: false,
        actionBusy: "",
        composerOpen: false,
      }),
    );
  const setForm = (value: SetStateAction<FindingsFollowUpFormState>) =>
    dispatchFindingsState(
      createSectionFieldAction<FindingsFollowUpSectionState, "form">("form", value),
    );
  const setSubmitBusy = (value: SetStateAction<boolean>) =>
    dispatchFindingsState(
      createSectionFieldAction<FindingsFollowUpSectionState, "submitBusy">(
        "submitBusy",
        value,
      ),
    );
  const setActionBusy = (value: SetStateAction<string>) =>
    dispatchFindingsState(
      createSectionFieldAction<FindingsFollowUpSectionState, "actionBusy">(
        "actionBusy",
        value,
      ),
    );
  const setComposerOpen = (value: SetStateAction<boolean>) =>
    dispatchFindingsState(
      createSectionFieldAction<FindingsFollowUpSectionState, "composerOpen">(
        "composerOpen",
        value,
      ),
    );
  const openChecklistCount = checklist.filter((item) => !item.is_completed).length;
  const findingsStateLabel =
    openChecklistCount === 0 && checklist.length > 0
      ? appointmentText("appointments_follow_up_ready")
      : appointmentText("appointments_open_count", {
          count: openChecklistCount,
        });
  const followUpItemCount = reminders.length + tasks.length;
  const translationRequiredLabel = appointmentText("appointments_written_translation_required");
  const sendToPatientLabel = appointmentText("appointments_send_package_to_patient");
  const findingsComposerTitle = appointmentText("appointments_create_findings_follow_up");

  useEffect(() => {
    dispatchFindingsState({
      type: "patch",
      value: {
        form: buildDefaultForm(),
        submitBusy: false,
        actionBusy: "",
        composerOpen: false,
      },
    });
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
          : appointmentText("appointments_failed_to_complete_item"),
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
      appointmentText("appointments_findings_chat_title", {
        patientPid: detail.patient_pid,
        title: detail.title,
      }),
      appointmentText("appointments_findings_chat_expected", {
        artifact: findingsArtifactLabel(form.artifact),
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
      appointmentText("appointments_description_appointment", {
        patientPid: detail.patient_pid,
        title: detail.title,
        slot: slotLabel(detail),
      }),
      form.translationRequired ? translationRequiredLabel : "",
      form.sendToPatient ? sendToPatientLabel : "",
      form.notes.trim() || "",
    ]
      .filter(Boolean)
      .join("\n");
    const checklistItems = [
      `${FINDINGS_CHECKLIST_PREFIX} ${appointmentText("appointments_findings_checklist_await", {
        artifact: artifactLabel,
      })}`,
      `${FINDINGS_CHECKLIST_PREFIX} ${appointmentText("appointments_findings_checklist_review", {
        artifact: artifactLabel,
      })}`,
      form.translationRequired
        ? `${FINDINGS_CHECKLIST_PREFIX} ${appointmentText("appointments_findings_checklist_translation_completed")}`
        : "",
      form.sendToPatient
        ? `${FINDINGS_CHECKLIST_PREFIX} ${appointmentText("appointments_findings_checklist_sent_to_patient")}`
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
        title={appointmentText("appointments_arztbrief_and_written_findings")}
        accessory={<CountBadge>{findingsStateLabel}</CountBadge>}
      >
        <p className="text-sm text-muted-foreground">
          {appointmentText("appointments_track_missing_findings_translation_needs_and_patient_del")}
        </p>
        <div className="grid gap-3 md:grid-cols-3">
          <StatCard
            label={appointmentText("appointments_checklist")}
            value={checklist.length}
            description={
              checklist.length === 0
                ? appointmentText("appointments_not_started_yet")
                : findingsStateLabel
            }
          />
          <StatCard
            label={appointmentText("appointments_reminders")}
            value={reminders.length}
            description={appointmentText("appointments_timing_for_requests_translation_and_document_handling")}
          />
          <StatCard
            label={appointmentText("appointments_tasks")}
            value={tasks.length}
            description={appointmentText("appointments_operational_ownership_for_requesting_translating_and_sen")}
          />
        </div>
      </Section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
        <div className="space-y-4">
          <Section
            title={appointmentText("appointments_follow_up_checklist")}
            accessory={<CountBadge>{checklist.length}</CountBadge>}
          >
            {checklist.length === 0 ? (
              <EmptyCell>
                {appointmentText("appointments_no_findings_checklist_has_been_created_for_this_appointm")}
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
                        {checklistPhaseLabel(item.phase)}
                      </p>
                    </div>
                    {item.is_completed ? (
                      <StatusBadge tone="success">
                        {appointmentText("appointments_completed")}{" "}
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
                        {appointmentText("appointments_complete")}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section
            title={appointmentText("appointments_reminders_and_tasks")}
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
                {appointmentText("appointments_no_reminders_or_tasks_exist_in_this_findings_follow_up_y")}
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
                        {appointmentText("appointments_reminder")}
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
        description={appointmentText("appointments_control_the_request_translation_and_delivery_of_findings")}
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
              {appointmentText("appointments_start_follow_up")}
            </Button>
          </>
        }
      >
        <div
          className={cn("text-sm text-muted-foreground", appointmentSoftPanelClassName)}
        >
          {appointmentText("appointments_created_reminders_tasks_and_checklist_items_appear_immed")}
        </div>

        <Field
          label={appointmentText("appointments_expected_document")}
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
            <option value="arztbrief">{findingsArtifactLabel("arztbrief")}</option>
            <option value="written_findings">
              {findingsArtifactLabel("written_findings")}
            </option>
            <option value="both">{findingsArtifactLabel("both")}</option>
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
          <Field label={appointmentText("appointments_due_at")}>
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
            description={appointmentText("appointments_adds_a_separate_step_for_written_translation")}
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
            description={appointmentText("appointments_plans_an_additional_step_to_send_the_findings_package_to")}
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
            title={appointmentText("appointments_create_linked_task")}
            description={appointmentText("appointments_also_creates_a_linked_operational_task_for_findings_foll")}
            onChange={(checked) =>
              setForm((current) => ({
                ...current,
                createTask: checked,
              }))
            }
          />
          <Field
            label={appointmentText("appointments_task_priority")}
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
            {appointmentText("appointments_open_chat_draft")}
          </Button>
        </div>
      </AppointmentEditorSheet>
    </div>
  );
}

function AppointmentFindingsSection(...args: Parameters<typeof useAppointmentFindingsSectionContent>) {
  return useAppointmentFindingsSectionContent(...args);
}

export const MemoizedAppointmentIncomingDataSection = memo(
  AppointmentIncomingDataSection,
);
export const MemoizedAppointmentFindingsSection = memo(
  AppointmentFindingsSection,
);
