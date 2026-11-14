import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarArrowUp, ClipboardCheck, Clock3, FileText, Inbox, Languages, LoaderCircle, Receipt, Upload } from "lucide-react";

import { StaffLink } from "@/components/staff-link";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { SectionHeading } from "@/components/ui/section-heading";
import { PortalDateChip } from "@/components/ui/portal-date-chip";
import { Banner, StatusBadge } from "@/components/ui-shell";
import { apiFetch } from "@/lib/api";
import { appDateKey } from "@/lib/app-time-zone";
import { formatMoneyAmount } from "@/lib/money";
import { appointmentSelectControlClassName } from "@/pages/appointments/appearance/surface-appearance";
import { updateDocument, uploadDocument } from "@/pages/documents/data/document-api";

import {
  documentsOf,
  hoursLabel,
  interpreterState,
  invoicesOf,
  missingAfterVisit,
  nextVisitAfter,
  unsortedDocuments,
  unsortedInvoices,
  visitsToCollect,
  type AfterVisitDocument,
  type InterpreterState,
  type VisitInvoice,
} from "../model/order-after-visits";
import { plannedDayLabel, plannedTimeLabel } from "../model/order-planned-appointments";
import { localizePipelineAppointments, type OrderPipeline, type OrderPipelineAppointment } from "../model/order-pipeline";

type OrderAfterVisitsProps = {
  orderId: string;
  patientId: string;
  lang: string;
  reloadNonce: number;
  /** Planners upload papers and sort invoices; others read. */
  canEdit: boolean;
  /** The order's «Переводчик требуется»: a visit without its own mark follows it. */
  orderRequiresInterpreter?: boolean;
};

type Loaded = {
  orderId: string;
  appointments: OrderPipelineAppointment[];
  documents: AfterVisitDocument[];
  invoices: VisitInvoice[];
};

function documentName(document: AfterVisitDocument) {
  return document.auto_name?.trim() || document.original_filename || document.id;
}

function fileBaseName(name: string) {
  return name.replace(/\.[^.]+$/, "");
}

/**
 * «После приёмов» (planning stage 7, owner 2026-11-13): everything collected
 * after a visit, sorted around the visit. The doctor's papers, the
 * interpreter's hours and the clinic invoices (kept apart from the papers;
 * linking them is optional, one invoice may cover several visits) and what
 * comes next. A row «Без приёма» holds what came into the order unsorted.
 */
export function OrderAfterVisits({
  orderId,
  patientId,
  lang,
  reloadNonce,
  canEdit,
  orderRequiresInterpreter = false,
}: OrderAfterVisitsProps) {
  const de = lang === "de";
  const tx = (ru: string, german: string) => (de ? german : ru);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [localNonce, setLocalNonce] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const uploadTarget = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiFetch<OrderPipeline>(`/orders/${orderId}/pipeline`),
      apiFetch<AfterVisitDocument[]>(`/documents?order_id=${orderId}`).catch(() => []),
      apiFetch<{ items: VisitInvoice[] }>(`/orders/${orderId}/visit-invoices`)
        .then((result) => (Array.isArray(result?.items) ? result.items : []))
        .catch(() => []),
    ])
      .then(([pipeline, documents, invoices]) => {
        if (cancelled) return;
        setLoaded({
          orderId,
          appointments: localizePipelineAppointments(pipeline).appointments,
          documents: Array.isArray(documents) ? documents : [],
          invoices,
        });
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [orderId, reloadNonce, localNonce]);

  const current = loaded?.orderId === orderId ? loaded : null;
  const visits = useMemo(
    () => (current ? visitsToCollect(current.appointments, appDateKey()) : []),
    [current],
  );
  const looseDocuments = current ? unsortedDocuments(current.documents) : [];
  const looseInvoices = current ? unsortedInvoices(current.invoices) : [];

  if (!current) {
    return error ? <Banner tone="error">{error}</Banner> : null;
  }
  if (visits.length === 0 && looseDocuments.length === 0 && looseInvoices.length === 0) return null;

  const run = (key: string, action: () => Promise<unknown>) => {
    if (busyKey) return;
    setBusyKey(key);
    setError(null);
    action()
      .then(() => setLocalNonce((value) => value + 1))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setBusyKey(null));
  };

  const startUpload = (appointmentId: string) => {
    uploadTarget.current = appointmentId;
    fileInput.current?.click();
  };
  const onFiles = (files: FileList | null) => {
    const appointmentId = uploadTarget.current;
    uploadTarget.current = null;
    if (!files || files.length === 0 || !appointmentId) return;
    const chosen = [...files];
    run(`upload:${appointmentId}`, async () => {
      for (const file of chosen) {
        const form = new FormData();
        form.append("file", file);
        form.append("patient_id", patientId);
        form.append("order_id", orderId);
        form.append("appointment_id", appointmentId);
        form.append("auto_name", fileBaseName(file.name));
        // A doctor's paper after the visit: conclusion, Arztbrief, Befund.
        form.append("category", "medical");
        form.append("is_medical", "true");
        await uploadDocument(form);
      }
    });
  };
  const linkInvoice = (invoice: VisitInvoice, appointmentId: string) =>
    run(`invoice:${invoice.id}`, () =>
      apiFetch(`/orders/${orderId}/external-invoices/${invoice.id}/appointments`, {
        method: "POST",
        body: JSON.stringify({ appointment_ids: [...invoice.appointment_ids, appointmentId] }),
      }),
    );
  const linkDocument = (document: AfterVisitDocument, appointmentId: string) =>
    run(`document:${document.id}`, () => updateDocument(document.id, { appointment_id: appointmentId }));

  const visitLabel = (visit: OrderPipelineAppointment) =>
    `${plannedDayLabel(visit.date, lang)} ${plannedTimeLabel(visit)} ${visit.doctor_name ?? visit.provider_name ?? visit.title}`.replace(
      /\s+/g,
      " ",
    );
  const interpreterText = (state: InterpreterState) => {
    switch (state.kind) {
      case "approved":
        return { tone: "success" as const, text: `${hoursLabel(state.hours, lang)} · ${tx("утверждено", "freigegeben")}` };
      case "pending":
        return { tone: "warning" as const, text: `${hoursLabel(state.hours, lang)} · ${tx("на проверке", "in Prüfung")}` };
      case "rejected":
        return { tone: "warning" as const, text: `${hoursLabel(state.hours, lang)} · ${tx("отклонено", "abgelehnt")}` };
      case "waiting":
        return { tone: "warning" as const, text: tx("ждём отчёт", "Bericht ausstehend") };
      case "unassigned":
        return { tone: "warning" as const, text: tx("переводчик не назначен", "kein Dolmetscher gebucht") };
      default:
        return { tone: "neutral" as const, text: tx("не нужен", "nicht benötigt") };
    }
  };
  const invoiceText = (invoice: VisitInvoice) =>
    `${invoice.external_invoice_number} · ${formatMoneyAmount(invoice.amount_gross, invoice.currency)}${
      invoice.provider_name ? ` · ${invoice.provider_name}` : ""
    }`;
  const visitOptions = visits.map((visit) => (
    <option key={visit.id} value={visit.id}>
      {visitLabel(visit)}
    </option>
  ));

  return (
    <section data-testid="order-after-visits" className="@container overflow-hidden rounded-xl border border-border bg-card">
      <header className="border-b border-border px-3 py-2.5">
        <h3><SectionHeading icon={ClipboardCheck}>{tx("После приёмов", "Nach den Terminen")}</SectionHeading></h3>
      </header>
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        data-testid="order-after-visits-file"
        onChange={(event) => {
          onFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <div className="space-y-3 p-3">
        {error ? <Banner tone="error">{error}</Banner> : null}
        {visits.map((visit) => {
          const papers = documentsOf(current.documents, visit.id);
          const invoices = invoicesOf(current.invoices, visit.id);
          const interpreter = interpreterState(visit, orderRequiresInterpreter);
          const missing = missingAfterVisit(papers, interpreter);
          const next = nextVisitAfter(visit, current.appointments);
          const addable = current.invoices.filter(
            (invoice) => invoice.status !== "cancelled" && !invoice.appointment_ids.includes(visit.id),
          );
          const interp = interpreterText(interpreter);
          const missingLabels = missing.map((item) =>
            item === "documents" ? tx("документы", "Dokumente") : tx("отчёт переводчика", "Dolmetscherbericht"),
          );
          const details = [...new Set([visit.doctor_name, visit.provider_name].filter((name) => name && name !== visit.title))];
          return (
            <article key={visit.id} data-testid="order-after-visit-row" className="min-w-0 overflow-hidden rounded-lg border border-border">
              <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-border/70 bg-muted/20 px-3 py-2.5">
                <div className="min-w-0 flex-1 basis-64 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <PortalDateChip>{plannedDayLabel(visit.date, lang)}</PortalDateChip>
                    <PortalDateChip icon={Clock3}>{plannedTimeLabel(visit)}</PortalDateChip>
                  </div>
                  <h4 className="break-words text-sm font-semibold text-foreground">{visit.title}</h4>
                  {details.length > 0 && <p className="break-words text-xs leading-5 text-muted-foreground">{details.join(" · ")}</p>}
                </div>
                <StatusBadge tone={missing.length === 0 ? "success" : "warning"} className="h-auto max-w-full whitespace-normal text-left leading-4">
                  {missing.length === 0
                    ? tx("Всё внесено", "Vollständig")
                    : `${tx("Не хватает", "Es fehlt")}: ${missingLabels.join(", ")}`}
                </StatusBadge>
              </header>

              <div className="grid min-w-0 grid-cols-1 divide-y divide-border/70 @min-[720px]:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,1fr)] @min-[720px]:divide-x @min-[720px]:divide-y-0">
                <section className="min-w-0 space-y-2 p-3">
                  <h5 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <FileText aria-hidden="true" className="size-3.5 shrink-0" />
                    {tx("Заключения и документы", "Befunde und Dokumente")}
                  </h5>
                  {papers.length > 0 ? (
                    <ul className="space-y-1.5 text-sm">
                      {papers.map((paper) => (
                        <li key={paper.id} className="min-w-0">
                          <StaffLink to={`/documents?document=${encodeURIComponent(paper.id)}`} className="break-words font-medium hover:underline">
                            {documentName(paper)}
                          </StaffLink>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="text-xs text-muted-foreground">{tx("Документы ещё не добавлены", "Noch keine Dokumente")}</p>}
                  {canEdit && (
                    <Button type="button" variant="outline" size="sm" className="gap-1.5"
                      disabled={Boolean(busyKey)} onClick={() => startUpload(visit.id)}>
                      {busyKey === `upload:${visit.id}` ? <LoaderCircle className="size-3.5 animate-spin" /> : <Upload aria-hidden="true" className="size-3.5" />}
                      {tx("Загрузить", "Hochladen")}
                    </Button>
                  )}
                </section>

                <section className="min-w-0 space-y-2 p-3">
                  <h5 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Languages aria-hidden="true" className="size-3.5 shrink-0" />
                    {tx("Переводчик", "Dolmetscher")}
                  </h5>
                  {visit.interpreter_name && <p className="break-words text-sm font-medium">{visit.interpreter_name}</p>}
                  <StatusBadge tone={interp.tone} className="h-auto max-w-full whitespace-normal text-left leading-4">{interp.text}</StatusBadge>
                </section>

                <section className="min-w-0 space-y-2 p-3">
                  <h5 className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs font-medium text-muted-foreground">
                    <Receipt aria-hidden="true" className="size-3.5 shrink-0" />
                    {tx("Счета клиник", "Klinikrechnungen")}
                    <span className="font-normal">· {tx("необязательно", "optional")}</span>
                  </h5>
                  {invoices.length > 0 ? (
                    <ul className="space-y-2 text-sm">
                      {invoices.map((invoice) => (
                        <li key={invoice.id} className="space-y-0.5">
                          <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
                            <span className="min-w-0 break-words font-medium">{invoice.external_invoice_number}</span>
                            <span className="whitespace-nowrap font-medium tabular-nums">{formatMoneyAmount(invoice.amount_gross, invoice.currency)}</span>
                          </div>
                          {invoice.provider_name && <p className="break-words text-xs leading-5 text-muted-foreground">{invoice.provider_name}</p>}
                          {invoice.appointment_ids.length > 1 && (
                            <p className="text-xs text-muted-foreground">
                              {tx(`На ${invoice.appointment_ids.length} приёма`, `Für ${invoice.appointment_ids.length} Termine`)}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : <p className="text-xs text-muted-foreground">{tx("Счёт не привязан", "Keine Rechnung zugeordnet")}</p>}
                  {canEdit && addable.length > 0 && (
                    <NativeComboboxSelect
                      aria-label={tx("Привязать счёт", "Rechnung zuordnen")}
                      value=""
                      disabled={Boolean(busyKey)}
                      onChange={(event) => {
                        const invoice = addable.find((item) => item.id === event.target.value);
                        if (invoice) linkInvoice(invoice, visit.id);
                      }}
                      className={appointmentSelectControlClassName}
                    >
                      <option value="">{tx("Привязать счёт…", "Rechnung zuordnen…")}</option>
                      {addable.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoiceText(invoice)}</option>)}
                    </NativeComboboxSelect>
                  )}
                </section>
              </div>
              {next && (
                <footer className="flex flex-wrap items-center gap-2 border-t border-border/70 px-3 py-2 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5"><CalendarArrowUp aria-hidden="true" className="size-3.5" />{tx("Следующий приём", "Nächster Termin")}</span>
                  <PortalDateChip>{plannedDayLabel(next.date, lang)}</PortalDateChip>
                  <PortalDateChip icon={Clock3}>{plannedTimeLabel(next)}</PortalDateChip>
                </footer>
              )}
            </article>
          );
        })}
        {(looseDocuments.length > 0 || looseInvoices.length > 0) && (
          <section data-testid="order-after-visits-unsorted" className="min-w-0 overflow-hidden rounded-lg border border-border">
            <header className="border-b border-border/70 bg-muted/20 px-3 py-2.5">
              <h4><SectionHeading icon={Inbox}>{tx("Без приёма", "Ohne Termin")}</SectionHeading></h4>
            </header>
            <div className="grid min-w-0 grid-cols-1 divide-y divide-border/70 @min-[720px]:grid-cols-2 @min-[720px]:divide-x @min-[720px]:divide-y-0">
              {looseDocuments.length > 0 && (
                <section className="min-w-0 space-y-2 p-3">
                  <h5 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <FileText aria-hidden="true" className="size-3.5" />{tx("Заключения и документы", "Befunde und Dokumente")}
                  </h5>
                  <ul className="space-y-3 text-sm">
                    {looseDocuments.map((paper) => (
                      <li key={paper.id} className="min-w-0 space-y-1.5">
                        <StaffLink to={`/documents?document=${encodeURIComponent(paper.id)}`} className="break-words font-medium hover:underline">
                          {documentName(paper)}
                        </StaffLink>
                        {canEdit && visits.length > 0 && (
                          <NativeComboboxSelect
                            aria-label={`${tx("Привязать к приёму", "Termin zuordnen")}: ${documentName(paper)}`}
                            value=""
                            disabled={Boolean(busyKey)}
                            onChange={(event) => { if (event.target.value) linkDocument(paper, event.target.value); }}
                            className={appointmentSelectControlClassName}
                          >
                            <option value="">{tx("Привязать к приёму…", "Termin zuordnen…")}</option>
                            {visitOptions}
                          </NativeComboboxSelect>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {looseInvoices.length > 0 && (
                <section className="min-w-0 space-y-2 p-3">
                  <h5 className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Receipt aria-hidden="true" className="size-3.5" />{tx("Счета клиник", "Klinikrechnungen")}
                    <span className="font-normal">· {tx("можно оставить без приёма", "kann ohne Termin bleiben")}</span>
                  </h5>
                  <ul className="space-y-3 text-sm">
                    {looseInvoices.map((invoice) => (
                      <li key={invoice.id} className="min-w-0 space-y-1.5">
                        <p className="break-words">{invoiceText(invoice)}</p>
                        {canEdit && visits.length > 0 && (
                          <NativeComboboxSelect
                            aria-label={`${tx("Привязать к приёму", "Termin zuordnen")}: ${invoice.external_invoice_number}`}
                            value=""
                            disabled={Boolean(busyKey)}
                            onChange={(event) => { if (event.target.value) linkInvoice(invoice, event.target.value); }}
                            className={appointmentSelectControlClassName}
                          >
                            <option value="">{tx("Привязать к приёму…", "Termin zuordnen…")}</option>
                            {visitOptions}
                          </NativeComboboxSelect>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          </section>
        )}
      </div>
    </section>
  );
}
