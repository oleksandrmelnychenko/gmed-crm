import { FORM_PRIVACY_SECTIONS, FORM_PRIVACY_VERSION, type FormPrivacyLanguage, type FormPrivacyText } from "./form-privacy-content";

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

/** The website's privacy policy the document refers to (owner 2026-10-14). */
const WEBSITE_POLICY = "www.gmed-health.com/legal";

/** Text with the website's policy address as a link. */
function Linked({ text }: { text: string }) {
  const at = text.indexOf(WEBSITE_POLICY);
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <a href={`https://${WEBSITE_POLICY}`} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{WEBSITE_POLICY}</a>
      {text.slice(at + WEBSITE_POLICY.length)}
    </>
  );
}

/** A paragraph or item as the document writes it: its bold beginning, then the rest. */
function Text({ entry }: { entry: FormPrivacyText }) {
  return entry.lead ? <><strong>{entry.lead}</strong> <Linked text={entry.text} /></> : <Linked text={entry.text} />;
}

/**
 * The notice for an inquiry, available before consent and inside the lead cabinet. It shows the
 * document word for word (owner 2026-10-14), so the agency settings fill nothing in here; the
 * `agency` prop is kept for the callers' signature.
 */
export function FormPrivacyNotice({ lang }: { lang: FormPrivacyLanguage; agency?: FormPrivacyAgency | null }) {
  return (
    <div className="space-y-5" data-testid="form-privacy-notice" data-version={FORM_PRIVACY_VERSION} lang={lang}>
      {FORM_PRIVACY_SECTIONS[lang].map((section) => (
        <section key={section.number} className="space-y-2.5 border-t border-border/50 pt-4 first:border-t-0 first:pt-0" aria-labelledby={`form-privacy-section-${section.number}`}>
          <h3 id={`form-privacy-section-${section.number}`} className="flex items-baseline gap-2 text-[13px] font-semibold leading-5 tracking-tight">
            <span className="shrink-0 font-mono text-xs text-muted-foreground">{section.number}.</span>
            <span>{section.title}</span>
          </h3>
          {section.blocks.map((block, index) => {
            if (block.kind === "address") {
              return (
                <address key={index} className="not-italic leading-6">
                  {block.lines.map((line, lineIndex) => lineIndex === 0
                    ? <strong key={lineIndex} className="block">{line}</strong>
                    : <span key={lineIndex} className="block">{line}</span>)}
                </address>
              );
            }
            if (block.kind === "list") {
              return (
                <ul key={index} className="list-disc space-y-2 pl-5 marker:text-[var(--brand)]" data-testid={`form-privacy-list-${section.number}-${index}`}>
                  {block.items.map((item, itemIndex) => <li key={itemIndex} className="pl-1"><Text entry={item} /></li>)}
                </ul>
              );
            }
            // The page's earlier styles: a short lead-in sentence ending with a colon stands out a little.
            const leadIn = !block.lead && block.text.endsWith(":") && block.text.length < 160;
            return <p key={index} className={leadIn ? "font-medium" : undefined}><Text entry={block} /></p>;
          })}
        </section>
      ))}
    </div>
  );
}
