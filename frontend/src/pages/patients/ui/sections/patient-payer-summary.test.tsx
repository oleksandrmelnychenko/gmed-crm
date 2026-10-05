import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { representativeSubject } from "@/pages/leads/model/lead-identification";

import {
  normalizePatientPayerSummary,
  type PatientPayerSummary,
} from "../../model/patient-payer-summary";
import { PatientPayerSummaryCardView, type PatientPayerSummaryState } from "./patient-payer-summary";

const PATIENT_ID = "00000000-0000-4000-8000-000000000001";
const LEAD_ID = "00000000-0000-4000-8000-000000000002";
const OPEN_LEAD_ID = "00000000-0000-4000-8000-000000000003";
const ANNA_CONTACT_ID = "11111111-1111-4111-8111-111111111111";
const BEN_CONTACT_ID = "22222222-2222-4222-8222-222222222222";
const ANNA_RELATION_ID = "33333333-3333-4333-8333-333333333333";
const BEN_RELATION_ID = "44444444-4444-4444-8444-444444444444";

const SIGNED = { signed_at: "2026-10-05T10:01:00Z", test_mode: false };
const CONFIRMED = { confirmed_at: "2026-10-06T08:00:00Z", confirmed_by_name: "Olek", note: null };

/** The full example of the contract: minor Mia, the parent Anna pays and is the default payer. */
function minorExample(): PatientPayerSummary {
  return normalizePatientPayerSummary({
    patient_id: PATIENT_ID,
    patient_is_minor: true,
    source: { lead_id: LEAD_ID, converted_at: "2026-10-06T09:12:00Z", declared_at: "2026-10-05T16:40:00Z" },
    declaration: {
      payer_kind: "third_party",
      payer_type: "person",
      name: "Anna Muster",
      first_name: "Anna",
      last_name: "Muster",
      relationship_kind: "parent",
      street: "Musterweg 1",
      zip: "10115",
      city: "Berlin",
      country: "DE",
      email: "anna.muster@example.com",
      phone: "+49 30 000000",
      contact_consent_at: "2026-10-05T16:40:00Z",
      payer_informed_at: "2026-10-05T17:00:00Z",
    },
    contracting_party: {
      kind: "legal_representatives",
      explicit: false,
      patient_id: PATIENT_ID,
      patient_name: "Mia Muster",
      patient_is_minor: true,
      debtor_name: "Anna Muster und Ben Muster",
      representatives: [
        { relation_id: ANNA_RELATION_ID, relation_type: "parent", name: "Anna Muster", email: "anna.muster@example.com", address: "Musterweg 1, 10115 Berlin, DE", is_default_payer: true },
        { relation_id: BEN_RELATION_ID, relation_type: "parent", name: "Ben Muster", email: "ben.muster@example.com", address: null, is_default_payer: false },
      ],
    },
    invoice_recipient: {
      source: "default_payer",
      role: "contracting_party",
      kind: "relation",
      name: "Anna Muster",
      street: "Musterweg 1",
      zip: "10115",
      city: "Berlin",
      country: "DE",
      email: "anna.muster@example.com",
      payer_patient_relation_id: ANNA_RELATION_ID,
      missing: [],
      minor_without_payer: false,
    },
    identification: {
      minor: true,
      contract_partner: { qes: null, own_account_payment: null },
      payer: { qes: SIGNED, own_account_payment: null, same_person_as: representativeSubject(ANNA_CONTACT_ID) },
      representatives: [
        { id: ANNA_CONTACT_ID, name: "Anna Muster", relation: "parent", has_email: true, qes: SIGNED, own_account_payment: CONFIRMED },
        { id: BEN_CONTACT_ID, name: "Ben Muster", relation: "parent", has_email: false, qes: null, own_account_payment: null },
      ],
    },
    open_request: null,
  })!;
}

function render(
  state: PatientPayerSummaryState,
  options: { lang?: "ru" | "de"; canOpenLead?: boolean } = {},
) {
  return renderToStaticMarkup(
    <PatientPayerSummaryCardView
      state={state}
      lang={options.lang ?? "ru"}
      canOpenLead={options.canOpenLead ?? true}
      onOpenLead={() => undefined}
      onRetry={() => undefined}
    />,
  );
}

/** The markup of one block of the card, found by its test id. */
function block(html: string, id: string, closing = "</div>"): string {
  const start = html.indexOf(`data-testid="patient-payer-summary-${id}"`);
  if (start < 0) return "";
  return html.slice(start, html.indexOf(closing, start));
}

describe("PatientPayerSummaryCardView", () => {
  it("renders nothing when the server refuses (403): no error for an unassigned patient manager", () => {
    expect(render({ status: "forbidden" })).toBe("");
  });

  it("shows a skeleton while loading", () => {
    const html = render({ status: "loading" });
    expect(html).toContain('data-testid="patient-payer-summary"');
    expect(html).toContain('data-state="loading"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("animate-pulse");
  });

  it("shows the error with a retry on any other failure", () => {
    const html = render({ status: "error" });
    expect(html).toContain('data-state="error"');
    expect(html).toContain('role="alert"');
    expect(html).toContain("Не удалось загрузить данные плательщика");
    expect(html).toMatch(/<button[^>]*>Повторить<\/button>/);
    const german = render({ status: "error" }, { lang: "de" });
    expect(german).toContain("Zahlerdaten konnten nicht geladen werden");
    expect(german).toMatch(/<button[^>]*>Erneut versuchen<\/button>/);
  });

  it("Billing: the projection without identification, in order, no lead link without leads.view", () => {
    const summary = { ...minorExample(), identification: null };
    const html = render({ status: "loaded", summary }, { canOpenLead: false });
    expect(html).toContain('data-state="loaded"');
    expect(html).toContain("Плательщик");
    expect(block(html, "who-pays")).toContain("Третье лицо — Частное лицо");
    expect(block(html, "name")).toContain("Anna Muster");
    expect(block(html, "relationship")).toContain("Родитель");
    expect(block(html, "address")).toContain("Musterweg 1, 10115 Berlin, Германия");
    expect(block(html, "contact")).toContain("anna.muster@example.com · +49 30 000000");
    expect(block(html, "contact-consent")).toContain("дано 05.10.2026");
    expect(block(html, "informed")).toContain("да, 05.10.2026");
    expect(block(html, "contracting-party", "</span></span></div>")).toContain("Законные представители: Anna Muster und Ben Muster");
    const recipient = block(html, "recipient", "</span></div>");
    expect(recipient).toContain("Anna Muster");
    expect(recipient).toContain("Musterweg 1, 10115 Berlin, Германия");
    expect(recipient).toContain("плательщик по умолчанию");
    expect(html).not.toContain('data-testid="patient-payer-summary-identification"');
    expect(html).not.toContain("Идентификация");
    // The order of the line groups.
    const order = ["who-pays", "name", "relationship", "address", "contact", "contact-consent", "informed", "contracting-party", "recipient", "footer"]
      .map((id) => html.indexOf(`data-testid="patient-payer-summary-${id}"`));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // The footer dates the conversion, without the link; the payer of orders and invoices is changed there.
    expect(block(html, "footer", "</div>")).toContain("Зафиксировано при конвертации обращения 06.10.2026");
    expect(html).not.toContain('data-testid="patient-payer-summary-open-lead"');
    expect(html).not.toContain("Открыть обращение");
    expect(html).toContain("Плательщика заказа или счёта меняют в заказе и в счёте");
  });

  it("minor with two representatives: each on a sub-line with the address, the paying parent badged, both identified", () => {
    const html = render({ status: "loaded", summary: minorExample() });
    const party = block(html, "contracting-party", "</span></span></div>");
    expect(party).toContain("Законные представители: Anna Muster und Ben Muster");
    expect(party.match(/data-testid="patient-payer-summary-representative"/g)).toHaveLength(2);
    expect(party).toContain("Musterweg 1, 10115 Berlin, DE");
    expect(party.match(/data-testid="patient-payer-summary-default-payer"/g)).toHaveLength(1);
    expect(party).toContain("плательщик по умолчанию");
    // The badge sits on Anna's sub-line, not on Ben's.
    const subLine = 'data-testid="patient-payer-summary-representative"';
    const anna = party.indexOf(subLine);
    const ben = party.indexOf(subLine, anna + 1);
    const badge = party.indexOf('data-testid="patient-payer-summary-default-payer"');
    expect(party.slice(anna, ben)).toContain("Anna Muster");
    expect(party.slice(ben)).toContain("Ben Muster");
    expect(anna).toBeLessThan(badge);
    expect(badge).toBeLessThan(ben);

    const identification = block(html, "identification", "</ul>");
    expect(identification).toContain("Идентификация");
    const annaLine = block(html, `identification-${representativeSubject(ANNA_CONTACT_ID)}`, "</li>");
    expect(annaLine).toContain("Anna Muster");
    expect(annaLine).toContain("родитель");
    expect(annaLine).toContain("Квалифицированная подпись · 05.10.2026");
    expect(annaLine).toContain('data-tone="success"');
    expect(annaLine).toContain("Платёж с собственного счёта подтверждён · 06.10.2026 · Olek");
    const benLine = block(html, `identification-${representativeSubject(BEN_CONTACT_ID)}`, "</li>");
    expect(benLine).toContain("Квалифицированной подписи ещё нет");
    expect(benLine).toContain('data-tone="neutral"');
    expect(benLine).toContain("Ожидается платёж с собственного счёта");
    expect(benLine).toContain('data-tone="warning"');
    expect(benLine).toContain("нет e-mail — подпись не засчитается");
    const payerLine = block(html, "identification-payer", "</li>");
    expect(payerLine).toContain("Плательщик — тот же человек, что и представитель Anna Muster");
    // With leads.view the request can be opened from the footer.
    expect(block(html, "footer", "</div></div>")).toContain('data-testid="patient-payer-summary-open-lead"');
    expect(html).toContain("Открыть обращение");
  });

  it("speaks German", () => {
    const html = render({ status: "loaded", summary: minorExample() }, { lang: "de" });
    expect(html).toContain("Zahler");
    expect(block(html, "who-pays")).toContain("Wer zahlt");
    expect(block(html, "who-pays")).toContain("Dritte/r — Privatperson");
    expect(block(html, "name")).toContain("Name / Organisation");
    expect(block(html, "relationship")).toContain("Verhältnis zum Patienten");
    expect(block(html, "relationship")).toContain("Elternteil");
    expect(block(html, "address")).toContain("Musterweg 1, 10115 Berlin, Deutschland");
    expect(block(html, "contact-consent")).toContain("Einwilligung zur Kontaktaufnahme");
    expect(block(html, "contact-consent")).toContain("erteilt am 05.10.2026");
    expect(block(html, "informed")).toContain("Zahler informiert (Art. 14 DSGVO)");
    expect(block(html, "informed")).toContain("ja, 05.10.2026");
    expect(html).toContain("Vertragspartei");
    expect(html).toContain("Gesetzliche Vertreter: Anna Muster und Ben Muster");
    expect(html).toContain("Standardzahler");
    expect(html).toContain("Rechnungsempfänger");
    expect(html).toContain("Identifizierung");
    expect(html).toContain("Qualifizierte Signatur · 05.10.2026");
    expect(html).toContain("Bei der Umwandlung der Anfrage am 06.10.2026 festgehalten");
    expect(html).toContain("Anfrage öffnen");
    expect(html).toContain("Der Zahler eines Auftrags oder einer Rechnung wird dort geändert");
  });

  it("self-payer adult: no third-party lines, the patient is party and recipient", () => {
    const summary = normalizePatientPayerSummary({
      patient_id: PATIENT_ID,
      source: { lead_id: LEAD_ID, converted_at: "2026-10-06T09:12:00Z" },
      declaration: { payer_kind: "self" },
      contracting_party: { kind: "patient", patient_name: "Anna Muster", debtor_name: "Anna Muster", representatives: [] },
      invoice_recipient: { source: "none", kind: "patient", name: "Anna Muster", street: "Musterweg 1", zip: "10115", city: "Berlin", country: "DE", missing: [] },
      identification: { minor: false, contract_partner: { qes: SIGNED, own_account_payment: null }, payer: null, representatives: [] },
    })!;
    const html = render({ status: "loaded", summary });
    expect(block(html, "who-pays")).toContain("Пациент сам");
    for (const id of ["name", "relationship", "address", "contact", "contact-consent", "informed"]) {
      expect(html).not.toContain(`data-testid="patient-payer-summary-${id}"`);
    }
    expect(block(html, "contracting-party", "</span></span></div>")).toContain("Пациент");
    expect(html).not.toContain('data-testid="patient-payer-summary-representative"');
    const recipient = block(html, "recipient", "</span></div>");
    expect(recipient).toContain("Anna Muster");
    expect(recipient).toContain("пациент");
    expect(block(html, "identification-contract_partner", "</li>")).toContain("Пациент");
    expect(html).not.toContain('data-testid="patient-payer-summary-identification-payer"');
  });

  it("never a lead: the first line says so, party and recipient stay, warnings in amber, no footer date", () => {
    const summary = normalizePatientPayerSummary({
      patient_id: PATIENT_ID,
      patient_is_minor: true,
      source: null,
      declaration: null,
      contracting_party: { kind: "legal_representatives", patient_name: "Mia Muster", patient_is_minor: true, debtor_name: "Mia Muster", representatives: [] },
      invoice_recipient: { source: "none", kind: "patient", name: "Mia Muster", street: null, zip: "10115", city: "Berlin", country: "DE", missing: ["street"], minor_without_payer: true },
      identification: null,
      open_request: null,
    })!;
    const html = render({ status: "loaded", summary });
    expect(block(html, "who-pays")).toContain("Декларация плательщика отсутствует (пациент создан без обращения)");
    expect(html).toContain('data-testid="patient-payer-summary-contracting-party"');
    expect(html).toContain('data-testid="patient-payer-summary-recipient"');
    expect(block(html, "recipient-address-warning", "</span>")).toContain("Адрес неполный: улица");
    expect(block(html, "recipient-address-warning", "</span>")).toContain("text-amber-700");
    expect(block(html, "recipient-minor-warning", "</span>")).toContain("Несовершеннолетний получит счёт — укажите плательщика");
    expect(html).not.toContain("Зафиксировано при конвертации");
    expect(html).not.toContain('data-testid="patient-payer-summary-open-lead"');
    expect(html).toContain("Плательщика заказа или счёта меняют в заказе и в счёте");
  });

  it("section 7: the invoice goes to another address, with the staff fields, after line 1", () => {
    const summary = normalizePatientPayerSummary({
      patient_id: PATIENT_ID,
      source: { lead_id: LEAD_ID, converted_at: "2026-10-06T09:12:00Z" },
      declaration: {
        payer_kind: "self",
        invoice_to: "other",
        invoice_name: "Beispiel GmbH",
        invoice_street: "Beispielstraße 2",
        invoice_zip: "10117",
        invoice_city: "Berlin",
        invoice_country: "DE",
        invoice_email: "rechnung@example.com",
        invoice_vat_id: "DE123456789",
        invoice_tax_number: "30/123/45678",
      },
      contracting_party: { kind: "patient", patient_name: "Anna Muster", debtor_name: "Anna Muster", representatives: [] },
      invoice_recipient: {
        source: "invoice_address",
        role: "invoice_address",
        kind: "contact",
        name: "Beispiel GmbH",
        street: "Beispielstraße 2",
        zip: "10117",
        city: "Berlin",
        country: "DE",
        email: "rechnung@example.com",
        missing: [],
      },
      identification: null,
    })!;
    const html = render({ status: "loaded", summary });
    const invoiceTo = block(html, "invoice-to", "</span></span></div>");
    expect(invoiceTo).toContain("Счёт направляется");
    expect(invoiceTo).toContain("по другому адресу");
    expect(invoiceTo).toContain("Beispiel GmbH");
    expect(invoiceTo).toContain("Beispielstraße 2, 10117 Berlin, Германия");
    expect(invoiceTo).toContain("rechnung@example.com");
    expect(block(html, "invoice-tax")).toContain("USt-IdNr. / Steuernummer");
    expect(block(html, "invoice-tax")).toContain("USt-IdNr. DE123456789 · Steuernummer 30/123/45678");
    const recipient = block(html, "recipient", "</span></div>");
    expect(recipient).toContain("Beispiel GmbH");
    expect(recipient).toContain("адрес для счетов по декларации");
    // Right after "who pays".
    const order = ["who-pays", "invoice-to", "invoice-tax", "contracting-party", "recipient"]
      .map((id) => html.indexOf(`data-testid="patient-payer-summary-${id}"`));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // The party at another address is no Kostenübernehmer: no such wording anywhere.
    expect(html).not.toMatch(/Kostenübernehm|плательщик по умолчанию|cost_bearer/);

    const german = render({ status: "loaded", summary }, { lang: "de" });
    expect(block(german, "invoice-to", "</span></span></div>")).toContain("Rechnung geht an");
    expect(block(german, "invoice-to", "</span></span></div>")).toContain("an eine andere Adresse");
    expect(block(german, "invoice-to", "</span></span></div>")).toContain("Beispielstraße 2, 10117 Berlin, Deutschland");
    expect(block(german, "recipient", "</span></div>")).toContain("Rechnungsanschrift laut Erklärung");
  });

  it("section 7: 'to me' with an e-mail, 'to the payer' without one, nothing on an older server", () => {
    const self = normalizePatientPayerSummary({
      patient_id: PATIENT_ID,
      declaration: { payer_kind: "self", invoice_to: "self", invoice_email: "anna.muster@example.com" },
    })!;
    const selfHtml = render({ status: "loaded", summary: self });
    expect(block(selfHtml, "invoice-to", "</span></span></div>")).toContain("пациенту");
    expect(block(selfHtml, "invoice-to", "</span></span></div>")).toContain("anna.muster@example.com");
    expect(selfHtml).not.toContain('data-testid="patient-payer-summary-invoice-tax"');

    const payer = normalizePatientPayerSummary({ ...minorExample(), declaration: { ...minorExample().declaration!, invoice_to: "payer" } })!;
    const payerHtml = render({ status: "loaded", summary: payer });
    expect(block(payerHtml, "invoice-to", "</span></span></div>")).toContain("плательщику");
    expect(block(payerHtml, "invoice-to", "</span></span></div>")).not.toContain("@");

    const older = render({ status: "loaded", summary: minorExample() });
    expect(older).not.toContain('data-testid="patient-payer-summary-invoice-to"');
    expect(older).not.toContain("Счёт направляется");
  });

  it("open request: the info line with the link to the new request", () => {
    const summary = { ...minorExample(), open_request: { lead_id: OPEN_LEAD_ID, has_declaration: true } };
    const html = render({ status: "loaded", summary });
    const info = block(html, "open-request", "</button></div>");
    expect(info).toContain("Открыто новое обращение — плательщик уточняется в нём");
    expect(info).toContain('data-testid="patient-payer-summary-open-lead"');
    expect(html.match(/data-testid="patient-payer-summary-open-lead"/g)).toHaveLength(2);
    // Billing sees the note without the link.
    const billing = render({ status: "loaded", summary: { ...summary, identification: null } }, { canOpenLead: false });
    expect(billing).toContain("Открыто новое обращение — плательщик уточняется в нём");
    expect(billing).not.toContain('data-testid="patient-payer-summary-open-lead"');
  });
});
