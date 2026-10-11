import { describe, expect, it } from "vitest";

import { formatInterpreterHours } from "./runtime-formatters";

describe("formatInterpreterHours", () => {
  it("writes interpreter hours with a decimal comma like the order lines", () => {
    expect(formatInterpreterHours("1.5")).toBe("1,5");
    expect(formatInterpreterHours("2.50")).toBe("2,5");
    expect(formatInterpreterHours(3)).toBe("3");
    expect(formatInterpreterHours("0.25")).toBe("0,25");
  });

  it("leaves empty or unreadable values as they are", () => {
    expect(formatInterpreterHours(null)).toBe("");
    expect(formatInterpreterHours("")).toBe("");
    expect(formatInterpreterHours("n/a")).toBe("n/a");
  });
});
