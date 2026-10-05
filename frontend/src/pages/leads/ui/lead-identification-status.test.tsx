import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { LeadIdentificationStatus } from "../model/lead-identification";
import { LeadIdentificationStatusView } from "./lead-identification-status";

const ru = (text: string) => text;
const de = (_ru: string, text: string) => text;

const AWAITING: LeadIdentificationStatus = {
  contract_partner: {
    qes: { signed_at: "2026-10-05T09:20:00Z", test_mode: false },
    own_account_payment: null,
  },
  payer: null,
};

function render(
  status: LeadIdentificationStatus,
  options: { canEdit?: boolean; lang?: "ru" | "de"; errorMessage?: string } = {},
) {
  return renderToStaticMarkup(
    <LeadIdentificationStatusView
      status={status}
      canEdit={options.canEdit ?? true}
      disabled={false}
      busy={null}
      errorMessage={options.errorMessage ?? ""}
      tx={options.lang === "de" ? de : ru}
      onSetOwnAccountPayment={() => undefined}
    />,
  );
}

/** The markup of one person's line, found by its test id. */
function line(html: string, subject: string): string {
  const start = html.indexOf(`data-testid="lead-identification-${subject}"`);
  if (start < 0) return "";
  return html.slice(start, html.indexOf("</li>", start));
}

describe("LeadIdentificationStatusView", () => {
  it("shows the patient's signature and awaits the payment, with a button to confirm it", () => {
    const html = render(AWAITING);
    const patient = line(html, "contract_partner");
    expect(patient).toContain("Пациент");
    expect(patient).toContain("Квалифицированная подпись · 05.10.2026");
    expect(patient).toContain('data-tone="success"');
    expect(patient).toContain("Ожидается платёж с собственного счёта");
    expect(patient).toContain('data-tone="warning"');
    expect(patient).toContain("Подтвердить платёж");
    expect(patient).not.toContain("Отменить");
    // Nobody else pays: no payer line.
    expect(line(html, "payer")).toBe("");
    expect(html).toContain("Это не блокирует работу.");
    expect(html).not.toContain('role="alert"');
  });

  it("shows who confirmed the payment and lets it be taken back", () => {
    const html = render({
      contract_partner: {
        ...AWAITING.contract_partner,
        own_account_payment: { confirmed_at: "2026-10-05T10:00:00Z", confirmed_by_name: "Petra Manager", note: null },
      },
      payer: { qes: null, own_account_payment: null },
    });
    const patient = line(html, "contract_partner");
    expect(patient).toContain("Платёж с собственного счёта подтверждён · 05.10.2026 · Petra Manager");
    expect(patient).toContain("Отменить");
    expect(patient).not.toContain("Подтвердить платёж");
    // The payer has a line and a confirmation of its own.
    const payer = line(html, "payer");
    expect(payer).toContain("Плательщик");
    expect(payer).toContain("Квалифицированной подписи ещё нет");
    expect(payer).toContain('data-tone="neutral"');
    expect(payer).toContain("Подтвердить платёж");
  });

  it("only informs a role that may not edit", () => {
    const html = render(AWAITING, { canEdit: false });
    expect(html).toContain("Ожидается платёж с собственного счёта");
    expect(html).not.toMatch(/<button\b/);
  });

  it("reads in German and reports a refused change", () => {
    const html = render(
      { ...AWAITING, payer: { qes: { signed_at: "2026-10-05T09:20:00Z", test_mode: true }, own_account_payment: null } },
      { lang: "de", errorMessage: "Die Anfrage ist konvertiert" },
    );
    for (const text of [
      "Identifizierung per qualifizierter Signatur",
      "Patient/in",
      "Qualifizierte Signatur · 05.10.2026",
      "Zahlung vom eigenen Konto ausstehend",
      "Zahlung bestätigen",
      "Kostenübernehmer",
      "Qualifizierte Signatur · 05.10.2026 · Test",
      "Das blockiert die Arbeit nicht.",
      "Die Anfrage ist konvertiert",
    ]) {
      expect(html).toContain(text);
    }
    expect(line(html, "payer")).toContain('data-tone="info"');
    expect(html).toContain('role="alert"');
  });
});
