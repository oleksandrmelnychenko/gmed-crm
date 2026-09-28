import { describe, expect, it } from "vitest";

import { announcementAudienceLabel, announcementWindowStatus } from "./admin-announcements";

const now = Date.parse("2026-09-28T12:00:00Z");

describe("announcementWindowStatus", () => {
  it("shows an announcement as active only inside its window", () => {
    expect(announcementWindowStatus({ is_active: true, starts_at: "2026-09-01T00:00:00Z", ends_at: null }, now)).toBe("active");
    expect(announcementWindowStatus({ is_active: true, starts_at: "2026-10-01T00:00:00Z", ends_at: null }, now)).toBe("scheduled");
    expect(
      announcementWindowStatus({ is_active: true, starts_at: "2026-09-01T00:00:00Z", ends_at: "2026-09-20T00:00:00Z" }, now),
    ).toBe("expired");
    expect(announcementWindowStatus({ is_active: false, starts_at: null, ends_at: null }, now)).toBe("inactive");
  });
});

describe("announcementAudienceLabel", () => {
  it("labels the audience and treats an unknown value as everyone", () => {
    const uiText = {
      announcements_audience_all: "Alle",
      announcements_audience_staff: "Mitarbeitende",
      announcements_audience_patients: "Patienten (Portal)",
    };
    expect(announcementAudienceLabel("staff", uiText)).toBe("Mitarbeitende");
    expect(announcementAudienceLabel("patients", uiText)).toBe("Patienten (Portal)");
    expect(announcementAudienceLabel("all", uiText)).toBe("Alle");
    expect(announcementAudienceLabel(undefined, uiText)).toBe("Alle");
  });
});
