import { describe, expect, it } from "vitest";

import { normalizeInputStep } from "./input";

describe("Input", () => {
  it("uses one-minute steps for time inputs by default", () => {
    expect(normalizeInputStep("time", undefined)).toBe(60);
  });

  it("preserves explicit time steps and unrelated input types", () => {
    expect(normalizeInputStep("time", 900)).toBe(900);
    expect(normalizeInputStep("number", undefined)).toBeUndefined();
  });
});
