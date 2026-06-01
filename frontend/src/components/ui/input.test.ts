import { describe, expect, it } from "vitest";

import { normalizeInputStep, pickerFieldReadOnly, timePickerMinutesStep } from "./input";

describe("Input", () => {
  it("uses one-minute steps for time inputs by default", () => {
    expect(normalizeInputStep("time", undefined)).toBe(60);
  });

  it("preserves explicit time steps and unrelated input types", () => {
    expect(normalizeInputStep("time", 900)).toBe(900);
    expect(normalizeInputStep("number", undefined)).toBeUndefined();
  });

  it("maps native time step seconds to picker minute steps", () => {
    expect(timePickerMinutesStep(undefined)).toBe(1);
    expect(timePickerMinutesStep(60)).toBe(1);
    expect(timePickerMinutesStep(900)).toBe(15);
    expect(timePickerMinutesStep("1800")).toBe(30);
  });

  it("keeps time fields picker-only instead of keyboard-editable", () => {
    expect(pickerFieldReadOnly("time", undefined)).toBe(true);
    expect(pickerFieldReadOnly("time", false)).toBe(true);
    expect(pickerFieldReadOnly("date", false)).toBe(false);
  });
});
