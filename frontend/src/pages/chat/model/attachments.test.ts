import { describe, expect, it } from "vitest";
import { CHAT_ATTACHMENT_MAX_BYTES, chatAttachmentMime, chatAttachmentPreviewKind, chatAttachmentProblem } from "./attachments";

describe("chat attachments", () => {
  it("accepts the server's file allowlist regardless of extension case", () => {
    for (const extension of ["pdf", "png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "txt", "csv", "doc", "docx", "xls", "xlsx", "dcm"]) {
      expect(chatAttachmentProblem({ name: `report.${extension.toUpperCase()}`, size: 10 })).toBeNull();
    }
  });
  it("rejects executable and extensionless files even if their name resembles a type", () => {
    for (const name of ["report.pdf.exe", "report.html", "report.constructor", "report.__proto__", "pdf", ".pdf", "report.", ""]) {
      expect(chatAttachmentProblem({ name, size: 1 })).toBe("type");
    }
  });
  it("uses the same inclusive size boundary as the upload API", () => {
    expect(chatAttachmentProblem({ name: "report.pdf", size: CHAT_ATTACHMENT_MAX_BYTES })).toBeNull();
    expect(chatAttachmentProblem({ name: "report.pdf", size: CHAT_ATTACHMENT_MAX_BYTES + 1 })).toBe("size");
  });
  it("validates UTF-8 filename bytes and rejects path/control characters", () => {
    expect(chatAttachmentProblem({ name: `${"я".repeat(125)}.pdf`, size: 1 })).toBeNull();
    for (const name of [`${"я".repeat(126)}.pdf`, "../report.pdf", "folder\\report.pdf", "report\n.pdf"]) {
      expect(chatAttachmentProblem({ name, size: 1 })).toBe("name");
    }
  });
  it("derives preview MIME from the filename rather than untrusted upload MIME", () => {
    expect(chatAttachmentMime("REPORT.PDF")).toBe("application/pdf");
    expect(chatAttachmentMime("report.txt")).toBe("text/plain");
    expect(chatAttachmentMime("report.html")).toBe("application/octet-stream");
    expect(chatAttachmentPreviewKind("report.txt")).toBe("text");
    expect(chatAttachmentPreviewKind("photo.png")).toBe("image");
    expect(chatAttachmentPreviewKind("report.pdf")).toBe("pdf");
    expect(chatAttachmentPreviewKind("report.docx")).toBeNull();
    expect(chatAttachmentPreviewKind("photo.heic")).toBeNull();
    expect(chatAttachmentPreviewKind("report.html")).toBeNull();
  });
});
