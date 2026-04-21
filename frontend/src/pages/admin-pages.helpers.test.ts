import { describe, expect, it } from "vitest";

import {
  adminLocale,
  compactNotificationConfig,
  matchesNotificationSearch,
  normalizeAdminSettingValue,
  shortAdminUserAgent,
  summarizeAdminSettingValue,
} from "./admin-pages.helpers";

describe("admin pages helpers", () => {
  it("maps UI language to the correct locale", () => {
    expect(adminLocale("de")).toBe("de-DE");
    expect(adminLocale("ru")).toBe("ru-RU");
  });

  it("compacts notification config to the first three entries", () => {
    expect(
      compactNotificationConfig({
        host: "smtp.example.com",
        port: 587,
        user: "ops",
        ignored: true,
      }),
    ).toBe('host: smtp.example.com, port: 587, user: ops');
  });

  it("matches notification search against name, type, and config payload", () => {
    const channel = {
      name: "Primary SMTP",
      channel_type: "smtp",
      config: { host: "smtp.example.com", user: "ops" },
    };

    expect(matchesNotificationSearch(channel, "primary")).toBe(true);
    expect(matchesNotificationSearch(channel, "smtp")).toBe(true);
    expect(matchesNotificationSearch(channel, "example.com")).toBe(true);
    expect(matchesNotificationSearch(channel, "webhook")).toBe(false);
  });

  it("normalizes quoted setting values", () => {
    expect(normalizeAdminSettingValue('"true"')).toBe("true");
    expect(normalizeAdminSettingValue("plain")).toBe("plain");
    expect(normalizeAdminSettingValue(undefined)).toBe("");
  });

  it("summarizes document requirement settings by line count", () => {
    expect(
      summarizeAdminSettingValue(
        "required_patient_documents",
        "passport\ninsurance\nconsent",
      ),
    ).toBe("3");
  });

  it("truncates long setting values for card previews", () => {
    const summary = summarizeAdminSettingValue(
      "agency_address",
      "This is a very long address field that should be trimmed for the summary card preview output.",
    );

    expect(summary.endsWith("…")).toBe(true);
    expect(summary.length).toBeLessThanOrEqual(57);
  });

  it("shortens user agents while preserving empty fallback", () => {
    expect(shortAdminUserAgent(null)).toBe("—");
    expect(shortAdminUserAgent("Mozilla/5.0", 20)).toBe("Mozilla/5.0");
    expect(shortAdminUserAgent("Mozilla/5.0 Very Long Agent", 10)).toBe("Mozilla/5.…");
  });
});
