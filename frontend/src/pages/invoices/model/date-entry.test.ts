import { describe, expect, it } from "vitest";

import { dateEntryRefusalText } from "./date-entry";

describe("a date the field refused is named (QA 2026-11-10, D-05)", () => {
  it("says a future date is not allowed instead of booking today", () => {
    expect(dateEntryRefusalText("maxDate", "ru")).toBe("Дата в будущем не допускается.");
    expect(dateEntryRefusalText("disableFuture", "de")).toBe(
      "Ein Datum in der Zukunft ist nicht zulässig.",
    );
  });

  it("names a date before the earliest day and an unfinished one", () => {
    expect(dateEntryRefusalText("minDate", "ru")).toContain("раньше");
    expect(dateEntryRefusalText("outOfRange", "de")).toContain("außerhalb");
    expect(dateEntryRefusalText("invalidDate", "ru")).toContain("не полностью");
  });

  it("is silent for an accepted date", () => {
    expect(dateEntryRefusalText(null, "ru")).toBeNull();
    expect(dateEntryRefusalText("", "de")).toBeNull();
  });
});
