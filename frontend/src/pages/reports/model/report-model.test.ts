import { describe, expect, it } from "vitest";

import { formatDays, formatHours } from "./report-model";

describe("report durations (QA E-25)", () => {
  it("uses the UI language unit and a decimal comma", () => {
    expect(formatDays(2.34, "-", "ru")).toBe("2,3 дн.");
    expect(formatDays(2.34, "-", "de")).toBe("2,3 Tage");
    expect(formatHours(3.4, "-", "ru")).toBe("3,4 ч");
    expect(formatHours(3.4, "-", "de")).toBe("3,4 Std.");
  });

  it("keeps the empty label when there is no value", () => {
    expect(formatDays(null, "keine Basis", "de")).toBe("keine Basis");
    expect(formatHours(Number.NaN, "нет", "ru")).toBe("нет");
  });
});
