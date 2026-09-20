type AdminPasswordMessages = {
  login_error_password_short: string;
  login_error_password_long: string;
  users_password_policy_complexity: string;
};

export const ADMIN_USER_PASSWORD_MIN_LENGTH = 8;
export const ADMIN_USER_PASSWORD_MAX_LENGTH = 256;
export const ADMIN_USER_PASSWORD_POLICY_REGEXES = {
  lowercase: /[a-z]/,
  uppercase: /[A-Z]/,
  digit: /\d/,
  symbol: /[^A-Za-z0-9]/,
} as const;

export function getRequiredAdminPasswordError(
  password: string,
  messages: AdminPasswordMessages,
) {
  if (password.length < ADMIN_USER_PASSWORD_MIN_LENGTH) {
    return messages.login_error_password_short;
  }
  if (password.length > ADMIN_USER_PASSWORD_MAX_LENGTH) {
    return messages.login_error_password_long;
  }
  const hasRequiredCharacterClasses =
    ADMIN_USER_PASSWORD_POLICY_REGEXES.lowercase.test(password) &&
    ADMIN_USER_PASSWORD_POLICY_REGEXES.uppercase.test(password) &&
    ADMIN_USER_PASSWORD_POLICY_REGEXES.digit.test(password) &&
    ADMIN_USER_PASSWORD_POLICY_REGEXES.symbol.test(password);
  if (!hasRequiredCharacterClasses) {
    return messages.users_password_policy_complexity;
  }
  return null;
}

export function getOptionalAdminPasswordError(
  password: string,
  messages: AdminPasswordMessages,
) {
  if (password.length === 0) return null;
  return getRequiredAdminPasswordError(password, messages);
}

export function isPasswordConfirmationMismatch(
  password: string,
  confirmation: string,
) {
  return confirmation.length > 0 && password !== confirmation;
}

export function canSaveAdminUserEdit({
  profileDirty,
  password,
  confirmation,
  passwordError,
  saving,
}: {
  profileDirty: boolean;
  password: string;
  confirmation: string;
  passwordError: string | null;
  saving: boolean;
}) {
  const passwordDirty = password.length > 0 || confirmation.length > 0;
  const passwordReady =
    password.length > 0 &&
    password === confirmation &&
    passwordError === null;

  return (
    !saving &&
    (profileDirty || passwordReady) &&
    (!passwordDirty || passwordReady)
  );
}

export const ADMIN_USER_ROLE_KEYS = [
  "ceo",
  "ceo_assistant",
  "patient_manager",
  "teamlead_interpreter",
  "interpreter",
  "concierge",
  "billing",
  "sales",
  "it_admin",
  "patient",
] as const;

export type AdminUserRoleKey = (typeof ADMIN_USER_ROLE_KEYS)[number];

/**
 * Roles the signed-in administrator may assign. Only `users.manage_ceo`
 * (the CEO) may hand out the `ceo` role; the technical admin sees every
 * other role.
 */
export function getAssignableAdminUserRoles(
  canManageCeo: boolean,
): AdminUserRoleKey[] {
  return ADMIN_USER_ROLE_KEYS.filter((role) => canManageCeo || role !== "ceo");
}

export type AdminUserActionTarget = {
  id: string;
  role: string;
  is_active: boolean;
  locked_until: string | null;
  active_sessions?: number;
  totp_enrolled?: boolean;
};

export type AdminUserActionContext = {
  canManageCeo: boolean;
  currentUserId: string | null;
  now?: number;
};

export type AdminUserActions = {
  /** The row may be changed at all (CEO rows are read-only for IT Admin). */
  canManage: boolean;
  isLocked: boolean;
  canEdit: boolean;
  canUnlock: boolean;
  canRevokeSessions: boolean;
  canResetTotp: boolean;
  canDeactivate: boolean;
  canActivate: boolean;
};

export function isAdminUserLocked(
  user: Pick<AdminUserActionTarget, "locked_until">,
  now = Date.now(),
) {
  if (!user.locked_until) return false;
  const lockedUntil = new Date(user.locked_until).getTime();
  return Number.isFinite(lockedUntil) && lockedUntil > now;
}

/**
 * Which actions the users table offers for a row. Mirrors the server: every
 * operation on a CEO account needs `users.manage_ceo`, nobody deactivates
 * themselves, and unlock / revoke / TOTP reset only make sense when there
 * is something to unlock, revoke or reset.
 */
export function getAdminUserActions(
  user: AdminUserActionTarget,
  context: AdminUserActionContext,
): AdminUserActions {
  const canManage = context.canManageCeo || user.role !== "ceo";
  const isLocked = isAdminUserLocked(user, context.now);
  return {
    canManage,
    isLocked,
    canEdit: canManage,
    canUnlock: canManage && isLocked,
    canRevokeSessions: canManage && (user.active_sessions ?? 0) > 0,
    canResetTotp: canManage && user.totp_enrolled === true,
    canDeactivate: canManage && user.is_active && user.id !== context.currentUserId,
    canActivate: canManage && !user.is_active,
  };
}

type AdminUserErrorMessages = {
  users_last_ceo_protected: string;
  users_ceo_managed_by_ceo_only: string;
  users_cannot_deactivate_self: string;
};

/**
 * Readable text for the server's guard responses: the last-CEO protection
 * (`409 last_ceo_protected`), the CEO-only rule (`403` on a CEO target) and
 * the self-deactivation refusal. Anything else keeps the server message.
 */
export function describeAdminUserError(
  error: unknown,
  messages: AdminUserErrorMessages,
  targetRole?: string,
): string {
  const details = (error ?? {}) as {
    code?: unknown;
    status?: unknown;
    message?: unknown;
  };
  if (details.code === "last_ceo_protected") {
    return messages.users_last_ceo_protected;
  }
  if (details.status === 403 && targetRole === "ceo") {
    return messages.users_ceo_managed_by_ceo_only;
  }
  const message =
    typeof details.message === "string" ? details.message : String(error);
  if (message === "Cannot deactivate yourself") {
    return messages.users_cannot_deactivate_self;
  }
  return message;
}

const PASSWORD_CHARACTER_GROUPS = [
  "ABCDEFGHJKLMNPQRSTUVWXYZ",
  "abcdefghijkmnopqrstuvwxyz",
  "23456789",
  "!@#$%&*+-_=",
] as const;

function secureRandomIndex(max: number) {
  const values = new Uint32Array(1);
  globalThis.crypto.getRandomValues(values);
  return values[0] % max;
}

export function generateAdminPassword(length = 16) {
  const normalizedLength = Math.max(12, length);
  const alphabet = PASSWORD_CHARACTER_GROUPS.join("");
  const characters = PASSWORD_CHARACTER_GROUPS.map(
    (group) => group[secureRandomIndex(group.length)],
  );

  while (characters.length < normalizedLength) {
    characters.push(alphabet[secureRandomIndex(alphabet.length)]);
  }

  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapWith = secureRandomIndex(index + 1);
    [characters[index], characters[swapWith]] = [
      characters[swapWith],
      characters[index],
    ];
  }

  return characters.join("");
}
