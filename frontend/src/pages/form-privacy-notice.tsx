import { FORM_PRIVACY_SECTIONS, FORM_PRIVACY_VERSION } from "./form-privacy-content";

export type FormPrivacyAgency = Partial<Record<
  | "agency_name"
  | "agency_care_of"
  | "agency_address"
  | "agency_phone"
  | "agency_email"
  | "agency_privacy_email"
  | "agency_data_system_name"
  | "agency_data_controller_statement",
  string
>>;

/** The notice for an inquiry, available before consent and inside the lead cabinet. */
export function FormPrivacyNotice({ lang, agency }: { lang: "de" | "ru"; agency: FormPrivacyAgency | null }) {
  const name = agency?.agency_name || "GMED";
  const privacyEmail = agency?.agency_privacy_email || agency?.agency_email || "";
  const replaceSettings = (paragraph: string) => paragraph
    .replaceAll("GMED-EDV-System", agency?.agency_data_system_name || "GMED-EDV-System")
    .replaceAll("datenschutz@gmed-health.com", privacyEmail || "datenschutz@gmed-health.com");

  return (
    <div className="space-y-5" data-testid="form-privacy-notice" data-version={FORM_PRIVACY_VERSION}>
      {FORM_PRIVACY_SECTIONS[lang].map((section) => (
        <section key={section.number} className="space-y-2.5 border-t border-border/50 pt-4 first:border-t-0 first:pt-0" aria-labelledby={`form-privacy-section-${section.number}`}>
          <h3 id={`form-privacy-section-${section.number}`} className="flex items-baseline gap-2 text-[13px] font-semibold leading-5 tracking-tight">
            <span className="shrink-0 font-mono text-xs text-muted-foreground">{section.number}.</span>
            <span>{section.title}</span>
          </h3>
          {section.number === 1 ? (
            <>
              <address className="not-italic leading-6">
                <strong>{name}</strong>
                {agency?.agency_care_of ? <><br />{agency.agency_care_of}</> : null}
                {agency?.agency_address ? <><br />{agency.agency_address}</> : null}
                {agency?.agency_email ? <><br />E-Mail: <a href={`mailto:${agency.agency_email}`} className="underline underline-offset-2">{agency.agency_email}</a></> : null}
                {agency?.agency_phone ? <><br />{lang === "de" ? "Telefon" : "Телефон"}: {agency.agency_phone}</> : null}
              </address>
              {agency?.agency_care_of ? <p>{lang === "de" ? "Verantwortlich für die Datenverarbeitung" : "Ответственное за обработку данных лицо"}: {agency.agency_care_of}.</p> : null}
              {privacyEmail ? (
                <p>
                  {lang === "de" ? "Datenschutzkontakt" : "Контакт по защите данных"}: <a href={`mailto:${privacyEmail}`} className="underline underline-offset-2">{privacyEmail}</a>
                </p>
              ) : null}
            </>
          ) : null}
          {section.blocks.map((block, index) => block.kind === "list" ? (
            <ul key={index} className="list-disc space-y-2 pl-5 marker:text-[var(--brand)]" data-testid={`form-privacy-list-${section.number}-${index}`}>
              {block.items.map((item, itemIndex) => <li key={itemIndex} className="pl-1">{replaceSettings(item)}</li>)}
            </ul>
          ) : <p key={index} className={block.text.endsWith(":") && block.text.length < 160 ? "font-medium" : undefined}>{replaceSettings(block.text)}</p>)}
        </section>
      ))}
    </div>
  );
}
