import { describe, expect, it } from "vitest";

import {
  ADMIN_USER_ROLE_KEYS,
  canSaveAdminUserEdit,
  describeAdminUserError,
  getAdminUserActions,
  getAssignableAdminUserRoles,
  getOptionalAdminPasswordError,
  getRequiredAdminPasswordError,
  generateAdminPassword,
  isPasswordConfirmationMismatch,
  type AdminUserActionTarget,
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

  it("generates a strong password that already matches the account policy", () => {
    const password = generateAdminPassword();

    expect(password).toHaveLength(16);
    expect(getRequiredAdminPasswordError(password, messages)).toBeNull();
  });

  it("enables edit save for a valid password-only change", () => {
    expect(
      canSaveAdminUserEdit({
        profileDirty: false,
        password: "Password1!",
        confirmation: "Password1!",
        passwordError: null,
        saving: false,
      }),
    ).toBe(true);
  });

  it("blocks edit save when a password draft is incomplete or invalid", () => {
    expect(
      canSaveAdminUserEdit({
        profileDirty: true,
        password: "Password1!",
        confirmation: "",
        passwordError: null,
        saving: false,
      }),
    ).toBe(false);
    expect(
      canSaveAdminUserEdit({
        profileDirty: false,
        password: "password",
        confirmation: "password",
        passwordError: messages.users_password_policy_complexity,
        saving: false,
      }),
    ).toBe(false);
  });
});

const guardMessages = {
  users_last_ceo_protected: "Last CEO is protected",
  users_ceo_managed_by_ceo_only: "Only the CEO manages CEO accounts",
  users_cannot_deactivate_self: "You cannot deactivate yourself",
};

function user(overrides: Partial<AdminUserActionTarget> = {}): AdminUserActionTarget {
  return {
    id: "u-1",
    role: "billing",
    is_active: true,
    locked_until: null,
    active_sessions: 0,
    totp_enrolled: false,
    ...overrides,
  };
}

describe("admin users page model", () => {
  it("offers the ceo role only to holders of users.manage_ceo", () => {
    expect(getAssignableAdminUserRoles(true)).toEqual([...ADMIN_USER_ROLE_KEYS]);
    const itAdminRoles = getAssignableAdminUserRoles(false);
    expect(itAdminRoles).not.toContain("ceo");
    expect(itAdminRoles).toEqual(
      ADMIN_USER_ROLE_KEYS.filter((role) => role !== "ceo"),
    );
  });

  it("keeps CEO rows read-only for the technical admin", () => {
    const ceoRow = user({ role: "ceo", locked_until: "2999-01-01T00:00:00Z", active_sessions: 2, totp_enrolled: true });
    const forItAdmin = getAdminUserActions(ceoRow, { canManageCeo: false, currentUserId: "it-admin" });
    expect(forItAdmin).toMatchObject({
      canManage: false,
      canEdit: false,
      canUnlock: false,
      canRevokeSessions: false,
      canResetTotp: false,
      canDeactivate: false,
      canActivate: false,
      isLocked: true,
    });
    const forCeo = getAdminUserActions(ceoRow, { canManageCeo: true, currentUserId: "other-ceo" });
    expect(forCeo).toMatchObject({
      canManage: true,
      canEdit: true,
      canUnlock: true,
      canRevokeSessions: true,
      canResetTotp: true,
      canDeactivate: true,
      canActivate: false,
    });
  });

  it("offers unlock, revoke and TOTP reset only when there is something to act on", () => {
    const plain = getAdminUserActions(user(), { canManageCeo: false, currentUserId: "it-admin" });
    expect(plain).toMatchObject({
      canEdit: true,
      canUnlock: false,
      canRevokeSessions: false,
      canResetTotp: false,
      canDeactivate: true,
      canActivate: false,
    });
    const busy = getAdminUserActions(
      user({ locked_until: "2999-01-01T00:00:00Z", active_sessions: 3, totp_enrolled: true }),
      { canManageCeo: false, currentUserId: "it-admin" },
    );
    expect(busy).toMatchObject({ canUnlock: true, canRevokeSessions: true, canResetTotp: true });
    const expiredLock = getAdminUserActions(
      user({ locked_until: "2000-01-01T00:00:00Z" }),
      { canManageCeo: false, currentUserId: "it-admin" },
    );
    expect(expiredLock.isLocked).toBe(false);
    expect(expiredLock.canUnlock).toBe(false);
  });

  it("never offers self-deactivation and offers activation for inactive rows", () => {
    const self = getAdminUserActions(user({ id: "me" }), { canManageCeo: true, currentUserId: "me" });
    expect(self.canDeactivate).toBe(false);
    const inactive = getAdminUserActions(user({ is_active: false }), { canManageCeo: false, currentUserId: "me" });
    expect(inactive.canDeactivate).toBe(false);
    expect(inactive.canActivate).toBe(true);
  });

  it("maps the server guards to readable text and keeps other messages", () => {
    expect(
      describeAdminUserError({ code: "last_ceo_protected", status: 409, message: "The last active CEO account cannot be deactivated or demoted" }, guardMessages),
    ).toBe("Last CEO is protected");
    expect(
      describeAdminUserError({ status: 403, message: "Forbidden" }, guardMessages, "ceo"),
    ).toBe("Only the CEO manages CEO accounts");
    expect(
      describeAdminUserError({ status: 403, message: "Forbidden" }, guardMessages, "billing"),
    ).toBe("Forbidden");
    expect(
      describeAdminUserError(new Error("Cannot deactivate yourself"), guardMessages),
    ).toBe("You cannot deactivate yourself");
    expect(describeAdminUserError(new Error("Email already exists"), guardMessages)).toBe(
      "Email already exists",
    );
    expect(describeAdminUserError("boom", guardMessages)).toBe("boom");
  });
});
