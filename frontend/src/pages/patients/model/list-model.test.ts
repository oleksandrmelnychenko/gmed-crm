import { describe, expect, it } from "vitest";

import {
  collectPatientInsuranceOptions,
  filterPatientsByInsurance,
} from "./list-model";

const patients = [
  { insurance_provider: "TK" },
  { insurance_provider: "AOK" },
  { insurance_provider: " aok " }, // duplicate (case + whitespace)
  { insurance_provider: "" }, // blank -> ignored
  { insurance_provider: null }, // null -> ignored
  { insurance_provider: "BKK" },
];

describe("collectPatientInsuranceOptions", () => {
  it("returns distinct, trimmed, name-sorted insurers and ignores blanks/duplicates", () => {
    expect(collectPatientInsuranceOptions(patients)).toEqual(["AOK", "BKK", "TK"]);
  });

  it("returns an empty list when nobody has an insurer", () => {
    expect(
      collectPatientInsuranceOptions([{ insurance_provider: null }, { insurance_provider: "" }]),
    ).toEqual([]);
  });
});

describe("filterPatientsByInsurance", () => {
  it("returns all patients when no insurer is selected", () => {
    expect(filterPatientsByInsurance(patients, "")).toBe(patients);
    expect(filterPatientsByInsurance(patients, "   ")).toBe(patients);
  });

  it("keeps only patients with the selected insurer (case/space-insensitive)", () => {
    expect(filterPatientsByInsurance(patients, "aok")).toEqual([
      { insurance_provider: "AOK" },
      { insurance_provider: " aok " },
    ]);
    expect(filterPatientsByInsurance(patients, "TK")).toEqual([{ insurance_provider: "TK" }]);
  });

  it("returns nothing when no patient carries the selected insurer", () => {
    expect(filterPatientsByInsurance(patients, "Albatros")).toEqual([]);
  });
});
