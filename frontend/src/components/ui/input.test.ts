import { describe, expect, it } from "vitest";
import dayjs from "dayjs";

import {
  formatPickerValue,
  getTimePickerReferenceDate,
  normalizeInputStep,
  parseTimeValue,
  pickerFieldReadOnly,
  timePickerMinutesStep,
} from "./input";

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
    expect(timePickerMinutesStep("any")).toBe(1);
  });

  it("keeps time fields picker-only instead of keyboard-editable", () => {
    expect(pickerFieldReadOnly("time", undefined)).toBe(true);
    expect(pickerFieldReadOnly("time", false)).toBe(true);
    expect(pickerFieldReadOnly("date", false)).toBe(false);
  });

  it("formats picker values without leaking invalid dates", () => {
    expect(formatPickerValue(dayjs().hour(9).minute(5), "HH:mm")).toBe("09:05");
    expect(formatPickerValue(dayjs("not-a-date"), "HH:mm")).toBe("");
    expect(formatPickerValue(null, "HH:mm")).toBe("");
  });

  it("starts empty time picker selections at exact hours", () => {
    const referenceDate = getTimePickerReferenceDate();

    expect(referenceDate.hour()).toBe(0);
    expect(referenceDate.minute()).toBe(0);
    expect(referenceDate.second()).toBe(0);
    expect(referenceDate.millisecond()).toBe(0);
  });

  it("parses time values on the stable picker reference day", () => {
    const parsed = parseTimeValue("22:20");

    expect(parsed?.format("YYYY-MM-DD HH:mm")).toBe("2000-01-01 22:20");
  });

  it("accepts evening picker values without clipping them to the current day", () => {
    expect(parseTimeValue("18:20")?.format("YYYY-MM-DD HH:mm")).toBe(
      "2000-01-01 18:20",
    );
    expect(parseTimeValue("23:59")?.format("YYYY-MM-DD HH:mm")).toBe(
      "2000-01-01 23:59",
    );
    expect(parseTimeValue("24:00")).toBeNull();
  });
});
