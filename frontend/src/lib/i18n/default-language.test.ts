import { describe, expect, it } from "vitest";

import { resolveDefaultLanguage } from "@/lib/i18n/default-language";

describe("resolveDefaultLanguage", () => {
  it("uses German when the production build requests it", () => {
    expect(resolveDefaultLanguage("de")).toBe("de");
  });

  it("preserves the existing Russian fallback for development", () => {
    expect(resolveDefaultLanguage(undefined)).toBe("ru");
    expect(resolveDefaultLanguage("ru")).toBe("ru");
  });
});
