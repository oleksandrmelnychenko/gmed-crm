/**
 * The rules for a person's name, city and phone, one set for every place a
 * lead's people are entered (owner 2026-10-24): the lead cabinet, the staff
 * wizard, a representative, the payer and the invoice recipient. The server
 * has the same rules (`crates/server/src/services/person_fields.rs`); they
 * apply to a new or changed value, a stored one stays acceptable.
 */

/** Longest first, middle or last name. */
export const PERSON_NAME_MAX = 100;
/** Longest city. */
export const PERSON_CITY_MAX = 120;
/** Longest phone number. */
export const PERSON_PHONE_MAX = 40;
/** Fewest digits of a phone number. */
export const PERSON_PHONE_MIN_DIGITS = 6;

/** A text on one line: trimmed, inner whitespace collapsed to one space. */
export function oneLine(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

/**
 * A usable phone number: at least six digits, besides digits only
 * `+ - ( ) / .` and spaces, at most 40 characters. Surrounding spaces do not count.
 */
export function isValidPersonPhone(value: string | null | undefined): boolean {
  const phone = oneLine(value);
  return [...phone].length <= PERSON_PHONE_MAX
    && /^[0-9+\-()/. ]*$/.test(phone)
    && phone.replace(/\D/g, "").length >= PERSON_PHONE_MIN_DIGITS;
}

/** A phone a form may send: empty, the stored number unchanged, or a number of [`isValidPersonPhone`]. */
export function personPhoneAcceptable(value: string | null | undefined, stored: string | null | undefined): boolean {
  const phone = oneLine(value);
  return !phone || phone === oneLine(stored) || isValidPersonPhone(phone);
}

/** Whether a person born on `birthDate` (YYYY-MM-DD) is 18 or older on `today` (YYYY-MM-DD). */
export function isAdultOn(birthDate: string, today: string): boolean {
  const born = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate.trim());
  const now = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today.trim());
  if (!born || !now) return true;
  const eighteenth = `${String(Number(born[1]) + 18).padStart(4, "0")}-${born[2]}-${born[3]}`;
  return eighteenth <= today.trim();
}
