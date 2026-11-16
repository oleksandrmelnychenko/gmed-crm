import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NO_CONSENT_FORM_CHOICES, type ConsentRecipient } from "@/pages/patient-lead/lead-request-api";
import { recipientDrafts } from "@/pages/patient-lead/lead-trusted-persons-model";
import type { PatientConsentState } from "../../data/patient-consent-choices-api";
import {
  changeToSend,
  consentDraftOf,
  documentsToRenew,
  draftChanged,
  listedPersons,
  onlyWithdraws,
  personKey,
} from "../../model/patient-consent-choices";
import { printsConsentChoice } from "./patient-consent-embedded-editor";
import { PatientConsentChoicesView } from "./patient-consent-choices";

const core = { ...NO_CONSENT_FORM_CHOICES, agency_processing: true, doctors_to_agency: true, data_system: true };

function person(name: string, scope_codes: string[]): ConsentRecipient {
  return { name, relation: "relative", phone: "+49 30 1234567", birth_date: "1970-01-02", scope_codes } as ConsentRecipient;
}

function state(overrides: Partial<PatientConsentState> = {}): PatientConsentState {
  const eva = person("Eva Muster", ["all"]);
  const karl = person("Karl Neu", ["medical"]);
  return {
    patient_id: "p1",
    version: "2026-10-12",
    max_recipients: 5,
    minor: false,
    can_edit: true,
    requested: { id: "c2", choices: { ...core, named_recipients: true, channel_whatsapp: true, channel_email: true }, recipients: [eva, karl], disclosure_consent_given: true },
    effective: { choices: { ...core, named_recipients: true, channel_whatsapp: true }, recipients: [eva] },
    pending: { options: ["channel_email"], recipients: [false, true] },
    history: [{ id: "c2", chosen_at: "2026-11-16T10:00:00Z", source: "patient_staff", access_kind: "staff", recorded_how: "phone", recorded_note: null, chosen_by_name: "PM", choices: core, recipients_count: 2, signed: false }],
    documents: [
      { id: "d1", template_id: "privacy_consents", title: "Einverständniserklärung", signed_at: null, created_at: "2026-11-01T10:00:00Z", needs_new_version: true },
      { id: "d2", template_id: "consent_data_release_child", title: "Kind", signed_at: null, created_at: "2026-11-01T10:00:00Z", needs_new_version: false },
    ],
    disclosure_text: "Ich willige ausdrücklich ein …",
    ...overrides,
  };
}

describe("patient consent choices", () => {
  it("lists what applies and the additions waiting for the signature", () => {
    const { applies, waiting } = listedPersons(state());
    expect(applies.map((p) => p.name)).toEqual(["Eva Muster"]);
    expect(waiting.map((p) => p.name)).toEqual(["Karl Neu"]);
    expect(documentsToRenew(state())).toEqual(["d1"]);
  });

  it("a removal or a narrower scope only withdraws; a new person or channel does not", () => {
    const current = state();
    const choices = current.requested!.choices;
    expect(onlyWithdraws(choices, [person("eva  muster", ["medical"])], current)).toBe(true);
    expect(onlyWithdraws(choices, [person("Otto Neu", ["medical"])], current)).toBe(false);
    expect(onlyWithdraws(choices, [person("Karl Neu", ["all"])], current)).toBe(false);
    expect(onlyWithdraws({ ...choices, channel_telegram: true }, [], current)).toBe(false);
    expect(personKey(person(" Eva   Muster ", []))).toBe(personKey(person("eva muster", [])));
  });

  it("sends the persons and derives named_recipients from them", () => {
    const current = state();
    const draft = consentDraftOf(current);
    expect(draftChanged(draft, current)).toBe(false);
    draft.persons = recipientDrafts([current.requested!.recipients[0]]);
    expect(draftChanged(draft, current)).toBe(true);
    const sent = changeToSend({ ...draft, persons: [] }, current, "de", { how: "phone", note: " " });
    expect(sent.choices.named_recipients).toBe(false);
    expect(sent.recorded_how).toBe("phone");
    expect(sent.recorded_note).toBeUndefined();
  });

  it("shows «ожидает подписи» and the new-version action for the outdated form", () => {
    const html = renderToStaticMarkup(<PatientConsentChoicesView state={state()} onEdit={() => {}} onRenew={() => {}} renewing={null} />);
    expect(html).toContain('data-testid="patient-consent-persons-waiting"');
    expect(html).toContain('data-testid="patient-consent-channel-waiting"');
    expect(html).toContain('data-testid="patient-consent-renew-d1"');
    expect(html).not.toContain('data-testid="patient-consent-renew-d2"');
    expect(html).toContain('data-testid="patient-consent-edit"');
  });

  it("the portal view has no actions without rights", () => {
    const html = renderToStaticMarkup(<PatientConsentChoicesView state={state({ can_edit: false, documents: [] })} />);
    expect(html).not.toContain("patient-consent-edit");
    expect(html).not.toContain("patient-consent-renew");
  });

  it("only the Einverständniserklärung forms carry the consent editor", () => {
    expect(printsConsentChoice("privacy_consents")).toBe(true);
    expect(printsConsentChoice("consent_data_release_single")).toBe(true);
    expect(printsConsentChoice("confidentiality_release")).toBe(false);
    expect(printsConsentChoice("order_cost_estimate")).toBe(false);
  });
});
