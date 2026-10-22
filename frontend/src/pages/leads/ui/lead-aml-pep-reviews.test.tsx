import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  parsePepReviews,
  pepAnswerValue,
  pepPersons,
  pepReviewOf,
  representativePepSubject,
  withPepReview,
  type PatientPepReviewFields,
} from "../model/pep-review";
import { LeadAmlPepReviews } from "./lead-aml-pep-reviews";

const tx = (_ru: string, de: string) => de;

function Toggle({ checked, label }: { checked: boolean; label: string; onChange: (checked: boolean) => void; disabled?: boolean }) {
  return <label><input type="checkbox" aria-label={label} checked={checked} readOnly />{label}</label>;
}

const fields = (patch: Partial<PatientPepReviewFields> = {}): PatientPepReviewFields => ({
  pepContractPartner: false,
  pepBeneficialOwner: false,
  pepStatusChecked: false,
  pepReviews: {},
  ...patch,
});

const parent = {
  id: "11111111-1111-4111-8111-111111111111",
  slot: "rep1",
  role: "legal_representative",
  first_name: "Olga",
  last_name: "Testova",
  pep_self: false,
  pep_related: false,
  sanctions_links: false,
};

describe("pep review model", () => {
  it("keeps each person's own answers: the child's yes never shows on the parent", () => {
    const persons = pepPersons({
      fields: fields(),
      patientName: "Linda Testova",
      patientAnswers: { pep_self: true, pep_related: false, sanctions_links: true },
      representatives: [parent, { ...parent, id: "22222222-2222-4222-8222-222222222222", slot: null }],
      thirdPartyPayer: false,
      payerName: "",
      payerAnswers: null,
    });
    expect(persons.map((person) => person.kind)).toEqual(["patient", "representative"]);
    expect(pepAnswerValue(persons[0].answers)).toBe("yes");
    expect(persons[1].subject).toBe(representativePepSubject(parent.id));
    expect(pepAnswerValue(persons[1].answers)).toBe("no");
  });

  it("reads the patient's review from the form fields and others from pepReviews", () => {
    const stored = parsePepReviews({
      patient: { checkedOn: "2026-10-20", checkedBy: "Anna" },
      [representativePepSubject(parent.id)]: { checked: true, isPep: true, checkedOn: "2026-10-23", checkedBy: "Ben" },
      broken: "x",
    });
    expect(Object.keys(stored)).toEqual(["patient", representativePepSubject(parent.id)]);
    const form = fields({ pepStatusChecked: true, pepReviews: stored });
    expect(pepReviewOf(form, "patient")).toEqual({ checked: true, isPep: false, checkedOn: "2026-10-20", checkedBy: "Anna" });
    expect(pepReviewOf(form, representativePepSubject(parent.id)).isPep).toBe(true);
    expect(pepReviewOf(form, "payer")).toEqual({ checked: false, isPep: false, checkedOn: null, checkedBy: null });
    const next = withPepReview(stored, "payer", { checked: true });
    expect(next.payer).toEqual({ checked: true, isPep: false, checkedOn: null, checkedBy: null });
    expect(stored.payer).toBeUndefined();
  });
});

describe("LeadAmlPepReviews", () => {
  it("shows who answered what and staff's review per person", () => {
    const form = fields({
      pepReviews: { [representativePepSubject(parent.id)]: { checked: true, isPep: false, checkedOn: "2026-10-23", checkedBy: "Anna Prüferin" } },
    });
    const persons = pepPersons({
      fields: form,
      patientName: "Linda Testova",
      patientAnswers: { pep_self: true, pep_related: null, sanctions_links: null },
      representatives: [parent],
      thirdPartyPayer: true,
      payerName: "Beispiel GmbH",
      payerAnswers: null,
    });
    const html = renderToStaticMarkup(
      <LeadAmlPepReviews
        persons={persons}
        patient={form}
        disabled={false}
        tx={tx}
        Toggle={Toggle}
        onPatientChange={() => undefined}
        onReviewChange={() => undefined}
      />,
    );
    const starts = ["patient", "representative", "payer"].map((kind) => html.indexOf(`data-testid="lead-aml-pep-person-${kind}"`));
    const card = (kind: "patient" | "representative" | "payer") => {
      const index = ["patient", "representative", "payer"].indexOf(kind);
      return html.slice(starts[index], starts[index + 1] ?? html.length);
    };
    expect(card("patient")).toContain('data-value="yes"');
    expect(card("patient")).toContain('data-testid="lead-aml-pep-status-checked"');
    expect(card("patient")).toContain("noch nicht geprüft");
    expect(card("representative")).toContain("Olga Testova");
    expect(card("representative")).toContain('data-value="no"');
    expect(card("representative")).toContain("PEP-Status geprüft am 23.10.2026 von Anna Prüferin — Ergebnis: keine PeP");
    expect(card("payer")).toContain("Beispiel GmbH");
    expect(card("payer")).toContain("keine Angabe");
    expect(card("payer")).toContain("noch nicht geprüft");
  });
});
