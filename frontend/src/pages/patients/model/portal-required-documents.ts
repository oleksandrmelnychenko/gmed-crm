/**
 * The "missing documents" notice of the patient portal (QA 2026-10-12
 * B2-13). The patient uploads an identity document or a report through the
 * upload form, but a consent — the Einverständniserklärung (DSGVO) or the
 * Schweigepflichtentbindung — counts only as a signed document GMED
 * processes: GMED sends it for signing (electronic signature or paper), and
 * no upload category of the portal fulfils it. The notice says so instead of
 * pointing at the upload form for it.
 */

/** Rule keys and codes of a consent (`consent_form`, `dsgvo`, `confidentiality_release`, …). */
const CONSENT_RULE_KEY = /(consent|einverst|einwillig|dsgvo|gdpr|privacy|schweigepflicht|confidentiality)/;

function normalizedRuleKey(key: string) {
  return key.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/** Whether a required-document rule asks for a consent the patient signs, not uploads. */
export function isConsentRuleKey(key: string): boolean {
  return CONSENT_RULE_KEY.test(normalizedRuleKey(key));
}

/**
 * Which lines the notice shows for the missing rules: the upload hint only
 * when something the patient can upload is missing, the consent hint only
 * when a consent is missing.
 */
export function missingDocumentHints(keys: readonly string[]): {
  upload: boolean;
  consent: boolean;
} {
  const consent = keys.some(isConsentRuleKey);
  const upload = keys.some((key) => !isConsentRuleKey(key));
  return { upload, consent };
}
