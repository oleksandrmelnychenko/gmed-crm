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

describe("refused tax registration of the agency (QA 2026-11-10, D-06)", () => {
  it("explains the format instead of showing the server's English text", () => {
    expect(
      describeSettingError(
        refused("VAT ID must be an EU country code followed by its number, for example DE123456789"),
        ru,
      ),
    ).toBe(ru.settings_vat_id_invalid);
    expect(
      describeSettingError(refused("VAT ID of Germany must be DE followed by 9 digits"), de),
    ).toBe(de.settings_vat_id_invalid_german);
    expect(
      describeSettingError(
        refused(
          "Tax number must be a German Steuernummer: 10 or 11 digits as the tax office writes it (for example 143/123/12345) or the 13 digits of the federal form",
        ),
        ru,
      ),
    ).toBe(ru.settings_tax_number_invalid);
    expect(ru.settings_tax_number_invalid).toContain("143/123/12345");
  });
});

describe("refused required-documents rules in the UI language (screens QA 2026-11-12, E F13)", () => {
  it("replaces the server's English JSON texts", () => {
    expect(describeSettingError(refused("Required patient documents must be a valid JSON array"), ru)).toBe(
      ru.settings_required_documents_invalid_json,
    );
    expect(
      describeSettingError(refused("Each required patient document rule must include a label"), de),
    ).toBe(de.settings_required_documents_invalid_rule);
    expect(describeSettingError(refused("Max sessions cannot exceed 100"), ru)).toBe(
      ru.settings_value_out_of_range,
    );
    expect(ru.settings_required_documents_invalid_json).toMatch(/[А-Яа-я]/);
  });
});
