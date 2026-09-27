import { describe, expect, it } from "vitest";

import { canAttachToConciergeTask } from "./model";
import {
  canRemoveTaskAttachment,
  formatTaskAttachmentSize,
  filesMissingFromTaskAttachments,
  mergeTaskAttachmentFiles,
  TASK_ATTACHMENT_MAX_BYTES,
  taskAttachmentValidationError,
} from "./task-attachments";

describe("task attachment permissions", () => {
  const task = { assigned_to: "assignee", assigned_by: "creator", assigned_by_role: "patient_manager" };

  it("lets the assignee attach files to its own task", () => {
    expect(canAttachToConciergeTask(task, "assignee", "concierge")).toBe(true);
    expect(canAttachToConciergeTask(task, "creator", "patient_manager")).toBe(true);
    expect(canAttachToConciergeTask(task, "someone-else", "concierge")).toBe(false);
    expect(canAttachToConciergeTask(task, null, "concierge")).toBe(false);
  });

  it("lets the assignee remove only its own uploads", () => {
    const assigneeAccess = { canModify: false, canUpload: true, currentUserId: "assignee" };
    expect(canRemoveTaskAttachment({ uploaded_by: "assignee" }, assigneeAccess)).toBe(true);
    expect(canRemoveTaskAttachment({ uploaded_by: "creator" }, assigneeAccess)).toBe(false);
    expect(canRemoveTaskAttachment({ uploaded_by: "assignee" }, { canModify: true })).toBe(true);
    expect(canRemoveTaskAttachment({ uploaded_by: "assignee" }, { canModify: false })).toBe(false);
  });
});

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
