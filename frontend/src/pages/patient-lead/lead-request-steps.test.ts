import { describe, expect, it } from "vitest";

import type { LeadRequest, LeadRequestFollowUp } from "./lead-request-api";
import {
  STEP_IDS,
  documentsTouched,
  firstIncompleteStep,
  hasBaseFormInput,
  initialStep,
  missingByStep,
  nextHeldByMissing,
  refusedIdentityUploadKeys,
  stepDone,
  stepMissingCount,
  stepMissingKeys,
  stepOfField,
  visibleSteps,
} from "./lead-request-steps";

type StepRequest = Pick<
  LeadRequest,
  "progress" | "follow_up" | "consents" | "submitted_at" | "changed_since_submit" | "documents"
>;

function request(overrides: Partial<StepRequest> = {}): StepRequest {
  return {
    progress: { filled: 0, total: 0, missing_for_submit: [] },
    follow_up: { required: false, blocks: [], missing: {}, answered_at: null },
    consents: {
      lead_inquiry_processing: { type: "lead_inquiry_processing", version: "1", texts: {}, given_at: "2026-10-07T08:00:00Z" },
    },
    submitted_at: null,
    changed_since_submit: false,
    documents: [],
    ...overrides,
  };
}

const followUp = (overrides: Partial<LeadRequestFollowUp>): LeadRequestFollowUp => ({
  required: true,
  blocks: [],
  missing: {},
  answered_at: null,
  ...overrides,
});

describe("lead cabinet steps", () => {
  it("marks disclosure complete with an own valid decision only, not with the default no", () => {
    const current = { ...request(), disclosure: { allow_disclosure: false, consent_given: false, version: "2026-10-14", language: "de", chosen_at: "2026-10-15T08:00:00Z", chosen_by: "viewer", access_kind: "self", company_name: "GMED" } } as LeadRequest;
    // Not answered is "no" (owner decision 2026-10-22) for the sending, but no answer the person gave (QA 2026-10-24, A-1) ...
    expect(stepDone(request(), "disclosure")).toBe(false);
    expect(firstIncompleteStep(request())).toBeNull();
    // ... and an older choice that named recipients without a disclosure decision asks for it.
    const legacy = { ...request(), consent_form: { version: "1", choices: { named_recipients: true }, chosen_at: null } } as unknown as LeadRequest;
    expect(stepDone(legacy, "disclosure")).toBe(false);
    expect(stepDone(current, "disclosure")).toBe(true);
    expect(stepDone({ ...current, disclosure: { ...current.disclosure!, allow_disclosure: true } }, "disclosure")).toBe(false);
  });

  it("marks the documents step complete only once the person gave the consent, a reason or a file", () => {
    const untouched = request();
    expect(stepDone(untouched, "documents")).toBe(false);
    expect(documentsTouched(untouched)).toBe(false);
    // The server requires nothing there: the step never holds the sending back.
    expect(stepMissingCount(untouched, "documents")).toBe(0);
    expect(firstIncompleteStep(untouched)).toBeNull();
    const consented = request({ consents: { ...untouched.consents, health_data_processing: { type: "health_data_processing", version: "1", texts: {}, given_at: "2026-10-07T08:00:00Z" } } });
    expect(stepDone(consented, "documents")).toBe(true);
    expect(stepDone({ ...untouched, identification: { request_reason: "Zweitmeinung" } } as unknown as LeadRequest, "documents")).toBe(true);
    expect(stepDone({ ...untouched, identification: { request_reason: "  " } } as unknown as LeadRequest, "documents")).toBe(false);
    expect(stepDone(request({ documents: [{ id: "d1", file_name: "befund.pdf" } as unknown as LeadRequest["documents"][number]] }), "documents")).toBe(true);
    // Something the server still misses there keeps it incomplete.
    expect(stepDone(request({ ...consented, progress: { filled: 0, total: 1, missing_for_submit: ["request_reason"] } }), "documents")).toBe(false);
  });
  it("counts an identity copy GMED refused as missing until a new copy arrives (QA 2026-10-25, F-V2)", () => {
    const scan = { id: "id-1", file_name: "pass.jpg", uploaded_at: "2026-10-25T08:00:00Z" } as unknown as LeadRequest["documents"][number];
    const fresh = { id: "id-2", file_name: "pass-neu.jpg", uploaded_at: "2026-10-25T09:00:00Z" } as unknown as LeadRequest["documents"][number];
    const refused = followUp({ required: false, refused_identity_documents: [{ document_id: "id-1", file_name: "pass.jpg", reason: "unreadable", representative_id: null }] });
    const sent = { ...request({ submitted_at: "2026-10-25T08:30:00Z", follow_up: refused }), identity_documents: [scan] };
    expect(refusedIdentityUploadKeys(sent)).toEqual(["id_document_upload"]);
    expect(missingByStep(sent).identity).toEqual(["id_document_upload"]);
    expect(stepMissingCount(sent, "identity")).toBe(1);
    expect(stepDone(sent, "identity")).toBe(false);
    // A new copy replaces it: complete again.
    const replaced = { ...sent, identity_documents: [scan, fresh] };
    expect(stepMissingCount(replaced, "identity")).toBe(0);
    expect(stepDone(replaced, "identity")).toBe(true);
    // The server listing the upload itself is not counted twice.
    const listed = { ...sent, progress: { filled: 0, total: 1, missing_for_submit: ["id_document_upload"] } };
    expect(stepMissingCount(listed, "identity")).toBe(1);
    // A parent of a minor: the copy is the parent's, on the same step.
    const parent = {
      ...request({ submitted_at: "2026-10-25T08:30:00Z", follow_up: followUp({ required: false, refused_identity_documents: [{ document_id: "id-9", file_name: null, reason: "expired", representative_id: "rep-a" }] }) }),
      representation: { representatives: [{ id: "rep-a", slot: "rep1", identity_documents: [{ id: "id-9", file_name: "ausweis.pdf" }] }] },
    } as unknown as LeadRequest;
    expect(refusedIdentityUploadKeys(parent)).toEqual(["rep1_id_upload"]);
    expect(stepMissingCount(parent, "identity")).toBe(1);
    expect(refusedIdentityUploadKeys(request())).toEqual([]);
  });

  it("inserts a live country step before first submission and completes it by autosaved answers", () => {
    const preview = request({ follow_up: followUp({ before_submit: true, blocks: ["A", "L", "I"], missing: { A: ["funds_source"], L: ["pep_self"], I: ["id_document_upload"] } }) });
    expect(visibleSteps(preview)).toEqual(["person", "identity", "billing", "follow_up", "disclosure", "documents", "send"]);
    expect(stepMissingCount(preview, "follow_up")).toBe(2);
    expect(stepDone(preview, "follow_up")).toBe(false);
    expect(stepDone(preview, "send")).toBe(false);
    const answered = { ...preview, follow_up: { ...preview.follow_up!, missing: { I: ["id_document_upload"] } } };
    expect(stepDone(answered, "follow_up")).toBe(true);
    expect(stepDone(answered, "send")).toBe(false);
    expect(visibleSteps({ ...preview, follow_up: followUp({ required: false, blocks: [] }) })).not.toContain("follow_up");
  });

  it("keeps hidden and unknown requirements out of base-form edit links", () => {
    for (const field of ["birth_place", "pep_self", "id_valid_until", "something_new"]) expect(hasBaseFormInput(field)).toBe(false);
    for (const field of ["name_latin", "phone", "custody", "rep2_name_latin", "id_document_upload", "request_reason"]) expect(hasBaseFormInput(field)).toBe(true);
  });
  it("shows the follow-up step only while the server opened a block of the cabinet", () => {
    expect(STEP_IDS).toEqual([
      "person",
      "contact",
      "identity",
      // "Who pays" is part of step 3 since 2026-10-11 (owner).
      "billing",
      "declarations",
      "follow_up",
      "disclosure",
      "documents",
      // The service questionnaire comes last, only when the server offers it (owner 2026-10-27).
      "services",
      "send",
    ]);
    // "contact" is part of the first tab, the declarations are follow-up block L (owner 2026-10-09).
    expect(visibleSteps(request())).toEqual(["person", "identity", "billing", "disclosure", "documents", "send"]);
    const servicesOffered = { services: [], service_comments: {}, program_date_from: "", notes: "" };
    expect(visibleSteps({ ...request(), service_preferences: servicesOffered })).toEqual(["person", "identity", "billing", "disclosure", "documents", "services", "send"]);
    const sent = "2026-10-07T09:00:00Z";
    expect(visibleSteps(request({ submitted_at: sent, follow_up: undefined }))).not.toContain("follow_up");
    expect(visibleSteps(request({ submitted_at: sent, follow_up: followUp({ blocks: ["A"] }) }))).toContain("follow_up");
    // D and E are the payer link's; "not required" shows nothing either.
    expect(visibleSteps(request({ submitted_at: sent, follow_up: followUp({ blocks: ["D", "E"] }) }))).not.toContain("follow_up");
    expect(visibleSteps(request({ submitted_at: sent, follow_up: followUp({ required: false, blocks: ["A"] }) }))).not.toContain("follow_up");
    // A staff action started the assessment before the first send (QA
    // 2026-10-10): the blocks wait for the send, no extra step in the base form.
    expect(visibleSteps(request({ follow_up: followUp({ blocks: ["I"] }) }))).not.toContain("follow_up");
    expect(initialStep(request({ follow_up: followUp({ blocks: ["I"], missing: { I: ["id_document_upload"] } }) }))).toBe("person");
  });

  it("takes the server's map of missing keys by step and places the rest itself", () => {
    const missing = missingByStep(
      request({
        progress: {
          filled: 0,
          total: 0,
          missing_for_submit: ["city", "payer_kind", "request_reason", "pep_self", "id_document_upload", "invoice_recipient"],
          // An older server's step "payer": its keys belong to step 3 now.
          missing_by_step: { contact: ["city"], payer: ["payer_kind"], identity: ["id_document_upload"] },
        },
      }),
    );
    expect(missing).toMatchObject({
      // The contact keys are answered in the first step (owner 2026-10-09).
      person: ["city"],
      contact: [],
      identity: ["id_document_upload"],
      // Not in the server's map (or of a step the cabinet no longer has): placed by the cabinet.
      billing: ["invoice_recipient", "payer_kind"],
      declarations: ["pep_self"],
      documents: ["request_reason"],
      follow_up: [],
      send: [],
    });
  });

  it("maps every key of an older server to a step", () => {
    expect(stepOfField("birth_place")).toBe("person");
    expect(stepOfField("rep2_email")).toBe("person");
    // A minor's parents upload their identity copies on step "Document" (QA 2026-10-22); an adult's representative in step 1.
    expect(stepOfField("rep1_id_upload")).toBe("identity");
    expect(stepOfField("rep2_id_upload")).toBe("identity");
    expect(stepOfField("rep2_authority_upload")).toBe("person");
    expect(stepOfField("agent_id_upload")).toBe("person");
    expect(stepOfField("has_representative")).toBe("person");
    expect(stepOfField("habitual_residence_country")).toBe("contact");
    expect(stepOfField("contact_channels")).toBe("contact");
    expect(stepOfField("id_valid_until")).toBe("identity");
    expect(stepOfField("payer_legal_form")).toBe("billing");
    expect(stepOfField("invoice_recipient_is_payer")).toBe("billing");
    expect(stepOfField("recipient_relationship_kind")).toBe("billing");
    expect(stepOfField("insurance_type")).toBe("billing");
    expect(stepOfField("payment_method")).toBe("billing");
    expect(stepOfField("pep_self_details")).toBe("declarations");
    expect(stepOfField("request_reason")).toBe("documents");
    expect(stepOfField("something_new")).toBe("person");
  });

  it("counts a step's badge, the consent in the first step, and the follow-up's open keys", () => {
    const withoutConsent = request({ consents: {} });
    expect(stepMissingCount(withoutConsent, "person")).toBe(1);
    expect(stepDone(withoutConsent, "person")).toBe(false);
    // Sent by the other parent: the second parent's own consent is no missing entry (QA 2026-10-24).
    const sentByOther = request({ consents: {}, submitted_at: "2026-10-07T09:00:00Z" });
    expect(stepMissingCount(sentByOther, "person")).toBe(0);
    expect(stepDone(sentByOther, "person")).toBe(true);
    const open = request({
      submitted_at: "2026-10-07T09:00:00Z",
      follow_up: followUp({ blocks: ["A", "B"], missing: { A: ["funds_sources", "funds_proof_upload"], B: [], C: ["payment_method"] } }),
    });
    // Only the open blocks count.
    expect(missingByStep(open).follow_up).toEqual(["A:funds_sources", "A:funds_proof_upload"]);
    expect(stepMissingCount(open, "follow_up")).toBe(2);
    expect(stepDone(open, "follow_up")).toBe(false);
    expect(stepDone({ ...open, follow_up: followUp({ blocks: ["A"], answered_at: "2026-10-07T10:00:00Z" }) }, "follow_up")).toBe(true);
    // "Send" is done once sent and unchanged.
    expect(stepDone(open, "send")).toBe(true);
    expect(stepDone({ ...open, changed_since_submit: true }, "send")).toBe(false);
  });

  it("lists what \"Next\" judges a step by: its keys in form order, the consent last in the first step", () => {
    const open = request({
      progress: { filled: 0, total: 0, missing_for_submit: ["city", "legal_sex", "payer_kind", "id_document_upload"] },
      consents: { lead_inquiry_processing: { type: "lead_inquiry_processing", version: "1", texts: {}, given_at: null } },
    });
    expect(stepMissingKeys(open, "person")).toEqual(["legal_sex", "city", "inquiry_consent"]);
    expect(stepMissingKeys(open, "identity")).toEqual(["id_document_upload"]);
    expect(stepMissingKeys(open, "billing")).toEqual(["payer_kind"]);
    expect(stepMissingKeys(open, "documents")).toEqual([]);
    // Like the badge: the consent only while the request was never sent.
    expect(stepMissingKeys({ ...open, submitted_at: "2026-10-07T09:00:00Z" }, "person")).toEqual(["legal_sex", "city"]);
    expect(stepMissingKeys(open, "person")).toHaveLength(stepMissingCount(open, "person"));
    // The follow-up's keys carry their block.
    const followed = request({ follow_up: followUp({ before_submit: true, blocks: ["A"], missing: { A: ["funds_source"] } }) });
    expect(stepMissingKeys(followed, "follow_up")).toEqual(["A:funds_source"]);
  });

  it("holds \"Next\" for what is missing the same way on every press (owner report 2026-11-11)", () => {
    // Nothing missing never holds.
    expect(nextHeldByMissing([], null)).toBe(false);
    expect(nextHeldByMissing([], new Set(["legal_sex"]))).toBe(false);
    // The first press of a visit holds, whatever was shown on an earlier visit (null: none in this one).
    expect(nextHeldByMissing(["legal_sex"], null)).toBe(true);
    // The press after the list goes on while everything missing was on it — also when less is missing now.
    const shown = new Set(["legal_sex", "city", "inquiry_consent"]);
    expect(nextHeldByMissing(["legal_sex", "city", "inquiry_consent"], shown)).toBe(false);
    expect(nextHeldByMissing(["legal_sex"], shown)).toBe(false);
    // A field that became required since holds again, also on the third or tenth press.
    expect(nextHeldByMissing(["legal_sex", "under_guardianship"], shown)).toBe(true);
    expect(nextHeldByMissing(["under_guardianship"], new Set<string>())).toBe(true);
    // An empty value of any kind is the same key: a select, a date, a list, an upload.
    for (const key of ["legal_sex", "date_of_birth", "citizenships", "id_document_upload", "payer_contact_consent"]) {
      expect(nextHeldByMissing([key], null)).toBe(true);
      expect(nextHeldByMissing([key], new Set([key]))).toBe(false);
    }
  });

  it("opens a request where its person has something to do", () => {
    expect(initialStep(request())).toBe("person");
    const sent = request({ submitted_at: "2026-10-07T09:00:00Z" });
    expect(initialStep(sent)).toBe("send");
    expect(initialStep({ ...sent, follow_up: followUp({ blocks: ["H"], missing: { H: ["pep_office"] } }) })).toBe("follow_up");
    expect(
      initialStep({ ...sent, follow_up: followUp({ blocks: ["H"], answered_at: "2026-10-07T10:00:00Z" }) }),
    ).toBe("send");
    expect(
      firstIncompleteStep(
        request({ progress: { filled: 0, total: 0, missing_for_submit: ["pep_self", "payer_kind"] } }),
      ),
    ).toBe("billing");
    expect(firstIncompleteStep(request())).toBeNull();
  });
});
