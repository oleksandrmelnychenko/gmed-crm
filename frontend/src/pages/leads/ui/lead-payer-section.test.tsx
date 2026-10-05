import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

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

function renderSection(declaration: PayerDeclaration | null, translate: (ru: string, de: string) => string = tx) {
  return renderToStaticMarkup(
    <LeadPayerDeclarationSection
      leadId="lead-1"
      data={declaration === null ? null : { declaration, status: status({ complete: true, agency_blocking: [] }) }}
      loading={false}
      loadError={null}
      disabled={false}
      canEdit
      lang={translate === tx ? "ru" : "de"}
      tx={translate}
      onSave={async () => undefined}
      errorText={() => "error"}
    />,
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

describe("reload of the payer declaration on cabinet changes", () => {
  it("follows who pays and sections 7–8, nothing else", () => {
    expect(payerDeclarationChanged("payer")).toBe(true);
    expect(payerDeclarationChanged("billing")).toBe(true);
    expect(payerDeclarationChanged("identification")).toBe(false);
    expect(payerDeclarationChanged("representation")).toBe(false);
    expect(payerDeclarationChanged(undefined)).toBe(false);
  });
});
