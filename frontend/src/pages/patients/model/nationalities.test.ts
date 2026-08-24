import { describe, expect, it } from "vitest";

import {
  nationalityCountryCode,
  nationalityNameForDisplay,
} from "./nationalities";

describe("patient nationalities", () => {
  it("maps legacy nationality values to ISO country codes", () => {
    expect(nationalityCountryCode("German")).toBe("DE");
    expect(nationalityCountryCode("Ukrainian")).toBe("UA");
    expect(nationalityCountryCode("British")).toBe("GB");
  });

  it("keeps comprehensive ISO values", () => {
    expect(nationalityCountryCode("FR")).toBe("FR");
    expect(nationalityCountryCode("JP")).toBe("JP");
  });

  it("localizes the citizenship country for display", () => {
    expect(nationalityNameForDisplay("French", "ru")).toBe("French");
    expect(nationalityNameForDisplay("FR", "ru")).toBe("Франция");
    expect(nationalityNameForDisplay("FR", "de")).toBe("Frankreich");
  });
});
