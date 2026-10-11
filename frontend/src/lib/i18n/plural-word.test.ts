import { describe, expect, it } from "vitest";

import { formatCount, pluralWord } from "./plural";

const PERSONS = { ru: ["лицо", "лица", "лиц"], de: ["Person", "Personen"] } as const;

describe("plural forms", () => {
  it("follows the Russian one / few / many rules", () => {
    expect(formatCount("ru", 1, PERSONS)).toBe("1 лицо");
    expect(formatCount("ru", 2, PERSONS)).toBe("2 лица");
    expect(formatCount("ru", 5, PERSONS)).toBe("5 лиц");
    expect(formatCount("ru", 11, PERSONS)).toBe("11 лиц");
    expect(formatCount("ru", 21, PERSONS)).toBe("21 лицо");
    expect(formatCount("ru", 22, PERSONS)).toBe("22 лица");
    expect(formatCount("ru", 112, PERSONS)).toBe("112 лиц");
    expect(pluralWord("ru", 2.5, PERSONS)).toBe("лица");
  });

  it("follows the German one / other rule", () => {
    expect(formatCount("de", 1, PERSONS)).toBe("1 Person");
    expect(formatCount("de", 0, PERSONS)).toBe("0 Personen");
    expect(formatCount("de", 3, PERSONS)).toBe("3 Personen");
  });
});
