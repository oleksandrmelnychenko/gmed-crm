import type { ConciergeTask, ConciergeTaskStatus } from "@/pages/concierge/model";

import type { ProjectWorkflowDependency } from "./model";

export const WORKFLOW_STAGE_ORDER: ConciergeTaskStatus[] = [
  "open",
  "in_progress",
  "review",
  "completed",
  "cancelled",
];

export const WORKFLOW_NODE_WIDTH = 252;
export const WORKFLOW_NODE_HEIGHT = 158;
export const WORKFLOW_STAGE_WIDTH = 292;
export const WORKFLOW_STAGE_START_X = 332;
export const WORKFLOW_TASK_START_Y = 88;
export const WORKFLOW_TASK_STEP_Y = 178;

export type ProjectWorkflowNode = {
  task: ConciergeTask;
  x: number;
  y: number;
  incoming: ProjectWorkflowDependency[];
  outgoing: ProjectWorkflowDependency[];
  unresolvedIncoming: ProjectWorkflowDependency[];
};

export type ProjectWorkflowEdge = {
  id: string;
  dependency: ProjectWorkflowDependency | null;
  sourceTaskId: string | null;
  targetTaskId: string;
  path: string;
  targetX: number;
  targetY: number;
  resolved: boolean;
};

export type ProjectWorkflowGraph = {
  stages: ConciergeTaskStatus[];
  nodes: ProjectWorkflowNode[];
  edges: ProjectWorkflowEdge[];
  width: number;
  height: number;
};

export type ProjectWorkflowStats = {
  total: number;
  completed: number;
  blocked: number;
  overdue: number;
  progress: number;
};

function taskById(tasks: ConciergeTask[]) {
  return new Map(tasks.map((task) => [task.id, task]));
}

function dependencyIsResolved(
  dependency: ProjectWorkflowDependency,
  tasksById: Map<string, ConciergeTask>,
) {
  return tasksById.get(dependency.depends_on_task_id)?.status === "completed";
}

function forwardEdgePath(source: ProjectWorkflowNode, target: ProjectWorkflowNode) {
  const startX = source.x + WORKFLOW_NODE_WIDTH;
  const startY = source.y + WORKFLOW_NODE_HEIGHT / 2;
  const targetX = target.x;
  const targetY = target.y + WORKFLOW_NODE_HEIGHT / 2;
  const control = Math.max(44, Math.abs(targetX - startX) * 0.46);

  return {
    path: `M ${startX} ${startY} C ${startX + control} ${startY}, ${targetX - control} ${targetY}, ${targetX} ${targetY}`,
    targetX,
    targetY,
  };
}

function sameOrBackwardsEdgePath(source: ProjectWorkflowNode, target: ProjectWorkflowNode) {
  const startX = source.x + WORKFLOW_NODE_WIDTH;
  const startY = source.y + WORKFLOW_NODE_HEIGHT / 2;
  const targetX = target.x + WORKFLOW_NODE_WIDTH;
  const targetY = target.y + WORKFLOW_NODE_HEIGHT / 2;
  const routeX = Math.max(startX, targetX) + 42;

  return {
    path: `M ${startX} ${startY} C ${routeX} ${startY}, ${routeX} ${targetY}, ${targetX} ${targetY}`,
    targetX,
    targetY,
  };
}

export function buildProjectWorkflowGraph(
  tasks: ConciergeTask[],
  dependencies: ProjectWorkflowDependency[],
  visibleTaskIds?: ReadonlySet<string>,
): ProjectWorkflowGraph {
  const visibleTasks = visibleTaskIds ? tasks.filter((task) => visibleTaskIds.has(task.id)) : tasks;
  const stages = WORKFLOW_STAGE_ORDER.filter(
    (stage) => stage !== "cancelled" || visibleTasks.some((task) => task.status === "cancelled"),
  );
  const tasksById = taskById(tasks);
  const validDependencies = dependencies.filter(
    (dependency) => tasksById.has(dependency.task_id) && tasksById.has(dependency.depends_on_task_id),
  );

  const nodes = stages.flatMap((stage, stageIndex) =>
    visibleTasks
      .filter((task) => task.status === stage)
      .sort((left, right) => {
        const leftDate = left.due_at ?? left.created_at;
        const rightDate = right.due_at ?? right.created_at;
        return leftDate.localeCompare(rightDate) || left.title.localeCompare(right.title);
      })
      .map((task, taskIndex): ProjectWorkflowNode => {
        const incoming = validDependencies.filter((dependency) => dependency.task_id === task.id);
        const outgoing = validDependencies.filter(
          (dependency) => dependency.depends_on_task_id === task.id,
        );

        return {
          task,
          x: WORKFLOW_STAGE_START_X + stageIndex * WORKFLOW_STAGE_WIDTH,
          y: WORKFLOW_TASK_START_Y + taskIndex * WORKFLOW_TASK_STEP_Y,
          incoming,
          outgoing,
          unresolvedIncoming: task.status === "completed" || task.status === "cancelled" ? [] : incoming.filter(
            (dependency) => !dependencyIsResolved(dependency, tasksById),
          ),
        };
      }),
  );
  const nodesById = new Map(nodes.map((node) => [node.task.id, node]));
  const dependencyEdges: ProjectWorkflowEdge[] = validDependencies.flatMap((dependency) => {
    const source = nodesById.get(dependency.depends_on_task_id);
    const target = nodesById.get(dependency.task_id);
    if (!source || !target) return [];

    const geometry = source.x < target.x
      ? forwardEdgePath(source, target)
      : sameOrBackwardsEdgePath(source, target);

    return [{
      id: dependency.id,
      dependency,
      sourceTaskId: source.task.id,
      targetTaskId: target.task.id,
      ...geometry,
      resolved: dependencyIsResolved(dependency, tasksById),
    }];
  });
  const rootEdges: ProjectWorkflowEdge[] = nodes
    .filter((node) => node.incoming.length === 0)
    .map((node) => {
      const startX = 260;
      const startY = 163;
      const targetX = node.x;
      const targetY = node.y + WORKFLOW_NODE_HEIGHT / 2;
      const control = Math.max(38, (targetX - startX) * 0.45);

      return {
        id: `root-${node.task.id}`,
        dependency: null,
        sourceTaskId: null,
        targetTaskId: node.task.id,
        path: `M ${startX} ${startY} C ${startX + control} ${startY}, ${targetX - control} ${targetY}, ${targetX} ${targetY}`,
        targetX,
        targetY,
        resolved: true,
      };
    });
  const largestStage = Math.max(
    1,
    ...stages.map((stage) => visibleTasks.filter((task) => task.status === stage).length),
  );

  return {
    stages,
    nodes,
    edges: [...rootEdges, ...dependencyEdges],
    width: WORKFLOW_STAGE_START_X + stages.length * WORKFLOW_STAGE_WIDTH + 36,
    height: Math.max(470, WORKFLOW_TASK_START_Y + largestStage * WORKFLOW_TASK_STEP_Y + 30),
  };
}

export function projectWorkflowBlockedTaskIds(
  tasks: ConciergeTask[],
  dependencies: ProjectWorkflowDependency[],
) {
  const tasksById = taskById(tasks);
  return new Set(dependencies.filter((dependency) => {
    const target = tasksById.get(dependency.task_id);
    return target && target.status !== "completed" && target.status !== "cancelled"
      && tasksById.has(dependency.depends_on_task_id)
      && !dependencyIsResolved(dependency, tasksById);
  }).map((dependency) => dependency.task_id));
}

export function projectWorkflowStats(
  tasks: ConciergeTask[],
  dependencies: ProjectWorkflowDependency[],
  now = new Date(),
): ProjectWorkflowStats {
  const blockedTaskIds = projectWorkflowBlockedTaskIds(tasks, dependencies);
  const completed = tasks.filter((task) => task.status === "completed").length;
  const overdue = tasks.filter((task) => {
    if (!task.due_at || task.status === "completed" || task.status === "cancelled") return false;
    return new Date(task.due_at).getTime() < now.getTime();
  }).length;

  return {
    total: tasks.length,
    completed,
    blocked: blockedTaskIds.size,
    overdue,
    progress: tasks.length ? Math.round((completed / tasks.length) * 100) : 0,
  };
}

export function dependencyWouldCreateCycle(
  dependencies: ProjectWorkflowDependency[],
  taskId: string,
  dependsOnTaskId: string,
) {
  if (taskId === dependsOnTaskId) return true;
  const prerequisites = new Map<string, string[]>();
  for (const dependency of dependencies) {
    const current = prerequisites.get(dependency.task_id) ?? [];
    current.push(dependency.depends_on_task_id);
    prerequisites.set(dependency.task_id, current);
  }

  const pending = [dependsOnTaskId];
  const visited = new Set<string>();
  while (pending.length) {
    const candidate = pending.pop();
    if (!candidate || visited.has(candidate)) continue;
    if (candidate === taskId) return true;
    visited.add(candidate);
    pending.push(...(prerequisites.get(candidate) ?? []));
  }

  return false;
}

export function availablePrerequisites(
  tasks: ConciergeTask[],
  dependencies: ProjectWorkflowDependency[],
  taskId: string,
) {
  const existing = new Set(
    dependencies
      .filter((dependency) => dependency.task_id === taskId)
      .map((dependency) => dependency.depends_on_task_id),
  );

  return tasks.filter(
    (task) => task.id !== taskId
      && !existing.has(task.id)
      && !dependencyWouldCreateCycle(dependencies, taskId, task.id),
  );
}
