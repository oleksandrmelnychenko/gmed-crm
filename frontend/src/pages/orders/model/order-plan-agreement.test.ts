import { describe, expect, it } from "vitest";

import { planAgreementSteps, planNotePayload } from "./order-plan-agreement";

describe("plan agreement steps", () => {
  it("follows the manual agreement: sent, answer, finalisation", () => {
    const next = (status: string) => planAgreementSteps(status).map((step) => step.status);
    expect(next("draft")).toEqual(["sent"]);
    expect(next("sent")).toEqual(["agreed", "correction_requested"]);
    expect(next("correction_requested")).toEqual(["sent"]);
    expect(next("agreed")).toEqual(["finalized", "correction_requested"]);
    expect(next("finalized")).toEqual(["correction_requested"]);
  });

  it("sends the note only when it changed", () => {
    expect(planNotePayload("Patient wants Monday", "Patient wants Monday ")).toBeUndefined();
    expect(planNotePayload(" new note ", "old")).toBe("new note");
    expect(planNotePayload("", "old")).toBe("");
    expect(planNotePayload("", null)).toBeUndefined();
  });
});
