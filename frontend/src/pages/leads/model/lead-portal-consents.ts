import { normalizeScopeCodes, staffScopeSummary, type ConsentRecipientScope } from "@/lib/consent-recipient-scope";
import type { LeadPortalConsent } from "../data/lead-portal-intake-api";

export const PORTAL_CONSENT_OPTIONS = [
  "agency_processing", "doctors_to_agency", "data_system", "named_recipients",
] as const;
export const PORTAL_CONSENT_CHANNELS = [
  "channel_email", "channel_threema", "channel_whatsapp", "channel_telegram",
] as const;
export type PortalConsentChoiceKey = typeof PORTAL_CONSENT_OPTIONS[number] | typeof PORTAL_CONSENT_CHANNELS[number];

/** Who a named recipient is to the person (owner 2026-10-12); not sanctions-screened. */
export const CONSENT_RECIPIENT_RELATIONS = ["spouse", "child", "relative", "friend", "family_doctor", "clinic", "other"] as const;
export type ConsentRecipientRelation = (typeof CONSENT_RECIPIENT_RELATIONS)[number];

/** A person or institution the person named for "named recipients". */
export type LeadPortalConsentRecipient = {
  name: string; relation: string; contact: string | null;
  /** The phone the person calls GMED from and the date of birth ("YYYY-MM-DD"): staff check a caller by both (owner 2026-10-26). */
  phone?: string | null;
  birth_date?: string | null;
  /** Free text of persons named before 2026-10-19. */
  scope?: string | null;
  /** The chosen scope (owner 2026-10-19); absent for legacy persons. */
  scope_codes?: ConsentRecipientScope[];
};

/** What the person may be told, in the staff language ("медицинская, финансовая"); a legacy free text as typed. */
export function recipientScopeLabel(recipient: Pick<LeadPortalConsentRecipient, "scope" | "scope_codes">, lang: string): string | null {
  const codes = normalizeScopeCodes(recipient.scope_codes);
  if (codes.length > 0) return staffScopeSummary(codes, lang);
  return recipient.scope?.trim() || null;
}

/** Independent disclosure receipt; legacy records without one remain unanswered. */
export type LeadPortalDisclosure = {
  allow_disclosure: boolean | null;
  consent_given: boolean | null;
  version: string | null;
  language: string | null;
  chosen_at: string | null;
  chosen_by: string | null;
  chosen_by_name: string | null;
  access_kind: string | null;
  company_name: string | null;
  consent_text: string | null;
};

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
    const scope = typeof raw.scope === "string" && raw.scope.trim() ? raw.scope.trim() : null;
    const scopeCodes = normalizeScopeCodes(raw.scope_codes);
    const phone = typeof raw.phone === "string" && raw.phone.trim() ? raw.phone.trim() : null;
    const birthDate = typeof raw.birth_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.birth_date.trim()) ? raw.birth_date.trim() : null;
    return [{
      name, relation: typeof raw.relation === "string" ? raw.relation : "other", contact, scope,
      ...(phone ? { phone } : {}), ...(birthDate ? { birth_date: birthDate } : {}),
      ...(scopeCodes.length > 0 ? { scope_codes: scopeCodes } : {}),
    }];
  });
}

export function normalizeLeadPortalDisclosure(value: unknown): LeadPortalDisclosure | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const text = (key: string) => typeof raw[key] === "string" && raw[key].trim() ? raw[key] as string : null;
  return {
    allow_disclosure: typeof raw.allow_disclosure === "boolean" ? raw.allow_disclosure : null,
    consent_given: typeof raw.consent_given === "boolean" ? raw.consent_given : null,
    version: text("version"), language: text("language"),
    chosen_at: text("chosen_at"), chosen_by: text("chosen_by"), chosen_by_name: text("chosen_by_name"),
    access_kind: text("access_kind"), company_name: text("company_name"), consent_text: text("consent_text"),
  };
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
