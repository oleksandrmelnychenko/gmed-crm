import { describe, expect, it } from "vitest";

import { t as translateCatalog } from "./i18n";
import {
  localizeTimelineCategory,
  localizeTimelineItemCategory,
  localizeTimelineSource,
  localizeTimelineStatus,
  localizeTimelineTitle,
} from "./timeline-labels";

const labels: Record<string, string> = {
  timeline_source_internal: "Внутренний",
  timeline_source_medical_report: "Медицинский отчёт",
  timeline_source_patient_intake: "Приём пациента",
  timeline_source_patient_visible: "Виден пациенту",
  patients_patient_visible: "Можно выпустить пациенту",
  timeline_source_concierge: "Консьерж",
  timeline_entity_contract: "Договор",
  timeline_title_dunning_first: "Первое напоминание",
  workflow_item_scope_review: "Проверить объём заказа",
  workflow_item_provider_shortlist: "Подготовить шорт-лист клиник и врачей",
  workflow_item_intake_prerequisites: "Подтвердить требования к входящим данным",
  workflow_item_supporting_documents: "Проверить документы связанных клиник",
};

const l = (key: string) => labels[key] ?? key;

describe("timeline labels", () => {
  it("localizes every part of a compound source", () => {
    expect(localizeTimelineSource("Patient Intake · Concierge", l)).toBe(
      "Приём пациента · Консьерж",
    );
    expect(localizeTimelineSource("Medical\u00a0Report · Internal", l)).toBe(
      "Медицинский отчёт · Внутренний",
    );
    expect(localizeTimelineSource("Contract · Patient Visible", l)).toBe(
      "Договор · Можно выпустить пациенту",
    );
  });

  it("localizes known system title prefixes", () => {
    expect(localizeTimelineTitle("Dunning first: INV-100", l)).toBe(
      "Первое напоминание: INV-100",
    );
  });

  it.each([
    [
      "Order checklist: Review order scope and convert needs into service blocks",
      "Проверить объём заказа",
    ],
    [
      "Order checklist: Prepare provider and doctor shortlist for execution",
      "Подготовить шорт-лист клиник и врачей",
    ],
    [
      "Order checklist: Confirm intake prerequisites and appointment dependencies",
      "Подтвердить требования к входящим данным",
    ],
    [
      "Patient checklist: Check supporting documents for linked clinics or doctors",
      "Проверить документы связанных клиник",
    ],
  ])("localizes workflow title %s", (title, expected) => {
    expect(localizeTimelineTitle(title, l)).toBe(expected);
  });

  it("keeps custom task titles unchanged", () => {
    expect(localizeTimelineTitle("Call the custom provider", l)).toBe(
      "Call the custom provider",
    );
  });

  it("localizes compliance and file-status titles and consent types", () => {
    const compliance: Record<string, string> = {
      timeline_title_privacy_request_rejected: "Запрос по защите данных отклонён",
      timeline_title_patient_deactivated: "Карта пациента деактивирована",
      timeline_title_consent: "Согласие",
      consents_type_dsgvo_data_transfer: "Обработка и передача данных (DSGVO)",
    };
    const lc = (key: string) => compliance[key] ?? key;
    expect(localizeTimelineTitle("Privacy request rejected", lc)).toBe(
      "Запрос по защите данных отклонён",
    );
    expect(localizeTimelineTitle("Patient file deactivated", lc)).toBe(
      "Карта пациента деактивирована",
    );
    expect(localizeTimelineTitle("Consent: dsgvo_data_transfer", lc)).toBe(
      "Согласие: Обработка и передача данных (DSGVO)",
    );
    expect(localizeTimelineTitle("Consent: custom_type", lc)).toBe(
      "Согласие: Custom Type",
    );
    // Without a translation the server title stays readable.
    expect(localizeTimelineTitle("Privacy request approved", lc)).toBe(
      "Privacy request approved",
    );
  });

  it("localizes raw visibility codes and document categories (QA B-26)", () => {
    const ru: Record<string, string> = {
      patients_patient_visible: "Можно выпустить пациенту",
      document_category_provider_template: "Памятка клиники",
      document_category_finance_cost_coverage: "Гарантия оплаты расходов",
      document_category_visa_invitation_letter: "Приглашение для визы",
      document_category_administrative_appointment_confirmation: "Подтверждение записи",
      timeline_category_profile: "Профиль",
    };
    const lr = (key: string) => ru[key] ?? key;
    expect(localizeTimelineSource("patient_visible", lr)).toBe("Можно выпустить пациенту");
    expect(localizeTimelineCategory("provider_template", lr)).toBe("Памятка клиники");
    expect(localizeTimelineCategory("finance_cost_coverage", lr)).toBe("Гарантия оплаты расходов");
    expect(localizeTimelineCategory("visa_invitation_letter", lr)).toBe("Приглашение для визы");
    expect(localizeTimelineCategory("administrative_appointment_confirmation", lr)).toBe("Подтверждение записи");
    expect(localizeTimelineCategory("profile", lr)).toBe("Профиль");
  });

  it("names the changed fields of a profile edit", () => {
    const ru: Record<string, string> = {
      timeline_title_profile_updated: "Профиль изменён",
      timeline_profile_field_phone_primary: "Телефон",
      timeline_profile_field_email: "E-mail",
    };
    const lr = (key: string) => ru[key] ?? key;
    expect(localizeTimelineTitle("Profile updated: phone_primary, email", lr)).toBe(
      "Профиль изменён: Телефон, E-mail",
    );
    expect(localizeTimelineTitle("Profile updated: some_new_field", lr)).toBe(
      "Профиль изменён: Some New Field",
    );
    // A profile save audited before the field names were kept (legacy row).
    expect(localizeTimelineTitle("Profile updated:", lr)).toBe("Профиль изменён");
  });

  it("localizes workflow keys returned as task titles", () => {
    expect(localizeTimelineTitle("workflow_item_scope_review", l)).toBe(
      "Проверить объём заказа",
    );
  });

  // QA 2026-10-12 B-26b: every code the patient timeline receives reads in
  // the UI language — statuses, the German clinical titles, relation types,
  // privacy request types, invoice types and the document visibility.
  for (const lang of ["ru", "de"] as const) {
    const catalog = translateCatalog(lang).uiText;
    const lx = (key: string) => catalog[key] ?? key;
    const expected = {
      ru: {
        recorded: "Записано",
        delivered: "Оказано",
        accepted: "Принято",
        diagnoses: "Диагнозы обновлены",
        relation: "Связь",
        other: "Другая связь",
        erasure: "CEO Muster · Удаление данных (ст. 17)",
        advance: "Авансовый счёт",
        medical: "Медицинский приём",
        visible: "Можно выпустить пациенту",
        interpreter: "Предпочтение переводчика: Переводчик → Предпочтителен",
      },
      de: {
        recorded: "Erfasst",
        delivered: "Erbracht",
        accepted: "Angenommen",
        diagnoses: "Diagnosen aktualisiert",
        relation: "Beziehung",
        other: "Sonstige Beziehung",
        erasure: "CEO Muster · Löschung (Art. 17)",
        advance: "Vorkasse",
        medical: "Medizinischer Termin",
        visible: "Zur Patientenfreigabe bereit",
        interpreter: "Dolmetscherpräferenz: Dolmetscher → Bevorzugt",
      },
    }[lang];

    it(`names every timeline code in ${lang}`, () => {
      expect(localizeTimelineStatus("recorded", lx)).toBe(expected.recorded);
      expect(localizeTimelineStatus("delivered", lx)).toBe(expected.delivered);
      expect(localizeTimelineStatus("accepted", lx)).toBe(expected.accepted);
      // Statuses the card's general labels name fall back to them.
      expect(localizeTimelineStatus("completed", lx)).toBe("");
      expect(localizeTimelineTitle("Diagnosen aktualisiert", lx)).toBe(expected.diagnoses);
      expect(localizeTimelineItemCategory("relation", "relation", lx)).toBe(expected.relation);
      expect(localizeTimelineSource("other", lx)).toBe(expected.other);
      expect(localizeTimelineSource("CEO Muster · erasure", lx)).toBe(expected.erasure);
      expect(localizeTimelineItemCategory("invoice", "advance", lx)).toBe(expected.advance);
      expect(localizeTimelineItemCategory("appointment", "medical", lx)).toBe(expected.medical);
      // "medical" of a document is its category, not an appointment type.
      expect(localizeTimelineItemCategory("document", "medical", lx)).not.toBe(expected.medical);
      expect(localizeTimelineSource("patient_visible", lx)).toBe(expected.visible);
      expect(
        localizeTimelineTitle("Interpreter preference: Interpreter -> preferred", lx),
      ).toBe(expected.interpreter);
      for (const raw of ["Advance", "Erasure", "Other", "Unbekannter Wert"]) {
        expect(
          [
            localizeTimelineSource("other", lx),
            localizeTimelineSource("erasure", lx),
            localizeTimelineItemCategory("invoice", "advance", lx),
          ],
        ).not.toContain(raw);
      }
    });
  }
});
