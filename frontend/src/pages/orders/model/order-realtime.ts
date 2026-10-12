import { isPassiveRealtimeBatch, passiveRefreshDue } from "@/pages/concierge/use-task-realtime";
import type { RealtimeEvent } from "@/lib/realtime";

/**
 * Whether the order workspace may skip a realtime batch (QA C-33): the
 * socket's own "connected" frame arrives right after the page loaded and
 * changed nothing; reloading on it requested every endpoint of the
 * workspace twice. The same rule as the task manager (`use-task-realtime.ts`):
 * a passive frame later than the minimum gap, `resync_required` and every
 * real change still reload.
 */
export function skipPassiveOrderRefresh(
  events: readonly RealtimeEvent[],
  workspaceLoadedAt: number,
  now = Date.now(),
): boolean {
  return isPassiveRealtimeBatch(events) && !passiveRefreshDue(workspaceLoadedAt, now);
}
