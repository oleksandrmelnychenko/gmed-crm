import { describe, expect, it } from "vitest";

import type { RelationItem } from "./detail-tab-types";
import {
  blankDocumentUploadForm,
  blankRelationForm,
  buildPatientDocumentUploadFormData,
  relationFormToPayload,
  relationNameSuggestsOrganisation,
  relationToForm,
} from "./sheet-forms";

describe("buildPatientDocumentUploadFormData (QA 2026-10-12 B2-04)", () => {
  const file = new Blob(["%PDF-1.4"], { type: "application/pdf" });

  it("sends an unticked medical flag and no default type", () => {
    const form = { ...blankDocumentUploadForm(), isMedical: false };
    const body = buildPatientDocumentUploadFormData(form, "patient-1", file);
    expect(body.get("is_medical")).toBe("false");
    expect(body.has("art")).toBe(false);
    expect(body.get("patient_id")).toBe("patient-1");
    expect(body.get("visibility")).toBe("internal");
  });

  it("sends the chosen type and a ticked flag", () => {
    const form = {
      ...blankDocumentUploadForm(),
      art: " arztbrief ",
      category: "medical",
      isMedical: true,
    };
    const body = buildPatientDocumentUploadFormData(form, "patient-1", file);
    expect(body.get("is_medical")).toBe("true");
    expect(body.get("art")).toBe("arztbrief");
    expect(body.get("category")).toBe("medical");
  });

  it("starts without the former default type 'report'", () => {
    expect(blankDocumentUploadForm().art).toBe("");
  });
});

function relation(overrides: Partial<RelationItem> = {}): RelationItem {
  return {
    id: "relation-1",
    related_patient_id: null,
    related_patient_pid: null,
    related_name: "Viktor Zahler",
    related_display_name: "Viktor Zahler",
    relation_type: "other",
    is_emergency_contact: false,
    phone: null,
    notes: null,
    created_at: "2026-10-11T10:00:00Z",
    email: "zahler@example.com",
    address_street: "Musterweg 1",
    address_zip: "10115",
    address_city: "Berlin",
    address_country: "DE",
    is_default_payer: true,
    ...overrides,
  };
}

describe("relation form country (QA 2026-10-11 B-25)", () => {
  it("keeps the ISO code the country picker stores", () => {
    const form = relationToForm(relation());
    expect(form.addressCountry).toBe("DE");
    expect(relationFormToPayload(form, form.relatedName)).toMatchObject({
      address_country: "DE",
      is_default_payer: true,
      related_name: "Viktor Zahler",
    });
  });

  it("reads an old free-text country as its code when it is recognised", () => {
    expect(relationToForm(relation({ address_country: "Deutschland" })).addressCountry).toBe("DE");
    expect(relationToForm(relation({ address_country: "Germany" })).addressCountry).toBe("DE");
    expect(relationToForm(relation({ address_country: " at " })).addressCountry).toBe("AT");
  });

  it("keeps an unknown old value as written and an empty one empty", () => {
    expect(relationToForm(relation({ address_country: "Bavaria" })).addressCountry).toBe("Bavaria");
    expect(relationToForm(relation({ address_country: null })).addressCountry).toBe("");
    expect(blankRelationForm().addressCountry).toBe("");
  });
});

describe("relation organisation box (sanctions screening, 2026-10-12)", () => {
  it("shows and sends the answer of a separate contact", () => {
    const company = relationToForm(relation({ related_name: "Polartek Shipping", is_organisation: true }));
    expect(company.isOrganisation).toBe(true);
    expect(relationFormToPayload(company, company.relatedName)).toMatchObject({ is_organisation: true });
    const person = relationToForm(relation({ is_organisation: false }));
    expect(person.isOrganisation).toBe(false);
    expect(relationFormToPayload(person, person.relatedName)).toMatchObject({ is_organisation: false });
    // An older server says nothing: a person until staff tick the box.
    expect(relationToForm(relation()).isOrganisation).toBe(false);
    expect(blankRelationForm().isOrganisation).toBe(false);
  });

  it("never marks a linked patient record as an organisation", () => {
    const linked = relationToForm(
      relation({ related_patient_id: "patient-2", related_name: "Beispiel GmbH", is_organisation: true }),
    );
    expect(linked.isOrganisation).toBe(false);
    expect(relationFormToPayload({ ...linked, isOrganisation: true }, "Ben Muster")).toMatchObject({
      related_patient_id: "patient-2",
      is_organisation: null,
    });
  });

  it("suggests the box for a name with a legal form or of an institution", () => {
    for (const name of ["Beispiel GmbH", "Polartek Shipping LLC", "ООО Полартек", "Beispiel GmbH & Co. KG", "Muster AG"]) {
      expect(relationNameSuggestsOrganisation(name), name).toBe(true);
    }
    // Banks, savings banks, insurers and foundations without a legal form (QA 2026-10-12).
    for (const name of [
      "Testgrad Commerce Bank", "Banque Beispiel", "Kreissparkasse Beispielstadt", "Beispiel Commerzbank",
      "Сбербанк", "Альфа-Банк", "Beispiel Versicherung", "Stiftung Beispielhilfe",
    ]) {
      expect(relationNameSuggestsOrganisation(name), name).toBe(true);
    }
    for (const name of ["Viktor Zahler", "Polartek", "Anna Agnes Muster", "Sa Ko", "Anna Bankowski", "Ben Fondel", ""]) {
      expect(relationNameSuggestsOrganisation(name), name).toBe(false);
    }
  });
});
