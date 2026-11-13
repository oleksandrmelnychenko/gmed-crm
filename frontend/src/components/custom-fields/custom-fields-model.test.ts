import { describe, expect, it } from "vitest";

import {
  changedCustomFieldValues,
  customFieldErrorText,
  customFieldOptions,
  formatCustomFieldDate,
  formatCustomFieldValue,
} from "./custom-fields-model";

const ru = (text: string) => text;
const de = (_ru: string, text: string) => text;

describe("custom fields on the lead and patient card", () => {
  it("shows dates as DD.MM.YYYY, checkboxes as yes/no and decimal commas", () => {
    expect(formatCustomFieldDate("2026-11-12")).toBe("12.11.2026");
    expect(formatCustomFieldValue({ field_type: "date", value: "2026-11-12" }, ru)).toBe("12.11.2026");
    expect(formatCustomFieldValue({ field_type: "boolean", value: "true" }, ru)).toBe("Да");
    expect(formatCustomFieldValue({ field_type: "boolean", value: "false" }, de)).toBe("Nein");
    expect(formatCustomFieldValue({ field_type: "number", value: "12.5" }, de)).toBe("12,5");
    expect(formatCustomFieldValue({ field_type: "select", value: "Charité" }, ru)).toBe("Charité");
    expect(formatCustomFieldValue({ field_type: "text", value: null }, ru)).toBe("—");
    expect(formatCustomFieldValue({ field_type: "text", value: "  " }, ru)).toBe("—");
  });

  it("reads only text options of a list field", () => {
    expect(customFieldOptions({ options: ["Charité", 3, "Vivantes"] })).toEqual(["Charité", "Vivantes"]);
    expect(customFieldOptions({ options: null })).toEqual([]);
  });

  it("sends only changed values and clears an emptied one", () => {
    const fields = [
      { field_id: "a", value: "Charité" },
      { field_id: "b", value: null },
      { field_id: "c", value: "2026-11-12" },
      { field_id: "d", value: "x" },
    ];
    expect(
      changedCustomFieldValues(fields, { a: "Charité", b: " neu ", c: "", d: " x " }),
    ).toEqual([
      { field_id: "b", value: "neu" },
      { field_id: "c", value: null },
    ]);
    expect(changedCustomFieldValues(fields, {})).toEqual([]);
  });

  it("translates the server's refusals", () => {
    expect(customFieldErrorText("custom_field_value_date_invalid", ru)).toContain("ДД.ММ.ГГГГ");
    expect(customFieldErrorText("custom_field_value_number_invalid", de)).toContain("Zahl");
    expect(customFieldErrorText("lead_converted", de)).toContain("Patient");
    expect(customFieldErrorText("custom_field_medical_forbidden", de)).toContain("medizinische Daten");
    expect(customFieldErrorText(undefined, ru)).toBe("Не удалось сохранить поля.");
  });
});
