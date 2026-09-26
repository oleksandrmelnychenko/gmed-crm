import { describe, expect, it } from "vitest";

import type { ConciergeTask } from "./model";
import {
  linkedTaskCreateErrorMessage,
  linkedTaskOpenCount,
  linkedTasksRequestPath,
} from "./linked-tasks-section";

function task(status: string): ConciergeTask {
  return { status } as ConciergeTask;
}

describe("linked profile tasks", () => {
  it("counts only non-terminal tasks", () => {
    expect(linkedTaskOpenCount([
      task("open"),
      task("in_progress"),
      task("review"),
      task("completed"),
      task("cancelled"),
    ])).toBe(3);
  });

  it("reports create failures as create failures in the staff language", () => {
    expect(linkedTaskCreateErrorMessage(new Error(""), "ru")).toBe("Не удалось создать задачу.");
    expect(linkedTaskCreateErrorMessage(null, "de")).toBe("Die Aufgabe konnte nicht erstellt werden.");
    expect(linkedTaskCreateErrorMessage(new Error("due_at must be after starts_at"), "ru"))
      .toBe("Окончание должно быть позже начала.");
  });

  it("builds a patient or provider filtered request", () => {
    expect(linkedTasksRequestPath({ patientId: "patient-1" }))
      .toBe("/concierge-operational-items?patient_id=patient-1");
    expect(linkedTasksRequestPath({ providerId: "provider-1" }))
      .toBe("/concierge-operational-items?provider_id=provider-1");
  });
});
