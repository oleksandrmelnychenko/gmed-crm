import { describe, expect, it } from "vitest";

import {
  openBusinessHoldReasonText,
  patientTextLanguage,
  patientTextLanguageName,
  retentionHoldReasonText,
} from "./privacy-decision-texts";

describe("DSGVO decision reasons in the patient's language (QA 2026-10-12 B2-08, E2-05)", () => {
  it("writes in the first of the patient's languages a text exists for, German otherwise", () => {
    expect(patientTextLanguage(["de", "en"])).toBe("de");
    expect(patientTextLanguage(["tr", "en"])).toBe("en");
    expect(patientTextLanguage(["uk-UA"])).toBe("uk");
    expect(patientTextLanguage(["ua"])).toBe("uk");
    expect(patientTextLanguage(["RU"])).toBe("ru");
    expect(patientTextLanguage(["tr"])).toBe("de");
    expect(patientTextLanguage([])).toBe("de");
    expect(patientTextLanguage(null)).toBe("de");
  });

  it("gives a German patient a German retention reason, never the staff member's Russian", () => {
    const text = retentionHoldReasonText("de", "12.10.2056");
    expect(text).toContain("bis zum 12.10.2056");
    expect(text).toContain("§ 630f Abs. 3 BGB");
    expect(text).not.toMatch(/[а-яё]/i);
    expect(retentionHoldReasonText("ru", "12.10.2056")).toContain("до 12.10.2056");
    expect(retentionHoldReasonText("en", "12.10.2056")).toContain("until 12.10.2056");
    expect(retentionHoldReasonText("uk", "12.10.2056")).toContain("до 12.10.2056");
  });

  it("says neutrally that an erasure waits for the running orders", () => {
    expect(openBusinessHoldReasonText("de")).toContain(
      "wird nach Abschluss laufender Aufträge ausgeführt",
    );
    for (const language of ["de", "en", "ru", "uk"] as const) {
      const text = openBusinessHoldReasonText(language);
      expect(text).not.toMatch(/sanction|санкц|Sanktion|risk/i);
      expect(text.length).toBeGreaterThan(10);
    }
  });

  it("names the text language in the staff member's language", () => {
    expect(patientTextLanguageName("de", "ru")).toBe("немецкий");
    expect(patientTextLanguageName("en", "de")).toBe("Englisch");
  });
});
