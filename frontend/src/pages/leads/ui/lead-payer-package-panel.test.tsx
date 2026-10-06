import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { normalizeLeadPayerPackageState, type LeadPayerPackageState } from "../data/lead-payer-package-api";
import { LeadPayerPackagePanel } from "./lead-payer-package-panel";
import { LeadPayerSignatureFlow } from "./lead-payer-section";

const ru = (text: string) => text;
const de = (_ru: string, text: string) => text;

const controller = { prepare: async () => null, send: async () => null };

const documents = [
  { slot: "self_disclosure", document_id: "doc-1", title: "Selbstauskunft der zahlenden Person", version: 1, signed_at: null },
  { slot: "cost_coverage", document_id: "doc-2", title: "Kostenübernahmeerklärung", version: 2, signed_at: null },
  { slot: "patient_statement", document_id: "doc-3", title: "Erklärung zur Kostenübernahme durch Dritte", version: 1, signed_at: null },
  { slot: "cost_estimate", document_id: "doc-4", title: "Kostenvoranschlag (Ausfertigung Kostenübernehmer/in)", version: 1, signed_at: null },
];

function state(patch: Record<string, unknown> = {}, pkg: Record<string, unknown> | null = null): LeadPayerPackageState {
  return normalizeLeadPayerPackageState({
    mode: "link",
    blocked_reason: null,
    missing: [],
    can_prepare: true,
    can_send: false,
    signature_enabled: true,
    languages: ["de", "en", "fr", "it"],
    suggested_language: "de",
    signer: { first_name: "Viktor", last_name: "Zahler", email: "viktor.zahler@example.com", acting_for: null },
    order: { id: "order-1", number: "A-2026-0042" },
    cost_estimate_document_id: "kva-1",
    package: pkg
      ? {
          id: "package-1",
          status: "prepared",
          outdated_reasons: [],
          prepared_at: "2026-10-06T10:00:00Z",
          prepared_by_name: "Intake QA",
          sent_at: null,
          sent_by_name: null,
          language: null,
          request_id: null,
          test_mode: false,
          signed_at: null,
          documents,
          attachments: [],
          ...pkg,
        }
      : null,
    payer_identification: { qes_signed_at: null, qes_test_mode: false, own_account_payment_confirmed_at: null },
    ...patch,
  })!;
}

/** The markup of the send button alone. */
const sendButton = (html: string) =>
  html.match(/<button(?:(?!<button).)*?An den Zahler zur Unterschrift senden<\/button>/)?.[0] ?? "";

function render(
  value: LeadPayerPackageState,
  options: { canEdit?: boolean; tx?: typeof ru; details?: boolean; open?: boolean } = {},
) {
  return renderToStaticMarkup(
    <LeadPayerPackagePanel
      leadId="lead-1"
      state={value}
      controller={controller}
      canEdit={options.canEdit ?? true}
      tx={options.tx ?? ru}
      errorText={() => "error"}
      onOpenDocument={options.open === false ? undefined : () => undefined}
      renderDetails={options.details === false ? undefined : (id) => <span data-details-for={id}>details</span>}
    />,
  );
}

describe("LeadPayerPackagePanel", () => {
  it("lists the four documents before preparing and offers to prepare them", () => {
    const html = render(state());
    expect(html).toContain("Документы плательщику на подпись");
    expect(html).toContain("Плательщик получает один пакет из четырёх документов для квалифицированной электронной подписи (QES) через Skribble.");
    for (const label of ["Анкета плательщика", "Согласие плательщика", "Данные пациента о плательщике", "Смета для плательщика"]) {
      expect(html).toContain(label);
    }
    expect(html.match(/ещё не создан/g)).toHaveLength(4);
    expect(html).toContain("Подписывает: </span>Viktor Zahler · viktor.zahler@example.com");
    expect(html).toContain("Подготовить документы");
    expect(html).not.toContain("Отправить плательщику на подпись");
    expect(html).toContain("Идентификация плательщика (QES): ещё нет");
  });

  it("shows a prepared package with versions, the language and send, in German", () => {
    const html = render(state({ can_send: true }, {}), { tx: de });
    expect(html).toContain('data-status="prepared"');
    expect(html).toContain("Erstellt am 06.10.2026 12:00 (Intake QA) · noch nicht gesendet");
    expect(html).toContain("Version 2");
    expect(html).toContain('data-document-id="doc-1"');
    expect(html).toContain("Unterlagen neu erstellen");
    expect(sendButton(html)).not.toBe("");
    expect(sendButton(html)).not.toContain('disabled=""');
    expect(html).toContain("Sprache der Einladung");
    expect(html).toMatch(/aria-pressed="true"[^>]*>DE</);
    for (const language of ["EN", "FR", "IT"]) expect(html).toContain(`>${language}<`);
    // Not sent yet: no details.
    expect(html).not.toContain("data-details-for");
  });

  it("disables send for an outdated package and lists why", () => {
    const html = render(state({ can_send: false }, { outdated_reasons: ["payer_answers_changed", "cost_estimate_changed"] }), { tx: de });
    expect(html).toContain("Die Unterlagen sind veraltet – vor dem Senden neu erstellen:");
    expect(html).toContain("der Zahler hat seine Angaben geändert");
    expect(html).toContain("es gibt eine neue Fassung des Kostenvoranschlags");
    expect(sendButton(html)).toContain('disabled=""');
  });

  it("shows a pending demo package with its details on the first document", () => {
    const html = render(
      state(
        { can_prepare: false, can_send: false },
        { status: "pending", request_id: "request-1", sent_at: "2026-10-06T11:00:00Z", sent_by_name: "Intake QA", language: "en", test_mode: true },
      ),
      { tx: de },
    );
    expect(html).toContain("Wartet auf Unterschrift");
    expect(html).toContain("Gesendet am 06.10.2026 13:00 (Intake QA) · Sprache EN · wartet auf die Unterschrift des Zahlers");
    expect(html).toContain("TEST (DEMO): ohne Rechtswirkung");
    expect(html).toContain('data-details-for="doc-1"');
    expect(html).not.toContain("Unterlagen neu erstellen");
    expect(html).not.toContain("An den Zahler zur Unterschrift senden");
  });

  it("marks signed documents and the payer's QES", () => {
    const signedDocuments = documents.map((item) => ({ ...item, signed_at: "2026-10-07T08:15:00Z" }));
    const html = render(
      state(
        { can_send: false, payer_identification: { qes_signed_at: "2026-10-07T08:15:00Z", qes_test_mode: false } },
        { status: "signed", request_id: "request-1", sent_at: "2026-10-06T11:00:00Z", signed_at: "2026-10-07T08:15:00Z", documents: signedDocuments },
      ),
    );
    expect(html.match(/подписан 07\.10\.2026/g)).toHaveLength(4);
    expect(html).toContain("Подписано 07.10.2026 10:15");
    expect(html).toContain("Идентификация плательщика (QES): подписано 07.10.2026");
  });

  it("names a blocked reason and that the signature is not connected", () => {
    const blocked = render(state({ blocked_reason: "cost_estimate_consent_missing", can_prepare: false }));
    expect(blocked).toContain("Пациент ещё не согласился на передачу сметы плательщику");
    expect(blocked).not.toContain("Подготовить документы");
    const disconnected = render(state({ signature_enabled: false }, {}), { tx: de });
    expect(disconnected).toContain("Elektronische Signatur ist nicht verbunden");
    expect(sendButton(disconnected)).toContain('disabled=""');
  });

  it("offers no writes without leads.edit, and names an organisation's representative", () => {
    const html = render(
      state({ can_send: true, signer: { first_name: "Ben", last_name: "Muster", email: "kasse@beispiel.example.com", acting_for: "Beispiel GmbH" } }, {}),
      { canEdit: false, tx: de },
    );
    expect(html).not.toContain("Unterlagen neu erstellen");
    expect(html).not.toContain("An den Zahler zur Unterschrift senden");
    expect(html).toContain("Ben Muster · kasse@beispiel.example.com · für Beispiel GmbH");
  });
});

describe("LeadPayerSignatureFlow with the payer package", () => {
  it("keeps the standalone Kostenübernahmeerklärung until the package state is loaded", () => {
    const html = renderToStaticMarkup(
      <LeadPayerSignatureFlow
        leadId="lead-1"
        status={{
          complete: false,
          missing: ["cost_assumption_missing"],
          cost_assumption: { required: true, document_id: null, current: false, signed: false, signed_at: null },
          order_id: "order-1",
          order_number: "A-1",
          client_signed_order: false,
          agency_signed_order: false,
          agency_may_sign: false,
          agency_blocking: [],
          aml_countries: [],
        }}
        documents={[]}
        disabled={false}
        canGenerate
        tx={ru}
        renderDocuments={() => null}
        onChanged={() => undefined}
        errorText={() => "error"}
        payerPackage={{ panel: true, canEdit: true }}
      />,
    );
    expect(html).toContain("Создать согласие плательщика");
    expect(html).not.toContain('data-testid="lead-payer-package"');
  });
});
