import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ClinicalDiagnosis, ClinicalMedication } from "@/pages/patients/data/patient-clinical";
import type { ProviderSummary } from "@/pages/providers/model/types";

import { DiagnosisTreeSection } from "./diagnosis-tree";
import {
  CLINICAL_PROVIDER_QUERY,
  PatientMedicationTable,
  clinicalMedicalProviderRows,
} from "./patient-clinical-tab";

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

describe("PatientMedicationTable", () => {
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
});

describe("DiagnosisTreeSection", () => {
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

    expect(html).toContain("grid-cols-[minmax(0,1fr)_auto]");
    expect(html).toContain("break-words text-sm font-medium");
    expect(html).toContain("break-words font-mono");
    expect(html).toContain("break-words text-[11px] text-muted-foreground");
  });
});
