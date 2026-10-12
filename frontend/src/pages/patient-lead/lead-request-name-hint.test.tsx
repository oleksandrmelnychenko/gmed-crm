import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { LeadRequest } from "./lead-request-api";
import { PersonStep } from "./lead-request-step-forms";
import { leadRequestText } from "./lead-request-text";
import { nameNeedsLatinSpelling, suggestPassportSpelling } from "./name-transliteration";

function render(names: [string, string, string], lang = "ru") {
  const request: LeadRequest = {
    lead_id: "test-only", access_kind: "self", created_at: "2026-10-12T08:00:00Z",
    personal_data: {
      first_name: names[0], last_name: names[1], middle_name: names[2],
      date_of_birth: null, legal_sex: null, citizenships: [], street_address: null,
      zip_code: null, city: null, country: null, phone: null, primary_language: null,
      has_insurance: null, insurance_type: null, insurance_provider: null,
      insurance_number: null, insurance_covers_germany: null,
    },
    progress: { filled: 0, total: 0, missing_for_submit: [] }, minor: false,
    documents: [], max_documents: 30, consents: {}, submitted_at: null, retention_deadline_at: null,
  };
  return renderToStaticMarkup(
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <PersonStep request={request} text={leadRequestText(lang)} lang={lang} missing={[]}
        enqueue={async (task) => task()} onChange={() => undefined}
        nav={{ index: 0, total: 8, onBack: null, onNext: null, missingShown: false, onShowMissing: () => undefined }} />
    </LocalizationProvider>,
  );
}

const RU_HINT = "Пишите имя, фамилию и отчество латинскими буквами — так, как в загранпаспорте.";

describe("passport spelling hint", () => {
  it.each([["Анна", "Muster", ""], ["Anna", "Мустер", ""], ["Anna", "Muster", "Ігорівна"]] as [string, string, string][])(
    "shows the hint for Cyrillic in any name without replacing the entered spelling", (...names) => {
      const html = render(names);
      expect(html).toContain("Только латинские буквы, как в загранпаспорте.");
      expect(html).toContain(RU_HINT);
      expect(html).toContain('role="status"');
      expect(html).toContain('aria-describedby="lead-request-name-passport-hint');
      for (const value of names.filter(Boolean)) expect(html).toContain(`value="${value}"`);
    },
  );

  it("offers the passport spelling with a button, never applying it by itself", () => {
    const html = render(["Анна", "Иванова", ""]);
    expect(html).toContain("В загранпаспорте, скорее всего: Anna");
    expect(html).toContain("В загранпаспорте, скорее всего: Ivanova");
    expect(html).toContain('data-testid="lead-request-last_name-latin-apply"');
    expect(html).toContain('value="Иванова"');
  });

  it.each([["", "", ""], ["Anna", "Müller", "José"], ["Anna-Maria", "O'Neil", "St. John"]] as [string, string, string][])(
    "keeps the passport hint visible in Russian for empty names and Latin spelling", (...names) => {
      const html = render(names);
      expect(html).toContain(RU_HINT);
      expect(html).not.toContain("Только латинские буквы");
    },
  );

  it("keeps the Ukrainian hint visible even when all names are Latin", () => {
    expect(render(["Anna", "Muster", ""], "ua")).toContain("латинськими літерами — так, як у закордонному паспорті");
  });

  it.each(["de", "en"])("hides the extra hint in %s when no Cyrillic is present", (lang) => {
    expect(render(["Anna", "Müller", "José"], lang)).not.toContain("lead-request-name-passport-hint");
  });

  it("uses the cabinet language even when Cyrillic was entered in an English form", () => {
    expect(render(["Анна", "Muster", ""], "en")).toContain("exactly as in your passport");
  });

  it("keeps the section hint unchanged and attaches the correction only to the invalid field", () => {
    const cyrillic = render(["Anna", "Мустер", ""]);
    const corrected = render(["Anna", "Muster", ""]);
    const hint = /<span id="lead-request-name-passport-hint"[^>]*>(.*?)<\/span>/s;
    expect(cyrillic.match(hint)?.[1]).toBe(corrected.match(hint)?.[1]);
    expect(cyrillic).toContain('id="lead-request-last_name-latin-hint"');
    expect(cyrillic).not.toContain('id="lead-request-first_name-latin-hint"');
    expect(corrected).not.toContain("-latin-hint");
  });

  it("flags digits and other scripts too, without a suggestion", () => {
    const html = render(["Anna2", "Muster", ""]);
    expect(html).toContain('id="lead-request-first_name-latin-hint"');
    expect(html).not.toContain("lead-request-first_name-latin-apply");
  });
});

describe("passport spelling of a Cyrillic name", () => {
  it("accepts Latin letters with accents, spaces, hyphens, apostrophes and dots", () => {
    for (const name of ["Anna", "Müller", "José", "Anna-Maria", "O'Neil", "St. John", "Łukasz"]) {
      expect(nameNeedsLatinSpelling(name)).toBe(false);
    }
    for (const name of ["Анна", "Anna2", "Anna_", "安娜"]) expect(nameNeedsLatinSpelling(name)).toBe(true);
  });

  it("follows the Russian passport rules (ICAO 9303)", () => {
    expect(suggestPassportSpelling("Юлия", "ru")).toBe("Iuliia");
    expect(suggestPassportSpelling("Щербаков", "ru")).toBe("Shcherbakov");
    expect(suggestPassportSpelling("Анна-Мария", "ru")).toBe("Anna-Mariia");
  });

  it("follows the Ukrainian passport rules in the Ukrainian cabinet", () => {
    expect(suggestPassportSpelling("Ганна", "uk")).toBe("Hanna");
    expect(suggestPassportSpelling("Юрій", "uk")).toBe("Yurii");
    expect(suggestPassportSpelling("Згурський", "uk")).toBe("Zghurskyi");
    expect(suggestPassportSpelling("Іванна-Марія", "uk")).toBe("Ivanna-Mariia");
  });

  it("suggests nothing for a Latin name", () => {
    expect(suggestPassportSpelling("Anna", "ru")).toBeNull();
  });
});
