import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { LeadRequest, LeadRequestRepresentative } from "./lead-request-api";
import { RepresentationSection } from "./lead-request-representation";
import { OtherParentDocumentSection, OwnRepresentativeDocumentSection } from "./lead-request-step-forms";
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

function renderDocumentStep(representatives: LeadRequestRepresentative[], documentStage = false) {
  const props = {
    request: { ...request(documentStage), representation: { ...request(documentStage).representation!, representatives } },
    text: leadRequestText("ru"),
    lang: "ru",
    enqueue: ((task: () => Promise<unknown>) => task()) as never,
    onChange: () => undefined,
  };
  return renderToStaticMarkup(
    <>
      <OwnRepresentativeDocumentSection {...props} />
      <OtherParentDocumentSection {...props} />
    </>,
  );
}

const father: LeadRequestRepresentative = { ...mother, id: "rep-2", slot: "rep2", mine: false, email_locked: false, first_name: "Ben" };

describe("a minor's parent in the cabinet", () => {
  // The parents' identity copies are uploaded on step "Document", where its missing list points (QA 2026-10-22).
  it("uploads no identity copy in the person's form of step 1", () => {
    const html = render(false);
    expect(html).not.toContain("lead-request-rep1-identity-upload");
    // The rest of the document stage stays where it was: no date of birth yet.
    expect(html).not.toContain("lead-request-rep1_date_of_birth");
  });

  it("keeps the whole form at the document stage, the upload still on step Document", () => {
    const html = render(true);
    expect(html).not.toContain("lead-request-rep1-identity-upload");
    expect(html).toContain("lead-request-rep1_date_of_birth");
  });

  it("offers the own and the other parent's copy on step Document", () => {
    const html = renderDocumentStep([mother, father]);
    expect(html).toContain("lead-request-rep1-identity-upload");
    expect(html).toContain("lead-request-rep2-identity-upload");
    expect(html).toContain("Документ второго родителя (Ben Muster)");
  });

  it("points to step 1 while the other parent is not named yet", () => {
    const html = renderDocumentStep([mother]);
    expect(html).toContain("lead-request-rep1-identity-upload");
    expect(html).not.toContain("lead-request-rep2-identity-upload");
    expect(html).toContain("lead-request-other-parent-document-needs-person");
  });
});
