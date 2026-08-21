import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { PatientSummary } from "../model/list-model";

import { DEFAULT_PATIENT_HIDDEN_COLUMNS, buildPatientColumns } from "./patients-columns";

const translations = {
  common_active: "Активен",
  common_inactive: "Неактивен",
  common_not_set: "Не указано",
  gender_diverse: "Другое",
  gender_female: "Женский",
  gender_male: "Мужской",
  insurance_foreign: "Иностранная",
  insurance_private: "Частная",
  insurance_public: "Государственная",
  insurance_self_pay: "Самоплательщик",
  invoices_workspace_balance: "Баланс",
  patients_col_age: "Возраст",
  patients_col_no: "№",
  patients_col_patient: "Пациент",
  patients_col_status: "Статус",
  patients_balance_credit: "Переплата",
  patients_balance_debt: "Долг",
  patients_balance_reconciliation_required: "Требуется сверка",
  patients_created_at: "Создан",
  patients_email: "Email",
  patients_functional_labels: "Метки",
  patients_gender: "Пол",
  patients_insurance_provider: "Страховая компания",
  patients_insurance_type: "Тип страхования",
  patients_languages: "Языки",
  patients_nationality: "Гражданство",
  patients_phone_primary: "Основной телефон",
  patients_residence_country: "Страна",
  relative_time_today: "сегодня",
};

function patient(overrides: Partial<PatientSummary> = {}): PatientSummary {
  return {
    created_at: "2026-06-23T10:00:00Z",
    first_name: "Alexandra",
    functional_labels: [],
    gender: "female",
    id: "patient-1",
    insurance_provider: null,
    insurance_type: null,
    is_active: true,
    last_name: "Grau",
    patient_id: "P-202606230001",
    ...overrides,
  };
}

describe("buildPatientColumns", () => {
  it("keeps insurance company out of the insurance type column", () => {
    const columns = buildPatientColumns(translations, []);
    const insuranceColumn = columns.find((column) => column.id === "insurance");
    const insuranceProviderColumn = columns.find((column) => column.id === "insurance_provider");

    const row = patient({ insurance_provider: "AOK Bayern", insurance_type: "foreign" });
    const insuranceHtml = renderToStaticMarkup(<>{insuranceColumn?.render?.(row)}</>);
    const providerHtml = renderToStaticMarkup(<>{insuranceProviderColumn?.render?.(row)}</>);

    expect(insuranceHtml).toContain("Иностранная");
    expect(insuranceHtml).not.toContain("AOK Bayern");
    expect(providerHtml).toContain("AOK Bayern");
  });

  it("renders multiline patient names safely and left-aligned", () => {
    const columns = buildPatientColumns(translations, []);
    const patientColumn = columns.find((column) => column.id === "patient");

    expect(patientColumn?.cellClassName).toContain("whitespace-normal");
    const html = renderToStaticMarkup(<>{patientColumn?.render?.(patient())}</>);
    expect(html).toContain("line-clamp-2");
    expect(html).toContain("justify-start");
    expect(html).toContain("text-left");
  });

  it("renders patient labels in a separate visible column", () => {
    const columns = buildPatientColumns(translations, []);
    const patientColumn = columns.find((column) => column.id === "patient");
    const labelsColumn = columns.find((column) => column.id === "functional_labels");
    const patientIndex = columns.findIndex((column) => column.id === "patient");
    const labelsIndex = columns.findIndex((column) => column.id === "functional_labels");
    const row = patient({
      first_name: "Alexandra Alexandra Alexandra",
      functional_labels: ["vip", "high_risk", "fall_risk"],
      last_name: "Grau Grau Grau Grau",
    });

    expect(DEFAULT_PATIENT_HIDDEN_COLUMNS).not.toContain("functional_labels");
    expect(labelsIndex).toBe(patientIndex + 1);
    expect(labelsColumn?.width).toBeGreaterThanOrEqual(320);

    const patientHtml = renderToStaticMarkup(<>{patientColumn?.render?.(row)}</>);
    const labelsHtml = renderToStaticMarkup(<>{labelsColumn?.render?.(row)}</>);

    expect(patientHtml).toContain("line-clamp-2");
    expect(patientHtml).not.toContain("data-patient-functional-label");
    expect(labelsHtml).toContain('data-patient-cell-render="functional_labels"');
    expect(labelsHtml).toContain('data-patient-functional-label="vip"');
    expect(labelsHtml).toContain('data-patient-functional-label="high_risk"');
    expect(labelsHtml).toContain('data-patient-functional-label="fall_risk"');
    expect(labelsHtml).not.toContain("+1");
  });

  it("shows patient debt in the main grid as a red balance", () => {
    const columns = buildPatientColumns(translations, [], { showBalance: true });
    const balanceColumn = columns.find((column) => column.id === "account_balance");
    const row = patient({
      account_balance: "450.00",
      account_balance_currency: "EUR",
      account_balance_side: "debit",
    });

    expect(balanceColumn?.defaultVisible).toBe(true);
    const html = renderToStaticMarkup(<>{balanceColumn?.render?.(row)}</>);
    expect(html).toContain("450,00");
    expect(html).toContain("Долг");
    expect(html).toContain("text-red-600");
  });

  it("does not expose a balance column when the role cannot view financial data", () => {
    const columns = buildPatientColumns(translations, []);
    expect(columns.some((column) => column.id === "account_balance")).toBe(false);
  });
});
