import {
  availableConciergeTaskStatuses,
  type ConciergeTaskStatus,
} from "@/pages/concierge/model";

import type { TaskEntry } from "./types";

const KNOWN_STATUSES: readonly ConciergeTaskStatus[] = [
  "open",
  "in_progress",
  "on_hold",
  "review",
  "completed",
  "cancelled",
];

function isKnownStatus(value: string): value is ConciergeTaskStatus {
  return (KNOWN_STATUSES as readonly string[]).includes(value);
}

/**
 * Statuses an actor may pick for an appointment task. Appointment tasks follow
 * the work-center rules (`POST /concierge-operational-items/{id}/status`): the
 * assignee moves the task to review, and the creator or a higher role closes
 * it. The current status is always first. An archived task is restored in the
 * work center before its status changes, so it offers only its own status.
 */
export function appointmentTaskStatusOptions(
  task: Pick<
    TaskEntry,
    "status" | "assigned_to" | "assigned_by" | "assigned_by_role" | "archived_at"
  >,
  actorId: string | null | undefined,
  actorRole: string | null | undefined,
): string[] {
  if (!isKnownStatus(task.status) || task.archived_at) return [task.status];
  return availableConciergeTaskStatuses(
    {
      status: task.status,
      assigned_to: task.assigned_to,
      assigned_by: task.assigned_by,
      assigned_by_role: task.assigned_by_role ?? null,
    },
    actorId,
    actorRole,
  );
}

/** Work-center status endpoint with the optimistic-lock token of the task. */
export function appointmentTaskStatusRequest(task: Pick<TaskEntry, "id" | "updated_at">, status: string) {
  return {
    path: `/concierge-operational-items/${task.id}/status`,
    body: { expected_updated_at: task.updated_at, status },
  };
}
