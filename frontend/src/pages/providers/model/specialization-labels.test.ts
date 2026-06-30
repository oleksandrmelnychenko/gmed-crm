import { describe, expect, it } from "vitest";

import { specializationLabelForValue } from "./specialization-labels";

describe("specializationLabelForValue", () => {
  it("renders known compound specialization codes as readable labels", () => {
    expect(specializationLabelForValue("dermatologie_und_venerologie", [], "ru")).toBe(
      "Дерматология и венерология",
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
