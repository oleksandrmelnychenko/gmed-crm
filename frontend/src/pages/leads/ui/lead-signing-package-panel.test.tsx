import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { DocumentItem } from "@/pages/documents/model/types";
import { LeadSigningPackagePanel } from "./lead-signing-package-panel";

vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: "ru" }) }));
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
    expect(html).toContain("Договор, заказ, анкета");
  });

  it("starts from a new unsigned order when the current contract is already signed", () => {
    const html = render(document("contract-v2", true), document("order-v1", false, null), true);
    expect(html).toContain('data-document-signature-id="order-v1"');
    expect(html).toContain('data-signed="false"');
    expect(html).toContain('aria-label="Заказ"');
    expect(html).toContain("Ранее подписанный договор действует.");
    expect(html).toContain("Договор подписан");
  });

  it("uses document proof even before the contract entity's status refreshes", () => {
    const html = render(document("signed-contract", true), document("new-order", false), false);
    expect(html).toContain('data-document-signature-id="new-order"');
    expect(html).toContain("Ранее подписанный договор действует.");
  });

  it("does not bypass a new unsigned contract version after an earlier signature", () => {
    const html = render(document("contract-v3", false), document("new-order", false), true);
    expect(html).toContain('data-document-signature-id="contract-v3"');
    expect(html).toContain('data-signed="false"');
    expect(html).not.toContain("Договор подписан");
  });

  it("uses the order when a signed patient contract is inherited", () => {
    const html = render(null, document("repeat-order", false), true, true);
    expect(html).toContain('data-document-signature-id="repeat-order"');
    expect(html).toContain('data-signed="false"');
    expect(html).toContain("Ранее подписанный договор действует.");
  });

  it("keeps signed contract history once both documents are signed", () => {
    const html = render(document("signed-contract", true), document("signed-order", true), true);
    expect(html).toContain('data-document-signature-id="signed-contract"');
    expect(html).toContain('data-signed="true"');
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
