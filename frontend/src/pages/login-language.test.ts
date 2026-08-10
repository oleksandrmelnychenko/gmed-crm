import { describe, expect, it } from "vitest";

import { resolveRequestedLoginLanguage } from "./login-language";

describe("login language parameter", () => {
  it.each([
    ["ru", "ru"],
    ["RU", "ru"],
    ["de", "de"],
    ["en", "de"],
    ["es", "de"],
    ["unknown", "de"],
  ] as const)("maps %s to %s", (requested, expected) => {
    expect(resolveRequestedLoginLanguage(requested)).toBe(expected);
  });

  it("does not override the saved language when the parameter is absent", () => {
    expect(resolveRequestedLoginLanguage(null)).toBeNull();
    expect(resolveRequestedLoginLanguage("")).toBeNull();
  });
});
