import { describe, expect, it } from "vitest";

import {
  checklistBmi,
  checklistGroupFolded,
  checklistUnfolded,
  composeChecklistText,
  emptySpecializationChecklist,
  isChecklistTemplate,
  isUnansweredChecklistNotation,
  parseChecklistTemplate,
  readSpecializationChecklist,
} from "./specialization-checklist";

// The cardiology list exactly as the clinic wrote it, typos included.
const CLINIC_TEMPLATE = `CVRF (ja/nein):
-art. Hypertonie (ja/nein):
-Diabetes mellitus (ja/nein):
-Nikotin (ja/nein+if ja: Pack Years Note (Number)):
-Dislipoproteinämie (ja/nein+if ja: Note):
-Übergewicht (ja/nein+if ja: weigth in kg+hight in cm+BMI):
-Ungesunde Ernährung (ja/nein+: if ja: note)
-Positive Eigenanamnese (ja/nein+ if ja: Herzinfarkt/Schlaganfall/PAVK/Trombosen+if ja: Note)
-Lp(a)-high (ja/nein+if ja: Note)
-Positive Familienanamnese (Herzinfarkt/Schlaganfall/pAVK/Trombosen+if ja: Note)`;

describe("parseChecklistTemplate", () => {
  const items = parseChecklistTemplate(CLINIC_TEMPLATE);

  it("reads every line of the clinic's notation as a yes/no question", () => {
    expect(items.map((item) => item.label)).toEqual([
      "CVRF",
      "art. Hypertonie",
      "Diabetes mellitus",
      "Nikotin",
      "Dislipoproteinämie",
      "Übergewicht",
      "Ungesunde Ernährung",
      "Positive Eigenanamnese",
      "Lp(a)-high",
      "Positive Familienanamnese",
    ]);
    expect(items.every((item) => item.yesNo)).toBe(true);
    expect(items.map((item) => item.child)).toEqual([false, ...Array(9).fill(true)]);
    // Without a condition of its own, every question unfolds on "ja".
    expect(items.every((item) => item.unfoldOn === "ja")).toBe(true);
  });

  it("lets a question unfold its follow-ups on nein instead", () => {
    const [main, child, declined] = parseChecklistTemplate(
      "Beschwerdefrei (ja/nein + if nein: Seit wann)\n- Schmerzen (ja/nein + wenn ja: Note)\nImpfschutz vollständig (ja/nein + bei nein: Fehlende Impfungen)",
    );
    expect(main).toMatchObject({ yesNo: true, unfoldOn: "nein", fields: [{ kind: "text", label: "Seit wann" }] });
    expect(child).toMatchObject({ child: true, yesNo: true, unfoldOn: "ja", fields: [{ kind: "text", label: "" }] });
    expect(declined).toMatchObject({ yesNo: true, unfoldOn: "nein", fields: [{ kind: "text", label: "Fehlende Impfungen" }] });
    expect(checklistUnfolded(main, { value: "nein" })).toBe(true);
    expect(checklistUnfolded(main, { value: "ja" })).toBe(false);
    expect(checklistUnfolded(main, undefined)).toBe(false);
  });

  it("derives the follow-up fields: number, note, measurements with BMI and options", () => {
    expect(items[1].fields).toEqual([]);
    expect(items[3].fields).toEqual([{ key: "field1", kind: "number", label: "Pack Years", unit: "" }]);
    expect(items[4].fields).toEqual([{ key: "note1", kind: "text", label: "", unit: "" }]);
    expect(items[5].fields.map((field) => [field.kind, field.label, field.unit])).toEqual([
      ["number", "weigth", "kg"],
      ["number", "hight", "cm"],
      ["bmi", "BMI", ""],
    ]);
    expect(items[6].fields.map((field) => field.kind)).toEqual(["text"]);
    expect(items[7].options).toEqual(["Herzinfarkt", "Schlaganfall", "PAVK", "Trombosen"]);
    expect(items[7].fields.map((field) => field.kind)).toEqual(["text"]);
    // "if ja" without "ja/nein" still makes a question.
    expect(items[9].options).toEqual(["Herzinfarkt", "Schlaganfall", "pAVK", "Trombosen"]);
  });

  it("keeps plain lines as headings and plain templates as text", () => {
    const plain = "B-Symptomatik:\n- Fieber:\n- Gewichtsverlust:";
    expect(isChecklistTemplate(plain)).toBe(false);
    expect(parseChecklistTemplate(plain).map((item) => [item.label, item.yesNo])).toEqual([
      ["B-Symptomatik", false],
      ["Fieber", false],
      ["Gewichtsverlust", false],
    ]);
    expect(isChecklistTemplate(CLINIC_TEMPLATE)).toBe(true);
    expect(isChecklistTemplate(null)).toBe(false);
    // A bracket that is part of the wording is not a question.
    expect(parseChecklistTemplate("NYHA-Stadium (I-IV)")[0]).toMatchObject({ label: "NYHA-Stadium (I-IV)", yesNo: false });
    expect(parseChecklistTemplate("Belastbarkeit (Note)")[0]).toMatchObject({ label: "Belastbarkeit", yesNo: false, fields: [{ kind: "text" }] });
    expect(parseChecklistTemplate("Größe in cm (Number)")[0].fields).toEqual([{ key: "field0", kind: "number", label: "", unit: "" }]);
  });
});

describe("the clinic's hand-typed lists", () => {
  // As found in an anamnesis on DEV: "ja nein" without the slash, "note text".
  const typed = "- Fieber (ja nein+if ja: note text)\n-Nachtschweiß (ja nein+if ja: note text)\nPositive Familienanamnese (ja/nein+if ja: Note):";

  it("reads 'ja nein' and 'note text' like the slash notation", () => {
    expect(parseChecklistTemplate(typed).map((item) => [item.label, item.yesNo, item.fields.map((field) => field.kind)])).toEqual([
      ["Fieber", true, ["text"]],
      ["Nachtschweiß", true, ["text"]],
      ["Positive Familienanamnese", true, ["text"]],
    ]);
  });

  it("tells a bare list of questions from a text that already says something", () => {
    expect(isUnansweredChecklistNotation(CLINIC_TEMPLATE)).toBe(true);
    expect(isUnansweredChecklistNotation(typed)).toBe(true);
    expect(isUnansweredChecklistNotation("B-Symptomatik: keine\n- Fieber (ja nein+if ja: note text): nein")).toBe(false);
    expect(isUnansweredChecklistNotation("Belastungsdyspnoe seit März.")).toBe(false);
    expect(isUnansweredChecklistNotation("Appetit:\nSchlaf:")).toBe(false);
    expect(isUnansweredChecklistNotation(null)).toBe(false);
  });
});

describe("composeChecklistText", () => {
  const items = parseChecklistTemplate(CLINIC_TEMPLATE);

  it("writes the answered questions as readable lines and appends the free text", () => {
    const checklist = {
      ...emptySpecializationChecklist(CLINIC_TEMPLATE, "Belastungsdyspnoe seit März."),
      answers: {
        "0": { value: "ja" as const },
        "1": { value: "ja" as const },
        "2": { value: "nein" as const },
        "3": { value: "ja" as const, fields: { field1: "20" } },
        "5": { value: "ja" as const, fields: { field1: "92", field2: "178" } },
        "7": { value: "ja" as const, options: ["Herzinfarkt", "PAVK"], fields: { note2: "2019 Stent" } },
        // Details of a "nein" answer are not printed.
        "8": { value: "nein" as const, fields: { note1: "früher erhöht" } },
      },
    };

    expect(composeChecklistText(checklist)).toBe(
      [
        "CVRF: ja",
        "- art. Hypertonie: ja",
        "- Diabetes mellitus: nein",
        "- Nikotin: ja (Pack Years: 20)",
        "- Übergewicht: ja (weigth: 92 kg; hight: 178 cm; BMI: 29,0)",
        "- Positive Eigenanamnese: ja (Herzinfarkt, PAVK; 2019 Stent)",
        "- Lp(a)-high: nein",
        "",
        "Belastungsdyspnoe seit März.",
      ].join("\n"),
    );
    expect(checklistBmi(items[5], checklist.answers["5"])).toBe("29,0");
    expect(checklistBmi(items[5], { fields: { field1: "92" } })).toBe("");
  });

  it("keeps the sub-questions folded until the main question is answered with ja", () => {
    // Answered "nein": the sub-questions stay folded and are not printed.
    const declined = { "0": { value: "nein" as const }, "1": { value: "ja" as const } };
    expect(checklistGroupFolded(items, items[1], declined)).toBe(true);
    expect(checklistGroupFolded(items, items[0], declined)).toBe(false);
    expect(composeChecklistText({ ...emptySpecializationChecklist(CLINIC_TEMPLATE), answers: declined })).toBe("CVRF: nein");
    // Not answered yet: folded as well, so the sub-questions appear only on "ja".
    const unanswered = { "1": { value: "ja" as const } };
    expect(checklistGroupFolded(items, items[1], unanswered)).toBe(true);
    expect(composeChecklistText({ ...emptySpecializationChecklist(CLINIC_TEMPLATE), answers: unanswered })).toBe("");
    expect(checklistGroupFolded(items, items[1], { "0": { value: "ja" } })).toBe(false);
  });

  it("unfolds a group on nein when its line says so, and always shows lines under a heading", () => {
    const template = "Beschwerdefrei (ja/nein + if nein: Seit wann)\n- Schmerzen (ja/nein + if ja: Note)\nMedikation:\n- Antikoagulation (ja/nein)";
    const parsed = parseChecklistTemplate(template);
    expect(checklistGroupFolded(parsed, parsed[1], {})).toBe(true);
    expect(checklistGroupFolded(parsed, parsed[1], { "0": { value: "ja" } })).toBe(true);
    expect(checklistGroupFolded(parsed, parsed[1], { "0": { value: "nein" } })).toBe(false);
    expect(checklistGroupFolded(parsed, parsed[3], {})).toBe(false);
    expect(
      composeChecklistText({
        ...emptySpecializationChecklist(template),
        answers: {
          "0": { value: "nein", fields: { field1: "März 2026" } },
          "1": { value: "ja", fields: { note1: "lumbal" } },
          "3": { value: "nein" },
        },
      }),
    ).toBe(["Beschwerdefrei: nein (Seit wann: März 2026)", "- Schmerzen: ja (lumbal)", "Medikation:", "- Antikoagulation: nein"].join("\n"));
  });

  it("prints a heading only above answered questions", () => {
    const template = "Risikofaktoren:\n- Nikotin (ja/nein)\nMedikation:\n- Antikoagulation (ja/nein + if ja: Note)";
    const checklist = {
      ...emptySpecializationChecklist(template),
      answers: { "3": { value: "ja" as const, fields: { note1: "Apixaban" } } },
    };
    expect(composeChecklistText(checklist)).toBe("Medikation:\n- Antikoagulation: ja (Apixaban)");
    expect(composeChecklistText(emptySpecializationChecklist(template))).toBe("");
  });
});

describe("readSpecializationChecklist", () => {
  it("accepts the stored shape and ignores anything else", () => {
    expect(readSpecializationChecklist({ version: 1, template: "A (ja/nein)", answers: { "0": { value: "ja" } } })).toEqual({
      version: 1,
      template: "A (ja/nein)",
      answers: { "0": { value: "ja" } },
      notes: "",
    });
    expect(readSpecializationChecklist(null)).toBeNull();
    expect(readSpecializationChecklist({ template: 1, answers: {} })).toBeNull();
    expect(readSpecializationChecklist("text")).toBeNull();
  });
});
