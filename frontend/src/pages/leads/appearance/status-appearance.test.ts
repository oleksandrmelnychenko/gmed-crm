import { describe, expect, it } from "vitest";

import {
  daysUntilRetentionDeadline,
  leadSourceTone,
  retentionCountdownLabel,
} from "./status-appearance";

describe("leadSourceTone", () => {
  it.each([
    ["Website Wizard", "warning"],
    ["existing_patient", "success"],
    ["manual", "neutral"],
    ["Website Contact Form", "info"],
    ["referral", "brand"],
    ["unexpected_source", "error"],
  ] as const)("maps %s to %s", (source, tone) => {
    expect(leadSourceTone(source)).toBe(tone);
  });
});

describe("daysUntilRetentionDeadline", () => {
  const now = new Date("2026-10-01T12:00:00Z");

  it("is null while the deletion rule does not apply", () => {
    expect(daysUntilRetentionDeadline(null, now)).toBeNull();
    expect(daysUntilRetentionDeadline(undefined, now)).toBeNull();
    expect(daysUntilRetentionDeadline("not a date", now)).toBeNull();
  });

  it("counts a started day as a whole day and never goes below zero", () => {
    expect(daysUntilRetentionDeadline("2026-10-15T12:00:00Z", now)).toBe(14);
    expect(daysUntilRetentionDeadline("2026-10-02T09:00:00Z", now)).toBe(1);
    expect(daysUntilRetentionDeadline("2026-09-20T12:00:00Z", now)).toBe(0);
  });

  it("names the day of deletion once the deadline is reached", () => {
    expect(retentionCountdownLabel(3, "ru")).toBe("Удаление через 3 дн");
    expect(retentionCountdownLabel(3, "de")).toBe("Löschung in 3 T.");
    expect(retentionCountdownLabel(0, "ru")).toBe("Удаление сегодня");
    expect(retentionCountdownLabel(0, "de")).toBe("Löschung heute");
  });
});
