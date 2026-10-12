import { describe, expect, it } from "vitest";

import { bindToLanguage } from "./index";

describe("bindToLanguage", () => {
  const helpers = {
    statusLabel: (status: string) => `status:${status}`,
    pluralLabel: (count: number, unit = "x") => `${count}${unit}`,
  };

  it("gives new copies for every language, so components recompute their text", () => {
    const ru = bindToLanguage(helpers, "ru");
    const de = bindToLanguage(helpers, "de");
    expect(ru.statusLabel).not.toBe(helpers.statusLabel);
    expect(de.statusLabel).not.toBe(ru.statusLabel);
    expect(Object.keys(de)).toEqual(Object.keys(helpers));
  });

  it("answers like the module functions", () => {
    const bound = bindToLanguage(helpers, "de");
    expect(bound.statusLabel("open")).toBe("status:open");
    expect(bound.pluralLabel(2)).toBe("2x");
    expect(bound.pluralLabel(3, "y")).toBe("3y");
  });
});
