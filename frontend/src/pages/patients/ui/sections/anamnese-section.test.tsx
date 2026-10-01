import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ClinicalNarrative } from "@/pages/patients/data/patient-clinical";

import {
  AnamneseSection,
  copyNarrativeVersion,
  editNarrativeVersion,
  narrativeSpecializationChecklist,
  selectedNarrativeSpecializations,
} from "./anamnese-section";

function narrative(overrides: Partial<ClinicalNarrative> = {}): ClinicalNarrative {
  return {
    id: "narrative-1",
    anamnese_aktuelle: "Aktuelle Beschwerden seit 2025.",
    anamnese_vorgeschichte: "Appendektomie.",
    anamnese_vegetative: null,
    anamnese_sozial: null,
    beurteilung: "Stabil.",
    anamnese_at: "2026-06-30T17:45:00Z",
    is_active: true,
    created_at: "2025-06-30T10:00:00Z",
    updated_at: "2026-06-30T18:18:13Z",
    ...overrides,
  };
}

const cardiology = {
  id: "specialization-1",
  code: "CARD",
  name_en: "Cardiology",
  name_de: "Kardiologie",
  name_ru: "Кардиология",
  is_active: true,
  sort_order: 1,
  narrative_text: "Belastungsdyspnoe.",
  assessment_text: "Kardiologische Abklärung.",
};

describe("AnamneseSection", () => {
  it("copies an existing narrative into a new active version draft", () => {
    const source = narrative({ id: "old-version", is_active: false });

    expect(copyNarrativeVersion(source)).toEqual({
      ...source,
      specialization_ids: [],
      specializations: [],
      id: null,
      source_document_id: null,
      source_document_name: null,
      source_import_id: null,
      anamnese_at: expect.any(String),
      is_active: true,
      created_at: null,
      updated_at: null,
    });
  });

  it("creates an isolated edit draft for specialization CRUD", () => {
    const source = narrative({
      specialization_ids: [cardiology.id],
      specializations: [cardiology],
    });
    const draft = editNarrativeVersion(source);

    expect(draft).toEqual(source);
    expect(draft).not.toBe(source);
    expect(draft.specialization_ids).not.toBe(source.specialization_ids);
    expect(draft.specializations).not.toBe(source.specializations);
    expect(draft.specializations?.[0]).not.toBe(source.specializations?.[0]);
  });

  it("starts a newly added specialization from its anamnesis template and keeps entered texts", () => {
    const oncology = {
      id: "specialization-2",
      code: "oncology",
      name_en: "Oncology",
      name_de: "Onkologie",
      name_ru: "Онкология",
      is_active: true,
      sort_order: 2,
      anamnesis_template: "B-Symptomatik:\n- Fieber:\n",
    };
    const cardiologyOption = {
      id: cardiology.id,
      code: cardiology.code,
      name_en: cardiology.name_en,
      name_de: cardiology.name_de,
      name_ru: cardiology.name_ru,
      is_active: true,
      sort_order: 1,
    };

    const selected = selectedNarrativeSpecializations(
      [{ ...cardiology, narrative_text: null }],
      [{ ...cardiologyOption, anamnesis_template: "Belastbarkeit:" }, oncology],
    );

    // Cardiology was already part of the version: its emptied text is not refilled.
    expect(selected[0]).toMatchObject({ id: cardiology.id, narrative_text: null, assessment_text: cardiology.assessment_text });
    expect(selected[1]).toMatchObject({
      id: oncology.id,
      narrative_text: "B-Symptomatik:\n- Fieber:",
      assessment_text: null,
    });
    expect(selectedNarrativeSpecializations([], [cardiologyOption])[0].narrative_text).toBeNull();
  });

  it("opens a template with yes/no questions as a checklist instead of text", () => {
    const template = "CVRF (ja/nein)\n- Nikotin (ja/nein + if ja: Pack Years (Number))";
    const option = {
      id: cardiology.id,
      code: cardiology.code,
      name_en: cardiology.name_en,
      name_de: cardiology.name_de,
      name_ru: cardiology.name_ru,
      is_active: true,
      sort_order: 1,
      anamnesis_template: template,
    };

    const [added] = selectedNarrativeSpecializations([], [option]);
    expect(added.narrative_text).toBeNull();
    expect(added.checklist).toEqual({ version: 1, template, answers: {}, notes: "" });
    expect(narrativeSpecializationChecklist(added, [option])).toEqual(added.checklist);

    // A text saved before the template became a checklist stays as its free text.
    const legacy = { ...cardiology, checklist: null };
    expect(narrativeSpecializationChecklist(legacy, [option])).toEqual({
      version: 1,
      template,
      answers: {},
      notes: cardiology.narrative_text,
    });
    // Stored answers keep the template they were given against.
    const stored = { ...cardiology, checklist: { version: 1 as const, template: "Alt (ja/nein)", answers: { "0": { value: "ja" as const } }, notes: "" } };
    expect(narrativeSpecializationChecklist(stored, [option])?.template).toBe("Alt (ja/nein)");
    expect(narrativeSpecializationChecklist(legacy, [])).toBeNull();
  });

  it("shows the family anamnesis of the active version", () => {
    const html = renderToStaticMarkup(
      <AnamneseSection
        active={narrative({ anamnese_familie: "Vater: Myokardinfarkt mit 58 Jahren." })}
        canManage
        lang="de"
        loadHistory={async () => []}
        onSave={async () => undefined}
      />,
    );

    expect(html).toContain("Familienanamnese");
    expect(html).toContain("Vater: Myokardinfarkt mit 58 Jahren.");
  });

  it("renders active version metadata and the copy action", () => {
    const html = renderToStaticMarkup(
      <AnamneseSection
        active={narrative()}
        canManage
        lang="ru"
        loadHistory={async () => []}
        onDelete={async () => undefined}
        onSave={async () => undefined}
      />,
    );

    expect(html).toContain("Активная версия");
    expect(html).toContain("Копировать");
    expect(html).toContain("Удалить анамнез");
    expect(html).toContain("Актуальный анамнез");
    expect(html).toContain("Дата и время анамнеза");
    expect(html).toContain("Создано вручную");
  });

  it("shows the source document for an imported anamnesis", () => {
    const html = renderToStaticMarkup(
      <AnamneseSection
        active={narrative({
          source_document_id: "document-1",
          source_document_name: "Arztbrief.pdf",
          source_import_id: "import-1",
        })}
        canManage
        lang="ru"
        loadHistory={async () => []}
        onDelete={async () => undefined}
        onSave={async () => undefined}
      />,
    );

    expect(html).toContain("Из документа");
    expect(html).toContain("Arztbrief.pdf");
  });

  it("renders red flags and per-specialization narrative details", () => {
    const html = renderToStaticMarkup(
      <AnamneseSection
        active={narrative({
          red_flags: "Synkope bei Belastung",
          specialization_ids: [cardiology.id],
          specializations: [cardiology],
        })}
        canManage
        lang="de"
        loadHistory={async () => []}
        onSave={async () => undefined}
      />,
    );

    expect(html).toContain("Warnzeichen");
    expect(html).toContain("Synkope bei Belastung");
    expect(html).toContain("Kardiologie");
    expect(html).toContain("Fachspezifische Anamnese");
    expect(html).toContain("Kardiologische Abklärung");
  });
});
