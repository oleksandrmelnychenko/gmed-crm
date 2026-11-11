import { describe, expect, it } from "vitest";

import { portalServiceNotes } from "./portal-service-notes";

describe("portalServiceNotes", () => {
  it("lists the patient's own note before the note staff wrote for the patient", () => {
    expect(
      portalServiceNotes({
        patient_note: "Ground floor room, please.",
        patient_visible_note: "Your driver waits at exit B.",
      }),
    ).toEqual([
      { kind: "own", text: "Ground floor room, please." },
      { kind: "care_team", text: "Your driver waits at exit B." },
    ]);
  });

  it("skips missing and blank notes", () => {
    expect(portalServiceNotes({ patient_note: null, patient_visible_note: "  " })).toEqual([]);
    expect(portalServiceNotes({ patient_note: " Late check-in ", patient_visible_note: null })).toEqual([
      { kind: "own", text: "Late check-in" },
    ]);
  });

  it("never reads a field other than the two portal notes", () => {
    const item = {
      patient_note: null,
      patient_visible_note: null,
      service_notes: "INTERNAL staff note",
    } as Parameters<typeof portalServiceNotes>[0];
    expect(portalServiceNotes(item)).toEqual([]);
  });
});
