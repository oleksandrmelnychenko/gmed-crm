import { describe, expect, it } from "vitest";

import { readableServiceLineNotes } from "./service-line-notes";

describe("readableServiceLineNotes", () => {
  it("drops raw IDs and catalog keys from automatically created notes", () => {
    expect(
      readableServiceLineNotes(
        [
          "Automatisch aus abgeschlossenem medizinischem Termin 5f1c2d3e-0a1b-4c2d-8e3f-123456789abc erstellt",
          "Termin: Konsultation Kardiologie",
          "Datum: 2026-09-26",
          "Katalogschlüssel: treatment_organization",
          "Anbieter: Klinik Nord",
        ].join("\n"),
      ),
    ).toBe(
      [
        "Automatisch aus abgeschlossenem medizinischem Termin erstellt",
        "Termin: Konsultation Kardiologie",
        "Datum: 26.09.2026",
        "Anbieter: Klinik Nord",
      ].join("\n"),
    );
  });

  it("removes lines that only held a reference", () => {
    expect(
      readableServiceLineNotes(
        "Automatisch aus freigegebenem Dolmetscherbericht 5f1c2d3e-0a1b-4c2d-8e3f-123456789abc erstellt\nTermin: 5f1c2d3e-0a1b-4c2d-8e3f-123456789abd\nStunden: 2.5",
      ),
    ).toBe("Automatisch aus freigegebenem Dolmetscherbericht erstellt\nStunden: 2.5");
  });

  it("keeps staff notes and treats empty notes as none", () => {
    expect(readableServiceLineNotes("Patient wünscht Einzelzimmer")).toBe("Patient wünscht Einzelzimmer");
    expect(readableServiceLineNotes("")).toBeNull();
    expect(readableServiceLineNotes("Katalogschlüssel: x")).toBeNull();
  });
});
