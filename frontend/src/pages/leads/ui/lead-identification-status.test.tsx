import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  representativeSubject,
  type LeadIdentificationStatus,
  type RepresentativeIdentification,
} from "../model/lead-identification";
import { LeadIdentificationStatusView } from "./lead-identification-status";

const ru = (text: string) => text;
const de = (_ru: string, text: string) => text;

const SIGNED = { signed_at: "2026-10-05T09:20:00Z", test_mode: false };
const CONFIRMED = { confirmed_at: "2026-10-05T10:00:00Z", confirmed_by_name: "Petra Manager", note: null };

const AWAITING: LeadIdentificationStatus = {
  contract_partner: { qes: SIGNED, own_account_payment: null },
  payer: null,
  minor: false,
  representatives: [],
};

const ANNA_ID = "11111111-1111-4111-8111-111111111111";
const BEN_ID = "22222222-2222-4222-8222-222222222222";
const ANNA = representativeSubject(ANNA_ID);
const BEN = representativeSubject(BEN_ID);

function representative(patch: Partial<RepresentativeIdentification> & { id: string; name: string }): RepresentativeIdentification {
  return {
    qes: null,
    own_account_payment: null,
    subject: representativeSubject(patch.id),
    relation: "parent",
    has_email: true,
    ...patch,
  };
}

/** A minor with both parents: the mother signed and her payment is confirmed. */
const MINOR: LeadIdentificationStatus = {
  contract_partner: { qes: null, own_account_payment: null },
  payer: null,
  minor: true,
  representatives: [
    representative({ id: ANNA_ID, name: "Anna Muster", qes: SIGNED, own_account_payment: CONFIRMED }),
    representative({ id: BEN_ID, name: "Ben Muster", has_email: false }),
  ],
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
    // An adult: nothing about representatives.
    expect(html).not.toContain("lead-identification-minor");
    expect(html).not.toContain("lead-identification-no-representative");
  });

  it("shows who confirmed the payment and lets it be taken back", () => {
    const html = render({
      ...AWAITING,
      contract_partner: { ...AWAITING.contract_partner, own_account_payment: CONFIRMED },
      payer: { qes: null, own_account_payment: null, same_person_as: null },
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
    expect(render(MINOR, { canEdit: false })).not.toMatch(/<button\b/);
  });

  it("reads in German and reports a refused change", () => {
    const html = render(
      { ...AWAITING, payer: { qes: { signed_at: "2026-10-05T09:20:00Z", test_mode: true }, own_account_payment: null, same_person_as: null } },
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

  it("lists the legal representatives of a minor instead of the child", () => {
    const html = render(MINOR);
    expect(line(html, "contract_partner")).toBe("");
    expect(html).toContain("подписывают и платят законные представители");

    const anna = line(html, ANNA);
    expect(anna).toContain("Anna Muster");
    expect(anna).toContain("родитель");
    expect(anna).toContain("Квалифицированная подпись · 05.10.2026");
    expect(anna).toContain("Платёж с собственного счёта подтверждён · 05.10.2026 · Petra Manager");
    expect(anna).toContain("Отменить — Anna Muster");
    expect(anna).not.toContain("нет e-mail");

    const ben = line(html, BEN);
    expect(ben).toContain("Ben Muster");
    expect(ben).toContain("Квалифицированной подписи ещё нет");
    expect(ben).toContain("Ожидается платёж с собственного счёта");
    expect(ben).toContain("Подтвердить платёж — Ben Muster");
    // His signature could not be attributed to him.
    expect(ben).toContain("нет e-mail — подпись не засчитается");
    expect(html).not.toContain("lead-identification-no-representative");
  });

  it("identifies a paying parent once: the payer line has the same labels and no button", () => {
    const html = render({ ...MINOR, payer: { qes: null, own_account_payment: null, same_person_as: ANNA } });
    const payer = line(html, "payer");
    expect(payer).toContain("Плательщик — тот же человек, что и представитель Anna Muster");
    expect(payer).toContain("Квалифицированная подпись · 05.10.2026");
    expect(payer).toContain("Платёж с собственного счёта подтверждён · 05.10.2026 · Petra Manager");
    expect(payer).not.toMatch(/<button\b/);
    // The representative's own line keeps the button.
    expect(line(html, ANNA)).toMatch(/<button\b/);
    expect(render({ ...MINOR, payer: { qes: null, own_account_payment: null, same_person_as: ANNA } }, { lang: "de" }))
      .toContain("Kostenträger — dieselbe Person wie Vertreter/in Anna Muster");
  });

  it("asks for a parent or guardian when a minor has none on file", () => {
    const html = render({ ...MINOR, representatives: [] });
    expect(html).toContain("lead-identification-no-representative");
    expect(html).toContain("Добавьте родителя или законного представителя");
    expect(html).not.toContain("<li");
    expect(html).not.toMatch(/<button\b/);
    expect(render({ ...MINOR, representatives: [] }, { lang: "de" })).toContain(
      "Bitte einen Elternteil oder eine gesetzliche Vertreterin / einen gesetzlichen Vertreter hinzufügen",
    );
  });
});
