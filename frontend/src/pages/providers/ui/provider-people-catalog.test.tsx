import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ProviderPeopleRow } from "../model/people-types";
import { ProviderPeopleCatalog } from "./provider-people-catalog";

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

describe("ProviderPeopleCatalog", () => {
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
