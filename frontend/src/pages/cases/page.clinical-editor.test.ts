import { describe, expect, it } from "vitest";

import { casesClinicalEditorTestUtils as editor } from "./page";

describe("cases clinical editor helpers", () => {
  it("requires active ingredient but allows an empty trade name", () => {
    const validMedication = {
      ...editor.blankMedikament(),
      handelsname: "",
      wirkstoff: "Ibuprofen",
    };
    const emptyMedication = {
      ...editor.blankMedikament(),
      handelsname: "Optional brand",
      wirkstoff: " ",
    };

    expect(
      editor.medicationRequiredValidationMessage([validMedication, emptyMedication]),
    ).not.toBe("");
    expect(editor.sanitizeMedikamente([validMedication, emptyMedication], [])).toHaveLength(1);
    expect(editor.sanitizeMedikamente([validMedication], [])[0]).toMatchObject({
      handelsname: "",
      wirkstoff: "Ibuprofen",
    });
  });

  it("blocks pain rows with empty required locations before sanitizing", () => {
    const validPain = {
      ...editor.blankPainItem(),
      lokalisierung: "Knie",
    };
    const emptyPain = {
      ...editor.blankPainItem(),
      lokalisierung: " ",
    };

    expect(editor.painValidationMessage([validPain, emptyPain])).not.toBe("");
    expect(editor.sanitizePainRecords([validPain, emptyPain])).toHaveLength(1);
  });

  it("keeps medication row keys stable while editable fields change", () => {
    const [medication] = editor.ensureMedikamentClientRowIds([
      {
        ...editor.blankMedikament(),
        cid: null,
        handelsname: "",
      },
    ]);

    const key = editor.medikamentItemKey(medication, 0);

    expect(key).toBeTruthy();
    expect(
      editor.medikamentItemKey(
        {
          ...medication,
          handelsname: "Ibuprofen",
          wirkstoff: "Ibuprofen",
          dosis: "400",
        },
        0,
      ),
    ).toBe(key);
    expect(
      editor.medikamentItemKey(
        {
          ...medication,
          id: "server-medication-1",
          handelsname: "Paracetamol",
        },
        0,
      ),
    ).toBe("server-medication-1");
  });

  it("keeps pain row keys stable while editable fields change", () => {
    const [pain] = editor.ensurePainClientRowIds([
      {
        ...editor.blankPainItem(),
        cid: null,
        lokalisierung: "",
      },
    ]);

    const key = editor.painItemKey(pain, 0);

    expect(key).toBeTruthy();
    expect(
      editor.painItemKey(
        {
          ...pain,
          lokalisierung: "Knie",
          qualitaet: "ziehend",
          nrs_aktuell: 4,
        },
        0,
      ),
    ).toBe(key);
  });

  it("keeps NRS validation after required pain fields pass", () => {
    const invalidPain = {
      ...editor.blankPainItem(),
      lokalisierung: "Knie",
      nrs_aktuell: 11,
    };

    expect(editor.painValidationMessage([invalidPain])).toContain("NRS");
  });
});
