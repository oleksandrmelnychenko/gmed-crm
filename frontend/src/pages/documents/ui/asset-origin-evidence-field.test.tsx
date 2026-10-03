import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AssetOriginEvidenceField } from "@/pages/documents/ui/asset-origin-evidence-field";

vi.mock("@/pages/documents/data/document-api", () => ({ uploadDocument: vi.fn() }));

describe("AssetOriginEvidenceField", () => {
  it("lists the attached proofs with a way to take each out of the form", () => {
    const markup = renderToStaticMarkup(
      <AssetOriginEvidenceField
        value={[
          { documentId: "doc-1", filename: "Kontoauszug.pdf" },
          { documentId: "doc-2", filename: "" },
        ]}
        subject={{ leadId: "lead-1" }}
        lang="de"
        onChange={vi.fn()}
      />,
    );
    expect(markup).toContain("Nachweise zur Herkunft der Vermögenswerte");
    expect(markup).toContain("Dateien hochladen");
    expect(markup).toContain("Kontoauszug.pdf");
    expect(markup).toContain('aria-label="Entfernen: Kontoauszug.pdf"');
    expect(markup).toContain(">Dokument<");
    expect(markup).not.toContain("Wählen Sie zuerst den Patienten aus.");
    expect(markup).toContain('accept=".pdf,.jpg,.jpeg,.png"');
  });

  it("cannot upload before a patient or lead is known", () => {
    const markup = renderToStaticMarkup(
      <AssetOriginEvidenceField value={[]} subject={{ patientId: "" }} lang="ru" onChange={vi.fn()} />,
    );
    expect(markup).toContain("Сначала выберите пациента.");
    expect(markup).toMatch(/<input[^>]*disabled=""/);
    expect(markup).not.toContain("<ul");
  });
});
