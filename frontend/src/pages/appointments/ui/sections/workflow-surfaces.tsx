import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import {
  memo,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Languages,
  LoaderCircle,
  Plus,
} from "lucide-react";

import { AdminInlineMetric } from "@/components/admin-page-patterns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Banner,
  CountBadge,
  ListItem,
  Section,
  tokens,
} from "@/components/ui-shell";
import { apiFetch } from "@/lib/api";
import {
  fetchPatientInterpreterHistory,
  fetchInterpreterSuggestions,
  setInterpreterPreference,
  type InterpreterHistoryItem,
  type InterpreterPreference,
  type InterpreterSuggestion,
} from "@/lib/api/clinical";
import { formatUiText, useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { buildAppointmentWorkflowSummary } from "@/pages/appointments/model/selectors";
import { InterpreterSuggestionsPanel } from "@/pages/appointments/ui/sections/interpreter-suggestions-panel";
import {
  appointmentSelectControlClassName,
  appointmentSlateInputClassName,
  appointmentTextareaControlClassName,
} from "@/pages/appointments/appearance/surface-appearance";
import { shiftLocalDateTime } from "@/pages/appointments/model/date-time";
import {
  blankChecklistForm,
  blankReminderForm,
  blankTaskForm,
  defaultCompletionPlan,
  statusActionKey,
} from "@/pages/appointments/model/form-factories";
import {
  appointmentText,
  followUpPresetLabel,
  followUpPresetTitle,
  reportApprovalLabel,
  responseLabel,
  roleLabel,
  statusLabel,
  taskPriorityLabel,
  taskStatusLabel,
} from "@/pages/appointments/model/labels";
import {
  formatAppointmentDateTimeLabel as formatDateTimeLabel,
} from "@/pages/appointments/model/runtime-formatters";
import {
  recurringOccurrenceLabel,
  recurringStatusTargetsForScope,
} from "@/pages/appointments/model/recurrence";
import {
  appointmentAnchorDateTime,
  buildTaskDefaultDueDate,
  toRfc3339,
} from "@/pages/appointments/model/workflow-helpers";
import type {
  AppointmentDetail,
  AppointmentPermissions,
  AppointmentRecurringActionScope,
  AppointmentStatus,
  ChecklistFormState,
  ChecklistItem,
  HandoffStakeholder,
  InterpreterOption,
  InterpreterResponse,
  ReminderEntry,
  ReminderFormState,
  ReportSummary,
  StaffOption,
  TaskEntry,
  TaskFormState,
} from "@/pages/appointments/model/types";
import {
  CHECKLIST_PHASES,
  FOLLOW_UP_PRESETS,
  INTERPRETER_RESPONSE_OPTIONS,
  STATUS_OPTIONS,
  TASK_PRIORITY_OPTIONS,
  TASK_STATUS_OPTIONS,
} from "@/pages/appointments/model/constants";
import {
  AppointmentEditorSheet,
  EmptyState,
  Field,
} from "@/pages/appointments/ui/shared/workspace-primitives";

const selectClassName = appointmentSelectControlClassName;
const textareaClassName = appointmentTextareaControlClassName;
const workflowInlineBadgeClassName =
  "inline-flex h-6 shrink-0 items-center rounded-full border border-border/60 bg-muted/25 px-2.5 text-[11px] font-medium text-foreground";

function checklistPhaseLabel(phase: string) {
  switch (phase) {
    case "preparation":
      return appointmentText("appointments_preparation");
    case "execution":
      return appointmentText("appointments_execution");
    case "followup":
      return appointmentText("appointments_follow_up_2");
    default:
      return appointmentText("appointments_unknown_phase");
  }
}

function withEllipsis(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  return /[.…]$/u.test(normalized) ? normalized : `${normalized}…`;
}

function WorkflowSectionAccessory({
  count,
  actionLabel,
  onAction,
  disabled,
}: {
  count?: ReactNode;
  actionLabel?: ReactNode;
  onAction?: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {count ? <CountBadge>{count}</CountBadge> : null}
      {actionLabel && onAction ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 rounded-lg gap-1.5"
          disabled={disabled}
          onClick={onAction}
        >
          <Plus className="size-3.5" />
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}

function WorkflowSheetBody({ children }: { children: ReactNode }) {
  return <div className="space-y-4 rounded-xl p-4">{children}</div>;
}

function WorkflowSheetSection({
  title,
  children,
}: {
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-xl border border-border/50 bg-card/40 p-3.5">
      <h3 className="inline-flex items-center gap-2 text-[13px] font-semibold tracking-tight text-foreground">
        <span aria-hidden className="size-1.5 rounded-full bg-primary/70" />
        <span>{title}</span>
      </h3>
      {children}
    </section>
  );
}

type AppointmentWorkflowTabProps = {
  detail: AppointmentDetail;
  detailReport: ReportSummary | null;
  staff: StaffOption[];
  interpreters: InterpreterOption[];
  currentUserId?: string;
  permissions: AppointmentPermissions;
  handoffStakeholders: HandoffStakeholder[];
  followUpAssigneeId: string;
  setFollowUpAssigneeId: (value: string) => void;
  openChecklistCount: number;
  openTaskCount: number;
  pendingReminderCount: number;
  interpreterReportReady: boolean;
  completionWarnings: string[];
  checklistItems: ChecklistItem[];
  reminders: ReminderEntry[];
  tasks: TaskEntry[];
  taskAssignableStaff: StaffOption[];
  editAppointmentSection?: ReactNode;
  onRefresh: () => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
};

type AppointmentWorkflowOverviewSectionProps = {
  checklistProgressValue: string;
  completionWarnings: string[];
  interpreterGateDescription: string;
  interpreterGateValue: string;
  workflowSummary: ReturnType<typeof buildAppointmentWorkflowSummary>;
};

function AppointmentWorkflowOverviewSection({
  checklistProgressValue,
  completionWarnings,
  interpreterGateDescription,
  interpreterGateValue,
  workflowSummary,
}: AppointmentWorkflowOverviewSectionProps) {
  return (
    <Section
      title={appointmentText("appointments_operational_overview")}
      accessory={<CountBadge>{workflowSummary.openIssueCount}</CountBadge>}
    >
      <div className="grid grid-flow-col auto-cols-fr overflow-hidden rounded-xl border border-border px-3 pb-3 pt-4 [&>article:not(:last-child)_.admin-inline-metric-separator]:xl:block">
        <AdminInlineMetric
          icon={AlertTriangle}
          label={appointmentText("appointments_open_issues_2")}
          value={workflowSummary.openIssueCount}
          description={appointmentText("appointments_checklist_reminder_and_task_items_still_requiring_follow")}
          tone="amber"
        />
        <AdminInlineMetric
          icon={CheckCircle2}
          label={appointmentText("appointments_checklist_progress")}
          value={checklistProgressValue}
          description={appointmentText("appointments_completed_versus_total_appointment_bound_workflow_steps")}
          tone="emerald"
        />
        <AdminInlineMetric
          icon={Clock3}
          label={appointmentText("appointments_follow_up_queue")}
          value={workflowSummary.followUpQueueCount}
          description={appointmentText("appointments_open_tasks_plus_pending_reminders")}
          tone="sky"
        />
        <AdminInlineMetric
          icon={Languages}
          label={appointmentText("appointments_interpreter_gate")}
          value={interpreterGateValue}
          description={interpreterGateDescription}
          tone="slate"
        />
      </div>

      {completionWarnings.length > 0 ? (
        <Banner tone="warning" withIcon>
          <div className="space-y-1">
            <p className="font-medium">
              {appointmentText("appointments_operational_blockers_remain_before_closure")}
            </p>
            {completionWarnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        </Banner>
      ) : null}
    </Section>
  );
}

function AppointmentWorkflowTab({
  detail,
  detailReport,
  staff,
  interpreters,
  currentUserId,
  permissions,
  handoffStakeholders,
  followUpAssigneeId,
  setFollowUpAssigneeId,
  openChecklistCount,
  openTaskCount,
  pendingReminderCount,
  interpreterReportReady,
  completionWarnings,
  checklistItems,
  reminders,
  tasks,
  taskAssignableStaff,
  editAppointmentSection,
  onRefresh,
  onError,
  onNotice,
}: AppointmentWorkflowTabProps) {
  const showCompletionSection = permissions.canManageStatus;
  const showStatusSection = permissions.canManageStatus;
  const showScheduleSection = permissions.canEditSchedule;
  const showInterpreterSection =
    permissions.canAssignInterpreter ||
    (permissions.canRespondToAssignment && detail.interpreter_id === currentUserId);
  const showChecklistSection = permissions.canManageChecklist;
  const showReminderSection = permissions.canViewReminders;
  const showTaskSection = permissions.canViewTasks;

  const workflowSummary = useMemo(
    () =>
      buildAppointmentWorkflowSummary({
        showCompletionSection,
        showStatusSection,
        showScheduleSection,
        showInterpreterSection,
        showChecklistSection,
        showReminderSection,
        showTaskSection,
        checklistTotalCount: checklistItems.length,
        openChecklistCount,
        openTaskCount,
        pendingReminderCount,
        interpreterRequired: Boolean(detail.interpreter_id),
        interpreterReady: interpreterReportReady,
      }),
    [
      checklistItems.length,
      detail.interpreter_id,
      interpreterReportReady,
      openChecklistCount,
      openTaskCount,
      pendingReminderCount,
      showChecklistSection,
      showCompletionSection,
      showInterpreterSection,
      showReminderSection,
      showScheduleSection,
      showStatusSection,
      showTaskSection,
    ],
  );

  const showTransitionLane = workflowSummary.transitionSurfaceCount > 0;
  const showLogisticsLane = workflowSummary.logisticsSurfaceCount > 0;
  const showBacklogLane = workflowSummary.backlogSurfaceCount > 0;

  const checklistProgressValue = checklistItems.length
    ? `${workflowSummary.checklistCompletedCount}/${checklistItems.length}`
    : appointmentText("appointments_none");
  const interpreterGateValue =
    workflowSummary.interpreterGate === "not_required"
      ? appointmentText("appointments_not_required")
      : workflowSummary.interpreterGate === "ready"
        ? appointmentText("appointments_approved")
        : appointmentText("appointments_pending_2");
  const interpreterGateDescription =
    workflowSummary.interpreterGate === "not_required"
      ? appointmentText("appointments_no_interpreter_linked_to_this_appointment")
      : detailReport
        ? reportApprovalLabel(detailReport.approval_status)
        : appointmentText("appointments_report_or_approval_is_still_pending");

  return (
    <>
      <AppointmentWorkflowOverviewSection
        checklistProgressValue={checklistProgressValue}
        completionWarnings={completionWarnings}
        interpreterGateDescription={interpreterGateDescription}
        interpreterGateValue={interpreterGateValue}
        workflowSummary={workflowSummary}
      />
      {showTransitionLane ? (
        <div>
          <div className="grid gap-4 xl:grid-cols-2">
            {showCompletionSection ? (
              <div className="xl:col-span-2">
                <MemoizedAppointmentCompletionSection
                  detail={detail}
                  detailReport={detailReport}
                  handoffStakeholders={handoffStakeholders}
                  openChecklistCount={openChecklistCount}
                  openTaskCount={openTaskCount}
                  pendingReminderCount={pendingReminderCount}
                  interpreterReportReady={interpreterReportReady}
                  followUpAssigneeId={followUpAssigneeId}
                  setFollowUpAssigneeId={setFollowUpAssigneeId}
                  showStatusToggle={showStatusSection}
                  onRefresh={onRefresh}
                  onError={onError}
                  onNotice={onNotice}
                />
              </div>
            ) : null}
            {showStatusSection && !showCompletionSection ? (
              <div className="xl:col-span-2">
                <MemoizedAppointmentStatusSection
                  detail={detail}
                  openChecklistCount={openChecklistCount}
                  onError={onError}
                />
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {showLogisticsLane ? (
        <div>
          <div className="grid gap-4">
            {showScheduleSection ? editAppointmentSection : null}
            {showInterpreterSection ? (
              <MemoizedAppointmentInterpreterSection
                detail={detail}
                interpreters={interpreters}
                currentUserId={currentUserId}
                canAssign={permissions.canAssignInterpreter}
                canRespond={permissions.canRespondToAssignment}
                onRefresh={onRefresh}
                onError={onError}
              />
            ) : null}
          </div>
        </div>
      ) : null}

      {showBacklogLane ? (
        <div>
          <div className="space-y-4">
            {showChecklistSection ? (
              <MemoizedAppointmentChecklistSection
                detail={detail}
                items={checklistItems}
                onRefresh={onRefresh}
                onError={onError}
              />
            ) : null}

            {showReminderSection || showTaskSection ? (
              <div className="grid gap-4">
                {showReminderSection ? (
                  <MemoizedAppointmentRemindersSection
                    detail={detail}
                    reminders={reminders}
                    staff={staff}
                    canManageReminders={permissions.canManageReminders}
                    onRefresh={onRefresh}
                    onError={onError}
                  />
                ) : null}
                {showTaskSection ? (
                  <MemoizedAppointmentTasksSection
                    detail={detail}
                    tasks={tasks}
                    assignableStaff={taskAssignableStaff}
                    canCreateTasks={permissions.canCreateTasks}
                    onRefresh={onRefresh}
                    onError={onError}
                  />
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

type InterpreterSectionState = {
  assignInterpreterId: string;
  assignmentSheetOpen: boolean;
  busyAction: string;
  suggestions: InterpreterSuggestion[];
  suggestionsLoading: boolean;
  suggestionsError: string | null;
  history: InterpreterHistoryItem[];
  historyLoading: boolean;
  historyError: string | null;
  preferenceSavingId: string | null;
  interpreterContextNonce: number;
};

type InterpreterSectionAction =
  | { type: "patch"; value: Partial<InterpreterSectionState> }
  | { type: "suggestions-start" }
  | { type: "suggestions-disabled" }
  | { type: "suggestions-success"; items: InterpreterSuggestion[] }
  | { type: "suggestions-error"; message: string }
  | { type: "history-start" }
  | { type: "history-disabled" }
  | { type: "history-success"; items: InterpreterHistoryItem[] }
  | { type: "history-error"; message: string }
  | { type: "interpreter-context-bump" };

function createInterpreterSectionState(detail: AppointmentDetail): InterpreterSectionState {
  return {
    assignInterpreterId: detail.interpreter_id ?? "",
    assignmentSheetOpen: false,
    busyAction: "",
    suggestions: [],
    suggestionsLoading: false,
    suggestionsError: null,
    history: [],
    historyLoading: false,
    historyError: null,
    preferenceSavingId: null,
    interpreterContextNonce: 0,
  };
}

function interpreterSectionReducer(
  state: InterpreterSectionState,
  action: InterpreterSectionAction,
): InterpreterSectionState {
  switch (action.type) {
    case "patch":
      return { ...state, ...action.value };
    case "suggestions-start":
      return { ...state, suggestionsLoading: true, suggestionsError: null };
    case "suggestions-disabled":
      return { ...state, suggestions: [], suggestionsLoading: false, suggestionsError: null };
    case "suggestions-success":
      return { ...state, suggestions: action.items, suggestionsLoading: false };
    case "suggestions-error":
      return {
        ...state,
        suggestions: [],
        suggestionsError: action.message,
        suggestionsLoading: false,
      };
    case "history-start":
      return { ...state, historyLoading: true, historyError: null };
    case "history-disabled":
      return { ...state, history: [], historyLoading: false, historyError: null };
    case "history-success":
      return { ...state, history: action.items, historyLoading: false };
    case "history-error":
      return {
        ...state,
        history: [],
        historyError: action.message,
        historyLoading: false,
      };
    case "interpreter-context-bump":
      return {
        ...state,
        interpreterContextNonce: state.interpreterContextNonce + 1,
      };
    default:
      return state;
  }
}

function AppointmentInterpreterSection({
  detail,
  interpreters,
  currentUserId,
  canAssign,
  canRespond,
  onRefresh,
  onError,
}: {
  detail: AppointmentDetail;
  interpreters: InterpreterOption[];
  currentUserId?: string;
  canAssign: boolean;
  canRespond: boolean;
  onRefresh: () => void;
  onError: (message: string) => void;
}) {
  const { t } = useLang();
  const [
    {
      assignInterpreterId,
      busyAction,
      suggestions,
      suggestionsLoading,
      suggestionsError,
      history,
      historyLoading,
      historyError,
      preferenceSavingId,
      interpreterContextNonce,
      assignmentSheetOpen,
    },
    dispatchInterpreterState,
  ] = useReducer(interpreterSectionReducer, detail, createInterpreterSectionState);

  useEffect(() => {
    dispatchInterpreterState({
      type: "patch",
      value: {
        assignInterpreterId: detail.interpreter_id ?? "",
        assignmentSheetOpen: false,
        busyAction: "",
      },
    });
  }, [detail.id, detail.interpreter_id]);

  useEffect(() => {
    if (!canAssign || detail.is_blocked) {
      dispatchInterpreterState({ type: "suggestions-disabled" });
      return;
    }

    let cancelled = false;
    dispatchInterpreterState({ type: "suggestions-start" });

    fetchInterpreterSuggestions(detail.id)
      .then((items) => {
        if (cancelled) return;
        dispatchInterpreterState({ type: "suggestions-success", items });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        dispatchInterpreterState({
          type: "suggestions-error",
          message:
            error instanceof Error
              ? error.message
              : appointmentText("appointments_failed_to_load_interpreter_suggestions"),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [canAssign, detail.id, detail.is_blocked, interpreterContextNonce]);

  useEffect(() => {
    if (!canAssign || detail.is_blocked || !detail.patient_id) {
      dispatchInterpreterState({ type: "history-disabled" });
      return;
    }

    let cancelled = false;
    dispatchInterpreterState({ type: "history-start" });

    fetchPatientInterpreterHistory(detail.patient_id)
      .then((items) => {
        if (cancelled) return;
        dispatchInterpreterState({ type: "history-success", items });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        dispatchInterpreterState({
          type: "history-error",
          message:
            error instanceof Error
              ? error.message
              : appointmentText("appointments_error_load_interpreter_history"),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [canAssign, detail.is_blocked, detail.patient_id, interpreterContextNonce]);

  async function handleSetInterpreterPreference(
    interpreterId: string,
    preference: InterpreterPreference,
  ) {
    if (!detail.patient_id) return;
    dispatchInterpreterState({
      type: "patch",
      value: { preferenceSavingId: interpreterId },
    });
    try {
      await setInterpreterPreference(detail.patient_id, {
        interpreter_id: interpreterId,
        preference,
      });
      dispatchInterpreterState({ type: "interpreter-context-bump" });
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : appointmentText("appointments_error_save_interpreter_preference"),
      );
    } finally {
      dispatchInterpreterState({
        type: "patch",
        value: { preferenceSavingId: null },
      });
    }
  }

  async function handleAssignInterpreter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!assignInterpreterId) return;
    dispatchInterpreterState({ type: "patch", value: { busyAction: "assign" } });
    try {
      await apiFetch<{ ok: boolean }>(
        `/appointments/${detail.id}/assign-interpreter`,
        {
          method: "POST",
          body: JSON.stringify({ interpreter_id: assignInterpreterId }),
        },
      );
      dispatchInterpreterState({
        type: "patch",
        value: { assignmentSheetOpen: false },
      });
      onRefresh();
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : appointmentText("appointments_failed_to_assign_interpreter"),
      );
    } finally {
      dispatchInterpreterState({ type: "patch", value: { busyAction: "" } });
    }
  }

  async function handleInterpreterResponse(response: InterpreterResponse) {
    dispatchInterpreterState({
      type: "patch",
      value: { busyAction: `response:${response}` },
    });
    try {
      await apiFetch<{ ok: boolean }>(
        `/appointments/${detail.id}/interpreter-response`,
        {
          method: "POST",
          body: JSON.stringify({ response }),
        },
      );
      onRefresh();
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : appointmentText("appointments_failed_to_submit_response"),
      );
    } finally {
      dispatchInterpreterState({ type: "patch", value: { busyAction: "" } });
    }
  }

  return (
    <>
      {canAssign && !detail.is_blocked ? (
        <Section
          title={appointmentText("appointments_interpreter_assignment")}
          accessory={
            <WorkflowSectionAccessory
              count={detail.interpreter_id ? 1 : 0}
              actionLabel={appointmentText("appointments_assign_interpreter")}
              onAction={() =>
                dispatchInterpreterState({
                  type: "patch",
                  value: { assignmentSheetOpen: true },
                })
              }
            />
          }
        >
          {detail.interpreter_id ? (
            <ListItem>
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium text-foreground">
                  {detail.interpreter_name ?? t.common_not_set}
                </p>
                <p className={tokens.text.muted}>
                  {responseLabel(detail.interpreter_response ?? "pending")}
                </p>
              </div>
            </ListItem>
          ) : (
            <EmptyState
              text={appointmentText("appointments_no_interpreter_linked_to_this_appointment")}
            />
          )}

          <AppointmentEditorSheet
            open={assignmentSheetOpen}
            onOpenChange={(open) =>
              dispatchInterpreterState({
                type: "patch",
                value: { assignmentSheetOpen: open },
              })
            }
            title={appointmentText("appointments_interpreter_assignment")}
            maxWidthClassName="sm:max-w-[760px]"
            onSubmit={handleAssignInterpreter}
            footer={
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-lg"
                  onClick={() =>
                    dispatchInterpreterState({
                      type: "patch",
                      value: { assignmentSheetOpen: false },
                    })
                  }
                >
                  {t.common_cancel}
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  className="h-8 rounded-lg gap-1.5"
                  disabled={!assignInterpreterId || busyAction === "assign"}
                >
                  {busyAction === "assign" ? (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  ) : null}
                  {appointmentText("appointments_assign_interpreter")}
                </Button>
              </>
            }
          >
            <WorkflowSheetBody>
              <WorkflowSheetSection
                title={appointmentText("appointments_interpreter_assignment")}
              >
            <Field compact label={t.role_interpreter}>
              <NativeComboboxSelect
                value={assignInterpreterId}
                  onChange={(event) =>
                    dispatchInterpreterState({
                      type: "patch",
                      value: { assignInterpreterId: event.target.value },
                    })
                  }
                className={selectClassName}
              >
                <option value="">{t.common_not_set}</option>
                {interpreters.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name} · {roleLabel(member.role)}
                  </option>
                ))}
              </NativeComboboxSelect>
            </Field>
              </WorkflowSheetSection>
            <InterpreterSuggestionsPanel
              suggestions={suggestions}
              selectedInterpreterId={assignInterpreterId}
              loading={suggestionsLoading}
              error={suggestionsError ?? undefined}
              history={history}
              historyLoading={historyLoading}
              historyError={historyError ?? undefined}
              preferenceSavingId={preferenceSavingId}
              onSelect={(value) =>
                dispatchInterpreterState({
                  type: "patch",
                  value: { assignInterpreterId: value },
                })
              }
              onSetPreference={(interpreterId, preference) =>
                void handleSetInterpreterPreference(interpreterId, preference)
              }
            />
            </WorkflowSheetBody>
          </AppointmentEditorSheet>
        </Section>
      ) : null}
      {canRespond && detail.interpreter_id === currentUserId ? (
        <Section title={appointmentText("appointments_interpreter_response")}>
          <div className="flex flex-wrap gap-2">
            {INTERPRETER_RESPONSE_OPTIONS.map((value) => (
              <Button
                key={value}
                variant={
                  detail.interpreter_response === value ? "default" : "outline"
                }
                disabled={Boolean(busyAction)}
                onClick={() => void handleInterpreterResponse(value)}
              >
                {busyAction === `response:${value}` ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : null}
                {responseLabel(value)}
              </Button>
            ))}
          </div>
        </Section>
      ) : null}
    </>
  );
}

type ChecklistSectionState = {
  form: ChecklistFormState;
  sheetOpen: boolean;
  submitBusy: boolean;
  completingId: string;
};

type ChecklistSectionAction =
  | { type: "patch"; value: Partial<ChecklistSectionState> }
  | { type: "update"; updater: (state: ChecklistSectionState) => ChecklistSectionState };

const CHECKLIST_SECTION_INITIAL_STATE: ChecklistSectionState = {
  form: blankChecklistForm(),
  sheetOpen: false,
  submitBusy: false,
  completingId: "",
};

function checklistSectionReducer(
  state: ChecklistSectionState,
  action: ChecklistSectionAction,
): ChecklistSectionState {
  switch (action.type) {
    case "patch":
      return { ...state, ...action.value };
    case "update":
      return action.updater(state);
    default:
      return state;
  }
}

function createChecklistFieldAction<K extends keyof ChecklistSectionState>(
  field: K,
  value: SetStateAction<ChecklistSectionState[K]>,
): ChecklistSectionAction {
  return {
    type: "update",
    updater: (state) => {
      const currentValue = state[field];
      const nextValue =
        typeof value === "function"
          ? (value as (current: ChecklistSectionState[K]) => ChecklistSectionState[K])(
              currentValue,
            )
          : value;

      if (Object.is(currentValue, nextValue)) return state;
      return { ...state, [field]: nextValue };
    },
  };
}

function AppointmentChecklistSection({
  detail,
  items,
  onRefresh,
  onError,
}: {
  detail: AppointmentDetail;
  items: ChecklistItem[];
  onRefresh: () => void;
  onError: (message: string) => void;
}) {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const [{ form, sheetOpen, submitBusy, completingId }, dispatchChecklistState] =
    useReducer(checklistSectionReducer, CHECKLIST_SECTION_INITIAL_STATE);
  const setForm = (value: SetStateAction<ChecklistFormState>) =>
    dispatchChecklistState(createChecklistFieldAction("form", value));
  const setSheetOpen = (value: SetStateAction<boolean>) =>
    dispatchChecklistState(createChecklistFieldAction("sheetOpen", value));
  const setSubmitBusy = (value: SetStateAction<boolean>) =>
    dispatchChecklistState(createChecklistFieldAction("submitBusy", value));
  const setCompletingId = (value: SetStateAction<string>) =>
    dispatchChecklistState(createChecklistFieldAction("completingId", value));

  useEffect(() => {
    dispatchChecklistState({
      type: "patch",
      value: {
        form: blankChecklistForm(),
        sheetOpen: false,
        submitBusy: false,
        completingId: "",
      },
    });
  }, [detail.id]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitBusy(true);
    try {
      await apiFetch<{ id: string }>(`/appointments/${detail.id}/checklist`, {
        method: "POST",
        body: JSON.stringify({
          phase: form.phase,
          item_text: form.itemText.trim(),
        }),
      });
      setForm(blankChecklistForm());
      setSheetOpen(false);
      onRefresh();
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : appointmentText("appointments_failed_to_add_checklist_item"),
      );
    } finally {
      setSubmitBusy(false);
    }
  }

  async function handleComplete(itemId: string) {
    setCompletingId(itemId);
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
      setCompletingId("");
    }
  }

  function handleSheetOpenChange(open: boolean) {
    setSheetOpen(open);
    if (!open) {
      setForm(blankChecklistForm());
      setSubmitBusy(false);
    }
  }

  return (
    <>
    <Section
      title={appointmentText("appointments_checklist")}
      accessory={
        <WorkflowSectionAccessory
          count={items.length}
          actionLabel={appointmentText("appointments_add_checklist_item")}
          onAction={() => setSheetOpen(true)}
        />
      }
    >
      <div className="space-y-3">
        {items.length === 0 ? (
          <EmptyState
            text={appointmentText("appointments_no_workflow_steps_exist_for_this_appointment_yet")}
          />
        ) : (
          items.map((item) => (
            <ListItem key={item.id}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {item.item_text}
                  </p>
                  <p className={cn("mt-1", tokens.text.eyebrow)}>
                    {checklistPhaseLabel(item.phase)}
                  </p>
                </div>
                {item.is_completed ? (
                  <span
                    className={cn(
                      workflowInlineBadgeClassName,
                      "text-emerald-700",
                    )}
                  >
                    {t.common_completed} {formatDateTimeLabel(item.completed_at)}
                  </span>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={Boolean(completingId)}
                    onClick={() => void handleComplete(item.id)}
                  >
                    {completingId === item.id ? (
                      <LoaderCircle className="size-4 animate-spin" />
                    ) : null}
                    {appointmentText("appointments_mark_complete")}
                  </Button>
                )}
              </div>
            </ListItem>
          ))
        )}
      </div>
    </Section>

    <AppointmentEditorSheet
      open={sheetOpen}
      onOpenChange={handleSheetOpenChange}
      title={appointmentText("appointments_add_checklist_item")}
      maxWidthClassName="sm:max-w-[760px]"
      onSubmit={handleSubmit}
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 rounded-lg"
            onClick={() => handleSheetOpenChange(false)}
          >
            {t.common_cancel}
          </Button>
          <Button
            type="submit"
            size="sm"
            className="h-8 rounded-lg gap-1.5"
            disabled={submitBusy || !form.itemText.trim()}
          >
            {submitBusy ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
            {appointmentText("appointments_add_checklist_item")}
          </Button>
        </>
      }
    >
      <WorkflowSheetBody>
        <WorkflowSheetSection
          title={appointmentText("appointments_add_checklist_item")}
        >
          <div className="grid gap-4 md:grid-cols-[180px_minmax(0,1fr)]">
            <Field compact label={t.orders_phase}>
              <NativeComboboxSelect
                value={form.phase}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    phase: event.target.value,
                  }))
                }
                className={selectClassName}
              >
                {CHECKLIST_PHASES.map((phase) => (
                  <option key={phase} value={phase}>
                    {checklistPhaseLabel(phase)}
                  </option>
                ))}
              </NativeComboboxSelect>
            </Field>
            <Field compact label={tr.appointments_title_col}>
              <Input
                value={form.itemText}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    itemText: event.target.value,
                  }))
                }
                placeholder={withEllipsis(tr.appointments_title_col)}
                className={appointmentSlateInputClassName}
                required
              />
            </Field>
          </div>
        </WorkflowSheetSection>
      </WorkflowSheetBody>
    </AppointmentEditorSheet>
    </>
  );
}

function AppointmentRemindersSection({
  detail,
  reminders,
  staff,
  canManageReminders,
  onRefresh,
  onError,
}: {
  detail: AppointmentDetail;
  reminders: ReminderEntry[];
  staff: StaffOption[];
  canManageReminders: boolean;
  onRefresh: () => void;
  onError: (message: string) => void;
}) {
  const { t } = useLang();
  const [form, setForm] = useState<ReminderFormState>(() => blankReminderForm());
  const [sheetOpen, setSheetOpen] = useState(false);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [completingId, setCompletingId] = useState("");

  const resetReminderState = () => {
    setForm(blankReminderForm());
    setSheetOpen(false);
    setSubmitBusy(false);
    setCompletingId("");
  };

  useEffect(() => {
    resetReminderState();
  }, [detail.id]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitBusy(true);
    try {
      await apiFetch<{ id: string }>(`/appointments/${detail.id}/reminders`, {
        method: "POST",
        body: JSON.stringify({
          user_id: form.userId,
          remind_at: toRfc3339(form.remindAt),
          title: form.title.trim(),
          description: form.description.trim() || null,
        }),
      });
      setForm(blankReminderForm());
      setSheetOpen(false);
      onRefresh();
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : appointmentText("appointments_failed_to_add_reminder"),
      );
    } finally {
      setSubmitBusy(false);
    }
  }

  async function handleComplete(reminderId: string) {
    setCompletingId(reminderId);
    try {
      await apiFetch<{ ok: boolean }>(
        `/appointments/${detail.id}/reminders/${reminderId}/complete`,
        { method: "POST" },
      );
      onRefresh();
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : appointmentText("appointments_failed_to_complete_reminder"),
      );
    } finally {
      setCompletingId("");
    }
  }

  function handleSheetOpenChange(open: boolean) {
    setSheetOpen(open);
    if (!open) {
      setForm(blankReminderForm());
      setSubmitBusy(false);
    }
  }

  return (
    <>
    <Section
      title={appointmentText("appointments_reminders_2")}
      accessory={
        <WorkflowSectionAccessory
          count={reminders.length}
          actionLabel={
            canManageReminders ? t.appointments_add_reminder : undefined
          }
          onAction={canManageReminders ? () => setSheetOpen(true) : undefined}
        />
      }
    >
      <div className="space-y-3">
        {reminders.length === 0 ? (
          <EmptyState
            text={appointmentText("appointments_no_reminders_exist_for_this_appointment_yet")}
          />
        ) : (
          reminders.map((item) => (
            <ListItem key={item.id}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {item.title}
                  </p>
                  <p className={cn("mt-1", tokens.text.muted)}>
                  {item.user_name} · {formatDateTimeLabel(item.remind_at)}
                  </p>
                  {item.description ? (
                    <p className="mt-2 text-sm text-muted-foreground">
                      {item.description}
                    </p>
                  ) : null}
                </div>
                {item.is_completed ? (
                  <span
                    className={cn(
                      workflowInlineBadgeClassName,
                      "text-emerald-700",
                    )}
                  >
                    {appointmentText("appointments_completed")}{" "}
                    {formatDateTimeLabel(item.completed_at)}
                  </span>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={Boolean(completingId)}
                    onClick={() => void handleComplete(item.id)}
                  >
                    {completingId === item.id ? (
                      <LoaderCircle className="size-4 animate-spin" />
                    ) : null}
                    {appointmentText("appointments_mark_complete")}
                  </Button>
                )}
              </div>
            </ListItem>
          ))
        )}
      </div>
    </Section>

    {canManageReminders ? (
      <AppointmentEditorSheet
        open={sheetOpen}
        onOpenChange={handleSheetOpenChange}
        title={t.appointments_add_reminder}
        maxWidthClassName="sm:max-w-[760px]"
        onSubmit={handleSubmit}
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-lg"
              onClick={() => handleSheetOpenChange(false)}
            >
              {t.common_cancel}
            </Button>
            <Button
              type="submit"
              size="sm"
              className="h-8 rounded-lg gap-1.5"
              disabled={
                submitBusy ||
                !form.userId ||
                !form.remindAt ||
                !form.title.trim()
              }
            >
              {submitBusy ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : null}
              {t.appointments_add_reminder}
            </Button>
          </>
        }
      >
        <WorkflowSheetBody>
          <WorkflowSheetSection title={t.appointments_add_reminder}>
        <div className="grid gap-4 md:grid-cols-2">
          <Field compact label={t.patients_assign_owner}>
            <NativeComboboxSelect
              value={form.userId}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  userId: event.target.value,
                }))
              }
              className={selectClassName}
              required
            >
              <option value="">{t.common_not_set}</option>
              {staff.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name} · {roleLabel(member.role)}
                </option>
              ))}
            </NativeComboboxSelect>
          </Field>
          <Field compact label={t.appointments_date}>
            <Input
              type="datetime-local"
              value={form.remindAt}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  remindAt: event.target.value,
                }))
              }
              className={appointmentSlateInputClassName}
              required
            />
          </Field>
          <Field compact label={t.appointments_title_col}>
            <Input
              value={form.title}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  title: event.target.value,
                }))
              }
              className={appointmentSlateInputClassName}
              required
            />
          </Field>
          <Field compact label={t.providers_service_desc}>
            <textarea
              value={form.description}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
              className={textareaClassName}
              rows={3}
            />
          </Field>
        </div>
          </WorkflowSheetSection>
        </WorkflowSheetBody>
      </AppointmentEditorSheet>
    ) : null}
    </>
  );
}

type AppointmentCompletionReadinessGridProps = {
  casesStatusLabel: string;
  detail: AppointmentDetail;
  detailReport: ReportSummary | null;
  interpreterLabel: string;
  interpreterReportReady: boolean;
  openChecklistCount: number;
  openTaskCount: number;
  pendingReminderCount: number;
};

function AppointmentCompletionReadinessGrid({
  casesStatusLabel,
  detail,
  detailReport,
  interpreterLabel,
  interpreterReportReady,
  openChecklistCount,
  openTaskCount,
  pendingReminderCount,
}: AppointmentCompletionReadinessGridProps) {
  return (
    <div className="mt-4 grid grid-flow-col auto-cols-fr overflow-hidden rounded-xl border border-border px-3 pb-3 pt-4 [&>article:not(:last-child)_.admin-inline-metric-separator]:xl:block">
      <AdminInlineMetric
        icon={CheckCircle2}
        label={casesStatusLabel}
        value={
          openChecklistCount === 0
            ? appointmentText("appointments_ready")
            : appointmentText("appointments_open_count", {
                count: openChecklistCount,
              })
        }
        description={
          openChecklistCount === 0
            ? appointmentText("appointments_no_pending_checklist_items")
            : appointmentText("appointments_finish_outstanding_preparation_or_follow_up_steps")
        }
        tone={openChecklistCount === 0 ? "emerald" : "amber"}
      />
      <AdminInlineMetric
        icon={AlertTriangle}
        label={appointmentText("appointments_tasks")}
        value={
          openTaskCount === 0
            ? appointmentText("appointments_ready")
            : appointmentText("appointments_open_count", {
                count: openTaskCount,
              })
        }
        description={
          openTaskCount === 0
            ? appointmentText("appointments_no_open_operational_tasks")
            : appointmentText("appointments_resolve_active_pm_interpreter_or_concierge_tasks")
        }
        tone={openTaskCount === 0 ? "emerald" : "amber"}
      />
      <AdminInlineMetric
        icon={Clock3}
        label={appointmentText("appointments_reminders_2")}
        value={appointmentText("appointments_pending_reminders_count", {
          count: pendingReminderCount,
        })}
        description={
          pendingReminderCount === 0
            ? appointmentText("appointments_no_outstanding_reminders")
            : appointmentText("appointments_pending_reminders_stay_active_after_closure")
        }
        tone={pendingReminderCount === 0 ? "emerald" : "amber"}
      />
      <AdminInlineMetric
        icon={Languages}
        label={interpreterLabel}
        value={
          !detail.interpreter_id
            ? appointmentText("appointments_not_required")
            : interpreterReportReady
              ? appointmentText("appointments_approved")
              : appointmentText("appointments_pending_2")
        }
        description={
          !detail.interpreter_id
            ? appointmentText("appointments_no_interpreter_linked")
            : detailReport
              ? detailReport.approval_status
              : appointmentText("appointments_no_report_submitted_yet")
        }
        tone={!detail.interpreter_id || interpreterReportReady ? "emerald" : "amber"}
      />
    </div>
  );
}

function AppointmentCompletionSection({
  detail,
  detailReport,
  handoffStakeholders,
  openChecklistCount,
  openTaskCount,
  pendingReminderCount,
  interpreterReportReady,
  followUpAssigneeId,
  setFollowUpAssigneeId,
  showStatusToggle = false,
  onRefresh,
  onError,
  onNotice,
}: {
  detail: AppointmentDetail;
  detailReport: ReportSummary | null;
  handoffStakeholders: HandoffStakeholder[];
  openChecklistCount: number;
  openTaskCount: number;
  pendingReminderCount: number;
  interpreterReportReady: boolean;
  followUpAssigneeId: string;
  setFollowUpAssigneeId: (value: string) => void;
  showStatusToggle?: boolean;
  onRefresh: () => void;
  onError: (message: string) => void;
  onNotice: (notice: string) => void;
}) {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const [completionPlan, setCompletionPlan] = useState<Record<string, boolean>>(
    () => defaultCompletionPlan(),
  );
  const [completionSheetOpen, setCompletionSheetOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<"" | "complete" | "follow-up">("");
  const selectedCompletionPresetCount = useMemo(() => {
    let count = 0;
    for (const preset of FOLLOW_UP_PRESETS) {
      if (completionPlan[preset.id]) {
        count += 1;
      }
    }
    return count;
  }, [completionPlan]);

  useEffect(() => {
    setCompletionPlan(defaultCompletionPlan());
    setCompletionSheetOpen(false);
    setBusyAction("");
  }, [detail.id, detail.status]);

  async function handleCompleteOnly() {
    setBusyAction("complete");
    try {
      await apiFetch<{ ok: boolean }>(`/appointments/${detail.id}/status`, {
        method: "POST",
        body: JSON.stringify({ status: "completed" }),
      });
      setCompletionSheetOpen(false);
      onRefresh();
    } catch (error) {
      onError(error instanceof Error ? error.message : tr.common_failed_update);
    } finally {
      setBusyAction("");
    }
  }

  async function handleCompleteWithFollowUp() {
    const selectedPresets = FOLLOW_UP_PRESETS.filter(
      (preset) => completionPlan[preset.id],
    );
    if (selectedPresets.length > 0 && !followUpAssigneeId) return;

    setBusyAction("follow-up");
    let completed = false;
    try {
      await apiFetch<{ ok: boolean }>(`/appointments/${detail.id}/status`, {
        method: "POST",
        body: JSON.stringify({ status: "completed" }),
      });
      completed = true;

      if (selectedPresets.length > 0) {
        const anchor = appointmentAnchorDateTime(detail);
        await Promise.all(
          selectedPresets.map((preset) => {
            const remindAt = shiftLocalDateTime(anchor, {
              days: "offsetDays" in preset ? preset.offsetDays : undefined,
              months:
                "offsetMonths" in preset ? preset.offsetMonths : undefined,
            });
            return apiFetch<{ id: string }>(`/appointments/${detail.id}/reminders`, {
              method: "POST",
              body: JSON.stringify({
                user_id: followUpAssigneeId,
                remind_at: toRfc3339(remindAt),
                title: followUpPresetTitle(preset.id),
                description: formatUiText(t.appointments_auto_planned_completion, {
                  patientPid: detail.patient_pid,
                  title: detail.title,
                }),
              }),
            });
          }),
        );
      }

      onNotice(
        selectedPresets.length > 0
          ? appointmentText("appointments_follow_up_reminders_scheduled_notice", {
              count: selectedPresets.length,
            })
          : appointmentText("appointments_appointment_completed"),
      );
      setCompletionSheetOpen(false);
      onRefresh();
    } catch (error) {
      if (completed) {
        onError(
          error instanceof Error
            ? appointmentText("appointments_follow_up_scheduling_failed_notice", {
                message: error.message,
              })
            : tr.common_error,
        );
        onRefresh();
      } else {
        onError(error instanceof Error ? error.message : tr.common_failed_update);
      }
    } finally {
      setBusyAction("");
    }
  }

  const canCompleteAppointment =
    detail.status !== "completed" && detail.status !== "cancelled";

  return (
    <>
    <Section
      title={appointmentText("appointments_completion_readiness")}
      accessory={
        <WorkflowSectionAccessory
          actionLabel={
            canCompleteAppointment ? t.appointments_complete_and_schedule : undefined
          }
          onAction={
            canCompleteAppointment
              ? () => setCompletionSheetOpen(true)
              : undefined
          }
          disabled={Boolean(busyAction)}
        />
      }
    >
      <AppointmentCompletionReadinessGrid
        casesStatusLabel={t.cases_status}
        detail={detail}
        detailReport={detailReport}
        interpreterLabel={tr.role_interpreter}
        interpreterReportReady={interpreterReportReady}
        openChecklistCount={openChecklistCount}
        openTaskCount={openTaskCount}
        pendingReminderCount={pendingReminderCount}
      />
      {showStatusToggle ? (
        <div className="mt-4">
          <div className="mb-4 flex items-center gap-2" aria-hidden>
            <span className="h-px flex-1 bg-gradient-to-r from-transparent via-border to-border" />
            <span className="size-1.5 rounded-full bg-orange-400" />
            <span className="size-1.5 rounded-full bg-orange-300" />
            <span className="size-1.5 rounded-full bg-orange-200" />
            <span className="h-px flex-1 bg-gradient-to-r from-border via-border to-transparent" />
          </div>
          <div className="mb-2 text-xs font-semibold text-muted-foreground">
            {t.users_status}
          </div>
          <AppointmentStatusToggleControl
            detail={detail}
            openChecklistCount={openChecklistCount}
            onError={onError}
          />
        </div>
      ) : null}
      {canCompleteAppointment ? (
        <AppointmentEditorSheet
          open={completionSheetOpen}
          onOpenChange={setCompletionSheetOpen}
          title={appointmentText("appointments_completion_readiness")}
          footer={
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-lg"
              onClick={() => setCompletionSheetOpen(false)}
            >
              {t.common_cancel}
            </Button>
          }
        >
          <Field compact label={tr.patients_assign_owner}>
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
          <div className="flex flex-wrap gap-2">
            {FOLLOW_UP_PRESETS.map((preset) => (
              <Button
                key={preset.id}
                type="button"
                variant={completionPlan[preset.id] ? "default" : "outline"}
                size="sm"
                onClick={() =>
                  setCompletionPlan((current) => ({
                    ...current,
                    [preset.id]: !current[preset.id],
                  }))
                }
              >
                {followUpPresetLabel(preset.id)}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={Boolean(busyAction)}
              onClick={handleCompleteOnly}
            >
              {t.appointments_complete_only}
            </Button>
            <Button
              type="button"
              disabled={
                Boolean(busyAction) ||
                (selectedCompletionPresetCount > 0 && !followUpAssigneeId)
              }
              onClick={handleCompleteWithFollowUp}
            >
              {busyAction === "follow-up" ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : null}
              {t.appointments_complete_and_schedule}
            </Button>
          </div>
        </AppointmentEditorSheet>
      ) : null}
    </Section>
    </>
  );
}

function AppointmentStatusToggleControl({
  detail,
  openChecklistCount,
  onRefresh,
  onError,
  className,
}: {
  detail: AppointmentDetail;
  openChecklistCount: number;
  onRefresh?: () => void;
  onError: (message: string) => void;
  className?: string;
}) {
  const { t } = useLang();
  const [statusRecurrenceScope, setStatusRecurrenceScope] =
    useState<AppointmentRecurringActionScope>("single");
  const [busyAction, setBusyAction] = useState("");
  const [optimisticStatus, setOptimisticStatus] = useState<{
    appointmentId: string;
    status: AppointmentStatus;
  } | null>(null);
  const visibleStatus =
    optimisticStatus?.appointmentId === detail.id
      ? optimisticStatus.status
      : detail.status;
  const selectedRecurringStatusTargets = useMemo(
    () =>
      detail.recurrence_frequency
        ? recurringStatusTargetsForScope(detail, statusRecurrenceScope)
        : [
            {
              id: detail.id,
              date: detail.date,
              status: visibleStatus,
              recurrence_index: detail.recurrence_index,
              open_checklist_count: openChecklistCount,
            },
          ],
    [detail, openChecklistCount, statusRecurrenceScope, visibleStatus],
  );
  const completionScopeBlockers = useMemo(
    () =>
      selectedRecurringStatusTargets.filter(
        (item) =>
          !["completed", "cancelled"].includes(item.status) &&
          item.open_checklist_count > 0,
      ),
    [selectedRecurringStatusTargets],
  );

  useEffect(() => {
    setStatusRecurrenceScope("single");
    setBusyAction("");
  }, [detail.id, detail.recurrence_frequency]);

  async function handleStatusChange(
    status: AppointmentStatus,
    recurrenceScope: AppointmentRecurringActionScope = "single",
  ) {
    if (status === visibleStatus) return;

    const nextBusyAction = statusActionKey(detail.id, status, recurrenceScope);
    const previousStatus = visibleStatus;
    setOptimisticStatus({ appointmentId: detail.id, status });
    setBusyAction(nextBusyAction);
    try {
      await apiFetch<{ ok: boolean }>(`/appointments/${detail.id}/status`, {
        method: "POST",
        body: JSON.stringify({
          status,
          recurrence_scope: recurrenceScope,
        }),
      });
      onRefresh?.();
    } catch (error) {
      setOptimisticStatus({ appointmentId: detail.id, status: previousStatus });
      onError(
        error instanceof Error
          ? error.message
          : appointmentText("appointments_failed_to_change_status"),
      );
    } finally {
      setBusyAction("");
    }
  }

  return (
    <div className={cn("space-y-4", className)}>
      {detail.recurrence_frequency ? (
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <p className={tokens.text.muted}>
            {t.appointments_scope_bulk_status_hint}
          </p>
          <div className="w-full md:w-[240px]">
            <Field label={t.appointments_scope_apply_status}>
              <NativeComboboxSelect
                value={statusRecurrenceScope}
                onChange={(event) =>
                  setStatusRecurrenceScope(
                    event.target.value as AppointmentRecurringActionScope,
                  )
                }
                className={selectClassName}
              >
                <option value="single">{t.appointments_scope_single}</option>
                <option value="following">{t.appointments_scope_following}</option>
                <option value="series">{t.appointments_scope_series}</option>
              </NativeComboboxSelect>
            </Field>
          </div>
        </div>
      ) : null}
      <div className="pb-1">
        <div
          className="grid w-full grid-cols-5 gap-1 rounded-full border border-border/60 bg-muted/30 p-1"
          role="group"
          aria-label={t.users_status}
        >
          {STATUS_OPTIONS.map((status) => {
            const recurrenceScope = detail.recurrence_frequency
              ? statusRecurrenceScope
              : "single";
            const nextBusyAction = statusActionKey(detail.id, status, recurrenceScope);
            const active = visibleStatus === status;
            const statusOptionLabel =
              detail.recurrence_frequency && status === "cancelled"
                ? statusRecurrenceScope === "following"
                  ? t.appointments_cancel_this_and_following
                  : statusRecurrenceScope === "series"
                    ? t.appointments_cancel_whole_series
                    : appointmentText("appointments_cancel_this_occurrence")
                : statusLabel(status);
            return (
              <button
                key={status}
                type="button"
                title={statusOptionLabel}
                aria-pressed={active}
                disabled={Boolean(busyAction)}
                onClick={() => handleStatusChange(status, recurrenceScope)}
                className={cn(
                  "relative inline-flex h-10 min-w-0 items-center justify-center rounded-full px-2 text-[13px] font-semibold transition-[background-color,color,box-shadow] duration-150 disabled:cursor-not-allowed disabled:opacity-70",
                  active
                    ? "bg-orange-500 text-white shadow-sm"
                    : "text-foreground hover:bg-card",
                )}
              >
                {busyAction === nextBusyAction ? (
                  <LoaderCircle className="absolute left-2 size-3.5 animate-spin" />
                ) : null}
                <span className="min-w-0 truncate">{statusOptionLabel}</span>
              </button>
            );
          })}
        </div>
      </div>
      {detail.recurrence_frequency ? (
        <div className="space-y-3">
          <p className={tokens.text.muted}>
            {t.appointments_scope_targets}{" "}
            <span className="font-semibold text-foreground">
              {selectedRecurringStatusTargets.length}
            </span>{" "}
            {selectedRecurringStatusTargets.length === 1
              ? t.appointments_active_occurrence
              : t.appointments_active_occurrences}
            .
          </p>
          {completionScopeBlockers.length > 0 ? (
            <Banner tone="warning" withIcon>
              {t.appointments_workflow_completion_scope_blocked}{" "}
              {completionScopeBlockers.length}{" "}
              {completionScopeBlockers.length === 1
                ? t.appointments_workflow_occurrence
                : t.appointments_workflow_occurrences}
              :{" "}
              {completionScopeBlockers
                .map((item) => recurringOccurrenceLabel(item, t))
                .join("; ")}
            </Banner>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function AppointmentStatusSection({
  detail,
  openChecklistCount,
  onRefresh,
  onError,
}: {
  detail: AppointmentDetail;
  openChecklistCount: number;
  onRefresh?: () => void;
  onError: (message: string) => void;
}) {
  const { t } = useLang();

  return (
    <Section title={t.users_status}>
      <AppointmentStatusToggleControl
        detail={detail}
        openChecklistCount={openChecklistCount}
        onRefresh={onRefresh}
        onError={onError}
      />
    </Section>
  );
}

type AppointmentTasksSectionProps = {
  detail: AppointmentDetail;
  tasks: TaskEntry[];
  assignableStaff: StaffOption[];
  canCreateTasks: boolean;
  onRefresh: () => void;
  onError: (message: string) => void;
};

function AppointmentTasksSection(props: AppointmentTasksSectionProps) {
  const resetKey = [
    props.detail.id,
    props.detail.interpreter_id ?? "",
    props.detail.owner_user_id ?? "",
    props.assignableStaff[0]?.id ?? "",
    buildTaskDefaultDueDate(props.detail),
  ].join("|");

  return <AppointmentTasksSectionContent key={resetKey} {...props} />;
}

function AppointmentTasksSectionContent({
  detail,
  tasks,
  assignableStaff,
  canCreateTasks,
  onRefresh,
  onError,
}: AppointmentTasksSectionProps) {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const [form, setForm] = useState<TaskFormState>(() =>
    blankTaskForm(
      detail.interpreter_id ?? detail.owner_user_id ?? assignableStaff[0]?.id ?? "",
      buildTaskDefaultDueDate(detail),
    ),
  );
  const [sheetOpen, setSheetOpen] = useState(false);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState("");

  function resetTaskForm() {
    setForm(
      blankTaskForm(
        detail.interpreter_id ??
          detail.owner_user_id ??
          assignableStaff[0]?.id ??
          "",
        buildTaskDefaultDueDate(detail),
      ),
    );
  }

  function handleSheetOpenChange(open: boolean) {
    setSheetOpen(open);
    if (!open) {
      resetTaskForm();
      setSubmitBusy(false);
    }
  }

  async function handleTaskSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitBusy(true);
    try {
      await apiFetch<{ id: string }>("/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: form.title.trim(),
          description: form.description.trim() || null,
          assigned_to: form.assignedTo,
          patient_id: detail.patient_id,
          order_id: detail.order_id,
          appointment_id: detail.id,
          due_date: form.dueDate ? toRfc3339(form.dueDate) : null,
          priority: form.priority,
        }),
      });
      resetTaskForm();
      setSheetOpen(false);
      onRefresh();
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : appointmentText("appointments_failed_to_create_task"),
      );
    } finally {
      setSubmitBusy(false);
    }
  }

  async function handleTaskStatus(taskId: string, status: string) {
    setActionBusy(`task:${taskId}:${status}`);
    try {
      await apiFetch<{ ok: boolean }>(`/tasks/${taskId}/status`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      onRefresh();
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : appointmentText("appointments_failed_to_update_task"),
      );
    } finally {
      setActionBusy("");
    }
  }

  return (
    <>
    <Section
      title={appointmentText("appointments_operational_tasks")}
      accessory={
        <WorkflowSectionAccessory
          count={tasks.length}
          actionLabel={
            canCreateTasks ? t.appointments_workflow_add_task : undefined
          }
          onAction={canCreateTasks ? () => setSheetOpen(true) : undefined}
        />
      }
    >
      <p className={tokens.text.muted}>
        {appointmentText("appointments_appointment_linked_follow_up_for_pm_teamlead_interpreter")}
      </p>
      <div className="space-y-3">
        {tasks.length === 0 ? (
          <EmptyState
            text={appointmentText("appointments_no_operational_tasks_exist_for_this_appointment_yet")}
          />
        ) : (
          tasks.map((task) => (
            <ListItem key={task.id}>
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-foreground">
                      {task.title}
                    </p>
                    <span className={workflowInlineBadgeClassName}>
                      {taskStatusLabel(task.status)}
                    </span>
                    <span className={workflowInlineBadgeClassName}>
                      {taskPriorityLabel(task.priority)}
                    </span>
                  </div>
                  <p className={cn("mt-1", tokens.text.muted)}>
                    {task.assigned_to_name} · {roleLabel(task.assigned_to_role)}
                    {task.due_date
                      ? appointmentText("appointments_due_date_suffix", {
                          date: formatDateTimeLabel(task.due_date),
                        })
                      : ""}
                  </p>
                  {task.description ? (
                    <p className="mt-3 text-sm leading-6 text-muted-foreground">
                      {task.description}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  {TASK_STATUS_OPTIONS.map((status) => (
                    <Button
                      key={status}
                      type="button"
                      variant={task.status === status ? "default" : "outline"}
                      size="sm"
                      disabled={Boolean(actionBusy) || task.status === status}
                      onClick={() => handleTaskStatus(task.id, status)}
                    >
                      {actionBusy === `task:${task.id}:${status}` ? (
                        <LoaderCircle className="size-4 animate-spin" />
                      ) : null}
                      {taskStatusLabel(status)}
                    </Button>
                  ))}
                </div>
              </div>
            </ListItem>
          ))
        )}
      </div>
    </Section>

    {canCreateTasks ? (
      <AppointmentEditorSheet
        open={sheetOpen}
        onOpenChange={handleSheetOpenChange}
        title={t.appointments_workflow_add_task}
        maxWidthClassName="sm:max-w-[760px]"
        onSubmit={handleTaskSubmit}
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-lg"
              onClick={() => handleSheetOpenChange(false)}
            >
              {t.common_cancel}
            </Button>
            <Button
              type="submit"
              size="sm"
              className="h-8 rounded-lg gap-1.5"
              disabled={submitBusy || !form.title.trim() || !form.assignedTo}
            >
              {submitBusy ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
              {t.appointments_workflow_add_task}
            </Button>
          </>
        }
      >
        <WorkflowSheetBody>
          <WorkflowSheetSection title={t.appointments_workflow_add_task}>
        <div className="grid gap-4 md:grid-cols-2">
          <Field compact label={tr.appointments_title_col}>
            <Input
              value={form.title}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  title: event.target.value,
                }))
              }
              placeholder={withEllipsis(tr.appointments_title_col)}
              className={appointmentSlateInputClassName}
              required
            />
          </Field>
          <Field compact label={tr.patients_assign_owner}>
            <NativeComboboxSelect
              value={form.assignedTo}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  assignedTo: event.target.value,
                }))
              }
              className={selectClassName}
              required
            >
              <option value="">{tr.common_not_set}</option>
              {assignableStaff.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name} · {roleLabel(member.role)}
                </option>
              ))}
            </NativeComboboxSelect>
          </Field>
          <Field compact label={tr.invoices_due_at}>
            <Input
              type="datetime-local"
              value={form.dueDate}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  dueDate: event.target.value,
                }))
              }
              className={appointmentSlateInputClassName}
            />
          </Field>
          <Field compact label={t.users_status}>
            <NativeComboboxSelect
              value={form.priority}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  priority: event.target.value,
                }))
              }
              className={selectClassName}
            >
              {TASK_PRIORITY_OPTIONS.map((priority) => (
                <option key={priority} value={priority}>
                  {taskPriorityLabel(priority)}
                </option>
              ))}
            </NativeComboboxSelect>
          </Field>
          <Field compact label={t.providers_service_desc}>
            <textarea
              value={form.description}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
              className={textareaClassName}
              rows={3}
              placeholder={withEllipsis(tr.patients_notes)}
            />
          </Field>
        </div>
          </WorkflowSheetSection>
        </WorkflowSheetBody>
      </AppointmentEditorSheet>
    ) : null}
    </>
  );
}

export const MemoizedAppointmentWorkflowTab = memo(AppointmentWorkflowTab);
export const MemoizedAppointmentInterpreterSection = memo(
  AppointmentInterpreterSection,
);
export const MemoizedAppointmentChecklistSection = memo(
  AppointmentChecklistSection,
);
export const MemoizedAppointmentRemindersSection = memo(
  AppointmentRemindersSection,
);
export const MemoizedAppointmentCompletionSection = memo(
  AppointmentCompletionSection,
);
export const MemoizedAppointmentStatusSection = memo(AppointmentStatusSection);
export const MemoizedAppointmentTasksSection = memo(AppointmentTasksSection);
