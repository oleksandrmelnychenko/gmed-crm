import { describe, expect, it } from "vitest";

import {
  collectPatientInsuranceTypeOptions,
  filterPatientsByInsuranceType,
} from "./list-model";

const patients = [
  { insurance_type: "foreign" },
  { insurance_type: "private" },
  { insurance_type: "private" }, // duplicate
  { insurance_type: "" }, // blank -> ignored
  { insurance_type: null }, // null -> ignored
  { insurance_type: "self_pay" },
  { insurance_type: "AOK" }, // non-type legacy value -> ignored
];

describe("collectPatientInsuranceTypeOptions", () => {
  it("returns distinct insurance types in canonical order and ignores blanks/legacy provider names", () => {
    expect(collectPatientInsuranceTypeOptions(patients)).toEqual(["private", "self_pay", "foreign"]);
  });

  it("returns an empty list when nobody has an insurance type", () => {
    expect(
      collectPatientInsuranceTypeOptions([{ insurance_type: null }, { insurance_type: "" }]),
    ).toEqual([]);
  });
});

describe("filterPatientsByInsuranceType", () => {
  it("returns all patients when no insurance type is selected", () => {
    expect(filterPatientsByInsuranceType(patients, "")).toBe(patients);
    expect(filterPatientsByInsuranceType(patients, "   ")).toBe(patients);
  });

  it("keeps only patients with the selected insurance type", () => {
    expect(filterPatientsByInsuranceType(patients, "private")).toEqual([
      { insurance_type: "private" },
      { insurance_type: "private" },
    ]);
    expect(filterPatientsByInsuranceType(patients, "foreign")).toEqual([{ insurance_type: "foreign" }]);
  });

  it("returns nothing when no patient carries the selected insurance type", () => {
    expect(filterPatientsByInsuranceType(patients, "public")).toEqual([]);
  });
});
