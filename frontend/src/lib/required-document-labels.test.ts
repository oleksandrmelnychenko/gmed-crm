import { describe, expect, it } from "vitest";

import { localizeDocumentCode } from "./required-document-labels";

describe("required document labels", () => {
  it("localizes the uploaded document backend code", () => {
    const l = (key: string) =>
      key === "required_doc_uploaded_document" ? "Загруженный документ" : key;

    expect(localizeDocumentCode("uploaded_document", l)).toBe(
      "Загруженный документ",
    );
  });
});
