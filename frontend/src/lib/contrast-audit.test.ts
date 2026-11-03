import { describe, expect, it } from "vitest";
import { composite, contrast, parseCssColor, toHex } from "./contrast-audit";

describe("contrast meter colour parsing", () => {
  it.each([
    ["#fff", "#ffffff", 1],
    ["#1a1a22", "#1a1a22", 1],
    ["rgb(255, 0, 0)", "#ff0000", 1],
    ["rgba(0, 0, 0, 0.5)", "#000000", 0.5],
    ["rgb(0 128 0 / 25%)", "#008000", 0.25],
    ["color(srgb 1 1 1 / 0.4)", "#ffffff", 0.4],
    // Tailwind emerald-700 and white as computed by Chrome.
    ["oklch(0.508 0.118 165.612)", "#007a55", 1],
    ["oklch(1 0 0)", "#ffffff", 1],
    ["oklab(0 0 0 / 0.2)", "#000000", 0.2],
  ])("reads %s", (input, hex, alpha) => {
    const color = parseCssColor(input)!;
    expect(toHex(color)).toBe(hex);
    expect(color[3]).toBeCloseTo(alpha);
  });

  it("returns null for colours it cannot measure", () => {
    expect(parseCssColor("currentcolor")).toBeNull();
    expect(parseCssColor("color(display-p3 1 0 0)")).toBeNull();
    expect(parseCssColor("transparent")).toEqual([0, 0, 0, 0]);
  });
});

describe("contrast meter ratios", () => {
  it("matches the WCAG reference values", () => {
    expect(contrast([0, 0, 0, 1], [255, 255, 255, 1])).toBeCloseTo(21);
    expect(contrast([118, 118, 118, 1], [255, 255, 255, 1])).toBeCloseTo(4.54, 2);
  });

  it("measures a faded colour against what is behind it", () => {
    const placeholder = composite([76, 82, 98, 0.45], [255, 255, 255, 1]);
    expect(contrast(placeholder, [255, 255, 255, 1])).toBeLessThan(4.5);
    expect(composite([0, 0, 0, 0], [10, 20, 30, 1])).toEqual([10, 20, 30, 1]);
  });
});
