import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import { isValidEmailAddress } from "@/lib/contact-validation";

/**
 * Whether the domain of an e-mail address accepts mail, as the server sees it
 * in DNS (`GET /me/email-check`). The server refuses to store an address whose
 * domain it knows to be `no_mail`, and that knowledge comes from this lookup,
 * so every e-mail field asks it. `unknown` (no DNS answer, network or HTTP
 * error) never blocks anything.
 */
export type EmailDomainStatus = "accepts_mail" | "no_mail" | "unknown";

type EmailCheckResponse = {
  format_valid: boolean;
  domain: EmailDomainStatus | null;
};

export const EMAIL_DOMAIN_CHECK_DEBOUNCE_MS = 400;

const settled = new Map<string, EmailDomainStatus>();
const inFlight = new Map<string, Promise<EmailDomainStatus>>();

/** The lower-cased domain of an address, or null when it has none. */
export function emailDomainOf(email: string): string | null {
  const value = email.trim();
  const at = value.lastIndexOf("@");
  if (at < 0) return null;
  const domain = value.slice(at + 1).toLowerCase();
  return domain || null;
}

function asStatus(value: unknown): EmailDomainStatus {
  return value === "accepts_mail" || value === "no_mail" ? value : "unknown";
}

/**
 * The domain status of a valid address; one request per domain, shared by
 * concurrent callers. Only definite answers are kept, so an `unknown` domain
 * is asked again next time. An invalid address is never sent.
 */
export async function checkEmailDomain(email: string): Promise<EmailDomainStatus> {
  if (!isValidEmailAddress(email)) return "unknown";
  const domain = emailDomainOf(email);
  if (!domain) return "unknown";
  const known = settled.get(domain);
  if (known) return known;
  const pending = inFlight.get(domain);
  if (pending) return pending;

  const request = apiFetch<EmailCheckResponse>(
    `/me/email-check?email=${encodeURIComponent(email.trim())}`,
    { forceFresh: true },
  )
    .then((response) => {
      const status = response?.format_valid ? asStatus(response.domain) : "unknown";
      if (status !== "unknown") settled.set(domain, status);
      return status;
    })
    .catch((): EmailDomainStatus => "unknown")
    .finally(() => {
      inFlight.delete(domain);
    });
  inFlight.set(domain, request);
  return request;
}

/** The status already known for the address's domain, without asking. */
export function knownEmailDomainStatus(email: string): EmailDomainStatus | null {
  if (!isValidEmailAddress(email)) return null;
  const domain = emailDomainOf(email);
  return domain ? (settled.get(domain) ?? null) : null;
}

/** True only when the domain is already known not to accept mail; for submit checks. */
export function isKnownNoMailEmail(email: string): boolean {
  return knownEmailDomainStatus(email) === "no_mail";
}

/** Test helper: forget every answer. */
export function resetEmailDomainCheckCache() {
  settled.clear();
  inFlight.clear();
}

/**
 * The domain status of `email` for a form field: asked ~400 ms after the last
 * change, only for a valid address; null while invalid, disabled or pending.
 */
export function useEmailDomainStatus(email: string, enabled = true): EmailDomainStatus | null {
  const value = email.trim();
  const active = enabled && isValidEmailAddress(value);
  const [answer, setAnswer] = useState<{ email: string; status: EmailDomainStatus } | null>(null);

  useEffect(() => {
    if (!active) return;
    const known = knownEmailDomainStatus(value);
    let cancelled = false;
    const timer = setTimeout(
      () => {
        void checkEmailDomain(value).then((status) => {
          if (!cancelled) setAnswer({ email: value, status });
        });
      },
      known ? 0 : EMAIL_DOMAIN_CHECK_DEBOUNCE_MS,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, value]);

  if (!active) return null;
  if (answer?.email === value) return answer.status;
  return knownEmailDomainStatus(value);
}
