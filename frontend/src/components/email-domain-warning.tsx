import { emailDomainOf, isKnownNoMailEmail, useEmailDomainStatus } from "@/lib/email-domain-check";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Staff UI (de/ru) and lead cabinet (de/ru/uk/en) languages; anything else reads as Russian. */
export type EmailDomainWarningLang = "de" | "ru" | "uk" | "en" | string;

/** The warning for an address whose domain does not receive mail. */
export function emailDomainWarningText(email: string, lang: EmailDomainWarningLang): string {
  const domain = emailDomainOf(email) ?? "";
  switch (lang) {
    case "de":
      return `Die Domain „${domain}“ empfängt keine E-Mails – bitte Adresse prüfen`;
    case "uk":
    case "ua":
      return `Домен «${domain}» не приймає пошту — перевірте адресу`;
    case "en":
      return `The domain “${domain}” does not receive e-mail — please check the address`;
    default:
      return `Домен «${domain}» не принимает почту — проверьте адрес`;
  }
}

/**
 * The submit-time check: the warning text when the domain is already known
 * not to accept mail, otherwise null. Never waits for DNS; pending or
 * `unknown` never blocks.
 */
export function knownNoMailEmailError(email: string, lang: EmailDomainWarningLang): string | null {
  return isKnownNoMailEmail(email) ? emailDomainWarningText(email, lang) : null;
}

type EmailDomainWarningProps = {
  email: string | null | undefined;
  /** The language of the surrounding UI; the staff UI language when omitted. */
  lang?: EmailDomainWarningLang;
  enabled?: boolean;
  id?: string;
  className?: string;
};

/**
 * One short line under an e-mail field (or a stored address) when the server
 * found in DNS that the domain does not receive mail. Nothing otherwise.
 */
export function EmailDomainWarning({ email, lang, enabled = true, id, className }: EmailDomainWarningProps) {
  const { lang: uiLang } = useLang();
  const value = email ?? "";
  const status = useEmailDomainStatus(value, enabled);
  if (status !== "no_mail") return null;
  return (
    <span id={id} role="alert" className={cn("block text-xs font-normal text-destructive", className)}>
      {emailDomainWarningText(value, lang ?? uiLang)}
    </span>
  );
}
