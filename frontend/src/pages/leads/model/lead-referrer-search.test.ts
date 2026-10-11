import { describe, expect, it } from "vitest";

import {
  filterPatientsBySearch,
  matchesPatientSearch,
  normalizePatientSearch,
  patientSearchText,
} from "./lead-referrer-search";

const anna = { patient_id: "P-0008", title: null, first_name: "Anna", last_name: "Portal" };
const max = { patient_id: "P-0004", title: "Dr.", first_name: "Max", last_name: "Müller" };
const lena = { patient_id: "P-0011", title: null, first_name: "Lena", last_name: "Schröder" };

describe("search in the wizard's patient picker (QA 2026-10-11, N-16)", () => {
  it("keeps only the patients that match what is typed", () => {
    expect(filterPatientsBySearch([anna, max, lena], "Anna Portal")).toEqual([anna]);
    expect(filterPatientsBySearch([anna, max, lena], "portal anna")).toEqual([anna]);
    expect(filterPatientsBySearch([anna, max, lena], "P-0004")).toEqual([max]);
    expect(filterPatientsBySearch([anna, max, lena], "nobody")).toEqual([]);
  });

  it("lists every patient while nothing is typed", () => {
    expect(filterPatientsBySearch([anna, max, lena], "")).toEqual([anna, max, lena]);
    expect(filterPatientsBySearch([anna, max, lena], "   ")).toEqual([anna, max, lena]);
  });

  it("finds umlauts typed either way", () => {
    expect(matchesPatientSearch(max, "Müller")).toBe(true);
    expect(matchesPatientSearch(max, "mueller")).toBe(true);
    expect(matchesPatientSearch(lena, "Schroeder Lena")).toBe(true);
    expect(matchesPatientSearch(max, "Dr. Max")).toBe(true);
  });

  it("gives the combobox a text that contains the name as typed", () => {
    const text = patientSearchText(max);
    expect(text).toContain("p-0004 dr. max müller");
    expect(text).toContain("müller max");
    expect(text).toContain("mueller max");
    expect(normalizePatientSearch("  Groß  Straße ")).toBe("gross strasse");
  });
});
