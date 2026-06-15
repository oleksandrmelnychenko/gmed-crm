import { describe, expect, it } from "vitest";

import { hydrateVegetative } from "./vegetative-section";

describe("hydrateVegetative", () => {
  it("keeps height and weight when the API serializes numeric columns as strings", () => {
    expect(
      hydrateVegetative({
        appetit_durst: "normal",
        koerpergroesse: "176.0",
        gewicht: "78.5",
        gewichtsveraenderung: "stable",
        grund: "baseline",
      }),
    ).toEqual({
      appetit_durst: "normal",
      koerpergroesse: "176.0",
      gewicht: "78.5",
      gewichtsveraenderung: "stable",
      grund: "baseline",
    });
  });

  it("still hydrates numeric height and weight values", () => {
    expect(
      hydrateVegetative({
        koerpergroesse: 176,
        gewicht: 78.5,
      }),
    ).toMatchObject({
      koerpergroesse: "176",
      gewicht: "78.5",
    });
  });
});
