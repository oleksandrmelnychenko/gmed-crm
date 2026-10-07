import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { normalizeLeadPortalEnhancedDetails, type LeadPortalEnhancedDetails } from "../data/lead-portal-intake-api";
import { payerDeclarationChanged } from "../model/use-lead-payer-declaration";
import type { PayerDeclaration, PayerDeclarationStatus } from "../model/lead-payer";
import { LeadPayerDeclarationSection, LeadPayerSignatureFlow } from "./lead-payer-section";

const tx = (ru: string) => ru;
const de = (_ru: string, german: string) => german;

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
  it("shows the signing order and why GMED waits", () => {
    const html = render(status());
    expect(html).toContain("Клиент подписал");
    expect(html).toContain("Плательщик подписал согласие");
    expect(html).toContain("GMED подписывает");
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
  it("shows where the invoice goes, read-only, and the two staff inputs with the stored values", () => {
    const html = renderSection(selfPayer);
    const block = recipientBlock(html);
    expect(block).toContain("Получатель счёта (раздел 7 анкеты)");
    expect(block).toContain("Счёт направляется: ");
    expect(block).toContain("пациенту");
    expect(block).toContain("выбрал пациент в кабинете");
    expect(block).toContain("USt-IdNr. получателя счёта");
    expect(block).toContain("Steuernummer получателя счёта");
    expect(block).toMatch(/<input[^>]*value="DE123456789"/);
    expect(block.match(/<input\b/g)).toHaveLength(2);
    // Nothing of the lead's choice can be edited.
    expect(block).not.toMatch(/<(select|input[^>]*type="radio")/);
  });

  it("names the other address the lead gave and says so while nothing is chosen yet", () => {
    const other = renderSection({ ...selfPayer, invoice_to: "other", invoice_name: "Beispiel GmbH" });
    expect(recipientBlock(other)).toContain("по другому адресу");
    expect(recipientBlock(other)).toContain(" — Beispiel GmbH");
    const open = renderSection({ ...selfPayer, invoice_to: null });
    expect(recipientBlock(open)).toContain("не указано");
    expect(recipientBlock(open)).toContain("выбирает пациент в кабинете");
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
    expect(block).toContain("Rechnungsempfänger (Abschnitt 7)");
    expect(block).toContain("Rechnung geht an: ");
    expect(block).toContain("an die zahlende Person / Organisation");
    expect(block).toContain("vom Patienten im Portal gewählt");
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

