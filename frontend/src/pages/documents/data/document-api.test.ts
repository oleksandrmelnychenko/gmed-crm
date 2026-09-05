import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiFetchFile } from "@/lib/api";

import {
  createDocumentPreviewObjectUrl,
  documentPreviewSandbox,
  downloadDocumentFile,
  revokeDocumentPreviewObjectUrl,
} from "./document-api";

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(),
  apiFetchFile: vi.fn(),
}));

const apiFetchFileMock = vi.mocked(apiFetchFile);

describe("document preview API", () => {
  let createObjectUrlSpy: ReturnType<typeof vi.spyOn>;
  let revokeObjectUrlSpy: ReturnType<typeof vi.spyOn>;
  let previewBlob: Blob | null;

  beforeEach(() => {
    previewBlob = null;
    createObjectUrlSpy = vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      previewBlob = blob;
      return "blob:inline-preview";
    });
    revokeObjectUrlSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    apiFetchFileMock.mockReset();
  });

  it("does not fully sandbox Chromium PDF previews", () => {
    expect(documentPreviewSandbox("application/pdf")).toBeUndefined();
    expect(documentPreviewSandbox("application/pdf; charset=binary")).toBeUndefined();
    expect(documentPreviewSandbox("text/plain")).toBe("");
  });

  afterEach(() => {
    vi.useRealTimers();
    createObjectUrlSpy.mockRestore();
    revokeObjectUrlSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("creates an inline object URL for PDF previews without opening a popup", async () => {
    const openSpy = vi.fn();
    vi.stubGlobal("window", { open: openSpy });
    apiFetchFileMock.mockResolvedValue({
      blob: new Blob(["%PDF"], { type: "application/pdf" }),
      contentType: "application/pdf",
    });

    const preview = await createDocumentPreviewObjectUrl("document-1");

    expect(apiFetchFileMock).toHaveBeenCalledWith("/documents/document-1/download", {
      cache: "no-store",
    });
    expect(openSpy).not.toHaveBeenCalled();
    expect(preview).toEqual({
      contentType: "application/pdf",
      url: "blob:inline-preview",
    });
    expect(previewBlob?.type).toBe("application/pdf");
  });

  it("neutralizes legacy active content before creating a preview URL", async () => {
    apiFetchFileMock.mockResolvedValue({
      blob: new Blob(["<svg onload='alert(1)'></svg>"], { type: "image/svg+xml" }),
      contentType: "image/svg+xml",
    });

    const preview = await createDocumentPreviewObjectUrl("legacy-active-document");

    expect(preview.contentType).toBe("text/plain;charset=utf-8");
    expect(previewBlob?.type).toBe("text/plain;charset=utf-8");
    expect(await previewBlob?.text()).toContain("<svg");
  });

  it("revokes inline preview URLs when the viewer closes", () => {
    revokeDocumentPreviewObjectUrl("blob:inline-preview");

    expect(revokeObjectUrlSpy).toHaveBeenCalledWith("blob:inline-preview");
  });

  it("reopens a stored binary XML invoice as plain text without changing its bytes", async () => {
    const original = '<Invoice><Note>&lt;img src=x onerror=alert(1)&gt;</Note></Invoice>';
    apiFetchFileMock.mockResolvedValue({ blob: new Blob([original], { type: "application/octet-stream" }), contentType: "application/octet-stream", filename: "invoice.XML" });
    const preview = await createDocumentPreviewObjectUrl("xml-invoice");
    expect(preview.contentType).toBe("text/plain;charset=utf-8");
    expect(await previewBlob?.text()).toBe(original);
  });

  it("downloads generated PDFs with a PDF extension and delays URL revocation", async () => {
    vi.useFakeTimers();
    apiFetchFileMock.mockResolvedValue({
      blob: new Blob(["%PDF"], { type: "application/pdf" }),
      contentType: "application/pdf",
    });
    const link = {
      click: vi.fn(),
      download: "",
      href: "",
      remove: vi.fn(),
    };
    vi.stubGlobal("document", {
      body: { appendChild: vi.fn() },
      createElement: vi.fn(() => link),
    });
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout.bind(globalThis),
    });

    await downloadDocumentFile("document-2", "Kostenvoranschlag.docx");

    expect(link.download).toBe("Kostenvoranschlag.pdf");
    expect(link.click).toHaveBeenCalledOnce();
    expect(revokeObjectUrlSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000);

    expect(revokeObjectUrlSpy).toHaveBeenCalledWith("blob:inline-preview");
  });
});
