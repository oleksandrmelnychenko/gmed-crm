import { describe, expect, it } from "vitest";

import {
  LEAD_QUESTIONNAIRE_SERVICE_OPTIONS,
  LEAD_WIZARD_SERVICE_OPTIONS,
  formatDateTime,
  leadErrorBlockingReasons,
  leadErrorMessage,
  normalizeLeadServiceSelection,
  normalizeLeadServiceValue,
  updateLeadServiceSelection,
} from "./leads-model";

describe("lead questionnaire services", () => {
  it("keeps every service option from the questionnaire contract", () => {
    expect(LEAD_QUESTIONNAIRE_SERVICE_OPTIONS).toEqual([
      "driver",
      "concierge",
      "medical-transport",
      "air-ambulance",
      "business-aviation",
      "none",
      "not-sure",
    ]);
  });

  it("normalizes transport aliases without rewriting legacy custom values", () => {
    expect(normalizeLeadServiceValue("medical_transport")).toBe("medical-transport");
    expect(normalizeLeadServiceValue("AIR_AMBULANCE")).toBe("air-ambulance");
    expect(normalizeLeadServiceValue("not_sure")).toBe("not-sure");
    expect(normalizeLeadServiceValue("interpreter")).toBe("interpreter_support");
    expect(normalizeLeadServiceValue("translator")).toBe("interpreter_support");
    expect(normalizeLeadServiceValue("concierge_support")).toBe("concierge");
    expect(normalizeLeadServiceValue("airport_transfer")).toBe("driver");
    expect(normalizeLeadServiceValue("medical_support")).toBe("medical_support");
  });

  it("always offers interpreter support in the staff wizard", () => {
    expect(LEAD_WIZARD_SERVICE_OPTIONS).toContain("interpreter_support");
  });

  it("removes contradictory exclusive choices from imported services", () => {
    expect(normalizeLeadServiceSelection([
      "none",
      "driver",
      "interpreter",
      "not_sure",
    ])).toEqual(["driver", "interpreter_support"]);
  });

  it("deduplicates legacy aliases from imported service payloads", () => {
    expect(normalizeLeadServiceSelection([
      "concierge_support",
      "concierge",
      "airport_transfer",
      "driver",
    ])).toEqual(["concierge", "driver"]);
  });

  it("keeps none and not-sure mutually exclusive with actual services", () => {
    expect(updateLeadServiceSelection(["driver", "concierge"], "none", true)).toEqual([
      "none",
    ]);
    expect(updateLeadServiceSelection(["none"], "translator", true)).toEqual([
      "interpreter_support",
    ]);
    expect(updateLeadServiceSelection(["interpreter_support"], "not-sure", true)).toEqual([
      "not-sure",
    ]);
  });
});

describe("lead received timestamp", () => {
  it("formats both the date and minute-level time", () => {
    expect(formatDateTime("2026-04-02T09:45:00", "de-DE", "-")).toBe(
      "02.04.2026, 09:45",
    );
  });

  it("keeps the configured fallback for a missing value", () => {
    expect(formatDateTime(null, "ru-RU", "-")).toBe("-");
  });
});

describe("lead errors", () => {
  const ru = (ruText: string) => ruText;
  const de = (_ruText: string, deText: string) => deText;

  it("translates known backend messages in both interface languages", () => {
    expect(leadErrorMessage(new Error("Case intake is incomplete"), ru)).toBe(
      "Заполните причину обращения и анамнез",
    );
    expect(leadErrorMessage(new Error("Case intake is incomplete"), de)).toBe(
      "Anliegen und Anamnese vollständig ausfüllen",
    );
    expect(leadErrorMessage(new Error("Invalid legal_sex"), ru)).toBe(
      "Выберите пол по документам",
    );
    expect(leadErrorMessage(new Error("Invalid legal_sex"), de)).toBe(
      "Geschlecht laut Ausweisdokument auswählen",
    );
  });

  it("keeps every structured blocking reason returned by a lead gate", () => {
    const error = Object.assign(new Error("Lead is not qualification-ready"), {
      status: 422,
      body: {
        blocking_reasons: [
          "Birth date is missing",
          "Healthcare consent is missing",
          "Birth date is missing",
        ],
      },
    });

    expect(leadErrorBlockingReasons(error)).toEqual([
      "Birth date is missing",
      "Healthcare consent is missing",
    ]);
  });

  it("uses localized HTTP fallbacks without leaking English", () => {
    const forbidden = Object.assign(new Error("Unexpected policy failure"), { status: 403 });
    const tooLarge = Object.assign(new Error("Payload Too Large"), { status: 413 });

    expect(leadErrorMessage(forbidden, ru)).toBe("Недостаточно прав для этого действия");
    expect(leadErrorMessage(forbidden, de)).toBe("Keine Berechtigung für diese Aktion");
    expect(leadErrorMessage(tooLarge, ru)).not.toMatch(/payload|large/i);
    expect(leadErrorMessage(tooLarge, de)).not.toMatch(/payload|large/i);
  });

  it("replaces unknown English errors but preserves already localized messages", () => {
    expect(leadErrorMessage(new Error("Unexpected dependency error"), ru)).toBe(
      "Не удалось выполнить действие. Повторите попытку",
    );
    expect(leadErrorMessage(new Error("Unexpected dependency error"), de)).toBe(
      "Aktion konnte nicht abgeschlossen werden. Bitte erneut versuchen",
    );
    expect(leadErrorMessage(new Error("Проверьте данные"), ru)).toBe("Проверьте данные");
    expect(leadErrorMessage(new Error("Bitte Daten prüfen"), de)).toBe("Bitte Daten prüfen");
  });
});
