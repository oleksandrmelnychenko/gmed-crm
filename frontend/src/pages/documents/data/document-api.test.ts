import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiFetch, apiFetchFile } from "@/lib/api";

import {
  createDocumentPreviewObjectUrl,
  documentPreviewSandbox,
  downloadDocumentFile,
  fetchDocumentListPage,
  openDocumentPreview,
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
    expect(documentPreviewSandbox("text/plain;charset=utf-8")).toBe("");
    expect(documentPreviewSandbox("image/png")).toBe("");
    // Nothing else is rendered: the frame may only start a download.
    expect(documentPreviewSandbox("application/octet-stream")).toBe("allow-downloads");
    expect(documentPreviewSandbox("text/html")).toBe("allow-downloads");
    expect(documentPreviewSandbox("image/svg+xml")).toBe("allow-downloads");
    expect(documentPreviewSandbox(undefined)).toBe("allow-downloads");
  });

  it.each([
    ["text/html", "<script>alert(1)</script>"],
    ["application/xhtml+xml", "<html xmlns='http://www.w3.org/1999/xhtml'/>"],
    ["application/xml", "<a/>"],
    ["text/xml; charset=utf-8", "<a/>"],
    ["application/rss+xml", "<rss/>"],
    ["application/mathml+xml", "<math/>"],
    ["text/javascript", "alert(1)"],
    ["text/csv", "a;b"],
    ["application/json", "{}"],
  ])("shows %s as plain text", async (contentType, body) => {
    apiFetchFileMock.mockResolvedValue({ blob: new Blob([body], { type: contentType }), contentType });

    const preview = await createDocumentPreviewObjectUrl("textual");

    expect(preview.contentType).toBe("text/plain;charset=utf-8");
    expect(await previewBlob?.text()).toBe(body);
  });

  it.each([
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/x-shockwave-flash",
    "multipart/related",
    "video/mp4",
    "",
  ])("offers the unlisted type %j as a download only", async (contentType) => {
    apiFetchFileMock.mockResolvedValue({ blob: new Blob(["<html>"], { type: "text/html" }), contentType });

    const preview = await createDocumentPreviewObjectUrl("binary");

    expect(preview.contentType).toBe("application/octet-stream");
    expect(previewBlob?.type).toBe("application/octet-stream");
  });

  it("keeps listed images and types the blob itself, whatever the response blob said", async () => {
    apiFetchFileMock.mockResolvedValue({
      blob: new Blob(["png"], { type: "text/html" }),
      contentType: "IMAGE/PNG; q=1",
    });

    const preview = await createDocumentPreviewObjectUrl("image");

    expect(preview.contentType).toBe("image/png");
    expect(previewBlob?.type).toBe("image/png");
  });

  it("does not render a file that claims to be a PDF but is not one", async () => {
    apiFetchFileMock.mockResolvedValue({
      blob: new Blob(["<html><script>alert(1)</script>"], { type: "application/pdf" }),
      contentType: "application/pdf",
    });

    const preview = await createDocumentPreviewObjectUrl("fake-pdf");

    expect(preview.contentType).toBe("application/octet-stream");
  });

  it("keeps a declared text charset and adds UTF-8 when none is given", async () => {
    apiFetchFileMock.mockResolvedValue({ blob: new Blob(["x"]), contentType: "text/plain; charset=Windows-1251" });
    expect((await createDocumentPreviewObjectUrl("t1")).contentType).toBe("text/plain;charset=windows-1251");
    apiFetchFileMock.mockResolvedValue({ blob: new Blob(["x"]), contentType: "text/plain" });
    expect((await createDocumentPreviewObjectUrl("t2")).contentType).toBe("text/plain;charset=utf-8");
  });

  it("opens its own tab without noopener and detaches it before navigating", async () => {
    const opened = { opener: {} as unknown, location: { href: "" }, close: vi.fn() };
    const openSpy = vi.fn(() => opened);
    vi.stubGlobal("window", { open: openSpy, setTimeout: vi.fn() });
    apiFetchFileMock.mockResolvedValue({
      blob: new Blob(["%PDF-1.7"], { type: "application/pdf" }),
      contentType: "application/pdf",
    });

    await openDocumentPreview("document-3", "blocked");

    expect(openSpy).toHaveBeenCalledWith("", "_blank");
    expect(opened.opener).toBeNull();
    expect(opened.location.href).toBe("blob:inline-preview");
  });

  it("reports a blocked popup", async () => {
    vi.stubGlobal("window", { open: vi.fn(() => null), setTimeout: vi.fn() });
    apiFetchFileMock.mockResolvedValue({
      blob: new Blob(["%PDF-1.7"], { type: "application/pdf" }),
      contentType: "application/pdf",
    });

    await expect(openDocumentPreview("document-4", "blocked")).rejects.toThrow("blocked");
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
      blob: new Blob(["%PDF-1.7"], { type: "application/pdf" }),
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
      blob: new Blob(["%PDF-1.7"], { type: "application/pdf" }),
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

describe("document list paging", () => {
  const apiFetchMock = vi.mocked(apiFetch);

  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  it("asks for a page past the loaded documents and reports more", async () => {
    apiFetchMock.mockResolvedValue({ items: [{ id: "a" }], offset: 300, has_more: true });
    const page = await fetchDocumentListPage("/documents?search=Arzt", 300);
    expect(apiFetchMock).toHaveBeenCalledWith(
      "/documents?search=Arzt&paged=true&offset=300&limit=300",
    );
    expect(page).toEqual({ items: [{ id: "a" }], offset: 300, has_more: true });
  });

  it("takes a plain list as the last page", async () => {
    apiFetchMock.mockResolvedValue([{ id: "a" }, { id: "b" }]);
    const page = await fetchDocumentListPage("/documents", 0);
    expect(apiFetchMock).toHaveBeenCalledWith("/documents?paged=true&offset=0&limit=300");
    expect(page).toEqual({ items: [{ id: "a" }, { id: "b" }], offset: 0, has_more: false });
  });
});
