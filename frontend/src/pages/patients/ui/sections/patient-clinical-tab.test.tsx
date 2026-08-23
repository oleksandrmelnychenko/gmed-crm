import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type {
  ClinicalDiagnosis,
  ClinicalVerlaufEntry,
  ClinicalMedication,
  PatientRecommendation,
} from "@/pages/patients/data/patient-clinical";
import type {
  PatientLabResult,
  PatientVitalMeasurement,
} from "@/pages/patients/model/detail-resource-types";
import type { ProviderSummary } from "@/pages/providers/model/types";

import { DiagnosisTreeSection } from "./diagnosis-tree";
import {
  CLINICAL_PROVIDER_QUERY,
  PatientClinicalTab,
  PatientMedicationTable,
  PatientRecommendationsSection,
  attributionLabel,
  clinicalSpecializationLabel,
  clinicalMedicalProviderRows,
  medicationHasEnded,
  mergeVerlaufDoctorAttribution,
  patientVitalDateTime,
  patientVitalIsImported,
  patientVitalMetrics,
  patientLabLatestDate,
  filterPatientLabResultsByPeriod,
  groupPatientLabResults,
} from "./patient-clinical-tab";
import {
  PatientRecommendationOverviewItem,
  deriveDoctors,
  medicationHasEndedForProfile,
} from "./patient-overview-card";

function provider(overrides: Partial<ProviderSummary> = {}): ProviderSummary {
  return {
    address_city: null,
    address_country: null,
    appointment_count: 0,
    avg_rating: null,
    concierge_service_count: 0,
    created_at: "2026-06-19T00:00:00Z",
    doctor_count: 0,
    email: null,
    fachbereich: null,
    has_contract: false,
    id: "provider-1",
    insurance_providers: [],
    is_active: true,
    last_interaction_at: null,
    legal_name: null,
    name: "Klinik München",
    open_concierge_service_count: 0,
    opening_hours: null,
    organization_level: "clinic",
    parent_provider_id: null,
    parent_provider_name: null,
    patient_count: 0,
    phone: null,
    provider_type: "medical",
    rating_count: 0,
    service_count: 0,
    specializations: [],
    tax_id: null,
    ...overrides,
  };
}

function medication(overrides: Partial<ClinicalMedication> = {}): ClinicalMedication {
  return {
    category: "dauer",
    doctor_id: "doctor-1",
    doctor_name: "Heart",
    doctor_title: "Dr.",
    dose_abends: "1",
    dose_mittags: null,
    dose_morgens: "1",
    dose_nachts: null,
    einheit: "Stück",
    form: "Filmtabl.",
    grund: "Bluthochdruck",
    handelsname: "Bisoprolol-ratiopharm",
    hinweis: "Nach dem Essen",
    provider_id: "provider-1",
    provider_name: "Klinik München",
    staerke: "5 mg",
    wirkstoff: "Bisoprolol",
    ...overrides,
  };
}

function diagnosis(overrides: Partial<ClinicalDiagnosis> = {}): ClinicalDiagnosis {
  return {
    certainty: "bestaetigt",
    chronifizierung: null,
    diagnosed_on: null,
    doctor_fachbereich: null,
    doctor_id: null,
    doctor_name: null,
    doctor_title: null,
    external_clinic: null,
    external_country: null,
    external_doctor: null,
    icd_code: null,
    id: "diagnosis-1",
    kind: "main",
    label: "Hypertonie",
    note: null,
    ops_code: null,
    parent_id: null,
    provider_id: null,
    provider_name: null,
    source_mode: "intern",
    treating_doctor_id: null,
    treating_doctor_name: null,
    treating_doctor_title: null,
    treating_none: false,
    ...overrides,
  };
}

function recommendation(overrides: Partial<PatientRecommendation> = {}): PatientRecommendation {
  return {
    description: null,
    due_at: null,
    id: "recommendation-1",
    lifecycle_status: "aktiv",
    note_intern: null,
    outcome_at: null,
    outcome_note: null,
    priority: "normal",
    recommendation_type: null,
    recommended_on: null,
    reminder_at: null,
    reminder_lead_days: null,
    source_doctor_id: null,
    source_doctor_fachbereich: null,
    source_doctor_name: null,
    source_doctor_title: null,
    status: null,
    title: "Kontrolle",
    valid_from: null,
    valid_to: null,
    ...overrides,
  };
}

describe("PatientMedicationTable", () => {
  it("renders clinical attribution with translated doctor specialization", () => {
    const attribution = {
      doctor_fachbereich: "Orthopaedie und unfallchirurgie",
      doctor_id: "doctor-1",
      doctor_name: "Philipp Niemeyer",
      doctor_title: "Prof. Dr. med. Herr",
      provider_id: "provider-1",
      provider_name: "Klinik",
    };

    expect(attributionLabel(attribution, "ru")).toBe(
      "Prof. Dr. med. Herr Philipp Niemeyer (Ортопедия и травматология) · Klinik",
    );
    expect(clinicalSpecializationLabel(attribution, "ru")).toBe("Ортопедия и травматология");
  });

  it("loads and keeps only medical providers for clinical attribution fields", () => {
    expect(CLINICAL_PROVIDER_QUERY).toContain("provider_type=medical");
    expect(CLINICAL_PROVIDER_QUERY).toContain("active_only=true");

    expect(
      clinicalMedicalProviderRows([
        provider({ id: "medical-1", name: "Klinik", provider_type: "medical" }),
        provider({ id: "restaurant-1", name: "Restaurant", provider_type: "non_medical" }),
      ]).map((row) => row.id),
    ).toEqual(["medical-1"]);
  });

  it("renders patient medications as a real grouped table", () => {
    const item = medication();
    const special = medication({
      category: "besondere",
      handelsname: "Artelac",
      wirkstoff: "Hypromellose",
    });
    const html = renderToStaticMarkup(
      <PatientMedicationTable
        canManage
        groupOf={(row) => row.category}
        groups={[
          { key: "dauer", label: "Dauermedikation" },
          { key: "besondere", label: "Zu besonderen Zeiten anzuwendende Medikamente" },
          { key: "selbst", label: "Selbstmedikation" },
        ]}
        indexed={[
          { item, index: 0 },
          { item: special, index: 1 },
        ]}
        renderActions={() => <button type="button">Bearb.</button>}
        tx={(_ru, de) => de}
      />,
    );

    expect(html).toContain("<table");
    // BMP Medikationsplan columns
    expect(html).toContain("Wirkstoff");
    expect(html).toContain("Handelsname");
    expect(html).toContain("Morgens");
    expect(html).toContain("Zur Nacht");
    expect(html).toContain("Einheit");
    // Official layout: the special section shows its heading; the default
    // Dauermedikation block is rendered without a heading (matches the BMP).
    expect(html).toContain("Zu besonderen Zeiten anzuwendende Medikamente");
    expect(html).not.toContain("Dauermedikation");
    expect(html).toContain("Bisoprolol-ratiopharm");
    expect(html).toContain("Bisoprolol");
    expect(html).toContain("5 mg");
    expect(html).toContain("Filmtabl.");
    expect(html).toContain("Stück");
    expect(html).toContain("Bluthochdruck");
    expect(html).toContain("Nach dem Essen");
    expect(html).toContain("Dr. Heart · Klinik München");
    expect(html).toContain("Bearb.");
  });

  it("renders medication hold state across the four dose columns", () => {
    const html = renderToStaticMarkup(
      <PatientMedicationTable
        canManage
        indexed={[
          {
            item: medication({
              on_hold: true,
              hold_from: "2026-07-16",
              hold_note: "Patient pausiert wegen Nebenwirkungen",
            }),
            index: 0,
          },
        ]}
        renderActions={() => <button type="button">Bearb.</button>}
        tx={(_ru, de) => de}
      />,
    );

    expect(html).toContain('colSpan="4"');
    expect(html).toContain("Auf Hold seit 2026-07-16");
    expect(html).toContain("Patient pausiert wegen Nebenwirkungen");
  });

  it("treats only medication courses before today as completed", () => {
    expect(medicationHasEnded({ einnahme_bis: "2026-07-16" }, "2026-07-17")).toBe(true);
    expect(medicationHasEnded({ einnahme_bis: "2026-07-17" }, "2026-07-17")).toBe(false);
    expect(
      medicationHasEndedForProfile({ einnahme_bis: "2026-07-16" }, "2026-07-17"),
    ).toBe(true);
    expect(medicationHasEndedForProfile({ einnahme_bis: null }, "2026-07-17")).toBe(false);
  });
});

describe("patientVitalMetrics", () => {
  it("keeps weight and height in the measurement history", () => {
    const measurement: PatientVitalMeasurement = {
      id: "vital-1",
      measured_at: "2026-08-10T10:00:00Z",
      weight_kg: 72.4,
      height_cm: 175,
      created_at: "2026-08-10T10:00:00Z",
    };

    const metrics = patientVitalMetrics(measurement, {
      bloodPressure: "RR",
      heartRate: "Herzfrequenz",
      weight: "Gewicht",
      height: "Größe",
      bmi: "BMI",
      notSet: "Nicht gesetzt",
    });

    expect(metrics).toHaveLength(2);
    expect(metrics[0].label).toBe("Gewicht");
    expect(metrics[0].value).toMatch(/^72[.,]4 kg$/);
    expect(metrics[1]).toEqual({ label: "Größe", value: "175 cm" });
  });

  it("renders temperature, oxygen saturation and respiratory rate in history", () => {
    const measurement: PatientVitalMeasurement = {
      id: "vital-2",
      measured_at: "2026-08-10T10:00:00Z",
      temperature_c: 36.7,
      oxygen_saturation: 98,
      respiratory_rate: 15,
      created_at: "2026-08-10T10:00:00Z",
    };

    expect(patientVitalMetrics(measurement, {
      bloodPressure: "RR",
      heartRate: "Herzfrequenz",
      temperature: "Temp.",
      oxygenSaturation: "SpO₂",
      respiratoryRate: "AF",
      weight: "Gewicht",
      height: "Größe",
      bmi: "BMI",
      notSet: "Nicht gesetzt",
    })).toEqual([
      { label: "Temp.", value: expect.stringMatching(/^36[.,]7 °C$/) },
      { label: "SpO₂", value: "98 %" },
      { label: "AF", value: "15 /min" },
    ]);
  });

  it("renders date-precision measurements without inventing a midnight time", () => {
    const rendered = patientVitalDateTime(
      "2026-08-10T00:00:00Z",
      "fallback",
      "date",
    );

    expect(rendered).toBe("10 авг. 2026 г.");
    expect(rendered).not.toMatch(/00[:.]00/);
  });

  it("keeps imported measurements immutable by candidate provenance after import unlinking", () => {
    expect(patientVitalIsImported({ source_candidate_id: "vital-1" })).toBe(true);
    expect(patientVitalIsImported({ source_candidate_id: null })).toBe(false);
  });
});

describe("groupPatientLabResults", () => {
  it("renders an OCR lab date without inventing a midnight time", () => {
    const lab = {
      measured_at: "2026-08-10T00:00:00Z",
      measured_at_precision: "date" as const,
    } satisfies Pick<PatientLabResult, "measured_at" | "measured_at_precision">;

    const rendered = patientVitalDateTime(
      lab.measured_at,
      "fallback",
      lab.measured_at_precision,
    );

    expect(rendered).toBe("10 авг. 2026 г.");
    expect(rendered).not.toMatch(/00[:.]00/);
  });

  it("appends repeated analytes by date and preserves different units", () => {
    const base = {
      panel: "Blood count",
      reference_text: null,
      abnormal_flag: "normal" as const,
      created_at: "2026-08-10T00:00:00Z",
    };
    const groups = groupPatientLabResults([
      { ...base, id: "new", analyte_name: "Leukocytes", result_text: "6400", unit: "cells/µL", measured_at: "2026-08-10T00:00:00Z" },
      { ...base, id: "old", analyte_name: "leukocytes", result_text: "6.4", unit: "G/L", measured_at: "2026-07-10T00:00:00Z" },
      { ...base, id: "crp", analyte_name: "CRP", result_text: "0.4", unit: "mg/L", measured_at: "2026-08-10T00:00:00Z" },
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.name)).toEqual(["CRP", "Leukocytes"]);
    expect(groups.every((group) => (
      group.rows.every((row) => row.analyte_name.toLocaleLowerCase() === group.name.toLocaleLowerCase())
    ))).toBe(true);
    const leukocytes = groups.find((group) => group.name === "Leukocytes");
    expect(leukocytes?.rows.map((row) => row.id)).toEqual(["new", "old"]);
    expect(leukocytes?.rows.map((row) => row.unit)).toEqual(["cells/µL", "G/L"]);
  });

  it("prefills the latest date and filters the applied period inclusively", () => {
    const rows: PatientLabResult[] = [
      {
        id: "old",
        measured_at: "2026-06-10T09:00:00Z",
        analyte_name: "CRP",
        result_text: "0.2",
        abnormal_flag: "normal",
        created_at: "2026-06-10T09:00:00Z",
      },
      {
        id: "middle",
        measured_at: "2026-07-10T09:00:00Z",
        analyte_name: "CRP",
        result_text: "0.3",
        abnormal_flag: "normal",
        created_at: "2026-07-10T09:00:00Z",
      },
      {
        id: "latest",
        measured_at: "2026-08-10T09:00:00Z",
        analyte_name: "CRP",
        result_text: "0.4",
        abnormal_flag: "normal",
        created_at: "2026-08-10T09:00:00Z",
      },
    ];

    expect(patientLabLatestDate(rows)).toBe("2026-08-10");
    expect(filterPatientLabResultsByPeriod(rows, "2026-07-10", "2026-08-10").map((row) => row.id))
      .toEqual(["middle", "latest"]);
    expect(filterPatientLabResultsByPeriod(rows, "", "")).toBe(rows);
  });
});

describe("PatientClinicalTab laboratory history", () => {
  it("does not retain the removed OCR chronology helper copy", () => {
    expect(PatientClinicalTab.toString()).not.toContain(
      "Каждый показатель хранит отдельную хронологию; новые OCR-документы добавляют новые даты.",
    );
  });
});

describe("DiagnosisTreeSection", () => {
  it("renders a decorative brand marker immediately before the section title", () => {
    const html = renderToStaticMarkup(
      <DiagnosisTreeSection
        allDoctors={[]}
        canManage={false}
        items={[diagnosis()]}
        lang="ru"
        onSave={async () => undefined}
        providers={[]}
      />,
    );

    expect(html).toMatch(/<span aria-hidden="true"[^>]*><\/span><h3[^>]*>Диагнозы<\/h3>/);
  });

  it("keeps long diagnosis values out of the action column", () => {
    const longValue = "A".repeat(80);
    const html = renderToStaticMarkup(
      <DiagnosisTreeSection
        allDoctors={[]}
        canManage
        items={[
          diagnosis({
            icd_code: longValue,
            label: longValue,
            note: longValue,
            provider_name: longValue,
          }),
        ]}
        lang="ru"
        onSave={async () => undefined}
        providers={[]}
      />,
    );

    expect(html).toContain(
      "lg:grid-cols-[minmax(0,1fr)_minmax(8rem,max-content)_auto]",
    );
    expect(html).toContain("break-words text-sm font-medium");
    expect(html).toContain("break-words font-mono");
    expect(html).toContain("break-words text-[11px] text-muted-foreground");
  });

  it("separates root diagnosis actions from nested child actions", () => {
    const html = renderToStaticMarkup(
      <DiagnosisTreeSection
        allDoctors={[]}
        canManage
        items={[
          diagnosis({ id: "main-1", kind: "main", label: "Appendizitis" }),
          diagnosis({ id: "secondary-1", kind: "secondary", label: "Appendektomie" }),
        ]}
        lang="de"
        onSave={async () => undefined}
        providers={[]}
      />,
    );

    expect(html).toContain("Hauptdiagnose hinzufügen");
    expect(html).toContain("Nebendiagnose hinzufügen");
    expect(html).toContain("Unterdiagnose");
    expect(html).toContain("Prozedur dazu");
    expect(html).toContain("border-orange-500 bg-orange-500 text-white");
    expect(html.match(/border-orange-500/g)).toHaveLength(2);
    expect(html).not.toContain("title=\"Unterdiagnose unter: Appendektomie\"");
  });

  it("renders nested diagnoses as a visible tree", () => {
    const html = renderToStaticMarkup(
      <DiagnosisTreeSection
        allDoctors={[]}
        canManage
        items={[
          diagnosis({ id: "parent-1", kind: "main", label: "Appendizitis" }),
          diagnosis({
            id: "child-1",
            kind: "secondary",
            label: "Appendektomie",
            parent_id: "parent-1",
          }),
        ]}
        lang="de"
        onSave={async () => undefined}
        providers={[]}
      />,
    );

    expect(html).toContain("border-l border-border/70 pl-4");
    expect(html).toContain("absolute -left-4 top-5 h-px w-4");
    expect(html).toContain("border-violet-300 bg-violet-50 text-violet-700");
    expect(html).toContain("border-border/40 bg-white");
    expect(html).not.toContain("bg-muted/10");
    expect(html).not.toContain("bg-muted/20");
  });

  it("renders Z.n. certainty as plain text instead of a pill", () => {
    const html = renderToStaticMarkup(
      <DiagnosisTreeSection
        allDoctors={[]}
        canManage
        items={[
          diagnosis({
            certainty: "zustand_nach",
            id: "diagnosis-zn-1",
            label: "Appendektomie",
          }),
        ]}
        lang="de"
        onSave={async () => undefined}
        providers={[]}
      />,
    );

    expect(html).toContain(">Z.n.<");
    expect(html).toContain("shrink-0 text-sm font-medium text-foreground");
    expect(html).not.toContain("border-indigo-300 bg-indigo-50 text-indigo-800");
  });

  it("renders all medical specializations assigned to a diagnosis", () => {
    const html = renderToStaticMarkup(
      <DiagnosisTreeSection
        allDoctors={[]}
        canManage
        items={[
          diagnosis({
            specialization_ids: ["spec-cardio", "spec-neuro"],
            specializations: [
              {
                id: "spec-cardio",
                code: "cardiology",
                name_en: "Cardiology",
                name_de: "Kardiologie",
                name_ru: "Кардиология",
                is_active: true,
                sort_order: 10,
              },
              {
                id: "spec-neuro",
                code: "neurology",
                name_en: "Neurology",
                name_de: "Neurologie",
                name_ru: "Неврология",
                is_active: true,
                sort_order: 20,
              },
            ],
          }),
        ]}
        lang="ru"
        onSave={async () => undefined}
        providers={[]}
      />,
    );

    expect(html).toContain("Кардиология");
    expect(html).toContain("Неврология");
    expect(html).toContain('data-slot="diagnosis-specializations"');
    expect(html).toContain(
      "lg:grid-cols-[minmax(0,1fr)_minmax(8rem,max-content)_auto]",
    );
    expect(html).toContain("flex min-w-0 flex-col items-start gap-1 lg:pt-0.5");
    expect(html.indexOf("Hypertonie")).toBeLessThan(html.indexOf("Кардиология"));
  });
});

describe("PatientRecommendationsSection", () => {
  it("uses the Russian label for the add recommendation button", () => {
    const html = renderToStaticMarkup(
      <PatientRecommendationsSection
        allDoctors={[]}
        canManage
        lang="ru"
        onReload={() => undefined}
        patientId="patient-1"
        recommendations={[recommendation()]}
        tx={(ru) => ru}
      />,
    );

    expect(html).toContain("Добавить рекомендацию");
    expect(html).not.toContain(">Empfehlung<");
  });

  it("renders the recommending doctor in foreground text", () => {
    const html = renderToStaticMarkup(
      <PatientRecommendationsSection
        allDoctors={[]}
        canManage
        lang="ru"
        onReload={() => undefined}
        patientId="patient-1"
        recommendations={[
          recommendation({
            source_doctor_fachbereich: "Orthopaedie und unfallchirurgie",
            source_doctor_name: "Philipp Niemeyer",
            source_doctor_title: "Prof. Dr. med. Herr",
          }),
        ]}
        tx={(ru) => ru}
      />,
    );

    expect(html).toContain("text-foreground\">Prof. Dr. med. Herr Philipp Niemeyer");
    expect(html).toContain("(Ортопедия и травматология)");
  });

  it("highlights recommendation validity period and reminder date", () => {
    const html = renderToStaticMarkup(
      <PatientRecommendationsSection
        allDoctors={[]}
        canManage
        lang="ru"
        onReload={() => undefined}
        patientId="patient-1"
        recommendations={[
          recommendation({
            reminder_at: "2026-07-01",
            valid_from: "2026-06-01",
            valid_to: "2026-09-01",
          }),
        ]}
        tx={(ru) => ru}
      />,
    );

    expect(html).toContain("Период: 2026-06-01 – 2026-09-01");
    expect(html).toContain("border-emerald-300 bg-emerald-50");
    expect(html).toContain("Дата напоминания: 2026-07-01");
    expect(html).toContain("border-amber-300 bg-amber-50");
  });
});

describe("mergeVerlaufDoctorAttribution", () => {
  it("keeps the selected Verlauf doctor when a refetch returns provider-only rows", () => {
    const serverRows: ClinicalVerlaufEntry[] = [
      {
        doctor_fachbereich: null,
        doctor_id: null,
        doctor_name: null,
        doctor_title: null,
        id: "verlauf-1",
        note: "Kontrolle nach OP",
        occurred_on: "2026-06-30",
        provider_id: "provider-1",
        provider_name: "Klinik München",
      },
    ];
    const fallbackRows: ClinicalVerlaufEntry[] = [
      {
        ...serverRows[0],
        doctor_fachbereich: "kardiologie",
        doctor_id: "doctor-1",
        doctor_name: "Ulrich Hölzenbein",
        doctor_title: "Dr. med. Herr",
      },
    ];

    expect(mergeVerlaufDoctorAttribution(serverRows, fallbackRows)[0]).toMatchObject({
      doctor_fachbereich: "kardiologie",
      doctor_id: "doctor-1",
      doctor_name: "Ulrich Hölzenbein",
      doctor_title: "Dr. med. Herr",
    });
  });
});

describe("PatientRecommendationOverviewItem", () => {
  it("keeps the recommendation date beside the title without showing the type", () => {
    const html = renderToStaticMarkup(
      <ul>
        <PatientRecommendationOverviewItem
          rec={recommendation({
            description: "bis zur Wiedererlangung des alltäglichen Aktivitätsniveaus",
            recommendation_type: "follow_up",
            recommended_on: "2026-06-03",
            title: "Thromboseprophylaxe",
          })}
          lang="ru"
          tx={(ru) => ru}
        />
      </ul>,
    );

    expect(html).toContain("Thromboseprophylaxe");
    expect(html).toContain("2026-06-03");
    expect(html).not.toContain("Контрольный визит");
    expect(html).not.toContain("Дата рекомендации");
    expect(html).not.toContain("follow_up");
    expect(html.indexOf("2026-06-03")).toBeGreaterThan(html.indexOf("Thromboseprophylaxe"));
    expect(html.indexOf("2026-06-03")).toBeLessThan(html.indexOf("bis zur"));
  });

  it("shows the recommending doctor specialization", () => {
    const html = renderToStaticMarkup(
      <ul>
        <PatientRecommendationOverviewItem
          rec={recommendation({
            source_doctor_fachbereich: "Orthopaedie und unfallchirurgie",
            source_doctor_name: "Philipp Niemeyer",
            source_doctor_title: "Prof. Dr. med. Herr",
            title: "Kontrolle",
          })}
          lang="ru"
          tx={(ru) => ru}
        />
      </ul>,
    );

    expect(html).toContain("Назначил: Prof. Dr. med. Herr Philipp Niemeyer");
    expect(html).toContain("(Ортопедия и травматология)");
  });

  it("renders document provenance as a clickable preview chip", () => {
    const html = renderToStaticMarkup(
      <ul>
        <PatientRecommendationOverviewItem
          rec={recommendation({
            source_document_id: "document-1",
            source_document_name: "Arztbrief Beispiel7.pdf",
          })}
          lang="ru"
          tx={(ru) => ru}
        />
      </ul>,
    );

    expect(html).toContain('data-clinical-source="document"');
    expect(html).toContain('type="button"');
    expect(html).toContain("Из документа");
    expect(html).toContain("Arztbrief Beispiel7.pdf");
  });
});

describe("deriveDoctors", () => {
  it("keeps doctors from examinations and procedures in the overview list", () => {
    const doctors = deriveDoctors([
      {
        doctor_fachbereich: "Orthopaedie und Unfallchirurgie",
        doctor_name: "Philipp Niemeyer",
        doctor_title: "Prof. Dr. med. Herr",
        provider_name: "Checkup provider",
      },
      {
        doctor_fachbereich: "Orthopaedie und Unfallchirurgie",
        doctor_name: "Philipp Niemeyer",
        doctor_title: "Prof. Dr. med. Herr",
        provider_name: "Checkup provider",
      },
    ]);

    expect(doctors).toHaveLength(1);
    expect(doctors[0]).toMatchObject({
      fachbereich: "Orthopaedie und Unfallchirurgie",
      name: "Philipp Niemeyer",
      title: "Prof. Dr. med. Herr",
    });
  });
});
