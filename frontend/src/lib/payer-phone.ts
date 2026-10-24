import { isValidPersonPhone, personPhoneAcceptable } from "./person-fields";

/**
 * The payer's phone rule: the shared rule of every person a lead names
 * (`person-fields.ts`, the server's `services::person_fields::is_valid_phone`).
 */
export function isValidPayerPhone(value: string): boolean {
  return isValidPersonPhone(value);
}

/**
 * A phone the payer form may send: empty, the stored number unchanged (an older
 * one need not follow the rule), or a number of [`isValidPayerPhone`].
 */
export function payerPhoneAcceptable(value: string | null | undefined, stored: string | null | undefined): boolean {
  return personPhoneAcceptable(value, stored);
}
