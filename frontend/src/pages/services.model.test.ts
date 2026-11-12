import { describe, expect, it } from "vitest";

import { autoFilledCostEstimate } from "./services.model";

describe("autoFilledCostEstimate", () => {
  it("fills an empty estimate with the catalogue total", () => {
    expect(autoFilledCostEstimate("", "", "180,00")).toBe("180,00");
  });

  it("follows the catalogue while the user has not typed", () => {
    expect(autoFilledCostEstimate("180,00", "180,00", "360,00")).toBe("360,00");
  });

  it("keeps an estimate the user typed", () => {
    expect(autoFilledCostEstimate("95,25", "", "180,00")).toBe("95,25");
    expect(autoFilledCostEstimate("95,25", "180,00", "360,00")).toBe("95,25");
  });
});
