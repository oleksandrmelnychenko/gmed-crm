import { describe, expect, it } from "vitest";

import { ApiRequestError } from "@/lib/api";
import { de } from "@/lib/i18n/de";
import { ru } from "@/lib/i18n/ru";

import { describeSettingError } from "./admin-settings";

const refused = (message: string) => new ApiRequestError(message, { status: 422, body: { error: message } });

describe("refused BIC names the wrong part (QA R3-04)", () => {
  it("blames the length only for a wrong length", () => {
    expect(
      describeSettingError(
        refused("BIC must have 8 or 11 characters: bank code, country, location and optional branch"),
        ru,
      ),
    ).toBe(ru.settings_bic_invalid);
  });

  it("names the country part of COBA1EFFXXX", () => {
    expect(describeSettingError(refused("BIC country code (characters 5-6) must be letters"), ru)).toBe(
      "BIC неверен: символы 5–6 (код страны) должны быть буквами, например DE.",
    );
    expect(describeSettingError(refused("BIC bank code (characters 1-4) must be letters"), de)).toBe(
      de.settings_bic_invalid_bank_code,
    );
    expect(
      describeSettingError(
        refused("BIC location and branch (characters 7-11) may contain only letters and digits"),
        de,
      ),
    ).toBe(de.settings_bic_invalid_location);
  });
});
