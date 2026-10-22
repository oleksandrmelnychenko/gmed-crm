import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { normalizeLeadPortalEnhancedDetails, normalizeLeadPortalIntake, type LeadPortalEnhancedDetails, type LeadPortalIntake } from "../data/lead-portal-intake-api";
import { payerDeclarationChanged } from "../model/use-lead-payer-declaration";
import {
  chosenPayerRepresentative,
  payerDeclarationPayload,
  payerDeclarationToForm,
  payerFormMissing,
  payerKindOptions,
  payerReasonLabel,
  type PayerDeclaration,
  type PayerDeclarationStatus,
  type PayerRepresentative,
} from "../model/lead-payer";
import { LeadPayerDeclarationSection, LeadPayerSignatureFlow } from "./lead-payer-section";

const tx = (ru: string) => ru;
const de = (_ru: string, german: string) => german;
const signatureSummary = vi.hoisted(() => ({ value: undefined as import("@/pages/documents/data/use-signature-summary").SignatureSummary | undefined }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "synthetic-staff", role: "ceo" } }) }));
vi.mock("@/pages/documents/data/use-signature-summary", () => ({ useSignatureSummary: () => signatureSummary.value }));
beforeEach(() => { signatureSummary.value = undefined; });

const status = (patch: Partial<PayerDeclarationStatus> = {}): PayerDeclarationStatus => ({
  complete: false,
  missing: [],
  cost_assumption: { required: true, document_id: null, current: false, signed: false, signed_at: null },
  order_id: "order-1",
  order_number: "A-1",
  client_signed_order: true,
  agency_signed_order: false,
  agency_may_sign: false,
  agency_blocking: ["cost_assumption_missing"],
  aml_countries: [],
  ...patch,
});

function render(value: PayerDeclarationStatus) {
  return renderToStaticMarkup(
    <LeadPayerSignatureFlow
      leadId="lead-1"
      status={value}
      documents={[]}
      disabled={false}
      canGenerate
      tx={tx}
      renderDocuments={() => <div>documents</div>}
      onChanged={() => undefined}
      errorText={() => "error"}
    />,
  );
}

describe("LeadPayerSignatureFlow", () => {
  for (const lang of ["ru", "de"]) {
    it(`shows accepted DEV evidence without pretending the legal flags changed in ${lang}`, () => {
      signatureSummary.value = { document_id: "current-order", status: "completed", test_mode: true, result_document_id: "test-result" };
      const value = status({ client_signed_order: false, agency_blocking: ["client_order_signature_missing", "payer_identity_incomplete"],
        cost_assumption: { required: false, document_id: null, current: false, signed: false, signed_at: null } });
      const html = renderToStaticMarkup(<LeadPayerSignatureFlow leadId="synthetic-lead" signatureDocumentId="current-order" status={value}
        demoChecks={["order_signed_patient"]} documents={[]} disabled={false} canGenerate={false} tx={lang === "de" ? de : tx}
        renderDocuments={() => null} onChanged={() => {}} errorText={() => "error"} />);
      expect(html).toContain(lang === "ru" ? "Тестовые подписи зачтены для оформления" : "Testunterschriften für die Aufnahme angerechnet");
      expect(html).toContain(lang === "ru" ? "Заполните данные плательщика" : "Angaben zum Kostenübernehmer ergänzen");
      expect(html).not.toContain(lang === "ru" ? "Нужна юридически действительная подпись заказа" : "Eine rechtswirksame Auftragsunterschrift ist erforderlich");
      expect(value.client_signed_order).toBe(false);
    });
    it(`explains completed DEMO without asking the client to sign the same test again in ${lang}`, () => {
      signatureSummary.value = { document_id: "current-order", status: "completed", test_mode: true, result_document_id: "test-result" };
      const value = status({ client_signed_order: false, agency_blocking: ["client_order_signature_missing"],
        cost_assumption: { required: false, document_id: null, current: false, signed: false, signed_at: null } });
      const html = renderToStaticMarkup(<LeadPayerSignatureFlow leadId="synthetic-lead" signatureDocumentId="current-order" status={value}
        documents={[]} disabled={false} canGenerate={false} tx={lang === "de" ? de : tx} renderDocuments={() => null} onChanged={() => {}} errorText={() => "error"} />);
      expect(html).toContain(lang === "ru" ? "DEMO · Тестовый пакет подписан" : "DEMO · Testpaket unterzeichnet");
      expect(html).toContain(lang === "ru" ? "Для создания пациента нужны юридически действительные подписи" : "Für die Patientenanlage sind rechtswirksame Unterschriften erforderlich");
      expect(html).not.toContain(lang === "ru" ? "Ожидается подпись клиента" : "Unterschrift des Kunden ausstehend");
      expect(html).not.toContain(lang === "ru" ? "Сначала клиент подписывает заказ" : "Zuerst unterschreibt der Kunde");
      expect(html).not.toContain(lang === "ru" ? "Создайте согласие плательщика" : "Kostenübernahmeerklärung erstellen");
      expect(value.client_signed_order).toBe(false);
      expect(value.agency_may_sign).toBe(false);
    });
    it(`shows confirmed client DEMO progress without pretending it is a legal signature in ${lang}`, () => {
      signatureSummary.value = { document_id: "current-order", status: "pending", test_mode: true, result_document_id: null,
        progress: { signed: 1, total: 2, client_signed: 1, client_total: 1, agency_signed: 0, agency_total: 1 } };
      const value = status({ client_signed_order: false, agency_blocking: ["client_order_signature_missing"],
        cost_assumption: { required: false, document_id: null, current: false, signed: false, signed_at: null } });
      const html = renderToStaticMarkup(<LeadPayerSignatureFlow leadId="synthetic-lead" signatureDocumentId="current-order" status={value}
        documents={[]} disabled={false} canGenerate={false} tx={lang === "de" ? de : tx} renderDocuments={() => null} onChanged={() => {}} errorText={() => "error"} />);
      expect(html).toContain(lang === "ru" ? "Клиент подписал · ожидается GMED" : "Kunde hat unterschrieben · GMED steht aus");
      expect(html).toContain(lang === "ru" ? "DEMO не подтверждает юридическую подпись заказа" : "DEMO bestätigt keine rechtswirksame Auftragsunterschrift");
      expect(html).not.toContain(lang === "ru" ? "Ожидается подпись клиента" : "Unterschrift des Kunden ausstehend");
      expect(html).not.toContain(lang === "ru" ? "Сначала клиент подписывает заказ" : "Zuerst unterschreibt der Kunde");
      expect(value.client_signed_order).toBe(false);
      expect(value.agency_may_sign).toBe(false);
    });
    it(`does not claim unsigned parties have signed in ${lang}`, () => {
      const value = status({ client_signed_order: false,
        cost_assumption: { required: false, document_id: null, current: false, signed: false, signed_at: null },
        agency_blocking: ["client_order_signature_missing"] });
      const html = renderToStaticMarkup(<LeadPayerSignatureFlow leadId="synthetic-lead" status={value} documents={[]}
        disabled={false} canGenerate={false} tx={lang === "de" ? de : tx} renderDocuments={() => null} onChanged={() => {}} errorText={() => "error"} />);
      expect(html).toContain(lang === "ru" ? "Ожидается подпись клиента" : "Unterschrift des Kunden ausstehend");
      expect(html).toContain(lang === "ru" ? "Согласие плательщика не требуется" : "Kostenübernahmeerklärung nicht erforderlich");
      expect(html).toContain(lang === "ru" ? "GMED: подпись пока недоступна" : "GMED: Unterschrift noch gesperrt");
      expect(html).not.toContain(lang === "ru" ? "Клиент подписал" : "Kunde hat den Auftrag unterzeichnet");
      expect(html).not.toContain(lang === "ru" ? "Плательщик подписал" : "Kostenübernehmer hat unterschrieben");
    });
  }
  it("shows the signing order and why GMED waits", () => {
    const html = render(status());
    expect(html).toContain("Клиент подписал");
    expect(html).toContain("Ожидается согласие плательщика");
    expect(html).toContain("GMED: подпись пока недоступна");
    expect(html).toContain("Создайте согласие плательщика (Kostenübernahmeerklärung)");
    expect(html).toContain("Создать согласие плательщика");
  });

  it("marks the payer step as not required for a self-payer", () => {
    const html = render(status({
      cost_assumption: { required: false, document_id: null, current: false, signed: false, signed_at: null },
      agency_blocking: [],
      agency_signed_order: true,
    }));
    expect(html).toContain("не требуется");
    expect(html).toContain("GMED подписал");
    expect(html).not.toContain("Создать согласие плательщика");
  });
});

/** A self-payer on a server that stores sections 7–8; the lead chose "to me". */
const selfPayer: PayerDeclaration = {
  payer_kind: "self",
  acts_on_own_account: true,
  own_account_answered: true,
  beneficial_owner_name: null,
  beneficial_owner_note: null,
  source_of_funds: "savings",
  source_of_funds_description: null,
  source_of_funds_document_id: null,
  first_name: null,
  last_name: null,
  date_of_birth: null,
  place_of_birth: null,
  street: null,
  zip: null,
  city: null,
  country: null,
  citizenships: [],
  relationship: null,
  email: null,
  phone: null,
  payer_informed_at: null,
  payer_informed_by: null,
  payer_type: null,
  organisation_name: null,
  relationship_kind: null,
  contact_consent_at: null,
  invoice_to: "self",
  invoice_name: null,
  invoice_street: null,
  invoice_zip: null,
  invoice_city: null,
  invoice_country: null,
  invoice_email: "anna.muster@example.com",
  invoice_vat_id: "DE123456789",
  invoice_tax_number: null,
  updated_at: "2026-10-06T09:15:00Z",
};

/** The same self-payer on an older server: no section 7, no staff fields. */
const olderSelfPayer: PayerDeclaration = Object.fromEntries(
  Object.entries(selfPayer).filter(([key]) => !key.startsWith("invoice_")),
) as PayerDeclaration;

function renderSection(
  declaration: PayerDeclaration | null,
  translate: (ru: string, de: string) => string = tx,
  statusPatch: Partial<PayerDeclarationStatus> = {},
  portalIntake: LeadPortalIntake | null = null,
) {
  return renderToStaticMarkup(
    // A third party has a date of birth: the date field needs the pickers' adapter.
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <LeadPayerDeclarationSection
        leadId="lead-1"
        data={declaration === null ? null : { declaration, status: status({ complete: true, agency_blocking: [], ...statusPatch }) }}
        loading={false}
        loadError={null}
        disabled={false}
        canEdit
        lang={translate === tx ? "ru" : "de"}
        tx={translate}
        portalIntake={portalIntake}
        onSave={async () => undefined}
        errorText={() => "error"}
      />
    </LocalizationProvider>,
  );
}

/** The markup of the invoice recipient block, found by its test id. */
function recipientBlock(html: string): string {
  const start = html.indexOf('data-testid="lead-payer-invoice-recipient"');
  if (start < 0) return "";
  return html.slice(start, html.indexOf("</div></div>", start));
}

describe("LeadPayerDeclarationSection: invoice recipient (section 7)", () => {
  it("shows existing drafts without a manual save action or initial autosave status", () => {
    const html = renderSection(selfPayer);
    expect(html).not.toContain(">Сохранить<");
    expect(html).not.toContain("lead-payer-autosave-status");
    expect(html).not.toContain("lead-payer-autosave-error");
    expect(html).toContain("lead-payer-own-account");
    expect(html).toMatch(/type="radio"[^>]*checked=""|checked=""[^>]*type="radio"/);
  });

  it("shows the saved recipient address, e-mail and update time before saving a payer declaration", () => {
    const intake = normalizeLeadPortalIntake({
      lead_id: "lead-1", identification: {},
      billing: {
        invoice_recipient: "third_party", invoice_recipient_is_payer: false,
        recipient_updated_at: "2026-10-12T08:30:00Z",
        recipient: {
          type: "person", name: "Mia Muster", street: "Musterweg 4", zip: "10115", city: "Berlin", country: "DE",
          email: "mia@example.com", phone: "+49 30 5550100", relationship_kind: "friend",
        },
      },
    })!;
    const html = renderSection(null, tx, {}, intake);
    expect(html).toContain('data-testid="lead-payer-recipient-snapshot"');
    expect(html).toContain("Mia Muster");
    expect(html).toContain("Musterweg 4");
    expect(html).toContain("mia@example.com");
    expect(html).toContain('data-testid="lead-payer-recipient-updated"');
    expect(html).toContain("12.10.2026 10:30");
    expect(html).not.toMatch(/<input[^>]*value="mia@example.com"/);
    expect(html).not.toMatch(/<input[^>]*value="Musterweg 4"/);
  });

  it("shows the organisation mask and its cabinet provenance without adding editable fields", () => {
    const intake = normalizeLeadPortalIntake({
      lead_id: "lead-1", identification: {},
      patient_payer: { at: "2026-10-12T08:15:00Z", access_kind: null },
      payer_organisation: { legal_form: "GmbH", register_number: "HRB 55501", contact_name: "Ben Muster" },
    })!;
    const declaration: PayerDeclaration = {
      ...selfPayer, payer_kind: "third_party", payer_type: "organisation", organisation_name: "Beispiel GmbH",
    };
    const html = renderSection(declaration, de, {}, intake);
    expect(html).toContain('data-testid="lead-payer-organisation-cabinet"');
    expect(html).toContain("HRB 55501");
    expect(html).toContain("Ben Muster");
    expect(html).toContain("Rechtsform");
    expect(html).toContain("Registernummer");
    expect(html).toContain("vom Patienten · 12.10.2026 10:15");
    expect(html).not.toMatch(/<input[^>]*value="HRB 55501"/);
    expect(html).not.toMatch(/<input[^>]*value="Ben Muster"/);
  });

  it("does not show the new cabinet snapshots when identification is hidden", () => {
    const intake = normalizeLeadPortalIntake({
      lead_id: "lead-1", identification_hidden: true,
      payer_organisation: { legal_form: "GmbH", register_number: "HRB 55501", contact_name: "Ben Muster" },
      billing: {
        invoice_recipient: "third_party", invoice_recipient_is_payer: false,
        recipient_updated_at: "2026-10-12T08:30:00Z",
        recipient: { type: "person", name: "Mia Muster", email: "mia@example.com" },
      },
    })!;
    const declaration: PayerDeclaration = { ...selfPayer, payer_kind: "third_party", payer_type: "organisation" };
    const html = renderSection(declaration, tx, {}, intake);
    expect(html).not.toContain('data-testid="lead-payer-organisation-cabinet"');
    expect(html).not.toContain('data-testid="lead-payer-recipient-snapshot"');
    expect(html).not.toContain("mia@example.com");
    expect(html).not.toContain("HRB 55501");
  });

  it("keeps the recipient details and staff inputs without the redundant routing sentence", () => {
    const html = renderSection(selfPayer);
    const block = recipientBlock(html);
    expect(block).toContain("Получатель счёта (из кабинета)");
    expect(block).not.toContain("Счёт направляется: ");
    expect(block).not.toContain("выбрал пациент в кабинете");
    expect(block).toContain("USt-IdNr. получателя счёта");
    expect(block).toContain("Steuernummer получателя счёта");
    expect(block).toMatch(/<input[^>]*value="DE123456789"/);
    expect(block.match(/<input\b/g)).toHaveLength(2);
    // Nothing of the lead's choice can be edited.
    expect(block).not.toMatch(/<(select|input[^>]*type="radio")/);
  });

  it("keeps the other recipient's name without the routing sentence or unanswered placeholder", () => {
    const other = renderSection({ ...selfPayer, invoice_to: "other", invoice_name: "Beispiel GmbH" });
    expect(recipientBlock(other)).toContain("Beispiel GmbH");
    expect(recipientBlock(other)).not.toContain("Счёт направляется");
    const open = renderSection({ ...selfPayer, invoice_to: null });
    expect(recipientBlock(open)).not.toContain("выбирает пациент в кабинете");
  });

  it("offers neither the line nor the inputs on an older server", () => {
    expect(olderSelfPayer).not.toHaveProperty("invoice_to");
    const html = renderSection(olderSelfPayer);
    expect(html).not.toContain("lead-payer-invoice-recipient");
    expect(html).not.toContain("Счёт направляется");
    expect(html).not.toContain("USt-IdNr.");
  });

  it("offers the inputs, without the line, while no declaration exists yet", () => {
    const html = renderSection(null);
    const block = recipientBlock(html);
    expect(block).toContain("USt-IdNr. получателя счёта");
    expect(block).not.toContain("Счёт направляется");
  });

  it("speaks German", () => {
    const block = recipientBlock(renderSection({ ...selfPayer, invoice_to: "payer" }, de));
    expect(block).toContain("Rechnungsempfänger (aus dem Portal)");
    expect(block).not.toContain("Rechnung geht an: ");
    expect(block).not.toContain("vom Patienten im Portal gewählt");
    expect(block).toContain("USt-IdNr. des Rechnungsempfängers");
    expect(block).toContain("Steuernummer des Rechnungsempfängers");
  });
});

describe("LeadPayerDeclarationSection: badge and contact consent", () => {
  /** A parent of a minor who pays and holds a cabinet login. */
  const payingParent: PayerDeclaration = {
    ...selfPayer,
    payer_kind: "third_party",
    payer_type: "person",
    first_name: "Anna",
    last_name: "Muster",
    relationship_kind: "parent",
    contact_consent_at: null,
  };

  /** The markup of the consent line. */
  const consentLine = (html: string) => {
    const start = html.indexOf('data-testid="lead-payer-contact-consent"');
    return start < 0 ? "" : html.slice(start, html.indexOf("</p>", start));
  };

  it("needs no consent to pass the contact on when a parent with a login pays", () => {
    const html = renderSection(payingParent, tx, { contact_consent_required: false });
    expect(consentLine(html)).toContain("Согласие на передачу контактов: не требуется (платит родитель)");
    expect(consentLine(html)).not.toContain("ещё не дано");
    expect(consentLine(renderSection(payingParent, de, { contact_consent_required: false }))).toContain(
      "Einwilligung zur Kontaktweitergabe: nicht nötig (Elternteil zahlt)",
    );
    // Any other payer, and an older server without the key: as before.
    expect(consentLine(renderSection(payingParent, tx, { contact_consent_required: true }))).toContain("ещё не дано");
    expect(consentLine(renderSection(payingParent))).toContain("ещё не дано");
  });

  it("says the section waits for the Kostenübernahmeerklärung when nothing else is missing", () => {
    const badge = (html: string) => {
      const start = html.indexOf('data-testid="lead-payer-status-badge"');
      return html.slice(start, html.indexOf("</span></span>", start));
    };
    const waiting = renderSection(payingParent, tx, { complete: false, missing: ["cost_assumption_missing"] });
    expect(badge(waiting)).toContain("ждёт Kostenübernahmeerklärung");
    expect(badge(renderSection(payingParent, de, { complete: false, missing: ["cost_assumption_missing"] }))).toContain(
      "wartet auf Kostenübernahmeerklärung",
    );
    expect(badge(renderSection(payingParent, tx, { complete: false, missing: ["payer_not_informed"] }))).toContain(
      "Не заполнено",
    );
    expect(badge(renderSection(payingParent))).toContain("Заполнено");
  });
});

describe("LeadPayerDeclarationSection: the self-payer's source of funds from the cabinet's extra step", () => {
  /** The lead chose "other" with words in the cabinet; staff chose nothing. */
  const stated: PayerDeclaration = {
    ...selfPayer,
    source_of_funds: null,
    self_funds_source: "other",
    self_funds_description: "Stipendium der Stiftung",
  };
  const proof = { id: "doc-9", file_name: "kontoauszug.pdf", uploaded_at: "2026-10-07T08:00:00Z", reviewed: true };
  const details = (patch: Record<string, unknown> = {}, answers: Record<string, unknown> = {}): LeadPortalEnhancedDetails =>
    normalizeLeadPortalEnhancedDetails({
      required: true,
      check_required: false,
      asks: { funds: true, funds_proof: false, occupation: false, sector: false },
      answers: { funds_source: "other", funds_description: "Stipendium der Stiftung", ...answers },
      funds_proof_documents: [proof],
      updated_at: "2026-10-07T08:05:00Z",
      ...patch,
    })!;

  function renderWithDetails(
    declaration: PayerDeclaration,
    enhancedDetails: LeadPortalEnhancedDetails | null,
    translate: (ru: string, de: string) => string = tx,
  ) {
    return renderToStaticMarkup(
      <LocalizationProvider dateAdapter={AdapterDayjs}>
        <LeadPayerDeclarationSection
          leadId="lead-1"
          data={{ declaration, status: status({ complete: true, agency_blocking: [] }) }}
          loading={false}
          loadError={null}
          disabled={false}
          canEdit
          lang={translate === tx ? "ru" : "de"}
          tx={translate}
          onSave={async () => undefined}
          errorText={() => "error"}
          enhancedDetails={enhancedDetails}
        />
      </LocalizationProvider>,
    );
  }

  /** The markup of the read-only block. */
  function block(html: string): string {
    const start = html.indexOf('data-testid="lead-payer-self-funds"');
    if (start < 0) return "";
    return html.slice(start, html.indexOf('data-testid="lead-payer-invoice-recipient"', start));
  }

  it("shows the lead's choice, the words and the proof read-only", () => {
    const html = renderWithDetails(stated, details());
    const shown = block(html);
    expect(shown).toContain("Источник средств — указал пациент в кабинете");
    expect(shown).toContain("Другое");
    expect(shown).toContain("Stipendium der Stiftung");
    expect(shown).toContain("Подтверждение · необязательно");
    expect(shown).toContain("kontoauszug.pdf · 07.10.2026 · просмотрен");
    // Nothing of it is an input.
    expect(shown).not.toMatch(/<(input|select|textarea)\b/);
    const german = block(
      renderWithDetails(stated, details({ asks: { funds: true, funds_proof: true }, funds_proof_documents: [] }, { funds_source: "income" }), de),
    );
    expect(german).toContain("Herkunft der Mittel – Angaben des Patienten im Portal");
    expect(german).toContain("Einkommen");
    expect(german).toContain("Nachweis · erforderlich (verstärkte Prüfung)");
    expect(german).toContain("nicht hochgeladen");
  });

  it("does not ask staff for a source of their own once the lead stated it", () => {
    const html = renderWithDetails(stated, details());
    const select = html.slice(0, html.indexOf('aria-label="Источник средств"'));
    const label = select.slice(select.lastIndexOf("<label"));
    expect(label).not.toContain("text-destructive");
    const open = renderWithDetails({ ...stated, self_funds_source: null }, details({}, { funds_source: null }));
    const openSelect = open.slice(0, open.indexOf('aria-label="Источник средств"'));
    expect(openSelect.slice(openSelect.lastIndexOf("<label"))).toContain("text-destructive");
  });

  it("shows the answers without files while the portal state is not loaded, and nothing for a third party", () => {
    const withoutIntake = block(renderWithDetails(stated, null));
    expect(withoutIntake).toContain("Другое");
    expect(withoutIntake).not.toContain("lead-payer-self-funds-proof");
    const thirdParty = renderWithDetails({ ...stated, payer_kind: "third_party", self_funds_source: null }, details());
    expect(thirdParty).not.toContain('data-testid="lead-payer-self-funds"');
    // Nothing stated and no proof asked: no block, no "not stated yet" label (owner 2026-10-19).
    const empty = renderWithDetails({ ...stated, self_funds_source: null, self_funds_description: null }, details({ funds_proof_documents: [] }, { funds_source: null, funds_description: null }));
    expect(empty).not.toContain('data-testid="lead-payer-self-funds"');
    expect(empty).not.toContain("ещё не указаны");
    // An older server knows nothing of it.
    expect(renderSection(selfPayer)).not.toContain('data-testid="lead-payer-self-funds"');
  });
});

describe("LeadPayerDeclarationSection: messenger / WhatsApp of a third party", () => {
  const person: PayerDeclaration = {
    ...selfPayer,
    payer_kind: "third_party",
    payer_type: "person",
    first_name: "Viktor",
    last_name: "Zahler",
    date_of_birth: "1970-03-02",
    citizenships: ["AT"],
    relationship_kind: "sibling",
    email: "viktor.zahler@example.com",
    phone: "+43 660 0000000",
    messenger: "+43 660 1111111",
  };

  it("is an input for editors, beside a sibling as the payer", () => {
    const html = renderSection(person);
    expect(html).toContain("WhatsApp / мессенджер");
    expect(html).toMatch(/name="payer_messenger"[^>]*value="\+43 660 1111111"|value="\+43 660 1111111"[^>]*name="payer_messenger"/);
    expect(html).toContain("Брат / сестра");
  });

  it("is a read-only line for a role that may not edit, and absent on an older server", () => {
    const readOnly = renderToStaticMarkup(
      <LocalizationProvider dateAdapter={AdapterDayjs}>
        <LeadPayerDeclarationSection
          leadId="lead-1"
          data={{ declaration: person, status: status({ complete: true, agency_blocking: [] }) }}
          loading={false}
          loadError={null}
          disabled={false}
          canEdit={false}
          lang="de"
          tx={de}
          onSave={async () => undefined}
          errorText={() => "error"}
        />
      </LocalizationProvider>,
    );
    expect(readOnly).toContain('data-testid="lead-payer-messenger"');
    expect(readOnly).toContain("WhatsApp / Messenger");
    expect(readOnly).toContain("+43 660 1111111");
    const older: PayerDeclaration = { ...person };
    delete older.messenger;
    expect(renderSection(older)).not.toContain("payer_messenger");
  });
});

describe("reload of the payer declaration on cabinet changes", () => {
  it("follows who pays, sections 7–8 and the extra step's answers, nothing else", () => {
    expect(payerDeclarationChanged("payer")).toBe(true);
    expect(payerDeclarationChanged("billing")).toBe(true);
    expect(payerDeclarationChanged("enhanced_details")).toBe(true);
    expect(payerDeclarationChanged("self_funds")).toBe(false);
    expect(payerDeclarationChanged("identification")).toBe(false);
    expect(payerDeclarationChanged("representation")).toBe(false);
    expect(payerDeclarationChanged(undefined)).toBe(false);
  });
});

describe("LeadPayerDeclarationSection: a minor's parent or legal representative pays (2026-10-19)", () => {
  const anna: PayerRepresentative = {
    id: "rep-anna",
    slot: "rep1",
    relation: "mother",
    guardian: false,
    name: "Anna Muster",
    first_name: "Anna",
    last_name: "Muster",
    date_of_birth: "1985-03-02",
    street: "Musterweg 1",
    zip: "10115",
    city: "Berlin",
    country: "DE",
    citizenships: ["DE", "UA"],
    email: "anna@example.com",
    phone: null,
  };
  const ben: PayerRepresentative = { ...anna, id: "rep-ben", slot: "rep2", relation: "father", name: "Ben Muster", first_name: "Ben" };
  const representativePays: PayerDeclaration = {
    ...selfPayer,
    payer_kind: "representative",
    payer_representative_id: "rep-anna",
  };
  const minorStatus = { minor: true, representatives: [anna, ben], payer_representative: anna, cost_assumption: { required: false, document_id: null, current: false, signed: false, signed_at: null } };

  it("offers the parent and a third party for a minor, never the patient", () => {
    const html = renderSection(representativePays, tx, minorStatus);
    expect(html).toContain("Платит родитель / законный представитель");
    expect(html).toContain("Платит третье лицо");
    expect(html).not.toContain("Пациент платит сам");
    expect(html).toContain('checked="" value="representative"');
    // The parent chosen among the minor's representatives, by name.
    const select = html.slice(html.indexOf('data-testid="lead-payer-representative"'));
    expect(select).toContain('aria-label="Кто из родителей / представителей платит"');
    expect(select).toContain('value="rep-anna"');
    const german = renderSection(representativePays, de, minorStatus);
    expect(german).toContain("Ein Elternteil / gesetzlicher Vertreter zahlt");
    // An adult keeps "the patient pays".
    expect(renderSection(selfPayer)).toContain("Пациент платит сам");
  });

  it("shows the paying parent read-only with the data of the representative block", () => {
    const html = renderSection(representativePays, tx, minorStatus);
    const start = html.indexOf('data-testid="lead-payer-representative-card"');
    expect(start).toBeGreaterThan(-1);
    const card = html.slice(start);
    expect(card).toContain("Anna Muster");
    expect(card).toContain("02.03.1985");
    expect(card).toContain("Musterweg 1");
    expect(card).toContain("10115");
    expect(card).toContain("Berlin");
    expect(card).toContain("блоке законных представителей");
    // No third-party form, no "paying parent" note of the old third-party rows.
    expect(html).not.toContain("Плательщик (третье лицо)");
    expect(html).not.toContain('data-testid="lead-payer-paying-parent"');
  });

  it("names the representative by id only in the save body", () => {
    const form = { ...payerDeclarationToForm(representativePays), firstName: "Typed" };
    const body = payerDeclarationPayload(form);
    expect(body.payer_kind).toBe("representative");
    expect(body.payer_representative_id).toBe("rep-anna");
    expect(body.first_name).toBeNull();
    expect(body.street).toBeNull();
    // Not "the third party's details": the parent is to be chosen.
    expect(payerFormMissing({ ...form, representativeId: "" })).toEqual(["payer_representative_missing"]);
    expect(payerReasonLabel("payer_representative_missing", tx)).toBe("Выберите, кто из родителей / законных представителей платит");
    expect(payerReasonLabel("payer_representative_missing", de)).not.toContain("Kostenübernehmer");
    // Without a trigger the source of funds is not asked (2026-10-19).
    expect(payerFormMissing({ ...form, sourceOfFunds: "" }, false)).not.toContain("payer_source_of_funds_missing");
    expect(chosenPayerRepresentative({ kind: "representative", representativeId: "rep-ben" }, minorStatus)?.name).toBe("Ben Muster");
    expect(payerKindOptions(true, "self", tx).map(([kind]) => kind)).toEqual(["representative", "third_party", "self"]);
  });

  it("a third-party row of before that names a parent: no third party's title, information or consents", () => {
    const parentRow: PayerDeclaration = {
      ...selfPayer,
      payer_kind: "third_party",
      payer_type: "person",
      first_name: "Anna",
      last_name: "Muster",
      date_of_birth: "1985-03-02",
      street: "Musterweg 1",
      zip: "10115",
      city: "Berlin",
      country: "DE",
      citizenships: ["DE"],
      payer_informed_at: null,
    };
    const html = renderSection(parentRow, tx, { minor: true, paying_parent: true, cost_assumption: { required: false, document_id: null, current: false, signed: false, signed_at: null } });
    expect(html).toContain('data-testid="lead-payer-paying-parent"');
    expect(html).toContain("Плательщик — родитель / законный представитель");
    expect(html).not.toContain("Плательщик (третье лицо)");
    expect(html).not.toContain("Плательщик проинформирован об обработке его данных");
    expect(html).not.toContain('data-testid="lead-payer-contact-consent"');
    expect(payerFormMissing(payerDeclarationToForm(parentRow), true, true)).not.toContain("payer_not_informed");
    expect(payerFormMissing(payerDeclarationToForm(parentRow), true, false)).toContain("payer_not_informed");
  });
});

