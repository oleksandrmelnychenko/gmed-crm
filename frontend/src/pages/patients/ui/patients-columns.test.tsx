import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { PatientSummary } from "../model/list-model";

import { buildPatientColumns } from "./patients-columns";

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
  patients_col_age: "Возраст",
  patients_col_no: "№",
  patients_col_patient: "Пациент",
  patients_col_status: "Статус",
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

  it("allows the patient cell to render multiline content safely", () => {
    const columns = buildPatientColumns(translations, []);
    const patientColumn = columns.find((column) => column.id === "patient");

    expect(patientColumn?.cellClassName).toContain("whitespace-normal");
    expect(renderToStaticMarkup(<>{patientColumn?.render?.(patient())}</>)).toContain("line-clamp-2");
  });
});
