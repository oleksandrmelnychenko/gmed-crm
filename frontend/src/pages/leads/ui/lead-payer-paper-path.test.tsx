import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { PayerIdentificationStatus } from "../model/lead-payer-paper";
import { LeadPayerPaperPath } from "./lead-payer-paper-path";

const auth = vi.hoisted(() => ({ role: "patient_manager" }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "synthetic-staff", role: auth.role } }) }));

const ru = (text: string) => text;
const de = (_ru: string, text: string) => text;

const missing: PayerIdentificationStatus = {
  required: true,
  identified: false,
  statement_sent: false,
  self_disclosure_signed: false,
  identity_document: false,
};

function render(
  identification: PayerIdentificationStatus,
  options: { canEdit?: boolean; tx?: typeof ru; role?: string } = {},
) {
  auth.role = options.role ?? "patient_manager";
  return renderToStaticMarkup(
    <LeadPayerPaperPath
      leadId="lead-1"
      identification={identification}
      payerName="Erika Zahler"
      canEdit={options.canEdit ?? true}
      lang={options.tx === de ? "de" : "ru"}
      tx={options.tx ?? ru}
      errorText={() => "error"}
    />,
  );
}

describe("LeadPayerPaperPath (re-check V-A7)", () => {
  it("offers the payer's ID upload and the paper Selbstauskunft beside the link, under the readiness anchor", () => {
    const html = render(missing);
    expect(html).toContain('id="lead-wizard-payer-paper-path"');
    expect(html).toContain('data-identified="false"');
    expect(html).toContain("Бумажный путь (без ссылки)");
    expect(html).toContain(
      "Заполните анкету плательщика по ссылке или загрузите подписанную на бумаге Selbstauskunft и документ плательщика",
    );
    expect(html).toContain('data-testid="lead-payer-paper-upload-open"');
    // Short button labels under the «Бумажный путь» title (owner polish 2026-10-29).
    expect(html).toContain("Загрузить документ</button>");
    expect(html).toContain('data-testid="lead-payer-paper-generate"');
    expect(html).toContain("Создать анкету</button>");
    expect(render(missing, { tx: de })).toContain("Ausweis hochladen</button>");
  });

  it("shows the identified payer and offers no new paper form once the payer answered on the link", () => {
    const html = render({ ...missing, identified: true, statement_sent: true, identity_document: true });
    expect(html).toContain('data-identified="true"');
    expect(html).toContain("Плательщик идентифицирован");
    expect(html).toContain("Анкета отправлена плательщиком по ссылке");
    expect(html).not.toContain('data-testid="lead-payer-paper-generate"');
    expect(html).toMatch(/data-testid="lead-payer-paper-self-disclosure" data-done="true"/);
    expect(html).toMatch(/data-testid="lead-payer-paper-identity" data-done="true"/);
  });

  it("writes only for staff who may file the lead's documents", () => {
    const readOnly = render(missing, { canEdit: false });
    expect(readOnly).not.toContain("lead-payer-paper-upload-open");
    expect(readOnly).not.toContain("lead-payer-paper-generate");
    expect(readOnly).not.toContain("lead-payer-paper-role-hint");
    const sales = render(missing, { role: "sales" });
    expect(sales).not.toContain("lead-payer-paper-upload-open");
    expect(sales).toContain('data-testid="lead-payer-paper-role-hint"');
    expect(render(missing, { role: "ceo" })).toContain("lead-payer-paper-upload-open");
  });
});
