import { describe, expect, it } from "vitest";

import {
  localizeTimelineSource,
  localizeTimelineTitle,
} from "./timeline-labels";

const labels: Record<string, string> = {
  timeline_source_internal: "Внутренний",
  timeline_source_medical_report: "Медицинский отчёт",
  timeline_source_patient_intake: "Приём пациента",
  timeline_source_patient_visible: "Виден пациенту",
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
      "Договор · Виден пациенту",
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

  it("localizes workflow keys returned as task titles", () => {
    expect(localizeTimelineTitle("workflow_item_scope_review", l)).toBe(
      "Проверить объём заказа",
    );
  });
});
