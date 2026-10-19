import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { LeadRequest, LeadRequestRepresentative } from "./lead-request-api";
import { RepresentationSection } from "./lead-request-representation";
import { leadRequestText } from "./lead-request-text";

const mother: LeadRequestRepresentative = {
  id: "rep-1",
  slot: "rep1",
  role: "legal_representative",
  relation: "mother",
  mine: true,
  email_locked: true,
  can_remove: false,
  first_name: "Anna",
  last_name: "Muster",
  date_of_birth: null,
  birth_place: null,
  birth_country: null,
  citizenships: [],
  street: null,
  zip: null,
  city: null,
  country: null,
  email: "anna.muster@example.com",
  phone: null,
  identity_documents: [],
  authority_documents: [],
};

function request(documentStage: boolean): LeadRequest {
  return {
    lead_id: "lead-1",
    access_kind: "guardian",
    minor: true,
    consents: {},
    progress: { missing_for_submit: [] },
    representation: {
      document_stage: documentStage,
      has_representative: null,
      under_guardianship: null,
      custody: "joint",
      custody_stated: true,
      representatives: [mother],
    },
  } as unknown as LeadRequest;
}

function render(documentStage: boolean) {
  return renderToStaticMarkup(
    <RepresentationSection
      request={request(documentStage)}
      childAddress={{ street_address: "", zip_code: "", city: "", country: "" }}
      text={leadRequestText("de")}
      lang="de"
      enqueue={(task) => task()}
      onChange={() => undefined}
      onSaveState={() => undefined}
      mode="base"
    />,
  );
}

describe("a minor's parent in the cabinet", () => {
  it("is asked for the identity document copy as soon as the person exists, before the document stage", () => {
    const html = render(false);
    expect(html).toContain("lead-request-rep1-identity-upload");
    // The rest of the document stage stays where it was: no date of birth yet.
    expect(html).not.toContain("lead-request-rep1_date_of_birth");
  });

  it("keeps the upload at the document stage with the whole form", () => {
    const html = render(true);
    expect(html).toContain("lead-request-rep1-identity-upload");
    expect(html).toContain("lead-request-rep1_date_of_birth");
  });

  it("is not asked for the second parent before the person exists", () => {
    const html = render(false);
    expect(html).not.toContain("lead-request-rep2-identity-upload");
  });
});
