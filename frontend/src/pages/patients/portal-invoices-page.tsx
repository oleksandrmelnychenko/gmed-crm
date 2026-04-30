import { startTransition, useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Download, LoaderCircle, RefreshCw, Upload } from "lucide-react";

import { AdminSheetScaffold } from "@/components/admin-page-patterns";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  Banner,
  CountBadge,
  EmptyCell,
  Field,
  InfoRow,
  inputClass,
  ListItem,
  PageHeader,
  Section,
  StatCard,
  StatusBadge,
  SuccessBanner,
  TabLoader,
  textareaClass,
  tokens,
  type StatusTone,
} from "@/components/ui-shell";
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
  invoiceTypeLabel,
  downloadPortalInvoicePdf,
  openPortalInvoicePdf,
  portalStatusLabel,
} from "@/pages/patients/model/portal-shared";
import type { PortalInvoiceItem, PortalInvoiceLineItem } from "@/pages/patients/model/portal-shared";
import { cn } from "@/lib/utils";

function invoiceAmountsVisible(invoice: PortalInvoiceItem) {
  return invoice.portal_visibility?.amounts_visible_to_patient ?? true;
}

function invoicePdfVisible(invoice: PortalInvoiceItem) {
  return invoice.portal_visibility?.pdf_visible_to_patient ?? true;
}

function invoiceTypeBadgeTone(invoiceType: string): StatusTone {
  if (invoiceType === "advance") return "brand";
  if (invoiceType === "interim") return "info";
  if (invoiceType === "final") return "success";
  return "neutral";
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
          setSelectedInvoiceId((current) =>
            current && rows.some((item) => item.id === current) ? current : "",
          );
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
  }, [loading, version, l]);

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
    () =>
      invoices.reduce(
        (sum, item) =>
          invoiceAmountsVisible(item) ? sum + Number(item.balance_due ?? 0) : sum,
        0,
      ),
    [invoices],
  );
  const hiddenAmountCount = useMemo(
    () => invoices.filter((item) => !invoiceAmountsVisible(item)).length,
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
      <div className="min-h-[320px]">
        <TabLoader />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={l("Meine Rechnungen", "Мои счета", "My invoices")}
        description={l(
                "Prüfen Sie freigegebene Rechnungsstände, verfolgen Sie den Zahlungsstatus und laden Sie einen Zahlungsnachweis hoch, wenn Sie bereits überwiesen haben.",
                "Просматривайте опубликованные счета, отслеживайте статус оплаты и загружайте подтверждение, если средства уже переведены.",
                "Review released invoice snapshots, track payment state and upload payment proof when you already transferred funds.",
              )}
        actions={
          <>
            <CountBadge>{l("Patientenportal", "Портал пациента", "Patient portal")}</CountBadge>
            <a href="/documents">
              <Button variant="outline" className={tokens.control.primaryButton}>
                <Upload className="size-4" />
                {l("Dokumente öffnen", "Открыть документы", "Open documents")}
              </Button>
            </a>
            <Button
              variant="outline"
              className={tokens.control.primaryButton}
              onClick={() => setVersion((value) => value + 1)}
            >
              {refreshing ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              {l("Aktualisieren", "Обновить", "Refresh")}
            </Button>
          </>
        }
      />
      {notice ? <SuccessBanner>{notice}</SuccessBanner> : null}
      {error ? <Banner tone="error">{error}</Banner> : null}

      <section className="grid gap-4 md:grid-cols-3">
        <StatCard label={l("Sichtbare Rechnungen", "Видимые счета", "Visible invoices")} value={String(invoices.length)} />
        <StatCard label={l("Offener Saldo", "Остаток к оплате", "Outstanding balance")} value={hiddenAmountCount > 0 ? l("Teilweise verborgen", "Частично скрыто", "Partly hidden") : formatPortalCurrency(totalBalance)} />
        <StatCard label={l("Fehlender Zahlungsnachweis", "Отсутствует подтверждение оплаты", "Missing payment proof")} value={String(proofPendingCount)} description={l(`${overdueCount} überfällig`, `${overdueCount} просрочено`, `${overdueCount} overdue`)} />
      </section>

      <Section title={l("Meine Rechnungen", "Мои счета", "My invoices")} accessory={<CountBadge>{invoices.length}</CountBadge>}>
        {invoices.length === 0 ? (
          <EmptyCell>
            <p className="text-base font-semibold text-foreground">{l("Noch keine Rechnungen freigegeben", "Счета пока не опубликованы", "No invoices released yet")}</p>
            <p className="mt-2 text-sm text-muted-foreground">
              {l("Rechnungsstände erscheinen hier, sobald sie für das Portal freigegeben sind.", "Снимки счетов появятся здесь, как только будут доступны в портале.", "Billing snapshots will appear here once they are available for portal access.")}
            </p>
          </EmptyCell>
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {invoices.map((invoice) => {
              const amountsVisible = invoiceAmountsVisible(invoice);
              const balanceDue = Number(invoice.balance_due ?? 0);

              return (
                <ListItem
                  key={invoice.id}
                  onClick={() => setSelectedInvoiceId(invoice.id)}
                  className={cn(
                    "space-y-4",
                    selectedInvoiceId === invoice.id && "border-primary/60 bg-primary/5 ring-2 ring-primary/15",
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className={tokens.text.eyebrow}>{invoice.invoice_number}</div>
                      <h2 className="mt-2 text-base font-semibold text-foreground">{invoice.order_number}</h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {l("Ausgestellt", "Выставлен", "Issued")} {formatPortalDateTime(invoice.issued_at)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <StatusBadge status={invoice.status}>
                        {portalStatusLabel(invoice.status)}
                      </StatusBadge>
                      <StatusBadge tone={invoiceTypeBadgeTone(invoice.invoice_type)}>
                        {invoiceTypeLabel(invoice.invoice_type)}
                      </StatusBadge>
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <InfoRow
                      className={cn("rounded-lg px-3 py-2", tokens.surface.mutedCard)}
                      label={l("Gesamt", "Итого", "Total")}
                      value={amountsVisible ? formatPortalCurrency(invoice.total_gross) : l("Verborgen", "Скрыто", "Hidden")}
                    />
                    <InfoRow
                      className={cn("rounded-lg px-3 py-2", tokens.surface.mutedCard)}
                      label={l("Offen", "Открыто", "Open")}
                      value={amountsVisible ? formatPortalCurrency(balanceDue) : l("Verborgen", "Скрыто", "Hidden")}
                    />
                    <InfoRow
                      className={cn("rounded-lg px-3 py-2", tokens.surface.mutedCard)}
                      label={l("Zahlungsnachweis", "Подтверждение оплаты", "Payment proof")}
                      value={invoice.last_payment_proof_at ? `${l("Hochgeladen", "Загружено", "Uploaded")} ${formatPortalDate(invoice.last_payment_proof_at)}` : l("Nicht hochgeladen", "Не загружено", "Not uploaded")}
                    />
                  </div>
                </ListItem>
              );
            })}
          </div>
        )}
      </Section>

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
                        className={cn(tokens.control.primaryButton, !invoicePdfVisible(detail) && "hidden")}
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
                        className={cn(tokens.control.primaryButton, !invoicePdfVisible(detail) && "hidden")}
                        onClick={() =>
                          void downloadPortalInvoicePdf(detail.id, `${detail.invoice_number}.pdf`).catch((err) => {
                            setDetailError(err instanceof Error ? err.message : l("Rechnungs-PDF konnte nicht heruntergeladen werden.", "Не удалось скачать PDF счета.", "Failed to download invoice PDF."));
                          })
                        }
                      >
                        <Download className="size-4" />
                        {l("PDF herunterladen", "Скачать PDF", "Download PDF")}
                      </Button>
                      <StatusBadge status={detail.status}>
                        {portalStatusLabel(detail.status)}
                      </StatusBadge>
                      <StatusBadge tone={invoiceTypeBadgeTone(detail.invoice_type)}>
                        {invoiceTypeLabel(detail.invoice_type)}
                      </StatusBadge>
                    </div>
                  </div>
                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    <InfoRow className={cn("rounded-lg px-3 py-2", tokens.surface.mutedCard)} label={l("Ausgestellt am", "Выставлен", "Issued at")} value={formatPortalDateTime(detail.issued_at)} />
                    <InfoRow className={cn("rounded-lg px-3 py-2", tokens.surface.mutedCard)} label={l("Fällig am", "Срок оплаты", "Due date")} value={formatPortalDate(detail.due_date)} />
                    <InfoRow className={cn("rounded-lg px-3 py-2", tokens.surface.mutedCard)} label={l("Auftrag", "Заказ", "Order")} value={detail.order_number} />
                    <InfoRow className={cn("rounded-lg px-3 py-2", tokens.surface.mutedCard)} label={l("Angebot", "Предложение", "Quote")} value={detail.quote_number || l("Nicht festgelegt", "Не указано", "Not set")} />
                    <InfoRow className={cn("rounded-lg px-3 py-2", tokens.surface.mutedCard)} label={l("Brutto gesamt", "Итого брутто", "Total gross")} value={invoiceAmountsVisible(detail) ? formatPortalCurrency(detail.total_gross) : l("Verborgen", "Скрыто", "Hidden")} />
                    <InfoRow className={cn("rounded-lg px-3 py-2", tokens.surface.mutedCard)} label={l("Offener Saldo", "Остаток к оплате", "Open balance")} value={invoiceAmountsVisible(detail) ? formatPortalCurrency(detail.balance_due) : l("Verborgen", "Скрыто", "Hidden")} />
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
                      className={tokens.control.primaryButton}
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
                    <InfoRow className={cn("rounded-lg px-3 py-2", tokens.surface.mutedCard)} label={l("Hochgeladene Nachweise", "Загруженные подтверждения", "Uploaded proofs")} value={String(detail.payment_proof_count ?? 0)} />
                    <InfoRow className={cn("rounded-lg px-3 py-2", tokens.surface.mutedCard)}
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
            <Field label={l("Datei", "Файл", "File")} htmlFor="invoice-payment-proof">
              <input
                id="invoice-payment-proof"
                type="file"
                className={cn(
                  inputClass,
                  "block w-full py-1.5 file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-foreground",
                )}
                onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
              />
            </Field>
            <Field label={l("Notiz", "Заметка", "Note")} htmlFor="invoice-payment-proof-note">
              <textarea
                id="invoice-payment-proof-note"
                className={cn(textareaClass, "min-h-[110px]")}
                placeholder={l("Optionale Überweisungsreferenz, Zahlungsdatum oder Erläuterung.", "Необязательная ссылка на перевод, дата оплаты или пояснение.", "Optional transfer reference, payment date or clarification.")}
                value={uploadNote}
                onChange={(event) => setUploadNote(event.target.value)}
              />
            </Field>
            {uploadError ? <Banner tone="error">{uploadError}</Banner> : null}
            <DialogFooter>
              <Button type="button" variant="outline" className={tokens.control.primaryButton} onClick={() => setUploadOpen(false)}>
                {l("Abbrechen", "Отмена", "Cancel")}
              </Button>
              <Button type="submit" className={tokens.control.primaryButton} disabled={uploadBusy}>
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
        <CountBadge>{formatPortalCurrency(line.line_gross)}</CountBadge>
      </div>
      {line.notes ? <p className={cn("mt-3", tokens.text.muted)}>{line.notes}</p> : null}
    </article>
  );
}
