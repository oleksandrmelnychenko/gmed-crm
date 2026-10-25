import { describe, expect, it } from "vitest";

import {
  attachmentImportRefusalLabel,
  attachmentImportRefusalText,
  refusedLeadAttachments,
} from "./lead-attachment-import";

const ru = (r: string) => r;
const de = (_r: string, d: string) => d;

function attachment(overrides: Record<string, unknown> = {}) {
  return {
    id: "a1",
    file_name: "photo.jpg",
    content_type: "image/jpeg",
    size_bytes: 10,
    uploaded_at: "2026-10-25T08:00:00Z",
    ...overrides,
  };
}

describe("questionnaire attachment import refusals", () => {
  it("names the known codes in RU and DE and keeps an unknown one readable", () => {
    expect(attachmentImportRefusalText("unsupported_file_type", ru)).toBe("Тип файла не поддерживается");
    expect(attachmentImportRefusalText("unsupported_file_type", de)).toBe("Dateityp wird nicht unterstützt");
    expect(attachmentImportRefusalText("file_rejected", ru)).toBe("Файл отклонён проверкой");
    expect(attachmentImportRefusalText("something_else", ru)).toBe("Файл не импортирован");
    expect(attachmentImportRefusalText(null, de)).toBe("Datei nicht übernommen");
  });

  it("marks only a refused, not imported row", () => {
    expect(attachmentImportRefusalLabel(attachment(), ru)).toBeNull();
    expect(attachmentImportRefusalLabel(attachment({ imported_at: "2026-10-25T08:01:00Z" }), ru)).toBeNull();
    expect(attachmentImportRefusalLabel(
      attachment({ import_refused_at: "2026-10-25T08:01:00Z", import_refusal_code: "unsupported_file_type" }),
      ru,
    )).toBe("не импортирован — Тип файла не поддерживается");
  });

  it("joins the persisted refusals with the answer of the import that just ran", () => {
    const rows = refusedLeadAttachments(
      [
        attachment({ import_refused_at: "2026-10-25T08:01:00Z", import_refusal_code: "file_rejected" }),
        attachment({ id: "a2", file_name: "scan.pdf", imported_at: "2026-10-25T08:01:00Z" }),
        attachment({ id: "a3", file_name: "pending.pdf" }),
      ],
      [{ id: "a3", file_name: "pending.pdf", code: "unsupported_file_type" }, { id: "a1", file_name: "photo.jpg", code: "file_rejected" }],
    );
    expect(rows).toEqual([
      { id: "a1", file_name: "photo.jpg", code: "file_rejected" },
      { id: "a3", file_name: "pending.pdf", code: "unsupported_file_type" },
    ]);
    expect(refusedLeadAttachments(undefined, undefined)).toEqual([]);
  });
});
