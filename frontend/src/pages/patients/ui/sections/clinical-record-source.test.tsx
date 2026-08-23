import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ClinicalRecordSource } from "./clinical-record-source";

const tx = (ru: string) => ru;

describe("ClinicalRecordSource", () => {
  it("marks records without import provenance as manually created", () => {
    const html = renderToStaticMarkup(<ClinicalRecordSource item={{}} tx={tx} />);

    expect(html).toContain('data-clinical-source="manual"');
    expect(html).toContain("Создано вручную");
  });

  it("shows the document name and page for OCR-created records", () => {
    const html = renderToStaticMarkup(
      <ClinicalRecordSource
        item={{
          source_document_id: "document-1",
          source_document_name: "Arztbrief.pdf",
          source_import_id: "import-1",
          source_page: 3,
        }}
        tx={tx}
      />,
    );

    expect(html).toContain('data-clinical-source="document"');
    expect(html).toContain("Из документа");
    expect(html).toContain("Arztbrief.pdf · S. 3");
    expect(html).toContain("Предпросмотр документа: Arztbrief.pdf");
    expect(html).toContain("<button");
  });
});
