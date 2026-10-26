import { describe, expect, it } from "vitest";

import type { RealtimeEvent } from "@/lib/realtime";

import {
  isLeadPurgedEvent,
  leadPurgedText,
  leadPurgedTitle,
  purgedLeadIds,
  touchesLeadTimeState,
} from "./lead-time-events";

function event(type: string, entityId: string, entityType = "lead"): RealtimeEvent {
  return { type, entity_type: entityType, entity_id: entityId, payload: {} };
}

describe("timed lead events (owner request 2026-10-26)", () => {
  it("collects the leads the retention sweep deleted", () => {
    const events = [
      event("lead.purged", "a"),
      event("lead.updated", "b"),
      event("lead.purged", "c"),
      event("lead.purged", "d", "patient"),
    ];
    expect(purgedLeadIds(events)).toEqual(new Set(["a", "c"]));
    expect(purgedLeadIds([])).toEqual(new Set());
  });

  it("tells the open wizard only about its own lead", () => {
    expect(isLeadPurgedEvent(event("lead.purged", "a"), "a")).toBe(true);
    expect(isLeadPurgedEvent(event("lead.purged", "a"), "b")).toBe(false);
    expect(isLeadPurgedEvent(event("lead.updated", "a"), "a")).toBe(false);
    expect(isLeadPurgedEvent(event("lead.purged", "a"), null)).toBe(false);
  });

  it("reads the lead again after the warning or the 18th birthday of that lead", () => {
    expect(touchesLeadTimeState([event("lead.retention_warning", "a")], "a")).toBe(true);
    expect(touchesLeadTimeState([event("lead.coming_of_age_soon", "a")], "a")).toBe(true);
    expect(touchesLeadTimeState([event("lead.came_of_age", "a")], "a")).toBe(true);
    expect(touchesLeadTimeState([event("lead.retention_warning", "b")], "a")).toBe(false);
    expect(touchesLeadTimeState([event("lead.purged", "a")], "a")).toBe(false);
    expect(touchesLeadTimeState([event("lead.retention_warning", "a")], null)).toBe(false);
  });

  it("words the deleted lead in RU and DE", () => {
    expect(leadPurgedTitle("ru")).toBe("Лид удалён по сроку хранения");
    expect(leadPurgedTitle("de")).toBe("Lead wegen Ablauf der Aufbewahrungsfrist gelöscht");
    expect(leadPurgedText("ru")).toMatch(/удалён автоматически/);
    expect(leadPurgedText("de")).toMatch(/automatisch gelöscht/);
  });
});
