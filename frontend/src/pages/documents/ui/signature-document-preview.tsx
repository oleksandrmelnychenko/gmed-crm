import { useEffect, useId, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, FileText, LoaderCircle, Minus, Plus } from "lucide-react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { Button } from "@/components/ui/button";
import { apiFetchFile } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { signaturePreviewError, signaturePreviewErrorMessage, type SignaturePreviewError } from "./signature-preview-error";

export type SignaturePreviewSource = { id: string; title: string; kind: "signing" | "review" };
// `packageDocuments` lists every PDF of one signing package, in sending order.
// They render as one continuous scroll; `onReady` reports each of them.
type Props = { documentId: string; onReady: (id: string) => void; packageDocuments?: SignaturePreviewSource[] };
type LoadedPdf = { source: SignaturePreviewSource | null; id: string; pdf: PDFDocumentProxy };

const DEFAULT_ZOOM = 0.85;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 1.75;
const ZOOM_STEP = 0.15;

function sourceKindLabel(kind: SignaturePreviewSource["kind"], lang: string) {
  if (kind === "signing") return lang === "de" ? "zur Unterschrift" : "на подпись";
  return lang === "de" ? "zur Kenntnisnahme" : "для ознакомления";
}

export function SignatureDocumentPreview(props: Props) {
  const [revision, setRevision] = useState(0);
  const sourceKey = props.packageDocuments?.map(source => source.id).join(",") ?? props.documentId;
  return <PdfPreview key={`${sourceKey}:${revision}`} {...props} onRetry={() => setRevision(value => value + 1)} />;
}

function PdfPreview({ documentId, packageDocuments, onReady, onRetry }: Props & { onRetry: () => void }) {
  const { lang } = useLang();
  const tx = (ru: string, de: string) => lang === "de" ? de : ru;
  const [pdfs, setPdfs] = useState<LoadedPdf[] | null>(null);
  const [error, setError] = useState<SignaturePreviewError | null>(null);
  const [rendering, setRendering] = useState(true);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [width, setWidth] = useState(0);
  const [pageText, setPageText] = useState("");
  const viewportRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const currentPageRef = useRef(1);
  const textId = useId();
  // The component is keyed by its document ids, so the first list stays valid.
  const [sources] = useState<SignaturePreviewSource[] | null>(() => packageDocuments && packageDocuments.length > 1 ? packageDocuments : null);
  const pageCount = pdfs?.reduce((total, loaded) => total + loaded.pdf.numPages, 0) ?? 0;

  useEffect(() => {
    const controller = new AbortController();
    const loadingTasks: PDFDocumentLoadingTask[] = [];
    onReady("");
    void (async () => {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      const resourcePath = import.meta.env.DEV ? "/node_modules/pdfjs-dist/" : `${import.meta.env.BASE_URL}pdfjs/${pdfjs.version}/`;
      const resources = new URL(resourcePath, window.location.href).href;
      const targets = sources?.map(source => ({ source, id: source.id })) ?? [{ source: null, id: documentId }];
      const loaded = await Promise.all(targets.map(async target => {
        const file = await apiFetchFile(`/documents/${target.id}/download`, { cache: "no-store", signal: controller.signal });
        // Stored PDFs may be served as application/octet-stream. Validate their
        // actual bytes with the PDF parser rather than relying on the HTTP type.
        const data = await file.blob.arrayBuffer();
        if (controller.signal.aborted) throw new DOMException("aborted", "AbortError");
        const loadingTask = pdfjs.getDocument({
          data, cMapUrl: `${resources}cmaps/`, cMapPacked: true,
          standardFontDataUrl: `${resources}standard_fonts/`, wasmUrl: `${resources}wasm/`, iccUrl: `${resources}iccs/`,
        });
        loadingTasks.push(loadingTask);
        // Encrypted PDFs need to be unlocked before they can be sent for signing.
        loadingTask.onPassword = () => { if (!controller.signal.aborted) setError("password"); void loadingTask.destroy(); };
        return { ...target, pdf: await loadingTask.promise };
      }));
      if (!controller.signal.aborted) setPdfs(loaded);
    })().catch(cause => { if (!controller.signal.aborted) setError(current => current ?? signaturePreviewError(cause, "load")); });
    return () => { controller.abort(); loadingTasks.forEach(task => { void task.destroy(); }); };
  }, [documentId, sources, onReady]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(() => setWidth(Math.max(1, Math.floor(viewport.clientWidth - 32))));
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!pdfs || width <= 0) return;
    let cancelled = false;
    const tasks = new Set<RenderTask>();
    const container = pageRef.current;
    const pageToRestore = currentPageRef.current;
    setRendering(true); setPageText(""); setError(null); onReady("");
    container?.replaceChildren();
    void (async () => {
      const textByPage: string[] = [];
      // Pages are numbered through the whole package, as the recipient scrolls it.
      const pages = pdfs.flatMap((loaded, index) => Array.from({ length: loaded.pdf.numPages }, (_, offset) => ({ loaded, index, documentPage: offset + 1 })));
      for (const [pageIndex, { loaded, index, documentPage }] of pages.entries()) {
        const currentPage = pageIndex + 1;
        if (loaded.source && documentPage === 1) {
          const header = document.createElement("div");
          header.className = "w-full rounded-md border border-border/70 bg-card px-3 py-2 text-xs font-medium text-foreground shadow-xs";
          header.dataset.pdfDocument = loaded.id;
          header.textContent = `${index + 1} / ${pdfs.length} · ${loaded.source.title} · ${sourceKindLabel(loaded.source.kind, lang)}`;
          container?.append(header);
        }
        const page = await loaded.pdf.getPage(documentPage);
        if (cancelled) return;
        const natural = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: width / natural.width * zoom });
        // Limit backing-store allocation on very large pages/high-DPI displays.
        const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(16_000_000 / (viewport.width * viewport.height)));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.floor(viewport.width * ratio));
        canvas.height = Math.max(1, Math.floor(viewport.height * ratio));
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        canvas.className = "block bg-white shadow-sm";
        canvas.setAttribute("role", "img");
        canvas.setAttribute("aria-label", `${loaded.source ? `${loaded.source.title}. ` : ""}${lang === "de" ? `PDF, Seite ${currentPage}` : `PDF, страница ${currentPage}`}`);
        canvas.setAttribute("aria-describedby", textId);
        canvas.dataset.documentId = loaded.id;

        const pageContainer = document.createElement("div");
        pageContainer.className = "flex w-full justify-center";
        pageContainer.dataset.pdfPage = String(currentPage);
        pageContainer.append(canvas);
        container?.append(pageContainer);

        const task = page.render({ canvas, viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
        tasks.add(task);
        await task.promise;
        tasks.delete(task);
        if (cancelled) return;

        // A text-layer error must not hide an already rendered page.
        const text = await page.getTextContent().catch(() => null);
        if (text) textByPage.push(text.items.map(item => "str" in item ? item.str : "").join(" "));
      }

      if (cancelled) return;
      setPageText(textByPage.join(" "));
      setRendering(false); pdfs.forEach(loaded => onReady(loaded.id));
      window.requestAnimationFrame(() => {
        const viewport = viewportRef.current;
        const restoredPage = container?.querySelector<HTMLElement>(`[data-pdf-page="${pageToRestore}"]`);
        // Page 1 keeps the natural top, where a package shows its first header.
        if (!viewport || !restoredPage || pageToRestore === 1) return;
        const top = viewport.scrollTop + restoredPage.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 12;
        viewport.scrollTo({ top });
      });
    })().catch(cause => { if (!cancelled) { setError(signaturePreviewError(cause, "render")); onReady(""); } });
    return () => { cancelled = true; tasks.forEach(task => task.cancel()); container?.replaceChildren(); };
  }, [pdfs, width, zoom, lang, onReady, textId]);

  useEffect(() => {
    const viewport = viewportRef.current;
    const container = pageRef.current;
    if (!viewport || !container || rendering) return;

    const updateCurrentPage = () => {
      const pages = container.querySelectorAll<HTMLElement>("[data-pdf-page]");
      // A zoom change empties the container before the new render starts;
      // reading it then would reset the page to restore to page 1.
      if (pages.length === 0) return;
      const marker = viewport.getBoundingClientRect().top + Math.min(120, viewport.clientHeight * 0.25);
      let nextPage = 1;
      for (const page of pages) {
        if (page.getBoundingClientRect().top <= marker) {
          nextPage = Number(page.dataset.pdfPage) || nextPage;
        } else {
          break;
        }
      }
      currentPageRef.current = nextPage;
      setPageNumber(current => current === nextPage ? current : nextPage);
    };

    updateCurrentPage();
    viewport.addEventListener("scroll", updateCurrentPage, { passive: true });
    return () => viewport.removeEventListener("scroll", updateCurrentPage);
  }, [rendering, zoom]);

  const goToPage = (nextPage: number) => {
    const viewport = viewportRef.current;
    const page = pageRef.current?.querySelector<HTMLElement>(`[data-pdf-page="${nextPage}"]`);
    if (!viewport || !page) return;
    const top = viewport.scrollTop + page.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 12;
    viewport.scrollTo({ top, behavior: "smooth" });
  };

  const goToDocument = (id: string) => {
    const viewport = viewportRef.current;
    const header = pageRef.current?.querySelector<HTMLElement>(`[data-pdf-document="${id}"]`);
    if (!viewport || !header) return;
    const top = viewport.scrollTop + header.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 12;
    viewport.scrollTo({ top, behavior: "smooth" });
  };

  return <div aria-label={tx("PDF для подписи", "PDF zur Unterschrift")} className="m-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border/70 bg-muted/30 shadow-sm">
    {sources ? <nav aria-label={tx("Документы пакета", "Dokumente des Pakets")} className="flex shrink-0 flex-wrap gap-1.5 border-b border-border/70 bg-card px-2 py-1.5">
      {sources.map((source, index) => <Button key={source.id} type="button" variant="outline" size="sm" className="h-auto min-h-7 max-w-full whitespace-normal py-1 text-left text-xs" disabled={rendering || Boolean(error)} onClick={() => goToDocument(source.id)}>
        {index + 1}. {source.title} · <span className={source.kind === "signing" ? "text-[var(--brand)]" : "text-muted-foreground"}>{sourceKindLabel(source.kind, lang)}</span>
      </Button>)}
    </nav> : null}
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-1 border-b border-border/70 bg-card px-2 py-1.5">
      <div className="flex items-center gap-1">
        <Button type="button" variant="ghost" size="icon-sm" aria-label={tx("Предыдущая страница", "Vorherige Seite")} disabled={!pdfs || pageNumber === 1 || Boolean(error)} onClick={() => goToPage(pageNumber - 1)}><ChevronLeft className="size-4" /></Button>
        <span aria-live="polite" className="min-w-12 text-center text-xs tabular-nums">{pdfs ? `${pageNumber} / ${pageCount}` : "—"}</span>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={tx("Следующая страница", "Nächste Seite")} disabled={!pdfs || pageNumber === pageCount || Boolean(error)} onClick={() => goToPage(pageNumber + 1)}><ChevronRight className="size-4" /></Button>
      </div>
      <div className="flex items-center gap-1">
        <Button type="button" variant="ghost" size="icon-sm" aria-label={tx("Уменьшить", "Verkleinern")} disabled={!pdfs || zoom <= MIN_ZOOM || Boolean(error)} onClick={() => setZoom(value => Math.max(MIN_ZOOM, Number((value - ZOOM_STEP).toFixed(2))))}><Minus className="size-4" /></Button>
        <Button type="button" variant="ghost" size="sm" title={tx("Подогнать по ширине", "An Breite anpassen")} disabled={!pdfs || Boolean(error)} onClick={() => setZoom(1)}>{zoom === 1 ? tx("По ширине", "Seitenbreite") : `${Math.round(zoom * 100)}%`}</Button>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={tx("Увеличить", "Vergrößern")} disabled={!pdfs || zoom >= MAX_ZOOM || Boolean(error)} onClick={() => setZoom(value => Math.min(MAX_ZOOM, Number((value + ZOOM_STEP).toFixed(2))))}><Plus className="size-4" /></Button>
      </div>
    </div>
    <div ref={viewportRef} className="relative h-[420px] min-h-[300px] overflow-auto lg:h-auto lg:min-h-0 lg:flex-1">
      <div ref={pageRef} className="flex w-max min-w-full flex-col items-center gap-4 p-4" />
      <p id={textId} className="sr-only">{pageText}</p>
      {rendering || error ? <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-muted/30 p-5 text-center text-xs leading-5 text-muted-foreground">
        {error ? <><FileText className="size-7" /><p role="alert">{signaturePreviewErrorMessage(error, lang)}</p><Button type="button" size="sm" variant="outline" onClick={onRetry}>{tx("Повторить загрузку", "Erneut laden")}</Button></>
          : <><LoaderCircle aria-hidden="true" className="size-5 animate-spin" /><p role="status">{tx("Загрузка PDF…", "PDF wird geladen…")}</p></>}
      </div> : null}
    </div>
  </div>;
}
