import { describe, expect, it } from "vitest";

import { STEP_IDS } from "@/pages/patient-lead/lead-request-steps";

import { CLIENT_FORM_SERVICE_DRAFT_KEYS, clientFormStepOf, type ClientFormSection } from "./lead-client-form-steps";
import { mergePatientUpdates } from "./lead-portal-intake";

describe("clientFormStepOf", () => {
  it("opens the client's form at the step that answers the block", () => {
    const expected: Record<ClientFormSection, string> = {
      person: "person",
      representation: "person",
      identity: "identity",
      billing: "billing",
      payer_organisation: "billing",
      services: "services",
      birth: "follow_up",
      economic_interest: "follow_up",
      enhanced_details: "follow_up",
      relationship_proof: "follow_up",
      follow_up: "follow_up",
      legal: "follow_up",
    };
    for (const [section, step] of Object.entries(expected)) {
      expect(clientFormStepOf(section as ClientFormSection)).toBe(step);
      expect(STEP_IDS).toContain(step);
    }
  });
});

describe("the services the client's form changed", () => {
  const base = { serviceNeeds: ["checkup"], serviceComments: { checkup: "" }, serviceNotes: "", programDateFrom: "" };
  const fresh = {
    serviceNeeds: ["checkup", "second_opinion"],
    serviceComments: { checkup: "morning", second_opinion: "" },
    serviceNotes: "by train",
    programDateFrom: "2026-11-20",
  };

  it("are taken into an untouched wizard draft, the comments per service too", () => {
    expect(mergePatientUpdates(base, base, fresh, CLIENT_FORM_SERVICE_DRAFT_KEYS)).toEqual(fresh);
  });

  it("leave what staff changed in the wizard since the last load", () => {
    const current = { ...base, serviceComments: { checkup: "staff note" } };
    expect(mergePatientUpdates(current, base, fresh, CLIENT_FORM_SERVICE_DRAFT_KEYS)).toEqual({
      ...fresh,
      serviceComments: { checkup: "staff note" },
    });
  });

  it("change nothing when the form left them as they were", () => {
    const reordered = { ...base, serviceComments: { checkup: "" } };
    expect(mergePatientUpdates(base, base, reordered, CLIENT_FORM_SERVICE_DRAFT_KEYS)).toBeNull();
  });
});
