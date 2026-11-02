import { describe, expect, it } from "vitest";

import { planAgreementSteps, planChangedSince, planNotePayload } from "./order-plan-agreement";

describe("planChangedSince", () => {
  const base = {
    statusUpdatedAt: "2026-11-02T13:49:00Z",
    pdfCreatedAt: "2026-11-02T14:00:00Z",
  };

  it("flags a status and a PDF older than the newest appointment", () => {
    expect(
      planChangedSince({ ...base, status: "finalized", appointmentsLastAddedAt: "2026-11-02T15:00:00Z" }),
    ).toEqual({ pdfStale: true, statusStale: true });
    expect(
      planChangedSince({ ...base, status: "sent", appointmentsLastAddedAt: "2026-11-02T13:55:00Z" }),
    ).toEqual({ pdfStale: false, statusStale: true });
  });

  it("stays quiet for a plan still being edited, or without the times", () => {
    expect(
      planChangedSince({ ...base, status: "correction_requested", appointmentsLastAddedAt: "2026-11-02T13:55:00Z" }),
    ).toEqual({ pdfStale: false, statusStale: false });
    expect(
      planChangedSince({ ...base, status: "draft", appointmentsLastAddedAt: "2026-11-02T15:00:00Z" }).statusStale,
    ).toBe(false);
    expect(
      planChangedSince({
        status: "finalized",
        statusUpdatedAt: null,
        pdfCreatedAt: undefined,
        appointmentsLastAddedAt: "2026-11-02T15:00:00Z",
      }),
    ).toEqual({ pdfStale: false, statusStale: false });
    expect(
      planChangedSince({ ...base, status: "finalized", appointmentsLastAddedAt: null }),
    ).toEqual({ pdfStale: false, statusStale: false });
  });
});

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
