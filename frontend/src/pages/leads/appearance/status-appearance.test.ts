import { describe, expect, it } from "vitest";

import {
  daysUntilRetentionDeadline,
  leadSourceTone,
  retentionCountdownLabel,
  retentionDeadlineNotice,
  withFinalPeriod,
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

  it("counts the Berlin calendar days to the date the banner shows (live QA 2026-10-24)", () => {
    // Created a moment ago, the browser clock 5 s behind the server: still 14 days to 07.11.
    const created = new Date("2026-10-24T10:49:51Z");
    expect(daysUntilRetentionDeadline("2026-11-07T10:49:56Z", created)).toBe(14);
    // Deleted later today: "today", not "in 1 day".
    expect(daysUntilRetentionDeadline("2026-10-24T20:00:00Z", created)).toBe(0);
    // Late evening in Berlin is already the next calendar day in the deadline's date.
    expect(daysUntilRetentionDeadline("2026-10-25T23:30:00Z", created)).toBe(2);
  });

  it("names the day of deletion once the deadline is reached", () => {
    expect(retentionCountdownLabel(3, "ru")).toBe("Удаление через 3 дн");
    expect(retentionCountdownLabel(3, "de")).toBe("Löschung in 3 T.");
    expect(retentionCountdownLabel(0, "ru")).toBe("Удаление сегодня");
    expect(retentionCountdownLabel(0, "de")).toBe("Löschung heute");
  });

  it("ends the banner's first sentence with one period", () => {
    expect(withFinalPeriod(retentionCountdownLabel(14, "de"))).toBe("Löschung in 14 T.");
    expect(withFinalPeriod(retentionCountdownLabel(14, "ru"))).toBe("Удаление через 14 дн.");
    expect(withFinalPeriod(retentionCountdownLabel(0, "de"))).toBe("Löschung heute.");
  });

  it("states the date, the days left and what stops the deletion (2026-10-23)", () => {
    expect(retentionDeadlineNotice("2026-10-17T08:00:00Z", 3, "ru")).toBe(
      "Лид будет удалён 17.10.2026 (через 3 дн.), пока не подписан пакет DSGVO",
    );
    expect(retentionDeadlineNotice("2026-10-17T08:00:00Z", 3, "de")).toBe(
      "Lead wird am 17.10.2026 gelöscht (in 3 T.), solange das DSGVO-Paket nicht unterschrieben ist",
    );
    expect(retentionDeadlineNotice("2026-10-17T08:00:00Z", 0, "ru")).toBe(
      "Лид будет удалён 17.10.2026 (сегодня), пока не подписан пакет DSGVO",
    );
  });
});
