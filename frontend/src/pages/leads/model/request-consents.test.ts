import { describe, expect, it } from "vitest";

import { repeatConsentNote, requestConsentStatus } from "./request-consents";

const ru = (text: string) => text;
const de = (_ru: string, text: string) => text;

describe("consents of a request (QA 2026-10-12 B3-01)", () => {
  it("says 'not ticked' only when neither consent is ticked", () => {
    expect(requestConsentStatus(false, false, ru)).toBe("Не отмечены: согласия из карточки не переносятся");
    expect(requestConsentStatus(true, true, ru)).toBe("Отмечены в этом обращении");
  });

  it("names the one consent still missing when the privacy notice is ticked", () => {
    const status = requestConsentStatus(true, false, ru);
    expect(status).toBe("Ещё не отмечено: согласие на обработку медицинских данных");
    expect(status).not.toMatch(/Не отмечены/);
    expect(requestConsentStatus(false, true, de)).toBe("Noch nicht bestätigt: Datenschutzhinweise");
    expect(repeatConsentNote(true, false, ru)).toContain(
      "ещё не отмечено: согласие на обработку медицинских данных",
    );
    expect(repeatConsentNote(false, false, ru)).toContain("подтвердите их с клиентом");
  });
});
