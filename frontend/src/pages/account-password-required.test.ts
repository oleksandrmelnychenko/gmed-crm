import { describe, expect, it } from "vitest";

import { de } from "@/lib/i18n/de";
import { ru } from "@/lib/i18n/ru";

import { passwordRequiredBodyKey } from "./account-password-required";

describe("forced password change explains why (QA E2-07 leftover)", () => {
  it("asks a brand-new account to set its own password", () => {
    expect(ru.uiText[passwordRequiredBodyKey("initial")]).toContain("первый вход");
    expect(ru.uiText[passwordRequiredBodyKey("initial")]).not.toContain("истёк");
    expect(de.uiText[passwordRequiredBodyKey("initial")]).toContain("erste Anmeldung");
  });

  it("names a reset and an expiry separately, the old text without a reason", () => {
    expect(ru.uiText[passwordRequiredBodyKey("reset")]).toContain("сбросил");
    expect(de.uiText[passwordRequiredBodyKey("expired")]).toContain("abgelaufen");
    expect(passwordRequiredBodyKey(undefined)).toBe("account_password_required_body");
    expect(ru.uiText[passwordRequiredBodyKey(null)]).toBeTruthy();
  });
});
