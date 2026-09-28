/**
 * Contact values the staff screens accept: the lead wizard and the patient
 * profile use the same rules, and the server checks them again when a patient
 * is saved (`is_valid_contact_email` / `is_valid_contact_phone` in
 * crates/server/src/routes/patients.rs).
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** One "@" with text before it and a dotted domain after it, no spaces. */
export function isValidEmailAddress(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}

/** At least six digits; spaces, "+", brackets and dashes are allowed around them. */
export function isValidPhoneNumber(value: string): boolean {
  return value.replace(/\D/g, "").length >= 6;
}
