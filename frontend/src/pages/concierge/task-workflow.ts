import { conciergeTaskInterval, type ConciergeTask } from "./model";

/** Counts include nested tasks/events, and do not change with board filters. */
export function taskWorkflowCounts(tasks: ConciergeTask[]) {
  const byId = new Map(tasks.map(task => [task.id, task]));
  const counts = new Map<string, { total: number; paused: number }>();
  for (const task of byId.values()) {
    const visited = new Set([task.id]);
    let parent = task.parent_task_id;
    while (parent && byId.has(parent) && !visited.has(parent)) {
      visited.add(parent);
      const count = counts.get(parent) ?? { total: 0, paused: 0 };
      count.total++;
      if (task.status === "on_hold" && !task.archived_at) count.paused++;
      counts.set(parent, count);
      parent = byId.get(parent)?.parent_task_id;
    }
  }
  return counts;
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
