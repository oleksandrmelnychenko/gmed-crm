import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DocumentItem } from "@/pages/documents/model/types";
import { LeadSigningPackagePanel } from "./lead-signing-package-panel";

const language = vi.hoisted(() => ({ lang: "ru" }));
vi.mock("@/lib/i18n", () => ({ useLang: () => language }));
beforeEach(() => { language.lang = "ru"; });
vi.mock("@/pages/documents/ui/document-signature-action", () => ({
  DocumentSignatureAction: ({ documentId, scope, signed, title }: {
    documentId?: string; scope?: { leadId?: string }; signed?: boolean; title: string;
  }) => <button data-document-signature-id={documentId} data-scope-lead={scope?.leadId}
    data-signed={Boolean(signed)} aria-label={title} />,
}));

function document(id: string, signed: boolean, filename: string | null = `${id}.pdf`): DocumentItem {
  return { id, original_filename: filename, signed_at: signed ? "2026-10-15T09:00:00Z" : null } as DocumentItem;
}

function render(contractDocument: DocumentItem | null, orderDocument: DocumentItem | null,
  contractSigned = false, inheritedContract = false) {
  return renderToStaticMarkup(<LeadSigningPackagePanel leadId="synthetic-lead"
    contractDocument={contractDocument} orderDocument={orderDocument}
    contractSigned={contractSigned} inheritedContract={inheritedContract} onDone={() => {}} />);
}

describe("lead signing package source", () => {
  it("starts the complete package from the current unsigned contract", () => {
    const html = render(document("contract-v1", false), document("order-v1", false));
    expect(html).toContain('data-document-signature-id="contract-v1"');
    expect(html).toContain('data-signed="false"');
    expect(html).toContain("Проверьте состав пакета в окне подписи.");
  });

  it("starts from a new unsigned order when the current contract is already signed", () => {
    const html = render(document("contract-v2", true), document("order-v1", false, null), true);
    expect(html).toContain('data-document-signature-id="order-v1"');
    expect(html).toContain('data-signed="false"');
    expect(html).toContain('aria-label="Заказ"');
    expect(html).toContain("Рамочный договор: подписан");
    expect(html).toContain("Заказ: не подписан");
  });

  it("uses document proof even before the contract entity's status refreshes", () => {
    const html = render(document("signed-contract", true), document("new-order", false), false);
    expect(html).toContain('data-document-signature-id="new-order"');
    expect(html).toContain("Рамочный договор: подписан");
  });

  it("does not bypass a new unsigned contract version after an earlier signature", () => {
    const html = render(document("contract-v3", false), document("new-order", false), true);
    expect(html).toContain('data-document-signature-id="contract-v3"');
    expect(html).toContain('data-signed="false"');
    expect(html).not.toContain("Рамочный договор: подписан");
    expect(html).toContain("Рамочный договор: не подписан");
  });

  it("uses the order when a signed patient contract is inherited", () => {
    const html = render(null, document("repeat-order", false), true, true);
    expect(html).toContain('data-document-signature-id="repeat-order"');
    expect(html).toContain('data-signed="false"');
    expect(html).toContain("Рамочный договор: подписан");
  });

  it("keeps signed contract history once both documents are signed", () => {
    const html = render(document("signed-contract", true), document("signed-order", true), true);
    expect(html).toContain('data-document-signature-id="signed-contract"');
    expect(html).toContain('data-signed="true"');
    expect(html).toContain("Заказ: подписан");
  });

  it("opens a signed order as history without a local contract document", () => {
    const html = render(null, document("signed-order", true), true, true);
    expect(html).toContain('data-document-signature-id="signed-order"');
    expect(html).toContain('data-signed="true"');
  });

  it("keeps the lead-scoped composer available before any PDFs exist", () => {
    const html = render(null, null);
    expect(html).toContain('data-scope-lead="synthetic-lead"');
    expect(html).not.toContain("data-document-signature-id=");
  });
});

for (const lang of ["ru", "de"]) {
  describe(`signing package summary in ${lang}`, () => {
    it("separates a paper-signed contract from the unsigned order without promising signed companions", () => {
      language.lang = lang;
      const contract = { ...document("paper-contract", true), ursprung: "paper_signature" };
      const html = render(contract, document("new-order", false), true);
      expect(html).toContain(lang === "ru" ? "Рамочный договор: подписан на бумаге" : "Rahmenvertrag: auf Papier unterzeichnet");
      expect(html).toContain(lang === "ru" ? "Заказ: не подписан" : "Auftrag: nicht unterzeichnet");
      expect(html).toContain(lang === "ru" ? "Проверьте состав пакета в окне подписи." : "Prüfen Sie den Paketinhalt im Unterschriftsfenster.");
      expect(html).toContain('data-document-signature-id="new-order"');
      expect(html).not.toMatch(/DSGVO|анкета|Patientenformular/);
    });

    it("does not call an electronic or unproved signature a paper signature", () => {
      language.lang = lang;
      const unsigned = { ...document("new-contract", false), ursprung: "paper_signature" };
      const html = render(unsigned, document("order", false), true, true);
      expect(html).toContain(lang === "ru" ? "Рамочный договор: не подписан" : "Rahmenvertrag: nicht unterzeichnet");
      expect(html).not.toContain(lang === "ru" ? "подписан на бумаге" : "auf Papier unterzeichnet");
      expect(html).toContain('data-document-signature-id="new-contract"');
      expect(render(document("electronic-contract", true), null)).not.toContain(lang === "ru" ? "на бумаге" : "auf Papier");
    });
  });
}
