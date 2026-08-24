import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetchMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({
  apiFetch: apiFetchMock,
}));

import type { AllDoctorOption, ClinicalMedication, ClinicalNarrative } from "./patient-clinical";
import {
  deduplicateAllDoctorOptions,
  fetchAllDoctors,
  savePatientNarrative,
  updateClinicalMedicationLifecycle,
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

describe("medication lifecycle", () => {
  const medication = {
    category: "dauer",
    wirkstoff: "Metoprolol",
    handelsname: "Metohexal",
    staerke: "50 mg",
    form: "Tablette",
    einnahmeform: "oral",
    dose_morgens: "1",
    dose_mittags: "0",
    dose_abends: "1",
    dose_nachts: "0",
    einheit: "Tablette",
    hinweis: null,
    grund: null,
    verordnet_am: null,
    einnahme_von: null,
    einnahme_bis: null,
    status: "aktiv",
    apothekenpflichtig: false,
    rezeptpflichtig: false,
    btm: false,
    aut_idem_sperre: false,
    abgabebeschraenkung: false,
    sonstige_vermerke: null,
    on_hold: false,
    hold_from: null,
    hold_until: null,
    hold_note: null,
    provider_id: null,
    provider_name: null,
    doctor_id: null,
    doctor_name: null,
    doctor_title: null,
    doctor_fachbereich: null,
  } satisfies ClinicalMedication;

  it("synchronizes paused status with hold and clears stale hold metadata on resume", () => {
    const paused = updateClinicalMedicationLifecycle(medication, { status: "pausiert" });
    expect(paused).toMatchObject({ status: "pausiert", on_hold: true });

    const resumed = updateClinicalMedicationLifecycle(
      {
        ...paused,
        hold_from: "2026-08-10",
        hold_until: "2026-08-20",
        hold_note: "Nebenwirkung",
      },
      { onHold: false },
    );
    expect(resumed).toMatchObject({
      status: "aktiv",
      on_hold: false,
      hold_from: null,
      hold_until: null,
      hold_note: null,
    });
  });
});
