import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetchMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({
  apiFetch: apiFetchMock,
}));

import type { AllDoctorOption, ClinicalNarrative } from "./patient-clinical";
import {
  deduplicateAllDoctorOptions,
  fetchAllDoctors,
  savePatientNarrative,
} from "./patient-clinical";

function narrative(): ClinicalNarrative {
  return {
    id: "narrative-1",
    case_id: "case-1",
    anamnese_aktuelle: "Aktuelle Anamnese",
    anamnese_vorgeschichte: null,
    anamnese_vegetative: null,
    anamnese_sozial: null,
    beurteilung: "Beurteilung",
    red_flags: "Synkope",
    specialization_ids: ["specialization-1", "specialization-2"],
    specializations: [
      {
        id: "specialization-1",
        code: "CARD",
        name_en: "Cardiology",
        name_de: "Kardiologie",
        name_ru: "Кардиология",
        is_active: true,
        sort_order: 1,
        narrative_text: "Belastungsdyspnoe",
        assessment_text: "Kardiologische Kontrolle",
      },
      {
        id: "specialization-2",
        code: "OPHT",
        name_en: "Ophthalmology",
        name_de: "Augenheilkunde",
        name_ru: "Офтальмология",
        is_active: true,
        sort_order: 2,
        narrative_text: null,
        assessment_text: null,
      },
    ],
    anamnese_at: "2026-08-07T12:00:00.000Z",
    is_active: true,
    created_at: "2026-08-07T12:00:00.000Z",
    updated_at: "2026-08-07T12:00:00.000Z",
  };
}

describe("savePatientNarrative", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    apiFetchMock.mockResolvedValue({});
  });

  it("persists added specializations, their texts, and red flags", async () => {
    await savePatientNarrative("patient-1", narrative());

    const [path, init] = apiFetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/patients/patient-1/narrative");
    expect(JSON.parse(String(init.body))).toEqual(
      expect.objectContaining({
        id: "narrative-1",
        red_flags: "Synkope",
        specialization_ids: ["specialization-1", "specialization-2"],
        specializations: [
          {
            specialization_id: "specialization-1",
            narrative_text: "Belastungsdyspnoe",
            assessment_text: "Kardiologische Kontrolle",
          },
          {
            specialization_id: "specialization-2",
            narrative_text: null,
            assessment_text: null,
          },
        ],
      }),
    );
  });

  it("persists specialization deletion and edited text", async () => {
    const updated = narrative();
    updated.specialization_ids = ["specialization-2"];
    updated.specializations = [
      {
        ...updated.specializations![1],
        narrative_text: "Augenbeschwerden",
        assessment_text: "Augenärztliche Kontrolle",
      },
    ];

    await savePatientNarrative("patient-1", updated);

    const [, init] = apiFetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual(
      expect.objectContaining({
        specialization_ids: ["specialization-2"],
        specializations: [
          {
            specialization_id: "specialization-2",
            narrative_text: "Augenbeschwerden",
            assessment_text: "Augenärztliche Kontrolle",
          },
        ],
      }),
    );
  });

  it("honours an explicitly empty specialization list as delete all", async () => {
    const updated = narrative();
    updated.specialization_ids = [];

    await savePatientNarrative("patient-1", updated);

    const [, init] = apiFetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual(
      expect.objectContaining({
        specialization_ids: [],
        specializations: [],
      }),
    );
  });
});

describe("doctor options", () => {
  const doctor = (overrides: Partial<AllDoctorOption> = {}): AllDoctorOption => ({
    id: "doctor-1",
    name: "Florian Straube",
    title: "Prof. Dr. med.",
    fachbereich: "Kardiologie",
    provider_id: "provider-1",
    provider_name: "München Klinik Bogenhausen",
    ...overrides,
  });

  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  it("keeps one option per doctor id and merges distinct provider labels", () => {
    expect(deduplicateAllDoctorOptions([
      doctor(),
      doctor(),
      doctor({ provider_id: "provider-2", provider_name: "Herzzentrum München" }),
    ])).toEqual([
      doctor({ provider_name: "München Klinik Bogenhausen, Herzzentrum München" }),
    ]);
  });

  it("deduplicates the response before exposing doctor options to forms", async () => {
    apiFetchMock.mockResolvedValue([doctor(), doctor()]);

    await expect(fetchAllDoctors()).resolves.toEqual([doctor()]);
    expect(apiFetchMock).toHaveBeenCalledWith("/doctors", { cacheTtlMs: 60_000 });
  });
});
