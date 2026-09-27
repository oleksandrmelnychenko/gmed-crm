import { conciergeTaskInterval, type ConciergeTask } from "./model";

export type TaskWorkflowCount = {
  /** Every nested sub-task and event. */
  total: number;
  paused: number;
  /** Completed ones, for done/active progress. */
  done: number;
  /** Not cancelled: the work the progress is measured against. */
  active: number;
  /** Still to do: neither completed nor cancelled. */
  open: number;
};

/** Counts include nested tasks/events, and do not change with board filters. */
export function taskWorkflowCounts(tasks: ConciergeTask[]) {
  const byId = new Map(tasks.map(task => [task.id, task]));
  const counts = new Map<string, TaskWorkflowCount>();
  for (const task of byId.values()) {
    const visited = new Set([task.id]);
    let parent = task.parent_task_id;
    while (parent && byId.has(parent) && !visited.has(parent)) {
      visited.add(parent);
      const count = counts.get(parent) ?? { total: 0, paused: 0, done: 0, active: 0, open: 0 };
      count.total++;
      if (task.status === "on_hold" && !task.archived_at) count.paused++;
      if (task.status !== "cancelled") count.active++;
      if (task.status === "completed") count.done++;
      else if (task.status !== "cancelled") count.open++;
      counts.set(parent, count);
      parent = byId.get(parent)?.parent_task_id;
    }
  }
  return counts;
}

/** Done/total of sub-tasks and events; cancelled ones are not counted. */
export function subtaskProgress(tasks: Pick<ConciergeTask, "status">[]) {
  const active = tasks.filter(task => task.status !== "cancelled");
  return {
    done: active.filter(task => task.status === "completed").length,
    total: active.length,
  };
}

/**
 * Open (neither completed nor cancelled) sub-tasks and events below a task.
 * Uses the loaded branch and falls back to the server's count of open direct
 * children when the list does not hold them (e.g. a task opened elsewhere).
 */
export function openSubtaskCount(
  task: Pick<ConciergeTask, "id" | "child_open_count">,
  tasks: ConciergeTask[],
) {
  const loaded = taskWorkflowCounts(tasks).get(task.id)?.open ?? 0;
  return Math.max(loaded, task.child_open_count ?? 0);
}

/** Build only this task's visible branch, independently of board filters. */
export function taskWorkflowRows(tasks: ConciergeTask[], rootId: string) {
  const root = tasks.find(task => task.id === rootId);
  if (!root) return [];
  const children = new Map<string, ConciergeTask[]>();
  for (const task of tasks) {
    if (!task.parent_task_id) continue;
    const siblings = children.get(task.parent_task_id) ?? [];
    siblings.push(task);
    children.set(task.parent_task_id, siblings);
  }
  const startTime = (task: ConciergeTask) => {
    const interval = conciergeTaskInterval(task);
    return (interval.start ?? interval.end)?.getTime() ?? Number.MAX_SAFE_INTEGER;
  };
  for (const siblings of children.values()) {
    siblings.sort((a, b) => startTime(a) - startTime(b) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  }
  const rows: { task: ConciergeTask; depth: number }[] = [];
  const visited = new Set<string>();
  const pending = [{ task: root, depth: 0 }];
  while (pending.length) {
    const row = pending.pop()!;
    if (visited.has(row.task.id)) continue;
    visited.add(row.task.id);
    rows.push(row);
    const descendants = children.get(row.task.id) ?? [];
    for (let index = descendants.length - 1; index >= 0; index--) {
      pending.push({ task: descendants[index], depth: row.depth + 1 });
    }
  }
  return rows;
}
