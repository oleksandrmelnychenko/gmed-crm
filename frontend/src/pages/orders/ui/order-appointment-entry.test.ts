import { describe, expect, it } from "vitest";

import type { SpecializationItem } from "@/pages/providers/model/types";

import { orderSpecializations, specializationName } from "./order-appointment-entry";

function spec(code: string, sort: number, overrides: Partial<SpecializationItem> = {}): SpecializationItem {
  return { id: code, code, name_en: code, name_de: `${code} DE`, name_ru: `${code} RU`, is_active: true, sort_order: sort, ...overrides };
}

describe("doctor picker specializations", () => {
  it("lists the requested specializations first, in the request's order, and hides inactive ones", () => {
    const ordered = orderSpecializations(
      [spec("cardiology", 1), spec("neurology", 2), spec("orthopedics", 3), spec("old", 0, { is_active: false })],
      ["orthopedics", "cardiology"],
    );
    expect(ordered.map((item) => item.code)).toEqual(["orthopedics", "cardiology", "neurology"]);
  });

  it("matches a request stored by English name when the code is missing", () => {
    const ordered = orderSpecializations(
      [spec("a", 1), spec("", 2, { id: "x", name_en: "Dermatology" })],
      ["Dermatology"],
    );
    expect(ordered[0].id).toBe("x");
    expect(specializationName(spec("a", 1, { name_ru: null }), "ru")).toBe("a DE");
  });
});
