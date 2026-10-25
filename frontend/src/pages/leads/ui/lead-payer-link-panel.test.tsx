import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { normalizeLeadPayerLinkState, type LeadPayerLinkState } from "../data/lead-payer-link-api";
import type { PayerDeclaration, PayerDeclarationStatus } from "../model/lead-payer";
import type { LeadPayerLinkController } from "../model/use-lead-payer-link";
import { LeadPayerLinkPanel, payerLinkLanguageOf } from "./lead-payer-link-panel";
import { LeadPayerDeclarationSection } from "./lead-payer-section";

const ru = (text: string) => text;
const de = (_ru: string, text: string) => text;

const controller = {
  send: async () => null,
  revoke: async () => null,
  reload: async () => null,
};

function state(patch: Record<string, unknown> = {}): LeadPayerLinkState {
  return normalizeLeadPayerLinkState({
    mode: "link",
    can_send: true,
    blocked_reason: null,
    mail_available: true,
    link: null,
    questionnaire: null,
    ...patch,
  })!;
}

function render(value: LeadPayerLinkState, options: { canEdit?: boolean; tx?: typeof ru; leadLanguage?: string; leadSubmitted?: boolean } = {}) {
  return renderToStaticMarkup(
    <LeadPayerLinkPanel
      leadId="lead-1"
      state={value}
      controller={controller}
      canEdit={options.canEdit ?? true}
      leadLanguage={options.leadLanguage ?? "uk"}
      tx={options.tx ?? ru}
      errorText={() => "error"}
      leadSubmitted={options.leadSubmitted}
    />,
  );
}

describe("LeadPayerLinkPanel", () => {
  it("keeps 'the patient sent the request' for a lead who has not submitted yet", () => {
    // Only "no link yet" and the send button; the sentence about the request waits (QA 2026-10-25).
    const html = render(state(), { leadSubmitted: false });
    expect(html).toContain("Ссылка ещё не отправлялась");
    expect(html).not.toContain("Пациент отправил заявку");
    expect(html).toContain("Отправить ссылку плательщику");
  });

  it("offers the first link in the lead's language, without a separate amount", () => {
    const html = render(state());
    expect(html).toContain("Ссылка для плательщика");
    expect(html).toContain("Ссылка ещё не отправлялась");
    expect(html).toContain("Пациент отправил заявку: теперь можно отправить ссылку плательщику");
    expect(html).toContain('data-highlight="true"');
    expect(html).toContain("Отправить ссылку плательщику");
    expect(html).not.toContain("Отозвать ссылку");
    // The lead speaks Ukrainian: UA is the language of the invitation.
    expect(html).toMatch(/aria-pressed="true"[^>]*>UA</);
    expect(html).not.toContain("Ожидаемая общая сумма, EUR");
    expect(html).not.toContain("подтверждение источника средств");
  });

  it("shows the sent link, resend and revoke, in German", () => {
    const html = render(
      state({
        link: {
          status: "sent",
          email: "viktor.zahler@example.com",
          language: "de",
          sent_at: "2026-10-06T10:00:00Z",
          expires_at: "2026-11-05T10:00:00Z",
          last_email_status: "sent",
        },
      }),
      { tx: de },
    );
    expect(html).toContain("Gesendet am 06.10.2026 12:00 an viktor.zahler@example.com · gültig bis 05.11.2026");
    expect(html).toContain('data-status="sent"');
    expect(html).toContain("Erneut senden");
    expect(html).toContain("Link widerrufen");
    expect(html).not.toContain("Zur Korrektur öffnen");
    expect(html).toMatch(/aria-pressed="true"[^>]*>DE</);
    expect(html).not.toContain('value="12000,00"');
  });

  it("asks for 'reopen' after the payer answered and names a blocked reason", () => {
    const answered = render(
      state({
        link: { status: "submitted", email: "viktor.zahler@example.com", sent_at: "2026-10-06T10:00:00Z" },
        questionnaire: { answers: {}, submitted_at: "2026-10-06T10:30:00Z", missing_for_submit: [] },
      }),
      { tx: de },
    );
    expect(answered).toContain("Zur Korrektur öffnen");
    expect(answered).toContain("Vom Zahler am 06.10.2026 12:30");
    expect(answered).not.toContain('data-testid="lead-payer-link-status"');
    expect(answered).toContain("Die Angaben sind eingegangen: Für einen neuen Link „Zur Korrektur öffnen“ wählen");
    const blocked = render(state({ can_send: false, blocked_reason: "request_not_submitted" }));
    expect(blocked).toContain("Пациенту нужно отправить актуальную заявку из кабинета. После изменения плательщика или согласия заявку нужно отправить повторно");
    expect(blocked).not.toContain('data-highlight="true"');
    const noMail = render(state({ can_send: false, mail_available: false }));
    expect(noMail).toContain("Отправка e-mail не настроена. Mittaro подключается в разделе «API-подключения» → «E-Mail».");
  });

  it("only notes the cabinet for a paying parent with a login", () => {
    const html = render(state({ mode: "cabinet", can_send: false, blocked_reason: "payer_has_cabinet_login" }));
    expect(html).toContain("Плательщик — родитель с доступом в кабинет: анкета в его кабинете");
    expect(html).not.toContain("Отправить ссылку плательщику");
    expect(html).not.toContain("lead-payer-link-blocked");
  });

  it("only notes the contracting parent for a payer stored as a third party before", () => {
    const html = render(state({ can_send: false, blocked_reason: "payer_is_representative" }));
    expect(html).toContain("ссылка плательщика и заявление о принятии расходов не нужны");
    expect(html).not.toContain("Отправить ссылку плательщику");
    expect(html).not.toContain("Язык письма");
    expect(html).not.toContain("lead-payer-link-blocked");
    expect(html).not.toContain('data-testid="lead-payer-link-badge"');
  });

  it("offers no writes without leads.edit", () => {
    const html = render(state({ link: { status: "opened", sent_at: "2026-10-06T10:00:00Z" } }), { canEdit: false });
    expect(html).not.toMatch(/<button/);
    expect(html).not.toMatch(/<input/);
    expect(html).toContain("Открыта · отправлена 06.10.2026 12:00");
  });

  it("names the signature package once the payer answered (phase 3b)", () => {
    const answered = state({
      link: { status: "submitted", email: "viktor.zahler@example.com", sent_at: "2026-10-06T10:00:00Z" },
      questionnaire: { answers: {}, submitted_at: "2026-10-06T10:30:00Z", missing_for_submit: [] },
    });
    const line = (summary: Parameters<typeof LeadPayerLinkPanel>[0]["packageSummary"], tx = ru) =>
      renderToStaticMarkup(
        <LeadPayerLinkPanel
          leadId="lead-1"
          state={answered}
          controller={controller}
          canEdit
          tx={tx}
          errorText={() => "error"}
          packageSummary={summary}
        />,
      );
    expect(line(null)).toContain("ещё не подготовлен");
    expect(line(null)).toContain("Договор и смета");
    expect(line({ status: "pending", outdated: false, sent_at: "2026-10-06T11:00:00Z", signed_at: null }, de)).toContain(
      "gesendet am 06.10.2026, wartet auf Unterschrift",
    );
    // An older server sends no package: nothing.
    expect(line(undefined)).not.toContain("lead-payer-link-package");
    // Before the payer answered: nothing either.
    expect(render(state())).not.toContain("lead-payer-link-package");
  });

  it("lists a previous payer's statement collapsed, with its archived document (QA 2026-10-25, map item 95)", () => {
    const previous = state({
      previous_questionnaires: [
        {
          statement_id: "st-2",
          payer_name: "Ben Zahler",
          payer_kind: "third_party",
          payer_type: "person",
          submitted_at: "2026-10-22T09:30:00Z",
          archived_at: "2026-10-24T08:00:00Z",
          archived_reason: "payer_changed",
          document_id: "doc-2",
        },
        {
          statement_id: "st-1",
          payer_name: "Viktor Zahler",
          payer_kind: "third_party",
          payer_type: "person",
          submitted_at: "2026-10-20T09:30:00Z",
          archived_at: "2026-10-21T08:00:00Z",
          archived_reason: "email_changed",
          document_id: null,
        },
      ],
    });
    const html = render(previous);
    expect(html).toContain('data-testid="lead-payer-link-previous"');
    // Newest first, each a collapsed <details> with the name and the date of the statement.
    const first = html.indexOf("Предыдущий плательщик: Ben Zahler — анкета от 22.10.2026");
    const second = html.indexOf("Предыдущий плательщик: Viktor Zahler — анкета от 20.10.2026");
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
    expect(html).toMatch(/<details[^>]*data-statement-id="st-2"[^>]*>\s*<summary/);
    expect(html).not.toContain("<details open");
    // The facts behind the line and the button for the archived copy — only where there is one.
    expect(html).toContain("Анкета отправлена 22.10.2026 11:30");
    expect(html).toContain("В архиве с 24.10.2026 10:00 · плательщик изменён");
    expect(html).toContain("изменён e-mail плательщика");
    expect(html.match(/data-testid="lead-payer-link-previous-document"/g)).toHaveLength(1);
    expect(html).toContain("Открыть архивный документ");
    expect(html).toContain("Документ, удостоверяющий личность, не загружался");
    expect(render(previous, { tx: de })).toContain("Früherer Zahler: Ben Zahler – Fragebogen vom 22.10.2026");
    // Nothing of it without previous payers.
    expect(render(state())).not.toContain("lead-payer-link-previous");
  });

  it("reads the lead's language as one of the four", () => {
    expect(payerLinkLanguageOf("uk-UA")).toBe("uk");
    expect(payerLinkLanguageOf("UA")).toBe("uk");
    expect(payerLinkLanguageOf("en")).toBe("en");
    expect(payerLinkLanguageOf("tr")).toBe("de");
    expect(payerLinkLanguageOf(null)).toBe("de");
  });
});

const status: PayerDeclarationStatus = {
  complete: true,
  missing: [],
  cost_assumption: { required: true, document_id: null, current: false, signed: false, signed_at: null },
  order_id: null,
  order_number: null,
  client_signed_order: false,
  agency_signed_order: false,
  agency_may_sign: false,
  agency_blocking: [],
  aml_countries: [],
};

const thirdParty = {
  payer_kind: "third_party",
  acts_on_own_account: true,
  beneficial_owner_name: null,
  beneficial_owner_note: null,
  source_of_funds: "savings",
  source_of_funds_description: null,
  source_of_funds_document_id: null,
  first_name: "Viktor",
  last_name: "Zahler",
  date_of_birth: "1970-03-02",
  place_of_birth: null,
  street: "Musterweg 1",
  zip: "1010",
  city: "Wien",
  country: "AT",
  citizenships: ["AT"],
  relationship: null,
  email: "viktor.zahler@example.com",
  phone: null,
  payer_informed_at: null,
  payer_informed_by: null,
  payer_type: "person",
  contact_consent_at: "2026-10-05T09:30:00Z",
} as PayerDeclaration;

function section(declaration: PayerDeclaration, payerLink: LeadPayerLinkController | undefined) {
  // The date of birth of a person is a date picker: it needs the adapter of the app.
  return renderToStaticMarkup(
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <LeadPayerDeclarationSection
        leadId="lead-1"
        data={{ declaration, status }}
        loading={false}
        loadError={null}
        disabled={false}
        canEdit
        lang="ru"
        tx={ru}
        onSave={async () => undefined}
        errorText={() => "error"}
        payerLink={payerLink}
      />
    </LocalizationProvider>,
  );
}

describe("LeadPayerDeclarationSection: the payer link", () => {
  const loaded: LeadPayerLinkController = { ...controller, data: state(), loading: false, error: null };

  it("mounts the panel inside the third-party block", () => {
    expect(section(thirdParty, loaded)).toContain('data-testid="lead-payer-link"');
  });

  it("stays away for a self-payer, without the link data, and on an older server", () => {
    expect(section({ ...thirdParty, payer_kind: "self" }, loaded)).not.toContain('data-testid="lead-payer-link"');
    expect(section(thirdParty, undefined)).not.toContain('data-testid="lead-payer-link"');
    expect(section(thirdParty, { ...loaded, data: null })).not.toContain('data-testid="lead-payer-link"');
  });
});
