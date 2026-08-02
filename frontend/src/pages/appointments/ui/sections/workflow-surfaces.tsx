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
import { LoaderCircle, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DataTableSurface } from "@/components/data-table/data-table-surface";
import type { ColumnDef } from "@/components/data-table/types";
import {
  AppointmentRemindersTable,
  AppointmentTasksTable,
} from "@/pages/appointments/ui/shared/follow-up-tables";
import { CONFIRMED_DISMISS_REASON } from "@/components/ui/dismissal-guard";
import { DirtyDismissConfirmDialog } from "@/components/ui/dirty-dismiss-confirm-dialog";
import { Input } from "@/components/ui/input";
import {
  Banner,
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
import { appointmentActionErrorMessage } from "@/pages/appointments/model/error-message";
import { appointmentStatusBadgeClassName } from "@/pages/appointments/appearance/status-appearance";
import {
  blankChecklistForm,
  blankReminderForm,
  blankTaskForm,
  defaultCompletionPlan,
  statusActionKey,
} from "@/pages/appointments/model/form-factories";
import {
  appointmentText,
  checklistPhaseLabel,
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
  type AppointmentEditorSheetOpenChangeDetails,
  Field,
} from "@/pages/appointments/ui/shared/workspace-primitives";

const selectClassName = appointmentSelectControlClassName;
const textareaClassName = appointmentTextareaControlClassName;

const APPOINTMENT_STATUS_RANK: Partial<Record<AppointmentStatus, number>> = {
  planned: 0,
  confirmed: 1,
  in_progress: 2,
  completed: 3,
};

function canTransitionAppointmentStatus(
  current: AppointmentStatus,
  target: AppointmentStatus,
) {
  if (current === target) return true;
  if (current === "completed" || current === "cancelled") return false;
  if (target === "cancelled") return true;
  const currentRank = APPOINTMENT_STATUS_RANK[current];
  const targetRank = APPOINTMENT_STATUS_RANK[target];
  return currentRank !== undefined && targetRank !== undefined && targetRank >= currentRank;
}

function withEllipsis(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  return /[.…]$/u.test(normalized) ? normalized : `${normalized}…`;
}

function hasChecklistFormChanges(form: ChecklistFormState) {
  const initial = blankChecklistForm();
  return form.phase !== initial.phase || form.itemText !== initial.itemText;
}

function hasReminderFormChanges(form: ReminderFormState) {
  const initial = blankReminderForm();
  return (
    form.userId !== initial.userId ||
    form.remindAt !== initial.remindAt ||
    form.title !== initial.title ||
    form.description !== initial.description
  );
}

function hasTaskFormChanges(form: TaskFormState, initial: TaskFormState) {
  return (
    form.title !== initial.title ||
    form.description !== initial.description ||
    form.assignedTo !== initial.assignedTo ||
    form.dueDate !== initial.dueDate ||
    form.priority !== initial.priority
  );
}

function isConfirmedDismiss(
  eventDetails?: AppointmentEditorSheetOpenChangeDetails,
) {
  return (
    (eventDetails as { reason?: string } | undefined)?.reason ===
    CONFIRMED_DISMISS_REASON
  );
}

function WorkflowSheetBody({ children }: { children: ReactNode }) {
  return <div className="space-y-4 rounded-xl">{children}</div>;
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
        <span aria-hidden className="size-1.5 rounded-full bg-[var(--brand)]" />
        <span>{title}</span>
      </h3>
      {children}
    </section>
  );
}

function WorkflowEmptyState({
  title,
  description,
}: {
  title: ReactNode;
  description?: ReactNode;
}) {
  return (
    <div className={cn("rounded-xl px-6 py-10 text-center", tokens.surface.dashed)}>
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      {description ? (
        <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      ) : null}
    </div>
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
  completionWarnings,
}: AppointmentWorkflowOverviewSectionProps) {
  if (completionWarnings.length === 0) return null;
  return (
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
          <div className="grid gap-3 xl:grid-cols-2">
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
          <div className="grid gap-3">
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
              <div className="grid gap-3">
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
          message: appointmentActionErrorMessage(
            error,
            appointmentText(
              "appointments_failed_to_load_interpreter_suggestions",
            ),
          ),
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
          message: appointmentActionErrorMessage(
            error,
            appointmentText("appointments_error_load_interpreter_history"),
          ),
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
        appointmentActionErrorMessage(
          error,
          appointmentText("appointments_error_save_interpreter_preference"),
        ),
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
        appointmentActionErrorMessage(
          error,
          appointmentText("appointments_failed_to_assign_interpreter"),
        ),
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
        appointmentActionErrorMessage(
          error,
          appointmentText("appointments_failed_to_submit_response"),
        ),
      );
    } finally {
      dispatchInterpreterState({ type: "patch", value: { busyAction: "" } });
    }
  }

  return (
    <>
      {canAssign && !detail.is_blocked ? (
        <InterpreterAssignmentManagement
          assignInterpreterId={assignInterpreterId}
          assignmentSheetOpen={assignmentSheetOpen}
          busyAction={busyAction}
          detail={detail}
          history={history}
          historyError={historyError}
          historyLoading={historyLoading}
          interpreters={interpreters}
          preferenceSavingId={preferenceSavingId}
          suggestions={suggestions}
          suggestionsError={suggestionsError}
          suggestionsLoading={suggestionsLoading}
          onAssign={handleAssignInterpreter}
          onOpenChange={(open) =>
            dispatchInterpreterState({
              type: "patch",
              value: { assignmentSheetOpen: open },
            })
          }
          onSelect={(value) =>
            dispatchInterpreterState({
              type: "patch",
              value: { assignInterpreterId: value },
            })
          }
          onSetPreference={handleSetInterpreterPreference}
        />
      ) : null}
      {canRespond && detail.interpreter_id === currentUserId ? (
        <InterpreterResponseControls
          busyAction={busyAction}
          interpreterResponse={detail.interpreter_response}
          onResponse={handleInterpreterResponse}
        />
      ) : null}
    </>
  );
}

function InterpreterAssignmentManagement({
  assignInterpreterId,
  assignmentSheetOpen,
  busyAction,
  detail,
  history,
  historyError,
  historyLoading,
  interpreters,
  preferenceSavingId,
  suggestions,
  suggestionsError,
  suggestionsLoading,
  onAssign,
  onOpenChange,
  onSelect,
  onSetPreference,
}: {
  assignInterpreterId: string;
  assignmentSheetOpen: boolean;
  busyAction: string;
  detail: AppointmentDetail;
  history: InterpreterHistoryItem[];
  historyError: string | null;
  historyLoading: boolean;
  interpreters: InterpreterOption[];
  preferenceSavingId: string | null;
  suggestions: InterpreterSuggestion[];
  suggestionsError: string | null;
  suggestionsLoading: boolean;
  onAssign: (event: FormEvent<HTMLFormElement>) => void;
  onOpenChange: (open: boolean) => void;
  onSelect: (value: string) => void;
  onSetPreference: (
    interpreterId: string,
    preference: InterpreterPreference,
  ) => void | Promise<void>;
}) {
  const { t } = useLang();

  const interpreterAssignmentColumns = useMemo<ColumnDef<AppointmentDetail>[]>(
    () => [
      {
        id: "interpreter",
        label: appointmentText("appointments_interpreter"),
        accessor: (row) => row.interpreter_name ?? "",
        required: true,
        width: 260,
        render: (row) => (
          <span className="block truncate font-mono text-xs font-medium text-foreground">
            {row.interpreter_name ?? t.common_not_set}
          </span>
        ),
      },
      {
        id: "role",
        label: t.users_role,
        accessor: () => appointmentText("appointments_interpreter"),
        width: 170,
        render: () => (
          <span className="inline-flex rounded-full border border-border/60 bg-muted/25 px-2 py-0.5 font-mono text-[10px] font-medium text-foreground">
            {appointmentText("appointments_interpreter")}
          </span>
        ),
      },
      {
        id: "response",
        label: t.users_status,
        accessor: (row) => responseLabel(row.interpreter_response ?? "pending"),
        width: 170,
        render: (row) => (
          <span className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 font-mono text-[10px] font-medium text-sky-700">
            {responseLabel(row.interpreter_response ?? "pending")}
          </span>
        ),
      },
    ],
    [t],
  );

  return (
    <section className="overflow-hidden rounded-lg border border-border/70 bg-card">
      <div className="relative z-30 flex flex-nowrap items-center gap-1.5 overflow-x-auto border-b border-border/70 bg-card px-3 py-2">
        <span className="flex shrink-0 items-center gap-2 text-[13px] font-semibold tracking-tight text-foreground">
              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
          {appointmentText("appointments_interpreter_assignment")}
        </span>
        <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />
        <Button
          type="button"
          size="sm"
          className="h-8 shrink-0 rounded-lg gap-1.5"
          onClick={() => onOpenChange(true)}
        >
          <Plus className="size-3.5" />
          {appointmentText("appointments_assign_interpreter")}
        </Button>
      </div>
      <DataTableSurface
        rows={detail.interpreter_id ? [detail] : []}
        columns={interpreterAssignmentColumns}
        rowId={(row) => row.interpreter_id ?? "interpreter"}
        dictionary={t as unknown as Record<string, string>}
        emptyState={
          <WorkflowEmptyState
            title={appointmentText("appointments_no_interpreter_linked_to_this_appointment")}
          />
        }
        surfaceClassName="rounded-none border-0 shadow-none"
      />

      <AppointmentEditorSheet
        open={assignmentSheetOpen}
        onOpenChange={onOpenChange}
        title={appointmentText("appointments_interpreter_assignment")}
        maxWidthClassName="sm:max-w-[760px]"
        onSubmit={onAssign}
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-lg"
              onClick={() => onOpenChange(false)}
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
            <Field compact label={appointmentText("appointments_interpreter")}>
              <NativeComboboxSelect
                value={assignInterpreterId}
                onChange={(event) => onSelect(event.target.value)}
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
            onSelect={onSelect}
            onSetPreference={(interpreterId, preference) =>
              void onSetPreference(interpreterId, preference)
            }
          />
        </WorkflowSheetBody>
      </AppointmentEditorSheet>
    </section>
  );
}

function InterpreterResponseControls({
  busyAction,
  interpreterResponse,
  onResponse,
}: {
  busyAction: string;
  interpreterResponse: InterpreterResponse | null;
  onResponse: (response: InterpreterResponse) => void | Promise<void>;
}) {
  return (
    <Section title={appointmentText("appointments_interpreter_response")}>
      <div className="flex flex-wrap gap-2">
        {INTERPRETER_RESPONSE_OPTIONS.map((value) => (
          <Button
            key={value}
            variant={interpreterResponse === value ? "default" : "outline"}
            disabled={Boolean(busyAction)}
            onClick={() => void onResponse(value)}
          >
            {busyAction === `response:${value}` ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : null}
            {responseLabel(value)}
          </Button>
        ))}
      </div>
    </Section>
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
  const checklistFormDirty = hasChecklistFormChanges(form);

  function resetChecklistForm() {
    setForm(blankChecklistForm());
    setSubmitBusy(false);
  }

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
        appointmentActionErrorMessage(
          error,
          appointmentText("appointments_failed_to_add_checklist_item"),
        ),
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
        appointmentActionErrorMessage(
          error,
          appointmentText("appointments_failed_to_complete_item"),
        ),
      );
    } finally {
      setCompletingId("");
    }
  }

  function discardChecklistForm() {
    resetChecklistForm();
    setSheetOpen(false);
  }

  function handleChecklistSheetOpenChange(
    open: boolean,
    eventDetails?: AppointmentEditorSheetOpenChangeDetails,
  ) {
    setSheetOpen(open);
    if (
      !open &&
      (!checklistFormDirty ||
        !eventDetails ||
        isConfirmedDismiss(eventDetails))
    ) {
      resetChecklistForm();
    }
  }

  const workflowChecklistColumns = useMemo<ColumnDef<ChecklistItem>[]>(
    () => [
      {
        id: "item",
        label: appointmentText("appointments_checklist"),
        accessor: (item) => item.item_text,
        filterType: "text",
        sortable: true,
        required: true,
        width: 420,
        render: (item) => (
          <span
            className={cn(
              "block truncate text-xs font-medium",
              item.is_completed
                ? "text-muted-foreground line-through"
                : "text-foreground",
            )}
            title={item.item_text}
          >
            {item.item_text}
          </span>
        ),
      },
      {
        id: "phase",
        label: tr.orders_phase,
        accessor: (item) => checklistPhaseLabel(item.phase),
        filterType: "enum",
        filterOptions: (rows) =>
          [...new Set(rows.map((item) => checklistPhaseLabel(item.phase)))].map(
            (label) => ({ value: label, label }),
          ),
        sortable: true,
        width: 150,
        render: (item) => (
          <span className="inline-flex rounded-full border border-border/60 bg-muted/25 px-2 py-0.5 font-mono text-[10px] font-medium text-foreground">
            {checklistPhaseLabel(item.phase)}
          </span>
        ),
      },
      {
        id: "status",
        label: t.users_status,
        accessor: (item) =>
          item.is_completed ? t.common_completed : appointmentText("appointments_open"),
        filterType: "enum",
        filterOptions: (rows) =>
          [
            ...new Set(
              rows.map((item) =>
                item.is_completed
                  ? t.common_completed
                  : appointmentText("appointments_open"),
              ),
            ),
          ].map((label) => ({ value: label, label })),
        sortable: true,
        width: 220,
        render: (item) =>
          item.is_completed ? (
            <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-mono text-[10px] font-medium text-emerald-700">
              {t.common_completed} {formatDateTimeLabel(item.completed_at)}
            </span>
          ) : (
            <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 font-mono text-[10px] font-medium text-amber-700">
              {appointmentText("appointments_open")}
            </span>
          ),
      },
    ],
    [t, tr],
  );

  return (
    <>
    <DataTableSurface
      rows={items}
      columns={workflowChecklistColumns}
      rowId={(item) => item.id}
      dictionary={tr}
      emptyState={
        <WorkflowEmptyState
          title={appointmentText("appointments_no_workflow_steps_exist_for_this_appointment_yet")}
        />
      }
      toolbarStart={
        <>
          <span className="flex shrink-0 items-center gap-2 self-center text-[13px] font-semibold tracking-tight text-foreground">
              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
            {appointmentText("appointments_checklist")}
          </span>
          <Button
            type="button"
            size="sm"
            className="h-8 shrink-0 rounded-lg gap-1.5"
            onClick={() => setSheetOpen(true)}
          >
            <Plus className="size-3.5" />
            {appointmentText("appointments_add_checklist_item")}
          </Button>
          <span aria-hidden className="mx-1 h-4 w-px shrink-0 self-center bg-border" />
        </>
      }
      rowActions={(item) =>
        item.is_completed ? null : (
          <Button
            variant="outline"
            size="xs"
            className="shrink-0"
            disabled={Boolean(completingId)}
            onClick={() => void handleComplete(item.id)}
          >
            {completingId === item.id ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : null}
            {appointmentText("appointments_mark_complete").replace(/\s+\S+$/u, "")}
          </Button>
        )
      }
      rowActionsWidth={120}
    />

    <AppointmentEditorSheet
      open={sheetOpen}
      onOpenChange={handleChecklistSheetOpenChange}
      dirty={checklistFormDirty}
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
            onClick={discardChecklistForm}
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
  const reminderFormDirty = hasReminderFormChanges(form);

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
        appointmentActionErrorMessage(
          error,
          appointmentText("appointments_failed_to_add_reminder"),
        ),
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
        appointmentActionErrorMessage(
          error,
          appointmentText("appointments_failed_to_complete_reminder"),
        ),
      );
    } finally {
      setCompletingId("");
    }
  }

  function discardReminderForm() {
    setForm(blankReminderForm());
    setSubmitBusy(false);
    setSheetOpen(false);
  }

  function handleReminderSheetOpenChange(
    open: boolean,
    eventDetails?: AppointmentEditorSheetOpenChangeDetails,
  ) {
    setSheetOpen(open);
    if (
      !open &&
      (!reminderFormDirty ||
        !eventDetails ||
        isConfirmedDismiss(eventDetails))
    ) {
      setForm(blankReminderForm());
      setSubmitBusy(false);
    }
  }

  return (
    <>
    <AppointmentRemindersTable
      reminders={reminders}
      title={appointmentText("appointments_reminders_2")}
      emptyText={appointmentText("appointments_no_reminders_exist_for_this_appointment_yet")}
      toolbarExtra={
        canManageReminders ? (
          <Button
            type="button"
            size="sm"
            className="h-8 shrink-0 rounded-lg gap-1.5"
            onClick={() => setSheetOpen(true)}
          >
            <Plus className="size-3.5" />
            {t.appointments_add_reminder}
          </Button>
        ) : undefined
      }
      rowActions={(item) =>
        item.is_completed ? null : (
          <Button
            variant="outline"
            size="xs"
            className="shrink-0"
            disabled={Boolean(completingId)}
            onClick={() => void handleComplete(item.id)}
          >
            {completingId === item.id ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : null}
            {appointmentText("appointments_mark_complete")}
          </Button>
        )
      }
      rowActionsWidth={120}
    />

    {canManageReminders ? (
      <AppointmentEditorSheet
        open={sheetOpen}
        onOpenChange={handleReminderSheetOpenChange}
        dirty={reminderFormDirty}
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
              onClick={discardReminderForm}
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

type AppointmentCompletionSectionProps = {
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
};

function AppointmentCompletionSection(props: AppointmentCompletionSectionProps) {
  return (
    <AppointmentCompletionSectionContent
      key={`${props.detail.id}:${props.detail.status}`}
      {...props}
    />
  );
}

function AppointmentCompletionSectionContent({
  detail,
  handoffStakeholders,
  openChecklistCount,
  followUpAssigneeId,
  setFollowUpAssigneeId,
  showStatusToggle = false,
  onRefresh,
  onError,
  onNotice,
}: AppointmentCompletionSectionProps) {
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
      onError(appointmentActionErrorMessage(error, tr.common_failed_update));
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
          appointmentText("appointments_follow_up_scheduling_failed_notice", {
            message: appointmentActionErrorMessage(error, tr.common_error),
          }),
        );
        onRefresh();
      } else {
        onError(appointmentActionErrorMessage(error, tr.common_failed_update));
      }
    } finally {
      setBusyAction("");
    }
  }

  const canCompleteAppointment =
    detail.status !== "completed" && detail.status !== "cancelled";
  const completionBlocked = openChecklistCount > 0;

  return (
    <>
    <section className="overflow-hidden rounded-lg border border-border/70 bg-card">
      <div className="relative z-30 flex flex-nowrap items-center gap-1.5 overflow-x-auto border-b border-border/70 bg-card px-3 py-2">
        <span className="flex shrink-0 items-center gap-2 text-[13px] font-semibold tracking-tight text-foreground">
              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
          {appointmentText("appointments_completion_readiness")}
        </span>
        {canCompleteAppointment ? (
          <>
            <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />
            <Button
              type="button"
              size="sm"
              className="h-8 shrink-0 rounded-lg gap-1.5"
              disabled={Boolean(busyAction) || completionBlocked}
              onClick={() => setCompletionSheetOpen(true)}
            >
              <Plus className="size-3.5" />
              {t.appointments_complete_and_schedule}
            </Button>
          </>
        ) : null}
      </div>
      {showStatusToggle ? (
        <div className="p-3">
          <AppointmentStatusToggleControl
            detail={detail}
            openChecklistCount={openChecklistCount}
            onRefresh={onRefresh}
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
              disabled={Boolean(busyAction) || completionBlocked}
              onClick={handleCompleteOnly}
            >
              {t.appointments_complete_only}
            </Button>
            <Button
              type="button"
              disabled={
                Boolean(busyAction) ||
                completionBlocked ||
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
    </section>
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
  const [pendingCancellation, setPendingCancellation] = useState<{
    scope: AppointmentRecurringActionScope;
    targetCount: number;
  } | null>(null);
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
    if (status === visibleStatus && recurrenceScope === "single") return;

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
        appointmentActionErrorMessage(
          error,
          appointmentText("appointments_failed_to_change_status"),
        ),
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
          className="flex w-full flex-wrap gap-1.5"
          role="group"
          aria-label={t.users_status}
        >
          {STATUS_OPTIONS.map((status) => {
            const recurrenceScope = detail.recurrence_frequency
              ? statusRecurrenceScope
              : "single";
            const nextBusyAction = statusActionKey(detail.id, status, recurrenceScope);
            const active = visibleStatus === status;
            const isNoop = selectedRecurringStatusTargets.every(
              (item) => item.status === status,
            );
            const transitionAllowed = selectedRecurringStatusTargets.every(
              (item) =>
                canTransitionAppointmentStatus(
                  item.status as AppointmentStatus,
                  status,
                ),
            );
            const completionBlocked =
              status === "completed" && completionScopeBlockers.length > 0;
            const statusDisabled =
              Boolean(busyAction) ||
              isNoop ||
              !transitionAllowed ||
              completionBlocked;
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
                title={
                  completionBlocked
                    ? appointmentText("appointments_status_completion_blocked")
                    : !transitionAllowed
                      ? appointmentText("appointments_status_transition_not_allowed")
                      : statusOptionLabel
                }
                aria-pressed={active}
                disabled={statusDisabled}
                onClick={() => {
                  if (status === "cancelled") {
                    setPendingCancellation({
                      scope: recurrenceScope,
                      targetCount: selectedRecurringStatusTargets.length,
                    });
                    return;
                  }
                  void handleStatusChange(status, recurrenceScope);
                }}
                className={cn(
                  "relative inline-flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-full border px-3 font-mono text-xs font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-70",
                  active
                    ? cn(
                        "font-semibold",
                        status === "cancelled"
                          ? "border-rose-200 bg-rose-50 text-rose-700"
                          : appointmentStatusBadgeClassName(status),
                      )
                    : "border-border/60 bg-card text-muted-foreground hover:bg-muted/30 hover:text-foreground",
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
      <DirtyDismissConfirmDialog
        open={pendingCancellation !== null}
        title={appointmentText("appointments_cancel_confirmation_title")}
        message={appointmentText("appointments_cancel_confirmation_message", {
          count: pendingCancellation?.targetCount ?? 0,
        })}
        cancelLabel={t.common_cancel}
        confirmLabel={appointmentText("appointments_cancel_confirmation_action")}
        destructive
        confirmDisabled={Boolean(busyAction)}
        onCancel={() => setPendingCancellation(null)}
        onConfirm={() => {
          const scope = pendingCancellation?.scope;
          setPendingCancellation(null);
          if (scope) {
            void handleStatusChange("cancelled", scope);
          }
        }}
      />
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

type TaskFormSetter = (
  value: TaskFormState | ((current: TaskFormState) => TaskFormState),
) => void;

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
  const [form, setForm] = useState<TaskFormState>(() =>
    blankTaskForm(
      detail.interpreter_id ?? detail.owner_user_id ?? assignableStaff[0]?.id ?? "",
      buildTaskDefaultDueDate(detail),
    ),
  );
  const [sheetOpen, setSheetOpen] = useState(false);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState("");
  const defaultTaskForm = buildDefaultTaskForm();
  const taskFormDirty = hasTaskFormChanges(form, defaultTaskForm);

  function buildDefaultTaskForm() {
    return blankTaskForm(
      detail.interpreter_id ??
        detail.owner_user_id ??
        assignableStaff[0]?.id ??
        "",
      buildTaskDefaultDueDate(detail),
    );
  }

  function resetTaskForm() {
    setForm(buildDefaultTaskForm());
  }

  function handleTaskSheetOpenChange(
    open: boolean,
    eventDetails?: AppointmentEditorSheetOpenChangeDetails,
  ) {
    setSheetOpen(open);
    if (
      !open &&
      (!taskFormDirty ||
        !eventDetails ||
        isConfirmedDismiss(eventDetails))
    ) {
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
        appointmentActionErrorMessage(
          error,
          appointmentText("appointments_failed_to_create_task"),
        ),
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
        appointmentActionErrorMessage(
          error,
          appointmentText("appointments_failed_to_update_task"),
        ),
      );
    } finally {
      setActionBusy("");
    }
  }

  return (
    <>
    <AppointmentTasksTable
      tasks={tasks}
      title={appointmentText("appointments_operational_tasks")}
      emptyText={appointmentText("appointments_no_operational_tasks_exist_for_this_appointment_yet")}
      toolbarExtra={
        canCreateTasks ? (
          <Button
            type="button"
            size="sm"
            className="h-8 shrink-0 rounded-lg gap-1.5"
            onClick={() => setSheetOpen(true)}
          >
            <Plus className="size-3.5" />
            {t.appointments_workflow_add_task}
          </Button>
        ) : undefined
      }
      rowActions={(task) => (
        <NativeComboboxSelect
          value={task.status}
          aria-label={t.users_status}
          disabled={Boolean(actionBusy)}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => {
            const nextStatus = event.target.value;
            if (nextStatus && nextStatus !== task.status) {
              void handleTaskStatus(task.id, nextStatus);
            }
          }}
          className="h-7 w-[150px] rounded-md bg-field text-xs"
        >
          {TASK_STATUS_OPTIONS.map((status) => (
            <option key={status} value={status}>
              {taskStatusLabel(status)}
            </option>
          ))}
        </NativeComboboxSelect>
      )}
      rowActionsWidth={170}
    />

    {canCreateTasks ? (
      <AppointmentTaskEditorSheet
        assignableStaff={assignableStaff}
        form={form}
        open={sheetOpen}
        dirty={taskFormDirty}
        submitBusy={submitBusy}
        setForm={setForm}
        onOpenChange={handleTaskSheetOpenChange}
        onSubmit={handleTaskSubmit}
      />
    ) : null}
    </>
  );
}

function AppointmentTaskEditorSheet({
  assignableStaff,
  dirty,
  form,
  open,
  submitBusy,
  setForm,
  onOpenChange,
  onSubmit,
}: {
  assignableStaff: StaffOption[];
  dirty: boolean;
  form: TaskFormState;
  open: boolean;
  submitBusy: boolean;
  setForm: TaskFormSetter;
  onOpenChange: (
    open: boolean,
    eventDetails?: AppointmentEditorSheetOpenChangeDetails,
  ) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;

  return (
    <AppointmentEditorSheet
      open={open}
      onOpenChange={onOpenChange}
      dirty={dirty}
      title={t.appointments_workflow_add_task}
      maxWidthClassName="sm:max-w-[760px]"
      onSubmit={onSubmit}
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 rounded-lg"
            onClick={() => onOpenChange(false)}
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
