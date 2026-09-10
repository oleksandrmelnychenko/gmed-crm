import { describe, expect, it } from "vitest";
import { TASK_REALTIME_EVENTS, taskRealtimeBatchAffects } from "./use-task-realtime";

const event = (entity_id: string, type = "concierge_operational_item.updated") => ({ type, entity_id, entity_type: "task" });

describe("task realtime subscriptions", () => {
  it("does not discard a relevant update when another task is last in a burst", () => {
    expect(taskRealtimeBatchAffects([event("open"), event("other")], "open")).toBe(true);
    expect(taskRealtimeBatchAffects([event("other")], "open")).toBe(false);
  });
  it("resynchronizes scoped details and unscoped lists after reconnect", () => {
    for (const type of ["realtime.connected", "realtime.resync_required"]) {
      expect(taskRealtimeBatchAffects([event("user", type)], "open")).toBe(true);
    }
    expect(taskRealtimeBatchAffects([event("child")])).toBe(true);
    expect(taskRealtimeBatchAffects([], "open")).toBe(false);
  });
  it("covers lifecycle, reminder, collaboration and file changes in every task view", () => {
    for (const suffix of ["created", "updated", "deleted", "archived", "restored", "reminder_sent", "comment_added", "comment_edited", "comment_deleted", "checklist_item_added", "checklist_item_toggled", "checklist_item_edited", "checklist_item_deleted", "attachment_added", "attachment_deleted"]) {
      expect(TASK_REALTIME_EVENTS).toContain(`concierge_operational_item.${suffix}`);
    }
  });
});
