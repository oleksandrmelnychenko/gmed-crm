import { describe, expect, it } from "vitest";

import { LANGUAGE_CODES, LANGUAGE_OPTIONS, languageLabel } from "./language-multi-select";

describe("patient language dictionary", () => {
  it("contains the complete ISO 639-1 set without duplicates", () => {
    expect(LANGUAGE_CODES).toHaveLength(184);
    expect(new Set(LANGUAGE_CODES).size).toBe(LANGUAGE_CODES.length);
    expect(LANGUAGE_OPTIONS).toHaveLength(LANGUAGE_CODES.length);
  });

  it("localizes common languages and preserves unknown legacy values", () => {
    expect(languageLabel("uk", "ru")).toMatch(/\(uk\)$/);
    expect(languageLabel("de", "de")).toMatch(/\(de\)$/);
    expect(languageLabel("legacy-language", "ru")).toBe("legacy-language");
  });
});
