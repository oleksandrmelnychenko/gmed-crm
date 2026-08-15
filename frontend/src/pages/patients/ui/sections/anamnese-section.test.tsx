import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ClinicalNarrative } from "@/pages/patients/data/patient-clinical";

import {
  AnamneseSection,
  copyNarrativeVersion,
  editNarrativeVersion,
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

    expect(html).toContain("Red flags");
    expect(html).toContain("Synkope bei Belastung");
    expect(html).toContain("Kardiologie");
    expect(html).toContain("Fachspezifische Anamnese");
    expect(html).toContain("Kardiologische Abklärung");
  });
});
