import { describe, expect, it } from "vitest";
import { matchInvoicePatient, matchInvoiceRecipient } from "./patient-match";
import type { PatientOption } from "./types";

const anna: PatientOption = { id: "anna", patient_id: "P-20260905-0001", first_name: "Anna", last_name: "Müller" };
const boris: PatientOption = { id: "boris", patient_id: "P-20260905-0002", first_name: "Борис", last_name: "Петренко" };
const patients = [anna, boris];

describe("invoice patient matching", () => {
  it("matches XML buyer names without interpreting IDs or company contacts as patients", () => {
    expect(matchInvoiceRecipient("Anna Müller", patients).patientId).toBe("anna");
    expect(matchInvoiceRecipient("Anna Müller GmbH", patients).status).toBe("not_found");
    expect(matchInvoiceRecipient("Anna Müller e.K.", patients).status).toBe("not_found");
    expect(matchInvoiceRecipient("Herrn Müller, Anna", patients).patientId).toBe("anna");
    expect(matchInvoiceRecipient(anna.patient_id, patients).status).toBe("not_found");
    expect(matchInvoiceRecipient(null, patients).status).toBe("not_found");
    expect(matchInvoiceRecipient("Anna Müller", [...patients, { ...anna, id: "namesake" }]).status).toBe("ambiguous");
  });
  it("matches an exact GMED ID with OCR punctuation and case normalization", () => {
    expect(matchInvoicePatient("Patient-ID: p–20260905–0001", patients)).toEqual({ status: "matched", patientId: "anna" });
  });
  it("matches full recipient names in either order, across lines and alphabets", () => {
    for (const text of ["Rechnungsempfänger:\nAnna\nMULLER", "Herrn Müller, Anna"]) {
      expect(matchInvoicePatient(text, patients)).toEqual({ status: "matched", patientId: "anna" });
    }
    expect(matchInvoicePatient("Пацієнт: Петренко Борис", patients)).toEqual({ status: "matched", patientId: "boris" });
  });
  it("does not select a supplier, partial name, partial ID or unrelated numeric reference", () => {
    for (const text of ["Arzt: Anna Müller", "Patient: Anna", "Patient: Joanna Müller", "P-20260905-00010", "P-20260905-0001-extra", "nothing recognised"]) {
      expect(matchInvoicePatient(text, patients).status).toBe("not_found");
    }
    expect(matchInvoicePatient("Rechnungsnummer: 20260905", [{ ...anna, patient_id: "20260905" }]).status).toBe("not_found");
  });
  it("keeps ambiguous recipients and contradictory IDs for manual selection", () => {
    const namesake = { ...anna, id: "namesake", patient_id: "P-20260905-0003" };
    expect(matchInvoicePatient("Patient: Anna Müller", [anna, namesake]).status).toBe("ambiguous");
    expect(matchInvoicePatient(`${anna.patient_id}\n${boris.patient_id}`, patients).status).toBe("ambiguous");
    expect(matchInvoicePatient(`${anna.patient_id}\nПацієнт: Борис Петренко`, patients).status).toBe("ambiguous");
    expect(matchInvoicePatient(`Patient: Anna Müller\n${anna.patient_id}`, [anna, namesake])).toEqual({ status: "matched", patientId: "anna" });
  });
  it("does not charge a company's named contact to a matching patient", () => {
    expect(matchInvoicePatient("Agentur für Patientenbetreuung\nHerrn Anna Müller\nMusterstrasse 1", patients).status).toBe("not_found");
    expect(matchInvoicePatient("Example GmbH\nRechnungsempfänger: Anna Müller", patients).status).toBe("not_found");
  });
  it("only selects from available patients and can resolve after lookups arrive", () => {
    expect(matchInvoicePatient(anna.patient_id, []).status).toBe("not_found");
    expect(matchInvoicePatient(anna.patient_id, patients).patientId).toBe("anna");
  });
});
