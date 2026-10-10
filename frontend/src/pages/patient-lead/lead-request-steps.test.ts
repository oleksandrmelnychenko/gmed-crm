import { describe, expect, it } from "vitest";

import type { LeadRequest, LeadRequestFollowUp } from "./lead-request-api";
import {
  STEP_IDS,
  firstIncompleteStep,
  initialStep,
  missingByStep,
  stepDone,
  stepMissingCount,
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
  it("shows the follow-up step only while the server opened a block of the cabinet", () => {
    expect(STEP_IDS).toEqual([
      "person",
      "contact",
      "identity",
      "payer",
      "billing",
      "declarations",
      "follow_up",
      "documents",
      "send",
    ]);
    // "contact" is part of the first tab, the declarations are follow-up block L (owner 2026-10-09).
    expect(visibleSteps(request())).toEqual(["person", "identity", "payer", "billing", "documents", "send"]);
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
          missing_for_submit: ["city", "payer_kind", "request_reason", "pep_self", "id_document_upload", "invoice_to"],
          missing_by_step: { contact: ["city"], payer: ["payer_kind"], identity: ["id_document_upload"] },
        },
      }),
    );
    expect(missing).toMatchObject({
      // The contact keys are answered in the first step (owner 2026-10-09).
      person: ["city"],
      contact: [],
      identity: ["id_document_upload"],
      payer: ["payer_kind"],
      // Not in the server's map: placed by the cabinet.
      billing: ["invoice_to"],
      declarations: ["pep_self"],
      documents: ["request_reason"],
      follow_up: [],
      send: [],
    });
  });

  it("maps every key of an older server to a step", () => {
    expect(stepOfField("birth_place")).toBe("person");
    expect(stepOfField("rep2_email")).toBe("person");
    expect(stepOfField("has_representative")).toBe("person");
    expect(stepOfField("habitual_residence_country")).toBe("contact");
    expect(stepOfField("contact_channels")).toBe("contact");
    expect(stepOfField("id_valid_until")).toBe("identity");
    expect(stepOfField("payer_legal_form")).toBe("payer");
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
    ).toBe("payer");
    expect(firstIncompleteStep(request())).toBeNull();
  });
});
