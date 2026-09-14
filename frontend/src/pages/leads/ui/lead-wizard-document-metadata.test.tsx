import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { formatDateTime } from "@/pages/leads/model/leads-model";

import {
  LeadWizardDocumentMetadata,
  leadWizardDocumentNumber,
  leadWizardDocumentTotal,
  sortWizardDocumentsNewestFirst,
} from "./lead-wizard-document-metadata";

const createdAt = "2026-07-21T10:35:00Z";

describe("LeadWizardDocumentMetadata", () => {
  it("orders every wizard document list from newest to oldest without mutating it", () => {
    const documents = [
      { id: "older", created_at: "2026-09-04T13:43:00Z" },
      { id: "newer", created_at: "2026-09-14T17:46:00Z" },
      { id: "invalid", created_at: "" },
    ] as const;

    expect(sortWizardDocumentsNewestFirst(documents).map((document) => document.id))
      .toEqual(["newer", "older", "invalid"]);
    expect(documents.map((document) => document.id))
      .toEqual(["older", "newer", "invalid"]);
  });

  it("hides the technical version suffix from business document numbers", () => {
    expect(leadWizardDocumentNumber({ id: "framework", document_number: "FC-20260714-0010-V18" }))
      .toBe("FC-20260714-0010");
    expect(leadWizardDocumentNumber({ id: "quote", document_number: "KV-20260721-0019-V01" }))
      .toBe("KV-20260721-0019");
  });

  it("keeps the preliminary cost estimate own document number", () => {
    expect(leadWizardDocumentNumber({
      id: "preliminary",
      document_number: "VKS-20260727-A1B2C3D4E5F6",
    })).toBe("VKS-20260727-A1B2C3D4E5F6");
  });

  it("reads the immutable total stored with the generated document", () => {
    expect(leadWizardDocumentTotal({
      generated_template_id: "order_cost_estimate",
      generated_bindings: { estimate_total: " 2.735,81 EUR " },
    })).toBe("2.735,81 EUR");
    expect(leadWizardDocumentTotal({
      generated_template_id: "cost_estimate",
      generated_bindings: { estimate_total: "" },
    })).toBeNull();
    expect(leadWizardDocumentTotal({
      generated_template_id: "cost_estimate",
      generated_bindings: null,
    })).toBeNull();
  });

  it("does not show a total on the order document", () => {
    expect(leadWizardDocumentTotal({
      generated_template_id: "single_order",
      generated_bindings: { estimate_total: "1.463,70 EUR" },
    })).toBeNull();
  });

  it("shows a generated document total as a prominent metadata chip", () => {
    const html = renderToStaticMarkup(
      <LeadWizardDocumentMetadata
        lang="ru"
        document={{
          id: "quote-1",
          document_number: "KV-20260913-0033",
          file_size: 1.9 * 1024 * 1024,
          generated_template_id: "order_cost_estimate",
          generated_bindings: { estimate_total: "2.735,81 EUR" },
          created_at: createdAt,
        }}
      />,
    );

    expect(html).toContain("data-generated-document-total");
    expect(html).toContain("Итого: 2.735,81 EUR");
    expect(html).toContain("border-amber-200");
    expect(html.indexOf("KV-20260913-0033")).toBeLessThan(html.indexOf("Итого: 2.735,81 EUR"));
    expect(html.indexOf("Итого: 2.735,81 EUR")).toBeLessThan(html.indexOf("1,9 MB"));
  });

  it("distinguishes document versions while retaining the business number", () => {
    const html = renderToStaticMarkup(
      <LeadWizardDocumentMetadata
        lang="ru"
        document={{
          id: "framework-v2",
          document_number: "FC-20260714-0010-V02",
          version_number: 2,
          version_count: 3,
          is_latest_version: false,
          file_size: 2048,
          generated_bindings: null,
          generated_template_id: "framework_contract",
          created_at: createdAt,
        }}
      />,
    );
    expect(html).toContain("FC-20260714-0010");
    expect(html).toContain("Версия 2 · предыдущая");
  });

  it("renders a generated document date-time pill immediately after the size", () => {
    const expectedDateTime = formatDateTime(createdAt, "de-DE", "");
    const html = renderToStaticMarkup(
      <LeadWizardDocumentMetadata
        lang="de"
        document={{
          id: "document-1",
          document_number: "DOC-1001",
          file_size: 5 * 1024,
          generated_bindings: null,
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
          generated_bindings: null,
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
