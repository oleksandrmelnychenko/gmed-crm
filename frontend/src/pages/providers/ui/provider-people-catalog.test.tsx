import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ProviderPeopleRow } from "../model/people-types";
import {
  ProviderPeopleCatalog,
  groupProviderPeopleRows,
} from "./provider-people-catalog";

function contactRow(overrides: Partial<ProviderPeopleRow> = {}): ProviderPeopleRow {
  return {
    contacts: [],
    counts: { concierge_count: 2, service_count: 3 },
    department: null,
    display_name: "Max Kontakt",
    email: "kontakt@service.test",
    fachbereich: null,
    first_name: "Max",
    gender: "male",
    insurance_providers: [],
    languages: [],
    last_interaction_at: null,
    last_name: "Kontakt",
    linked_patients: [],
    license_number: null,
    licensing_country: null,
    licensing_valid_until: null,
    name: "Max Kontakt",
    notes: null,
    opening_hours: null,
    person_id: "person-1",
    person_type: "doctor",
    phone: "+49 30 1000",
    provider_id: "provider-1",
    provider_name: "Alois Dallmayr Fine Dining",
    provider_type: "non_medical",
    shared_identity_id: null,
    role_code: null,
    role_label: "Operations",
    specializations: [],
    status: "active",
    subrole: null,
    title: "Dr.",
    ...overrides,
  };
}

function doctorRow(overrides: Partial<ProviderPeopleRow> = {}): ProviderPeopleRow {
  return contactRow({
    display_name: "Dr. Anna Beispiel",
    first_name: "Anna",
    last_name: "Beispiel",
    name: "Anna Beispiel",
    person_id: "doctor-provider-1",
    provider_name: "Klinik Eins",
    provider_type: "medical",
    shared_identity_id: "doctor-identity-1",
    ...overrides,
  });
}

describe("ProviderPeopleCatalog", () => {
  it("groups a global doctor once and merges every provider and activity", () => {
    const grouped = groupProviderPeopleRows([
      doctorRow({
        counts: { appointment_count: 2, patient_count: 1 },
        linked_patients: [{
          id: "patient-uuid-1",
          patient_id: "P-1",
          first_name: "Max",
          last_name: "Mustermann",
          appointment_count: 2,
          leistung_count: 1,
          concierge_count: 0,
          last_interaction_at: "2026-07-01T10:00:00Z",
        }],
        specializations: [{
          id: "cardiology",
          code: "cardiology",
          name_en: "Cardiology",
          name_de: "Kardiologie",
          name_ru: "Кардиология",
          is_active: true,
          sort_order: 1,
        }],
      }),
      doctorRow({
        counts: { appointment_count: 3, patient_count: 2 },
        insurance_providers: [{ id: "insurance-1", name: "TK", is_active: true }],
        linked_patients: [
          {
            id: "patient-uuid-1",
            patient_id: "P-1",
            first_name: "Max",
            last_name: "Mustermann",
            appointment_count: 1,
            leistung_count: 0,
            concierge_count: 1,
            last_interaction_at: "2026-07-02T10:00:00Z",
          },
          {
            id: "patient-uuid-2",
            patient_id: "P-2",
            first_name: "Erika",
            last_name: "Musterfrau",
            appointment_count: 2,
            leistung_count: 0,
            concierge_count: 0,
            last_interaction_at: "2026-07-03T10:00:00Z",
          },
        ],
        person_id: "doctor-provider-2",
        provider_id: "provider-2",
        provider_name: "Klinik Zwei",
        specializations: [{
          id: "radiology",
          code: "radiology",
          name_en: "Radiology",
          name_de: "Radiologie",
          name_ru: "Радиология",
          is_active: true,
          sort_order: 2,
        }],
      }),
    ]);

    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.providerRows.map((row) => row.provider_id)).toEqual([
      "provider-1",
      "provider-2",
    ]);
    expect(grouped[0]?.specializations.map((item) => item.id)).toEqual([
      "cardiology",
      "radiology",
    ]);
    expect(grouped[0]?.insurance_providers.map((item) => item.id)).toEqual(["insurance-1"]);
    expect(grouped[0]?.linked_patients).toHaveLength(2);
    expect(grouped[0]?.linked_patients.find((patient) => patient.patient_id === "P-1")).toMatchObject({
      appointment_count: 3,
      concierge_count: 1,
    });
    expect(grouped[0]?.counts).toMatchObject({ appointment_count: 5, patient_count: 2 });
    expect(grouped[0]?.last_interaction_at).toBe("2026-07-03T10:00:00Z");
  });

  it("keeps provider-scoped doctor rows separate", () => {
    const rows = [
      doctorRow(),
      doctorRow({
        person_id: "doctor-provider-2",
        provider_id: "provider-2",
        provider_name: "Klinik Zwei",
      }),
    ];

    expect(groupProviderPeopleRows(rows, false)).toHaveLength(2);
  });

  it("labels non-medical doctor-backed people as contacts", () => {
    const html = renderToStaticMarkup(
      <ProviderPeopleCatalog
        forceNonMedical
        filters={{
          fachbereich: "",
          gender: "",
          insuranceProvider: "",
          patientId: "",
          personType: "",
          providerId: "",
          providerType: "non_medical",
          role: "",
          search: "",
          specialization: "",
          taxonomyNodeId: "",
        }}
        rows={[contactRow()]}
        onFiltersChange={() => undefined}
        onOpenPerson={() => undefined}
        onOpenProvider={() => undefined}
      />,
    );

    expect(html).toContain("Контакт");
    expect(html).toContain("Max Kontakt");
    expect(html).toContain("Alois Dallmayr Fine Dining");
    expect(html).not.toContain("Herr");
    expect(html).not.toContain("Dr.");
    expect(html).not.toContain("Врач");
  });

  it("hides clinical columns and specialty values in forced non-medical mode", () => {
    const html = renderToStaticMarkup(
      <ProviderPeopleCatalog
        forceNonMedical
        filters={{
          fachbereich: "",
          gender: "",
          insuranceProvider: "",
          patientId: "",
          personType: "",
          providerId: "",
          providerType: "non_medical",
          role: "",
          search: "",
          specialization: "",
          taxonomyNodeId: "",
        }}
        rows={[
          contactRow({
            fachbereich: "cardiology",
            specializations: [
              {
                id: "spec-1",
                code: "cardiology",
                name_en: "Cardiology",
                name_de: "Kardiologie",
                name_ru: "Кардиология",
                is_active: true,
                sort_order: 1,
              },
            ],
          }),
        ]}
        onFiltersChange={() => undefined}
        onOpenPerson={() => undefined}
        onOpenProvider={() => undefined}
      />,
    );

    expect(html).toContain("Max Kontakt");
    expect(html).not.toContain("Специализация");
    expect(html).not.toContain("Специализации");
    expect(html).not.toContain("Кардиология");
    expect(html).not.toContain("Cardiology");
  });
});
