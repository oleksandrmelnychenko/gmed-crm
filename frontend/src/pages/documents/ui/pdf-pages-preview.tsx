import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import type { PDFDocumentLoadingTask, RenderTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

/**
 * The pages of a PDF drawn by the app itself (pdf.js), one under another.
 *
 * An `<iframe>` with a PDF depends on the browser's built-in viewer: where it
 * is missing or switched off the frame stays an empty white box (owner
 * report 2026-11-10, template import preview). This never does.
 */
export function PdfPagesPreview({
  data,
  pageLabel,
  failedLabel,
  className,
}: {
  /** The bytes of the PDF. A new buffer redraws the pages. */
  data: ArrayBuffer;
  /** Accessible name of a page, e.g. "PDF, страница". */
  pageLabel: string;
  failedLabel: string;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;
    const tasks = new Set<RenderTask>();
    const container = pagesRef.current;
    container?.replaceChildren();
    setState("loading");
    void (async () => {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      const resourcePath = import.meta.env.DEV
        ? "/node_modules/pdfjs-dist/"
        : `${import.meta.env.BASE_URL}pdfjs/${pdfjs.version}/`;
      const resources = new URL(resourcePath, window.location.href).href;
      loadingTask = pdfjs.getDocument({
        // pdf.js takes the buffer over: give it a copy, the caller keeps its own.
        data: data.slice(0),
        cMapUrl: `${resources}cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `${resources}standard_fonts/`,
        wasmUrl: `${resources}wasm/`,
        iccUrl: `${resources}iccs/`,
      });
      const pdf = await loadingTask.promise;
      const width = Math.max(1, Math.floor((hostRef.current?.clientWidth ?? 600) - 24));
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;
        const natural = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: width / natural.width });
        // Limit the backing store on large pages and high-DPI displays.
        const ratio = Math.min(
          window.devicePixelRatio || 1,
          2,
          Math.sqrt(16_000_000 / (viewport.width * viewport.height)),
        );
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.floor(viewport.width * ratio));
        canvas.height = Math.max(1, Math.floor(viewport.height * ratio));
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        canvas.className = "block bg-white shadow-sm";
        canvas.setAttribute("role", "img");
        canvas.setAttribute("aria-label", `${pageLabel} ${pageNumber}`);
        canvas.dataset.pdfPage = String(pageNumber);
        container?.append(canvas);
        const task = page.render({ canvas, viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
        tasks.add(task);
        await task.promise;
        tasks.delete(task);
        if (cancelled) return;
      }
      setState("ready");
    })().catch(() => {
      if (!cancelled) setState("failed");
    });
    return () => {
      cancelled = true;
      tasks.forEach((task) => task.cancel());
      if (loadingTask) void loadingTask.destroy();
    };
  }, [data, pageLabel]);

  return (
    <div
      ref={hostRef}
      data-testid="pdf-pages-preview"
      data-state={state}
      className={className}
    >
      {state === "loading" ? (
        <p className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
        </p>
      ) : null}
      {state === "failed" ? (
        <p role="alert" className="px-3 py-6 text-center text-sm text-rose-700">
          {failedLabel}
        </p>
      ) : null}
      <div ref={pagesRef} className="flex flex-col items-center gap-3" />
    </div>
  );
}
