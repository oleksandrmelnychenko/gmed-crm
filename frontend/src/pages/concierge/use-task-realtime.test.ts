import { describe, expect, it } from "vitest";
import {
  isPassiveRealtimeBatch,
  PASSIVE_REFRESH_MIN_GAP_MS,
  passiveRefreshDue,
  TASK_REALTIME_EVENTS,
  taskRealtimeBatchAffects,
} from "./use-task-realtime";

// QA C-33: focus or the socket connecting right after the page loaded loaded
// every list a second time.
describe("passive task refresh", () => {
  it("does not repeat a load that just happened", () => {
    expect(passiveRefreshDue(10_000, 10_000 + PASSIVE_REFRESH_MIN_GAP_MS - 1)).toBe(false);
    expect(passiveRefreshDue(10_000, 10_000 + PASSIVE_REFRESH_MIN_GAP_MS)).toBe(true);
  });
  it("treats only a bare (re)connect as passive; a resync or a change always reloads", () => {
    const frame = (type: string) => ({ type, entity_type: "realtime", entity_id: "user" });
    expect(isPassiveRealtimeBatch([frame("realtime.connected")])).toBe(true);
    expect(isPassiveRealtimeBatch([frame("realtime.resync_required")])).toBe(false);
    expect(isPassiveRealtimeBatch([frame("realtime.connected"), frame("task.created")])).toBe(false);
    expect(isPassiveRealtimeBatch([])).toBe(false);
  });
});

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
