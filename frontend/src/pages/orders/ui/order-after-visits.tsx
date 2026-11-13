import { useEffect, useMemo, useRef, useState } from "react";
import { ClipboardCheck, FileText, LoaderCircle, Receipt, Upload } from "lucide-react";

import { StaffLink } from "@/components/staff-link";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { SectionHeading } from "@/components/ui/section-heading";
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
export function OrderAfterVisits({ orderId, patientId, lang, reloadNonce, canEdit }: OrderAfterVisitsProps) {
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
    <div data-testid="order-after-visits" className="rounded-lg border border-border bg-card p-3">
      <SectionHeading icon={ClipboardCheck}>{tx("После приёмов", "Nach den Terminen")}</SectionHeading>
      <p className="mt-1 text-xs text-muted-foreground">
        {tx(
          "Всё, что собрали после визита, — у своего приёма. Счёт клиники привязывать не обязательно.",
          "Alles nach dem Besuch beim jeweiligen Termin. Eine Klinikrechnung muss nicht zugeordnet werden.",
        )}
      </p>
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
      {error ? (
        <div className="mt-2">
          <Banner tone="error">{error}</Banner>
        </div>
      ) : null}
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[56rem] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-2 py-1.5 font-semibold">{tx("Приём", "Termin")}</th>
              <th className="px-2 py-1.5 font-semibold">{tx("Заключения и документы", "Befunde und Dokumente")}</th>
              <th className="px-2 py-1.5 font-semibold">{tx("Переводчик", "Dolmetscher")}</th>
              <th className="px-2 py-1.5 font-semibold">{tx("Счета клиник", "Klinikrechnungen")}</th>
              <th className="px-2 py-1.5 font-semibold">{tx("Дальше", "Weiter")}</th>
              <th className="px-2 py-1.5 font-semibold">{tx("Статус", "Status")}</th>
            </tr>
          </thead>
          <tbody>
            {visits.map((visit) => {
              const papers = documentsOf(current.documents, visit.id);
              const invoices = invoicesOf(current.invoices, visit.id);
              const interpreter = interpreterState(visit);
              const missing = missingAfterVisit(papers, interpreter);
              const next = nextVisitAfter(visit, current.appointments);
              const addable = current.invoices.filter(
                (invoice) => invoice.status !== "cancelled" && !invoice.appointment_ids.includes(visit.id),
              );
              const interp = interpreterText(interpreter);
              return (
                <tr key={visit.id} data-testid="order-after-visit-row" className="border-b border-border/60 align-top">
                  <td className="px-2 py-2">
                    <div className="font-semibold tabular-nums">
                      {plannedDayLabel(visit.date, lang)} {plannedTimeLabel(visit)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {[visit.doctor_name, visit.provider_name, visit.title].filter(Boolean).join(" · ")}
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    <ul className="space-y-0.5">
                      {papers.map((paper) => (
                        <li key={paper.id} className="flex items-center gap-1">
                          <FileText aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                          <StaffLink to={`/documents?document=${encodeURIComponent(paper.id)}`} className="hover:underline">
                            {documentName(paper)}
                          </StaffLink>
                        </li>
                      ))}
                    </ul>
                    {canEdit ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-1 h-7 gap-1 text-xs"
                        disabled={Boolean(busyKey)}
                        onClick={() => startUpload(visit.id)}
                      >
                        {busyKey === `upload:${visit.id}` ? (
                          <LoaderCircle className="size-3.5 animate-spin" />
                        ) : (
                          <Upload className="size-3.5" />
                        )}
                        {tx("Загрузить", "Hochladen")}
                      </Button>
                    ) : null}
                  </td>
                  <td className="px-2 py-2">
                    <StatusBadge tone={interp.tone}>{interp.text}</StatusBadge>
                    {visit.interpreter_name ? (
                      <div className="mt-0.5 text-xs text-muted-foreground">{visit.interpreter_name}</div>
                    ) : null}
                  </td>
                  <td className="px-2 py-2">
                    <ul className="space-y-0.5">
                      {invoices.map((invoice) => (
                        <li key={invoice.id} className="flex items-center gap-1">
                          <Receipt aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                          <span className="tabular-nums">{invoiceText(invoice)}</span>
                          {invoice.appointment_ids.length > 1 ? (
                            <span className="text-xs text-muted-foreground">
                              {tx(`(на ${invoice.appointment_ids.length} приёма)`, `(für ${invoice.appointment_ids.length} Termine)`)}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                    {invoices.length === 0 ? (
                      <span className="text-xs text-muted-foreground">{tx("не привязан", "nicht zugeordnet")}</span>
                    ) : null}
                    {canEdit && addable.length > 0 ? (
                      <NativeComboboxSelect
                        aria-label={tx("Привязать счёт", "Rechnung zuordnen")}
                        value=""
                        disabled={Boolean(busyKey)}
                        onChange={(event) => {
                          const invoice = addable.find((item) => item.id === event.target.value);
                          if (invoice) linkInvoice(invoice, visit.id);
                        }}
                        className={`${appointmentSelectControlClassName} mt-1`}
                      >
                        <option value="">{tx("Привязать счёт…", "Rechnung zuordnen…")}</option>
                        {addable.map((invoice) => (
                          <option key={invoice.id} value={invoice.id}>
                            {invoiceText(invoice)}
                          </option>
                        ))}
                      </NativeComboboxSelect>
                    ) : null}
                  </td>
                  <td className="px-2 py-2 text-xs">
                    {next ? (
                      <span>
                        {tx("Следующий приём", "Nächster Termin")}: {plannedDayLabel(next.date, lang)} {plannedTimeLabel(next)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    {missing.length === 0 ? (
                      <StatusBadge tone="success">{tx("Всё внесено", "Vollständig")}</StatusBadge>
                    ) : (
                      <StatusBadge tone="warning">
                        {tx("Не хватает", "Es fehlt")}:{" "}
                        {missing
                          .map((item) =>
                            item === "documents" ? tx("документы", "Dokumente") : tx("отчёт переводчика", "Dolmetscherbericht"),
                          )
                          .join(", ")}
                      </StatusBadge>
                    )}
                  </td>
                </tr>
              );
            })}
            {looseDocuments.length > 0 || looseInvoices.length > 0 ? (
              <tr data-testid="order-after-visits-unsorted" className="bg-muted/30 align-top">
                <td className="px-2 py-2">
                  <div className="font-semibold">{tx("Без приёма", "Ohne Termin")}</div>
                  <div className="text-xs text-muted-foreground">
                    {tx("пришло в заказ, ещё не разложено", "im Auftrag, noch nicht zugeordnet")}
                  </div>
                </td>
                <td className="px-2 py-2">
                  <ul className="space-y-1.5">
                    {looseDocuments.map((paper) => (
                      <li key={paper.id} className="space-y-1">
                        <div className="flex items-center gap-1">
                          <FileText aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                          <StaffLink to={`/documents?document=${encodeURIComponent(paper.id)}`} className="hover:underline">
                            {documentName(paper)}
                          </StaffLink>
                        </div>
                        {canEdit && visits.length > 0 ? (
                          <NativeComboboxSelect
                            aria-label={`${tx("Привязать к приёму", "Termin zuordnen")}: ${documentName(paper)}`}
                            value=""
                            disabled={Boolean(busyKey)}
                            onChange={(event) => {
                              if (event.target.value) linkDocument(paper, event.target.value);
                            }}
                            className={appointmentSelectControlClassName}
                          >
                            <option value="">{tx("Привязать к приёму…", "Termin zuordnen…")}</option>
                            {visitOptions}
                          </NativeComboboxSelect>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </td>
                <td className="px-2 py-2" />
                <td className="px-2 py-2">
                  <ul className="space-y-1.5">
                    {looseInvoices.map((invoice) => (
                      <li key={invoice.id} className="space-y-1">
                        <div className="flex items-center gap-1">
                          <Receipt aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                          <span className="tabular-nums">{invoiceText(invoice)}</span>
                        </div>
                        {canEdit && visits.length > 0 ? (
                          <NativeComboboxSelect
                            aria-label={`${tx("Привязать к приёму", "Termin zuordnen")}: ${invoice.external_invoice_number}`}
                            value=""
                            disabled={Boolean(busyKey)}
                            onChange={(event) => {
                              if (event.target.value) linkInvoice(invoice, event.target.value);
                            }}
                            className={appointmentSelectControlClassName}
                          >
                            <option value="">{tx("Привязать к приёму…", "Termin zuordnen…")}</option>
                            {visitOptions}
                          </NativeComboboxSelect>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  {looseInvoices.length > 0 ? (
                    <div className="mt-1 text-xs text-muted-foreground">
                      {tx("можно оставить без приёма", "kann ohne Termin bleiben")}
                    </div>
                  ) : null}
                </td>
                <td className="px-2 py-2" />
                <td className="px-2 py-2">
                  <StatusBadge tone="neutral">{tx("необязательно", "optional")}</StatusBadge>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
