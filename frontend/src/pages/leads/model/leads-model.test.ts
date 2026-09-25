import { describe, expect, it } from "vitest";

import { t as translateCatalog } from "@/lib/i18n";

import {
  LEAD_QUESTIONNAIRE_SERVICE_OPTIONS,
  LEAD_WIZARD_SERVICE_OPTIONS,
  formatDateTime,
  leadErrorBlockingReasons,
  leadErrorMessage,
  leadPermissions,
  leadReadinessCheckLabel,
  leadReadinessReasonLabel,
  normalizeLeadServiceSelection,
  normalizeLeadServiceValue,
  updateLeadServiceSelection,
} from "./leads-model";

// Mirrors the readiness payload built in crates/server/src/routes/leads.rs.
const SERVER_READINESS_CHECK_KEYS = [
  "lead_qualified",
  "compliance_completed",
  "birth_date_present",
  "legal_sex_present",
  "primary_contact_present",
  "privacy_consent",
  "healthcare_consent",
  "address_present",
  "primary_concern_present",
  "specialties_present",
  "identity_document_verified",
  "dsgvo_document_signed",
  "confidentiality_release_signed",
  "enhanced_due_diligence_document_generated",
  "enhanced_due_diligence_document_signed",
  "medical_characteristics_present",
  "contract_signed",
  "framework_document_generated",
  "order_exists",
  "order_service_ready",
  "order_document_generated",
  "order_cost_estimate_document_generated",
  "order_signed_patient",
  "order_signed_agency",
  "quote_accepted",
  "cost_estimate_document_generated",
  "debt_clear",
  "prepayment_ready",
];

const SERVER_READINESS_REASONS = [
  "Compliance is not signed yet",
  "Birth date is missing",
  "Legal sex is missing",
  "Email or phone is required",
  "Privacy practices consent is missing",
  "Healthcare consent is missing",
  "Lead must be qualified before conversion",
  "Complete street, city and postal code",
  "Primary concern is missing",
  "Requested specialty is missing",
  "Identity document is not verified",
  "Signed DSGVO document is missing",
  "Signed confidentiality release is missing",
  "Enhanced due diligence document is missing",
  "Enhanced due diligence document is not signed",
  "Framework contract was terminated; create a new contract",
  "Framework contract is not signed",
  "Framework contract document is missing",
  "Onboarding order is missing",
  "Order needs at least one valid service",
  "Order document is missing",
  "Order cost estimate document is missing",
  "Customer order signature is missing",
  "Agency order signature is missing",
  "Quote is not accepted",
  "Preliminary cost calculation document is missing",
  "Lead is already converted",
];

describe("lead readiness labels", () => {
  for (const lang of ["de", "ru"] as const) {
    const tr = translateCatalog(lang);

    it(`translates every server readiness check (${lang})`, () => {
      for (const key of SERVER_READINESS_CHECK_KEYS) {
        const label = leadReadinessCheckLabel({ key, label: `raw ${key}` }, tr);
        expect(label, key).not.toBe(`raw ${key}`);
        expect(label.trim(), key).not.toBe("");
      }
    });

    it(`translates every server blocking reason (${lang})`, () => {
      for (const reason of SERVER_READINESS_REASONS) {
        const label = leadReadinessReasonLabel(reason, tr);
        expect(label, reason).not.toBe(reason);
        expect(label.trim(), reason).not.toBe("");
      }
    });
  }

  it("names the terminated framework contract in German", () => {
    expect(
      leadReadinessReasonLabel(
        "Framework contract was terminated; create a new contract",
        translateCatalog("de"),
      ),
    ).toBe("Rahmenvertrag wurde gekündigt – neuen Vertrag erstellen");
  });
});

describe("lead release permissions", () => {
  it("gives Concierge and the CEO assistant the grid without detail or mutation rights", () => {
    for (const role of ["concierge", "ceo_assistant"]) {
      expect(leadPermissions(role)).toEqual({
        canViewPage: true,
        canOpen: false,
        canEdit: false,
        canCreate: false,
        canConvert: false,
      });
    }
  });

  it("keeps full lead operations for CEO", () => {
    expect(leadPermissions("ceo")).toEqual({
      canViewPage: true,
      canOpen: true,
      canEdit: true,
      canCreate: true,
      canConvert: true,
    });
  });

  it("lets Sales edit leads without converting them", () => {
    expect(leadPermissions("sales")).toEqual({
      canViewPage: true,
      canOpen: true,
      canEdit: true,
      canCreate: true,
      canConvert: false,
    });
  });

  it("prefers the capabilities reported by /me over the role mirror", () => {
    expect(leadPermissions({ role: "sales", capabilities: ["leads.view"] }).canEdit).toBe(false);
    expect(
      leadPermissions({ role: "concierge", capabilities: ["leads.view", "leads.edit"] }).canOpen,
    ).toBe(true);
  });
});

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

  it("names the real reason when a converted lead rejects intake work", () => {
    // The backend answers 409, whose generic text ("data changed, reload") would mislead.
    const conflict = Object.assign(new Error("Converted lead must use its patient context"), { status: 409 });
    expect(leadErrorMessage(conflict, ru)).toContain("Лид уже конвертирован в пациента");
    expect(leadErrorMessage(conflict, de)).toContain("bereits in einen Patienten umgewandelt");
  });

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
    expect(leadErrorMessage(new Error("Email is already used by another person"), ru)).toBe(
      "Этот адрес электронной почты уже используется другим человеком",
    );
    expect(leadErrorMessage(new Error("Phone is already used by another person"), de)).toBe(
      "Diese Telefonnummer wird bereits von einer anderen Person verwendet",
    );
  });

  it("localizes structured backend validation messages without leaking field keys", () => {
    const prepaymentError = Object.assign(
      new Error("prepayment_amount must be a non-negative decimal"),
      { status: 422 },
    );

    expect(leadErrorMessage(prepaymentError, ru)).toBe(
      "Сумма необходимой предоплаты: укажите число не меньше нуля",
    );
    expect(leadErrorMessage(prepaymentError, de)).toBe(
      "Erforderlicher Vorauszahlungsbetrag: eine Zahl größer oder gleich null eingeben",
    );
    expect(leadErrorMessage(new Error("Service quantity must be greater than zero"), ru)).toBe(
      "Количество услуги: укажите число больше нуля",
    );
    expect(leadErrorMessage(new Error("VAT rate must be between 0 and 100"), de)).toBe(
      "Mehrwertsteuersatz: einen Wert zwischen 0 und 100 eingeben",
    );
    expect(leadErrorMessage(new Error("unknown_amount must be a valid number"), ru)).toBe(
      "укажите корректное число",
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
    const expired = Object.assign(new Error("invalid_token"), { status: 401 });
    const tooLarge = Object.assign(new Error("Payload Too Large"), { status: 413 });

    expect(leadErrorMessage(expired, ru)).toBe("Сессия завершена. Войдите снова");
    expect(leadErrorMessage(expired, de)).toBe("Sitzung abgelaufen. Bitte erneut anmelden");
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
