import { describe, expect, it } from "vitest";
import type { SignatureSummary } from "../data/use-signature-summary";
import { signaturePresentation } from "./signature-status";

describe("signaturePresentation", () => {
  it("shows the verified document state ahead of an older failed request", () => {
    const staleRequest: SignatureSummary = {
      document_id: "document-1",
      status: "needs_review",
      test_mode: false,
      result_document_id: null,
    };

    const presentation = signaturePresentation(staleRequest, "ru", true);

    expect(presentation.label).toBe("Подписано");
    expect(presentation.className).toContain("text-emerald-700");
  });
});
