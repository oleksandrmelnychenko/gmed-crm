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
