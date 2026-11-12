import { describe, expect, it } from "vitest";
import { numberValidityMessage } from "./number-validity";

const ok = { valueMissing: false, rangeUnderflow: false, rangeOverflow: false, stepMismatch: false, badInput: false };

describe("numberValidityMessage", () => {
  it("speaks the interface language, not the browser's", () => {
    expect(numberValidityMessage({ ...ok, rangeOverflow: true }, { min: "0", max: "5" }, "ru")).toBe(
      "Значение должно быть от 0 до 5.",
    );
    expect(numberValidityMessage({ ...ok, rangeOverflow: true }, { min: "0", max: "100" }, "de")).toBe(
      "Der Wert muss zwischen 0 und 100 liegen.",
    );
  });

  it("names a one-sided bound and keeps a valid field silent", () => {
    expect(numberValidityMessage({ ...ok, rangeUnderflow: true }, { min: "1" }, "ru")).toBe(
      "Значение должно быть не меньше 1.",
    );
    expect(numberValidityMessage(ok, { min: "0", max: "5" }, "ru")).toBe("");
  });
});
