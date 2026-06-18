import { describe, expect, it } from "vitest";

import {
  getOptionalAdminPasswordError,
  getRequiredAdminPasswordError,
  isPasswordConfirmationMismatch,
} from "./admin-users.helpers";

const messages = {
  login_error_password_short: "Minimum 8 characters",
  login_error_password_long: "Password too long",
  users_password_policy_complexity:
    "Password must contain uppercase and lowercase letters, a number, and a symbol",
};

describe("admin user password validation", () => {
  it("requires user passwords to be at least eight characters", () => {
    expect(getRequiredAdminPasswordError("1", messages)).toBe(
      "Minimum 8 characters",
    );
    expect(getRequiredAdminPasswordError("Password1!", messages)).toBeNull();
  });

  it("requires uppercase, lowercase, digit, and symbol classes", () => {
    expect(getRequiredAdminPasswordError("12345678", messages)).toBe(
      messages.users_password_policy_complexity,
    );
    expect(getRequiredAdminPasswordError("password1!", messages)).toBe(
      messages.users_password_policy_complexity,
    );
    expect(getRequiredAdminPasswordError("PASSWORD1!", messages)).toBe(
      messages.users_password_policy_complexity,
    );
    expect(getRequiredAdminPasswordError("Password!", messages)).toBe(
      messages.users_password_policy_complexity,
    );
    expect(getRequiredAdminPasswordError("Password1", messages)).toBe(
      messages.users_password_policy_complexity,
    );
  });

  it("allows empty optional reset passwords but validates entered values", () => {
    expect(getOptionalAdminPasswordError("", messages)).toBeNull();
    expect(getOptionalAdminPasswordError("1", messages)).toBe(
      "Minimum 8 characters",
    );
  });

  it("detects confirmation mismatches only after confirmation input starts", () => {
    expect(isPasswordConfirmationMismatch("Password1!", "")).toBe(false);
    expect(isPasswordConfirmationMismatch("Password1!", "Password1?")).toBe(
      true,
    );
    expect(isPasswordConfirmationMismatch("Password1!", "Password1!")).toBe(
      false,
    );
  });
});
