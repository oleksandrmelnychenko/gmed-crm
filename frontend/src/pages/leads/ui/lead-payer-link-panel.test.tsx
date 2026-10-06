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
  saveEstimatedTotal: async () => null,
  reload: async () => null,
};

function state(patch: Record<string, unknown> = {}): LeadPayerLinkState {
  return normalizeLeadPayerLinkState({
    mode: "link",
    can_send: true,
    blocked_reason: null,
    mail_available: true,
    link: null,
    estimated_total_eur: null,
    funds_proof_threshold_eur: 10000,
    questionnaire: null,
    ...patch,
  })!;
}

function render(value: LeadPayerLinkState, options: { canEdit?: boolean; tx?: typeof ru; leadLanguage?: string } = {}) {
  return renderToStaticMarkup(
    <LeadPayerLinkPanel
      leadId="lead-1"
      state={value}
      controller={controller}
      canEdit={options.canEdit ?? true}
      leadLanguage={options.leadLanguage ?? "uk"}
      tx={options.tx ?? ru}
      errorText={() => "error"}
    />,
  );
}

describe("LeadPayerLinkPanel", () => {
  it("offers the first link in the lead's language, highlighted, with the amount", () => {
    const html = render(state());
    expect(html).toContain("Ссылка для плательщика");
    expect(html).toContain("Ссылка ещё не отправлялась");
    expect(html).toContain("Пациент отправил заявку: теперь можно отправить ссылку плательщику");
    expect(html).toContain('data-highlight="true"');
    expect(html).toContain("Отправить ссылку плательщику");
    expect(html).not.toContain("Отозвать ссылку");
    // The lead speaks Ukrainian: UA is the language of the invitation.
    expect(html).toMatch(/aria-pressed="true"[^>]*>UA</);
    expect(html).toContain("Ожидаемая общая сумма, EUR");
    expect(html).toContain("плательщик прикладывает подтверждение источника средств");
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
        estimated_total_eur: "12000.00",
      }),
      { tx: de },
    );
    expect(html).toContain("Gesendet am 06.10.2026 12:00 an viktor.zahler@example.com · gültig bis 05.11.2026");
    expect(html).toContain('data-status="sent"');
    expect(html).toContain("Erneut senden");
    expect(html).toContain("Link widerrufen");
    expect(html).not.toContain("Zur Korrektur öffnen");
    expect(html).toMatch(/aria-pressed="true"[^>]*>DE</);
    expect(html).toContain('value="12000,00"');
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
    expect(answered).toContain("Angaben eingegangen am 06.10.2026 12:30");
    expect(answered).toContain("Die Angaben sind eingegangen: Für einen neuen Link „Zur Korrektur öffnen“ wählen");
    const blocked = render(state({ can_send: false, blocked_reason: "request_not_submitted" }));
    expect(blocked).toContain("Ссылку можно отправить, когда пациент отправит заявку в кабинете");
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

  it("offers no writes without leads.edit", () => {
    const html = render(state({ link: { status: "opened", sent_at: "2026-10-06T10:00:00Z" } }), { canEdit: false });
    expect(html).not.toMatch(/<button/);
    expect(html).toMatch(/<input[^>]*readonly=""/i);
    expect(html).toContain("Открыта · отправлена 06.10.2026 12:00");
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
