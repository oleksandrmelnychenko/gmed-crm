/**
 * Contact values the staff screens and the lead cabinet accept. The server
 * applies the same e-mail rule to every address it stores
 * (`crates/server/src/email_address.rs`, `is_valid_email`), so keep them in
 * step.
 */
const MAX_EMAIL_LENGTH = 254;
const MAX_LOCAL_LENGTH = 64;
const LOCAL_PART = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+$/;
const DOMAIN_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

/**
 * `name@domain.tld`: an ASCII local part without leading, trailing or double
 * dots, a domain of at least two labels and a top-level domain of at least
 * two letters (or an `xn--` IDN label). Surrounding spaces are ignored.
 */
export function isValidEmailAddress(value: string): boolean {
  const email = value.trim();
  if (email.length > MAX_EMAIL_LENGTH) return false;
  const at = email.indexOf("@");
  if (at < 0) return false;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (
    !local ||
    local.length > MAX_LOCAL_LENGTH ||
    !LOCAL_PART.test(local) ||
    local.startsWith(".") ||
    local.endsWith(".") ||
    local.includes("..")
  ) {
    return false;
  }
  const labels = domain.split(".");
  if (labels.length < 2 || !labels.every((label) => DOMAIN_LABEL.test(label))) return false;
  const tld = labels[labels.length - 1];
  return /^[A-Za-z]{2,}$/.test(tld) || (tld.length > 4 && tld.toLowerCase().startsWith("xn--"));
}

/** At least six digits; spaces, "+", brackets and dashes are allowed around them. */
export function isValidPhoneNumber(value: string): boolean {
  return value.replace(/\D/g, "").length >= 6;
}
