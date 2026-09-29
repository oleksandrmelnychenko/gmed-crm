import { DirtyDismissConfirmDialog } from "@/components/ui/dirty-dismiss-confirm-dialog";
import { apiFetch, clearApiCache } from "@/lib/api";
import type { Lang } from "@/lib/i18n";
import { localizeTaskTitle } from "@/lib/task-labels";

import {
  availableConciergeTaskStatuses,
  type ConciergeTask,
  type ConciergeTaskDetail,
} from "./model";

const copy = {
  de: {
    closeTitle: "Offene Unteraufgaben",
    closeMessage: (title: string, count: number, action: ParentCloseAction) =>
      `„${title}“ hat noch ${count} offene Unteraufgabe(n) oder Termin(e). Sollen sie beim ${action === "archive" ? "Archivieren" : action === "cancel" ? "Stornieren" : "Abschließen"} ebenfalls geschlossen werden?`,
    skipped: (count: number) =>
      `${count} Unteraufgabe(n) bleiben offen: nur ihr Ersteller oder eine höhere Rolle darf sie schließen.`,
    closeAll: "Alle schließen",
    keepOpen: "Offen lassen",
    cancel: "Abbrechen",
    suggestTitle: "Alle Unteraufgaben erledigt",
    suggestMessage: (title: string) =>
      `Alle Unteraufgaben und Termine von „${title}“ sind erledigt. Möchten Sie die übergeordnete Aufgabe jetzt abschließen?`,
    suggestOpen: "Aufgabe öffnen",
    suggestComplete: "Aufgabe abschließen",
    later: "Später",
  },
  ru: {
    closeTitle: "Открытые подзадачи",
    closeMessage: (title: string, count: number, action: ParentCloseAction) =>
      `У задачи «${title}» остаются открытыми подзадачи или события: ${count}. Закрыть их вместе с ${action === "archive" ? "переносом задачи в архив" : action === "cancel" ? "отменой задачи" : "завершением задачи"}?`,
    skipped: (count: number) =>
      `Подзадачи остались открытыми (${count}): закрыть их может только автор или вышестоящая роль.`,
    closeAll: "Закрыть все",
    keepOpen: "Оставить открытыми",
    cancel: "Отмена",
    suggestTitle: "Все подзадачи выполнены",
    suggestMessage: (title: string) =>
      `Все подзадачи и события задачи «${title}» выполнены. Завершить основную задачу сейчас?`,
    suggestOpen: "Открыть задачу",
    suggestComplete: "Завершить задачу",
    later: "Позже",
  },
} as const;

export type ParentCloseAction = "complete" | "cancel" | "archive";

/** The status a parent's open sub-tasks are closed with, or null. */
export function subtaskCloseStatus(status: string): "completed" | "cancelled" | null {
  return status === "completed" || status === "cancelled" ? status : null;
}

/**
 * Closes the open sub-tasks and events below a task (any depth) with the
 * parent's new status, before the parent itself is completed, cancelled or
 * archived. The server applies the review rule per sub-task: only those the
 * actor may close (its creator or a higher role) are closed, the others stay
 * open and are reported as `skipped_count`.
 */
export async function closeOpenSubtasks(taskId: string, status: "completed" | "cancelled") {
  const result = await apiFetch<{ closed_count: number; skipped_count?: number }>(
    `/concierge-operational-items/${taskId}/close-children`,
    { method: "POST", body: JSON.stringify({ status }) },
  );
  clearApiCache("/concierge-operational-items");
  return result;
}

/** A notice about sub-tasks the actor was not allowed to close, or null. */
export function skippedSubtasksNotice(
  result: { skipped_count?: number } | null | undefined,
  lang: Lang,
): string | null {
  const skipped = result?.skipped_count ?? 0;
  return skipped > 0 ? copy[lang].skipped(skipped) : null;
}

export type ParentCloseRequest = {
  task: ConciergeTask;
  openCount: number;
  archive: boolean;
  /** The parent's new status when it is completed or cancelled. */
  status?: "completed" | "cancelled";
  /** Runs the parent's change, closing its sub-tasks first when asked. */
  run: (closeChildren: boolean) => Promise<void>;
};

function parentCloseAction(request: ParentCloseRequest): ParentCloseAction {
  if (request.archive) return "archive";
  return request.status === "cancelled" ? "cancel" : "complete";
}

/** Asks what happens to open sub-tasks when their parent is closed. */
export function ParentCloseChoiceDialog({
  request,
  lang,
  onDone,
}: {
  request: ParentCloseRequest | null;
  lang: Lang;
  onDone: () => void;
}) {
  const labels = copy[lang];
  const choose = (closeChildren: boolean) => {
    if (!request) return;
    onDone();
    void request.run(closeChildren);
  };
  return (
    <DirtyDismissConfirmDialog
      open={Boolean(request)}
      title={labels.closeTitle}
      message={request ? labels.closeMessage(localizeTaskTitle(request.task.title, lang), request.openCount, parentCloseAction(request)) : ""}
      cancelLabel={labels.cancel}
      confirmLabel={labels.keepOpen}
      saveLabel={labels.closeAll}
      onCancel={onDone}
      onConfirm={() => choose(false)}
      onSave={() => choose(true)}
    />
  );
}

export type ParentCompletionSuggestion = {
  parent: ConciergeTask;
  canComplete: boolean;
};

/**
 * After a sub-task was completed: the parent when it is still open and has no
 * open sub-tasks left, so completing it can be suggested (never done
 * silently).
 */
export async function completableParentAfterChild(
  child: Pick<ConciergeTask, "parent_task_id">,
  actorId: string | null | undefined,
  actorRole: string | null | undefined,
): Promise<ParentCompletionSuggestion | null> {
  if (!child.parent_task_id) return null;
  try {
    const detail = await apiFetch<ConciergeTaskDetail>(
      `/concierge-operational-items/${child.parent_task_id}`,
      { forceFresh: true },
    );
    const parent = detail.item;
    if (
      parent.archived_at
      || parent.status === "completed"
      || parent.status === "cancelled"
      || (parent.child_open_count ?? 0) > 0
    ) {
      return null;
    }
    return { parent, canComplete: parentCompletionPath(parent, actorId, actorRole) !== null };
  } catch {
    // The parent may be invisible to the actor; nothing to suggest then.
    return null;
  }
}

/** Status steps that complete a task for this actor, or null if they cannot. */
export function parentCompletionPath(
  parent: Pick<ConciergeTask, "status" | "assigned_to" | "assigned_by" | "assigned_by_role" | "can_manage">,
  actorId: string | null | undefined,
  actorRole: string | null | undefined,
): Array<"in_progress" | "completed"> | null {
  const direct = availableConciergeTaskStatuses(parent, actorId, actorRole);
  if (direct.includes("completed")) return ["completed"];
  if (!direct.includes("in_progress")) return null;
  const afterStart = availableConciergeTaskStatuses(
    { ...parent, status: "in_progress" },
    actorId,
    actorRole,
  );
  return afterStart.includes("completed") ? ["in_progress", "completed"] : null;
}

/** Completes the parent, starting it first when it was never started. */
export async function completeParentTask(
  parent: ConciergeTask,
  actorId: string | null | undefined,
  actorRole: string | null | undefined,
): Promise<ConciergeTask> {
  const steps = parentCompletionPath(parent, actorId, actorRole);
  if (!steps) throw new Error("Invalid task status transition");
  let current = parent;
  for (const status of steps) {
    current = await apiFetch<ConciergeTask>(`/concierge-operational-items/${current.id}/status`, {
      method: "POST",
      body: JSON.stringify({ expected_updated_at: current.updated_at, status }),
    });
  }
  clearApiCache("/concierge-operational-items");
  return current;
}

/** Suggests completing a parent whose last open sub-task was just completed. */
export function ParentCompletionSuggestionDialog({
  suggestion,
  lang,
  onOpenParent,
  onComplete,
  onDone,
}: {
  suggestion: ParentCompletionSuggestion | null;
  lang: Lang;
  onOpenParent?: (parent: ConciergeTask) => void;
  onComplete: (parent: ConciergeTask) => void;
  onDone: () => void;
}) {
  const labels = copy[lang];
  const parent = suggestion?.parent ?? null;
  const canComplete = Boolean(suggestion?.canComplete);
  const complete = () => {
    onDone();
    if (parent) onComplete(parent);
  };
  const openParent = () => {
    onDone();
    if (parent && onOpenParent) onOpenParent(parent);
  };
  // Without a way to open the parent here, completing it is the only action.
  const opensParent = Boolean(onOpenParent);
  return (
    <DirtyDismissConfirmDialog
      open={Boolean(parent) && (canComplete || opensParent)}
      title={labels.suggestTitle}
      message={parent ? labels.suggestMessage(localizeTaskTitle(parent.title, lang)) : ""}
      cancelLabel={labels.later}
      confirmLabel={opensParent ? labels.suggestOpen : labels.suggestComplete}
      saveLabel={opensParent && canComplete ? labels.suggestComplete : undefined}
      onCancel={onDone}
      onConfirm={opensParent ? openParent : complete}
      onSave={opensParent && canComplete ? complete : undefined}
    />
  );
}
