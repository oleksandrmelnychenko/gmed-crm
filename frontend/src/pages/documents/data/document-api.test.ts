import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiFetchFile } from "@/lib/api";

import {
  createDocumentPreviewObjectUrl,
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

    expect(apiFetchFileMock).toHaveBeenCalledWith("/documents/document-1/download");
    expect(openSpy).not.toHaveBeenCalled();
    expect(preview).toEqual({
      contentType: "application/pdf",
      url: "blob:inline-preview",
    });
    expect(previewBlob?.type).toBe("application/pdf");
  });

  it("revokes inline preview URLs when the viewer closes", () => {
    revokeDocumentPreviewObjectUrl("blob:inline-preview");

    expect(revokeObjectUrlSpy).toHaveBeenCalledWith("blob:inline-preview");
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
