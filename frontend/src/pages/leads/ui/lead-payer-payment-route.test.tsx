import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { PayerDeclaration } from "../model/lead-payer";
import { LeadPayerPaymentRoute } from "./lead-payer-payment-route";

const ru = (text: string) => text;
const de = (_ru: string, text: string) => text;

const cash = {
  payer_kind: "third_party",
  payment_method: "cash",
  payment_method_details: null,
  account_country: null,
  account_holder: null,
  bank_name: null,
  via_third_party: null,
  via_third_party_details: null,
  payment_route_source: "staff",
} as unknown as PayerDeclaration;

function render(declaration: PayerDeclaration, options: { canEdit?: boolean; tx?: typeof ru } = {}) {
  const tx = options.tx ?? ru;
  return renderToStaticMarkup(
    <LeadPayerPaymentRoute
      leadId="lead-1"
      declaration={declaration}
      canEdit={options.canEdit ?? true}
      disabled={false}
      lang={tx === de ? "de" : "ru"}
      tx={tx}
      errorText={() => "error"}
    />,
  );
}

describe("LeadPayerPaymentRoute (owner 2026-10-26)", () => {
  it("lets leads.edit enter the route, prefilled with the stored one and its source", () => {
    const html = render(cash);
    expect(html).toContain("Способ оплаты плательщика");
    expect(html).toContain('data-testid="lead-payer-route-source"');
    expect(html).toContain("внесено сотрудником");
    expect(html).toContain("Наличные");
    expect(html).toContain('data-testid="lead-payer-route-save"');
    // Cash asks no account.
    expect(html).not.toContain("Владелец счёта");
    expect(html).toContain("его ответ заменит этот");
    expect(render({ ...cash, payment_route_source: "payer" } as PayerDeclaration, { tx: de })).toContain("vom Zahler angegeben");
  });

  it("asks the account with a bank transfer", () => {
    const html = render({ ...cash, payment_method: "bank_transfer", account_holder: "Erika Zahler" } as PayerDeclaration);
    expect(html).toContain("Владелец счёта");
    expect(html).toContain("Erika Zahler");
    expect(html).toContain("Банк");
  });

  it("is read-only without leads.edit", () => {
    const html = render(cash, { canEdit: false });
    expect(html).toContain("Способ оплаты плательщика");
    expect(html).toContain("Наличные");
    expect(html).not.toContain('data-testid="lead-payer-route-save"');
    expect(html).not.toContain("<input");
    const empty = render({ ...cash, payment_method: null, payment_route_source: null } as unknown as PayerDeclaration, { canEdit: false });
    expect(empty).toContain("Плательщик ещё не указал способ оплаты.");
    expect(empty).not.toContain("lead-payer-route-source");
  });
});
