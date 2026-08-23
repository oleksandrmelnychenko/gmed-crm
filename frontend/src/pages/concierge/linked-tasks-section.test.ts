import { describe, expect, it } from "vitest";

import type { ConciergeTask } from "./model";
import { linkedTaskOpenCount, linkedTasksRequestPath } from "./linked-tasks-section";

function task(status: string): ConciergeTask {
  return { status } as ConciergeTask;
}

describe("linked profile tasks", () => {
  it("counts only non-terminal tasks", () => {
    expect(linkedTaskOpenCount([
      task("open"),
      task("in_progress"),
      task("completed"),
      task("cancelled"),
    ])).toBe(2);
  });

  it("builds a patient or provider filtered request", () => {
    expect(linkedTasksRequestPath({ patientId: "patient-1" }))
      .toBe("/concierge-operational-items?patient_id=patient-1");
    expect(linkedTasksRequestPath({ providerId: "provider-1" }))
      .toBe("/concierge-operational-items?provider_id=provider-1");
  });
});
