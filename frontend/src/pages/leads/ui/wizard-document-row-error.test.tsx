import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WizardDocumentRowError, WizardDocumentRowErrorProvider } from "./wizard-document-row-error";

function rows(error: { documentId: string; text: string } | null) {
  return renderToStaticMarkup(
    <WizardDocumentRowErrorProvider value={error}>
      <div data-row="gwg-ioann">
        GwG Ioann
        <WizardDocumentRowError documentId="gwg-ioann" />
      </div>
      <div data-row="gwg-maria">
        GwG Maria
        <WizardDocumentRowError documentId="gwg-maria" />
      </div>
    </WizardDocumentRowErrorProvider>,
  );
}

describe("WizardDocumentRowError", () => {
  it("shows a refused signature under the row whose button was pressed", () => {
    const html = rows({ documentId: "gwg-ioann", text: "Не хватает: первый родитель — телефон." });
    const ioann = html.slice(html.indexOf('data-row="gwg-ioann"'), html.indexOf('data-row="gwg-maria"'));
    const maria = html.slice(html.indexOf('data-row="gwg-maria"'));
    expect(ioann).toContain('role="alert"');
    expect(ioann).toContain("Не хватает: первый родитель — телефон.");
    expect(maria).not.toContain('role="alert"');
  });

  it("shows nothing without a refusal", () => {
    expect(rows(null)).not.toContain('role="alert"');
  });
});
