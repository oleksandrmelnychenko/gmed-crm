import { describe, expect, it } from "vitest";

import { representativeDetailsChanged, representativeDetailsErrors, representativeDetailsOf } from "./lead-representative-details";

const anna = {
  birth_place: "Kyiv",
  birth_country: "UA",
  citizenships: ["ua", "DE"],
  street: "Musterweg 1",
  zip: "10115",
  city: "Berlin",
  country: "DE",
};

describe("a representative's details staff edit", () => {
  it("load the cabinet's parts, citizenships as codes", () => {
    expect(representativeDetailsOf(anna)).toEqual({ ...anna, citizenships: ["UA", "DE"] });
    expect(representativeDetailsOf({ ...anna, birth_place: null, street: null, citizenships: [] })).toMatchObject({ birth_place: "", street: "", citizenships: [] });
  });

  it("count as changed only when staff typed something else", () => {
    const loaded = representativeDetailsOf(anna);
    expect(representativeDetailsChanged({ ...loaded, city: " Berlin " }, loaded)).toBe(false);
    expect(representativeDetailsChanged({ ...loaded, city: "Potsdam" }, loaded)).toBe(true);
    expect(representativeDetailsChanged({ ...loaded, citizenships: ["UA"] }, loaded)).toBe(true);
  });

  it("follow the shared limits for a changed value", () => {
    const loaded = representativeDetailsOf(anna);
    expect(representativeDetailsErrors({ ...loaded, city: "y".repeat(121) }, loaded)).toEqual({ city: "too_long" });
    expect(representativeDetailsErrors({ ...loaded, city: "y".repeat(121) }, { ...loaded, city: "y".repeat(121) })).toEqual({});
  });
});
