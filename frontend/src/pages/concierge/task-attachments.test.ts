import { describe, expect, it } from "vitest";

import {
  formatTaskAttachmentSize,
  filesMissingFromTaskAttachments,
  mergeTaskAttachmentFiles,
  TASK_ATTACHMENT_MAX_BYTES,
  taskAttachmentValidationError,
} from "./task-attachments";

describe("task attachments", () => {
  it("accepts PDF, image and Word files", () => {
    for (const name of ["scan.pdf", "photo.JPG", "image.webp", "letter.doc", "letter.docx"]) {
      expect(taskAttachmentValidationError({ name, size: 1024 })).toBeNull();
    }
  });

  it("rejects unsupported and oversized files", () => {
    expect(taskAttachmentValidationError({ name: "archive.zip", size: 1024 })).toBe("type");
    expect(taskAttachmentValidationError({ name: "scan.pdf", size: TASK_ATTACHMENT_MAX_BYTES + 1 })).toBe("size");
  });

  it("formats attachment sizes for the file list", () => {
    expect(formatTaskAttachmentSize(512)).toBe("512 B");
    expect(formatTaskAttachmentSize(2048)).toBe("2 KB");
    expect(formatTaskAttachmentSize(1.5 * 1024 * 1024)).toBe("1.5 MB");
  });

  it("keeps staged create files stable and removes duplicate selections", () => {
    const first = new File(["one"], "scan.pdf", { type: "application/pdf", lastModified: 10 });
    const duplicate = new File(["one"], "scan.pdf", { type: "application/pdf", lastModified: 10 });
    const second = new File(["two"], "letter.docx", { lastModified: 20 });
    expect(mergeTaskAttachmentFiles([first], [duplicate, second])).toEqual([first, second]);
    expect(filesMissingFromTaskAttachments([first, second], [{
      id: "attachment-1",
      file_name: "scan.pdf",
      mime_type: "application/pdf",
      file_size: first.size,
      uploaded_by: "user-1",
      uploaded_by_name: "User",
      created_at: "2026-08-23T12:00:00.000Z",
    }])).toEqual([second]);
  });
});
