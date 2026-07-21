import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { formatDateTime } from "@/pages/leads/model/leads-model";

import { LeadWizardDocumentMetadata } from "./lead-wizard-document-metadata";

const createdAt = "2026-07-21T10:35:00Z";

describe("LeadWizardDocumentMetadata", () => {
  it("renders a generated document date-time pill immediately after the size", () => {
    const expectedDateTime = formatDateTime(createdAt, "de-DE", "");
    const html = renderToStaticMarkup(
      <LeadWizardDocumentMetadata
        lang="de"
        document={{
          id: "document-1",
          document_number: "DOC-1001",
          file_size: 5 * 1024,
          generated_template_id: "privacy_consents",
          created_at: createdAt,
        }}
      />,
    );

    expect(html.indexOf("5 KB")).toBeLessThan(html.indexOf(expectedDateTime));
    expect(html).toContain("data-generated-document-date");
    expect(html).toContain("border-sky-200");
    expect(html).toContain("bg-sky-50");
    expect(html).toContain("text-sky-700");
    expect(html).toContain("border-violet-200");
    expect(html).toContain("bg-violet-50");
    expect(html).toContain("text-violet-700");
    expect(html.indexOf("DOC-1001")).toBeLessThan(html.indexOf("5 KB"));
  });

  it("keeps uploaded document metadata free of a generation timestamp", () => {
    const html = renderToStaticMarkup(
      <LeadWizardDocumentMetadata
        lang="ru"
        document={{
          id: "upload-1",
          document_number: undefined,
          file_size: 5 * 1024,
          generated_template_id: null,
          created_at: createdAt,
        }}
      />,
    );

    expect(html).toContain("DOC-UPLOAD-1");
    expect(html).toContain("5 KB");
    expect(html).not.toContain("data-generated-document-date");
  });
});
