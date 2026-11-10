import { describe, expect, it } from "vitest";

import {
  isTemplateImportFileName,
  parseTemplateLine,
  templateLabelFromFileName,
} from "../data/template-import-api";
import {
  isDesignedAgencyDocumentTemplate,
  isImportedAgencyTemplateId,
} from "./document-bindings";
import {
  buildGenerateDocumentPayload,
  documentTemplateSupportsAppointmentContext,
  documentTemplateSupportsOrderContext,
  emptyGenerateForm,
} from "./document-model";
import type { DocumentTemplate } from "./types";

const IMPORTED_ID = "agency_template:5b0c2f0e-3d0b-4c58-9a51-0f6f1f3b7a11";

const importedTemplate: DocumentTemplate = {
  id: IMPORTED_ID,
  template_kind: "agency",
  lead_only: false,
  label: "Bescheinigung",
  description: "",
  art: "free_text_document",
  category: "administrative",
  default_auto_name: "Bescheinigung",
  default_status: "draft",
  default_visibility: "internal",
  is_medical: false,
  supported_languages: ["de"],
  text_block_keys: [],
};

describe("imported agency templates", () => {
  it("are recognised by their id", () => {
    expect(isImportedAgencyTemplateId(IMPORTED_ID)).toBe(true);
    expect(isImportedAgencyTemplateId("provider_template:1")).toBe(false);
    expect(isImportedAgencyTemplateId("free_text_document")).toBe(false);
    expect(isImportedAgencyTemplateId(null)).toBe(false);
  });

  it("take the order and the appointment as context", () => {
    expect(documentTemplateSupportsOrderContext(IMPORTED_ID)).toBe(true);
    expect(documentTemplateSupportsAppointmentContext(IMPORTED_ID)).toBe(true);
  });

  // The server fills the template text: a text typed for another template
  // earlier in the dialog must never replace it.
  it("never send free text, title or notes fields of the dialog", () => {
    expect(isDesignedAgencyDocumentTemplate(IMPORTED_ID)).toBe(true);
    const payload = buildGenerateDocumentPayload({
      template: importedTemplate,
      form: {
        ...emptyGenerateForm("p1"),
        templateId: IMPORTED_ID,
        manualText: "Text of another template",
        manualTextDirty: true,
        titleOverride: "Other title",
        introduction: "Intro",
        closingNote: "Closing",
      },
      displayedManualText: "Text of another template",
    });
    expect(payload).toMatchObject({
      template_id: IMPORTED_ID,
      patient_id: "p1",
      manual_text: null,
      title_override: null,
      introduction: null,
      closing_note: null,
    });
  });
});

describe("template import file", () => {
  it("accepts Word and text files only", () => {
    expect(isTemplateImportFileName("Bescheinigung.docx")).toBe(true);
    expect(isTemplateImportFileName("brief.TXT")).toBe(true);
    expect(isTemplateImportFileName("vertrag.pdf")).toBe(false);
    expect(isTemplateImportFileName("alt.doc")).toBe(false);
    expect(isTemplateImportFileName("docx")).toBe(false);
  });

  it("names the template after the file", () => {
    expect(templateLabelFromFileName("Bescheinigung_Aufenthalt.docx")).toBe(
      "Bescheinigung Aufenthalt",
    );
    expect(templateLabelFromFileName(" brief.v2.txt ")).toBe("brief.v2");
  });
});

describe("template line marks", () => {
  it("mirror the server's marks", () => {
    expect(parseTemplateLine("# Titel")).toEqual({ kind: "heading", bold: true, text: "Titel" });
    expect(parseTemplateLine(">> Datum: {{today}}")).toEqual({
      kind: "right",
      bold: false,
      text: "Datum: {{today}}",
    });
    expect(parseTemplateLine(">< **Mitte**")).toEqual({ kind: "center", bold: true, text: "Mitte" });
    expect(parseTemplateLine("**Fett**")).toEqual({ kind: "plain", bold: true, text: "Fett" });
    expect(parseTemplateLine("#1 Nummer")).toEqual({ kind: "plain", bold: false, text: "#1 Nummer" });
    expect(parseTemplateLine("Ein **Wort** fett")).toEqual({
      kind: "plain",
      bold: false,
      text: "Ein **Wort** fett",
    });
    expect(parseTemplateLine("****")).toEqual({ kind: "plain", bold: false, text: "****" });
  });
});
