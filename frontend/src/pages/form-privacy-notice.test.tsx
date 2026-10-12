import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { FORM_PRIVACY_SECTIONS } from "./form-privacy-content";
import { FormPrivacyNotice } from "./form-privacy-notice";
import { LegalNoticePage } from "./legal";

const auth = vi.hoisted(() => ({ user: null as null | { role: string; portal_mode?: string } }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: auth.user }) }));

describe("inquiry privacy notice", () => {
  it.each(["de", "ru"] as const)("renders all 14 sections in %s with the configured agency contacts", (lang) => {
    const html = renderToStaticMarkup(<FormPrivacyNotice lang={lang} agency={{
      agency_name: "Testagentur",
      agency_address: "Teststraße 1",
      agency_email: "contact@example.com",
      agency_privacy_email: "privacy@example.com",
      agency_data_system_name: "Test CRM",
    }} />);
    expect(FORM_PRIVACY_SECTIONS[lang].map((section) => section.number)).toEqual(Array.from({ length: 14 }, (_, index) => index + 1));
    expect(html).toContain('data-version="2026-10-12"');
    expect(html).toContain("Testagentur");
    expect(html).toContain("Test CRM");
    expect(html).toContain("privacy@example.com");
    expect(html).not.toContain("datenschutz@gmed-health.com");
    expect(html).not.toContain("[Link");
    expect(html).not.toContain("[ссылка");
    expect(html).toContain("FiSaLis");
    expect(html).toContain("Hetzner");
    expect(html).toContain("Skribble");
    expect(html).toContain("180");
    expect(html).toContain("14");
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
});
