import { describe, expect, it } from "vitest";

import { CARE_API_ERROR_KEYS } from "./care-api-errors";
import { t } from "./i18n";

describe("appointment, reminder and order signature error codes", () => {
  it("have a German and a Russian text for every code", () => {
    for (const [code, key] of Object.entries(CARE_API_ERROR_KEYS)) {
      expect(t("de").uiText[key], `${code} (de)`).toBeTruthy();
      expect(t("ru").uiText[key], `${code} (ru)`).toBeTruthy();
    }
  });

  it("tells the patient in the portal language that a request is already open (QA C2-11)", () => {
    const key = CARE_API_ERROR_KEYS.appointment_request_open_exists;
    expect(t("ru").uiText[key]).toMatch(/уже открыт/);
    expect(t("de").uiText[key]).toMatch(/bereits eine offene Terminanfrage/);
    expect(t("ru").uiText[key]).not.toMatch(/already exists/);
  });
});
