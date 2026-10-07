import { describe, expect, it } from "vitest";

import { de } from "@/lib/i18n/de";
import { ru } from "@/lib/i18n/ru";

import {
  GWG_INSTRUCTION_CODES,
  defaultTrainingForm,
  isLongStanding,
  sortForAttention,
  trainingFormErrors,
  trainingPayload,
  type GwgTrainingEmployee,
  type GwgTrainingRecord,
} from "./gwg-training";

const TODAY = "2026-10-07";

function employee(overrides: Partial<GwgTrainingEmployee> = {}): GwgTrainingEmployee {
  return {
    employee_id: "e-anna",
    first_name: "Anna",
    last_name: "Muster",
    display_name: "Anna Muster",
    employment_start: "2019-03-01",
    user_role: "interpreter",
    default_position: "Dolmetscher/in",
    default_department: "Dolmetscherdienst",
    status: "none",
    last_instructed_on: null,
    next_due_on: null,
    due: true,
    records: [],
    ...overrides,
  };
}

function record(overrides: Partial<GwgTrainingRecord> = {}): GwgTrainingRecord {
  return {
    id: "r-1",
    employee_id: "e-anna",
    template_id: "gwg_staff_training",
    instructed_on: "2025-11-03",
    position: "Teamleitung",
    department: "Dolmetscherdienst Nord",
    delivered_by: "internal",
    delivered_by_other: null,
    form_oral: true,
    form_material: true,
    form_other: false,
    form_other_text: null,
    instructions: [...GWG_INSTRUCTION_CODES],
    reliability: "long_standing",
    reliability_interview: false,
    reliability_certificate: false,
    reliability_other: false,
    reliability_other_text: null,
    management_name: "Ben Beispiel",
    status: "unsigned",
    document_id: "d-1",
    document_file_name: "GwGUnterweisung_20251103_Muster_Anna.pdf",
    document_mime_type: "application/pdf",
    signed_document_id: null,
    signed_file_name: null,
    signed_mime_type: null,
    signed_at: null,
    signed_by_name: null,
    created_by_name: "Ben Beispiel",
    created_at: "2025-11-03T09:00:00Z",
    ...overrides,
  };
}

describe("GwG instruction form", () => {
  it("prefills today, in-house, oral plus the information sheet and all six instructions", () => {
    const form = defaultTrainingForm(employee(), TODAY);
    expect(form.instructedOn).toBe(TODAY);
    expect(form.deliveredBy).toBe("internal");
    expect(form.formOral).toBe(true);
    expect(form.formMaterial).toBe(true);
    expect(form.instructions).toEqual([...GWG_INSTRUCTION_CODES]);
    expect(form.position).toBe("Dolmetscher/in");
    expect(form.department).toBe("Dolmetscherdienst");
    // Employed since 2019: long-standing, no checks of a new employee.
    expect(form.reliability).toBe("long_standing");
    expect(form.reliabilityInterview).toBe(false);
    expect(trainingFormErrors(form, TODAY)).toEqual([]);
  });

  it("takes position and department of the last record and treats a new hire as new", () => {
    const form = defaultTrainingForm(
      employee({ employment_start: "2026-09-01", records: [record()] }),
      TODAY,
    );
    expect(form.position).toBe("Teamleitung");
    expect(form.department).toBe("Dolmetscherdienst Nord");
    expect(form.reliability).toBe("new_employee");
    expect(form.reliabilityInterview).toBe(true);
    expect(isLongStanding("2025-10-07", TODAY)).toBe(true);
    expect(isLongStanding("2025-10-08", TODAY)).toBe(false);
    expect(isLongStanding(null, TODAY)).toBe(false);
  });

  it("asks for what the sheet needs before saving", () => {
    const base = defaultTrainingForm(employee(), TODAY);
    expect(trainingFormErrors({ ...base, instructedOn: "2026-10-08" }, TODAY)).toEqual(["date"]);
    expect(trainingFormErrors({ ...base, instructedOn: "" }, TODAY)).toEqual(["date"]);
    expect(trainingFormErrors({ ...base, deliveredBy: "other" }, TODAY)).toEqual(["delivered_by_other"]);
    expect(trainingFormErrors({ ...base, formOral: false, formMaterial: false }, TODAY)).toEqual(["form"]);
    expect(trainingFormErrors({ ...base, formOther: true }, TODAY)).toEqual(["form_other"]);
    expect(trainingFormErrors({ ...base, instructions: [] }, TODAY)).toEqual(["instructions"]);
    const newHire = { ...base, reliability: "new_employee" as const };
    expect(trainingFormErrors(newHire, TODAY)).toEqual(["reliability"]);
    expect(trainingFormErrors({ ...newHire, reliabilityOther: true }, TODAY)).toEqual(["reliability_other"]);
    expect(trainingFormErrors({ ...newHire, reliabilityCertificate: true }, TODAY)).toEqual([]);
  });

  it("sends the sheet's order and drops the texts of unticked boxes", () => {
    const form = {
      ...defaultTrainingForm(employee(), TODAY),
      position: "  Dolmetscher/in ",
      deliveredByOther: "left over",
      formOtherText: "left over",
      instructions: ["record_keeping", "identify_partner"] as typeof GWG_INSTRUCTION_CODES[number][],
      reliabilityInterview: true,
      reliabilityOtherText: "left over",
    };
    expect(trainingPayload(form)).toEqual({
      employee_id: "e-anna",
      instructed_on: TODAY,
      position: "Dolmetscher/in",
      department: "Dolmetscherdienst",
      delivered_by: "internal",
      delivered_by_other: null,
      form_oral: true,
      form_material: true,
      form_other: false,
      form_other_text: null,
      instructions: ["identify_partner", "record_keeping"],
      reliability: "long_standing",
      reliability_interview: false,
      reliability_certificate: false,
      reliability_other: false,
      reliability_other_text: null,
    });
    const other = trainingPayload({
      ...form,
      deliveredBy: "other",
      deliveredByOther: " Kanzlei Beispiel ",
      formOther: true,
      formOtherText: " Online-Schulung ",
      reliability: "new_employee",
      reliabilityOther: true,
      reliabilityOtherText: " Referenz ",
    });
    expect(other).toMatchObject({
      delivered_by: "other",
      delivered_by_other: "Kanzlei Beispiel",
      form_other: true,
      form_other_text: "Online-Schulung",
      reliability: "new_employee",
      reliability_interview: true,
      reliability_other: true,
      reliability_other_text: "Referenz",
    });
  });

  it("lists due employees first, then by name", () => {
    const sorted = sortForAttention([
      employee({ employee_id: "a", last_name: "Zahler", due: false }),
      employee({ employee_id: "b", last_name: "Muster", due: false }),
      employee({ employee_id: "c", last_name: "Beispiel", due: true }),
    ]);
    expect(sorted.map((item) => item.employee_id)).toEqual(["c", "b", "a"]);
  });

  it("labels every status, instruction and error in both languages", () => {
    const keys = [
      ...["none", "unsigned", "signed"].map((status) => `sops_gwg_status_${status}`),
      ...GWG_INSTRUCTION_CODES.map((code) => `sops_gwg_instruction_${code}`),
      ...["date", "delivered_by_other", "form", "form_other", "instructions", "reliability", "reliability_other"].map(
        (code) => `sops_gwg_error_${code}`,
      ),
    ];
    for (const catalog of [ru, de]) {
      const labels = catalog as unknown as Record<string, string | undefined>;
      for (const key of keys) expect(labels[key], key).toBeTruthy();
    }
  });
});
