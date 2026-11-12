import { describe, expect, it } from "vitest";

import { differingLanguageNames, secondaryName } from "./specialization-names";

describe("differingLanguageNames", () => {
  it("lists only languages whose name differs from German", () => {
    expect(
      differingLanguageNames({
        name_de: "Kardiologie",
        name_ru: "Кардиология",
        name_en: "Kardiologie",
        name_es: "",
      }),
    ).toEqual(["DE: Kardiologie", "RU: Кардиология"]);
  });

  it("keeps a differing English name and ignores case-only differences", () => {
    expect(
      differingLanguageNames({
        name_de: "Kardiologie",
        name_ru: null,
        name_en: "Cardiology",
        name_es: "kardiologie",
      }),
    ).toEqual(["DE: Kardiologie", "EN: Cardiology"]);
  });

  it("lists every filled language without a German name", () => {
    expect(differingLanguageNames({ name_de: " ", name_ru: "Кардиология", name_en: "Cardiology" })).toEqual([
      "RU: Кардиология",
      "EN: Cardiology",
    ]);
  });
});

describe("secondaryName", () => {
  it("hides a name that repeats the shown one", () => {
    expect(secondaryName("Kardiologie", "Kardiologie")).toBeNull();
    expect(secondaryName("Kardiologie", "")).toBeNull();
    expect(secondaryName("Кардиология", "Kardiologie")).toBe("Kardiologie");
  });
});
