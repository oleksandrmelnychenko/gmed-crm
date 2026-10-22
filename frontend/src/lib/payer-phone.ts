/**
 * The payer's phone rule (owner decision 2026-10-22): at least six digits —
 * the server's `is_valid_payer_phone` (`crates/server/src/routes/lead_payer.rs`)
 * — and, as the owner asked for the form, besides digits only "+", spaces,
 * brackets, "-" and "/". Surrounding spaces are ignored.
 */
export function isValidPayerPhone(value: string): boolean {
  const phone = value.trim();
  return /^[0-9+ ()\-/]*$/.test(phone) && phone.replace(/\D/g, "").length >= 6;
}

/**
 * A phone the payer form may send: empty, the stored number unchanged (an older
 * one need not follow the rule), or a number of [`isValidPayerPhone`].
 */
export function payerPhoneAcceptable(value: string | null | undefined, stored: string | null | undefined): boolean {
  const phone = (value ?? "").trim();
  return !phone || phone === (stored ?? "").trim() || isValidPayerPhone(phone);
}
