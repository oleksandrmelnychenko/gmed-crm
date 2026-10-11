import { describe, expect, it } from "vitest";

import { pluralDe, pluralRu, russianPluralForm } from "./plural";

describe("plural forms of staff texts", () => {
  it("takes the Russian form by the last digits, 11–14 always 'many'", () => {
    const cases: Array<[number, ReturnType<typeof russianPluralForm>]> = [
      [0, "many"],
      [1, "one"],
      [2, "few"],
      [3, "few"],
      [4, "few"],
      [5, "many"],
      [10, "many"],
      [11, "many"],
      [12, "many"],
      [13, "many"],
      [14, "many"],
      [15, "many"],
      [21, "one"],
      [22, "few"],
      [25, "many"],
      [101, "one"],
      [111, "many"],
      [112, "many"],
      [122, "few"],
    ];
    for (const [count, form] of cases) expect(russianPluralForm(count), String(count)).toBe(form);
  });

  it("returns the word for a count", () => {
    const forms = { one: "документ", few: "документа", many: "документов" };
    expect(pluralRu(1, forms)).toBe("документ");
    expect(pluralRu(2, forms)).toBe("документа");
    expect(pluralRu(5, forms)).toBe("документов");
    expect(pluralRu(11, forms)).toBe("документов");
    expect(pluralDe(1, "Dokument", "Dokumente")).toBe("Dokument");
    expect(pluralDe(0, "Dokument", "Dokumente")).toBe("Dokumente");
    expect(pluralDe(2, "Dokument", "Dokumente")).toBe("Dokumente");
  });
});
