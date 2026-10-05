import { describe, expect, it } from "vitest";

import type { LeadRequest } from "./lead-request-api";
import {
  canSubmit,
  changedSinceSubmit,
  consentText,
  draftFromPersonalData,
  formatFileSize,
  missingForSubmit,
  personalDataPatch,
  rejectedValue,
  withInsuranceAnswer,
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
  has_insurance: null,
  insurance_type: null,
  insurance_provider: null,
  insurance_number: null,
  insurance_covers_germany: null,
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

  it("keeps the insurance block consistent with the answer", () => {
    const insured = draftFromPersonalData({
      ...personal,
      has_insurance: true,
      insurance_type: "private",
      insurance_provider: "Allianz Care",
      insurance_number: "A-123",
      insurance_covers_germany: "not_sure",
    });
    expect(insured.has_insurance).toBe("yes");
    expect(draftFromPersonalData({ ...personal, has_insurance: false }).has_insurance).toBe("no");
    expect(draftFromPersonalData(personal).has_insurance).toBe("");

    // "No" is the self-payer: the details go, and only the difference is sent.
    const selfPayer = withInsuranceAnswer(insured, "no");
    expect(selfPayer).toMatchObject({
      has_insurance: "no",
      insurance_type: "self_pay",
      insurance_provider: "",
      insurance_number: "",
      insurance_covers_germany: "",
    });
    expect(personalDataPatch(insured, selfPayer)).toEqual({
      has_insurance: "no",
      insurance_type: "self_pay",
      insurance_provider: "",
      insurance_number: "",
      insurance_covers_germany: "",
    });
    // Back to "yes": an insured person is not the self-payer type.
    expect(withInsuranceAnswer(selfPayer, "yes")).toMatchObject({ has_insurance: "yes", insurance_type: "" });
    expect(withInsuranceAnswer(insured, "")).toMatchObject({ has_insurance: "", insurance_provider: "Allianz Care" });
  });

  it("offers to send again only after a change", () => {
    expect(changedSinceSubmit(request())).toBe(false);
    const sent = request({ submitted_at: "2026-10-03T09:30:00Z" });
    expect(changedSinceSubmit(sent)).toBe(false);
    expect(changedSinceSubmit({ ...sent, changed_since_submit: true })).toBe(true);
    expect(changedSinceSubmit({ ...sent, changed_since_submit: false })).toBe(false);
    // An older server does not say; a document uploaded afterwards still counts.
    const document = {
      id: "doc-1",
      file_name: "befund.pdf",
      size_bytes: 1,
      mime_type: "application/pdf",
      uploaded_by_me: true,
      reviewed: false,
      can_delete: true,
    };
    expect(changedSinceSubmit({ ...sent, documents: [{ ...document, uploaded_at: "2026-10-03T09:00:00Z" }] })).toBe(false);
    expect(changedSinceSubmit({ ...sent, documents: [{ ...document, uploaded_at: "2026-10-03T10:00:00Z" }] })).toBe(true);
  });

  it("formats file sizes", () => {
    expect(formatFileSize(2048, "de")).toBe("2 KB");
    expect(formatFileSize(3 * 1024 * 1024, "de")).toBe("3 MB");
    expect(formatFileSize(null, "de")).toBe("");
  });
});
