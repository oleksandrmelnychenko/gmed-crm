import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { LeadRequest, LeadRequestRepresentative } from "./lead-request-api";
import { CabinetGoToContext } from "./lead-request-parts";
import { PayerMissingLists } from "./lead-request-payer-questionnaire";
import { payerMissingParts } from "./lead-request-payer-questionnaire-model";
import { IdentityStep, type StepNav } from "./lead-request-step-forms";
import { leadRequestText, submitFieldLabel } from "./lead-request-text";

// Owner report 2026-10-21: a parent uploaded "my passport and my child's" on step
// "Document" — only the child's copy existed there, so only that one arrived.

const document = (id: string, name: string) => ({
  id,
  file_name: name,
  mime_type: "image/jpeg",
  size_bytes: 1024,
  uploaded_at: "2026-10-21T08:00:00Z",
  uploaded_by_me: true,
  reviewed: false,
  can_delete: true,
});

const mother: LeadRequestRepresentative = {
  id: "rep-1",
  slot: "rep1",
  role: "legal_representative",
  relation: "mother",
  mine: true,
  email_locked: true,
  can_remove: false,
  first_name: "Anna",
  last_name: "Testova",
  date_of_birth: null,
  birth_place: null,
  birth_country: null,
  citizenships: [],
  street: null,
  zip: null,
  city: null,
  country: null,
  email: "anna.testova@example.com",
  phone: null,
  identity_documents: [document("doc-mother", "pass-mutter.jpg")],
  authority_documents: [],
};

function request(options: { guardian: boolean; minor: boolean; representatives?: LeadRequestRepresentative[] }): LeadRequest {
  return {
    lead_id: "lead-1",
    access_kind: options.guardian ? "guardian" : "self",
    minor: options.minor,
    consents: { lead_inquiry_processing: { type: "lead_inquiry_processing", version: "1", texts: {}, given_at: "2026-10-21T07:00:00Z" } },
    progress: { missing_for_submit: [] },
    identification: {},
    identity_documents: [document("doc-child", "pass-kind.jpg")],
    documents: [],
    max_documents: 30,
    representation: options.minor
      ? {
          document_stage: false,
          has_representative: null,
          under_guardianship: null,
          custody: "joint",
          custody_stated: true,
          representatives: options.representatives ?? [],
        }
      : { has_representative: false, under_guardianship: null, custody: null, custody_stated: false, representatives: [] },
  } as unknown as LeadRequest;
}

const nav: StepNav = { index: 2, total: 5, onBack: () => undefined, onNext: () => undefined, missingShown: false, onShowMissing: () => undefined };

function render(lead: LeadRequest, lang: "de" | "ru" = "ru") {
  return renderToStaticMarkup(
    <CabinetGoToContext.Provider value={() => undefined}>
      <IdentityStep
        request={lead}
        text={leadRequestText(lang)}
        lang={lang}
        enqueue={(task) => task()}
        onChange={() => undefined}
        missing={[]}
        nav={nav}
      />
    </CabinetGoToContext.Provider>,
  );
}

describe("step \"Document\" in a parent's login for a minor", () => {
  it("shows the child's document and the parent's own, each with its uploaded files", () => {
    const html = render(request({ guardian: true, minor: true, representatives: [mother] }));
    expect(html).toContain("Документ ребёнка");
    expect(html).toContain("Ваш документ (родитель / законный представитель)");
    // The child's copy: the lead's own upload.
    expect(html).toContain("lead-request-identity-upload");
    expect(html).toContain("pass-kind.jpg");
    // The parent's copy: the same upload as in the representative's block.
    expect(html).toContain("lead-request-rep1-identity-upload");
    expect(html).toContain("pass-mutter.jpg");
    expect(html).not.toContain("lead-request-own-document-needs-person");
  });

  it("names both blocks in every language", () => {
    for (const lang of ["de", "ru", "uk", "en"] as const) {
      const text = leadRequestText(lang);
      expect(text.childDocumentTitle, lang).toBeTruthy();
      expect(text.ownRepresentativeDocumentTitle, lang).toBeTruthy();
      expect(text.ownRepresentativeDocumentTitle, lang).not.toBe(text.childDocumentTitle);
    }
    expect(leadRequestText("de").childDocumentTitle).toBe("Ausweisdokument des Kindes");
    expect(render(request({ guardian: true, minor: true, representatives: [mother] }), "de")).toContain("Ihr Ausweisdokument (Elternteil / gesetzlicher Vertreter)");
  });

  it("without the parent as a representative yet: a hint with the way to that section", () => {
    const other = { ...mother, id: "rep-2", slot: "rep2" as const, mine: false };
    const html = render(request({ guardian: true, minor: true, representatives: [other] }));
    expect(html).toContain("lead-request-own-document-needs-person");
    expect(html).toContain("Чтобы загрузить свой документ, сначала укажите свои данные в разделе «Законные представители».");
    expect(html).toContain('data-testid="lead-request-own-document-go"');
    expect(html).toContain('data-target-step="person"');
    expect(html).toContain('data-target-anchor="lead-request-section-representatives"');
    // The other parent's files are not offered as the viewer's own.
    expect(html).not.toContain("lead-request-rep2-identity-upload");
  });

  it("an adult's own view is unchanged: one document, no parent block", () => {
    const html = render(request({ guardian: false, minor: false }));
    expect(html).toContain("lead-request-identity-upload");
    expect(html).not.toContain("lead-request-own-document");
    expect(html).toContain(leadRequestText("ru").sectionIdentity);
    expect(html).not.toContain("Документ ребёнка");
  });
});

describe("a box that names another section", () => {
  it("carries a button to that section", () => {
    const text = leadRequestText("ru");
    const html = renderToStaticMarkup(
      <CabinetGoToContext.Provider value={() => undefined}>
        <PayerMissingLists
          request={{ follow_up: undefined, submitted_at: null } as unknown as LeadRequest}
          text={text}
          parts={payerMissingParts(["occupation", "id_document_upload", "relationship_kind", "payment_method"])}
        />
      </CabinetGoToContext.Provider>,
    );
    expect(html).toContain("Пожалуйста, дополните в разделе «Законные представители»:");
    expect(html).toContain("Ваш документ (родитель / законный представитель)");
    expect(html).toContain("Перейти к разделу «Законные представители»");
    expect(html).toContain('data-testid="lead-request-payer-missing-representatives-go"');
    expect(html).toContain('data-testid="lead-request-payer-missing-payer-go"');
    expect(html).toContain('data-testid="lead-request-payer-missing-payment-route-go"');
    // The own questions are answered right here: no button.
    expect(html).not.toContain("lead-request-payer-missing-own-go");
  });

  it("shows no button where the cabinet page does not navigate", () => {
    const html = renderToStaticMarkup(
      <PayerMissingLists
        request={{ follow_up: undefined, submitted_at: null } as unknown as LeadRequest}
        text={leadRequestText("ru")}
        parts={payerMissingParts(["id_document_upload"])}
      />,
    );
    expect(html).toContain("lead-request-payer-missing-representatives");
    expect(html).not.toContain("-go\"");
  });
});

describe("the missing lists and the summary name the child's document alike", () => {
  it("names the copy as the child's for a minor and as before for an adult", () => {
    const ru = leadRequestText("ru");
    expect(submitFieldLabel(ru, "id_document_upload", true, null, true)).toBe(ru.childIdentityFiles);
    expect(submitFieldLabel(ru, "id_document_upload")).toBe(`${ru.sectionIdentity}: ${ru.identityFiles}`);
  });
});
