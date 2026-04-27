import { startTransition, useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Download, LoaderCircle, RefreshCw, Upload } from "lucide-react";

import { AdminSheetScaffold } from "@/components/admin-page-patterns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Banner, inputClass, textareaClass, tokens } from "@/components/ui-shell";
import { clearApiCache } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { useRealtimeSubscription } from "@/lib/realtime";
import {
  fetchPortalInvoiceDetail,
  fetchPortalInvoices,
  uploadPortalPaymentProof,
} from "@/pages/patients/data/portal-api";
import {
  formatPortalCurrency,
  formatPortalDate,
  formatPortalDateTime,
  invoiceStatusTone,
  invoiceTypeLabel,
  invoiceTypeTone,
  downloadPortalInvoicePdf,
  openPortalInvoicePdf,
  portalStatusLabel,
} from "@/pages/patients/model/portal-shared";
import type { PortalInvoiceItem, PortalInvoiceLineItem } from "@/pages/patients/model/portal-shared";
import { cn } from "@/lib/utils";

function shellCard(extra?: string) {
  return cn("rounded-[1.75rem] border border-slate-200 bg-white shadow-sm", extra);
}

const PORTAL_INVOICE_REALTIME_EVENTS = [
  "invoice.created",
  "invoice.status_changed",
  "invoice.dunning_created",
  "invoice.overdue_marked",
  "document.payment_proof_uploaded",
] as const;

export function PatientInvoicesPage() {
  const { lang } = useLang();
  const [invoices, setInvoices] = useState<PortalInvoiceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [version, setVersion] = useState(0);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState("");
  const [detail, setDetail] = useState<PortalInvoiceItem | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [uploadNote, setUploadNote] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const l = useCallback(
    (de: string, ru: string, en: string) =>
      lang === "de" ? de : lang === "ru" ? ru : en,
    [lang],
  );

  useRealtimeSubscription(PORTAL_INVOICE_REALTIME_EVENTS, (event) => {
    clearApiCache("/me/invoices");
    if (event.entity_type === "invoice") {
      clearApiCache(`/me/invoices/${event.entity_id}`);
    }
    if (selectedInvoiceId) {
      clearApiCache(`/me/invoices/${selectedInvoiceId}`);
    }
    setVersion((value) => value + 1);
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (loading) {
        setRefreshing(false);
      } else {
        setRefreshing(true);
      }

      try {
        const rows = await fetchPortalInvoices();
        if (cancelled) return;
        startTransition(() => {
          setInvoices(rows);
          setError("");
          if (rows.length === 0) {
            setSelectedInvoiceId("");
          } else if (!rows.some((item) => item.id === selectedInvoiceId)) {
            setSelectedInvoiceId(rows[0]?.id ?? "");
          }
        });
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : l("Rechnungen konnten nicht geladen werden.", "Не удалось загрузить счета.", "Failed to load invoices."));
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [loading, selectedInvoiceId, version, l]);

  useEffect(() => {
    if (!selectedInvoiceId) {
      setDetail(null);
      setDetailError("");
      return;
    }

    let cancelled = false;

    async function loadDetail() {
      setDetailBusy(true);
      try {
        const invoice = await fetchPortalInvoiceDetail(selectedInvoiceId);
        if (cancelled) return;
        setDetail(invoice);
        setDetailError("");
      } catch (err) {
        if (cancelled) return;
        setDetailError(err instanceof Error ? err.message : l("Rechnungsdetails konnten nicht geladen werden.", "Не удалось загрузить детали счета.", "Failed to load invoice detail."));
      } finally {
        if (!cancelled) {
          setDetailBusy(false);
        }
      }
    }

    void loadDetail();
    return () => {
      cancelled = true;
    };
  }, [selectedInvoiceId, version, l]);

  const totalBalance = useMemo(
    () => invoices.reduce((sum, item) => sum + Number(item.balance_due ?? 0), 0),
    [invoices],
  );
  const overdueCount = useMemo(
    () => invoices.filter((item) => item.status === "overdue").length,
    [invoices],
  );
  const proofPendingCount = useMemo(
    () =>
      invoices.filter(
        (item) =>
          !["paid", "cancelled"].includes(item.status) &&
          !item.last_payment_proof_at,
      ).length,
    [invoices],
  );

  async function handlePaymentProofUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    if (!uploadFile) {
      setUploadError(l("Bitte zuerst eine Datei auswählen.", "Сначала выберите файл.", "Choose a file first."));
      return;
    }

    setUploadBusy(true);
    setUploadError("");
    setNotice("");

    try {
      const formData = new FormData();
      formData.set("file", uploadFile);
      formData.set("order_id", detail.order_id);
      formData.set("upload_kind", "payment_proof");
      formData.set("auto_name", `Payment proof ${detail.invoice_number}`);
      if (uploadNote.trim()) {
        formData.set("notes", uploadNote.trim());
      }

      await uploadPortalPaymentProof(formData);
      setNotice(l("Zahlungsnachweis wurde für das Abrechnungsteam hochgeladen.", "Подтверждение оплаты загружено для отдела биллинга.", "Payment proof uploaded for the billing team."));
      setUploadOpen(false);
      setUploadFile(null);
      setUploadNote("");
      setVersion((value) => value + 1);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : l("Zahlungsnachweis konnte nicht hochgeladen werden.", "Не удалось загрузить подтверждение оплаты.", "Failed to upload payment proof."));
    } finally {
      setUploadBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex items-center gap-3 rounded-full border border-slate-200 bg-white px-5 py-3 text-sm text-slate-500 shadow-sm">
          <LoaderCircle className="size-4 animate-spin" />
          {l("Rechnungen werden geladen...", "Загрузка счетов...", "Loading invoices...")}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className={shellCard("bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.16),_transparent_34%),linear-gradient(135deg,#082f49_0%,#0f172a_52%,#14532d_100%)] px-6 py-6 text-white")}>
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-sm uppercase tracking-[0.18em] text-white/60">{l("Patientenportal", "Портал пациента", "Patient portal")}</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">{l("Meine Rechnungen", "Мои счета", "My invoices")}</h1>
            <p className="mt-3 text-sm leading-7 text-white/75">
              {l(
                "Prüfen Sie freigegebene Rechnungsstände, verfolgen Sie den Zahlungsstatus und laden Sie einen Zahlungsnachweis hoch, wenn Sie bereits überwiesen haben.",
                "Просматривайте опубликованные счета, отслеживайте статус оплаты и загружайте подтверждение, если средства уже переведены.",
                "Review released invoice snapshots, track payment state and upload payment proof when you already transferred funds.",
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <a href="/documents">
              <Button variant="outline" className="border-white/15 bg-white/8 text-white hover:bg-white/12 hover:text-white">
                <Upload className="size-4" />
                {l("Dokumente öffnen", "Открыть документы", "Open documents")}
              </Button>
            </a>
            <Button
              variant="outline"
              className="border-white/15 bg-white/8 text-white hover:bg-white/12 hover:text-white"
              onClick={() => setVersion((value) => value + 1)}
            >
              {refreshing ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              {l("Aktualisieren", "Обновить", "Refresh")}
            </Button>
          </div>
        </div>
      </section>

      {notice ? (
        <section className={shellCard("border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-700")}>
          {notice}
        </section>
      ) : null}
      {error ? (
        <section className={shellCard("border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700")}>
          {error}
        </section>
      ) : null}

      <section className="grid gap-4 md:grid-cols-3">
        <MetricCard label={l("Sichtbare Rechnungen", "Видимые счета", "Visible invoices")} value={String(invoices.length)} />
        <MetricCard label={l("Offener Saldo", "Остаток к оплате", "Outstanding balance")} value={formatPortalCurrency(totalBalance)} />
        <MetricCard label={l("Fehlender Zahlungsnachweis", "Отсутствует подтверждение оплаты", "Missing payment proof")} value={String(proofPendingCount)} description={l(`${overdueCount} überfällig`, `${overdueCount} просрочено`, `${overdueCount} overdue`)} />
      </section>

      {invoices.length === 0 ? (
        <section className={shellCard("border-dashed px-6 py-12 text-center")}>
          <p className="text-base font-semibold text-slate-950">{l("Noch keine Rechnungen freigegeben", "Счета пока не опубликованы", "No invoices released yet")}</p>
          <p className="mt-2 text-sm text-slate-500">
            {l("Rechnungsstände erscheinen hier, sobald sie für das Portal freigegeben sind.", "Снимки счетов появятся здесь, как только будут доступны в портале.", "Billing snapshots will appear here once they are available for portal access.")}
          </p>
        </section>
      ) : (
        <section className="grid gap-4 xl:grid-cols-2">
          {invoices.map((invoice) => {
            const balanceDue = Number(invoice.balance_due ?? 0);

            return (
              <button
                key={invoice.id}
                type="button"
                onClick={() => setSelectedInvoiceId(invoice.id)}
                className={cn(
                  "rounded-[1.75rem] border bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md",
                  selectedInvoiceId === invoice.id ? "border-sky-300 ring-4 ring-sky-100" : "border-slate-200",
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-mono text-xs font-semibold tracking-[0.16em] text-slate-500">
                      {invoice.invoice_number}
                    </div>
                    <h2 className="mt-2 text-lg font-semibold text-slate-950">{invoice.order_number}</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {l("Ausgestellt", "Выставлен", "Issued")} {formatPortalDateTime(invoice.issued_at)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline" className={cn("rounded-full", invoiceStatusTone(invoice.status))}>
                      {portalStatusLabel(invoice.status)}
                    </Badge>
                    <Badge variant="outline" className={cn("rounded-full", invoiceTypeTone(invoice.invoice_type))}>
                      {invoiceTypeLabel(invoice.invoice_type)}
                    </Badge>
                  </div>
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  <MetricChip label={l("Gesamt", "Итого", "Total")} value={formatPortalCurrency(invoice.total_gross)} />
                  <MetricChip label={l("Offen", "Открыто", "Open")} value={formatPortalCurrency(balanceDue)} />
                  <MetricChip
                    label={l("Zahlungsnachweis", "Подтверждение оплаты", "Payment proof")}
                    value={invoice.last_payment_proof_at ? `${l("Hochgeladen", "Загружено", "Uploaded")} ${formatPortalDate(invoice.last_payment_proof_at)}` : l("Nicht hochgeladen", "Не загружено", "Not uploaded")}
                  />
                </div>
              </button>
            );
          })}
        </section>
      )}

      <Sheet open={Boolean(selectedInvoiceId)} onOpenChange={(open) => { if (!open) setSelectedInvoiceId(""); }}>
        <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-3xl">
          <AdminSheetScaffold
            title={detail ? detail.invoice_number : l("Rechnungsdetails", "Детали счета", "Invoice detail")}
            description={l("Kaufmännische Summen, Positionen und Übergabe des Zahlungsnachweises für die ausgewählte Rechnung.", "Коммерческие суммы, позиции и передача подтверждения оплаты для выбранного счета.", "Commercial totals, line items and payment-proof handoff for the selected invoice.")}
            headerClassName="px-4 py-3"
            bodyClassName="min-h-0 overscroll-y-contain px-4 py-2"
          >
            <div className="space-y-6">
            {detailBusy ? (
              <div className={cn("flex items-center gap-3 rounded-xl px-4 py-3 text-sm text-muted-foreground", tokens.surface.softCard)}>
                <LoaderCircle className="size-4 animate-spin" />
                {l("Rechnungsdetails werden geladen...", "Загрузка деталей счета...", "Loading invoice detail...")}
              </div>
            ) : detailError ? (
              <Banner tone="error">
                {detailError}
              </Banner>
            ) : !detail ? (
              <div className={cn("rounded-xl px-4 py-6 text-sm text-muted-foreground", tokens.surface.dashed)}>
                {l("Wählen Sie eine Rechnungskarte, um die Detailansicht zu öffnen.", "Выберите карточку счета, чтобы открыть детальное представление.", "Choose an invoice card to open the detail workspace.")}
              </div>
            ) : (
              <>
                <section className={cn("rounded-xl p-5", tokens.surface.card)}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className={cn(tokens.text.sectionTitle, "inline-flex items-center gap-2")}>
                        <span aria-hidden className="size-1.5 rounded-full bg-primary/70" />
                        <span>{l("Rechnungsübersicht", "Обзор счета", "Invoice overview")}</span>
                      </h2>
                      <p className={cn("mt-1", tokens.text.muted)}>{l("Beträge, Fälligkeitsdatum und verknüpfter Angebots-/Auftragskontext.", "Суммы, срок оплаты и связанный контекст предложения/заказа.", "Amounts, due date and linked quote/order context.")}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="rounded-2xl"
                        onClick={() =>
                          void openPortalInvoicePdf(detail.id).catch((err) => {
                            setDetailError(err instanceof Error ? err.message : l("Rechnungs-PDF konnte nicht geöffnet werden.", "Не удалось открыть PDF счета.", "Failed to open invoice PDF."));
                          })
                        }
                      >
                        {l("PDF-Vorschau", "Предпросмотр PDF", "Preview PDF")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="rounded-2xl"
                        onClick={() =>
                          void downloadPortalInvoicePdf(detail.id, `${detail.invoice_number}.pdf`).catch((err) => {
                            setDetailError(err instanceof Error ? err.message : l("Rechnungs-PDF konnte nicht heruntergeladen werden.", "Не удалось скачать PDF счета.", "Failed to download invoice PDF."));
                          })
                        }
                      >
                        <Download className="size-4" />
                        {l("PDF herunterladen", "Скачать PDF", "Download PDF")}
                      </Button>
                      <Badge variant="outline" className={cn("rounded-full", invoiceStatusTone(detail.status))}>
                        {portalStatusLabel(detail.status)}
                      </Badge>
                      <Badge variant="outline" className={cn("rounded-full", invoiceTypeTone(detail.invoice_type))}>
                        {invoiceTypeLabel(detail.invoice_type)}
                      </Badge>
                    </div>
                  </div>
                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    <Detail label={l("Ausgestellt am", "Выставлен", "Issued at")} value={formatPortalDateTime(detail.issued_at)} />
                    <Detail label={l("Fällig am", "Срок оплаты", "Due date")} value={formatPortalDate(detail.due_date)} />
                    <Detail label={l("Auftrag", "Заказ", "Order")} value={detail.order_number} />
                    <Detail label={l("Angebot", "Предложение", "Quote")} value={detail.quote_number || l("Nicht festgelegt", "Не указано", "Not set")} />
                    <Detail label={l("Brutto gesamt", "Итого брутто", "Total gross")} value={formatPortalCurrency(detail.total_gross)} />
                    <Detail label={l("Offener Saldo", "Остаток к оплате", "Open balance")} value={formatPortalCurrency(detail.balance_due)} />
                  </div>
                  {detail.notes ? (
                    <div className={cn("mt-4 rounded-xl px-4 py-3 text-sm text-muted-foreground", tokens.surface.mutedCard)}>
                      {detail.notes}
                    </div>
                  ) : null}
                </section>

                <section className={cn("rounded-xl p-5", tokens.surface.card)}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className={cn(tokens.text.sectionTitle, "inline-flex items-center gap-2")}>
                        <span aria-hidden className="size-1.5 rounded-full bg-primary/70" />
                        <span>{l("Zahlungsnachweis", "Подтверждение оплаты", "Payment proof")}</span>
                      </h2>
                      <p className={cn("mt-1", tokens.text.muted)}>
                        {l("Laden Sie Überweisungsbeleg oder Zahlungsbestätigung hoch, sobald die Zahlung erfolgt ist.", "Загрузите квитанцию о переводе или подтверждение оплаты после отправки средств.", "Upload transfer receipt or payment confirmation once funds were sent.")}
                      </p>
                    </div>
                    <Button
                      type="button"
                      className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
                      disabled={uploadBusy || ["paid", "cancelled"].includes(detail.status)}
                      onClick={() => {
                        setUploadError("");
                        setUploadOpen(true);
                      }}
                    >
                      <Upload className="size-4" />
                      {l("Zahlungsnachweis hochladen", "Загрузить подтверждение оплаты", "Upload payment proof")}
                    </Button>
                  </div>
                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    <Detail label={l("Hochgeladene Nachweise", "Загруженные подтверждения", "Uploaded proofs")} value={String(detail.payment_proof_count ?? 0)} />
                    <Detail
                      label={l("Letzter Upload", "Последняя загрузка", "Latest upload")}
                      value={detail.last_payment_proof_at ? formatPortalDateTime(detail.last_payment_proof_at) : l("Nicht hochgeladen", "Не загружено", "Not uploaded")}
                    />
                  </div>
                </section>

                <section className={cn("rounded-xl p-5", tokens.surface.card)}>
                  <h2 className={cn(tokens.text.sectionTitle, "inline-flex items-center gap-2")}>
                    <span aria-hidden className="size-1.5 rounded-full bg-primary/70" />
                    <span>{l("Positionen", "Позиции", "Line items")}</span>
                  </h2>
                  <p className={cn("mt-1", tokens.text.muted)}>{l("Materialisierte Abrechnungspositionen für den aktuellen Rechnungsstand.", "Материализованные строки биллинга для текущего снимка счета.", "Materialized billing lines for the current invoice snapshot.")}</p>
                  <div className="mt-5 space-y-3">
                    {!detail.line_items || detail.line_items.length === 0 ? (
                      <div className={cn("rounded-xl px-4 py-6 text-sm text-muted-foreground", tokens.surface.dashed)}>
                        {l("Keine Positionen verfügbar.", "Нет доступных позиций.", "No line items available.")}
                      </div>
                    ) : (
                      detail.line_items.map((line, index) => (
                        <InvoiceLineCard key={`${detail.id}-${index}`} line={line} />
                      ))
                    )}
                  </div>
                </section>
              </>
            )}
            </div>
          </AdminSheetScaffold>
        </SheetContent>
      </Sheet>

      <Dialog
        open={uploadOpen}
        onOpenChange={(open) => {
          setUploadOpen(open);
          if (!open) {
            setUploadBusy(false);
            setUploadError("");
          }
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{l("Zahlungsnachweis hochladen", "Загрузить подтверждение оплаты", "Upload payment proof")}</DialogTitle>
            <DialogDescription>
              {l("Diese Datei wird intern für die Abrechnungsnachverfolgung angehängt und nicht automatisch im Portal freigegeben.", "Этот файл прикрепляется внутри системы для биллинга и не публикуется автоматически обратно в портал.", "This file is attached internally for billing follow-up and is not auto-shared back to the portal.")}
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={(event) => void handlePaymentProofUpload(event)}>
            <div className="space-y-2">
              <Label htmlFor="invoice-payment-proof">{l("Datei", "Файл", "File")}</Label>
              <input
                id="invoice-payment-proof"
                type="file"
                className={cn(
                  inputClass,
                  "block w-full py-1.5 file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-foreground",
                )}
                onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invoice-payment-proof-note">{l("Notiz", "Заметка", "Note")}</Label>
              <textarea
                id="invoice-payment-proof-note"
                className={cn(textareaClass, "min-h-[110px]")}
                placeholder={l("Optionale Überweisungsreferenz, Zahlungsdatum oder Erläuterung.", "Необязательная ссылка на перевод, дата оплаты или пояснение.", "Optional transfer reference, payment date or clarification.")}
                value={uploadNote}
                onChange={(event) => setUploadNote(event.target.value)}
              />
            </div>
            {uploadError ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {uploadError}
              </div>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" className="rounded-2xl" onClick={() => setUploadOpen(false)}>
                {l("Abbrechen", "Отмена", "Cancel")}
              </Button>
              <Button type="submit" className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800" disabled={uploadBusy}>
                {uploadBusy ? <LoaderCircle className="size-4 animate-spin" /> : <Upload className="size-4" />}
                {l("Nachweis senden", "Отправить подтверждение", "Send proof")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MetricCard({ label, value, description }: { label: string; value: string; description?: string }) {
  return (
    <section className="rounded-[1.5rem] border border-slate-200 bg-white px-5 py-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
      {description ? <p className="mt-2 text-xs text-slate-500">{description}</p> : null}
    </section>
  );
}

function MetricChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className="mt-2 text-sm font-medium text-slate-950">{value}</p>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className={cn("rounded-xl px-4 py-3", tokens.surface.mutedCard)}>
      <p className={tokens.text.eyebrow}>{label}</p>
      <p className="mt-2 text-sm text-foreground">{value}</p>
    </div>
  );
}

function InvoiceLineCard({ line }: { line: PortalInvoiceLineItem }) {
  const { lang } = useLang();
  const l = (de: string, ru: string, en: string) => (lang === "de" ? de : lang === "ru" ? ru : en);
  return (
    <article className={cn("rounded-xl px-4 py-4", tokens.surface.mutedCard)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">{line.description}</p>
          <p className={cn("mt-1", tokens.text.muted)}>
            {l("Menge", "Кол-во", "Qty")} {line.quantity} · {l("Einheit", "Цена за единицу", "Unit")} {formatPortalCurrency(line.unit_price)} · VAT {line.vat_rate}%
          </p>
        </div>
        <Badge variant="outline" className="rounded-full border-border bg-card text-foreground">
          {formatPortalCurrency(line.line_gross)}
        </Badge>
      </div>
      {line.notes ? <p className={cn("mt-3", tokens.text.muted)}>{line.notes}</p> : null}
    </article>
  );
}
