import { describe, expect, it } from "vitest";
import type { SignatureSummary } from "../data/use-signature-summary";
import { signaturePresentation, signatureStatusText } from "./signature-status";

describe("signatureStatusText", () => {
  it("names every request status in both languages instead of the raw key", () => {
    const statuses = [
      "submitting",
      "submission_unknown",
      "pending",
      "completed",
      "needs_review",
      "declined",
      "withdrawn",
      "expired",
      "error",
    ];
    for (const lang of ["ru", "de"]) {
      const labels = statuses.map((status) => signatureStatusText(status, lang));
      expect(new Set(labels).size).toBe(statuses.length);
      for (const [index, label] of labels.entries()) {
        expect(label).not.toBe(statuses[index]);
      }
    }
    expect(signatureStatusText("expired", "de")).toBe("Anfrage abgelaufen");
    expect(signatureStatusText("unexpected", "ru")).toBe("Требует проверки");
  });
});

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
