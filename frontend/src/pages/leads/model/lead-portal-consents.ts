import type { LeadPortalConsent } from "../data/lead-portal-intake-api";

export const PORTAL_CONSENT_OPTIONS = [
  "agency_processing", "doctors_to_agency", "data_system", "named_recipients",
] as const;
export const PORTAL_CONSENT_CHANNELS = [
  "channel_email", "channel_threema", "channel_whatsapp", "channel_telegram",
] as const;
export type PortalConsentChoiceKey = typeof PORTAL_CONSENT_OPTIONS[number] | typeof PORTAL_CONSENT_CHANNELS[number];

/** Who a named recipient is to the person (owner 2026-10-12); not sanctions-screened. */
export const CONSENT_RECIPIENT_RELATIONS = ["spouse", "child", "relative", "family_doctor", "clinic", "other"] as const;
export type ConsentRecipientRelation = (typeof CONSENT_RECIPIENT_RELATIONS)[number];

/** A person or institution the person named for "named recipients". */
export type LeadPortalConsentRecipient = { name: string; relation: string; contact: string | null };

/** The current choice made in the cabinet; absent answers are never inferred. */
export type LeadPortalConsentForm = {
  version: string | null;
  choices: Record<PortalConsentChoiceKey, boolean | null> | null;
  recipients: LeadPortalConsentRecipient[];
  chosen_at: string | null;
  chosen_by: string | null;
  chosen_by_name: string | null;
  chosen_by_role: string | null;
  access_kind: string | null;
};

/** The latest grant is authoritative, including its later revocation. */
export function latestPortalConsent(consents: readonly LeadPortalConsent[], type: string): LeadPortalConsent | null {
  const time = (consent: LeadPortalConsent) => {
    const parsed = Date.parse(consent.given_at ?? consent.revoked_at ?? "");
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return consents.filter((consent) => consent?.type === type)
    .reduce<LeadPortalConsent | null>((latest, consent) => !latest || time(consent) >= time(latest) ? consent : latest, null);
}

/** The named recipients of a stored choice; entries without a name are dropped. */
export function normalizeConsentRecipients(value: unknown): LeadPortalConsentRecipient[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const raw = item as Record<string, unknown>;
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    if (!name) return [];
    const contact = typeof raw.contact === "string" && raw.contact.trim() ? raw.contact.trim() : null;
    return [{ name, relation: typeof raw.relation === "string" ? raw.relation : "other", contact }];
  });
}

export function normalizeLeadPortalConsentForm(value: unknown): LeadPortalConsentForm | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const text = (key: string) => typeof raw[key] === "string" && raw[key].trim() ? raw[key] as string : null;
  const choices = raw.choices && typeof raw.choices === "object" && !Array.isArray(raw.choices)
    ? raw.choices as Record<string, unknown> : null;
  return {
    version: text("version"),
    choices: choices ? Object.fromEntries([...PORTAL_CONSENT_OPTIONS, ...PORTAL_CONSENT_CHANNELS]
      .map((key) => [key, typeof choices[key] === "boolean" ? choices[key] : null])) as LeadPortalConsentForm["choices"] : null,
    recipients: normalizeConsentRecipients(raw.recipients),
    chosen_at: text("chosen_at"), chosen_by: text("chosen_by"),
    chosen_by_name: text("chosen_by_name"), chosen_by_role: text("chosen_by_role"), access_kind: text("access_kind"),
  };
}
