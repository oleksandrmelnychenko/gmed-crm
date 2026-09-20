import { describe, expect, it } from "vitest";

import {
  describeSessionDevice,
  isPasswordChangeRequiredError,
  mapPasswordChangeError,
  passwordMeetsPolicy,
  sortSessions,
  validatePasswordForm,
  validateProfileForm,
} from "./account";
import { ApiRequestError } from "./api";

describe("validatePasswordForm", () => {
  const ok = { currentPassword: "Old-password-1!", newPassword: "New-password-2!", confirmPassword: "New-password-2!" };

  it("accepts a policy-compliant, confirmed password", () => {
    expect(validatePasswordForm(ok)).toBeNull();
  });

  it.each([
    [{ ...ok, currentPassword: "" }, "account_password_error_current_required"],
    [{ ...ok, newPassword: "Ab1!", confirmPassword: "Ab1!" }, "account_password_error_too_short"],
    [{ ...ok, newPassword: `A1!${"a".repeat(260)}`, confirmPassword: `A1!${"a".repeat(260)}` }, "account_password_error_too_long"],
    [{ ...ok, newPassword: "alllowercase1!", confirmPassword: "alllowercase1!" }, "account_password_error_policy"],
    [{ ...ok, newPassword: "Old-password-1!", confirmPassword: "Old-password-1!" }, "account_password_error_same_as_current"],
    [{ ...ok, confirmPassword: "New-password-3!" }, "account_password_error_mismatch"],
  ] as const)("rejects %j with %s", (input, expected) => {
    expect(validatePasswordForm(input)).toBe(expected);
  });

  it("checks the four character classes like the server", () => {
    expect(passwordMeetsPolicy("Replacement-password-2!")).toBe(true);
    expect(passwordMeetsPolicy("NoSymbol123")).toBe(false);
    expect(passwordMeetsPolicy("nodigits!!A")).toBe(false);
  });
});

describe("mapPasswordChangeError", () => {
  it("maps server codes to translation keys", () => {
    expect(mapPasswordChangeError(new ApiRequestError("x", { status: 400, code: "invalid_current_password" })))
      .toBe("account_password_error_invalid_current");
    expect(mapPasswordChangeError(new ApiRequestError("Password was used recently; choose a new one", { status: 422, code: "password_policy" })))
      .toBe("account_password_error_reused");
    expect(mapPasswordChangeError(new ApiRequestError("Password must contain ...", { status: 422, code: "password_policy" })))
      .toBe("account_password_error_policy");
    expect(mapPasswordChangeError(new Error("boom"))).toBe("account_password_error_generic");
  });

  it("recognises the forced-change gate", () => {
    expect(isPasswordChangeRequiredError(new ApiRequestError("x", { status: 403, code: "password_change_required" }))).toBe(true);
    expect(isPasswordChangeRequiredError(new ApiRequestError("x", { status: 403, code: "forbidden" }))).toBe(false);
    expect(isPasswordChangeRequiredError(new Error("x"))).toBe(false);
  });
});

describe("validateProfileForm", () => {
  it("requires a name and a plausible phone", () => {
    expect(validateProfileForm({ name: "Anna", phone: "" })).toBeNull();
    expect(validateProfileForm({ name: "Anna", phone: "+49 (30) 123-45/67" })).toBeNull();
    expect(validateProfileForm({ name: "   ", phone: "" })).toBe("account_profile_error_name");
    expect(validateProfileForm({ name: "a".repeat(201), phone: "" })).toBe("account_profile_error_name");
    expect(validateProfileForm({ name: "Anna", phone: "call me" })).toBe("account_profile_error_phone");
    expect(validateProfileForm({ name: "Anna", phone: "1".repeat(41) })).toBe("account_profile_error_phone");
  });
});

describe("sessions", () => {
  it("describes the device from the user agent", () => {
    expect(describeSessionDevice({
      user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
      device_fingerprint: null,
    })).toBe("Chrome · Windows");
    expect(describeSessionDevice({
      user_agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1",
      device_fingerprint: null,
    })).toBe("Safari · iOS");
    expect(describeSessionDevice({ user_agent: null, device_fingerprint: "abcdef1234567890" })).toBe("abcdef123456");
    expect(describeSessionDevice({ user_agent: null, device_fingerprint: null })).toBeNull();
  });

  it("puts the current session first, then the most recent", () => {
    const base = { device_fingerprint: null, ip_address: null, user_agent: null, created_at: "2026-09-01T00:00:00Z" };
    const sorted = sortSessions([
      { ...base, family_id: "old", is_current: false, last_activity_at: "2026-09-01T00:00:00Z" },
      { ...base, family_id: "new", is_current: false, last_activity_at: "2026-09-20T00:00:00Z" },
      { ...base, family_id: "me", is_current: true, last_activity_at: "2026-09-10T00:00:00Z" },
    ]);
    expect(sorted.map((session) => session.family_id)).toEqual(["me", "new", "old"]);
  });
});
