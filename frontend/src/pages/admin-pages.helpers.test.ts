import { describe, expect, it } from "vitest";

import {
  adminLocale,
  codedAdminErrorText,
  compactNotificationConfig,
  maskNotificationSecrets,
  matchesNotificationSearch,
  NOTIFICATION_SECRET_MASK,
  prettyNotificationConfig,
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

  it("never shows a stored credential of a notification channel (screens QA E F3)", () => {
    const config = {
      host: "smtp.qa-e.invalid",
      password: "not-a-real-secret-qa",
      headers: { Authorization: "Bearer abc", "X-Trace": "1" },
      api_key: "",
    };
    expect(maskNotificationSecrets(config)).toEqual({
      host: "smtp.qa-e.invalid",
      password: NOTIFICATION_SECRET_MASK,
      headers: { Authorization: NOTIFICATION_SECRET_MASK, "X-Trace": "1" },
      api_key: "",
    });
    expect(compactNotificationConfig(config)).not.toContain("not-a-real-secret-qa");
    expect(prettyNotificationConfig(config)).not.toContain("Bearer abc");
  });

  it("translates a coded server refusal", () => {
    const error = Object.assign(new Error("Field key already exists"), {
      body: { error: "custom_field_key_exists" },
    });
    expect(codedAdminErrorText(error, { custom_field_key_exists: "Ключ занят" }, "Ошибка")).toBe("Ключ занят");
    expect(codedAdminErrorText(new Error("raw"), {}, "Ошибка")).toBe("raw");
    expect(codedAdminErrorText(null, {}, "Ошибка")).toBe("Ошибка");
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

  it("decodes escaped JSON strings instead of showing a literal \\n (QA E-07)", () => {
    const stored = JSON.stringify("Albert-Schweitzer-Straße 56\n81735 München");
    expect(normalizeAdminSettingValue(stored)).toBe("Albert-Schweitzer-Straße 56\n81735 München");
    expect(normalizeAdminSettingValue('"Say \\"hi\\""')).toBe('Say "hi"');
    expect(summarizeAdminSettingValue("agency_address", stored)).toBe(
      "Albert-Schweitzer-Straße 56, 81735 München",
    );
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
