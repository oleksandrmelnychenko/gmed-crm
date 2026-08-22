import { describe, expect, it } from "vitest";

import { deriveTreatingDoctors } from "./patient-overview-card";

describe("deriveTreatingDoctors", () => {
  it("uses the explicitly assigned treating doctor", () => {
    const doctors = deriveTreatingDoctors([
      {
        treating_doctor_id: "treating-doctor-1",
        treating_doctor_name: "Herr Jörg Widmann",
        treating_doctor_title: "Dr. med.",
        treating_doctor_fachbereich: "plastische_und_aesthetische_chirurgie",
        treating_none: false,
      },
    ]);

    expect(doctors).toEqual([
      expect.objectContaining({
        fachbereich: "plastische_und_aesthetische_chirurgie",
        name: "Herr Jörg Widmann",
        title: "Dr. med.",
      }),
    ]);
  });

  it("deduplicates repeated assignments and excludes diagnoses without treatment here", () => {
    const doctors = deriveTreatingDoctors([
      {
        treating_doctor_id: "doctor-1",
        treating_doctor_name: "Frau Alexandra Schoeneich",
        treating_doctor_title: "Dr. med.",
        treating_doctor_fachbereich: null,
        treating_none: false,
      },
      {
        treating_doctor_id: "doctor-1",
        treating_doctor_name: "Frau Alexandra Schoeneich",
        treating_doctor_title: "Dr. med.",
        treating_doctor_fachbereich: "endokrinologie_und_diabetologie",
        treating_none: false,
      },
      {
        treating_doctor_id: "doctor-2",
        treating_doctor_name: "External Diagnostician",
        treating_doctor_title: null,
        treating_doctor_fachbereich: "radiologie",
        treating_none: true,
      },
    ]);

    expect(doctors).toHaveLength(1);
    expect(doctors[0]).toMatchObject({
      fachbereich: "endokrinologie_und_diabetologie",
      name: "Frau Alexandra Schoeneich",
    });
  });
});
