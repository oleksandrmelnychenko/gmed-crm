import { describe, expect, it } from "vitest";

import { de } from "@/lib/i18n/de";
import { ru } from "@/lib/i18n/ru";

import { passwordRequiredBodyKey, passwordRequiredCurrentLabelKey } from "./account-password-required";

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

describe("forced password change speaks to a patient as a patient (QA 2026-11-12 D-7)", () => {
  it("names neither the administrator nor work for a patient", () => {
    const reset = ru.uiText[passwordRequiredBodyKey("reset", true)];
    expect(reset).toContain("одноразовый пароль");
    expect(reset).not.toContain("Администратор");
    expect(reset).not.toContain("работу");
    expect(de.uiText[passwordRequiredBodyKey("reset", true)]).not.toContain("Administration");
    for (const reason of ["initial", "reset", "expired"] as const) {
      expect(ru.uiText[passwordRequiredBodyKey(reason, true)]).toBeTruthy();
      expect(de.uiText[passwordRequiredBodyKey(reason, true)]).toBeTruthy();
    }
  });

  it("calls the first field the one-time password after a reset or on first sign-in", () => {
    expect(passwordRequiredCurrentLabelKey("reset")).toBe("account_password_current_temporary");
    expect(passwordRequiredCurrentLabelKey("initial")).toBe("account_password_current_temporary");
    expect(passwordRequiredCurrentLabelKey("expired")).toBe("account_password_current");
    expect(passwordRequiredCurrentLabelKey(undefined)).toBe("account_password_current");
    expect(ru.uiText.account_password_current_temporary).toContain("одноразовый");
    expect(de.uiText.account_password_current_temporary).toContain("Einmalpasswort");
  });
});
