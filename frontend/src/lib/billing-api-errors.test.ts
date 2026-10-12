import { describe, expect, it } from "vitest";

import { ApiRequestError, isLocalizedApiError } from "./api";
import { BILLING_API_ERROR_KEYS } from "./billing-api-errors";
import { t } from "./i18n";

describe("internal note and re-billing waiver error codes", () => {
  it("have a German and a Russian text for every code", () => {
    for (const [code, key] of Object.entries(BILLING_API_ERROR_KEYS)) {
      expect(t("de").uiText[key], `${code} (de)`).toBeTruthy();
      expect(t("ru").uiText[key], `${code} (ru)`).toBeTruthy();
    }
  });

  it("are shown translated, not as the English server message", () => {
    const coded = new ApiRequestError("Внутренняя заметка — не более 4000 символов.", {
      status: 422,
      code: "internal_note_too_long",
      body: { error: "internal_note_too_long" },
    });
    expect(isLocalizedApiError(coded)).toBe(true);
  });
});
