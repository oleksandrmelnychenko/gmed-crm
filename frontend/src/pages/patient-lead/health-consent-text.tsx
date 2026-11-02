import { useEffect, useState } from "react";

import { buildApiUrl } from "@/lib/api";

/**
 * The phrase of the portal health consent that names the deletion deadline
 * (`health_consent_text` in `lead_portal_intake.rs`). The wording is a
 * versioned consent text and stays as it is; the frontend only links the
 * phrase to the retention section of the privacy notice (client 2026-11-02).
 */
const RETENTION_PHRASES = [
  "angegebenen Frist",
  "указанного срока",
  "зазначеного строку",
  "stated deadline",
] as const;

/** The retention section ("Speicherdauer" / «Срок хранения») of the form privacy notice on the legal page. */
export function retentionNoticeHref(lang: string) {
  return `/legal?notice=form&lang=${encodeURIComponent(lang)}#form-privacy-section-9`;
}

/** The consent split around its deadline phrase, or `null` when the text names none. */
export function splitRetentionPhrase(text: string): { before: string; phrase: string; after: string } | null {
  for (const phrase of RETENTION_PHRASES) {
    const index = text.indexOf(phrase);
    if (index >= 0) {
      return { before: text.slice(0, index), phrase, after: text.slice(index + phrase.length) };
    }
  }
  return null;
}

/** The consent text exactly as the server sent it, its deadline phrase linked to the retention section. */
export function HealthConsentText({ text, lang }: { text: string; lang: string }) {
  const parts = splitRetentionPhrase(text);
  if (!parts) return <>{text}</>;
  return (
    <>
      {parts.before}
      <a
        href={retentionNoticeHref(lang)}
        target="_blank"
        rel="noreferrer"
        className="text-[var(--brand)] underline underline-offset-2"
        data-testid="health-consent-retention-link"
      >
        {parts.phrase}
      </a>
      {parts.after}
    </>
  );
}

export type AgencyContact = { email: string; phone: string };

/** GMED's e-mail and phone as the legal page shows them (company settings, `GET /public/legal`). */
export function useAgencyContact(): AgencyContact | null {
  const [contact, setContact] = useState<AgencyContact | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(buildApiUrl("/public/legal"))
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: Partial<Record<"agency_email" | "agency_phone", string>> | null) => {
        if (cancelled || !payload) return;
        const email = payload.agency_email?.trim() ?? "";
        const phone = payload.agency_phone?.trim() ?? "";
        if (email || phone) setContact({ email, phone });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return contact;
}

/** The contact line under the consent; nothing while the company has no e-mail or phone. */
export function AgencyContactLine({ contact, label }: { contact: AgencyContact | null; label: string }) {
  if (!contact || (!contact.email && !contact.phone)) return null;
  return (
    <p className="text-xs leading-5 text-muted-foreground" data-testid="health-consent-contact">
      {label}{" "}
      {contact.email ? (
        <a href={`mailto:${contact.email}`} className="text-[var(--brand)] underline underline-offset-2">
          {contact.email}
        </a>
      ) : null}
      {contact.email && contact.phone ? " · " : null}
      {contact.phone ? (
        <a href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`} className="text-[var(--brand)] underline underline-offset-2">
          {contact.phone}
        </a>
      ) : null}
    </p>
  );
}
