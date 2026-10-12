import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { DOCUMENT_BINDING_FIELDS } from "@/pages/documents/model/document-bindings";
import { DocumentTemplateBindingFields } from "@/pages/documents/ui/document-template-binding-fields";

describe("DocumentTemplateBindingFields", () => {
  it("offers staff no consent-option checkbox for the consent form, only recipients and signing place", () => {
    // Only the person's own choice in the cabinet ticks the form's boxes (2026-10-12).
    const markup = renderToStaticMarkup(
      <LocalizationProvider dateAdapter={AdapterDayjs}>
        <DocumentTemplateBindingFields
          fields={DOCUMENT_BINDING_FIELDS.privacy_consents}
          bindings={{}}
          lang="ru"
          templateId="privacy_consents"
          onChange={vi.fn()}
        />
      </LocalizationProvider>,
    );

    expect(markup).not.toContain('type="checkbox"');
    expect(markup).not.toContain("Сбор, обработка и передача медицинских данных");
    expect(markup).not.toContain("WhatsApp");
    expect(markup).toContain("Дополнительные получатели данных");
    expect(markup).toContain("Место подписания");
  });
});
