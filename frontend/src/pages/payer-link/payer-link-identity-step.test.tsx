import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { PayerQuestionnaire } from "./payer-link-api";
import type { StepContext, UploadControl } from "./payer-link-fields";
import { ID_DOCUMENT_DATA_FIELDS, draftFromQuestionnaire, isIdDocumentDataField } from "./payer-link-model";
import { IdentityStep } from "./payer-link-steps";
import { payerLinkText } from "./payer-link-text";

// Owner 2026-11-21: the payer's own link asks for the photo or scan of the identity document
// only; staff enter its data (type, number, authority, country, dates).

const uploads: UploadControl = { documents: [], busy: false, errors: [], upload: () => undefined, remove: () => undefined };

function render(documentData: boolean, lang: "ru" | "de" | "uk" = "ru") {
  const text = payerLinkText(lang);
  const draft = draftFromQuestionnaire({ answers: {}, payment_route: null } as unknown as PayerQuestionnaire);
  const context: StepContext = {
    form: { draft, set: () => undefined, update: () => undefined, errorFor: () => undefined },
    text,
    lang,
    payerType: "person",
    required: () => true,
    fundsSources: [],
    documentData,
  };
  return renderToStaticMarkup(
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <IdentityStep context={context} uploads={uploads} />
    </LocalizationProvider>,
  );
}

describe("the payer's identity step", () => {
  it("asks the payer for the copy only", () => {
    for (const lang of ["ru", "de", "uk"] as const) {
      const html = render(false, lang);
      expect(html).toContain("payer-link-identity-upload");
      for (const field of ID_DOCUMENT_DATA_FIELDS) expect(html).not.toContain(`id="payer-link-${field}"`);
      expect(html).not.toMatch(/выставк|виставк/i);
    }
  });

  it("keeps the data fields for staff copying the paper form", () => {
    const html = render(true);
    expect(html).toContain('id="payer-link-id_document_number"');
    expect(html).toContain("Страна выдачи");
  });

  it("knows the six data fields, never the upload", () => {
    expect(ID_DOCUMENT_DATA_FIELDS.every(isIdDocumentDataField)).toBe(true);
    expect(isIdDocumentDataField("id_document_upload")).toBe(false);
  });
});
