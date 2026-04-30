import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MedicationEquivalentsPanel } from "./medication-equivalents-panel";

describe("MedicationEquivalentsPanel", () => {
  it("renders German equivalents with staff-only and unverified warnings", () => {
    const html = renderToStaticMarkup(
      <MedicationEquivalentsPanel
        medicationName="Atoris"
        medicationSubstance="Atorvastatin"
        includeCandidates
        candidates={[
          {
            equivalent_id: "drug-1",
            brand_name: "Sortis",
            country_code: "DE",
            atc_code: "C10AA05",
            form: "tablet",
            strength: "20 mg",
            manufacturer: "Pfizer",
            confidence: "0.92",
            verification_status: "verified",
            substances: ["Atorvastatin"],
            note: "Same active substance",
            staff_warning: "Staff information only, not a prescription.",
          },
          {
            equivalent_id: "drug-2",
            brand_name: "Candidate",
            country_code: "DE",
            atc_code: "C10AA05",
            form: "tablet",
            strength: "20 mg",
            manufacturer: null,
            confidence: "0.55",
            verification_status: "candidate",
            substances: ["Atorvastatin"],
            note: null,
            staff_warning: "Staff information only, not a prescription.",
          },
        ]}
      />,
    );

    expect(html).toContain("Sortis");
    expect(html).toContain("Candidate");
    expect(html).toContain("not a prescription");
    expect(html).toContain("Unverified candidate");
    expect(html).toContain("not patient-facing");
  });
});
