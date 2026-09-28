import { describe, expect, it } from "vitest";

import { announcementWindowStatus } from "./admin-announcements";

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
