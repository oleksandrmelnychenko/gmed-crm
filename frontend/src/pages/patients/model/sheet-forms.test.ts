import { describe, expect, it } from "vitest";

import type { RelationItem } from "./detail-tab-types";
import { blankRelationForm, relationFormToPayload, relationToForm } from "./sheet-forms";

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
