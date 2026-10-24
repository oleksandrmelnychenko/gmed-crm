import { describe, expect, it } from "vitest";

import { ApiRequestError } from "@/lib/api";

import { LEAD_UPLOAD_ACCEPT } from "./lead-request-model";
import { errorMessage } from "./lead-request-parts";
import { leadRequestText } from "./lead-request-text";

function refusal(status: number, body: Record<string, unknown>) {
  return new ApiRequestError("refused", { status, code: String(body.code), body: body as never });
}

describe("cabinet uploads (owner 2026-10-24)", () => {
  it("offers exactly the types the server takes (lead_portal_intake.rs LEAD_UPLOAD_ACCEPT)", () => {
    expect(LEAD_UPLOAD_ACCEPT).toBe(".pdf,.jpg,.jpeg,.png");
  });

  it("says how to send an iPhone photo, that a file is already there, and why a file is refused", () => {
    const text = leadRequestText("ru");
    expect(errorMessage(refusal(422, { code: "unsupported_file_type", format: "heic" }), text)).toBe(text.errors.heic_not_supported);
    expect(errorMessage(refusal(422, { code: "unsupported_file_type" }), text)).toBe(text.errors.unsupported_file_type);
    expect(errorMessage(refusal(409, { code: "duplicate_document" }), text)).toBe("Этот файл уже загружен.");
    expect(errorMessage(refusal(422, { code: "file_rejected" }), text)).toBe(text.errors.file_rejected);
  });
});

describe("the upload limit", () => {
  it("names the limit the server states, in every language, and never a number of its own", () => {
    for (const lang of ["de", "ru", "uk", "en"] as const) {
      const text = leadRequestText(lang);
      const message = errorMessage(refusal(422, { code: "too_many_documents", max_documents: 12 }), text);
      expect(message).toBe(text.tooManyDocuments(12));
      expect(message).toContain("12");
      // An older server without the number: the fixed sentence, which names no number.
      expect(errorMessage(refusal(422, { code: "too_many_documents" }), text)).toBe(text.errors.too_many_documents);
      expect(text.errors.too_many_documents).not.toMatch(/\d/);
    }
  });
});
