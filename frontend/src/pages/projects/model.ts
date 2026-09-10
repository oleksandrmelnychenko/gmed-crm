export type ProjectStatus = "planned" | "active" | "on_hold" | "completed" | "cancelled";

export type ProjectPriority = "low" | "normal" | "high" | "urgent";

export type ProjectMember = {
  id: string;
  name: string;
  role: string;
  member_role: "manager" | "member";
};

export type Project = {
  id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  priority: ProjectPriority;
  owner_id: string;
  owner_name: string;
  patient_id: string | null;
  patient_name: string | null;
  starts_on: string | null;
  due_on: string | null;
  created_by: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
  task_total: number;
  task_completed: number;
  member_count: number;
  members?: ProjectMember[];
};

export type ProjectWorkflowDependency = {
  id: string;
  task_id: string;
  depends_on_task_id: string;
  created_by: string;
  created_by_name: string;
  created_at: string;
};

export function canManageProject(project: Project, actor: { id: string; role: string }) {
  if (actor.role === "concierge") return project.created_by === actor.id;
  return actor.role === "ceo" || project.owner_id === actor.id
    || Boolean(project.members?.some(member => member.id === actor.id && member.member_role === "manager"));
}

export type ProjectFormValue = {
  name: string;
  description: string | null;
  status: ProjectStatus;
  priority: ProjectPriority;
  owner_id: string;
  patient_id: string | null;
  starts_on: string | null;
  due_on: string | null;
  member_ids: string[];
};
