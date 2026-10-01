import { describe, expect, it } from "vitest";

import type { ClinicalDocumentImportCandidate } from "./clinical-document-import";
import { labResultImportPayload } from "./clinical-document-import-payloads";
import {
  buildConstructorCandidate,
  groupCandidatesByPage,
  missingConstructorFields,
  moveCandidate,
  prefillConstructorFields,
} from "./clinical-import-constructor";

const context = {
  id: "manual:1",
  sourcePage: 2,
  sourceText: "",
  sourceSection: "Manuelle Auswahl",
  sourceCountry: "DE",
  laboratoryPanel: "Manuelle Eingabe",
};

function candidate(id: string, target: ClinicalDocumentImportCandidate["target"], page: number | null) {
  return {
    id,
    target,
    value: id,
    normalized: {},
    confidence: 1,
    selected: true,
    source: { page, section: "", text: id },
  } satisfies ClinicalDocumentImportCandidate;
}

describe("prefillConstructorFields", () => {
  it("splits a selected laboratory value into analyte, result, unit and reference", () => {
    expect(prefillConstructorFields("lab_result", "PSA-Wert 12,4 ng/ml")).toEqual({
      analyte_name: "PSA",
      result_text: "12,4",
      unit: "ng/ml",
    });
    expect(prefillConstructorFields("lab_result", "CRP: <0,5 mg/dl (Referenz: <0,5)")).toEqual({
      analyte_name: "CRP",
      result_text: "<0,5",
      unit: "mg/dl",
      reference_text: "<0,5",
    });
  });

  it("keeps a long selection as one text instead of parsing it as a value", () => {
    const paragraph = `PSA-Wert 12,4 ng/ml ${"und weitere Angaben ".repeat(10)}`;
    expect(prefillConstructorFields("lab_result", paragraph)).toEqual({ analyte_name: paragraph.trim() });
  });

  it("puts any other selection into the primary field of the type", () => {
    expect(prefillConstructorFields("lab_result", "kein Laborwert")).toEqual({ analyte_name: "kein Laborwert" });
    expect(prefillConstructorFields("examination", "Prostata vergrößert")).toEqual({ result: "Prostata vergrößert" });
    expect(prefillConstructorFields("diagnosis", "V. a. Prostatakarzinom")).toMatchObject({
      label: "V. a. Prostatakarzinom",
      certainty: "verdacht",
    });
  });
});

describe("missingConstructorFields", () => {
  it("requires the date and value of a laboratory result", () => {
    expect(missingConstructorFields("lab_result", { analyte_name: "PSA" })).toEqual([
      "result_text",
      "measured_on",
    ]);
  });

  it("requires at least one vital measurement besides the date", () => {
    expect(missingConstructorFields("vital", { measured_at: "2026-03-02" })).toEqual(["bp_systolic"]);
    expect(missingConstructorFields("vital", { measured_at: "2026-03-02", weight_kg: "80" })).toEqual([]);
  });
});

describe("buildConstructorCandidate", () => {
  it("builds a laboratory candidate that passes the import payload check", () => {
    const built = buildConstructorCandidate(
      "lab_result",
      { analyte_name: "PSA", result_text: "12,4", unit: "ng/ml", measured_on: "2026-02-20" },
      context,
    );

    expect(built.value).toBe("PSA: 12,4 ng/ml");
    expect(built.normalized).toMatchObject({ numeric_result: 12.4, comparator: null, measured_on: "2026-02-20" });
    expect(built.source).toEqual({ page: 2, section: "Manuelle Auswahl", text: "PSA: 12,4 ng/ml" });
    expect(labResultImportPayload(built, "DE", "import-1")).toMatchObject({
      analyte_name: "PSA",
      result_text: "12,4",
      measured_at: "2026-02-20",
      source_page: 2,
    });
  });

  it("keeps the selected document text as source evidence", () => {
    const built = buildConstructorCandidate(
      "diagnosis",
      { label: "Prostatakarzinom", certainty: "verdacht", kind: "main", icd_code: "c61", diagnosed_on: "2026-03-02" },
      { ...context, sourceText: "Hinweis auf Prostatakarzinom?" },
    );

    expect(built.normalized).toMatchObject({
      label: "Prostatakarzinom",
      certainty: "verdacht",
      assertion: "suspected",
      kind: "main",
      icd_code: "C61",
      diagnosed_on: "2026-03-02",
    });
    expect(built.source.text).toBe("Hinweis auf Prostatakarzinom?");
  });

  it("turns vital fields into numbers", () => {
    const built = buildConstructorCandidate(
      "vital",
      { measured_at: "2026-03-02", bp_systolic: "130", bp_diastolic: "80", temperature_c: "36,8" },
      context,
    );

    expect(built.normalized).toMatchObject({ bp_systolic: 130, bp_diastolic: 80, temperature_c: 36.8, heart_rate: null });
    // The import rejects a candidate with an empty value.
    expect(built.value).toBe("RR systolisch: 130, RR diastolisch: 80, Temperatur, °C: 36,8");
  });
});

describe("moveCandidate", () => {
  const list = [candidate("d1", "diagnosis", 1), candidate("l1", "lab_result", 1), candidate("d2", "diagnosis", 2)];

  it("swaps with the neighbouring block of the same type", () => {
    expect(moveCandidate(list, "d2", -1).map((item) => item.id)).toEqual(["d2", "l1", "d1"]);
    expect(moveCandidate(list, "d1", 1).map((item) => item.id)).toEqual(["d2", "l1", "d1"]);
  });

  it("leaves the first and last block of a type in place", () => {
    expect(moveCandidate(list, "d1", -1)).toBe(list);
    expect(moveCandidate(list, "l1", 1)).toBe(list);
  });
});

describe("groupCandidatesByPage", () => {
  it("orders pages and puts blocks without a page last", () => {
    const groups = groupCandidatesByPage([
      candidate("a", "diagnosis", 2),
      candidate("b", "anamnesis", null),
      candidate("c", "lab_result", 1),
      candidate("d", "diagnosis", 2),
    ]);

    expect(groups.map((group) => [group.page, group.items.map((item) => item.id)])).toEqual([
      [1, ["c"]],
      [2, ["a", "d"]],
      [null, ["b"]],
    ]);
  });
});
