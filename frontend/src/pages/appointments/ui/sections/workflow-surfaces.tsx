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
import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Banner,
  CountBadge,
  Section,
  StatCard,
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
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { buildAppointmentWorkflowSummary } from "@/pages/appointments/model/selectors";
import { InterpreterSuggestionsPanel } from "@/pages/appointments/ui/sections/interpreter-suggestions-panel";
import {
  appointmentSectionCardClassName,
  appointmentMetaPillClassName,
  appointmentMiniPillClassName,
  appointmentSelectControlClassName,
  appointmentSlateInputClassName,
  appointmentSoftPanelClassName,
  appointmentSoftSplitRowClassName,
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
  AppointmentWorkspaceSectionIntro,
  EmptyState,
  Field,
} from "@/pages/appointments/ui/shared/workspace-primitives";
import { ContextCard } from "@/pages/appointments/ui/shared/context-card";

const selectClassName = appointmentSelectControlClassName;
const textareaClassName = appointmentTextareaControlClassName;

function checklistPhaseLabel(phase: string) {
  switch (phase) {
    case "preparation":
      return appointmentText("Vorbereitung", "Подготовка", "Preparation");
    case "execution":
      return appointmentText("Durchführung", "Выполнение", "Execution");
    case "followup":
      return appointmentText("Nachbereitung", "После визита", "Follow-up");
    default:
      return appointmentText("Unbekannte Phase", "Неизвестная фаза", "Unknown phase");
  }
}

function withEllipsis(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  return /[.…]$/u.test(normalized) ? normalized : `${normalized}…`;
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
      title={appointmentText(
        "Operativer Гњberblick",
        "РћРїРµСЂР°С†РёРѕРЅРЅС‹Р№ РѕР±Р·РѕСЂ",
        "Operational overview",
      )}
      accessory={<CountBadge>{workflowSummary.openIssueCount}</CountBadge>}
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={appointmentText(
            "Offene Punkte",
            "РћС‚РєСЂС‹С‚С‹Рµ РїСѓРЅРєС‚С‹",
            "Open issues",
          )}
          value={workflowSummary.openIssueCount}
          description={appointmentText(
            "Checklisten, Reminder und Aufgaben mit offener Nachverfolgung.",
            "Р§РµРє-Р»РёСЃС‚С‹, РЅР°РїРѕРјРёРЅР°РЅРёСЏ Рё Р·Р°РґР°С‡Рё СЃ РѕС‚РєСЂС‹С‚С‹Рј follow-up.",
            "Checklist, reminder and task items still requiring follow-up.",
          )}
        />
        <StatCard
          label={appointmentText(
            "Checklisten-Fortschritt",
            "РџСЂРѕРіСЂРµСЃСЃ С‡РµРє-Р»РёСЃС‚Р°",
            "Checklist progress",
          )}
          value={checklistProgressValue}
          description={appointmentText(
            "Abgeschlossene gegen alle appointment-gebundenen Schritte.",
            "Р—Р°РІРµСЂС€С‘РЅРЅС‹Рµ РїСЂРѕС‚РёРІ РІСЃРµС… С€Р°РіРѕРІ, РїСЂРёРІСЏР·Р°РЅРЅС‹С… Рє РїСЂРёС‘РјСѓ.",
            "Completed versus total appointment-bound workflow steps.",
          )}
        />
        <StatCard
          label={appointmentText(
            "Follow-up-Warteschlange",
            "РћС‡РµСЂРµРґСЊ follow-up",
            "Follow-up queue",
          )}
          value={workflowSummary.followUpQueueCount}
          description={appointmentText(
            "Offene Aufgaben plus ausstehende Erinnerungen.",
            "РћС‚РєСЂС‹С‚С‹Рµ Р·Р°РґР°С‡Рё РїР»СЋСЃ РѕР¶РёРґР°СЋС‰РёРµ РЅР°РїРѕРјРёРЅР°РЅРёСЏ.",
            "Open tasks plus pending reminders.",
          )}
        />
        <StatCard
          label={appointmentText(
            "Dolmetscher-Gate",
            "Р“РµР№С‚ РїРµСЂРµРІРѕРґС‡РёРєР°",
            "Interpreter gate",
          )}
          value={interpreterGateValue}
          description={interpreterGateDescription}
        />
      </div>

      {completionWarnings.length > 0 ? (
        <Banner tone="warning" withIcon>
          <div className="space-y-1">
            <p className="font-medium">
              {appointmentText(
                "Vor dem Abschluss bleiben noch operative Blocker offen.",
                "РџРµСЂРµРґ Р·Р°РєСЂС‹С‚РёРµРј РѕСЃС‚Р°СЋС‚СЃСЏ РѕС‚РєСЂС‹С‚С‹Рµ РѕРїРµСЂР°С†РёРѕРЅРЅС‹Рµ Р±Р»РѕРєРµСЂС‹.",
                "Operational blockers remain before closure.",
              )}
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
    : appointmentText("Keine", "Нет", "None");
  const interpreterGateValue =
    workflowSummary.interpreterGate === "not_required"
      ? appointmentText("Nicht erforderlich", "Не требуется", "Not required")
      : workflowSummary.interpreterGate === "ready"
        ? appointmentText("Freigegeben", "Согласовано", "Approved")
        : appointmentText("Ausstehend", "Ожидается", "Pending");
  const interpreterGateDescription =
    workflowSummary.interpreterGate === "not_required"
      ? appointmentText(
          "Kein Dolmetscher für diesen Termin verknüpft.",
          "Для этого приёма переводчик не привязан.",
          "No interpreter linked to this appointment.",
        )
      : detailReport
        ? reportApprovalLabel(detailReport.approval_status)
        : appointmentText(
            "Bericht oder Freigabe noch ausstehend.",
            "Отчёт или согласование ещё ожидается.",
            "Report or approval is still pending.",
          );

  return (
    <>
      <AppointmentWorkspaceSectionIntro
        title={appointmentText(
          "Workflow-Cockpit",
          "Панель workflow",
          "Workflow cockpit",
        )}
        description={appointmentText(
          "Abschluss, Slot-Logistik und operative Nachverfolgung in einem appointment-zentrierten Workspace.",
          "Закрытие, логистика слота и операционный follow-up в одном workspace приёма.",
          "Closure, slot logistics and operational follow-up in one appointment-centered workspace.",
        )}
        accessory={<CountBadge>{workflowSummary.visibleSurfaceCount}</CountBadge>}
      />

      <AppointmentWorkflowOverviewSection
        checklistProgressValue={checklistProgressValue}
        completionWarnings={completionWarnings}
        interpreterGateDescription={interpreterGateDescription}
        interpreterGateValue={interpreterGateValue}
        workflowSummary={workflowSummary}
      />
      {showTransitionLane ? (
        <Section
          title={appointmentText(
            "Abschluss & Status",
            "Закрытие и статус",
            "Closure and status",
          )}
          accessory={<CountBadge>{workflowSummary.transitionSurfaceCount}</CountBadge>}
        >
          <p className={tokens.text.muted}>
            {appointmentText(
              "Finalisiere den Slot, plane Standard-Follow-up und steuere Statusänderungen über den aktuellen Termin oder die Serie.",
              "Закрой слот, запланируй стандартный follow-up и управляй сменой статуса для текущего приёма или серии.",
              "Close the slot, schedule standard follow-up and control status changes for the current appointment or its series.",
            )}
          </p>
          <div className="grid gap-4 xl:grid-cols-2">
            {showCompletionSection ? (
              <MemoizedAppointmentCompletionSection
                detail={detail}
                detailReport={detailReport}
                handoffStakeholders={handoffStakeholders}
                openChecklistCount={openChecklistCount}
                openTaskCount={openTaskCount}
                pendingReminderCount={pendingReminderCount}
                interpreterReportReady={interpreterReportReady}
                completionWarnings={completionWarnings}
                followUpAssigneeId={followUpAssigneeId}
                setFollowUpAssigneeId={setFollowUpAssigneeId}
                onRefresh={onRefresh}
                onError={onError}
                onNotice={onNotice}
              />
            ) : null}
            {showStatusSection ? (
              <MemoizedAppointmentStatusSection
                detail={detail}
                openChecklistCount={openChecklistCount}
                onRefresh={onRefresh}
                onError={onError}
              />
            ) : null}
          </div>
        </Section>
      ) : null}

      {showLogisticsLane ? (
        <Section
          title={appointmentText(
            "Terminlogistik",
            "Логистика приёма",
            "Appointment logistics",
          )}
          accessory={<CountBadge>{workflowSummary.logisticsSurfaceCount}</CountBadge>}
        >
          <p className={tokens.text.muted}>
            {appointmentText(
              "Halte Slot, Zuständigkeiten und Dolmetscherbesetzung im selben Workflow-Kontext synchron.",
              "Держи слот, ответственных и назначение переводчика синхронизированными в одном workflow-контексте.",
              "Keep the slot, ownership and interpreter staffing aligned in the same workflow context.",
            )}
          </p>
          <div className="grid gap-4 xl:grid-cols-2">
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
        </Section>
      ) : null}

      {showBacklogLane ? (
        <Section
          title={appointmentText(
            "Operativer Backlog",
            "Операционный backlog",
            "Operational backlog",
          )}
          accessory={<CountBadge>{workflowSummary.backlogSurfaceCount}</CountBadge>}
        >
          <p className={tokens.text.muted}>
            {appointmentText(
              "Arbeite checklisten, Erinnerungen und appointment-verknüpfte Aufgaben in einer durchgehenden Bearbeitungsschicht ab.",
              "Закрывай чек-листы, напоминания и привязанные к приёму задачи в одном непрерывном operational layer.",
              "Work through checklist items, reminders and appointment-linked tasks in one continuous operational layer.",
            )}
          </p>
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
              <div
                className={cn(
                  "grid gap-4",
                  showReminderSection && showTaskSection ? "xl:grid-cols-2" : "",
                )}
              >
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
        </Section>
      ) : null}
    </>
  );
}

type InterpreterSectionState = {
  assignInterpreterId: string;
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
    },
    dispatchInterpreterState,
  ] = useReducer(interpreterSectionReducer, detail, createInterpreterSectionState);

  useEffect(() => {
    dispatchInterpreterState({
      type: "patch",
      value: { assignInterpreterId: detail.interpreter_id ?? "", busyAction: "" },
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
              : appointmentText(
                  "Failed to load interpreter suggestions.",
                  "Failed to load interpreter suggestions.",
                  "Failed to load interpreter suggestions.",
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
          message:
            error instanceof Error
              ? error.message
              : "Failed to load interpreter history.",
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
          : "Failed to save interpreter preference.",
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
      onRefresh();
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : appointmentText(
              "Dolmetscher konnte nicht zugewiesen werden.",
              "Не удалось назначить переводчика.",
              "Failed to assign interpreter",
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
        error instanceof Error
          ? error.message
          : appointmentText(
              "Antwort konnte nicht gesendet werden.",
              "Не удалось отправить ответ.",
              "Failed to submit response",
            ),
      );
    } finally {
      dispatchInterpreterState({ type: "patch", value: { busyAction: "" } });
    }
  }

  return (
    <>
      {canAssign && !detail.is_blocked ? (
        <section className={appointmentSectionCardClassName("p-5")}>
          <h3 className="text-sm font-semibold text-zinc-950">
            {appointmentText(
              "Dolmetscherbesetzung",
              "Назначение переводчика",
              "Interpreter assignment",
            )}
          </h3>
          <form
            onSubmit={handleAssignInterpreter}
            className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]"
          >
            <Field label={t.role_interpreter}>
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
            <div className="flex items-end">
              <Button
                type="submit"
                disabled={!assignInterpreterId || busyAction === "assign"}
              >
                {busyAction === "assign" ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : null}
                {appointmentText(
                  "Dolmetscher zuweisen",
                  "Назначить переводчика",
                  "Assign interpreter",
                )}
              </Button>
            </div>
          </form>
          <div className="mt-4">
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
          </div>
        </section>
      ) : null}
      {canRespond && detail.interpreter_id === currentUserId ? (
        <section className={appointmentSectionCardClassName("p-5")}>
          <h3 className="text-sm font-semibold text-zinc-950">
            {appointmentText(
              "Dolmetscherantwort",
              "Ответ переводчика",
              "Interpreter response",
            )}
          </h3>
          <div className="mt-4 flex flex-wrap gap-2">
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
        </section>
      ) : null}
    </>
  );
}

type ChecklistSectionState = {
  form: ChecklistFormState;
  submitBusy: boolean;
  completingId: string;
};

type ChecklistSectionAction =
  | { type: "patch"; value: Partial<ChecklistSectionState> }
  | { type: "update"; updater: (state: ChecklistSectionState) => ChecklistSectionState };

const CHECKLIST_SECTION_INITIAL_STATE: ChecklistSectionState = {
  form: blankChecklistForm(),
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
  const [{ form, submitBusy, completingId }, dispatchChecklistState] =
    useReducer(checklistSectionReducer, CHECKLIST_SECTION_INITIAL_STATE);
  const setForm = (value: SetStateAction<ChecklistFormState>) =>
    dispatchChecklistState(createChecklistFieldAction("form", value));
  const setSubmitBusy = (value: SetStateAction<boolean>) =>
    dispatchChecklistState(createChecklistFieldAction("submitBusy", value));
  const setCompletingId = (value: SetStateAction<string>) =>
    dispatchChecklistState(createChecklistFieldAction("completingId", value));

  useEffect(() => {
    dispatchChecklistState({
      type: "patch",
      value: {
        form: blankChecklistForm(),
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
      onRefresh();
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : appointmentText(
              "Checklisteneintrag konnte nicht hinzugefügt werden.",
              "Не удалось добавить пункт чек-листа.",
              "Failed to add checklist item",
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
        error instanceof Error
          ? error.message
          : appointmentText(
              "Element konnte nicht abgeschlossen werden.",
              "Не удалось завершить элемент.",
              "Failed to complete item",
            ),
      );
    } finally {
      setCompletingId("");
    }
  }

  return (
    <section className={appointmentSectionCardClassName("p-5")}>
      <h3 className="text-sm font-semibold text-zinc-950">
        {appointmentText("Checkliste", "Чек-лист", "Checklist")}
      </h3>
      <div className="mt-4 space-y-3">
        {items.length === 0 ? (
          <EmptyState
            text={appointmentText(
              "Für diesen Termin gibt es noch keine Workflow-Schritte.",
              "Для этого приёма ещё нет шагов workflow.",
              "No workflow steps exist for this appointment yet.",
            )}
          />
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              className={appointmentSoftSplitRowClassName}
            >
              <div>
                <p className="text-sm font-medium text-zinc-900">
                  {item.item_text}
                </p>
                <p className="mt-1 text-xs uppercase tracking-[0.12em] text-zinc-500">
                  {checklistPhaseLabel(item.phase)}
                </p>
              </div>
              {item.is_completed ? (
                <span className="text-xs font-medium text-emerald-700">
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
                  {appointmentText(
                    "Als erledigt markieren",
                    "Отметить выполненным",
                    "Mark complete",
                  )}
                </Button>
              )}
            </div>
          ))
        )}
      </div>
      <form
        onSubmit={handleSubmit}
        className="mt-5 grid gap-4 md:grid-cols-[180px_minmax(0,1fr)_auto]"
      >
        <Field label={t.orders_phase}>
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
        <Field label={t.orders_phase}>
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
        <div className="flex items-end">
          <Button
            type="submit"
            disabled={submitBusy || !form.itemText.trim()}
          >
            {submitBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
            {appointmentText(
              "Checklistenpunkt hinzufügen",
              "Добавить пункт чек-листа",
              "Add checklist item",
            )}
          </Button>
        </div>
      </form>
    </section>
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
  const [submitBusy, setSubmitBusy] = useState(false);
  const [completingId, setCompletingId] = useState("");

  const resetReminderState = () => {
    setForm(blankReminderForm());
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
      onRefresh();
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : appointmentText(
              "Erinnerung konnte nicht hinzugefügt werden.",
              "Не удалось добавить напоминание.",
              "Failed to add reminder",
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
        error instanceof Error
          ? error.message
          : appointmentText(
              "Erinnerung konnte nicht abgeschlossen werden.",
              "Не удалось завершить напоминание.",
              "Failed to complete reminder",
            ),
      );
    } finally {
      setCompletingId("");
    }
  }

  return (
    <section className={appointmentSectionCardClassName("p-5")}>
      <h3 className="text-sm font-semibold text-zinc-950">
        {appointmentText("Erinnerungen", "Напоминания", "Reminders")}
      </h3>
      <div className="mt-4 space-y-3">
        {reminders.length === 0 ? (
          <EmptyState
            text={appointmentText(
              "Für diesen Termin gibt es noch keine Erinnerungen.",
              "Для этого приёма ещё нет напоминаний.",
              "No reminders exist for this appointment yet.",
            )}
          />
        ) : (
          reminders.map((item) => (
            <div
              key={item.id}
              className={appointmentSoftSplitRowClassName}
            >
              <div>
                <p className="text-sm font-medium text-zinc-900">
                  {item.title}
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  {item.user_name} · {formatDateTimeLabel(item.remind_at)}
                </p>
                {item.description ? (
                  <p className="mt-2 text-sm text-zinc-600">
                    {item.description}
                  </p>
                ) : null}
              </div>
              {item.is_completed ? (
                <span className="text-xs font-medium text-emerald-700">
                  {appointmentText(
                    "Abgeschlossen",
                    "Завершено",
                    "Completed",
                  )}{" "}
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
                  {appointmentText(
                    "Als erledigt markieren",
                    "Отметить выполненным",
                    "Mark complete",
                  )}
                </Button>
              )}
            </div>
          ))
        )}
      </div>
      {canManageReminders ? (
        <form onSubmit={handleSubmit} className="mt-5 grid gap-4 md:grid-cols-2">
          <Field label={t.patients_assign_owner}>
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
          <Field label={t.appointments_date}>
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
          <Field label={t.appointments_title_col}>
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
          <Field label={t.providers_service_desc}>
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
          <div className="flex justify-end md:col-span-2">
            <Button
              type="submit"
              disabled={
                submitBusy ||
                !form.userId ||
                !form.remindAt ||
                !form.title.trim()
              }
            >
              {submitBusy ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : null}
              {t.appointments_add_reminder}
            </Button>
          </div>
        </form>
      ) : null}
    </section>
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
    <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <ContextCard
        label={casesStatusLabel}
        value={
          openChecklistCount === 0
            ? appointmentText("Bereit", "Р“РѕС‚РѕРІРѕ", "Ready")
            : appointmentText(
                `${openChecklistCount} offen`,
                `${openChecklistCount} РѕС‚РєСЂС‹С‚Рѕ`,
                `${openChecklistCount} open`,
              )
        }
        meta={
          openChecklistCount === 0
            ? appointmentText(
                "Keine offenen Checklistenpunkte.",
                "РќРµС‚ РѕС‚РєСЂС‹С‚С‹С… РїСѓРЅРєС‚РѕРІ С‡РµРє-Р»РёСЃС‚Р°.",
                "No pending checklist items.",
              )
            : appointmentText(
                "Offene Vorbereitungs- oder Follow-up-Schritte zuerst abschlieГџen.",
                "РЎРЅР°С‡Р°Р»Р° Р·Р°РєСЂРѕР№С‚Рµ РѕС‚РєСЂС‹С‚С‹Рµ РїРѕРґРіРѕС‚РѕРІРёС‚РµР»СЊРЅС‹Рµ РёР»Рё follow-up С€Р°РіРё.",
                "Finish outstanding preparation or follow-up steps.",
              )
        }
      />
      <ContextCard
        label={appointmentText("Aufgaben", "Р—Р°РґР°С‡Рё", "Tasks")}
        value={
          openTaskCount === 0
            ? appointmentText("Bereit", "Р“РѕС‚РѕРІРѕ", "Ready")
            : appointmentText(
                `${openTaskCount} offen`,
                `${openTaskCount} РѕС‚РєСЂС‹С‚Рѕ`,
                `${openTaskCount} open`,
              )
        }
        meta={
          openTaskCount === 0
            ? appointmentText(
                "Keine offenen operativen Aufgaben.",
                "РќРµС‚ РѕС‚РєСЂС‹С‚С‹С… РѕРїРµСЂР°С†РёРѕРЅРЅС‹С… Р·Р°РґР°С‡.",
                "No open operational tasks.",
              )
            : appointmentText(
                "Aktive PM-, Dolmetscher- oder Concierge-Aufgaben noch abschlieГџen.",
                "РќСѓР¶РЅРѕ Р·Р°РєСЂС‹С‚СЊ Р°РєС‚РёРІРЅС‹Рµ Р·Р°РґР°С‡Рё PM, РїРµСЂРµРІРѕРґС‡РёРєР° РёР»Рё concierge.",
                "Resolve active PM, interpreter or concierge tasks.",
              )
        }
      />
      <ContextCard
        label={appointmentText("Erinnerungen", "РќР°РїРѕРјРёРЅР°РЅРёСЏ", "Reminders")}
        value={appointmentText(
          `${pendingReminderCount} ausstehend`,
          `${pendingReminderCount} РѕР¶РёРґР°РµС‚`,
          `${pendingReminderCount} pending`,
        )}
        meta={
          pendingReminderCount === 0
            ? appointmentText(
                "Keine offenen Erinnerungen.",
                "РќРµС‚ РѕС‚РєСЂС‹С‚С‹С… РЅР°РїРѕРјРёРЅР°РЅРёР№.",
                "No outstanding reminders.",
              )
            : appointmentText(
                "Offene Erinnerungen bleiben auch nach dem Abschluss aktiv.",
                "РћР¶РёРґР°СЋС‰РёРµ РЅР°РїРѕРјРёРЅР°РЅРёСЏ РѕСЃС‚Р°СЋС‚СЃСЏ Р°РєС‚РёРІРЅС‹РјРё Рё РїРѕСЃР»Рµ Р·Р°РєСЂС‹С‚РёСЏ.",
                "Pending reminders stay active after closure.",
              )
        }
      />
      <ContextCard
        label={interpreterLabel}
        value={
          !detail.interpreter_id
            ? appointmentText("Nicht erforderlich", "РќРµ С‚СЂРµР±СѓРµС‚СЃСЏ", "Not required")
            : interpreterReportReady
              ? appointmentText("Freigegeben", "РЎРѕРіР»Р°СЃРѕРІР°РЅРѕ", "Approved")
              : appointmentText("Ausstehend", "РћР¶РёРґР°РµС‚СЃСЏ", "Pending")
        }
        meta={
          !detail.interpreter_id
            ? appointmentText(
                "Kein Dolmetscher verknupft.",
                "РџРµСЂРµРІРѕРґС‡РёРє РЅРµ РїСЂРёРІСЏР·Р°РЅ.",
                "No interpreter linked.",
              )
            : detailReport
              ? detailReport.approval_status
              : appointmentText(
                  "Bericht noch nicht eingereicht.",
                  "РћС‚С‡С‘С‚ РµС‰С‘ РЅРµ РѕС‚РїСЂР°РІР»РµРЅ.",
                  "No report submitted yet.",
                )
        }
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
  completionWarnings,
  followUpAssigneeId,
  setFollowUpAssigneeId,
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
  completionWarnings: string[];
  followUpAssigneeId: string;
  setFollowUpAssigneeId: (value: string) => void;
  onRefresh: () => void;
  onError: (message: string) => void;
  onNotice: (notice: string) => void;
}) {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const [completionPlan, setCompletionPlan] = useState<Record<string, boolean>>(
    () => defaultCompletionPlan(),
  );
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
    setBusyAction("");
  }, [detail.id, detail.status]);

  async function handleCompleteOnly() {
    setBusyAction("complete");
    try {
      await apiFetch<{ ok: boolean }>(`/appointments/${detail.id}/status`, {
        method: "POST",
        body: JSON.stringify({ status: "completed" }),
      });
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
                description: `Auto-planned during appointment completion for ${detail.patient_pid} · ${detail.title}.`,
              }),
            });
          }),
        );
      }

      onNotice(
        selectedPresets.length > 0
          ? appointmentText(
              `Termin abgeschlossen. ${selectedPresets.length} Follow-up-Erinnerung(en) geplant.`,
              `Приём завершён. Запланировано ${selectedPresets.length} follow-up напоминаний.`,
              `Appointment completed. ${selectedPresets.length} follow-up reminder(s) scheduled.`,
            )
          : appointmentText(
              "Termin abgeschlossen.",
              "Приём завершён.",
              "Appointment completed.",
            ),
      );
      onRefresh();
    } catch (error) {
      if (completed) {
        onError(
          error instanceof Error
            ? appointmentText(
                `Termin abgeschlossen, aber Follow-up-Planung fehlgeschlagen: ${error.message}`,
                `Приём завершён, но планирование follow-up не удалось: ${error.message}`,
                `Appointment completed, but follow-up scheduling failed: ${error.message}`,
              )
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

  return (
    <section className={appointmentSectionCardClassName("p-5")}>
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-zinc-950">
            {appointmentText(
              "Abschlussbereitschaft",
              "Готовность к закрытию",
              "Completion readiness",
            )}
          </h3>
          <p className="text-xs text-zinc-500">
            {appointmentText(
              "Prüfen Sie operative Blocker, bevor Sie den Termin schließen und das Standard-Follow-up starten.",
              "Проверьте операционные блокеры перед закрытием приёма и запуском стандартного follow-up.",
              "Review operational blockers before closing the appointment and launching standard post-care follow-up.",
            )}
          </p>
        </div>
        <span className={appointmentMetaPillClassName}>
          {detail.status === "completed"
            ? appointmentText("Abgeschlossen", "Завершён", "Completed")
            : statusLabel(detail.status)}
        </span>
      </div>
      <AppointmentCompletionReadinessGrid
        casesStatusLabel={t.cases_status}
        detail={detail}
        detailReport={detailReport}
        interpreterLabel={tr.role_interpreter}
        interpreterReportReady={interpreterReportReady}
        openChecklistCount={openChecklistCount}
        openTaskCount={openTaskCount}
        pendingReminderCount={pendingReminderCount}
      />      {completionWarnings.length > 0 ? (
        <div className="mt-4">
          <Banner tone="warning" withIcon>
            <div className="space-y-1">
              {completionWarnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          </Banner>
        </div>
      ) : null}
      {detail.status !== "completed" && detail.status !== "cancelled" ? (
        <div className="mt-5 space-y-4">
          <Field label={tr.patients_assign_owner}>
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
                className={cn(
                  "rounded-2xl",
                  completionPlan[preset.id]
                    ? "bg-zinc-950 text-white hover:bg-zinc-800"
                    : "",
                )}
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
        </div>
      ) : null}
    </section>
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
  onRefresh: () => void;
  onError: (message: string) => void;
}) {
  const { t } = useLang();
  const [statusRecurrenceScope, setStatusRecurrenceScope] =
    useState<AppointmentRecurringActionScope>("single");
  const [busyAction, setBusyAction] = useState("");
  const selectedRecurringStatusTargets = useMemo(
    () =>
      detail.recurrence_frequency
        ? recurringStatusTargetsForScope(detail, statusRecurrenceScope)
        : [
            {
              id: detail.id,
              date: detail.date,
              status: detail.status,
              recurrence_index: detail.recurrence_index,
              open_checklist_count: openChecklistCount,
            },
          ],
    [detail, openChecklistCount, statusRecurrenceScope],
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
    const nextBusyAction = statusActionKey(detail.id, status, recurrenceScope);
    setBusyAction(nextBusyAction);
    try {
      await apiFetch<{ ok: boolean }>(`/appointments/${detail.id}/status`, {
        method: "POST",
        body: JSON.stringify({
          status,
          recurrence_scope: recurrenceScope,
        }),
      });
      onRefresh();
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : appointmentText(
              "Status konnte nicht geändert werden.",
              "Не удалось изменить статус.",
              "Failed to change status",
            ),
      );
    } finally {
      setBusyAction("");
    }
  }

  return (
    <section className={appointmentSectionCardClassName("p-5")}>
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-zinc-950">
            {t.users_status}
          </h3>
          {detail.recurrence_frequency ? (
            <p className="mt-1 text-xs text-zinc-500">
              {t.appointments_scope_bulk_status_hint}
            </p>
          ) : null}
        </div>
        {detail.recurrence_frequency ? (
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
        ) : null}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {STATUS_OPTIONS.map((status) => {
          const recurrenceScope = detail.recurrence_frequency
            ? statusRecurrenceScope
            : "single";
          const nextBusyAction = statusActionKey(detail.id, status, recurrenceScope);
          return (
            <Button
              key={status}
              variant={detail.status === status ? "default" : "outline"}
              className={cn(
                "rounded-2xl",
                detail.status === status
                  ? "bg-zinc-950 text-white hover:bg-zinc-800"
                  : "",
              )}
              disabled={Boolean(busyAction)}
              onClick={() => handleStatusChange(status, recurrenceScope)}
            >
              {busyAction === nextBusyAction ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : null}
              {detail.recurrence_frequency && status === "cancelled"
                ? statusRecurrenceScope === "following"
                  ? t.appointments_cancel_this_and_following
                  : statusRecurrenceScope === "series"
                    ? t.appointments_cancel_whole_series
                    : appointmentText(
                        "Diesen Termin absagen",
                        "Отменить этот приём",
                        "Cancel this occurrence",
                      )
                : statusLabel(status)}
            </Button>
          );
        })}
      </div>
      {detail.recurrence_frequency ? (
        <div className="mt-4 space-y-3">
          <p className="text-xs text-zinc-500">
            {t.appointments_scope_targets}{" "}
            <span className="font-semibold text-zinc-700">
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
    </section>
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
  const [submitBusy, setSubmitBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState("");

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
      setForm(
        blankTaskForm(
          detail.interpreter_id ??
            detail.owner_user_id ??
            assignableStaff[0]?.id ??
            "",
          buildTaskDefaultDueDate(detail),
        ),
      );
      onRefresh();
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : appointmentText(
              "Aufgabe konnte nicht erstellt werden.",
              "Не удалось создать задачу.",
              "Failed to create task",
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
        error instanceof Error
          ? error.message
          : appointmentText(
              "Aufgabe konnte nicht aktualisiert werden.",
              "Не удалось обновить задачу.",
              "Failed to update task",
            ),
      );
    } finally {
      setActionBusy("");
    }
  }

  return (
    <section className={appointmentSectionCardClassName("p-5")}>
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-zinc-950">
            {appointmentText(
              "Operative Aufgaben",
              "Операционные задачи",
              "Operational tasks",
            )}
          </h3>
          <p className="text-xs text-zinc-500">
            {appointmentText(
              "Appointment-gebundenes Follow-up für PM, Teamlead, Dolmetscher und Concierge.",
              "Привязанный к приёму follow-up для PM, teamlead, переводчика и concierge.",
              "Appointment-linked follow-up for PM, teamlead, interpreter and concierge.",
            )}
          </p>
        </div>
        <span className={appointmentMetaPillClassName}>
          {appointmentText(
            `${tasks.length} verknüpft`,
            `${tasks.length} связано`,
            `${tasks.length} linked`,
          )}
        </span>
      </div>
      <div className="mt-4 space-y-3">
        {tasks.length === 0 ? (
          <EmptyState
            text={appointmentText(
              "Für diesen Termin gibt es noch keine operativen Aufgaben.",
              "Для этого приёма ещё нет операционных задач.",
              "No operational tasks exist for this appointment yet.",
            )}
          />
        ) : (
          tasks.map((task) => (
            <div
              key={task.id}
              className={appointmentSoftPanelClassName}
            >
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-zinc-950">
                      {task.title}
                    </p>
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
                      ? appointmentText(
                          ` · Fallig ${formatDateTimeLabel(task.due_date)}`,
                          ` · Срок ${formatDateTimeLabel(task.due_date)}`,
                          ` · Due ${formatDateTimeLabel(task.due_date)}`,
                        )
                      : ""}
                  </p>
                  {task.description ? (
                    <p className="mt-3 text-sm leading-6 text-zinc-600">
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
                      className={cn(
                        "rounded-2xl",
                        task.status === status
                          ? "bg-zinc-950 text-white hover:bg-zinc-800"
                          : "",
                      )}
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
            </div>
          ))
        )}
      </div>
      {canCreateTasks ? (
        <form onSubmit={handleTaskSubmit} className="mt-5 grid gap-4 md:grid-cols-2">
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
              className={appointmentSlateInputClassName}
              required
            />
          </Field>
          <Field label={tr.patients_assign_owner}>
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
          <Field label={tr.invoices_due_at}>
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
          <Field label={t.users_status}>
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
          <Field label={t.providers_service_desc}>
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
          <div className="flex items-end justify-end md:col-span-2">
            <Button
              type="submit"
              disabled={submitBusy || !form.title.trim() || !form.assignedTo}
            >
              {submitBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {t.appointments_workflow_add_task}
            </Button>
          </div>
        </form>
      ) : null}
    </section>
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
