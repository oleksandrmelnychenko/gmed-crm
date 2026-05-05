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
  const { t, lang } = useLang();
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
        setError(err instanceof Error ? err.message : t.portal_invoices_failed_to_load_invoices);
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
  }, [loading, t.portal_invoices_failed_to_load_invoices, version, l]);

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
        setDetailError(err instanceof Error ? err.message : t.portal_invoices_failed_to_load_invoice_detail);
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
  }, [selectedInvoiceId, t.portal_invoices_failed_to_load_invoice_detail, version, l]);

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
      setUploadError(t.portal_invoices_choose_a_file_first);
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
      setNotice(t.portal_invoices_payment_proof_uploaded_for_the_billing_team);
      setUploadOpen(false);
      setUploadFile(null);
      setUploadNote("");
      setVersion((value) => value + 1);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : t.portal_invoices_failed_to_upload_payment_proof);
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
        title={t.portal_invoices_my_invoices}
        description={t.portal_invoices_review_released_invoice_snapshots_track_payment_state_and_upload}
        actions={
          <>
            <CountBadge>{t.portal_invoices_patient_portal}</CountBadge>
            <a href="/documents">
              <Button variant="outline" className={tokens.control.primaryButton}>
                <Upload className="size-4" />
                {t.portal_invoices_open_documents}
              </Button>
            </a>
            <Button
              variant="outline"
              className={tokens.control.primaryButton}
              onClick={() => setVersion((value) => value + 1)}
            >
              {refreshing ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              {t.portal_invoices_refresh}
            </Button>
          </>
        }
      />
      {notice ? <SuccessBanner>{notice}</SuccessBanner> : null}
      {error ? <Banner tone="error">{error}</Banner> : null}

      <section className="grid gap-4 md:grid-cols-3">
        <StatCard label={t.portal_invoices_visible_invoices} value={String(invoices.length)} />
        <StatCard label={t.portal_invoices_outstanding_balance} value={hiddenAmountCount > 0 ? t.portal_invoices_partly_hidden : formatPortalCurrency(totalBalance)} />
        <StatCard label={t.portal_invoices_missing_payment_proof} value={String(proofPendingCount)} description={l(`${overdueCount} überfällig`, `${overdueCount} просрочено`, `${overdueCount} overdue`)} />
      </section>

      <Section title={t.portal_invoices_my_invoices} accessory={<CountBadge>{invoices.length}</CountBadge>}>
        {invoices.length === 0 ? (
          <EmptyCell>
            <p className="text-base font-semibold text-foreground">{t.portal_invoices_no_invoices_released_yet}</p>
            <p className="mt-2 text-sm text-muted-foreground">
              {t.portal_invoices_billing_snapshots_will_appear_here_once_they_are_available_for_p}
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
                        {t.portal_invoices_issued} {formatPortalDateTime(invoice.issued_at)}
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
                      label={t.portal_invoices_total}
                      value={amountsVisible ? formatPortalCurrency(invoice.total_gross) : t.portal_invoices_hidden}
                    />
                    <InfoRow
                      className={cn("rounded-lg px-3 py-2", tokens.surface.mutedCard)}
                      label={t.portal_invoices_open}
                      value={amountsVisible ? formatPortalCurrency(balanceDue) : t.portal_invoices_hidden}
                    />
                    <InfoRow
                      className={cn("rounded-lg px-3 py-2", tokens.surface.mutedCard)}
                      label={t.portal_invoices_payment_proof}
                      value={invoice.last_payment_proof_at ? `${t.portal_invoices_uploaded} ${formatPortalDate(invoice.last_payment_proof_at)}` : t.portal_invoices_not_uploaded}
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
            title={detail ? detail.invoice_number : t.portal_invoices_invoice_detail}
            description={t.portal_invoices_commercial_totals_line_items_and_payment_proof_handoff_for_the_s}
            headerClassName="px-4 py-3"
            bodyClassName="min-h-0 overscroll-y-contain px-4 py-2"
          >
            <div className="space-y-6">
            {detailBusy ? (
              <div className={cn("flex items-center gap-3 rounded-xl px-4 py-3 text-sm text-muted-foreground", tokens.surface.softCard)}>
                <LoaderCircle className="size-4 animate-spin" />
                {t.portal_invoices_loading_invoice_detail}
              </div>
            ) : detailError ? (
              <Banner tone="error">
                {detailError}
              </Banner>
            ) : !detail ? (
              <div className={cn("rounded-xl px-4 py-6 text-sm text-muted-foreground", tokens.surface.dashed)}>
                {t.portal_invoices_choose_an_invoice_card_to_open_the_detail_workspace}
              </div>
            ) : (
              <>
                <section className={cn("rounded-xl p-5", tokens.surface.card)}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className={cn(tokens.text.sectionTitle, "inline-flex items-center gap-2")}>
                        <span aria-hidden className="size-1.5 rounded-full bg-primary/70" />
                        <span>{t.portal_invoices_invoice_overview}</span>
                      </h2>
                      <p className={cn("mt-1", tokens.text.muted)}>{t.portal_invoices_amounts_due_date_and_linked_quote_order_context}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className={cn(tokens.control.primaryButton, !invoicePdfVisible(detail) && "hidden")}
                        onClick={() =>
                          void openPortalInvoicePdf(detail.id).catch((err) => {
                            setDetailError(err instanceof Error ? err.message : t.portal_invoices_failed_to_open_invoice_pdf);
                          })
                        }
                      >
                        {t.portal_invoices_preview_pdf}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className={cn(tokens.control.primaryButton, !invoicePdfVisible(detail) && "hidden")}
                        onClick={() =>
                          void downloadPortalInvoicePdf(detail.id, `${detail.invoice_number}.pdf`).catch((err) => {
                            setDetailError(err instanceof Error ? err.message : t.portal_invoices_failed_to_download_invoice_pdf);
                          })
                        }
                      >
                        <Download className="size-4" />
                        {t.portal_invoices_download_pdf}
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
                    <InfoRow className={cn("rounded-lg px-3 py-2", tokens.surface.mutedCard)} label={t.portal_invoices_issued_at} value={formatPortalDateTime(detail.issued_at)} />
                    <InfoRow className={cn("rounded-lg px-3 py-2", tokens.surface.mutedCard)} label={t.portal_invoices_due_date} value={formatPortalDate(detail.due_date)} />
                    <InfoRow className={cn("rounded-lg px-3 py-2", tokens.surface.mutedCard)} label={t.portal_invoices_order} value={detail.order_number} />
                    <InfoRow className={cn("rounded-lg px-3 py-2", tokens.surface.mutedCard)} label={t.portal_invoices_quote} value={detail.quote_number || t.portal_invoices_not_set} />
                    <InfoRow className={cn("rounded-lg px-3 py-2", tokens.surface.mutedCard)} label={t.portal_invoices_total_gross} value={invoiceAmountsVisible(detail) ? formatPortalCurrency(detail.total_gross) : t.portal_invoices_hidden} />
                    <InfoRow className={cn("rounded-lg px-3 py-2", tokens.surface.mutedCard)} label={t.portal_invoices_open_balance} value={invoiceAmountsVisible(detail) ? formatPortalCurrency(detail.balance_due) : t.portal_invoices_hidden} />
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
                        <span>{t.portal_invoices_payment_proof}</span>
                      </h2>
                      <p className={cn("mt-1", tokens.text.muted)}>
                        {t.portal_invoices_upload_transfer_receipt_or_payment_confirmation_once_funds_were}
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
                      {t.portal_invoices_upload_payment_proof}
                    </Button>
                  </div>
                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    <InfoRow className={cn("rounded-lg px-3 py-2", tokens.surface.mutedCard)} label={t.portal_invoices_uploaded_proofs} value={String(detail.payment_proof_count ?? 0)} />
                    <InfoRow className={cn("rounded-lg px-3 py-2", tokens.surface.mutedCard)}
                      label={t.portal_invoices_latest_upload}
                      value={detail.last_payment_proof_at ? formatPortalDateTime(detail.last_payment_proof_at) : t.portal_invoices_not_uploaded}
                    />
                  </div>
                </section>

                <section className={cn("rounded-xl p-5", tokens.surface.card)}>
                  <h2 className={cn(tokens.text.sectionTitle, "inline-flex items-center gap-2")}>
                    <span aria-hidden className="size-1.5 rounded-full bg-primary/70" />
                    <span>{t.portal_invoices_line_items}</span>
                  </h2>
                  <p className={cn("mt-1", tokens.text.muted)}>{t.portal_invoices_materialized_billing_lines_for_the_current_invoice_snapshot}</p>
                  <div className="mt-5 space-y-3">
                    {!detail.line_items || detail.line_items.length === 0 ? (
                      <div className={cn("rounded-xl px-4 py-6 text-sm text-muted-foreground", tokens.surface.dashed)}>
                        {t.portal_invoices_no_line_items_available}
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
            <DialogTitle>{t.portal_invoices_upload_payment_proof}</DialogTitle>
            <DialogDescription>
              {t.portal_invoices_this_file_is_attached_internally_for_billing_follow_up_and_is_no}
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={(event) => void handlePaymentProofUpload(event)}>
            <Field label={t.portal_invoices_file} htmlFor="invoice-payment-proof">
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
            <Field label={t.portal_invoices_note} htmlFor="invoice-payment-proof-note">
              <textarea
                id="invoice-payment-proof-note"
                className={cn(textareaClass, "min-h-[110px]")}
                placeholder={t.portal_invoices_optional_transfer_reference_payment_date_or_clarification}
                value={uploadNote}
                onChange={(event) => setUploadNote(event.target.value)}
              />
            </Field>
            {uploadError ? <Banner tone="error">{uploadError}</Banner> : null}
            <DialogFooter>
              <Button type="button" variant="outline" className={tokens.control.primaryButton} onClick={() => setUploadOpen(false)}>
                {t.portal_invoices_cancel}
              </Button>
              <Button type="submit" className={tokens.control.primaryButton} disabled={uploadBusy}>
                {uploadBusy ? <LoaderCircle className="size-4 animate-spin" /> : <Upload className="size-4" />}
                {t.portal_invoices_send_proof}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InvoiceLineCard({ line }: { line: PortalInvoiceLineItem }) {
  const { t } = useLang();
  return (
    <article className={cn("rounded-xl px-4 py-4", tokens.surface.mutedCard)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">{line.description}</p>
          <p className={cn("mt-1", tokens.text.muted)}>
            {t.portal_invoices_qty} {line.quantity} · {t.portal_invoices_unit} {formatPortalCurrency(line.unit_price)} · VAT {line.vat_rate}%
          </p>
        </div>
        <CountBadge>{formatPortalCurrency(line.line_gross)}</CountBadge>
      </div>
      {line.notes ? <p className={cn("mt-3", tokens.text.muted)}>{line.notes}</p> : null}
    </article>
  );
}
