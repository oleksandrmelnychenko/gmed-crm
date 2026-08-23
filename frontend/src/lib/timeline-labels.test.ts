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
});
