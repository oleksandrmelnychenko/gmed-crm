import { useEffect, useRef, useState } from "react";
import { Download, LoaderCircle, RotateCcw, Square, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ApiRequestError } from "@/lib/api";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { parseInvoiceFile } from "../data/invoice-import-api";
import { checkableInvoiceFile, documentCheckReport, invoiceCheckSummary, matchingInvoice, MAX_CHECK_FILES, type DocumentCheck } from "./document-check-model";
import { useDocumentCheckText } from "./document-check-text";
import { DatevSetupSection } from "./setup-section";

export function DatevDocumentChecks() {
  const copy = useDocumentCheckText();
  const { canStaffPath } = useStaffNavigate();
  const [rows, setRows] = useState<DocumentCheck[]>([]);
  const [running, setRunning] = useState(false);
  const [limitError, setLimitError] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const records = useRef<DocumentCheck[]>([]);
  const active = useRef<AbortController | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; active.current?.abort(); };
  }, []);

  function update(id: string, patch: Partial<DocumentCheck>) {
    records.current = records.current.map((row) => row.id === id ? { ...row, ...patch } : row);
    if (mounted.current) setRows(records.current);
  }

  async function run(ids: string[]) {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setRunning(true);
    try {
      // Sequential requests respect the shared OCR capacity and keep cancellation predictable.
      for (const id of ids) {
        if (controller.signal.aborted) break;
        const row = records.current.find((item) => item.id === id)!;
        update(id, { status: "processing", failure: undefined, summary: undefined, duplicateOf: undefined, relatedId: undefined, checkedAt: undefined });
        const file = checkableInvoiceFile(row.file);
        if (!file) { update(id, { status: "error", failure: "file", checkedAt: new Date().toISOString() }); continue; }
        try {
          const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
          if (controller.signal.aborted) break;
          const sha256 = [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, "0")).join("");
          const duplicate = records.current.find((item) => item.id !== id && item.sha256 === sha256 && ["parsed", "review"].includes(item.status));
          update(id, { sha256 });
          if (duplicate) { update(id, { status: "duplicate", duplicateOf: duplicate.id, checkedAt: new Date().toISOString() }); continue; }
          const preview = await parseInvoiceFile(file, controller.signal);
          if (controller.signal.aborted) break;
          const summary = invoiceCheckSummary(file, preview);
          const related = matchingInvoice(summary, records.current.filter((item) => item.id !== id));
          if (related) summary.issues.push("matching_invoice");
          update(id, { summary, relatedId: related?.id, status: summary.issues.length ? "review" : "parsed", checkedAt: new Date().toISOString() });
        } catch (cause) {
          if (controller.signal.aborted) break;
          const status = cause instanceof ApiRequestError ? cause.status : undefined;
          update(id, { status: "error", checkedAt: new Date().toISOString(), failure: status === 429 ? "busy" : status === 401 || status === 403 ? "access" : status === 404 || status === 502 || status === 503 || status === 504 ? "unavailable" : "parse" });
        }
      }
    } finally {
      if (controller.signal.aborted) {
        records.current = records.current.map((row) => ids.includes(row.id) && ["queued", "processing"].includes(row.status) ? { ...row, status: "cancelled" } : row);
      }
      active.current = null;
      if (mounted.current) { setRows(records.current); setRunning(false); }
    }
  }

  function choose(files: File[]) {
    if (!files.length || active.current) return;
    if (files.length + records.current.length > MAX_CHECK_FILES) { setLimitError(true); return; }
    setLimitError(false);
    const selected: DocumentCheck[] = files.map((file) => ({ id: crypto.randomUUID(), file, status: "queued" }));
    records.current = [...records.current, ...selected];
    setRows(records.current);
    void run(selected.map((row) => row.id));
  }

  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(documentCheckReport(records.current), null, 2)], { type: "application/json;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = "GMED-DATEV-Dokumentpruefung.json"; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <DatevSetupSection id="datev-document-checks" title={copy.title} description={copy.hint} className="scroll-mt-5" data-testid="datev-document-checks">
    {!canStaffPath("/invoices") ? <p className="text-sm text-muted-foreground">{copy.noAccess}</p> : <>
      <div className="flex flex-wrap items-center gap-2">
        <input ref={input} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.xml" aria-label={copy.input} className="sr-only" disabled={running || rows.length >= MAX_CHECK_FILES} onChange={(event) => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""; choose(files); }} />
        <Button type="button" size="sm" className="h-8 rounded-md" disabled={running || rows.length >= MAX_CHECK_FILES} onClick={() => input.current?.click()}><Upload aria-hidden className="size-3.5" />{copy.choose}</Button>
        {running ? <Button type="button" variant="outline" size="sm" className="h-8 rounded-md" onClick={() => active.current?.abort()}><Square aria-hidden className="size-3.5" />{copy.stop}</Button> : null}
        {rows.length ? <>
          <Button type="button" variant="outline" size="sm" className="h-auto min-h-8 whitespace-normal rounded-md py-1.5" disabled={running} onClick={download}><Download aria-hidden className="size-3.5" />{copy.report}</Button>
          <Button type="button" variant="ghost" size="sm" className="h-8 rounded-md" disabled={running} onClick={() => { records.current = []; setRows([]); setLimitError(false); }}><Trash2 aria-hidden className="size-3.5" />{copy.clear}</Button>
        </> : null}
      </div>
      <p className="text-xs text-muted-foreground">{copy.limits}</p>
      {limitError ? <p role="alert" className="text-sm text-destructive">{copy.tooMany}</p> : null}
      {rows.length ? <p aria-live="polite" className="flex items-center gap-2 text-xs text-muted-foreground">{running ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : null}{running ? copy.progress : copy.checked} {rows.filter((row) => !["queued", "processing"].includes(row.status)).length} / {rows.length}</p> : <p className="rounded-md border border-dashed border-border/70 bg-muted/20 px-3 py-4 text-xs leading-5 text-muted-foreground">{copy.empty}</p>}
      <div className="space-y-3">
        {rows.map((row) => <article key={row.id} className="min-w-0 space-y-3 rounded-lg border border-border/70 p-3.5" aria-label={row.file.name}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="min-w-0 break-all text-sm font-medium">{row.file.name}</p>
            <Badge variant={row.status === "error" ? "destructive" : "secondary"}>{copy.statuses[row.status]}</Badge>
          </div>
          {row.failure ? <p className="text-sm text-destructive">{copy.failures[row.failure]}</p> : null}
          {row.duplicateOf ? <p className="break-words text-sm text-muted-foreground">{copy.duplicate}: {rows.find((item) => item.id === row.duplicateOf)?.file.name}</p> : null}
          {row.summary ? <>
            <p className="text-xs text-muted-foreground">{copy.sources[row.summary.source_format] ?? copy.sources.unknown}{row.summary.syntax ? ` · ${row.summary.syntax.toUpperCase()}` : ""}</p>
            <dl className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {[[copy.supplier, row.summary.fields.supplier_name], [copy.invoice, row.summary.fields.external_invoice_number], [copy.date, row.summary.fields.invoice_date], [copy.net, row.summary.fields.amount_net], [copy.vat, row.summary.fields.amount_vat], [copy.gross, row.summary.fields.amount_gross ? `${row.summary.fields.amount_gross} ${row.summary.fields.currency}` : ""]].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-words text-sm">{value || copy.absent}</dd></div>)}
            </dl>
            {row.summary.issues.length ? <ul className="list-disc space-y-1 pl-4 text-sm">
              {row.summary.issues.map((issue) => <li key={issue}>{copy[issue]}</li>)}
              {row.summary.warnings.includes("tax_treatment_requires_review") ? <li>{copy.tax}</li> : null}
              {row.summary.warnings.includes("line_items_total_mismatch") ? <li>{copy.lines}</li> : null}
              {row.summary.warnings.includes("payable_differs_from_total") ? <li>{copy.payable}</li> : null}
            </ul> : <p className="text-sm text-muted-foreground">{copy.noIssues}</p>}
            {row.summary.warnings.includes("amount_net_derived_from_totals") ? <p className="text-xs text-muted-foreground">{copy.derivedNet}</p> : null}
            {row.summary.warnings.includes("due_date_calculated_from_invoice_date") ? <p className="text-xs text-muted-foreground">{copy.derivedDue}{row.summary.fields.due_date ? ` ${row.summary.fields.due_date}` : ""}</p> : null}
            {row.relatedId ? <p className="break-words text-xs text-muted-foreground">{copy.related}: {rows.find((item) => item.id === row.relatedId)?.file.name}</p> : null}
          </> : null}
          {["error", "cancelled"].includes(row.status) ? <Button type="button" size="sm" variant="outline" disabled={running} onClick={() => { update(row.id, { status: "queued" }); void run([row.id]); }}><RotateCcw aria-hidden className="size-3.5" />{copy.retry}</Button> : null}
        </article>)}
      </div>
      <p className="text-xs leading-5 text-muted-foreground">{copy.session}</p>
      <p className="text-xs leading-5 text-muted-foreground">{copy.disclaimer}</p>
    </>}
  </DatevSetupSection>;
}
