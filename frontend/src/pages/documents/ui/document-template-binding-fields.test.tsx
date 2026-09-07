import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { DOCUMENT_BINDING_FIELDS } from "@/pages/documents/model/document-bindings";
import { DocumentTemplateBindingFields } from "@/pages/documents/ui/document-template-binding-fields";

describe("DocumentTemplateBindingFields", () => {
  it("renders every privacy-consent choice as an operator checkbox", () => {
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

    expect(markup.match(/type="checkbox"/g)).toHaveLength(7);
    expect(markup).toContain("Сбор, обработка и передача медицинских данных");
    expect(markup).toContain("Threema");
    expect(markup).toContain("WhatsApp");
    expect(markup).toContain("Telegram");
  });
});
