import { describe, expect, it } from "vitest";

import { specializationLabelForItem, specializationLabelForValue } from "./specialization-labels";

describe("specializationLabelForItem", () => {
  it("shows the catalogue's own names, as /specializations does (QA C3-05)", () => {
    const dermatology = {
      code: "dermatologie_und_venerologie",
      name_de: "Dermatologie und Venerologie",
      name_ru: "Дерматовенерология",
    };
    expect(specializationLabelForItem(dermatology, "ru")).toBe("Дерматовенерология");
    expect(specializationLabelForItem({ code: "innere_medizin", name_de: "Innere Medizin", name_ru: "Внутренние болезни" }, "ru"))
      .toBe("Внутренние болезни");
    expect(specializationLabelForItem({ code: "kinder_und_jugendmedizin", name_de: "Kinder- und Jugendmedizin", name_ru: "Педиатрия" }, "de"))
      .toBe("Kinder- und Jugendmedizin");
    // An edited catalogue name wins over the built-in list.
    expect(specializationLabelForItem({ code: "kardiologie", name_ru: "Кардиология (взрослые)" }, "ru"))
      .toBe("Кардиология (взрослые)");
    // Without a name in the language the built-in list fills in.
    expect(specializationLabelForItem({ code: "kardiologie", name_en: "Cardiology" }, "ru")).toBe("Кардиология");
  });
});

describe("specializationLabelForValue", () => {
  it("renders known compound specialization codes as readable labels", () => {
    expect(specializationLabelForValue("dermatologie_und_venerologie", [], "ru")).toBe(
      "Дерматовенерология",
    );
    expect(specializationLabelForValue("innere_medizin", [], "ru")).toBe("Внутренние болезни");
    expect(specializationLabelForValue("kinder_und_jugendmedizin", [], "de")).toBe(
      "Kinder- und Jugendmedizin",
    );
    expect(specializationLabelForValue("endokrinologie_und_diabetologie", [], "ru")).toBe(
      "Эндокринология и диабетология",
    );
    expect(specializationLabelForValue("Orthopaedie und unfallchirurgie", [], "ru")).toBe(
      "Ортопедия и травматология",
    );
    expect(specializationLabelForValue("kardiologie", [], "ru")).toBe("Кардиология");
  });

  it("formats unknown code values without underscores", () => {
    expect(specializationLabelForValue("custom_specialty_code", [], "ru")).toBe(
      "Custom specialty code",
    );
  });
});
