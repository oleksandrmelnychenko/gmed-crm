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

type RequiredDocumentRule = { key: string; fulfilled: boolean };
type MissingDocumentRule = { key: string; label: string };

/**
 * The required documents as the patient can act on them (global QA
 * 2026-11-10): the block counted a consent as missing ("fulfilled 1/2", "1
 * required document is missing") although no upload of the portal fulfils
 * it. `own*` count the rules the patient fulfils with an upload;
 * `consentsMissing` are the consents GMED sends for signing, named apart.
 */
export function portalRequiredDocumentProgress(alerts: {
  required_documents: readonly RequiredDocumentRule[];
  missing_documents: readonly MissingDocumentRule[];
}): {
  ownTotal: number;
  ownFulfilled: number;
  ownMissing: MissingDocumentRule[];
  consentsMissing: MissingDocumentRule[];
} {
  const own = alerts.required_documents.filter((rule) => !isConsentRuleKey(rule.key));
  return {
    ownTotal: own.length,
    ownFulfilled: own.filter((rule) => rule.fulfilled).length,
    ownMissing: alerts.missing_documents.filter((rule) => !isConsentRuleKey(rule.key)),
    consentsMissing: alerts.missing_documents.filter((rule) => isConsentRuleKey(rule.key)),
  };
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
