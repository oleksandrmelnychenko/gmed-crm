import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { IDENTIFICATION_FIELDS, PERSONAL_FIELDS } from "@/pages/patient-lead/lead-request-model";

import { normalizeLeadPortalIntake } from "../data/lead-portal-intake-api";
import { PORTAL_FIELD_BY_DRAFT_KEY, mergePatientUpdates } from "../model/lead-portal-intake";
import { LeadGwgStatements } from "./lead-gwg-statements";
import { LeadPatientConcern } from "./lead-patient-concern";

const de = (_ru: string, value: string) => value;

const identification = {
  salutation: "ms", former_names: "Former Example", birth_place: "Kyiv", birth_country: "UA",
  habitual_residence_country: "AT", contact_channels: ["email", "phone", "messenger"],
  pep_self: true, pep_related: false, sanctions_links: true,
  payment_background: "Family support", relationship_since: "Since 2001",
  residence_since: "Since 2012", other_residences: "Earlier residence in Paris", former_citizenships: ["FR"],
  stay_reason: "work", stay_reason_details: "Employment contract",
  pep_office: "Example public office", pep_country: "ES", pep_period: "2010–2014",
  pep_relationship: "Example relationship", pep_wealth_origin: "Example savings",
  sanctions_link_name: "Example organisation", sanctions_link_kind: "business",
  sanctions_link_since_extent: "Ended in 2008",
};

describe("fresh cabinet to wizard personal-data parity audit", () => {
  it("maps every personal field into the staff draft and preserves staff typing on a portal update", () => {
    expect(new Set(Object.values(PORTAL_FIELD_BY_DRAFT_KEY))).toEqual(new Set(PERSONAL_FIELDS));
    const baseline = Object.fromEntries(Object.keys(PORTAL_FIELD_BY_DRAFT_KEY).map((key) => [key, "old"]));
    const current = { ...baseline, phone: "staff typing" };
    const incoming = Object.fromEntries(Object.keys(PORTAL_FIELD_BY_DRAFT_KEY).map((key) => [key, `patient ${key}`]));
    expect(mergePatientUpdates(current, baseline, incoming)).toEqual({ ...incoming, phone: "staff typing" });
  });

  it("retains and renders all nonmedical identification answers after their follow-up blocks close", () => {
    expect(new Set(Object.keys(identification))).toEqual(new Set(IDENTIFICATION_FIELDS.filter((key) => key !== "request_reason")));
    const intake = normalizeLeadPortalIntake({ lead_id: "synthetic-parity", identification });
    expect(intake).not.toBeNull();
    expect(intake!.identification).toMatchObject(identification);
    const html = renderToStaticMarkup(<LeadGwgStatements intake={intake} payer={null} tx={de} lang="de" askedBlocks={[]} />);
    for (const value of [
      "Frau", "Former Example", "Kyiv", "Ukraine", "Österreich", "E-Mail, Telefon, Messenger",
      "Family support", "Since 2001", "Since 2012", "Earlier residence in Paris", "Frankreich",
      "Employment contract", "Example public office", "Spanien", "2010–2014", "Example relationship",
      "Example savings", "Example organisation", "geschäftlich", "Ended in 2008",
    ]) expect(html).toContain(value);
    // A negative answer is an answer too: it must remain in the read-only staff view.
    expect(html).toContain('data-testid="lead-gwg-answer-pep_self"');
    expect(html).toContain('data-testid="lead-gwg-answer-pep_related"');
    expect(html).toContain('data-testid="lead-gwg-answer-sanctions_links"');
    expect(html).toContain("Nein");
  });

  it("keeps the medical reason separate and shows it in the medical step instead of GwG statements", () => {
    const reason = { text: "Synthetic medical concern", updated_at: "2026-10-12T09:00:00Z" };
    const intake = normalizeLeadPortalIntake({ lead_id: "synthetic-parity", identification, patient_request_reason: reason });
    expect(intake!.request_reason).toEqual(reason);
    expect(renderToStaticMarkup(<LeadGwgStatements intake={intake} payer={null} tx={de} lang="de" />)).not.toContain(reason.text);
    const html = renderToStaticMarkup(<LeadPatientConcern reason={intake!.request_reason} documents={[]} currentConcern="Staff concern"
      onTransfer={() => undefined} onOpen={() => undefined} onDownload={() => undefined} tx={de} />);
    expect(html).toContain(reason.text);
    expect(html).toContain('data-testid="lead-patient-concern-transfer"');
  });
});
