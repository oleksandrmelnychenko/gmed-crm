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
