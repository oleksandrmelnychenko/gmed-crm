import { describe, expect, it } from "vitest";

import type { LeadRequest } from "./lead-request-api";
import {
  canSubmit,
  consentText,
  draftFromPersonalData,
  formatFileSize,
  missingForSubmit,
  personalDataPatch,
  rejectedValue,
} from "./lead-request-model";

const personal = {
  first_name: "Anna",
  middle_name: null,
  last_name: "Muster",
  date_of_birth: null,
  legal_sex: null,
  citizenships: ["UA"],
  street_address: null,
  zip_code: null,
  city: "Kyiv",
  country: null,
  phone: null,
  primary_language: null,
};

function request(overrides: Partial<LeadRequest> = {}): LeadRequest {
  return {
    lead_id: "lead-1",
    access_kind: "self",
    created_at: "2026-10-03T08:00:00Z",
    personal_data: personal,
    progress: { filled: 4, total: 11, missing_for_submit: ["street_address", "date_of_birth"] },
    minor: false,
    documents: [],
    max_documents: 30,
    consents: {
      lead_inquiry_processing: {
        type: "lead_inquiry_processing",
        version: "2026-10-03",
        texts: { de: "Ich bin einverstanden …", ru: "Я согласен(на) …" },
        given_at: null,
      },
    },
    submitted_at: null,
    retention_deadline_at: "2026-10-17T08:00:00Z",
    ...overrides,
  };
}

describe("lead request autosave patch", () => {
  it("sends only the changed fields, trimmed", () => {
    const saved = draftFromPersonalData(personal);
    const draft = { ...saved, city: "  Lviv ", citizenships: ["UA", "DE"], phone: "" };
    expect(personalDataPatch(saved, draft)).toEqual({ city: "Lviv", citizenships: ["UA", "DE"] });
  });

  it("does not send empty names or a value the server refused", () => {
    const saved = draftFromPersonalData(personal);
    const draft = { ...saved, first_name: " ", date_of_birth: "2015-01-01" };
    const rejected = rejectedValue("date_of_birth", draft);
    expect(personalDataPatch(saved, draft, rejected)).toEqual({});
    expect(personalDataPatch(saved, { ...draft, date_of_birth: "1990-01-01" }, rejected)).toEqual({
      date_of_birth: "1990-01-01",
    });
    expect(rejectedValue("email", draft)).toBeNull();
  });

  it("clears an optional field with an empty string", () => {
    const saved = draftFromPersonalData(personal);
    expect(personalDataPatch(saved, { ...saved, city: "" })).toEqual({ city: "" });
  });
});

describe("lead request send step", () => {
  it("lists the missing fields in form order and needs the request consent", () => {
    expect(missingForSubmit(request())).toEqual(["date_of_birth", "street_address"]);
    const complete = request({ progress: { filled: 9, total: 11, missing_for_submit: [] } });
    expect(canSubmit(complete, "lead_inquiry_processing")).toBe(false);
    const consented = request({
      progress: { filled: 9, total: 11, missing_for_submit: [] },
      consents: {
        lead_inquiry_processing: { ...request().consents.lead_inquiry_processing, given_at: "2026-10-03T09:00:00Z" },
      },
    });
    expect(canSubmit(consented, "lead_inquiry_processing")).toBe(true);
  });

  it("shows the consent text the server will store, in the portal language", () => {
    expect(consentText(request(), "lead_inquiry_processing", "ru")).toBe("Я согласен(на) …");
    expect(consentText(request(), "lead_inquiry_processing", "en")).toBe("Ich bin einverstanden …");
    expect(consentText(request(), "health_data_processing", "de")).toBe("");
  });

  it("formats file sizes", () => {
    expect(formatFileSize(2048, "de")).toBe("2 KB");
    expect(formatFileSize(3 * 1024 * 1024, "de")).toBe("3 MB");
    expect(formatFileSize(null, "de")).toBe("");
  });
});
