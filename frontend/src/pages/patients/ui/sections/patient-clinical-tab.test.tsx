import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ClinicalMedication } from "@/pages/patients/data/patient-clinical";

import { PatientMedicationTable } from "./patient-clinical-tab";

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

describe("PatientMedicationTable", () => {
  it("renders patient medications as a real grouped table", () => {
    const item = medication();
    const html = renderToStaticMarkup(
      <PatientMedicationTable
        canManage
        groupOf={(row) => row.category}
        groups={[
          { key: "dauer", label: "Dauermedikation" },
          { key: "besondere", label: "Zu besonderen Zeiten" },
          { key: "selbst", label: "Selbstmedikation" },
        ]}
        indexed={[{ item, index: 0 }]}
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
    expect(html).toContain("Dauermedikation");
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
