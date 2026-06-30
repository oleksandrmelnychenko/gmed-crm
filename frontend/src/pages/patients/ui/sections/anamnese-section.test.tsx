import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ClinicalNarrative } from "@/pages/patients/data/patient-clinical";

import { AnamneseSection, copyNarrativeVersion } from "./anamnese-section";

function narrative(overrides: Partial<ClinicalNarrative> = {}): ClinicalNarrative {
  return {
    id: "narrative-1",
    anamnese_aktuelle: "Aktuelle Beschwerden seit 2025.",
    anamnese_vorgeschichte: "Appendektomie.",
    anamnese_vegetative: null,
    anamnese_sozial: null,
    beurteilung: "Stabil.",
    is_active: true,
    created_at: "2025-06-30T10:00:00Z",
    updated_at: "2026-06-30T18:18:13Z",
    ...overrides,
  };
}

describe("AnamneseSection", () => {
  it("copies an existing narrative into a new active version draft", () => {
    const source = narrative({ id: "old-version", is_active: false });

    expect(copyNarrativeVersion(source)).toEqual({
      ...source,
      id: null,
      is_active: true,
      created_at: null,
      updated_at: null,
    });
  });

  it("renders active version metadata and the copy action", () => {
    const html = renderToStaticMarkup(
      <AnamneseSection
        active={narrative()}
        canManage
        lang="ru"
        loadHistory={async () => []}
        onSave={async () => undefined}
      />,
    );

    expect(html).toContain("Последнее обновление");
    expect(html).toContain("Активная версия");
    expect(html).toContain("Копировать");
    expect(html).toContain("Актуальный анамнез");
  });
});
