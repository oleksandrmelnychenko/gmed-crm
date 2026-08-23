import { describe, expect, it } from "vitest";

import {
  clinicalOverviewNoteLines,
  deriveDoctors,
  deriveTreatingDoctors,
  mergePatientDoctors,
} from "./patient-overview-card";

describe("clinicalOverviewNoteLines", () => {
  it("removes legacy import metadata when structured document provenance exists", () => {
    expect(clinicalOverviewNoteLines(
      "Import: Arztbrief Beispiel7.pdf\n[clinical-import:import-1:candidate-1]\nKlinischer Hinweis",
      true,
    )).toEqual(["Klinischer Hinweis"]);
  });

  it("keeps legacy metadata when no structured document provenance is available", () => {
    expect(clinicalOverviewNoteLines("Import: legacy.pdf", false)).toEqual(["Import: legacy.pdf"]);
  });
});

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

describe("mergePatientDoctors", () => {
  it("keeps both treating and clinical-history doctors and merges matching people", () => {
    const treatingDoctors = deriveTreatingDoctors([
      {
        treating_doctor_id: "doctor-1",
        treating_doctor_name: "Herr Treating Doctor",
        treating_doctor_title: "Dr. med.",
        treating_doctor_fachbereich: "gastroenterologie",
        treating_none: false,
      },
    ]);
    const clinicalDoctors = deriveDoctors([
      {
        doctor_name: "Herr Diagnostic Doctor",
        doctor_title: "Prof. Dr. med.",
        doctor_fachbereich: "radiologie",
        provider_name: "Diagnostic clinic",
      },
      {
        doctor_name: "Herr Treating Doctor",
        doctor_title: "Dr. med.",
        doctor_fachbereich: "gastroenterologie",
        provider_name: "Treating clinic",
      },
    ]);

    const doctors = mergePatientDoctors(treatingDoctors, clinicalDoctors);

    expect(doctors).toHaveLength(2);
    expect(doctors.find((doctor) => doctor.name === "Herr Diagnostic Doctor")).toMatchObject({
      isInClinicalHistory: true,
      isTreating: false,
    });
    expect(doctors.find((doctor) => doctor.name === "Herr Treating Doctor")).toMatchObject({
      isInClinicalHistory: true,
      isTreating: true,
    });
  });
});
