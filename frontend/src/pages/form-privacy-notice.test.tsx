import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { FORM_PRIVACY_SECTIONS, FORM_PRIVACY_TRANSLATION_NOTE } from "./form-privacy-content";
import { FormPrivacyNotice } from "./form-privacy-notice";
import { LegalNoticePage } from "./legal";

const auth = vi.hoisted(() => ({ user: null as null | { role: string; portal_mode?: string } }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: auth.user }) }));

describe("inquiry privacy notice", () => {
  it.each(["de", "ru"] as const)("shows all 14 sections in %s word for word as the document", (lang) => {
    const html = renderToStaticMarkup(<FormPrivacyNotice lang={lang} agency={{
      agency_name: "Testagentur",
      agency_email: "contact@example.com",
      agency_privacy_email: "privacy@example.com",
      agency_data_system_name: "Test CRM",
    }} />);
    expect(FORM_PRIVACY_SECTIONS[lang].map((section) => section.number)).toEqual(Array.from({ length: 14 }, (_, index) => index + 1));
    expect(html).toContain('data-version="2026-10-12"');
    // The document's own contact data, never the agency settings (owner 2026-10-14).
    expect(html).toContain("GMED - Agentur für Patientenbetreuung,");
    expect(html).toContain("contact@gmed-health.com");
    expect(html).toContain("datenschutz@gmed-health.com");
    expect(html).toContain("GMED-EDV-System");
    // The document's placeholder for the website policy is the website's legal page.
    expect(html).toContain('href="https://www.gmed-health.com/legal"');
    expect(html).not.toContain("[Link");
    expect(html).not.toContain("[ссылка");
    for (const setting of ["Testagentur", "Test CRM", "privacy@example.com", "contact@example.com"]) expect(html).not.toContain(setting);
    expect(html.match(/<address\b/g)).toHaveLength(1);
    // The bold beginnings of the purposes, the recipients and the right to object, and the controller name.
    expect(html.match(/<strong\b/g)).toHaveLength(9);
    expect(html).toContain("FiSaLis");
    expect(html).toContain("Hetzner");
    expect(html).toContain("Skribble");
    expect(html).toContain("180");
    expect(html).toContain("12.10.2026");
    // The lists in the reference remain semantic lists: data, purposes,
    // processors, other recipients, and the five retention cases.
    expect(html.match(/<ul\b/g)).toHaveLength(5);
    expect(html.match(/<li\b/g)).toHaveLength(22);
    expect(FORM_PRIVACY_SECTIONS[lang].find((section) => section.number === 6)?.blocks
      .filter((block) => block.kind === "list").map((block) => block.items.length)).toEqual([2, 4]);
    expect(FORM_PRIVACY_SECTIONS[lang].find((section) => section.number === 9)?.blocks
      .find((block) => block.kind === "list")?.items).toHaveLength(5);
  });

  it.each(["de", "en", "uk", "ru"] as const)("opens the complete notice from a %s cabinet link in that language", (lang) => {
    auth.user = { role: "patient", portal_mode: "lead" };
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={[`/legal?lang=${lang}#privacy`]}><LegalNoticePage /></MemoryRouter>);
    expect(html).toContain(`lang="${lang}"`);
    expect(html).toContain(FORM_PRIVACY_SECTIONS[lang][0].title);
    expect(html).toContain(FORM_PRIVACY_SECTIONS[lang][13].title);
    // The body is the reader's language too, not German below translated headings (QA 2026-11-10, finding 21).
    if (lang !== "de") expect(html).not.toContain(FORM_PRIVACY_SECTIONS.de[4].title);
    expect(html).toContain({ de: "Impressum", en: "Legal notice", uk: "Правова інформація", ru: "Правовая информация" }[lang]);
  });

  it.each(["en", "uk"] as const)("the %s translation follows the German text block by block and says that the German version counts", (lang) => {
    const html = renderToStaticMarkup(<FormPrivacyNotice lang={lang} />);
    expect(html).toContain('data-testid="form-privacy-translation-note"');
    expect(html).toContain(FORM_PRIVACY_TRANSLATION_NOTE[lang]);
    expect(FORM_PRIVACY_TRANSLATION_NOTE.de).toBeUndefined();
    expect(FORM_PRIVACY_TRANSLATION_NOTE.ru).toBeUndefined();
    // The same sections, blocks and list items as the German original, with the same bold beginnings.
    const shape = (code: "de" | "en" | "uk") => FORM_PRIVACY_SECTIONS[code].map((section) => [
      section.number,
      section.blocks.map((block) => block.kind === "list"
        ? block.items.map((item) => Boolean(item.lead))
        : block.kind === "address" ? block.lines.length : Boolean(block.lead)),
    ]);
    expect(shape(lang)).toEqual(shape("de"));
    // Names, addresses, periods and references stay as in the original.
    for (const fixed of [
      "GMED - Agentur für Patientenbetreuung,", "Albert-Schweitzer-Straße 56", "81735 München", "contact@gmed-health.com",
      "datenschutz@gmed-health.com", "+49 151 20943768", "GMED-EDV-System", "Hetzner Online GmbH, Industriestr. 25, 91710 Gunzenhausen",
      "Skribble AG, Talacker 21, 8001 Zürich", "FiSaLis", "TLS", "12.10.2026", "www.gmed-health.com/legal",
    ]) expect(html).toContain(fixed);
    const text = JSON.stringify(FORM_PRIVACY_SECTIONS[lang]);
    expect(text).not.toContain("DSGVO");
    // Every article the German text cites is cited, as often.
    const articles = (value: string, word: string) => (value.match(new RegExp(`${word}\\.? ?(\\d+)`, "g")) ?? []).map((hit) => hit.replace(/\D+/g, "")).sort();
    expect(articles(text, lang === "en" ? "Art" : "ст")).toEqual(articles(JSON.stringify(FORM_PRIVACY_SECTIONS.de), "Art"));
    for (const period of ["14", "180", "3"]) expect(JSON.stringify(FORM_PRIVACY_SECTIONS[lang][8])).toContain(period);
    expect(html.match(/<strong\b/g)).toHaveLength(9);
    expect(html.match(/<li\b/g)).toHaveLength(22);
  });

  it("makes the form notice available to leads and before signing in", () => {
    for (const user of [null, { role: "patient", portal_mode: "lead" }]) {
      auth.user = user;
      const html = renderToStaticMarkup(<MemoryRouter><LegalNoticePage /></MemoryRouter>);
      expect(html).toContain('data-testid="legal-imprint"');
      expect(html).toContain('data-testid="form-privacy-notice"');
    }
  });

  it("keeps the existing cooperation notice for the contracted patient portal", () => {
    auth.user = { role: "patient", portal_mode: "patient" };
    const html = renderToStaticMarkup(<MemoryRouter><LegalNoticePage /></MemoryRouter>);
    expect(html).not.toContain('data-testid="form-privacy-notice"');
    expect(html).toContain("GMED-CRM-System");
  });

  it.each(["ru", "de"] as const)("shows the form notice to an existing patient following their child's %s inquiry link", (lang) => {
    auth.user = { role: "patient", portal_mode: "patient" };
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={[`/legal?notice=form&lang=${lang}#privacy`]}><LegalNoticePage /></MemoryRouter>);
    expect(html).toContain('data-testid="form-privacy-notice"');
    for (const section of FORM_PRIVACY_SECTIONS[lang]) expect(html).toContain(section.title);
    expect(html).not.toContain("GMED-CRM-System");
  });
});
