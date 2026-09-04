import { describe, expect, it } from "vitest";

import {
  countryCodeForDisplay,
  countryNameForDisplay,
} from "./country-select";

describe("country display normalization", () => {
  it.each([
    ["DE", "DE"],
    ["Germany", "DE"],
    ["Deutschland", "DE"],
    ["Poland", "PL"],
    ["GE", "GE"],
  ])("resolves %s to ISO code %s", (storedValue, expectedCode) => {
    expect(countryCodeForDisplay(storedValue)).toBe(expectedCode);
  });

  it("renders a localized name independently from its ISO code", () => {
    expect(countryNameForDisplay("Germany", "ru")).toBe("Германия");
    expect(countryNameForDisplay("Deutschland", "de")).toBe("Deutschland");
  });

  it("keeps an unknown legacy name but does not invent a country code", () => {
    expect(countryNameForDisplay("Unknown country", "ru")).toBe("Unknown country");
    expect(countryCodeForDisplay("Unknown country")).toBe("");
  });
});
